// Keep chat-completions MCP mounts warm across turns of the same thread
// (perf #1953): CLI engines already do this via spawn-contract token files.
// The HTTP runtime used to spawn agents (and friends) on every turn and
// close them in finally, paying a full process cold start before first token.
import { createHash } from "node:crypto";
import type { SendTurnInput } from "../contracts.ts";
import type { ChatToolSession } from "./chat-mcp-tools.ts";
import { PERSPICAX_TOKEN_ENV, warmCommsEnv, warmPerspicaxEnv, withoutTurnTokens } from "./spawn-contract.ts";

export type WarmToolSession = {
  session: ChatToolSession;
  fingerprint: string;
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

const MAX_WARM_TOOL_SESSIONS = 64;

/** Bounded per-thread MCP session cache for createOpenAIChatRuntime. */
export function createWarmToolSessions() {
  const sessions = new Map<string, WarmToolSession>();

  const evict = async (threadId: string): Promise<void> => {
    const row = sessions.get(threadId);
    if (!row) return;
    sessions.delete(threadId);
    await row.session.close().catch(() => {});
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
    set(threadId: string, fingerprint: string, session: ChatToolSession): void {
      const previous = sessions.get(threadId);
      if (previous && previous.session !== session) void previous.session.close().catch(() => {});
      sessions.delete(threadId);
      sessions.set(threadId, { session, fingerprint });
      while (sessions.size > MAX_WARM_TOOL_SESSIONS) {
        const oldest = sessions.keys().next().value;
        if (oldest === undefined) break;
        void evict(oldest);
      }
    },
    /** Keep the session for the next turn of this thread; do not close. */
    keep(threadId: string, session: ChatToolSession, fingerprint: string): void {
      this.set(threadId, fingerprint, session);
    },
    async release(threadId: string): Promise<void> {
      await evict(threadId);
    },
    async releaseAll(): Promise<void> {
      const ids = [...sessions.keys()];
      await Promise.all(ids.map((id) => evict(id)));
    },
  };
}

export type WarmToolSessions = ReturnType<typeof createWarmToolSessions>;
