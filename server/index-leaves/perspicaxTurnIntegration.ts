// @ts-nocheck
/** perspicaxTurnIntegration (#1388). Pure move from server/index.ts. */
import { perspicaxUnavailableRow, PERSPICAX_UNAVAILABLE_WHY } from "../perspicax/perspicax-mcp.ts";
export type Host = Record<string, any>;

export function createPerspicaxTurnIntegration(getHost: () => Host): any {
async function perspicaxTurnIntegration(input: {
  bot: BotRecord;
  threadId: string;
  generation: string;
  speaker: TurnSpeaker;
  taken: readonly string[];
  from?: { botId: string; name: string; color: string };
  /** A call warm builds the same prompt and mounts, and writes no activity row. */
  quiet?: boolean;
  /** When setup already started prepare+handshake in parallel, reuse it. */
  prepared?: ReturnType<typeof perspicaxTurnPrepare>;
}): Promise<{ custom: Record<string, McpServerSpec>; prompt: string }> {
  const host = getHost();

  const none = { custom: {}, prompt: "" };
  const early = input.prepared ? await input.prepared : await host.perspicaxTurnPrepare(input);
  if (!early || !host.perspicaxMcp) return none;
  const { live, speakerPrincipalId, routine, plan } = early;
  // The organization's work row is written where it always was: once the
  // turn's setup reached the mounts, never for a turn cancelled before that.
  if (plan.mounted.length && !input.quiet) host.recordPerspicaxWork(live, input.threadId, input.speaker, speakerPrincipalId, ["Perspicax"]);
  const custom: Record<string, McpServerSpec> = {};
  if (plan.mounted.length) {
    let token: string;
    try {
      token = host.mintInternalCapability({
        botId: live.id,
        threadId: input.threadId,
        generation: input.generation,
        depth: 0,
        kind: "perspicax",
        skillAuthoring: false,
        createdBots: 0,
        openedThreads: 0
      });
    } catch {
      // The turn ended while the exchange ran: its generation revoke drops
      // the tokens.
      token = "";
    }
    if (token) {
      const name = "perspicax";
      host.perspicaxMcp.setMount(input.threadId, input.generation, name);
      custom[name] = {
        command: process.execPath,
        args: [host.perspicaxBridgePath],
        env: {
          ...host.AGENTS_NODE_FLAG,
          SAGAX_HARNESS_URL: `http://127.0.0.1:${host.PORT}`,
          SAGAX_PERSPICAX_TOKEN: token,
          SAGAX_BOT_ID: live.id,
          SAGAX_THREAD_ID: input.threadId
        }
      };
    }
  }
  // The calling conventions ride with the tools they are about (#1209).
  const conventions = Object.keys(custom).length > 0 ? host.PERSPICAX_CONVENTIONS_PROMPT : "";
  if (!plan.unavailable.length) return { custom, prompt: conventions };
  const lines = plan.unavailable.map((entry) => entry.reason === "no_delegation"
    ? `Perspicax tools are not available in this routine run: ${PERSPICAX_UNAVAILABLE_WHY.no_delegation}.`
    : `Perspicax tools are not available in this turn: ${host.perspicaxUnavailableWhy(entry.reason, entry.detail)}. Tell them so if they ask for these tools.`);
  const personName = (speakerPrincipalId && host.principals.byId(speakerPrincipalId)?.name) || "";
  const speakerName = routine
    ? (personName ? `a routine of ${personName}` : "a routine")
    : personName || "an unknown person";
  const byReason = new Map<PerspicaxUnavailableReason, { names: string[]; detail?: string }>();
  for (const entry of plan.unavailable) {
    const bucket = byReason.get(entry.reason) ?? { names: [] };
    bucket.names.push(entry.name);
    if (entry.detail && !bucket.detail) bucket.detail = entry.detail;
    byReason.set(entry.reason, bucket);
  }
  for (const [reason, { names, detail }] of byReason) {
    if (input.quiet) continue;
    host.store.appendMessage(input.threadId, {
      role: "bot",
      kind: "activity",
      ...(input.from ? { from: input.from } : {}),
      tool: { name: perspicaxUnavailableRow(names, speakerName, reason, detail), ok: false }
    });
  }
  // sections are concatenated as is: this one brings its own separation
  return { custom, prompt: `${conventions}\n\n${lines.join("\n")}` };

}
  return perspicaxTurnIntegration;
}
