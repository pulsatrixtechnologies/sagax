// The short value on the right of each row of the V6 bot page (#2621, the
// canvas: "grok-4.7", "3 active", "Mail, Calendar, GitHub", "7"). Every row
// shows one, read from the state the sub-page already shows: the store for
// what it holds (model, approval, sharing, routines, memory, voice), the
// same endpoints the sub-pages read for the rest (rules, versions). The
// skills are a card in place on Knowledge (#3400): no row, no value.
// The channels and the accounts are cards in place (#3398): no row, no value. Those load only while their tab's list is on
// screen; a value not loaded yet is simply absent.
import { useEffect, useState } from "react";

import { api, useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { fetchRules, type RuleSetWire } from "@/lib/rule-sets";
import { relativeTime } from "@/lib/memory";
import { canEditBotField } from "@/lib/bot-capabilities";
import { personaSharingSummary } from "@/lib/bot-sharing";
import type { BotProfileSubPage, BotProfileTab } from "@/lib/persona-sections";
import { completeMascotLook } from "../../../../shared/mascot-look";
import { botAvatarProfile } from "../../../../shared/bot-avatar";
import { resolveBotAvatarOutcome } from "../../Avatar";
import { approvalModeFor } from "../../../../shared/approval-mode";
import { proactiveModeFor } from "../../../../shared/proactive-mode";
import { modelLabel } from "../../ModelPicker.tsx-parts/helpers";
import { CHARACTER_LABEL, SHAPE_LABEL } from "../../floating-bots/mascot-look-labels";

/** "1 x" or "N xs" from a .one / .other pair of keys. */
function counted(count: number, one: LocaleKey, other: LocaleKey): string {
  return count === 1 ? t(one) : t(other, { count });
}

/** The rules a bot follows: each non-empty, non-heading line of a set
 * that is on. */
export function ruleCount(sets: readonly Pick<RuleSetWire, "enabled" | "text">[]): number {
  return sets
    .filter((set) => set.enabled)
    .reduce((sum, set) => sum + set.text.split("\n").filter((line) => line.trim() !== "" && !line.trim().startsWith("#")).length, 0);
}

/** The Appearance row's value: what the bot wears, by the same rule every
 * avatar renders with (resolveBotAvatarOutcome): its picture only when it
 * has one and a picture crop, else its mascot (a shape by its own name). */
export function appearanceRowValue(bot: Pick<Bot, "avatarCrop" | "avatarUrl" | "mascotLook">): string {
  const profile = botAvatarProfile(bot);
  const outcome = resolveBotAvatarOutcome({ avatarCrop: profile.avatarCrop, hasUrl: Boolean(profile.avatarUrl), imageFailed: false });
  if (outcome === "flatImage") return t("botProfile.v6.value.picture");
  const look = completeMascotLook(bot.mascotLook);
  return t(look.character === "shape" ? SHAPE_LABEL[look.shape] : CHARACTER_LABEL[look.character]);
}

function useLoaded<T>(key: string | null, load: () => Promise<T>): T | null {
  const [answer, setAnswer] = useState<{ key: string; value: T } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    load().then((value) => { if (live) setAnswer({ key, value }); }, () => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key && answer?.key === key ? answer.value : null;
}

/** Each row's value for the tab on screen. `listing` is false while a
 * sub-page is open (nothing to load for rows that are not shown). */
export function useBotRowValues(bot: Bot, { tab, listing }: { tab: BotProfileTab; listing: boolean }): (id: BotProfileSubPage) => string | null {
  const { state } = useStore();
  const general = listing && tab === "general";
  const historyAllowed = canEditBotField(state.config, bot, "soul");

  const rules = useLoaded(general ? `rules:${bot.id}` : null, () => fetchRules(bot.id));
  const lastVersion = useLoaded(general && historyAllowed ? `history:${bot.id}` : null, () =>
    api(`/api/bots/${bot.id}/history?limit=1`).then((data: { rows?: Array<{ at: number }> }) => data.rows?.[0]?.at ?? null));
  const routines = state.routines.filter((routine) => routine.botId === bot.id);

  return (id) => {
    switch (id) {
      case "personality":
        return t(bot.soul?.trim() ? "botProfile.v6.value.custom" : "botProfile.v6.value.default");
      case "model": {
        const selection = bot.modelSelection;
        if (!selection) return null;
        if (selection.auto) return t("botProfile.v6.value.auto");
        return modelLabel(state.instances.find((instance) => instance.instanceId === selection.instanceId), selection.model);
      }
      case "appearance":
        return appearanceRowValue(bot);
      case "beforeActing":
        return t(`approvalMode.${approvalModeFor(bot)}.chip` as LocaleKey);
      case "sharing":
        return personaSharingSummary(bot);
      case "rules":
        return rules ? counted(ruleCount(rules.sets), "botProfile.v6.value.rules.one", "botProfile.v6.value.rules.other") : null;
      case "actsAlone":
        return t(proactiveModeFor(bot) === "off" ? "botProfile.v6.value.off" : "botProfile.v6.value.proactive");
      case "voice":
        return bot.voice ? bot.voice.charAt(0).toUpperCase() + bot.voice.slice(1) : t("botProfile.v6.value.default");
      case "advanced":
        return t(bot.chiefOfStaff ? "botProfile.v6.value.primary" : bot.browser === false ? "botProfile.v6.value.noBrowser" : "botProfile.v6.value.browser");
      case "versions":
        return typeof lastVersion === "number" ? relativeTime(lastVersion) : null;
      case "routines":
        return counted(routines.filter((routine) => routine.enabled !== false).length, "botProfile.v6.value.routines.one", "botProfile.v6.value.routines.other");
      case "folder":
        return t(bot.memoryEnabled === false ? "botProfile.v6.value.memoryOff" : "botProfile.v6.value.memoryOn");
    }
  };
}
