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
import { MiB, warmResourcePerson, warmResourceTokenThread, warmResources, type WarmResourceBudget, type WarmResourceLease } from "../resources/warm-resources.ts";

export type WarmToolSession = {
  session: ChatToolSession;
  fingerprint: string;
  /** Person who started this warm (isolation / per-person caps). */
  person?: string;
  /** True when kept by warmOnly before any real turn. */
  prewarmed?: boolean;
  budget?: WarmResourceLease;
  active?: boolean;
};

/** Same as pi's withWarmTokens: per-turn tokens ride files so a kept MCP
 * process reads the current turn without a relaunch. */
export function withWarmTokens(turn: SendTurnInput, threadId: string): SendTurnInput {
  const integrations = turn.integrations;
  if (!integrations) return turn;
  threadId = warmResourceTokenThread({ ...turn, threadId });
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

/** Concurrent prewarmed mounts one person may hold at once (#1975). */
export const PREWARM_MCP_PER_PERSON = 2;

/** Bounded per-thread MCP session cache for createOpenAIChatRuntime. */
export function createWarmToolSessions(options?: { maxPerPerson?: number; budget?: WarmResourceBudget; mount?: typeof mountChatTools }) {
  const sessions = new Map<string, WarmToolSession>();
  const budget = options?.budget ?? warmResources;
  const maxPerPerson = Math.max(1, options?.maxPerPerson ?? PREWARM_MCP_PER_PERSON);

  const closeRow = async (row: WarmToolSession): Promise<void> => {
    row.budget?.retiring();
    await row.session.close().catch(() => {});
    const usage = row.session.resources?.();
    if (usage?.stopped ?? !usage?.pids.length) row.budget?.forget();
  };

  const evict = async (threadId: string): Promise<void> => {
    const row = sessions.get(threadId);
    if (!row) return;
    sessions.delete(threadId);
    await closeRow(row);
  };

  const prewarmedFor = (person: string): string[] => {
    const ids: string[] = [];
    for (const [threadId, row] of sessions) {
      if (row.prewarmed && row.person === person) ids.push(threadId);
    }
    return ids;
  };

  return {
    get(threadId: string, fingerprint: string, person?: string): ChatToolSession | undefined {
      const row = sessions.get(threadId);
      if (!row) return undefined;
      if (row.fingerprint !== fingerprint || (person !== undefined && row.person !== person)) {
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
      meta?: { person?: string; prewarmed?: boolean; active?: boolean },
    ): void {
      const previous = sessions.get(threadId);
      if (previous && previous.session !== session) {
        void closeRow(previous);
      }
      sessions.delete(threadId);
      const row: WarmToolSession = {
        session,
        fingerprint,
        ...(meta?.person ? { person: meta.person } : previous?.person ? { person: previous.person } : {}),
        ...(meta?.prewarmed !== undefined
          ? { prewarmed: meta.prewarmed }
          : previous?.prewarmed !== undefined ? { prewarmed: previous.prewarmed } : {}),
        active: meta?.active === true,
        budget: previous?.session === session ? previous.budget : undefined,
      };
      sessions.set(threadId, row);
      if (!row.active && !row.prewarmed) session.detachAbort?.();
      const usage = () => session.resources?.() ?? { pids: [], bytes: MiB, stopped: undefined };
      row.budget ??= budget.register({
        person: row.person ?? "solo", kind: "http-mcp",
        pids: () => usage().pids,
        count: () => Math.max(1, usage().pids.length),
        bytes: () => usage().bytes + Math.max(1, usage().pids.length) * 32 * MiB,
        protected: () => sessions.get(threadId)?.session === session && sessions.get(threadId)?.active === true,
        evict: () => {
          if (sessions.get(threadId)?.session === session) sessions.delete(threadId);
          return session.close().then(() => usage().stopped ?? usage().pids.every(pid => {
            try { process.kill(pid, 0); return false; } catch { return true; }
          }));
        },
      });
      if (row.active) row.budget.active(); else row.budget.idle();
    },
    /** Keep the session for the next turn of this thread; do not close. */
    keep(
      threadId: string,
      session: ChatToolSession,
      fingerprint: string,
      meta?: { person?: string; prewarmed?: boolean; active?: boolean },
    ): void {
      this.set(threadId, fingerprint, session, meta);
    },
    /** Mark a kept session as taken by a real turn (no longer a waiting prewarm). */
    claim(threadId: string): void {
      const row = sessions.get(threadId);
      if (!row) return;
      row.prewarmed = false;
      row.active = true;
      row.session.detachAbort?.();
      row.budget?.active();
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
      if (sessions.get(turn.threadId)?.active) return "skipped";
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
      const person = turn.principalId ?? opts.person ?? warmResourcePerson(turn);
      if (this.get(turn.threadId, fingerprint, person)) {
        sessions.get(turn.threadId)?.budget?.touch();
        if (opts.person) {
          const row = sessions.get(turn.threadId);
          if (row && !row.person) row.person = opts.person;
        }
        return "kept";
      }
      if (person) {
        const waiting = prewarmedFor(person);
        if (waiting.length >= maxPerPerson && !waiting.includes(turn.threadId)) {
          // Drop the oldest waiting prewarm of this person so a new open can mount.
          const oldest = waiting[0]!;
          await evict(oldest);
        }
      }
      try {
        const before = sessions.get(turn.threadId);
        if (before?.active) return "skipped";
        const session = await (options?.mount ?? mountChatTools)(
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
        // A real turn or newer prewarm may have installed its mount while
        // this handshake was waiting. Never replace its resources.
        if (sessions.get(turn.threadId) !== before || sessions.get(turn.threadId)?.active) {
          await session.close().catch(() => {});
          return "skipped";
        }
        this.keep(turn.threadId, session, fingerprint, {
          person,
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
