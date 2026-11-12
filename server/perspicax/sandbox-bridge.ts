// #4081: the commands of a bot's server environment reach that bot's own
// Perspicax connection, with no Perspicax token in the environment.
//
// A script the bot runs (run_command, a routine watch command) gets two
// SAGAX_* variables: the bridge's MCP address and a short bridge token
// bound to the bot, the person whose environment runs it and the turn (or
// the watch check). The script speaks plain MCP over HTTP to that address
// (POST /api/bridge/perspicax/mcp, one JSON-RPC frame per request); the
// server relays each frame on the bot's own connection:
//   - in a turn, through the very pipeline of the engine's stdio bridge
//     (/api/internal/perspicax/mcp with the turn's own capability: the
//     confidential, misuse and safety checks, the role logic), after each
//     tools/call passed the same approval decision as a native call (a held
//     request: organization Refuse and Ask first rules, the person's rules,
//     the level; a read of their own connection passes with no card);
//   - in a watch check (no turn, nobody to answer a card), through the
//     routine delegation like the watch's own tool reads, reads only.
// The Perspicax token never leaves this process. The bridge token is no
// session and no capability: it opens only this route, only while its turn
// or check runs, and only for the person whose environment received it.
//
// The route is public (PRE_AUTH_ROUTES): the environment reaches the server
// by its public address (SAGAX_SANDBOX_BRIDGE_URL, else SAGAX_PUBLIC_URL),
// never its loopback. Interface for plugin readers: docs/code/perspicax.md.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { PERSPICAX_PROTOCOL_VERSION, type PerspicaxRelayAnswer, type PerspicaxTurnPlan } from "./perspicax-mcp.ts";
import { PASS, type PreAuthRouteHandler } from "../routes/table.ts";

export const SANDBOX_BRIDGE_PATH = "/api/bridge/perspicax/mcp";
export const SANDBOX_BRIDGE_URL_ENV = "SAGAX_BRIDGE_MCP_URL";
export const SANDBOX_BRIDGE_TOKEN_ENV = "SAGAX_BRIDGE_TOKEN";
export const SANDBOX_BRIDGE_TOKEN_PREFIX = "sgx_brg_";
export const SANDBOX_BRIDGE_MAX_BODY = 2 * 1024 * 1024;
/** A turn's token also ends after this, whatever the turn does. */
export const SANDBOX_BRIDGE_TURN_MAX_MS = 12 * 60 * 60_000;
/** The answer's session id: informational, every call goes on the bot's one connection. */
export const SANDBOX_BRIDGE_SESSION_ID = "sagax-bridge";

export const SANDBOX_BRIDGE_WATCH_WRITE = "Refused: a routine watch reads only (nobody is there to approve a change). Make the change in a turn of the bot.";

export type SandboxBridgeGrant =
  | { kind: "turn"; botId: string; principalId: string; threadId: string; generation: string; expiresAt: number }
  | { kind: "watch"; botId: string; principalId: string; threadId: string; generation: string; ownerPrincipalId: string; expiresAt: number };

interface Kept { token: string; grant: SandboxBridgeGrant }

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The bridge tokens this process gave, by hash. In memory only: a restart
 * ends every turn and check anyway. */
export class SandboxBridgeGrants {
  private readonly byHash = new Map<string, Kept>();
  private readonly turnTokens = new Map<string, string>();
  private readonly now: () => number;
  private readonly turnActive: (threadId: string, generation: string) => boolean;

  constructor(options: { turnActive: (threadId: string, generation: string) => boolean; now?: () => number }) {
    this.turnActive = options.turnActive;
    this.now = options.now ?? Date.now;
  }

