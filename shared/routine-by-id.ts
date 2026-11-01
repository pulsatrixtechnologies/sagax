// Resolve list_routines routine_id to one routine (2026-11-01, #1891).
//
// The Automations list page and the Webhooks panel show ids a bot may copy
// into list_routines. Those ids are not always routine.id on the calling bot:
//
//   1. An owned webhook's id (createOwned) differs from its routine id. The
//      Webhooks list page shows the webhook id; a bot hit "no routine with
//      that id" for Voice line while Incoming texts (looked up by routine id)
//      worked.
//   2. Automations > Mine lists every bot of the person. A Primary Bot (or a
//      peer that can reach another of the same owner's bots) may pass an id
//      that belongs to a sibling bot; the old path only searched from.id.
//
// Lookup order: own routine id, own webhook id -> its routine, then the same
// for every reachable same-owner bot. Person isolation stays: never another
// person's bots.

export type RoutineByIdRow = {
  id: string;
  botId: string;
  name?: string;
  enabled?: boolean;
  schedule?: { type?: string; source?: unknown };
};

export type WebhookByIdRow = {
  id: string;
  botId: string;
  /** When set, this webhook belongs to that routine (createOwned). */
  routineId?: string;
  name?: string;
  enabled?: boolean;
  source?: { type?: string } | null;
};

export type ResolveRoutineByIdInput = {
  routineId: string;
  /** The bot calling list_routines. */
  botId: string;
  routines: readonly RoutineByIdRow[];
  webhooks?: readonly WebhookByIdRow[];
  /** Bot ids this caller may read routines of (own id always included). */
  reachableBotIds?: readonly string[];
};

export type ResolveRoutineByIdResult =
  | { kind: "found"; routine: RoutineByIdRow; via: "routine" | "webhook"; webhookId?: string }
  | { kind: "missing" };

/** True when this id is a phone/webhook trigger the person must turn off
 * themselves: a webhook-schedule routine, an email trigger, or a typed
 * telephony (Bot phone) webhook. */
export function isPhoneOrWebhookTrigger(
  routine: Pick<RoutineByIdRow, "schedule"> | null | undefined,
  webhook?: Pick<WebhookByIdRow, "source" | "routineId"> | null,
): boolean {
  const scheduleType = routine?.schedule?.type;
  if (scheduleType === "webhook" || scheduleType === "event") return true;
  if (webhook?.source?.type === "telephony") return true;
  return false;
}

/** Find the routine list_routines should return for routine_id. */
export function resolveRoutineById(input: ResolveRoutineByIdInput): ResolveRoutineByIdResult {
  const id = input.routineId.trim();
  if (!id) return { kind: "missing" };
  const allowed = new Set<string>([input.botId, ...(input.reachableBotIds ?? [])]);
  const routines = input.routines.filter((routine) => allowed.has(routine.botId));
  const webhooks = (input.webhooks ?? []).filter((webhook) => allowed.has(webhook.botId));

  const byRoutineId = (routineId: string): RoutineByIdRow | undefined =>
    routines.find((routine) => routine.id === routineId);

  const direct = byRoutineId(id);
  if (direct) return { kind: "found", routine: direct, via: "routine" };

  const hook = webhooks.find((webhook) => webhook.id === id);
  if (hook?.routineId) {
    const owned = byRoutineId(hook.routineId);
    if (owned) return { kind: "found", routine: owned, via: "webhook", webhookId: hook.id };
  }

  return { kind: "missing" };
}
