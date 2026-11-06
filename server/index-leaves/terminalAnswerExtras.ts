// @ts-nocheck
/** terminalAnswerExtras (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTerminalAnswerExtras(getHost: () => Host): any {
function terminalAnswerExtras(body: Record<string, unknown>): { pick?: TerminalDestinationPick; cols?: number; rows?: number } {
  const host = getHost();

  const pick = host.parseTerminalDestinationPick(body.terminalDestination);
  const size = body.terminalSize && typeof body.terminalSize === "object" ? body.terminalSize as { cols?: unknown; rows?: unknown } : null;
  const cols = Number(size?.cols);
  const rows = Number(size?.rows);
  const sized = Number.isInteger(cols) && Number.isInteger(rows) && cols >= 2 && cols <= 1000 && rows >= 1 && rows <= 500;
  return { ...(pick ? { pick } : {}), ...(sized ? { cols, rows } : {}) };

}
  return terminalAnswerExtras;
}
