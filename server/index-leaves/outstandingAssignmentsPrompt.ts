// @ts-nocheck
/** outstandingAssignmentsPrompt (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOutstandingAssignmentsPrompt(getHost: () => Host): any {
function outstandingAssignmentsPrompt(threadId: string) {
  const host = getHost();

  const pending = host.coordinator.outstandingDirect(threadId);
  if (!pending.length) return "";
  const listed = pending.map(node => ({
    requestId: node.id,
    bot: host.store.bot(node.botId)?.name ?? "Teammate",
    assignment: node.text.slice(0, 1_000),
    status: node.status === "queued" ? host.queuedStatus(node)
      : host.openPersonCard(node.threadId) ? "stopped on a card waiting for the person's approval or answer in that teammate's thread; tell the person to open it"
      : "working on it now"
  }));
  return ` Assignments you already sent are still outstanding, and nothing in this conversation cancelled them: ${JSON.stringify(listed)}. Do not resend them, do not poll or wait for them, and do not tell the user they were lost. Each result returns to this conversation on its own and resumes you then. To change or add to one, send the change to the same teammate with coordinate_bots; it runs after the current work. Answer the message above with that work still in flight.`;

}
  return outstandingAssignmentsPrompt;
}
