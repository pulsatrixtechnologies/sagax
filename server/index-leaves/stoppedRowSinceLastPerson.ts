// @ts-nocheck
/** stoppedRowSinceLastPerson (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStoppedRowSinceLastPerson(getHost: () => Host): any {
function stoppedRowSinceLastPerson(threadId: string, turnId: string | undefined) {
  const host = getHost();

  const rows = host.store.messagesFor(threadId);
  for (let i = rows.length - 1; i >= 0 && i >= rows.length - 40; i -= 1) {
    const row = rows[i]!;
    if (row.kind === "activity" && row.tool?.name === host.STOPPED_TURN_NAME && row.turnId === turnId) return true;
    if (row.role === "user") return false;
  }
  return false;

}
  return stoppedRowSinceLastPerson;
}
