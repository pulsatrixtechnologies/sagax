// @ts-nocheck
/** bodyForThreadViewer (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBodyForThreadViewer(getHost: () => Host): any {
function bodyForThreadViewer(body: unknown, viewerId: string) {
  const host = getHost();

  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const narrow = (value: unknown, depth: number): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    let out: Record<string, unknown> | null = null;
    for (const [field, child] of Object.entries(record)) {
      let next = child;
      if (field === "bot" && child && typeof child === "object" && !Array.isArray(child)) next = host.botForViewer(child as Record<string, unknown>, viewerId);
      else if (field === "bots" && Array.isArray(child)) {
        next = child.map((bot) => (bot && typeof bot === "object" && !Array.isArray(bot) ? host.botForViewer(bot as Record<string, unknown>, viewerId) : bot));
      } else if (depth > 0 && field !== "messages" && child && typeof child === "object" && !Array.isArray(child)) next = narrow(child, depth - 1);
      if (next !== child) (out ??= { ...record })[field] = next;
    }
    return out ?? record;
  };
  return narrow(body, 1);

}
  return bodyForThreadViewer;
}
