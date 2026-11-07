// Retry, keep-alive and write-once rules of the Perspicax MCP relay,
// split out of perspicax-mcp.ts. Pure values and predicates.

/** 2026-11-02: a routine (nobody at the keyboard) waits out a short Perspicax
 * outage, such as a connector roll of about two minutes, instead of running
 * without its tools or failing a call: these waits, about 2 min 17 s in all,
 * between tries of a transient failure (unreachable, rate limited, HTTP 502
 * or 503, connection refused). A person's own turn keeps the single quick
 * retry: they are there to try again. */
export const PERSPICAX_ROUTINE_RETRY_MS: readonly number[] = [2_000, 5_000, 10_000, 20_000, 40_000, 60_000];
/** Network errors that mean the request never left (nothing was sent). */
const UNSENT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);

/** A failed fetch that never reached Perspicax (connection refused, name
 * not resolved): safe to send again, even a write. */
export function perspicaxUnsent(error: unknown): boolean {
  for (let at: unknown = error, depth = 0; at && depth < 4; depth += 1) {
    const code = (at as { code?: unknown }).code;
    if (typeof code === "string" && UNSENT_CODES.has(code)) return true;
    at = (at as { cause?: unknown }).cause;
  }
  return false;
}

export const REMOTE_SUPPORT_OPEN_UNAVAILABLE =
  "Refused by Sagax: remote_support_open goes through Sagax (it fills the host and the session key). That path is not available here. Nothing was sent.";

/** What a bot reads in front of the answer when its voice_call became a
 * place_phone_call. */
export const VOICE_CALL_REDIRECTED = "Sagax placed this voice_call through place_phone_call (every call does: its card, the AI disclosure, the organization's rules). Use place_phone_call next time.";
export const VOICE_CALL_UNAVAILABLE = "Refused by Sagax: a call goes through place_phone_call, which is not available here. Nothing was sent.";

/** A token with less than this left is exchanged again before a call. */
export const PERSPICAX_TOKEN_MIN_LIFE_MS = 60_000;
export const PERSPICAX_RELAY_TIMEOUT_MS = 10 * 60_000;
export const PERSPICAX_RELAY_MAX_BYTES = 20 * 1024 * 1024;
/** Idle keep-alive ping cadence: under Perspicax KEEP_ALIVE (120 s). */
export const PERSPICAX_KEEPALIVE_MS = 90_000;
/** Jitter added on top of PERSPICAX_KEEPALIVE_MS so many entries do not fire together. */
export const PERSPICAX_KEEPALIVE_JITTER_MS = 15_000;
/** At most this many entries of one person are pinged (newest kept). */
export const PERSPICAX_KEEPALIVE_PER_PERSON = 8;
export const PERSPICAX_ACCESS_ENDED = "Perspicax access for this turn ended";
/** A call Sagax did not replay after Perspicax dropped the MCP session: it can
 * change data, so the bot decides (the call never reached Perspicax's tool). */
export const PERSPICAX_SESSION_RESET = "Perspicax had dropped this MCP session (idle or restarted). Sagax opened a new one, but did not replay this call because it can change data: it did not run. Call it again if it is still wanted.";

/** The answer a write that was not sent again carries in front of the first one's. */
export const PERSPICAX_WRITE_REPLAYED = "Not sent again: another run made this same write with the same arguments moments ago (one write per execution key). Its answer follows; the record already exists.";
/** The tools whose name says they change data: a connector's `<api>_write`,
 * `_action` or `_<x>_write` (`__` before Perspicax 1.9.19), its named writes (`log_time`, `book_*`,
 * `update_*`, `create_*`, `delete_*`), and the host's own. Reads, polls
 * (await_turn) and leases (claim*, per holder, renewals must reach
 * Perspicax) are never answered from a previous call. */
const WRITE_SUFFIX = /^(write|action|log_time|(book|update|create|delete)_[a-z0-9_]+|[A-Za-z0-9_]+_write)$/;
const HOST_WRITES = new Set(["memory_write", "memory_propose", "memory_promote", "memory_forget", "create_agent", "delete_agent",
  "sagax_send", "sagax_routine_run", "sagax_nudge", "remote_support_open", "remote_support_close"]);
/** A connector's write with one `_` (Perspicax 1.9.19: `cw_psa_write`,
 * `cw_psa_time_entries_write`, `cw_psa_log_time`, `cw_psa_update_ticket`);
 * its read_action is a read. */
const PROFILE_WRITE = /_(?:write|action|log_time)$|_(?:book|update|create|delete)_[a-z0-9_]+$/;
export function perspicaxWriteOnceTool(name: string): boolean {
  const at = name.lastIndexOf("__");
  if (at > 0) return WRITE_SUFFIX.test(name.slice(at + 2));
  if (HOST_WRITES.has(name)) return true;
  return !name.endsWith("_read_action") && PROFILE_WRITE.test(name);
}

