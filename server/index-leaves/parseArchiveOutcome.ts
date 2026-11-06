// @ts-nocheck
/** parseArchiveOutcome (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createParseArchiveOutcome(getHost: () => Host): any {
function parseArchiveOutcome(stdout: string): { extracted: boolean; reason?: string } | null {
  void getHost();

  try {
    const value = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as { extracted?: unknown; reason?: unknown };
    return { extracted: value.extracted === true, ...(typeof value.reason === "string" ? { reason: value.reason } : {}) };
  } catch {
    return null;
  }

}
  return parseArchiveOutcome;
}
