// The order of bots inside a sidebar team, per person
// (`sagax.sectionBotOrder.v1`, #5024). A team name maps to bot ids, first
// to last. Bots with no saved place keep their current order after the
// ones that have one. The value follows the person (shared/user-preferences.ts).
import { useSyncExternalStore } from "react";

export const SECTION_BOT_ORDER_KEY = "sagax.sectionBotOrder.v1";

export type SectionBotOrder = Record<string, string[]>;

const EMPTY: SectionBotOrder = {};

export function parseSectionBotOrder(raw: string | null | undefined): SectionBotOrder {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return EMPTY;
    const out: SectionBotOrder = {};
    for (const [name, ids] of Object.entries(parsed)) {
      const team = name.trim();
      if (!team || !Array.isArray(ids)) continue;
      const clean = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
      if (clean.length) out[team] = clean;
    }
    return out;
  } catch {
    return EMPTY;
  }
}

/** Puts `id` in `section`, before `beforeId` (or at the end), and takes it
 * out of every other team. `present` is the team's bots as they are shown
 * now, so a first drag lands between them instead of jumping to the front. */
export function placeBotInSection(order: SectionBotOrder, section: string, id: string, beforeId: string | null, present: readonly string[] = []): SectionBotOrder {
  const team = section.trim();
  if (!team || !id) return order;
  const cleared: SectionBotOrder = {};
  for (const [name, ids] of Object.entries(order)) {
    const rest = ids.filter((item) => item !== id);
    if (rest.length) cleared[name] = rest;
  }
  const known = cleared[team] ?? [];
  const base = (present.length ? orderedBots(present.map((item) => ({ id: item })), known).map((item) => item.id) : known).filter((item) => item !== id);
  const index = beforeId && beforeId !== id ? base.indexOf(beforeId) : -1;
  const next = index < 0 ? [...base, id] : [...base.slice(0, index), id, ...base.slice(index)];
  return { ...cleared, [team]: next };
}

/** The bot the pointer is dropping in front of, or null to land at the end.
 * The row under the pointer, and the half of that row, decide. */
export function dropAnchor(target: EventTarget | null, clientY: number, draggedId: string): string | null {
  if (!(target instanceof Element)) return null;
  const row = target.closest("[data-sidebar-bot-row]");
  if (!row) return null;
  const id = row.getAttribute("data-sidebar-bot-row");
  if (!id || id === draggedId) return null;
  const rect = row.getBoundingClientRect();
  if (clientY <= rect.top + rect.height / 2) return id;
  const wrapper = row.closest("[data-sidebar-item-drag]") ?? row.parentElement;
  const following = wrapper?.nextElementSibling?.querySelector("[data-sidebar-bot-row]");
  const nextId = following?.getAttribute("data-sidebar-bot-row");
  return nextId && nextId !== draggedId ? nextId : null;
}

/** Where the insertion line sits while a bot is dragged inside a team (#5392):
 * `beforeId` is the bot the line sits above, or null for a line under the last. */
export type BotDropLine = { sectionId: string; beforeId: string | null };

export function botDropLineAt(
  sectionId: string,
  target: EventTarget | null,
  clientY: number,
  draggedId: string,
  present: readonly string[],
): BotDropLine | null {
  if (!sectionId.trim() || !draggedId || present.length === 0) return null;
  const others = present.filter((id) => id !== draggedId);
  if (!others.length) return null;
  if (!target || typeof (target as Element).closest !== "function") return { sectionId, beforeId: null };
  const row = (target as Element).closest("[data-sidebar-bot-row]");
  if (!row || !row.closest("[data-sidebar-nest]")) {
    // over the section but not a row: land at the end
    return { sectionId, beforeId: null };
  }
  const beforeId = dropAnchor(target, clientY, draggedId);
  return { sectionId, beforeId };
}

/** Saved ids first, in that order. Everyone else keeps the order they arrived in. */
export function orderedBots<T extends { id: string }>(bots: readonly T[], saved: readonly string[] | undefined): T[] {
  if (!saved?.length) return [...bots];
  const rank = new Map(saved.map((id, index) => [id, index]));
  return [...bots].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

let session: SectionBotOrder | null = null;
let cachedRaw: string | null | undefined;
let cached: SectionBotOrder = EMPTY;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export function readSectionBotOrder(): SectionBotOrder {
  if (session) return session;
  let raw: string | null = null;
  try { raw = storage()?.getItem(SECTION_BOT_ORDER_KEY) ?? null; } catch { raw = null; }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parseSectionBotOrder(raw);
  }
  return cached;
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== SECTION_BOT_ORDER_KEY && event.key !== null) return;
  session = null;
  cachedRaw = undefined;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function writeSectionBotOrder(next: SectionBotOrder): void {
  session = next;
  try {
    storage()?.setItem(SECTION_BOT_ORDER_KEY, JSON.stringify(next));
    session = null;
  } catch {
    // Storage refused: the order holds for this session.
  }
  notify();
}

export function useSectionBotOrder(): SectionBotOrder {
  return useSyncExternalStore(subscribe, readSectionBotOrder, () => EMPTY);
}
