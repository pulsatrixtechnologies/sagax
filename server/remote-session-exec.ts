// The approval rule for the bot's commands on a connected Tailcat session
// (remote_session_exec, remote_session_snapshot). The computer is a
// client's. Security review of #965:
// - macOS and Linux (OS known): a command that only reads
//   (shared/read-only-command.ts, the same strict test as on the person's
//   own computer, #875) runs without a card;
// - Windows, and a computer whose OS is not known yet: EVERY command asks.
//   That classifier is POSIX: PowerShell quoting (`"a\"; Remove-Item x"`),
//   its drives (env:) and providers would pass it. Until a PowerShell
//   classifier with a cmdlet allowlist exists, nothing there is read-only;
// - any other command is the person's call every time: a card no level,
//   rule or Always allow answers;
// - the fixed snapshot only reads.
// The route checks again (consumeRemoteExecApproval): a command that does
// more than read runs only after the person allowed that exact command in
// that conversation, once.
import { createHash } from "node:crypto";

import type { RemoteSessionOs } from "../shared/remote-session.ts";
import { isReadOnlyCommand, runCommandOf } from "../shared/read-only-command.ts";
import { builtinAgentToolName } from "./member-tool-scope.ts";

export interface RemoteSessionToolCall {
  /** One of the two remote session tools. */
  remote: boolean;
  /** It only reads: no card. */
  readOnly: boolean;
}

/** The OS of the session a call means; `known` false while Sagax has not
 * read it yet. Null when there is no such session. */
export type RemoteOsLookup = (session: string | undefined) => { os: RemoteSessionOs; known: boolean } | null;

/** Whether a command on the session only reads, by its OS. */
export function remoteCommandReadOnly(command: string | undefined, os: { os: RemoteSessionOs; known: boolean } | null): boolean {
  if (!os || !os.known || os.os === "windows") return false;
  return isReadOnlyCommand(command);
}

function argsOf(input: string | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input ?? "") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function remoteSessionToolCall(tool: string | undefined, input: string | undefined, osOf: RemoteOsLookup): RemoteSessionToolCall {
  const name = builtinAgentToolName(tool?.trim());
  if (name === "remote_session_snapshot") return { remote: true, readOnly: true };
  if (name !== "remote_session_exec") return { remote: false, readOnly: false };
  const args = argsOf(input);
  const session = typeof args.session === "string" && args.session.trim() ? args.session.trim() : undefined;
  return { remote: true, readOnly: remoteCommandReadOnly(runCommandOf(input), osOf(session)) };
}

// ── the route's own check: one yes, one run of that exact command ──

const APPROVAL_MS = 10 * 60_000;
const MAX_ENTRIES = 500;
const commandKey = (command: string) => createHash("sha256").update(command.trim()).digest("hex");
/** Asked: `${threadId}:${requestId}` -> the command's key. */
const asked = new Map<string, { thread: string; key: string; at: number }>();
/** Allowed, not run yet: `${threadId}:${key}` -> when. */
const allowed = new Map<string, number>();

function trim(map: Map<string, unknown>) {
  while (map.size > MAX_ENTRIES) {
    const first = map.keys().next().value;
    if (first === undefined) break;
    map.delete(first);
  }
}

/** The gate saw a remote_session_exec that needs a card. */
export function noteRemoteExecRequest(threadId: string, requestId: string, input: string | undefined, now = Date.now()): void {
  const command = runCommandOf(input);
  if (!threadId || !requestId || !command?.trim()) return;
  asked.set(`${threadId}:${requestId}`, { thread: threadId, key: commandKey(command), at: now });
  trim(asked);
}

/** The person allowed that request (answerRequest, outcome allowed-once). */
export function grantRemoteExecApproval(threadId: string, requestId: string, now = Date.now()): void {
  const entry = asked.get(`${threadId}:${requestId}`);
  if (!entry || entry.thread !== threadId) return;
  asked.delete(`${threadId}:${requestId}`);
  allowed.set(`${threadId}:${entry.key}`, now);
  trim(allowed);
}

/** The route is about to run a command that does more than read: true once
 * per yes, for that exact command in that conversation, within ten minutes. */
export function consumeRemoteExecApproval(threadId: string, command: string, now = Date.now()): boolean {
  if (!threadId || !command.trim()) return false;
  const at = `${threadId}:${commandKey(command)}`;
  const when = allowed.get(at);
  if (when === undefined) return false;
  allowed.delete(at);
  return now - when <= APPROVAL_MS;
}
