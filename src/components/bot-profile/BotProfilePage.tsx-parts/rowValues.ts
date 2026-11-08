// The short value on the right of each row of the V6 bot page (#2621, the
// canvas: "grok-4.7", "3 active", "Mail, Calendar, GitHub", "7"). Every row
// shows one, read from the state the sub-page already shows: the store for
// what it holds (model, approval, sharing, routines, memory, voice), the
// same endpoints the sub-pages read for the rest (channels, accounts,
// rules, skills, versions). Those load only while their tab's list is on
// screen; a value not loaded yet is simply absent.
import { useEffect, useState } from "react";

import { api, useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useBotInboundMailState } from "@/lib/bot-inbound-mail";
import { useReachMe } from "@/lib/reach-me";
import { loadMessagesSetup } from "@/lib/mac-messages-setup";
import { capabilityName, orderedCapabilities, useBotCapabilities, type Capability } from "@/lib/capabilities";
import { fetchRules, type RuleSetWire } from "@/lib/rule-sets";
import { relativeTime } from "@/lib/memory";
import { canEditBotField } from "@/lib/bot-capabilities";
import { personaSharingSummary } from "@/lib/bot-sharing";
import type { BotProfileSubPage, BotProfileTab } from "@/lib/persona-sections";
import { approvalModeFor } from "../../../../shared/approval-mode";
import { proactiveModeFor } from "../../../../shared/proactive-mode";
import { modelLabel } from "../../ModelPicker.tsx-parts/helpers";

/** "1 x" or "N xs" from a .one / .other pair of keys. */
function counted(count: number, one: LocaleKey, other: LocaleKey): string {
  return count === 1 ? t(one) : t(other, { count });
}

/** How many of the bot's channels are on: Slack (managed in Admin), its
 * own email address, each "Reach me" channel, Messages on this Mac. */
export function activeChannelCount(input: { slack: boolean; email: boolean; reach: number; messages: boolean }): number {
  return (input.slack ? 1 : 0) + (input.email ? 1 : 0) + Math.max(0, input.reach) + (input.messages ? 1 : 0);
}

/** The accounts it uses, by name: the first three, then "+N". */
export function accountsValue(items: readonly Pick<Capability, "name" | "form" | "state">[]): string {
  const names = items.filter((item) => (item.form === "connector" || item.form === "mcp") && item.state === "on").map((item) => capabilityName(item));
  if (names.length === 0) return t("botProfile.v6.value.none");
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}

/** The rules a bot follows: each non-empty, non-heading line of a set
 * that is on. */
export function ruleCount(sets: readonly Pick<RuleSetWire, "enabled" | "text">[]): number {
  return sets
    .filter((set) => set.enabled)
    .reduce((sum, set) => sum + set.text.split("\n").filter((line) => line.trim() !== "" && !line.trim().startsWith("#")).length, 0);
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
export function useBotRowValues(bot: Bot, { tab, listing, slackUrl }: { tab: BotProfileTab; listing: boolean; slackUrl: string | null }): (id: BotProfileSubPage) => string | null {
  const { state } = useStore();
  const general = listing && tab === "general";
  const knowledge = listing && tab === "knowledge";
  const historyAllowed = canEditBotField(state.config, bot, "soul");

  const [mail] = useBotInboundMailState(general ? bot.id : null);
  const [reach] = useReachMe(general ? bot.id : null);
  const messages = useLoaded(general ? "messages" : null, loadMessagesSetup);
  const capabilities = useBotCapabilities(general ? bot.id : null);
  const rules = useLoaded(general ? `rules:${bot.id}` : null, () => fetchRules(bot.id));
  const lastVersion = useLoaded(general && historyAllowed ? `history:${bot.id}` : null, () =>
    api(`/api/bots/${bot.id}/history?limit=1`).then((data: { rows?: Array<{ at: number }> }) => data.rows?.[0]?.at ?? null));
  const skills = useLoaded(knowledge ? `skills:${bot.id}` : null, () =>
    api(`/api/bots/${bot.id}/skills`).then((data: { skills?: unknown[] }) => (data.skills ?? []).length));
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
      case "beforeActing":
        return t(`approvalMode.${approvalModeFor(bot)}.chip` as LocaleKey);
      case "channels":
        if (mail === null || reach === null || messages === null) return null;
        return counted(
          activeChannelCount({
            slack: Boolean(slackUrl),
            email: Boolean(mail.available && mail.address),
            reach: reach?.settings.channels.length ?? 0,
            messages: Boolean(messages.available && messages.onThisMac && messages.useMessages),
          }),
          "botProfile.v6.value.channels.one",
          "botProfile.v6.value.channels.other",
        );
      case "sharing":
        return personaSharingSummary(bot);
      case "accounts":
        return capabilities.data ? accountsValue(orderedCapabilities(capabilities.data.items)) : null;
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
      case "skills":
        return skills === null ? null : counted(skills, "botProfile.v6.value.skills.one", "botProfile.v6.value.skills.other");
      case "folder":
        return t(bot.memoryEnabled === false ? "botProfile.v6.value.memoryOff" : "botProfile.v6.value.memoryOn");
    }
  };
}
