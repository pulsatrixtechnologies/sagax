// @ts-nocheck
/** workplaceNoteText (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createWorkplaceNoteText(getHost: () => Host): any {
function workplaceNoteText(text: string, decision: WorkplaceDecision, auto?: AutoComputerState | null) {
  void getHost();

  if (auto?.auto) return `${text}\n\n${autoComputerGuidance(auto, Boolean(decision.principal && desktopBridges.connected(decision.principal)))}`;
  if (decision.target === "user-desktop" && decision.reason === "desktop") {
    return `${text}\n\n<workplace>Your ${DESKTOP_BRIDGE_MCP_NAME} tools run on this person's own computer, through their Sagax desktop app: their files, apps, network and Local VM, as if you were on their machine.</workplace>`;
  }
  if (decision.target === "user-desktop" && decision.reason === "pinned-desktop") {
    return `${text}\n\n<workplace>This bot works on this person's own computer (Workspace: Local VM or This computer), but their Sagax desktop app is not connected, so you have no computer this turn. Tell them to open the Sagax app on their computer, signed in to this server, or to set Workspace to Cloud to use their server environment.</workplace>`;
  }
  if (decision.fallback && decision.target === "user-sandbox") {
    return `${text}\n\n<workplace>This person's computer is not connected (their Sagax desktop app is closed or signed out), so your tools run in their server environment instead. Their own files and local network are not reachable from there; tell them so if they ask for them.</workplace>`;
  }
  return text;

}
  return workplaceNoteText;
}
