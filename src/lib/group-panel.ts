// The group panel (src/components/GroupPanel.tsx), 2026-11-03 (JC): the same
// tabs and Details sections as a bot's panel, scoped to the group. Pure: the
// tab list, which routines and conversations belong to the group, its lead,
// and its suggestions. The components draw them.
import type { Group, GroupDefaultResponder } from "@/state/store";
import type { Routine } from "@/lib/routines";
import type { LocaleKey } from "@/locales";
import { effectiveDefaultResponder } from "@/lib/group-routing";
import { simpleHidesPanelTab } from "@/lib/interface-visibility";

/** Details, Members, Instructions, Memory, Library, Computer. No Advanced
 * tab: its settings sit under Members, folded by default. */
export const GROUP_PANEL_TABS = ["details", "members", "instructions", "memory", "library", "computer"] as const;
export type GroupPanelTab = (typeof GROUP_PANEL_TABS)[number];

/** Tabs hidden for now (JC, 2026-11-06): their code stays; empty this set
 * to bring them back. The instructions stay editable from the (i) beside the
 * group's name, and the group memory stays on unless switched off. Computer
 * is no tab: as on a bot, it is a section of Details (GroupComputerSection). */
export const GROUP_PANEL_HIDDEN_TABS: ReadonlySet<GroupPanelTab> = new Set<GroupPanelTab>(["instructions", "memory", "computer"]);

/** The tabs a group shows. Simple hides Computer, as on a bot; a group with
 * no bot of the viewer's that works somewhere has no computer to show. */
export function visibleGroupPanelTabs(input: { advanced: boolean; hasComputer: boolean }): GroupPanelTab[] {
  return GROUP_PANEL_TABS.filter((id) => !GROUP_PANEL_HIDDEN_TABS.has(id) && (input.advanced || !simpleHidesPanelTab(id)) && (id !== "computer" || input.hasComputer));
}

/** Every conversation of the group: its open one and each of its tasks. */
export function groupThreadIds(group: Pick<Group, "threadId" | "tasks">): Set<string> {
  const ids = new Set<string>();
  if (group.threadId) ids.add(group.threadId);
  for (const task of group.tasks ?? []) if (task.threadId) ids.add(task.threadId);
  return ids;
}

/** The group's routines: its team goals (target room-goal, groupId) and the
 * routines that post their results in one of its conversations. */
export function groupRoutines(routines: readonly Routine[] | null | undefined, group: Pick<Group, "id" | "threadId" | "tasks">): Routine[] {
  const threads = groupThreadIds(group);
  return (routines ?? []).filter((routine) => routine.groupId === group.id || (routine.resultsThreadId !== undefined && threads.has(routine.resultsThreadId)));
}

/** The bot that answers a plain message: the lead, or an Auto room's
 * fallback. None while the room answers everyone or mentions only. */
export function groupLeadBotId(group: Pick<Group, "defaultResponder">, members: ReadonlyArray<{ id: string }>): string | undefined {
  const value = effectiveDefaultResponder(group, [...members]);
  if (value.kind === "member") return value.botId;
  if (value.kind === "auto") return value.fallbackBotId ?? members[0]?.id;
  return undefined;
}

/** Making a bot the lead from its row: an Auto room keeps Auto with that
 * bot as its fallback; any other room answers through that bot. */
export function leadResponder(group: Pick<Group, "defaultResponder">, members: ReadonlyArray<{ id: string }>, botId: string): GroupDefaultResponder {
  const value = effectiveDefaultResponder(group, [...members]);
  return value.kind === "auto" ? { kind: "auto", fallbackBotId: botId } : { kind: "member", botId };
}

export type GroupSuggestionAction = "instructions" | "members" | "routine";

export interface GroupSuggestion {
  id: string;
  titleKey: LocaleKey;
  subtitleKey: LocaleKey;
  action: GroupSuggestionAction;
}

/** Next steps for a group, in the bot's Suggestions card: write its
 * instructions, bring a second bot, give the team a goal. What the viewer
 * cannot change is not suggested. */
export function groupSuggestions(input: {
  bulletin: string;
  botCount: number;
  routineCount: number;
  canEdit: boolean;
  canAddBot: boolean;
  canAddRoutine: boolean;
}): GroupSuggestion[] {
  const out: GroupSuggestion[] = [];
  if (input.canEdit && !input.bulletin.trim() && !GROUP_PANEL_HIDDEN_TABS.has("instructions")) {
    out.push({ id: "instructions", titleKey: "groupPanel.suggestions.instructions.title", subtitleKey: "groupPanel.suggestions.instructions.subtitle", action: "instructions" });
  }
  if (input.canAddBot && input.botCount < 2) {
    out.push({ id: "bots", titleKey: "groupPanel.suggestions.bots.title", subtitleKey: "groupPanel.suggestions.bots.subtitle", action: "members" });
  }
  if (input.canAddRoutine && input.routineCount === 0) {
    out.push({ id: "goal", titleKey: "groupPanel.suggestions.goal.title", subtitleKey: "groupPanel.suggestions.goal.subtitle", action: "routine" });
  }
  return out;
}
