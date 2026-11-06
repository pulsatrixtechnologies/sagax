// @ts-nocheck
/** primaryAskedProposal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPrimaryAskedProposal(getHost: () => Host): any {
function primaryAskedProposal(input: { botId: string; threadId: string; generation: string; quote: unknown; targetBotId: string; key: string; value?: unknown; routineName?: string; valueNames?: string[] }): { botName: string; messageId: string; person: string; quote: string } | string {
  const host = getHost();

  if (input.quote === undefined) return "no quote";
  const gate = host.primaryTurnGate(input.botId, input.threadId, input.generation, "settings");
  if ("error" in gate) return gate.error;
  const check = host.checkPersonQuote({ quote: input.quote, message: gate.message.text, intent: "setting" });
  if (!check.ok) return check.reason;
  const from = host.store.bot(input.botId);
  const target = host.store.bot(input.targetBotId);
  if (!from || !target) return "that bot no longer exists";
  if (!host.primaryBotSameOwner(from, target)) return "that bot belongs to someone else; a Primary Bot changes only its own person's bots";
  const asked = host.askedBotChange({
    key: input.key, family: input.key.split(".")[0] ?? "bot", value: input.value, quote: String(input.quote),
    names: [target.name, input.routineName], speakingBot: target.id === from.id, speakingName: from.name, message: gate.message.text,
    ...(input.valueNames ? { valueNames: input.valueNames } : {})
  });
  return asked === true ? { botName: gate.botName, messageId: gate.message.id, person: gate.person, quote: String(input.quote) } : asked;

}
  return primaryAskedProposal;
}
