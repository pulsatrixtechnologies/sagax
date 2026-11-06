// @ts-nocheck
/** perspicaxSessionAlone (#1388). Pure move from server/index.ts. */
import { PERSPICAX_PROTOCOL_VERSION } from "../perspicax/perspicax-mcp.ts";
export type Host = Record<string, any>;

export function createPerspicaxSessionAlone(getHost: () => Host): any {
async function perspicaxSessionAlone<T>(
  input: { botId: string; principalId: string; threadId: string; clientName: string },
  work: (call: (tool: string, args: Record<string, unknown>) => Promise<ToolAnswer | { error: string }>) => Promise<T>,
): Promise<T |{ error: string }> {
  const host = getHost();
  const { serverVersion } = host;

  const mcp = host.perspicaxMcp;
  const live = host.store.bot(input.botId);
  if (!mcp || !live) return { error: "Perspicax is not available to this bot." };
  const { threadId } = input;
  const generation = host.randomUUID();
  try {
    const plan = await mcp.prepareTurn({
      threadId, generation, bot: { id: live.id },
      speakerPrincipalId: input.principalId, speakerOrigin: "owner-routine",
      ownerPrincipalId: host.effectiveBotOwner(live),
    });
    if (!plan.mounted.length) {
      const first = plan.unavailable[0];
      return { error: first ? `Perspicax: ${host.perspicaxUnavailableWhy(first.reason, first.detail)}` : "The Perspicax connection could not be used." };
    }
    const relay = (frame: Record<string, unknown>) => mcp.relay({ threadId, generation, botId: live.id, frame });
    await relay({ jsonrpc: "2.0", id: "artifact-init", method: "initialize", params: { protocolVersion: PERSPICAX_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: input.clientName, version: serverVersion() } } });
    await relay({ jsonrpc: "2.0", method: "notifications/initialized" });
    let sequence = 0;
    return await work(async (tool, args) => {
      sequence += 1;
      const answer = await relay({ jsonrpc: "2.0", id: `artifact-call-${sequence}`, method: "tools/call", params: { name: tool, arguments: args } });
      const body = answer.body as { error?: { message?: unknown }; result?: unknown } | undefined;
      if (!body || body.error) return { error: typeof body?.error?.message === "string" ? body.error.message : "Perspicax refused the call." };
      return host.toolResultValue(body.result);
    });
  } finally {
    await mcp.endGeneration(threadId, generation).catch(host.reportBackgroundError);
  }

}
  return perspicaxSessionAlone;
}