  /** The token of this turn for the person whose environment runs the
   * command: the same one for every command of the turn. */
  mintTurn(input: { botId: string; principalId: string; threadId: string; generation: string }): string {
    this.prune();
    const principalId = input.principalId.trim().toLowerCase();
    const turnKey = [input.botId, principalId, input.threadId, input.generation].join("\u0000");
    const kept = this.turnTokens.get(turnKey);
    if (kept && this.byHash.has(hashOf(kept))) return kept;
    const token = `${SANDBOX_BRIDGE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    this.byHash.set(hashOf(token), {
      token,
      grant: { kind: "turn", botId: input.botId, principalId, threadId: input.threadId, generation: input.generation, expiresAt: this.now() + SANDBOX_BRIDGE_TURN_MAX_MS },
    });
    this.turnTokens.set(turnKey, token);
    return token;
  }

  /** A watch check's token, for `ttlMs`; `revoke` ends it at once. */
  mintWatch(input: { botId: string; principalId: string; ownerPrincipalId: string; ttlMs: number }): { token: string; grant: SandboxBridgeGrant; revoke: () => void } {
    this.prune();
    const token = `${SANDBOX_BRIDGE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const id = randomBytes(9).toString("hex");
    const grant: SandboxBridgeGrant = {
      kind: "watch",
      botId: input.botId,
      principalId: input.principalId.trim().toLowerCase(),
      ownerPrincipalId: input.ownerPrincipalId.trim().toLowerCase(),
      threadId: `sandbox-bridge-watch-${id}`,
      generation: `watch-${id}`,
      expiresAt: this.now() + Math.max(1_000, input.ttlMs),
    };
    const hash = hashOf(token);
    this.byHash.set(hash, { token, grant });
    return { token, grant, revoke: () => { this.byHash.delete(hash); } };
  }

  /** The grant an Authorization header names, while it holds; else null. */
  resolve(header: string | string[] | undefined): SandboxBridgeGrant | null {
    const value = Array.isArray(header) ? "" : (header ?? "");
    const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
    if (!match || !match[1]!.startsWith(SANDBOX_BRIDGE_TOKEN_PREFIX)) return null;
    const presented = match[1]!;
    const kept = this.byHash.get(hashOf(presented));
    if (!kept) return null;
    const a = Buffer.from(kept.token);
    const b = Buffer.from(presented);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    if (!this.holds(kept.grant)) {
      this.byHash.delete(hashOf(presented));
      return null;
    }
    return kept.grant;
  }

  /** Tokens alive now (tests and diagnostics). */
  size(): number {
    this.prune();
    return this.byHash.size;
  }

  private holds(grant: SandboxBridgeGrant): boolean {
    if (grant.expiresAt <= this.now()) return false;
    return grant.kind === "watch" || this.turnActive(grant.threadId, grant.generation);
  }

  private prune(): void {
    for (const [hash, kept] of Array.from(this.byHash)) {
      if (!this.holds(kept.grant)) this.byHash.delete(hash);
    }
    for (const [turnKey, token] of Array.from(this.turnTokens)) {
      if (!this.byHash.has(hashOf(token))) this.turnTokens.delete(turnKey);
    }
  }
}

/** The address a script posts to, from the base the environment reaches
 * the server by; null when none is set (the variables are then not given). */
export function sandboxBridgeUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const base = (env.SAGAX_SANDBOX_BRIDGE_URL?.trim() || env.SAGAX_PUBLIC_URL?.trim() || "").replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(base)) return null;
  return `${base}${SANDBOX_BRIDGE_PATH}`;
}

/** The two variables of one command. */
export function sandboxBridgeEnv(url: string, token: string): Record<string, string> {
  return { [SANDBOX_BRIDGE_URL_ENV]: url, [SANDBOX_BRIDGE_TOKEN_ENV]: token };
}

/** The Perspicax calls a watch check's relay needs (PerspicaxMcp). */
export interface SandboxBridgeMcp {
  prepareTurn(input: { threadId: string; generation: string; bot: { id: string }; speakerPrincipalId: string; speakerOrigin: "owner-routine"; ownerPrincipalId?: string }): Promise<PerspicaxTurnPlan>;
  relay(input: { threadId: string; generation: string; botId: string; frame: unknown }): Promise<PerspicaxRelayAnswer>;
  frameReads(threadId: string, generation: string, botId: string, frame: unknown): Promise<boolean>;
  endGeneration(threadId: string, generation: string): Promise<void>;
}

/** A watch check's connection: opened at its first call through the
 * routine delegation of the person, ended with the check. */
export class SandboxBridgeWatchSessions {
  private readonly opened = new Map<string, Promise<PerspicaxTurnPlan>>();
  private readonly mcp: () => SandboxBridgeMcp | null;
  constructor(mcp: () => SandboxBridgeMcp | null) {
    this.mcp = mcp;
  }

  async relay(grant: Extract<SandboxBridgeGrant, { kind: "watch" }>, frame: Record<string, unknown>): Promise<PerspicaxRelayAnswer> {
    const mcp = this.mcp();
    const id = frame.id ?? null;
    if (!mcp) return { status: 200, body: { jsonrpc: "2.0", id, error: { code: -32000, message: "Perspicax is unavailable" } } };
    let plan = this.opened.get(grant.threadId);
    if (!plan) {
      plan = mcp.prepareTurn({
        threadId: grant.threadId, generation: grant.generation, bot: { id: grant.botId },
        speakerPrincipalId: grant.principalId, speakerOrigin: "owner-routine", ownerPrincipalId: grant.ownerPrincipalId,
      });
      this.opened.set(grant.threadId, plan);
    }
    const ready = await plan;
    if (!ready.mounted.length) return { status: 403, body: { error: "the Perspicax connection is not available to this watch", code: "profile_not_mounted" } };
    if (frame.method === "tools/call" && !(await mcp.frameReads(grant.threadId, grant.generation, grant.botId, frame))) {
      return { status: 200, body: { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: SANDBOX_BRIDGE_WATCH_WRITE }], isError: true } } };
    }
    return mcp.relay({ threadId: grant.threadId, generation: grant.generation, botId: grant.botId, frame });
  }

  /** The check is over: its connection and its tokens end. */
  async end(grant: SandboxBridgeGrant): Promise<void> {
    const plan = this.opened.get(grant.threadId);
    if (!plan) return;
    this.opened.delete(grant.threadId);
    await plan.catch(() => undefined);
    await this.mcp()?.endGeneration(grant.threadId, grant.generation);
  }
}

