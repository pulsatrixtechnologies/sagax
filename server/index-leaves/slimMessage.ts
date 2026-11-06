// @ts-nocheck
/** slimMessage (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSlimMessage(getHost: () => Host): any {
function slimMessage(message: Message) {
  const host = getHost();

  // a ConnectWise widget stored on an ordinary read before 2026-10-20 stays a
  // row for every client, phone builds included (shared/cw-widgets/tool-call.ts)
  if (message.tool?.widget && !host.isCwViewTool(message.tool.name)) {
    const { widget: _widget, ...tool } = message.tool;
    return { ...message, tool };
  }
  if (message.kind !== "screen" || !message.png) return message;
  const { png: _png, ...rest } = message;
  return { ...rest, hasImage: true };

}
  return slimMessage;
}
