// @ts-nocheck
/** bridgeTerminal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBridgeTerminal(getHost: () => Host): any {
async function bridgeTerminal(ctx: { principalId: string; botId?: string; threadId?: string; cols: number; rows: number }, target: "desktop" | "vm") {
  const host = getHost();

  const detail = target === "vm" ? "vm_terminal_open" : "terminal_open";
  try {
    const attachment = await host.desktopTerminals.open(ctx.principalId, target, host.terminalSize(ctx));
    host.bridgeAudit.record({ person: ctx.principalId, botId: ctx.botId, threadId: ctx.threadId, target: "user-desktop", kind: "tool", detail, ok: true });
    return attachment;
  } catch (error) {
    host.bridgeAudit.record({ person: ctx.principalId, botId: ctx.botId, threadId: ctx.threadId, target: "user-desktop", kind: "tool", detail, ok: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }

}
  return bridgeTerminal;
}