export interface SandboxBridgeRouteDeps {
  grants: SandboxBridgeGrants;
  /** The turn's own Perspicax capability (the stdio bridge's), never sent out; null when not mounted. */
  turnCapabilityToken(grant: Extract<SandboxBridgeGrant, { kind: "turn" }>): string | null;
  /** The person the turn's Perspicax connection speaks for. */
  turnPrincipal(grant: Extract<SandboxBridgeGrant, { kind: "turn" }>): string | undefined;
  /** Whether a frame only reads (the relay's reading). */
  frameReads(grant: Extract<SandboxBridgeGrant, { kind: "turn" }>, frame: Record<string, unknown>): Promise<boolean>;
  /** The approval of one tools/call on the turn, as a native call is
   * decided; undefined when no turn runs there. */
  hold(grant: Extract<SandboxBridgeGrant, { kind: "turn" }>, call: { name: string; args: Record<string, unknown>; read: boolean }): Promise<{ behavior: "allow" | "deny"; message?: string }> | undefined;
  /** Hands the frame to the internal pipeline under the turn's capability and answers `res`. */
  forwardTurn(req: IncomingMessage, res: ServerResponse, capabilityToken: string, raw: Buffer): Promise<void>;
  watch: SandboxBridgeWatchSessions;
  log?(line: string): void;
}

async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    bytes += buffer.length;
    if (bytes > SANDBOX_BRIDGE_MAX_BODY) throw Object.assign(new Error("body too large"), { status: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The tool as the person's rules and an engine's own ask name it. */
export function sandboxBridgeRuleTool(name: string): string {
  return `mcp__perspicax__${name}`;
}

export function createSandboxBridgeRoutes(deps: SandboxBridgeRouteDeps): PreAuthRouteHandler {
  return async ({ req, res, path, method, json }) => {
    if (path !== SANDBOX_BRIDGE_PATH) return PASS;
    res.setHeader("cache-control", "no-store");
    if (method !== "POST" && method !== "DELETE") return json(res, 405, { error: "POST" });
    const grant = deps.grants.resolve(req.headers.authorization);
    if (!grant) return json(res, 401, { error: "unauthorized" });
    if (method === "DELETE") {
      res.writeHead(204);
      res.end();
      return;
    }
    let raw: Buffer;
    try {
      raw = await readRaw(req);
    } catch (error) {
      return json(res, (error as { status?: number }).status ?? 400, { error: "could not read the frame" });
    }
    let frame: unknown;
    try {
      frame = JSON.parse(raw.toString("utf8"));
    } catch {
      return json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    }
    if (!isRecord(frame) || typeof frame.method !== "string") {
      return json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "one JSON-RPC request per POST (no batch)" } });
    }
    const id = frame.id;
    // The bridge answers initialize itself: the bot's connection is already
    // open (or opens at the first call), and a second initialize from a
    // script must never replace the engine's session under it.
    if (frame.method === "initialize") {
      const params = isRecord(frame.params) ? frame.params : {};
      res.setHeader("mcp-session-id", SANDBOX_BRIDGE_SESSION_ID);
      return json(res, 200, {
        jsonrpc: "2.0", id: id ?? null,
        result: {
          protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : PERSPICAX_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "perspicax", version: "sagax-bridge" },
        },
      });
    }
    if (id === undefined) {
      res.writeHead(202);
      res.end();
      return;
    }
    if (grant.kind === "watch") {
      const answer = await deps.watch.relay(grant, frame);
      return json(res, answer.status, answer.body ?? {});
    }
    const capabilityToken = deps.turnCapabilityToken(grant);
    if (!capabilityToken) return json(res, 403, { error: "the Perspicax connection is not mounted in this turn", code: "profile_not_mounted" });
    // Isolation between people: the turn's connection speaks for the person
    // whose environment received the token, or the call goes nowhere.
    if ((deps.turnPrincipal(grant) ?? "").trim().toLowerCase() !== grant.principalId) {
      return json(res, 403, { error: "this turn's Perspicax connection belongs to another person", code: "wrong_person" });
    }
    if (frame.method === "tools/call") {
      const params = isRecord(frame.params) ? frame.params : {};
      const name = typeof params.name === "string" ? params.name : "";
      if (!name) return json(res, 400, { jsonrpc: "2.0", id, error: { code: -32602, message: "tools/call needs a tool name" } });
      const args = isRecord(params.arguments) ? params.arguments : {};
      const read = await deps.frameReads(grant, frame);
      const held = deps.hold(grant, { name, args, read });
      if (!held) return json(res, 401, { error: "unauthorized" });
      const decision = await held;
      if (decision.behavior !== "allow") {
        const why = decision.message?.trim() || "the approval was declined";
        return json(res, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Refused: ${why}` }], isError: true } });
      }
      // the card could outlive the turn
      if (!deps.grants.resolve(req.headers.authorization)) return json(res, 401, { error: "unauthorized" });
    }
    await deps.forwardTurn(req, res, capabilityToken, raw);
  };
}
