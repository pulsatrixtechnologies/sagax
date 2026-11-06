// @ts-nocheck
/** lastAutoPlace (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLastAutoPlace(getHost: () => Host): any {
function lastAutoPlace(threadId: string) {
  const host = getHost();

  const messages = host.store.messagesFor(threadId);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.kind !== "activity" || !message.tool) continue;
    const line = host.parseWorkspaceLine(message.tool.name);
    if (line) return line.target;
    const switched = message.tool.ok === true ? host.computerSelectTarget(message.tool.name, message.tool.input) : null;
    if (switched) return switched;
  }
  return null;

}
  return lastAutoPlace;
}
