// A person's own sidebar sections on an organization server: folders that
// organize THEIR sidebar and nothing else. A section shares nothing (a bot
// is shared from its own panel, a group has its own people); nobody else
// sees another person's sections, and putting a bot, a group or a
// conversation with someone in one changes nothing for anybody.
//
// Stored in localStorage under PERSONAL_SECTIONS_KEY, one of the keys that
// follow the person to every device (shared/user-preferences.ts, synced
// through /api/me/preferences). Order and collapse stay in the sidebar
// layout keys (sidebar-preferences.ts). On a solo server the sidebar keeps
// the server's own sections (bot.section, group.section): one person.
//
// What is in no section shows in Unassigned, at the top: nothing disappears
// because it has no section. Deleting a section frees its items (they go
// back to Unassigned); it never deletes a bot, a group or a conversation.
import { useSyncExternalStore } from "react";
import { z } from "zod";

import { MAX_PREFERENCE_VALUE } from "../../shared/user-preferences";

export const PERSONAL_SECTIONS_KEY = "sagax.sidebarSections.v1";

/** A bot (bot id) or a group (group id, a conversation with people included). */
export type SectionItemKind = "bot" | "group";

export interface PersonalSection {
  name: string;
  /** `bot:<id>` and `group:<id>` keys. */
  items: string[];
}

export interface PersonalSections {
  sections: PersonalSection[];
}

export const EMPTY_PERSONAL_SECTIONS: PersonalSections = Object.freeze({ sections: [] }) as unknown as PersonalSections;

export type SectionEditError = "bad_name" | "reserved" | "exists" | "missing" | "full";
export type SectionEditResult = { ok: true; prefs: PersonalSections } | { ok: false; code: SectionEditError };

const schema = z.object({
  sections: z.array(z.object({
    name: z.string(),
    items: z.array(z.string().min(1).max(220)).catch([]),
  })),
});

/** Unassigned holds what is in no section: its names are not section names. */
const RESERVED = new Set(["general", "général", "generale", "sans section", "unassigned", "no section", "non assigné", "não atribuído"]);

export function itemKey(kind: SectionItemKind, id: string): string {
  return `${kind}:${id}`;
}

export function isReservedSectionName(name: string): boolean {
  return RESERVED.has(name.trim().toLowerCase());
}

/** 1 to 60 characters, no control characters. */
export function validPersonalSectionName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 60 && ![...trimmed].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

/** The stored value, or null when the person has none yet (not seeded). */
export function parsePersonalSections(raw: string | null | undefined): PersonalSections | null {
  if (!raw) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const names = new Set<string>();
    const placed = new Set<string>();
    const sections: PersonalSection[] = [];
    for (const section of parsed.data.sections) {
      const name = section.name.trim();
      if (!validPersonalSectionName(name) || isReservedSectionName(name) || names.has(name)) continue;
      names.add(name);
      // An item sits in one section at most: the first one wins.
      const items = section.items.filter((key) => !placed.has(key) && /^(bot|group):./.test(key));
      for (const key of items) placed.add(key);
      sections.push({ name, items });
    }
    return { sections };
  } catch {
    return null;
  }
}

export function serializePersonalSections(prefs: PersonalSections): string {
  return JSON.stringify({ sections: prefs.sections });
}

/** Whether the value still fits one preference (the server drops a bigger one). */
export function fitsPreference(prefs: PersonalSections): boolean {
  return serializePersonalSections(prefs).length <= MAX_PREFERENCE_VALUE;
}

export function personalSectionNames(prefs: PersonalSections): string[] {
  return prefs.sections.map((section) => section.name);
}

export function personalSectionOf(prefs: PersonalSections, key: string): string | undefined {
  return prefs.sections.find((section) => section.items.includes(key))?.name;
}

function checkName(prefs: PersonalSections, name: string, except?: string): SectionEditError | null {
  if (!validPersonalSectionName(name)) return "bad_name";
  if (isReservedSectionName(name)) return "reserved";
  if (prefs.sections.some((section) => section.name === name.trim() && section.name !== except)) return "exists";
  return null;
}

function done(prefs: PersonalSections): SectionEditResult {
  return fitsPreference(prefs) ? { ok: true, prefs } : { ok: false, code: "full" };
}

export function createPersonalSection(prefs: PersonalSections, name: string): SectionEditResult {
  const error = checkName(prefs, name);
  if (error) return { ok: false, code: error };
  return done({ sections: [...prefs.sections, { name: name.trim(), items: [] }] });
}

export function renamePersonalSection(prefs: PersonalSections, from: string, to: string): SectionEditResult {
  if (!prefs.sections.some((section) => section.name === from)) return { ok: false, code: "missing" };
  const error = checkName(prefs, to, from);
  if (error) return { ok: false, code: error };
  return done({ sections: prefs.sections.map((section) => (section.name === from ? { ...section, name: to.trim() } : section)) });
}

/** Removes the section; its items go back to Unassigned. */
export function deletePersonalSection(prefs: PersonalSections, name: string): PersonalSections {
  return { sections: prefs.sections.filter((section) => section.name !== name) };
}

/** Puts an item in a section (created when new), or back in Unassigned with "".
 * `known` prunes keys of items that no longer exist when the value is full. */
