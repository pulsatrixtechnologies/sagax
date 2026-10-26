// A remote support session the bot opened with its own tool call becomes a
// Sagax session: a row in the bot panel and a card in the chat. Both the
// agents catalog tool (server/remote-support-local.ts, through
// /api/internal/perspicax/tool) and a Perspicax MCP profile the engine mounts
// directly reach Perspicax through PerspicaxMcp.relay, which hands every
// remote_support_* answer here. Nothing here reads or keeps the tunnel
// address: the open call carries the session id, the rights, the OS and the
// end time; the status call says when it is connected; the close call ends it.
import {
  parseRemoteSessionCode,
  parseRemoteSessionEnd,
  parseRemoteSessionId,
  parseRemoteSessionOs,
  type RemoteSessionOs,
} from "../shared/remote-session.ts";

export interface RemoteSupportCall {
  threadId: string;
  botId: string;
  /** Whose Perspicax credentials made the call (the turn's speaker). A call
   * nobody speaks for is ignored. */
  principalId?: string;
  name: string;
  args: unknown;
  /** The MCP `result` object (content, structuredContent, isError). */
  result: unknown;
}

export interface RegisteredOpen {
  id: string;
  code: string;
  elevated: boolean;
  endAt: string;
  os?: RemoteSessionOs;
}

/** What the support folder kept for a code, with who opened it. */
export interface RecalledOpen extends RegisteredOpen {
  principalId?: string;
  botId?: string;
}

const MAX_OPEN = 200;
const DAY_MS = 26 * 60 * 60 * 1000;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The JSON object a tool answered: structuredContent, else the first text block parsed. */
export function toolResultObject(result: unknown): Json | null {
  if (!isObject(result) || result.isError === true) return null;
  if (isObject(result.structuredContent)) return result.structuredContent;
  const content = Array.isArray(result.content) ? result.content : [];
  for (const block of content) {
    if (!isObject(block) || typeof block.text !== "string") continue;
    try {
      const parsed = JSON.parse(block.text) as unknown;
      if (isObject(parsed)) return parsed;
    } catch {
      /* not JSON */
    }
  }
  return null;
}

const norm = (value: string) => value.trim().toLowerCase();

export function createRemoteSessionRegistrar(deps: {
  /** Post or refresh the card and the panel row (RemoteSessionService.publish), for this person. */
  publish(input: { principalId: string; botId: string; threadId: string; open: RegisteredOpen }): Promise<unknown>;
  /** Mark the card closed (RemoteSessionService.endByCode). */
  end(input: { principalId: string; botId: string; threadId: string; code: string }): Promise<unknown>;
  /** A session opened before a restart: what the support folder kept for this code. */
  recall?(code: string): RecalledOpen | null;
  /** The openers recorded in the support folder for a session id. An open
   * that reuses an id another person or bot opened is refused. */
  idOwners?(id: string): Array<{ principalId?: string; botId?: string }>;
  now?: () => number;
}) {
  const now = deps.now ?? (() => Date.now());
  const opened = new Map<string, { open: RegisteredOpen; at: number }>();
  const published = new Map<string, number>();
  const key = (principalId: string, botId: string, code: string) => `${principalId}\u0000${botId}\u0000${code}`;
  const onceKey = (principalId: string, botId: string, threadId: string, id: string) => `${principalId}\u0000${botId}\u0000${threadId}\u0000${id}`;

  /** Drop entries older than a day, then the oldest past the cap. */
  function prune<V>(map: Map<string, V>, atOf: (value: V) => number, room = 0) {
    const at = now();
    for (const [k, value] of map) if (at - atOf(value) > DAY_MS) map.delete(k);
    while (map.size > Math.max(0, MAX_OPEN - room)) {
      const first = map.keys().next().value;
      if (first === undefined) break;
      map.delete(first);
    }
  }

  function remember(principalId: string, botId: string, open: RegisteredOpen) {
    prune(opened, (row) => row.at, 1);
    prune(published, (at) => at);
    opened.set(key(principalId, botId, open.code), { open, at: now() });
  }

  /** The open this person made on this bot: kept in memory, else recalled
   * from the support folder when it names them as the opener. */
  function openFor(principalId: string, botId: string, code: string): RegisteredOpen | null {
    const kept = opened.get(key(principalId, botId, code))?.open;
    if (kept) return kept;
    const recalled = deps.recall?.(code) ?? null;
    if (!recalled || !recalled.principalId || !recalled.botId) return null;
    if (norm(recalled.principalId) !== principalId || recalled.botId !== botId) return null;
    const { principalId: _p, botId: _b, ...open } = recalled;
    return open;
  }

  return {
    /** Feed one remote_support_* answer. Returns what it did, for tests and logs. */
    async observe(call: RemoteSupportCall): Promise<"opened" | "published" | "ended" | null> {
      const principalId = call.principalId ? norm(call.principalId) : "";
      if (!principalId || !call.botId) return null;
      const args = isObject(call.args) ? call.args : {};
      const answer = toolResultObject(call.result);
      if (!answer) return null;
      if (call.name === "remote_support_open") {
        // session and end_at come from the model on a profile the engine
        // mounts directly: bound the end, and never take an id someone else opened
        const id = parseRemoteSessionId(args.session);
        const code = parseRemoteSessionCode(answer.code);
        const end = parseRemoteSessionEnd(args.end_at, now());
        if (!id || !code || end === null) return null;
        const others = (deps.idOwners?.(id) ?? []).filter((owner) => !owner.principalId || norm(owner.principalId) !== principalId || owner.botId !== call.botId);
        if (others.length) return null;
        const os = parseRemoteSessionOs(args.os);
        remember(principalId, call.botId, {
          id,
          code,
          elevated: args.rights === "elevated",
          endAt: new Date(end).toISOString(),
          ...(os ? { os } : {}),
        });
        return "opened";
      }
      const code = parseRemoteSessionCode(args.code);
      if (!code) return null;
      if (call.name === "remote_support_status") {
        if (answer.state !== "connected") return null;
        const open = openFor(principalId, call.botId, code);
        if (!open) return null;
        const once = onceKey(principalId, call.botId, call.threadId, open.id);
        if (published.has(once)) return null;
        // the OS the support page detected, when Perspicax says it: better
        // than asking the computer, and never a guess
        const detected = open.os ? null : parseRemoteSessionOs(answer.os);
        await deps.publish({ principalId, botId: call.botId, threadId: call.threadId, open: detected ? { ...open, os: detected } : open });
        prune(published, (at) => at, 1);
        published.set(once, now());
        return "published";
      }
      if (call.name === "remote_support_close") {
        const open = openFor(principalId, call.botId, code);
        opened.delete(key(principalId, call.botId, code));
        if (open) published.delete(onceKey(principalId, call.botId, call.threadId, open.id));
        await deps.end({ principalId, botId: call.botId, threadId: call.threadId, code });
        return "ended";
      }
      return null;
    },
    /** How many opens and published cards it keeps (bounded), for tests. */
    sizes(): { opened: number; published: number } {
      return { opened: opened.size, published: published.size };
    },
  };
}

export type RemoteSessionRegistrar = ReturnType<typeof createRemoteSessionRegistrar>;
