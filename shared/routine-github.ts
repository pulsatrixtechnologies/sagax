/** A routine started by GitHub events (I3, 2026-11-07): the routine owns a
 * typed GitHub trigger (shared/trigger-sources.ts) whose events and filters
 * live on the schedule, so a routine runs on an issue opened or labeled, a
 * pull request opened or a review requested, in addition to the clock. */
import { isProductEventSchedule } from "./routine-product-event.ts";
import { TRIGGER_SOURCES, type TriggerFilterKey } from "./trigger-sources.ts";

export type RoutineGithubFilters = Partial<Record<TriggerFilterKey, string[]>>;

export interface RoutineGithubEventSchedule {
  type: "event";
  source: "github";
  /** GitHub kinds (issue.opened, issue.labeled, pr.opened,
   * pr.review_requested...). Empty means every GitHub kind. */
  events: string[];
  /** Each key with values must match one of them (repo, label, branch...). */
  filters?: RoutineGithubFilters;
}

/** The kinds a routine offers first; any kind of the GitHub catalog works. */
export const ROUTINE_GITHUB_DEFAULT_EVENTS = ["issue.opened", "issue.labeled", "pr.opened", "pr.review_requested"] as const;

export function isGithubEventSchedule(schedule: { type: string; source?: unknown } | null | undefined): schedule is RoutineGithubEventSchedule {
  return schedule?.type === "event" && schedule.source === "github";
}

/** Only GitHub kinds and filter keys, values trimmed and deduplicated.
 * Throws an Error whose message is shown to the person. */
export function cleanGithubEventSchedule(input: { events?: unknown; filters?: unknown }): RoutineGithubEventSchedule {
  const definition = TRIGGER_SOURCES.github;
  const rawEvents = input.events === undefined ? [] : input.events;
  if (!Array.isArray(rawEvents)) throw new Error("GitHub events must be a list");
  const events: string[] = [];
  for (const value of rawEvents) {
    const kind = typeof value === "string" ? value.trim() : "";
    if (!definition.events.includes(kind)) throw new Error(`GitHub has no event “${String(value)}”`);
    if (!events.includes(kind)) events.push(kind);
  }
  const filters: RoutineGithubFilters = {};
  if (input.filters !== undefined && input.filters !== null) {
    if (typeof input.filters !== "object" || Array.isArray(input.filters)) throw new Error("GitHub filters must be an object");
    for (const [key, values] of Object.entries(input.filters as Record<string, unknown>)) {
      if (!definition.filters.includes(key as TriggerFilterKey)) throw new Error(`GitHub cannot filter on “${key}”`);
      const list = Array.isArray(values) ? values : typeof values === "string" ? [values] : null;
      if (!list) throw new Error(`GitHub filter “${key}” must be a list`);
      const clean = Array.from(new Set(list.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)));
      if (clean.length) filters[key as TriggerFilterKey] = clean;
    }
  }
  return { type: "event", source: "github", events, ...(Object.keys(filters).length ? { filters } : {}) };
}

/** Plain words for a label or a card: "GitHub: issue.opened, pr.opened in org/repo". */
export function githubEventScheduleLabel(schedule: RoutineGithubEventSchedule): string {
  const kinds = schedule.events.length ? schedule.events.join(", ") : "any event";
  const repos = schedule.filters?.repo?.length ? ` in ${schedule.filters.repo.join(", ")}` : "";
  const labels = schedule.filters?.label?.length ? ` labeled ${schedule.filters.label.join(", ")}` : "";
  return `GitHub: ${kinds}${repos}${labels}`;
}

export type OwnedTriggerKind = "webhook" | "email" | "github" | "perspicax";

/** What a trigger routine's own trigger is: its kind and, for GitHub, the
 * events and filters it hands to the typed source; for a product change
 * (#4250), the watched URIs. */
export function ownedTriggerOf(schedule: { type: string; source?: unknown; events?: unknown; filters?: unknown; resources?: unknown }): {
  kind: OwnedTriggerKind;
  github?: { events: string[]; filters: RoutineGithubFilters };
  perspicax?: { resources: string[] };
} {
  if (isGithubEventSchedule(schedule)) {
    return { kind: "github", github: { events: [...schedule.events], filters: { ...schedule.filters } } };
  }
  if (isProductEventSchedule(schedule)) return { kind: "perspicax", perspicax: { resources: [...schedule.resources] } };
  return { kind: schedule.type === "event" ? "email" : "webhook" };
}
