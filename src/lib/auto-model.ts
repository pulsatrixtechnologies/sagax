// Auto model in the app (docs/plans/2026-10-08-auto-model.md): the words
// for what Auto picked, in the person's language. The preview of a bot's
// next turn is src/lib/auto-model-preview.ts.
import { t } from "@/lib/i18n";
import type { AutoModelRecord, AutoPayerVia, AutoTaskClass } from "../../shared/auto-model";

/** The class of a worker's task, as the person reads it. */
export function autoTaskClassLabel(taskClass: AutoTaskClass | undefined): string {
  return t(`model.auto.class.${taskClass ?? "general"}`);
}

function payerPhrase(via: AutoPayerVia | undefined): string {
  switch (via) {
    case "subscription": return t("model.auto.payer.subscription");
    case "owner-key":
    case "speaker-key": return t("model.auto.payer.ownKey");
    case "org-key": return t("model.auto.payer.orgKey");
    default: return t("model.auto.payer.server");
  }
}

/** "Auto · Claude Opus 5.5": the chip's label. */
export function autoChipLabel(record: Pick<AutoModelRecord, "modelLabel"> | null | undefined): string {
  return record ? t("model.auto.chip", { model: record.modelLabel }) : t("model.auto.label");
}

/** "Auto: worker Codex · GPT-5.5 Codex (coding)". */
export function autoWorkerLine(record: AutoModelRecord): string {
  return t("model.auto.worker", { engine: record.engineLabel, model: record.modelLabel, class: autoTaskClassLabel(record.taskClass) });
}

/** The one sentence saying why Auto picked this model. */
export function autoReasonSentence(record: AutoModelRecord): string {
  if (record.role === "worker") return autoWorkerLine(record);
  const params = { model: record.modelLabel, engine: record.engineLabel, payer: payerPhrase(record.via), from: record.fromEngineLabel ?? "" };
  // The person's own turn, when its words moved it off the strongest tier
  // (2026-10-29): say what in the message decided it.
  if (record.reason !== "base" && record.reason !== "fast") {
    if (record.tier === "fast" && record.taskClass === "quick") return t("model.auto.why.quickTier", params);
    if (record.tier === "vision" && record.taskClass === "vision") return t("model.auto.why.vision", params);
    if (record.tier === "long" && (record.taskClass === "long-reading" || record.taskClass === "large-context")) return t("model.auto.why.long", params);
  }
  switch (record.reason) {
    case "strongest-own": return t("model.auto.why.strongestOwn", params);
    case "strongest-other": return t("model.auto.why.strongestOther", params);
    case "fast": return t("model.auto.why.fast", params);
    case "tier-fallback": return t("model.auto.why.tierFallback", params);
    default: return t("model.auto.why.base", params);
  }
}
