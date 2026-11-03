// The Graph settings panel of Tools > Memory > Map (2026-11-03): Filters,
// Groups, Display and Forces, as in Obsidian's graph view, remembered per
// person. One of USER_PREFERENCE_KEYS, so on an organization server it
// follows the person from device to device; the value keys each person by
// their principal id, so two people on one device keep their own graph.
// Storage may refuse reads and writes (a private window): the page then
// keeps the settings for this session only.
import { DEFAULT_FORCES, type GraphFilters, type GraphForces } from "./memory-graph";

export const MEMORY_GRAPH_PREF_KEY = "sagax.memoryGraph.v1";
const MAX_PEOPLE = 20;
const MAX_GROUPS = 12;

export type GraphColorBy = "tier" | "folder";

export interface GraphGroup {
  query: string;
  /** A #rrggbb colour. */
  color: string;
}

export interface GraphDisplay {
  arrows: boolean;
  /** -3..3: where the labels fade in. */
  textFade: number;
  /** 0.25..3 */
  nodeSize: number;
  /** 0.25..3 */
  linkThickness: number;
}

export type GraphSection = "filters" | "groups" | "display" | "forces";

export interface GraphSettings {
  filters: GraphFilters;
  colorBy: GraphColorBy;
  groups: GraphGroup[];
  display: GraphDisplay;
  forces: GraphForces;
  /** The panel and which of its sections are open. */
  open: boolean;
  sections: Record<GraphSection, boolean>;
}

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  filters: { search: "", tags: false, attachments: false, existingOnly: false, orphans: true, folders: true },
  colorBy: "tier",
  groups: [],
  display: { arrows: false, textFade: 0, nodeSize: 1, linkThickness: 1 },
  forces: { ...DEFAULT_FORCES },
  open: false,
  sections: { filters: true, groups: false, display: false, forces: false },
};

export const FORCE_RANGES: Record<keyof GraphForces, { min: number; max: number; step: number }> = {
  center: { min: 0, max: 1, step: 0.01 },
  repel: { min: 0, max: 20, step: 0.1 },
  link: { min: 0, max: 1, step: 0.01 },
  linkDistance: { min: 30, max: 500, step: 1 },
};

export const DISPLAY_RANGES = {
  textFade: { min: -3, max: 3, step: 0.1 },
  nodeSize: { min: 0.25, max: 3, step: 0.05 },
  linkThickness: { min: 0.25, max: 3, step: 0.05 },
} as const;

const HEX = /^#[0-9a-f]{6}$/i;

const num = (value: unknown, range: { min: number; max: number }, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : fallback;
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

/** Keep what this build understands; anything else falls back to the default. */
export function cleanGraphSettings(input: unknown): GraphSettings {
  const raw = record(input);
  const d = DEFAULT_GRAPH_SETTINGS;
  const filters = record(raw.filters);
  const display = record(raw.display);
  const forces = record(raw.forces);
  const sections = record(raw.sections);
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  return {
    filters: {
      search: typeof filters.search === "string" ? filters.search.slice(0, 200) : "",
      tags: bool(filters.tags, d.filters.tags),
      attachments: bool(filters.attachments, d.filters.attachments),
      existingOnly: bool(filters.existingOnly, d.filters.existingOnly),
      orphans: bool(filters.orphans, d.filters.orphans),
      folders: bool(filters.folders, d.filters.folders),
    },
    colorBy: raw.colorBy === "folder" ? "folder" : "tier",
    groups: groups
      .map(record)
      .filter((group) => typeof group.query === "string" && typeof group.color === "string" && HEX.test(group.color))
      .slice(0, MAX_GROUPS)
      .map((group) => ({ query: (group.query as string).slice(0, 200), color: (group.color as string).toLowerCase() })),
    display: {
      arrows: bool(display.arrows, d.display.arrows),
      textFade: num(display.textFade, DISPLAY_RANGES.textFade, d.display.textFade),
      nodeSize: num(display.nodeSize, DISPLAY_RANGES.nodeSize, d.display.nodeSize),
      linkThickness: num(display.linkThickness, DISPLAY_RANGES.linkThickness, d.display.linkThickness),
    },
    forces: {
      center: num(forces.center, FORCE_RANGES.center, d.forces.center),
      repel: num(forces.repel, FORCE_RANGES.repel, d.forces.repel),
      link: num(forces.link, FORCE_RANGES.link, d.forces.link),
      linkDistance: num(forces.linkDistance, FORCE_RANGES.linkDistance, d.forces.linkDistance),
    },
    open: bool(raw.open, d.open),
    sections: {
      filters: bool(sections.filters, d.sections.filters),
      groups: bool(sections.groups, d.sections.groups),
      display: bool(sections.display, d.sections.display),
      forces: bool(sections.forces, d.sections.forces),
    },
  };
}

const sessionChoices = new Map<string, GraphSettings>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function personKey(principalId: string | null | undefined): string {
  return principalId?.trim().toLowerCase() || "local";
}

function readAll(): Record<string, unknown> {
  try {
    const text = storage()?.getItem(MEMORY_GRAPH_PREF_KEY);
    return record(text ? JSON.parse(text) : null);
  } catch {
    return {};
  }
}

export function readGraphSettings(principalId: string | null | undefined): GraphSettings {
  const key = personKey(principalId);
  const session = sessionChoices.get(key);
  if (session) return session;
  return cleanGraphSettings(readAll()[key]);
}

export function writeGraphSettings(principalId: string | null | undefined, settings: GraphSettings): void {
  const key = personKey(principalId);
  const clean = cleanGraphSettings(settings);
  sessionChoices.set(key, clean);
  try {
    const all = readAll();
    delete all[key];
    const entries = [...Object.entries(all), [key, clean] as const].slice(-MAX_PEOPLE);
    storage()?.setItem(MEMORY_GRAPH_PREF_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage refused: this session keeps the settings */
  }
}

/** Forget this session's copy (tests, another device's change). */
export function forgetGraphSettingsSession(): void {
  sessionChoices.clear();
}
