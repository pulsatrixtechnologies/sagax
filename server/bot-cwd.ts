// A bot's working folder — where its shell tools run. Validated here, once,
// so a bad path is refused at PATCH time with a reason the settings panel
// can show, rather than surfacing later as a driver spawn failure.
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { safeRemoteDir } from "../shared/remote-files.ts";
import type { RemoteSessionOs } from "../shared/remote-session.ts";
import type { ListResult } from "./remote-session-files.ts";

export type CwdValidation = { ok: true; cwd: string | null } | { ok: false; error: string };

export function validateBotCwd(input: unknown): CwdValidation {
  if (input === null) return { ok: true, cwd: null };
  if (typeof input !== "string") return { ok: false, error: "working folder must be a path" };
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, cwd: null };
  const expanded = trimmed === "~" || trimmed.startsWith("~/") ? homedir() + trimmed.slice(1) : trimmed;
  if (!isAbsolute(expanded)) return { ok: false, error: "working folder must be an absolute path" };
  const cwd = resolve(expanded);
  let stat;
  try {
    stat = statSync(cwd);
  } catch {
    return { ok: false, error: `that folder doesn't exist: ${cwd}` };
  }
  if (!stat.isDirectory()) return { ok: false, error: `that path is not a folder: ${cwd}` };
  return { ok: true, cwd };
}

/** What the remote validation needs from the Tailcat service. */
export interface RemoteCwdDeps {
  /** the person asking, as the remote sessions know them; none = no remote */
  principalId: string | undefined;
  botId: string;
  sessions: {
    list(principalId: string, botId: string): Array<{ id: string; os: RemoteSessionOs; state: string }>;
    listDir(principalId: string, botId: string, id: string, requested: unknown): Promise<ListResult>;
  };
}

/** The working folder of a bot that has a connected remote computer lives on
 * THAT machine: it is checked there (absolute in the remote OS's spelling,
 * an existing folder, read over the Tailcat listing the folder picker uses),
 * never against this server's disk. Unreachable or refused = not accepted,
 * with the listing's own message. A bot with no connected computer falls back
 * to the server-local check. */
export async function validateBotCwdFor(input: unknown, remote: RemoteCwdDeps): Promise<CwdValidation> {
  if (input === null || input === undefined) return validateBotCwd(input ?? null);
  if (typeof input !== "string") return validateBotCwd(input);
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, cwd: null };
  const session = remote.principalId
    ? remote.sessions.list(remote.principalId, remote.botId).find((row) => row.state === "connected")
    : undefined;
  if (!session || !remote.principalId) return validateBotCwd(input);
  const dir = safeRemoteDir(trimmed, session.os);
  if (!dir) return { ok: false, error: "working folder must be an absolute path" };
  const listed = await remote.sessions.listDir(remote.principalId, remote.botId, session.id, dir);
  if ("error" in listed) {
    if (listed.status === 404) return { ok: false, error: "that folder doesn't exist on the bot's computer" };
    if (listed.status === 400) return { ok: false, error: "that path is not a folder on the bot's computer" };
    return { ok: false, error: listed.error };
  }
  return { ok: true, cwd: listed.listing.path };
}
