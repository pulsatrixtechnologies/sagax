import { orderSectionTree, useSectionParents } from "@/lib/section-tree";
import type { SidebarState } from "./types";
import { Archive } from "lucide-react";
import { visibleMessages, type Bot, type Group } from "@/state/store";
import { t } from "@/lib/i18n";
import { isViewersPrimaryBot } from "@/lib/primary-bot";
import { hiddenKeySet, type SidebarHiddenPrefs } from "@/lib/sidebar-hidden";
import { withoutHiddenEntries } from "@/lib/sidebar-hidden-entries";
import {
  BOT_CHATS_SECTION_ID,
  PEOPLE_SECTION_ID,
  isBuiltInBot,
  orderedSidebarSections,
  partitionSidebarBots,
  partitionSidebarGroups,
  userSectionId,
} from "@/lib/sidebar-layout";
import { buildTeamMapSections } from "@/lib/team-map";
import { useSidebarPeopleApart } from "@/lib/sidebar-people-apart-preference";
import type { SidebarMenuItem } from "../SidebarPopoverMenu";
import { GENERAL_SECTION_ID } from "./helpers";
import { preview } from "./preview";
import { orgViewerId } from "./useSidebarSections";
import { sidebarListedBots } from "./sidebarListedBots";

/** Derived sidebar roster: pinned tiles, section ids, account places. */
export function useSidebarRoster({
  state,
  layoutBots,
  layoutGroups,
  layoutSections,
  orgMode,
  sidebarHidden,
  sectionOrder,
  remoteClient,
  onShowArchived,
}: {
  state: SidebarState;
  layoutBots: Bot[];
  layoutGroups: Group[];
  layoutSections: string[];
  orgMode: boolean;
  sidebarHidden: SidebarHiddenPrefs;
  sectionOrder: string[];
  remoteClient: boolean;
  onShowArchived: () => void;
}) {
  const peopleApart = useSidebarPeopleApart();
  const sectionParents = useSectionParents();
  const q: string = "";
  const viewerId = orgViewerId(state);
  const hiddenEntries = hiddenKeySet(sidebarHidden);
  const sidebarShown = withoutHiddenEntries(layoutBots, layoutGroups, hiddenEntries, viewerId);
  const sidebarBots = sidebarListedBots(sidebarShown.bots, viewerId, orgMode, layoutSections);
  // The pin grid at the top: the viewer's Primary Bot first, always there
  // with its orange star and role (Grok Bot's head of the list), then the
  // pinned bots. A bot in the grid is not a row below.
  const inTopGrid = (bot: Bot) => Boolean(bot.pinned) || isViewersPrimaryBot(bot, viewerId);
  const pinnedBots = sidebarBots
    .filter((bot) => !bot.hidden && inTopGrid(bot))
    .sort((a, b) => Number(isViewersPrimaryBot(b, viewerId)) - Number(isViewersPrimaryBot(a, viewerId)));
  const matchingBots = sidebarBots
    .filter((b) => !b.hidden)
    .filter(
      (b) =>
        !q ||
        b.name.toLowerCase().includes(q) ||
        (b.title ?? "").toLowerCase().includes(q) ||
        preview(b, visibleMessages(b), state.instances).toLowerCase().includes(q) ||
        b.tasks?.some((task) => !task.routineRunId && task.title.toLowerCase().includes(q)) ||
        b.projects?.some((folder) => folder.name.toLowerCase().includes(q)),
    );
  // Built-in bots get their own section under the person's teams.
  const builtInBots = matchingBots.filter((bot) => isBuiltInBot(bot) && !inTopGrid(bot));
  const teamBots = matchingBots.filter((bot) => !isBuiltInBot(bot));
  const visibleGroups = sidebarShown.groups.filter((g) => !q || g.name.toLowerCase().includes(q) || g.tasks?.some((task) => task.title.toLowerCase().includes(q)));
  const {
    sectionChiefs,
    sectionedBots,
  } = partitionSidebarBots(teamBots, orgMode ? { viewerId } : undefined);
  const { botChats, peopleDms, sectionedRooms, unsectionedRooms } = partitionSidebarGroups(visibleGroups, { peopleApart });

  // User sections keep first-appearance order. The saved layout keeps an
  // empty section's former slot so it returns there when content comes back.
  const sectionNames: string[] = layoutSections.filter((name) => !q || name.toLowerCase().includes(q.toLowerCase()));
  for (const bot of sectionedBots) {
    if (!sectionNames.includes(bot.section!)) sectionNames.push(bot.section!);
  }
  for (const bot of sectionChiefs) {
    if (!sectionNames.includes(bot.section!)) sectionNames.push(bot.section!);
  }
  for (const group of sectionedRooms) {
    if (!sectionNames.includes(group.section!)) sectionNames.push(group.section!);
  }
  const teamNames = [...new Set([
    ...sectionNames,
    ...sectionedRooms.map((group) => group.section!),
  ])];
  const teamOrder = (key: string) => key === "" ? -1 : teamNames.includes(key) ? teamNames.indexOf(key) : teamNames.length;
  const teamMap = buildTeamMapSections(teamBots, teamNames, { general: unsectionedRooms.length > 0, viewerId: orgMode ? viewerId : undefined })
    .sort((a, b) => teamOrder(a.key) - teamOrder(b.key))
    .filter((team) => {
      if (team.key) return true;
      // Pinned bots already sit in the pin grid, so they are not rows here.
      // An Unassigned header with nothing under it stays off. A room still keeps it.
      const botRows = [...team.chiefs, ...team.members].filter((bot) => !inTopGrid(bot)).length;
      return botRows + unsectionedRooms.length > 0;
    });
  const naturalSectionIds = [
    ...teamMap.map((team) => (team.key ? userSectionId(team.key) : GENERAL_SECTION_ID)),
    ...(peopleDms.length > 0 ? [PEOPLE_SECTION_ID] : []),
    ...(botChats.length > 0 ? [BOT_CHATS_SECTION_ID] : []),
  ];
  const orderedSectionIds = orderedSidebarSections(naturalSectionIds, sectionOrder);
  // Organization: Unassigned (what is in no section of yours) stays on top.
  const generalOnTop = orgMode && orderedSectionIds.includes(GENERAL_SECTION_ID);
  const flatSectionIds = generalOnTop ? [GENERAL_SECTION_ID, ...orderedSectionIds.filter((id) => id !== GENERAL_SECTION_ID)] : orderedSectionIds;
  // Sub-teams (#2045): each one follows its parent, a level further in, the
  // same tree as the Team map. The team slots keep their place among the
  // automatic sections; only the order of the teams in them changes.
  const teamById = new Map(teamMap.filter((team) => team.key).map((team) => [userSectionId(team.key), team]));
  const treeRows = orderSectionTree(flatSectionIds.flatMap((id) => teamById.get(id)?.key ?? []), sectionParents);
  for (const row of treeRows) {
    const team = teamById.get(userSectionId(row.name));
    if (team && row.depth > 0) Object.assign(team, { depth: row.depth, parent: row.parent });
  }
  let nextTeam = 0;
  const sectionIds = flatSectionIds.map((id) => teamById.has(id) ? userSectionId(treeRows[nextTeam++]!.name) : id);
  // With no team of the person's own, Unassigned is the whole list: its
  // rows show without a header (2026-10-15). Bot-to-bot threads alone do
  // not count; People does, so Unassigned keeps its header next to it.
  const loneGeneral = !sectionIds.some((sid) => sid !== GENERAL_SECTION_ID && sid !== BOT_CHATS_SECTION_ID);

  const archivedBots = state.bots.filter((bot) => bot.hidden);
  // Grok Bot's foot (2026-10-15): the avatar and the Connect apps pill,
  // nothing else. Archived bots, when there are any, join Achievements
  // in the account menu; Browse bots is in Connect apps' header
  // (2026-10-16).
  const accountPlaces: SidebarMenuItem[] = !remoteClient && archivedBots.length > 0 ? [{
    key: "archived",
    label: t("sidebar.archived.title"),
    icon: <Archive size={18} />,
    trailing: <span className="text-[11.5px] text-ink-secondary">{archivedBots.length}</span>,
    onSelect: onShowArchived,
  }] : [];

  return {
    q,
    viewerId,
    sidebarBots,
    inTopGrid,
    pinnedBots,
    matchingBots,
    builtInBots,
    visibleGroups,
    botChats,
    peopleDms,
    sectionedRooms,
    unsectionedRooms,
    teamMap,
    sectionIds,
    generalOnTop,
    loneGeneral,
    archivedBots,
    accountPlaces,
    peopleApart,
  };
}