export function assignToPersonalSection(prefs: PersonalSections, key: string, name: string, known?: ReadonlySet<string>): SectionEditResult {
  const target = name.trim();
  let sections = prefs.sections.map((section) => (section.items.includes(key) ? { ...section, items: section.items.filter((item) => item !== key) } : section));
  if (target) {
    if (!sections.some((section) => section.name === target)) {
      const error = checkName({ sections }, target);
      if (error) return { ok: false, code: error };
      sections = [...sections, { name: target, items: [] }];
    }
    sections = sections.map((section) => (section.name === target ? { ...section, items: [...section.items, key] } : section));
  }
  const next = { sections };
  if (fitsPreference(next) || !known) return done(next);
  return done({ sections: sections.map((section) => ({ ...section, items: section.items.filter((item) => item === key || known.has(item)) })) });
}

interface SeedBot { id: string; section?: string | undefined; ownerUserId?: string | undefined; hidden?: boolean | undefined }
interface SeedGroup { id: string; section?: string | undefined; dm?: unknown }

/** The first value for a person who never had one: their own bots and the
 * rooms they see keep the section the server gave them (bots shared by
 * someone else start in Unassigned: their owner's sections are the owner's). */
export function seedPersonalSections(input: { bots: readonly SeedBot[]; groups: readonly SeedGroup[]; sections: readonly string[]; viewerId: string }): PersonalSections {
  const me = input.viewerId.trim().toLowerCase();
  const own = (bot: SeedBot) => {
    const owner = bot.ownerUserId?.trim().toLowerCase();
    return !owner || owner === "local-owner" || owner === me;
  };
  const placed: Array<[string, string]> = [];
  for (const bot of input.bots) {
    const name = bot.section?.trim();
    if (name && own(bot)) placed.push([name, itemKey("bot", bot.id)]);
  }
  // #2045 isolation: a room's section is its owner's team. Only a name the
  // server lists for this viewer (their own teams) is copied; an admin who
  // sees other people's rooms never inherits their team names.
  const mine = new Set(input.sections.map((name) => name.trim()));
  for (const group of input.groups) {
    const name = group.section?.trim();
    if (name && !group.dm && mine.has(name)) placed.push([name, itemKey("group", group.id)]);
  }
  const used = new Set(placed.map(([name]) => name));
  const order = [...input.sections.map((name) => name.trim()).filter((name) => used.has(name)), ...placed.map(([name]) => name)];
  const sections: PersonalSection[] = [];
  for (const name of order) {
    if (sections.some((section) => section.name === name) || !validPersonalSectionName(name) || isReservedSectionName(name)) continue;
    sections.push({ name, items: placed.filter(([section]) => section === name).map(([, key]) => key) });
  }
  const seeded = { sections };
  // Too much to carry: start with the names only.
  return fitsPreference(seeded) ? seeded : { sections: sections.map((section) => ({ name: section.name, items: [] })) };
}

/** The sidebar's view: each bot and group carries the viewer's own section
 * (undefined: Unassigned), whatever the server says. Personal folders are
 * name-only (#2045): a leftover server `sectionId` would pull the bot back
 * into the owner's team column after #2083, so the overlay clears it. */
export function withPersonalSections<
  B extends { id: string; section?: string | undefined; sectionId?: string | undefined },
  G extends { id: string; section?: string | undefined; sectionId?: string | undefined },
>(bots: readonly B[], groups: readonly G[], prefs: PersonalSections): { bots: B[]; groups: G[] } {
  const where = new Map<string, string>();
  for (const section of prefs.sections) for (const key of section.items) where.set(key, section.name);
  const place = <T extends { id: string; section?: string | undefined; sectionId?: string | undefined }>(item: T, kind: SectionItemKind): T => {
    const section = where.get(itemKey(kind, item.id));
    if (item.section === section && item.sectionId === undefined) return item;
    return { ...item, section, sectionId: undefined };
  };
  return { bots: bots.map((bot) => place(bot, "bot")), groups: groups.map((group) => place(group, "group")) };
}

// ── the page's store ─────────────────────────────────────────────────────

let session: PersonalSections | null = null;
let cachedRaw: string | null | undefined;
let cachedValue: PersonalSections | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The person's sections, or null when they have none stored yet. */
export function readPersonalSections(): PersonalSections | null {
  if (session) return session;
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(PERSONAL_SECTIONS_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parsePersonalSections(raw);
  }
  return cachedValue;
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== PERSONAL_SECTIONS_KEY && event.key !== null) return;
  session = null;
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

export function writePersonalSections(next: PersonalSections): void {
  session = next;
  try {
    storage()?.setItem(PERSONAL_SECTIONS_KEY, serializePersonalSections(next));
    session = null;
  } catch {
    // Storage refused: the layout holds for this session.
  }
  notify();
}

/** Applies an edit to the stored value (empty when none yet); the error
 * code when it was refused. */
export function editPersonalSections(edit: (prefs: PersonalSections) => SectionEditResult): SectionEditError | null {
  const result = edit(readPersonalSections() ?? EMPTY_PERSONAL_SECTIONS);
  if (!result.ok) return result.code;
  writePersonalSections(result.prefs);
  return null;
}

export function usePersonalSections(): PersonalSections | null {
  return useSyncExternalStore(subscribe, readPersonalSections, () => null);
}
