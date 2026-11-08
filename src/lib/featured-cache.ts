// Stale-while-revalidate copy of the reviewed plugin catalog (GET
// /api/plugins/search?registry=0), so the Plugins page draws its catalog rows
// at once on every open after the first (JC 2026-11-06: 3 s before anything
// but Tailscale showed). The network answer replaces it.
import type { FeaturedListing } from "@/components/PluginsPanel.tsx-parts/types";

const KEY = "sagax.plugins.featured.v1";

export function readFeaturedCache(): FeaturedListing[] | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as FeaturedListing[]) : null;
  } catch { return null; }
}

export function writeFeaturedCache(featured: FeaturedListing[]): void {
  try {
    if (featured.length > 0) window.localStorage.setItem(KEY, JSON.stringify(featured));
  } catch { /* storage unavailable: the page works without it */ }
}
