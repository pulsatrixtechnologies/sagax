// @ts-nocheck
/** scrubConfidentialThreads (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createScrubConfidentialThreads(getHost: () => Host): any {
function scrubConfidentialThreads(value: unknown, ids: ReadonlySet<string>): unknown {
  const host = getHost();
  const transcript = ["messages", "activeLeafId", "hasMore"];
  const scrub = (item: unknown): unknown => {
    if (Array.isArray(item)) {
      return item.filter((entry) => !(entry && typeof entry === "object" && !Array.isArray((entry as { tasks?: unknown }).tasks)
        && ids.has(String((entry as { threadId?: unknown }).threadId ?? "")))).map(scrub);
    }
    if (!item || typeof item !== "object") return item;
    const out: Record<string, unknown> = {};
    const record = item as Record<string, unknown>;
    const selectedConfidential = typeof record.threadId === "string" && ids.has(record.threadId) && Array.isArray(record.tasks);
    for (const [key, child] of Object.entries(record)) {
      if (selectedConfidential && (transcript.includes(key) || key === "threadId" || key === "mainThreadId")) continue;
      out[key] = scrub(child);
    }
    return out;
  };
  return scrub(value);
}
  return scrubConfidentialThreads;
}
