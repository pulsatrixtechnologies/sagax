import { type MemoryManagerSource, type MemoryTierRow } from "@/lib/memory-manager";

export const BODY_PREFETCH = 400;

/** A Perspicax tier opened on its own: the personal tier is the source itself. */
export function tierSource(px: MemoryManagerSource, tier: MemoryTierRow): MemoryManagerSource {
  if (tier.kind === "me") return px;
  return { ...px, id: `perspicax:${tier.scope}`, name: tier.name, detail: undefined, scope: tier.scope, mayWrite: tier.mayWrite, mayManage: tier.mayManage };
}

/** Run `work` over `items`, `limit` at a time. */
export async function pooled<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await work(item);
    }
  }));
}
