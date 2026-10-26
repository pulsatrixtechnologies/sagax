// Why a pooled engine process could not be reused for the next turn
// (docs/voice-mode-xai.md, "Latency"). A relaunch costs the engine's whole
// cold start (process boot, every MCP server reconnected, the session read
// back), which on a call is the largest share of the pause before the bot
// answers. The driver compares the spawn contract of the live process with
// the next turn's and logs the names of the fields that differ, never their
// values (a contract carries tokens and keys).
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { DATA_DIR } from "../config.ts";

/** The dotted paths of the leaves that differ between two contracts, at
 * most `limit` of them. Values are never returned. */
export function contractChanges(before: unknown, after: unknown, limit = 8, path = ""): string[] {
  const out: string[] = [];
  const walk = (a: unknown, b: unknown, at: string) => {
    if (out.length >= limit) return;
    if (a === b) return;
    const objects = a !== null && b !== null && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b);
    if (!objects) {
      out.push(at || "(root)");
      return;
    }
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const key of keys) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], at ? `${at}.${key}` : key);
  };
  walk(before, after, path);
  return out;
}

/** Environment entries of an MCP server that hold a per-turn credential:
 * they are handed to a long-lived process through a file the harness
 * rewrites each turn instead (see `withoutTurnTokens`). */
export const TURN_TOKEN_ENV = ["SAGAX_COMMS_TOKEN", "SAGAX_TURN_DEPTH"] as const;

/** Agents switches a reused process may keep from its launch when the turn
 * needs no more than it has (2026-10-19 perf parity): a teammate's reply
 * that resumes a person's turn (depth 1, no route_message, no own threads)
 * runs in the process the person's turn launched; the server refuses what
 * this turn may not do whatever the tool list shows. A turn that needs a
 * switch the live process lacks still gets a fresh one. */
export const TURN_SWITCH_ENV = ["SAGAX_ROUTE_MESSAGES", "SAGAX_OWN_THREAD_CREATION", "SAGAX_SINGLE_STREAM"] as const;

/** The switches one turn needs, from its agents server's env. */
export function turnSwitches(servers: Record<string, unknown>): Record<string, boolean> {
  const env = (servers.agents as { env?: Record<string, unknown> } | undefined)?.env ?? {};
  return Object.fromEntries(TURN_SWITCH_ENV.map((key) => [key, env[key] === "1"]));
}

/** A live process launched with `live` switches can run a turn needing `want`. */
export function switchesCover(live: Record<string, boolean> | undefined, want: Record<string, boolean>): boolean {
  return Object.entries(want).every(([key, on]) => !on || live?.[key] === true);
}

/** The turn capability of a Perspicax profile bridge
 * (server/perspicax-mcp-bridge.ts). It is minted per turn; the Perspicax
 * tokens themselves never leave the harness. */
export const PERSPICAX_TOKEN_ENV = "SAGAX_PERSPICAX_TOKEN";

/** The MCP servers of a contract with each per-turn token's value masked:
 * two turns of one call then make the same contract. */
export function withoutTurnTokens(servers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...servers };
  // A Perspicax bridge reads its turn capability from a file the harness
  // rewrites each turn (warmPerspicaxEnv): a pre-warmed process is then the
  // same process the next turn needs. Without the file, the value stays.
  for (const [name, server] of Object.entries(servers)) {
    const env = (server as { env?: Record<string, unknown> } | null | undefined)?.env;
    if (!env || !env.SAGAX_PERSPICAX_TOKEN_FILE || !(PERSPICAX_TOKEN_ENV in env)) continue;
    out[name] = { ...(server as object), env: { ...env, [PERSPICAX_TOKEN_ENV]: "(turn token)" } };
  }
  // Only the agents server reads its turn values from files, and only when
  // they were written (SAGAX_COMMS_TOKEN_FILE): otherwise a reused process
  // would keep a stale token, so the contract keeps it and relaunches.
  const env = (servers.agents as { env?: Record<string, unknown> } | null | undefined)?.env;
  if (!env || !env.SAGAX_COMMS_TOKEN_FILE) return out;
  const masked = { ...env };
  masked.SAGAX_COMMS_TOKEN = "(turn token)";
  if (env.SAGAX_TURN_DEPTH_FILE && "SAGAX_TURN_DEPTH" in masked) masked.SAGAX_TURN_DEPTH = "(turn token)";
  for (const key of TURN_SWITCH_ENV) if (key in masked) masked[key] = "(turn switch)";
  out.agents = { ...(servers.agents as object), env: masked };
  return out;
}

