// Whether a person's message to a bot can be answered right now (the maintainer,
// 2026-10-27): when it certainly cannot (the engine is not connected for this
// person, the computer or the local server that serves its model is down),
// the composer does not send and says why in one line, with the one thing to
// do. Anything uncertain sends as before, so nobody is blocked by a guess.
// Pure: the harness (server/index.ts, GET /api/bots/<id>/send-state) passes what it
// knows; the clients ask again while blocked, so the composer comes back on
// its own once the cause is fixed.

export type SendBlockReason = "engine_not_connected" | "computer_offline" | "local_server_offline" | "owner_computer_offline"
  /** The engine account refused the last turn: its usage limit (Claude's
   * 5-hour or weekly window) or its credit (a 402, out of credits). The maintainer,
   * 2026-11-04: no message goes out and nothing can be done in the chat
   * until it resets or the bot moves to another engine or account. */
  | "engine_limit"
  /** #2013: the engine refused this conversation's last turn before any
   * prompt went out (not ready, or its own configuration conflicts with
   * the bot's). Advisory: the line says it, the next message still sends. */
  | "engine_refused"
  /** #2013: the engine's sign-in expired or was refused on the last turn. */
  | "engine_signed_out";

export type SendBlockAction =
  /** Connect this engine (Settings > Engines). */
  | { kind: "connect"; instanceId: string; engine: string }
  /** Nothing to change here: try again once the computer or server is back. */
  | { kind: "retry" }
  /** Move the bot to another engine or account (the model window). */
  | { kind: "switch_engine" }
  /** Send the conversation's last message again. */
  | { kind: "resend" }
  /** Sagax repairs the cause itself, then sends the last message again
   * (POST /api/bots/<id>/send-state/fix). */
  | { kind: "fix"; fix: SendBlockFix };

/** What a Fix action repairs. */
export type SendBlockFix =
  /** Turn the Codex account's own native MCP entries off (its config.toml). */
  | "codex_native_mcp";

export interface SendBlock {
  reason: SendBlockReason;
  /** The English line, for clients that do not word `reason` themselves. */
  message: string;
  action: SendBlockAction;
  /** The engine's display name, or the owner's for owner_computer_offline. */
  name?: string;
  /** engine_limit: what refused, and the epoch ms of its reset when the
   * provider said. The client words the reset in the reader's own clock. */
  limit?: { cause: "usage_limit" | "credits"; resetsAt?: number };
  /** True: the line informs, the composer still sends (engine_refused,
   * engine_signed_out). Absent: the message does not go out. */
  advisory?: true;
  /** engine_refused / engine_signed_out: what kind of refusal, and the
   * engine's own words for a Details disclosure. */
  refusal?: { kind: "config_conflict" | "engine_not_ready" | "signed_out"; cause: string };
}

/** How the computer-shared model behind a bot is doing, as the server last
 * heard from that computer. "unknown" for any other model. */
export type LocalReach = "ok" | "computer_offline" | "server_offline" | "unknown";

export interface SendStateInput {
  /** Auto picks an engine per turn: never blocked here. */
  auto: boolean;
  engine: { instanceId: string; name: string } | null;
  /** The engine refuses this person (no sign-in, no key, not given) and no
   * model of theirs takes its place. */
  accessRefused: boolean;
  /** The owner pays and the model is on the owner's computer, offline now. */
  ownerComputerOffline?: { ownerName: string } | null;
  local: LocalReach;
  /** The engine account refused this person's last turn and holds that
   * refusal now (server/engines/engine-refusals.ts), with no backup engine
   * to take the message. */
  limited?: { cause: "usage_limit" | "credits"; resetsAt?: number } | null;
  /** #2013: the engine refused this conversation's last turn before any
   * prompt went out; `fix` when Sagax can repair it in one click. */
  refused?: { kind: "config_conflict" | "engine_not_ready" | "signed_out"; cause: string; fix?: SendBlockFix } | null;
}

export function sendBlockFor(input: SendStateInput): SendBlock | null {
  if (input.auto || !input.engine) return null;
  if (input.ownerComputerOffline) {
    const owner = input.ownerComputerOffline.ownerName.trim();
    return {
      reason: "owner_computer_offline", ...(owner ? { name: owner } : {}),
      message: `${owner ? `${owner}'s` : "The bot owner's"} computer, which serves this bot's model, is offline. Try again once it is back.`,
      action: { kind: "retry" },
    };
  }
  if (input.local === "computer_offline") {
    return {
      reason: "computer_offline",
      message: "The computer that serves this bot's local model is offline or asleep. Open Sagax on it, then try again.",
      action: { kind: "retry" },
    };
  }
  if (input.local === "server_offline") {
    return {
      reason: "local_server_offline",
      message: "The local model is not responding: its server on that computer is stopped. Start it, then try again.",
      action: { kind: "retry" },
    };
  }
  if (input.limited) {
    const { name } = input.engine;
    const { cause, resetsAt } = input.limited;
    const at = typeof resetsAt === "number" && Number.isFinite(resetsAt) ? resetsAt : undefined;
    return {
      reason: "engine_limit", name,
      message: cause === "credits"
        ? `${name} is out of credit. Switch this bot to another engine or account.`
        : `${name} limit reached. Switch this bot to another engine or account, or wait for the reset.`,
      action: { kind: "switch_engine" },
      limit: { cause, ...(at !== undefined ? { resetsAt: at } : {}) },
    };
  }
  if (input.accessRefused) {
    const { instanceId, name } = input.engine;
    return {
      reason: "engine_not_connected", name,
      message: `${name} is not connected for you. Connect ${name} to talk to this bot.`,
      action: { kind: "connect", instanceId, engine: name },
    };
  }
  if (input.refused) {
    const { instanceId, name } = input.engine;
    const { kind, cause, fix } = input.refused;
    const refusal = { kind, cause };
    if (kind === "signed_out") {
      return {
        reason: "engine_signed_out", name, advisory: true, refusal,
        message: `${name} needs you to sign in again. Reconnect it, then send your message again.`,
        action: { kind: "connect", instanceId, engine: name },
      };
    }
    return {
      reason: "engine_refused", name, advisory: true, refusal,
      message: kind === "config_conflict"
        ? `${name} has its own settings that conflict with this bot's tools. Nothing was sent.`
        : `${name} could not start this turn. Nothing was sent.`,
      action: fix ? { kind: "fix", fix } : { kind: "resend" },
    };
  }
  return null;
}
