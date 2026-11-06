// @ts-nocheck
/** projectMessages (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createProjectMessages(getHost: () => Host): any {
function projectMessages<T>(threadId: string, messages: T[], viewer: ApprovalViewer): T[]{
  const host = getHost();

  let changed = false;
  if (messages.some((message) => host.privateRowHidden(message, viewer))) {
    messages = messages.filter((message) => !host.privateRowHidden(message, viewer));
    changed = true;
  }
  if (messages.some((message) => (message as { kind?: unknown } | null)?.kind === "routines")) {
    messages = messages.flatMap((message) => {
      const shown = host.routineToggleForApprovalViewer(message, viewer);
      if (shown !== message) changed = true;
      return shown === null ? [] : [shown];
    });
  }
  const next = messages.map((message) => {
    const projected = host.markDeadThreadChip(host.scopeApprovalMessage(threadId, message, viewer), host.threadStillExists);
    if (projected !== message) changed = true;
    return projected;
  });
  return changed ? next : messages;

}
  return projectMessages;
}
