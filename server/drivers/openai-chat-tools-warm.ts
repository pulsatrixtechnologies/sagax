// Keep chat-completions MCP mounts warm across turns of the same thread
// (perf #1953): CLI engines already do this via spawn-contract token files.
// The HTTP runtime used to spawn agents (and friends) on every turn and
// close them in finally, paying a full process cold start before first token.
//
// #1975: also prewarm those mounts on warmOnly (thread open / typing) so a
// cold HTTP thread does not pay the agents MCP spawn before first token.
import { createHash } from "node:crypto";
import type { SendTurnInput } from "../contracts.ts";
import { ASK_USER_TOOL } from "../../shared/ask-question.ts";
import { allowsTool, parseToolScope, type ToolScope } from "../../shared/tool-scope.ts";
import { mountChatTools, providerToolLimit, type ChatToolSession } from "./chat-mcp-tools.ts";
import { PERSPICAX_TOKEN_ENV, warmCommsEnv, warmPerspicaxEnv, withoutTurnTokens } from "./spawn-contract.ts";

export type WarmToolSession = {
  session: ChatToolSession;
  fingerprint: string;
  /** Person who started this warm (isolation / per-person caps). */
  person?: string;
  /** True when kept by warmOnly before any real turn. */
  prewarmed?: boolean;
};

/** Same as pi's withWarmTokens: per-turn tokens ride files so a kept MCP
 * process reads the current turn without a relaunch. */
export function withWarmTokens(turn: SendTurnInput, threadId: string): SendTurnInput {
  const integrations = turn.integrations;
  if (!integrations) return turn;
  const agents = integrations.agents?.env?.SAGAX_COMMS_TOKEN
    ? { ...integrations.agents, env: warmCommsEnv(threadId, turn.botId, integrations.agents.env) }
    : integrations.agents;
  const custom = integrations.custom
    ? Object.fromEntries(Object.entries(integrations.custom).map(([name, server]) => {
      const env = (server as { env?: Record<string, string> }).env;
      return [name, env?.[PERSPICAX_TOKEN_ENV] ? { ...server, env: warmPerspicaxEnv(threadId, turn.botId, env) } : server];
    }))
    : integrations.custom;
  return { ...turn, integrations: { ...integrations, ...(agents ? { agents } : {}), ...(custom ? { custom } : {}) } };
}

/** Stable fingerprint of what mountChatTools would spawn, with per-turn
 * tokens masked when their files were written. */
