/** Reasoning-effort levels, ascending. A union of everything any engine
 * accepts; each driver declares the subset its CLI will take. Lives outside
 * wire.ts: the cards that carry a ModelSelection must not import the wire,
 * which already imports those cards. */
export const EFFORT_LEVELS = ["none", "low", "medium", "high", "xhigh", "max", "ultracode"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** Narrow untrusted API/config input before it becomes a model selection. */
export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value);
}

/** "Which model" is a data value carried on the request, never a service
 * binding. instanceId is the routing key. */
export interface ModelSelection {
  instanceId: string;
  model: string;
  /** Optional: no effort means no flag, and the CLI keeps its own default. */
  effort?: EffortLevel;
  /** Explicit model-specific variant. Omitted leaves the native session alone. */
  variant?: string;
  /** Auto (docs/plans/2026-10-08-auto-model.md): each turn picks its model.
   * instanceId and model stay the bot's own engine and fallback model, so a
   * path or client that does not know Auto still runs a valid model. Only
   * true is stored; picking a model in the chip clears it. */
  auto?: true;
  /** Fast model (#1209): with Auto on, a quick turn and the work a bot hands
   * out in parallel (a quick task, an automation, general work) run on this
   * model, usually a small local one; reasoning, coding, long reading and
   * vision stay on the larger or cloud model Auto picks. Ignored without
   * Auto, or when the engine is not usable for the turn. */
  fast?: { instanceId: string; model: string };
  /** Which of the person's own sign-ins on this engine the turn runs on
   * (2026-10-29): a person may keep two Grok accounts on an organization
   * server (a personal one and a team one, each with its own grok.com
   * connectors). Absent: the first one. "second" only ever comes from the
   * server (a part handed to the other account with run_with_engine, or a
   * request moved there for its connector); the pickers never set it. */
  account?: "second";
  /** #2106: when Auto is on, how Auto ranks models (Intelligence / Balance /
   * Cost). Absent means Balance. Cleared when a model is pinned. */
  autoOptimize?: "intelligence" | "balance" | "cost";
}
