/** Keep-alive HTTP(S) fetch for MCP and Perspicax: one undici Agent per
 * origin so a turn's RPCs reuse the TCP (and TLS) connection. Default
 * Node fetch already pools a little; pinning an Agent makes the pool
 * explicit, bounded, and shared by RemoteMcpClient and PerspicaxMcp. */
import { Agent, fetch as undiciFetch, type RequestInfo, type RequestInit as UndiciRequestInit } from "undici";

const agents = new Map<string, Agent>();

/** How long an idle pooled socket stays open (under Perspicax's 2-minute
 * session keep-alive, and long enough for a warm engine's next turn). */
const KEEP_ALIVE_TIMEOUT_MS = 60_000;
/** Soft cap on concurrent connections per origin. pipelining must stay
 * >= 1 or undici opens a fresh socket per request (measured). */
const CONNECTIONS_PER_ORIGIN = 4;

function originOf(input: RequestInfo): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

function agentFor(origin: string): Agent {
  let agent = agents.get(origin);
  if (!agent) {
    agent = new Agent({
      keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
      keepAliveMaxTimeout: KEEP_ALIVE_TIMEOUT_MS,
      connections: CONNECTIONS_PER_ORIGIN,
      // pipelining: 0 disables keep-alive entirely in undici 7.
      pipelining: 1,
    });
    agents.set(origin, agent);
  }
  return agent;
}

/** fetch that reuses a keep-alive Agent for the request's origin. */
export function keepAliveFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const agent = agentFor(originOf(input));
  const next: UndiciRequestInit = { ...(init as UndiciRequestInit | undefined), dispatcher: agent };
  return undiciFetch(input, next) as unknown as Promise<Response>;
}

/** Drop every pooled Agent (tests, shutdown). In-flight requests fail. */
export async function closeKeepAliveAgents(): Promise<void> {
  const closing = [...agents.values()].map((agent) => agent.close());
  agents.clear();
  await Promise.all(closing);
}

/** How many origins currently hold an Agent (tests). */
export function keepAliveAgentCount(): number {
  return agents.size;
}