export function chatToolsFingerprint(
  integrations: SendTurnInput["integrations"],
  opts: { computerUse: boolean; toolScope?: unknown; toolLimit: number; callTimeoutMs?: number },
): string {
  const servers: Record<string, unknown> = {};
  if (integrations?.localComputer) servers.computer = integrations.localComputer;
  if (integrations?.browser) servers.browser = integrations.browser;
  if (integrations?.agents) servers.agents = integrations.agents;
  if (integrations?.data) servers.data = integrations.data;
  if (integrations?.messages) servers.messages = integrations.messages;
  if (integrations?.custom) Object.assign(servers, integrations.custom);
  const body = {
    servers: withoutTurnTokens(servers),
    computerUse: opts.computerUse,
    toolScope: opts.toolScope ?? null,
    toolLimit: opts.toolLimit,
    callTimeoutMs: opts.callTimeoutMs ?? null,
  };
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

/** Tool limit the turn path uses (ask_user keeps a slot when allowed). */
export function chatToolsTurnLimit(
  opts: { toolsEnabled: boolean; toolLimit: number | undefined; driverKind: string; toolScope?: unknown },
): { ok: true; toolLimit: number; scope: ToolScope | undefined } | { ok: false; error: string } {
  const parsed = parseToolScope(opts.toolScope);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const scope = parsed.scope;
  const questionAllowed = opts.toolsEnabled && allowsTool(scope, { kind: "native", name: ASK_USER_TOOL });
  const toolLimit = (opts.toolLimit ?? providerToolLimit(opts.driverKind)) - (questionAllowed ? 1 : 0);
  return { ok: true, toolLimit, scope };
}

const MAX_WARM_TOOL_SESSIONS = 64;
/** Concurrent prewarmed mounts one person may hold at once (#1975). */
export const PREWARM_MCP_PER_PERSON = 2;

/** Bounded per-thread MCP session cache for createOpenAIChatRuntime. */
export function createWarmToolSessions(options?: { maxPerPerson?: number }) {
  const sessions = new Map<string, WarmToolSession>();
  const maxPerPerson = Math.max(1, options?.maxPerPerson ?? PREWARM_MCP_PER_PERSON);

  const evict = async (threadId: string): Promise<void> => {
    const row = sessions.get(threadId);
    if (!row) return;
    sessions.delete(threadId);
    await row.session.close().catch(() => {});
  };

  const prewarmedFor = (person: string): string[] => {
    const ids: string[] = [];
    for (const [threadId, row] of sessions) {
      if (row.prewarmed && row.person === person) ids.push(threadId);
    }
    return ids;
  };

  return {
    get(threadId: string, fingerprint: string): ChatToolSession | undefined {
      const row = sessions.get(threadId);
      if (!row) return undefined;
      if (row.fingerprint !== fingerprint) {
        void evict(threadId);
        return undefined;
      }
      return row.session;
    },
    has(threadId: string): boolean {
      return sessions.has(threadId);
    },
    personOf(threadId: string): string | undefined {
      return sessions.get(threadId)?.person;
    },
    isPrewarmed(threadId: string): boolean {
      return sessions.get(threadId)?.prewarmed === true;
    },
    prewarmedCount(person: string): number {
      return prewarmedFor(person).length;
    },
    set(
      threadId: string,
      fingerprint: string,
      session: ChatToolSession,
      meta?: { person?: string; prewarmed?: boolean },
    ): void {
      const previous = sessions.get(threadId);
      if (previous && previous.session !== session) void previous.session.close().catch(() => {});
      sessions.delete(threadId);
      sessions.set(threadId, {
        session,
        fingerprint,
        ...(meta?.person ? { person: meta.person } : previous?.person ? { person: previous.person } : {}),
        ...(meta?.prewarmed !== undefined
          ? { prewarmed: meta.prewarmed }
          : previous?.prewarmed !== undefined ? { prewarmed: previous.prewarmed } : {}),
      });
      while (sessions.size > MAX_WARM_TOOL_SESSIONS) {
        const oldest = sessions.keys().next().value;
        if (oldest === undefined) break;
        void evict(oldest);
      }
    },
    /** Keep the session for the next turn of this thread; do not close. */
    keep(
      threadId: string,
      session: ChatToolSession,
      fingerprint: string,
      meta?: { person?: string; prewarmed?: boolean },
    ): void {
      this.set(threadId, fingerprint, session, meta);
    },
    /** Mark a kept session as taken by a real turn (no longer a waiting prewarm). */
    claim(threadId: string): void {
      const row = sessions.get(threadId);
      if (!row) return;
      row.prewarmed = false;
    },
    async release(threadId: string): Promise<void> {
      await evict(threadId);
    },
    async releaseAll(): Promise<void> {
      const ids = [...sessions.keys()];
      await Promise.all(ids.map((id) => evict(id)));
    },
    /**
     * Mount MCP tools ahead of the first turn (warmOnly). Reuses an existing
     * matching fingerprint. Caps concurrent waiting prewarms per person.
     * Best effort: failures leave the cache empty so the real turn mounts.
     */
    async prewarm(
      turn: SendTurnInput,
      opts: {
        computerUse: boolean;
        toolLimit?: number;
        driverKind: string;
        person?: string;
        signal?: AbortSignal;
      },
    ): Promise<"kept" | "mounted" | "limited" | "skipped" | "aborted"> {
      if (opts.signal?.aborted) return "aborted";
      if (!turn.integrations) return "skipped";
      const limit = chatToolsTurnLimit({
        toolsEnabled: true,
        toolLimit: opts.toolLimit,
        driverKind: opts.driverKind,
        toolScope: turn.toolScope,
      });
      if (!limit.ok) return "skipped";
      const warmTurn = withWarmTokens(turn, turn.threadId);
      const fingerprint = chatToolsFingerprint(warmTurn.integrations, {
        computerUse: opts.computerUse,
        toolScope: turn.toolScope,
        toolLimit: limit.toolLimit,
        callTimeoutMs: turn.mcpCallTimeoutMs,
      });
      if (this.get(turn.threadId, fingerprint)) {
        if (opts.person) {
          const row = sessions.get(turn.threadId);
          if (row && !row.person) row.person = opts.person;
        }
        return "kept";
      }
      const person = opts.person?.trim();
      if (person) {
        const waiting = prewarmedFor(person);
        if (waiting.length >= maxPerPerson && !waiting.includes(turn.threadId)) {
          // Drop the oldest waiting prewarm of this person so a new open can mount.
          const oldest = waiting[0]!;
          await evict(oldest);
        }
      }
      try {
        const session = await mountChatTools(
          warmTurn.integrations,
          opts.signal ?? AbortSignal.timeout(30_000),
          opts.computerUse,
          limit.scope,
          turn.mcpCallTimeoutMs,
          limit.toolLimit,
        );
        if (opts.signal?.aborted) {
          await session.close().catch(() => {});
          return "aborted";
        }
        this.keep(turn.threadId, session, fingerprint, {
          ...(person ? { person } : {}),
          prewarmed: true,
        });
        return "mounted";
      } catch {
        return "skipped";
      }
    },
  };
}

export type WarmToolSessions = ReturnType<typeof createWarmToolSessions>;
