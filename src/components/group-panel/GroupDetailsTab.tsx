// Group panel > Details (2026-11-03, JC): a bot's Details, for the group.
// 2026-11-06 (JC): the same sections in the same order and look as the bot
// panel's Activity tab (BotSettingsDialog): Upcoming (the group's routines),
// Suggested (the group's next steps, then Add to Slack and Add to meeting),
// Computer (the card of one of the viewer's bots; no Computer tab), Tasks
// (the ones the viewer's bots keep from the group's conversations), then each
// of those bots' Coding and Activity and temporary remote sessions (the
// server keeps both per bot, not per group: each block under the bot's name).
// The body carries data-panel-bot, so cards take the bot panel's tones. A
// section with nothing to show is not drawn.
import { useMemo, useState } from "react";
import { CalendarPlus } from "lucide-react";

import { useStore, type Bot, type Group } from "@/state/store";
import { t } from "@/lib/i18n";
import { appendComposerDraft } from "@/lib/drafts";
import { useShowSuggestions } from "@/lib/panel-visibility";
import { groupRoutines, groupSuggestions, groupThreadIds, type GroupPanelTab } from "@/lib/group-panel";
import { SuggestionsCard } from "../bot-settings/SuggestionsSection";
import { BotTaskSection, botTaskAnswerDraft, type BotTaskScope } from "../bot-settings/BotTaskSection";
import { ActivitySection } from "../bot-settings/ActivitySection";
import { RemoteSessionsSection } from "../remote-session/RemoteSessionsSection";
import { GroupRoutinesSection } from "./GroupRoutinesSection";
import { GroupComputerSection, groupComputerBots } from "./GroupComputerTab";
import { SlackLogo } from "../SlackLogo";
import { useSlackManagementUrl } from "../bot-settings/useSlackManagement";
import { useAdvancedMode } from "@/lib/interface-mode";
import { showsComputer } from "../bot-settings/panel-tabs";

export function GroupDetailsTab({ group, members, ownBots, leadBotId, canEdit, canAddBot, onOpenTab }: {
  group: Group;
  members: Bot[];
  /** The viewer's own bots in the group: their lists are the ones it may read. */
  ownBots: Bot[];
  leadBotId?: string;
  canEdit: boolean;
  canAddBot: boolean;
  onOpenTab: (tab: GroupPanelTab) => void;
}) {
  const { state, dispatch } = useStore();
  const shown = useShowSuggestions();
  const [newRoutine, setNewRoutine] = useState(0);
  const routines = useMemo(() => groupRoutines(state.routines, group), [state.routines, group]);
  const threadIds = useMemo(() => groupThreadIds(group), [group]);
  const ownIds = ownBots.map((bot) => bot.id);
  const ownKey = ownIds.join(",");

  const suggestions = groupSuggestions({
    bulletin: group.bulletin ?? "",
    botCount: members.length,
    routineCount: routines.length,
    canEdit,
    canAddBot,
    canAddRoutine: ownBots.length > 0 && !group.dm,
  });


  // Answer on a task: back to the group's conversation it came from, the
  // task named in that composer.
  const taskScope = useMemo<BotTaskScope>(() => ({
    botIds: ownKey ? ownKey.split(",") : [],
    threadIds,
    onAnswer: (task) => {
      const threadId = task.threadId && threadIds.has(task.threadId) ? task.threadId : group.threadId;
      if (threadId !== group.threadId) dispatch({ type: "switchGroupTask", groupId: group.id, threadId });
      appendComposerDraft(`group:${group.id}:${threadId}`, botTaskAnswerDraft(task));
    },
  }), [ownKey, threadIds, group.id, group.threadId, dispatch]);

  const advanced = useAdvancedMode();
  const computerBots = groupComputerBots(ownBots);
  const computerShown = showsComputer({ advanced, computerOff: computerBots.length === 0 });
  // Slack and new routines go through a bot: the lead when it is the
  // viewer's, else the viewer's first bot in the group.
  const ownLead = ownBots.find((bot) => bot.id === leadBotId) ?? ownBots[0];
  const canAddRoutine = ownBots.length > 0 && !group.dm;
  const slackUrl = useSlackManagementUrl(ownLead?.id ?? "");

  const suggestionRows = [
    // The team-goal step does what Add to meeting does: one row for it.
    ...suggestions.filter((item) => !(canAddRoutine && item.action === "routine")).map((item) => ({
      id: item.id,
      title: t(item.titleKey),
      subtitle: t(item.subtitleKey),
      onRun: () => {
        if (item.action === "routine") setNewRoutine((count) => count + 1);
        else onOpenTab(item.action);
      },
    })),
    // As on a bot: Add to Slack (the lead's Admin link, only where the
    // server offers one, #3398) and Add to meeting (a new routine in this
    // panel's Upcoming card).
    ...(ownLead && slackUrl ? [{ id: "slack", title: t("botPanel.suggestions.slack.title"), icon: SlackLogo, href: slackUrl }] : []),
    ...(canAddRoutine ? [{ id: "meeting", title: t("botPanel.suggestions.meeting.title"), icon: CalendarPlus, onRun: () => setNewRoutine((count) => count + 1) }] : []),
  ];

  return (
    <div data-group-details="" data-panel-bot="" className="flex flex-col gap-5 px-4 pb-6">
      <GroupRoutinesSection group={group} routines={routines} members={members} ownBots={ownBots} leadBotId={leadBotId} newRequest={newRoutine} />
      {shown && suggestionRows.length > 0 && (
        <SuggestionsCard headingId={`group-suggestions-${group.id}`} panel rows={suggestionRows} />
      )}
      {computerShown && <GroupComputerSection bots={computerBots} leadBotId={leadBotId} />}
      {ownBots.length > 0 && <BotTaskSection botId={`group:${group.id}`} scope={taskScope} />}
      {ownBots.map((bot) => (
        // One block per bot of the viewer's; its name shows only when the
        // block draws something, and only when the group has several.
        <div key={bot.id} data-group-member-work={bot.id} className="group/member flex flex-col gap-5 empty:hidden">
          {ownBots.length > 1 && <h3 className="-mb-3 hidden px-0.5 text-[12px] leading-[17px] text-ink-tertiary group-has-[section]/member:block">{bot.name}</h3>}
          <ActivitySection bot={bot} />
          <RemoteSessionsSection bot={bot} />
        </div>
      ))}
    </div>
  );
}
