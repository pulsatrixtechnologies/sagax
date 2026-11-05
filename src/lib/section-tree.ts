// Sub-teams (#2045): a team may sit under another team. The Team map and the
// sidebar read the same parent links, so a sub-team shows nested in both.
//
// The links are the person's own (one more key that follows them to every
// device, shared/user-preferences.ts): a team is a name in that person's
// sections, so its place in a tree is theirs too. Nothing on the server
// changes when a team is nested, moved or detached.
//
// A link names the child and its parent by team name. A link whose parent is
// gone is ignored (the team shows at the top level); deleting a team hands its
// sub-teams to its own parent; renaming one follows its links.
import { useSyncExternalStore } from "react";
import { z } from "zod";

import { MAX_PREFERENCE_VALUE } from "../../shared/user-preferences";

export const SECTION_PARENTS_KEY = "sagax.sectionParents.v1";
/** How deep sub-teams nest: a team, its sub-team and two more levels. */
export const MAX_SECTION_DEPTH = 4;

export interface SectionParents {
  /** child team name -> parent team name */
  parents: Record<string, string>;
}

export const EMPTY_SECTION_PARENTS: SectionParents = Object.freeze({ parents: Object.freeze({}) }) as SectionParents;

export type SectionParentError = "self" | "cycle" | "depth" | "missing" | "full";
export type SectionParentResult = { ok: true; value: SectionParents } | { ok: false; code: SectionParentError };

const schema = z.object({ parents: z.record(z.string().min(1).max(60), z.string().min(1).max(60)) });

export function parseSectionParents(raw: string | null | undefined): SectionParents | null {
  if (!raw) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const parents: Record<string, string> = {};
    for (const [child, parent] of Object.entries(parsed.data.parents)) {
      if (child.trim() && parent.trim() && child.trim() !== parent.trim()) parents[child.trim()] = parent.trim();
    }
    return { parents };
  } catch {
    return null;
  }
}

/** The parent of a team among the names that exist, or undefined. */
export function parentOf(tree: SectionParents, name: string, names?: ReadonlySet<string>): string | undefined {
  const parent = tree.parents[name];
  if (!parent || (names && !names.has(parent))) return undefined;
  return parent;
}

/** The chain from a team up to its top-level ancestor (the team excluded). */
export function ancestorsOf(tree: SectionParents, name: string, names?: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const seen = new Set([name]);
  let current = parentOf(tree, name, names);
  while (current && !seen.has(current)) {
    out.push(current);
    seen.add(current);
    current = parentOf(tree, current, names);
  }
  return out;
}

/** How many levels of sub-teams hang below a team (0 when none). */
function heightOf(tree: SectionParents, name: string, seen = new Set<string>()): number {
  if (seen.has(name)) return 0;
  seen.add(name);
  let height = 0;
  for (const [child, parent] of Object.entries(tree.parents)) {
    if (parent === name) height = Math.max(height, 1 + heightOf(tree, child, seen));
  }
  return height;
}

/** Puts a team under another one ("" or undefined detaches it). Refuses a
 * loop, a tree deeper than MAX_SECTION_DEPTH and a parent that is not a team. */
export function setSectionParent(tree: SectionParents, child: string, parent: string | undefined, names: ReadonlySet<string>): SectionParentResult {
  const key = child.trim();
  const target = parent?.trim() ?? "";
  const parents = { ...tree.parents };
  if (!target) {
    delete parents[key];
    return { ok: true, value: { parents } };
  }
  if (target === key) return { ok: false, code: "self" };
  if (!names.has(target) || !names.has(key)) return { ok: false, code: "missing" };
  if (ancestorsOf(tree, target, names).includes(key)) return { ok: false, code: "cycle" };
  const depth = ancestorsOf(tree, target, names).length + 2 + heightOf(tree, key);
  if (depth > MAX_SECTION_DEPTH) return { ok: false, code: "depth" };
  parents[key] = target;
  const value = { parents };
  if (!fitsSectionParents(value)) return { ok: false, code: "full" };
  return { ok: true, value };
}

/** A renamed team keeps its parent and its sub-teams. */
export function renameInSectionTree(tree: SectionParents, from: string, to: string): SectionParents {
  const parents: Record<string, string> = {};
  for (const [child, parent] of Object.entries(tree.parents)) {
    parents[child === from ? to : child] = parent === from ? to : parent;
  }
  return { parents };
}

/** A deleted team's sub-teams move up to its own parent (or the top). */
export function removeFromSectionTree(tree: SectionParents, name: string): SectionParents {
  const grand = tree.parents[name];
  const parents: Record<string, string> = {};
  for (const [child, parent] of Object.entries(tree.parents)) {
    if (child === name) continue;
    if (parent !== name) parents[child] = parent;
    else if (grand && grand !== child) parents[child] = grand;
  }
  return { parents };
}

export interface SectionTreeRow {
  name: string;
  depth: number;
  parent?: string;
}

/** The teams in tree order: each parent, then its sub-teams, keeping the
 * order given for siblings. Names not in `names` never appear. */
export function orderSectionTree(names: readonly string[], tree: SectionParents): SectionTreeRow[] {
  const known = new Set(names);
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const name of names) {
    const parent = parentOf(tree, name, known);
    const looped = parent !== undefined && ancestorsOf(tree, name, known).includes(name);
    if (!parent || looped) roots.push(name);
    else children.set(parent, [...(children.get(parent) ?? []), name]);
  }
  const out: SectionTreeRow[] = [];
  const placed = new Set<string>();
  const walk = (name: string, depth: number, parent?: string) => {
    if (placed.has(name)) return;
    placed.add(name);
    out.push(parent ? { name, depth, parent } : { name, depth });
    for (const child of children.get(name) ?? []) walk(child, depth + 1, name);
  };
  for (const root of roots) walk(root, 0);
  for (const name of names) walk(name, 0);
  return out;
}

export function fitsSectionParents(value: SectionParents): boolean {
  return JSON.stringify(value).length <= MAX_PREFERENCE_VALUE;
}

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

let cachedRaw: string | null | undefined;
let cachedValue: SectionParents = EMPTY_SECTION_PARENTS;
let held: SectionParents | null = null;
const listeners = new Set<() => void>();

export function readSectionParents(): SectionParents {
  if (held) return held;
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(SECTION_PARENTS_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parseSectionParents(raw) ?? EMPTY_SECTION_PARENTS;
  }
  return cachedValue;
}

function notify() {
  for (const listener of listeners) listener();
}

export function writeSectionParents(next: SectionParents): void {
  held = next;
  try {
    storage()?.setItem(SECTION_PARENTS_KEY, JSON.stringify(next));
    held = null;
  } catch {
    // Storage refused: the tree holds for this session.
  }
  notify();
}

/** Applies an edit to the stored tree; the refusal code, or null. */
export function editSectionParents(edit: (tree: SectionParents) => SectionParentResult | SectionParents): SectionParentError | null {
  const result = edit(readSectionParents());
  if ("ok" in result) {
    if (!result.ok) return result.code;
    writeSectionParents(result.value);
    return null;
  }
  writeSectionParents(result as SectionParents);
  return null;
}

function onStorage(event: StorageEvent) {
  if (event.key !== SECTION_PARENTS_KEY && event.key !== null) return;
  held = null;
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

export function useSectionParents(): SectionParents {
  return useSyncExternalStore(subscribe, readSectionParents, () => EMPTY_SECTION_PARENTS);
}
