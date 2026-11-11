// A bot with no engine used to answer the person with one French sentence,
// whatever language the app was set to. The server still sends that sentence
// to other bots, and older chats stored it. A person's own screen reads the
// code, or either historical sentence, and says it in the app's language.
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import {
  ENGINE_REMOVED_MESSAGE,
  ENGINE_REMOVED_PERSON,
  NO_ENGINE_CODE,
  NO_ENGINE_MESSAGE,
  NO_ENGINE_PERSON,
} from "../../shared/bot-engine-error";
import { MODEL_ACCESS_DISABLED_MESSAGE } from "../../shared/model-access-disabled";
import { outwardDetailIn, restartSentenceKey } from "../../shared/restart-words";

/** The no-engine, removed-engine or model-turned-off sentence in the app's language, or null
 * when `text` is some other cause. */
export function localizedEngineCause(text: string): string | null {
  if (text === NO_ENGINE_MESSAGE || text === NO_ENGINE_PERSON) return t("composer.error.noEngine");
  if (text === ENGINE_REMOVED_MESSAGE || text === ENGINE_REMOVED_PERSON) return t("composer.error.engineRemoved");
  // #1450: a model turned off on the account that pays for it
  if (text === MODEL_ACCESS_DISABLED_MESSAGE) return t("composer.error.modelAccessDisabled");
  return restartSentence(text);
}

/** A line the server writes after a restart (shared/restart-words.ts), in
 * the app's language, or null for any other words. */
export function restartSentence(text: string): string | null {
  const known = restartSentenceKey(text);
  if (!known) return null;
  switch (known.key) {
    case "restart.cut": return t("chat.restart.cut");
    case "restart.resumeFailed": return t("chat.restart.resumeFailed", { detail: known.detail });
    case "restart.outward": return t("chat.restart.outward", { detail: outwardDetailIn(known, (key, vars) => t(key as LocaleKey, vars)) });
    case "restart.cutTwice": return t("chat.restart.cutTwice");
    case "restart.notResumed": return t("chat.restart.notResumed");
    case "restart.notResumedNewer": return t("chat.restart.notResumedNewer");
    case "restart.turnNote": return t("chat.restart.turnNote");
    case "restart.runNote": return t("chat.restart.runNote");
    case "parallel.notStarted": return t("chat.parallel.notStarted");
    case "answer.notDelivered": return t("chat.answer.notDelivered");
  }
}

/** The sentence for a refusal body that is the no-engine error
 * (`{ code: "no_engine" }` or the sentence itself), or null otherwise. */
export function engineErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as { code?: unknown; error?: unknown };
  if (record.code === NO_ENGINE_CODE) return t("composer.error.noEngine");
  const error = record.error;
  if (typeof error === "string") return localizedEngineCause(error);
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return localizedEngineCause((error as { message: string }).message);
  }
  return null;
}
