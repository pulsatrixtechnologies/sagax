// Group panel > Details (2026-11-03, JC): a bot's Details, for the group.
// Same sections in the same order and look: Suggestions, the tasks the
// viewer's bots keep from the group's conversations, then each of those bots'
// ongoing activity and temporary remote sessions (the server keeps both per
// bot, not per group: the group shows its members' combined view, each block
// under the bot's name), then the group's routines. A section with nothing
// to show is not drawn.
import { useMemo, useState } from "react";

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

  return (
    <div data-group-details="" className="flex flex-col gap-6 px-4 pb-6 pt-2">
      {shown && suggestions.length > 0 && (
        <SuggestionsCard
          headingId={`group-suggestions-${group.id}`}
          rows={suggestions.map((item) => ({
            id: item.id,
            title: t(item.titleKey),
            subtitle: t(item.subtitleKey),
            onRun: () => {
              if (item.action === "routine") setNewRoutine((count) => count + 1);
              else onOpenTab(item.action);
            },
          }))}
        />
      )}
      {ownBots.length > 0 && <BotTaskSection botId={`group:${group.id}`} scope={taskScope} />}
      {ownBots.map((bot) => (
        // One block per bot of the viewer's; its name shows only when the
        // block draws something, and only when the group has several.
        <div key={bot.id} data-group-member-work={bot.id} className="group/member flex flex-col gap-6 empty:hidden">
          {ownBots.length > 1 && <h3 className="-mb-4 hidden px-0.5 text-[12px] leading-[17px] text-ink-tertiary group-has-[section]/member:block">{bot.name}</h3>}
          <ActivitySection bot={bot} />
          <RemoteSessionsSection bot={bot} />
        </div>
      ))}
      <GroupRoutinesSection group={group} routines={routines} members={members} ownBots={ownBots} leadBotId={leadBotId} newRequest={newRoutine} />
    </div>
  );
}
