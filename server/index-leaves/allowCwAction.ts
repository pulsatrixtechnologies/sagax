// @ts-nocheck
/** allowCwAction (#1388). Pure move from server/index.ts. */
import { cwActionInstruction } from "../../shared/cw-widgets/actions.ts";
import { cwActionLanguage } from "../widgets/cw-widget-actions.ts";
export type Host = Record<string, any>;

export function createAllowCwAction(getHost: () => Host): any {
async function allowCwAction(
  actor: PerformActor,
  threadId: string,
  messageId: string,
  card: NonNullable<Message["card"]>,
  bot: BotRecord,
  action: NonNullable<ReturnType<typeof parseCwAction>>,
  language: string | undefined = getHost().cfg.language,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const host = getHost();
  host.store.patchMessage(threadId, messageId, { card: { ...card, answered: "allow" } });
  host.cwActionPasses.grant(threadId, action);
  const text = cwActionInstruction(action, cwActionLanguage(language));
  const group = host.store.groupByThread(threadId);
  const sent = await host.performBotActRoute(actor, group
    ? { kind: "route", method: "POST", path: `/api/groups/${group.id}/messages`, body: { text: `@${bot.name} ${text}`, threadId } }
    : { kind: "route", method: "POST", path: `/api/bots/${bot.id}/messages`, body: { text, threadId } }, 8000, group ? {} : { continuation: threadId });
  if (sent.status >= 300) {
    host.cwActionPasses.revoke(threadId, action);
    host.store.patchMessage(threadId, messageId, { card });
    return { status: 502, body: { error: "The bot could not be asked to make this change. Try again." } };
  }
  return { status: 200, body: { ok: true, outcome: "allowed-once" } };
}
  return allowCwAction;
}
