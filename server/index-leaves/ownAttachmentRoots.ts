// @ts-nocheck
/** ownAttachmentRoots (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOwnAttachmentRoots(getHost: () => Host): any {
function ownAttachmentRoots(bot: BotRecord, threadId: string): Array<{ server: string; path: string; platform: "darwin" | "win32" | "linux" }> {
  const host = getHost();

  const workplace = host.turnWorkplaces.get(threadId);
  if (workplace?.botId !== bot.id) return [];
  const person = workplace.decision.principal;
  if (!person) return [];
  const roots: Array<{ server: string; path: string; platform: "darwin" | "win32" | "linux" }> = [];
  const mounted = workplace.ownEnvironmentServers ?? new Set<string>();
  if (mounted.has(host.DESKTOP_BRIDGE_MCP_NAME)) {
    const desktop = host.desktopBridges.current(person);
    // Security review 2026-10-19: only a folder shaped like the app's own
    // (<temp>/Sagax/attachments, electron/main.mjs), never a root or a home
    // folder a modified client could report.
    const folder = desktop?.attachmentsDir ? normalizedDestinationPath(desktop.attachmentsDir, desktop.platform) : null;
    if (desktop && folder && /\/sagax\/attachments$/i.test(folder) && folder.split("/").length >= 4) {
      roots.push({ server: host.DESKTOP_BRIDGE_MCP_NAME, path: desktop.attachmentsDir, platform: desktop.platform });
    }
  }
  if (mounted.has(USER_SANDBOX_MCP_NAME)) roots.push({ server: USER_SANDBOX_MCP_NAME, path: host.SANDBOX_ATTACHMENTS_DIR, platform: "linux" });
  return roots;

}
  return ownAttachmentRoots;
}