/** The turn files a process's agents server reads, to remove with it. */
export function turnFiles(servers: Record<string, unknown>): string[] {
  const env = (servers.agents as { env?: Record<string, unknown> } | null | undefined)?.env ?? {};
  const perspicax = Object.values(servers).map((server) => (server as { env?: Record<string, unknown> } | null | undefined)?.env?.SAGAX_PERSPICAX_TOKEN_FILE);
  return [env.SAGAX_COMMS_TOKEN_FILE, env.SAGAX_TURN_DEPTH_FILE, ...perspicax].filter((file): file is string => typeof file === "string");
}

/** Where a warm (call) session's agents proxy reads the current turn's
 * comms token: per thread, 0600, rewritten every turn. Shared by every
 * driver that keeps one engine process through a call (Claude, ACP). */
export function commsTokenFile(threadId: string, botId?: string): string {
  const digest = createHash("sha256").update(`${botId ?? ""}\0${threadId}`).digest("hex").slice(0, 24);
  return join(DATA_DIR, "comms-tokens", `${digest}.token`);
}

/** Write this turn's comms token where the warm process's agents proxy
 * reads it (server/drivers/agents-client.ts commsToken) and return the
 * agents server env that names the file. The launch token stays in the env
 * as the fallback the proxy uses when the file cannot be read. */
export function warmCommsEnv(threadId: string, botId: string | undefined, env: Record<string, string>): Record<string, string> {
  const token = env.SAGAX_COMMS_TOKEN;
  if (!token) return env;
  const tokenPath = commsTokenFile(threadId, botId);
  try {
    mkdirSync(dirname(tokenPath), { recursive: true, mode: 0o700 });
    // The turn's comms depth rides beside the token: the harness checks it
    // against the token's own (a resumed turn is one deeper). Written first,
    // so a token file never pairs with an older depth.
    if (env.SAGAX_TURN_DEPTH !== undefined) writeFileAtomic(`${tokenPath}.depth`, env.SAGAX_TURN_DEPTH, { mode: 0o600 });
    writeFileAtomic(tokenPath, token, { mode: 0o600 });
  } catch {
    // A full or read-only disk: the env carries this turn's values, and the
    // contract (withoutTurnTokens) then keeps them, so nothing reuses a
    // process holding an older token.
    return env;
  }
  return env.SAGAX_TURN_DEPTH === undefined
    ? { ...env, SAGAX_COMMS_TOKEN_FILE: tokenPath }
    : { ...env, SAGAX_COMMS_TOKEN_FILE: tokenPath, SAGAX_TURN_DEPTH_FILE: `${tokenPath}.depth` };
}

/** Where a Perspicax profile bridge of a kept process reads the current
 * turn's capability: beside the thread's comms token, one file per profile,
 * 0600, rewritten every turn. */
export function perspicaxTokenFile(threadId: string, botId: string | undefined, profileId: string): string {
  const profile = createHash("sha256").update(profileId).digest("hex").slice(0, 16);
  return `${commsTokenFile(threadId, botId)}.px-${profile}`;
}

/** Write this turn's Perspicax bridge capability where the bridge reads it
 * on every frame (server/perspicax-mcp-bridge.ts) and return the bridge env
 * that names the file. A pre-warmed (or kept) process then serves the next
 * turn as is: the capability alone no longer relaunches it. The launch value
 * stays in the env as the bridge's fallback; on a write failure the env is
 * returned unchanged and the contract keeps the value (a relaunch, never a
 * stale capability). */
export function warmPerspicaxEnv(threadId: string, botId: string | undefined, env: Record<string, string>): Record<string, string> {
  const token = env[PERSPICAX_TOKEN_ENV];
  const profileId = env.SAGAX_PERSPICAX_PROFILE;
  if (!token || !profileId) return env;
  const tokenPath = perspicaxTokenFile(threadId, botId, profileId);
  try {
    mkdirSync(dirname(tokenPath), { recursive: true, mode: 0o700 });
    writeFileAtomic(tokenPath, token, { mode: 0o600 });
  } catch {
    return env;
  }
  return { ...env, SAGAX_PERSPICAX_TOKEN_FILE: tokenPath };
}
