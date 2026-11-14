/** #4250 (S4): a routine started when something changes in a product. The
 * routine owns a typed `perspicax` trigger (shared/trigger-sources.ts) whose
 * watched URIs live on the schedule: the organization server tells this
 * server when a watched resource changed (contract `perspicax-events/1`,
 * server/perspicax/perspicax-events.ts) and the routine runs then, never
 * before: no turn until the event. */

export interface RoutineProductEventSchedule {
  type: "event";
  source: "perspicax";
  /** Watched URIs (`perspicax://<api>/<resource>/<id>`, a list with its
   * filter, or a short spelling Perspicax lists); `*` matches any run of
   * characters. At least one. */
  resources: string[];
}

export const PRODUCT_RESOURCE_PREFIX = "perspicax://";
/** As many as a trigger's filter holds. */
export const PRODUCT_RESOURCES_MAX = 20;
export const PRODUCT_RESOURCE_MAX_CHARS = 200;

export function isProductEventSchedule(schedule: { type: string; source?: unknown } | null | undefined): schedule is RoutineProductEventSchedule {
  return schedule?.type === "event" && schedule.source === "perspicax";
}

/** Watched URIs, trimmed and deduplicated. Throws an Error whose message is
 * shown to the person. */
export function cleanProductEventSchedule(input: { resources?: unknown }): RoutineProductEventSchedule {
  const raw = input.resources === undefined ? [] : input.resources;
  if (!Array.isArray(raw)) throw new Error("The watched resources must be a list");
  const resources: string[] = [];
  for (const value of raw) {
    const uri = typeof value === "string" ? value.trim() : "";
    if (!uri) continue;
    if (!uri.toLowerCase().startsWith(PRODUCT_RESOURCE_PREFIX) || uri.length > PRODUCT_RESOURCE_MAX_CHARS || /\s/.test(uri)) {
      throw new Error(`“${uri.slice(0, 80)}” is not a watched resource (perspicax://...)`);
    }
    if (/[{}]/.test(uri)) throw new Error(`Fill in the {...} part of “${uri.slice(0, 80)}”`);
    if (!resources.includes(uri)) resources.push(uri);
  }
  if (!resources.length) throw new Error("Choose the resource to watch");
  if (resources.length > PRODUCT_RESOURCES_MAX) throw new Error(`Watch at most ${PRODUCT_RESOURCES_MAX} resources`);
  return { type: "event", source: "perspicax", resources };
}

/** Plain words for a label or a card. */
export function productEventScheduleLabel(schedule: RoutineProductEventSchedule): string {
  return `Product change: ${schedule.resources.join(", ")}`;
}
