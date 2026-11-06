// @ts-nocheck
/** partialAlreadyWritten (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPartialAlreadyWritten(getHost: () => Host): any {
function partialAlreadyWritten(messages: Message[], messageId: string): string {
  const host = getHost();
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return "";
  for (let cursor = messages.length - 1; cursor > index; cursor -= 1) {
    const message = messages[cursor];
    if (message && message.role === "bot" && message.kind === "text" && message.text) return message.text;
  }
  return "";
}
  return partialAlreadyWritten;
}
