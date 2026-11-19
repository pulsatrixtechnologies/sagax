// Auto model (docs/plans/2026-10-08-auto-model.md): the shapes the server
// records of a pick and the renderer draws. The choosing is server/models/model-auto.ts.

/** What kind of work a task is. */
export type AutoTaskClass =
  | "vision"
  | "large-context"
  | "long-reading"
  | "coding"
  | "reasoning"
  | "automation"
  | "quick"
  | "general";

export const AUTO_TASK_CLASSES: readonly AutoTaskClass[] = [
  "vision", "large-context", "long-reading", "coding", "reasoning", "automation", "quick", "general",
];

/** The model tier a class of work runs on. */
export type AutoTier = "top" | "coding" | "fast" | "long" | "vision";

/** strongest-own: the tier's model on the bot's own engine.
 * strongest-other: the bot's own engine is not usable for this turn; the
 * next engine in the order. tier-fallback: no engine had the tier; a
 * nearby one stood in. base: nothing matched; the bot's own model. */
export type AutoReason = "strongest-own" | "strongest-other" | "tier-fallback" | "base" | "fast";

/** How the payer pays on the picked engine (server AccessVia). */
export type AutoPayerVia = "subscription" | "owner-key" | "speaker-key" | "server" | "org-key";

/** The last pick on a thread (WireTask.autoModel), and the preview the
 * model chip shows before a thread has one. */
export interface AutoModelRecord {
  instanceId: string;
  model: string;
  engineLabel: string;
  modelLabel: string;
  role: "orchestration" | "worker";
  tier: AutoTier;
  taskClass?: AutoTaskClass;
  reason: AutoReason;
  via?: AutoPayerVia;
  /** The bot's own engine, when the pick left it. */
  fromEngineLabel?: string;
  at: number;
}

/** A live explanation uses the same candidate list and chain as dispatch. */
export type AutoExclusionReason = "adminOff" | "modelOff" | "offline" | "reconnect" | "credentials" | "policy" | "approval" | "capabilities" | "refused" | "limit";
export interface AutoModelEntry { instanceId: string; engineLabel: string; model: string; modelLabel: string; via?: AutoPayerVia }
export interface AutoModelExcluded { instanceId: string; engineLabel: string; model?: string; modelLabel?: string; reason: AutoExclusionReason }
export interface AutoModelPreview {
  auto: boolean;
  pick: AutoModelRecord | null;
  chain: AutoModelEntry[];
  excluded: AutoModelExcluded[];
  /** Actual configured startup recovery for a pinned model. */
  backups: AutoModelEntry[];
}
