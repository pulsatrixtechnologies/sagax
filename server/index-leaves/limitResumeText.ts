// @ts-nocheck
/** limitResumeText (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLimitResumeText(getHost: () => Host): any {
function limitResumeText(threadId: string, turnId: string, text: string) {
  const host = getHost();

  const rows = host.store.messagesFor(threadId).filter((message) => message.turnId === turnId && message.role === "bot");
  const steps: RenewalStep[] = rows
    .filter((message) => message.kind === "activity" && message.tool && host.failedTurnCause(message.tool.name) === null &&
      !host.isTechnicalNoticeName(message.tool.name) && !message.tool.name.startsWith("recovery:"))
    .map((message) => ({
      name: message.tool!.name,
      ...(message.tool!.input ? { summary: message.tool!.input } : {}),
      ...(message.tool!.ok !== undefined ? { ok: message.tool!.ok } : {}),
      ...(message.tool!.output ? { output: message.tool!.output } : {})
    }));
  const lastText = rows.findLast((message) => message.kind === "text")?.text;
  if (!steps.length && !lastText?.trim()) return text;
  return host.renewalPrompt({ base: text, steps, ...(lastText ? { lastText } : {}), cause: "limit" });

}
  return limitResumeText;
}
