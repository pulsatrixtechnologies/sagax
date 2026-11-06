import { editSectionParents, renameInSectionTree } from "@/lib/section-tree";
import type { SidebarState } from "./types";
import { useEffect, useRef, useState, type RefObject } from "react";
import { api, type Bot, type Group } from "@/state/store";
import { useHeldMenuMotion } from "../MenuMotion";
import { useOrgPeople, usePerspicaxOrg } from "@/lib/perspicax-org";
import {
  entriesToUnhide,
  hiddenKey,
  hiddenKeySet,
  showInSidebar,
  useSidebarHidden,
} from "@/lib/sidebar-hidden";
import { closedDmToReopen, groupHiddenKey } from "@/lib/sidebar-hidden-entries";
import {
  EMPTY_PERSONAL_SECTIONS,
  editPersonalSections,
  itemKey,
  personalSectionNames,
  renamePersonalSection,
  seedPersonalSections,
  usePersonalSections,
  withPersonalSections,
  writePersonalSections,
  type PersonalSections,
  type SectionItemKind,
} from "@/lib/personal-sections";
import {
  loadCollapsedSections,
  loadSectionOrder,
  SIDEBAR_COLLAPSED_SECTIONS_KEY,
  SIDEBAR_SECTION_ORDER_KEY,
  saveCollapsedSections,
  saveSectionOrder,
} from "@/lib/sidebar-preferences";
import { userSectionId } from "@/lib/sidebar-layout";
import { readableError } from "@/lib/plain-error";
import { viewerActorId } from "@/lib/viewer";
import { assignPersonalSection, sectionEditMessage } from "./helpers";

function orgViewerId(state: Pick<SidebarState, "config">): string {
  // The server's principal for this viewer; older servers: the profile
  // email, else the same "local-owner" fallback as the server actor id.
  return viewerActorId(state.config);
}

/** Personal sections, collapsed/order, team/org menus, assignSection. */
export function useSidebarSections({
  state,
  dispatch,
  remoteClient,
  sidebarRef,
  setTeamFeedback,
}: {
  state: SidebarState;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch: (action: any) => void;
  remoteClient: boolean;
  sidebarRef: RefObject<HTMLElement | null>;
  setTeamFeedback: (value: { error: boolean; text: string; restoreBot?: { id: string; name: string } } | null) => void;
}) {
  const [teamMenu, setTeamMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const teamMotion = useHeldMenuMotion(teamMenu);
  const teamMenuReturn = useRef<HTMLElement | null>(null);
  const closeTeamMenu = () => {
    (teamMenuReturn.current?.isConnected ? teamMenuReturn.current : sidebarRef.current)?.focus();
    setTeamMenu(null);
  };
  const [collapsedSections, setCollapsedSections] = useState<string[]>(() => loadCollapsedSections());
  const [sectionOrder, setSectionOrder] = useState<string[]>(() => loadSectionOrder());
  const renamedTeam = (oldName: string, newName: string) => {
    const replace = (ids: string[]) => [...new Set(ids.map(id => id === userSectionId(oldName) ? userSectionId(newName) : id))];
    setCollapsedSections(current => { const next = replace(current); saveCollapsedSections(next); return next; });
    setSectionOrder(current => { const next = replace(current); saveSectionOrder(next); return next; });
    requestAnimationFrame(() => {
      const header = [...(sidebarRef.current?.querySelectorAll<HTMLElement>("[data-section]") ?? [])]
        .find(element => element.dataset.section === newName);
      (header?.querySelector<HTMLElement>("button") ?? header ?? sidebarRef.current)?.focus();
    });
  };
  const [deletingTeam, setDeletingTeam] = useState<string | null>(null);
  const [teamDeletePending, setTeamDeletePending] = useState(false);
  const teamDeleteRunning = useRef(false);
  const [moveToTeam, setMoveToTeam] = useState<string | null>(null);
  const [renameTeam, setRenameTeam] = useState<string | null>(null);
  const [shareTeam, setShareTeam] = useState<string | null>(null);
  // Approval levels and models are the owner's to set, as in each bot's panel.
  const [teamSettings, setTeamSettings] = useState<string | null>(null);
  // The section header that opened the team menu. The menu closes on Share,
  // so the popover hangs off this trigger, which stays mounted.
  const shareTeamAnchor = useRef<HTMLElement | null>(null);
  // Slice 4: sections are channels on a server signed in with Perspicax.
  const perspicaxOrg = usePerspicaxOrg();
  const orgMode = perspicaxOrg !== null;
  const sidebarHidden = useSidebarHidden();
  const sidebarPeople = useOrgPeople();
  // A new message brings a hidden entry back, per the person's setting
  // (people on, bots off by default; Settings > Appearance).
  useEffect(() => {
    if (!sidebarHidden.items.length) return;
    const me = orgViewerId(state);
    const keys = entriesToUnhide(sidebarHidden, {
      bots: state.bots,
      groups: state.groups,
      personGroup: (personId) => state.groups.find((group) => group.peopleDm && groupHiddenKey(group, me) === hiddenKey("person", personId)),
    });
    if (keys.length) showInSidebar(keys);
  }, [sidebarHidden, state.bots, state.groups, state.config]);
  // Selecting a closed direct conversation (person panel, To: picker,
  // search, a nudge) brings it back. Only a change of selection counts, so
  // closing the conversation that is open leaves it closed.
  useEffect(() => {
    if (state.activeView !== "chat" || !state.selectedId) return;
    const key = closedDmToReopen(state.groups.find((candidate) => candidate.id === state.selectedId), hiddenKeySet(sidebarHidden), orgViewerId(state));
    if (key) showInSidebar(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedId, state.activeView]);
  const [orgMenu, setOrgMenu] = useState<{ name: string | null; id: string | null; x: number; y: number } | null>(null);
  const [sectionEdit, setSectionEdit] = useState<{ mode: "rename"; name: string } | null>(null);
  // Organization: the viewer's own sections (personal-sections.ts). The
  // first time, they start from the sections the server gave their bots.
  const personalStored = usePersonalSections();
  const personal: PersonalSections | null = orgMode ? personalStored ?? EMPTY_PERSONAL_SECTIONS : null;
  const loaded = state.config !== null && state.config !== undefined;
  useEffect(() => {
    if (!orgMode || personalStored !== null || !loaded) return;
    if (!state.bots.length && !state.groups.length) return;
    writePersonalSections(seedPersonalSections({ bots: state.bots, groups: state.groups, sections: state.sections ?? [], viewerId: orgViewerId(state) }));
  }, [orgMode, personalStored, loaded, state.bots, state.groups, state.sections, state.config]);
  // What the sidebar lays out: on an organization server each bot and group
  // sits in the viewer's own section (undefined: Unassigned), whatever the
  // server's section field says.
  const personalView = personal ? withPersonalSections(state.bots, state.groups, personal) : null;
  const layoutBots = personalView?.bots ?? state.bots;
  const layoutGroups = personalView?.groups ?? state.groups;
  const layoutSections = personal ? personalSectionNames(personal) : state.sections ?? [];
  const knownItems = new Set([...state.bots.map((bot) => itemKey("bot", bot.id)), ...state.groups.map((group) => itemKey("group", group.id))]);
  const openOrgMenu = (event: React.MouseEvent<HTMLElement>, name: string | null, id: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    teamMenuReturn.current = event.currentTarget.querySelector<HTMLElement>("button") ?? event.currentTarget;
    // Shift+F10 and the ContextMenu key arrive with no pointer position.
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX || rect.left + 16;
    const y = event.clientY || rect.bottom;
    setOrgMenu({ name, id, x: Math.max(8, Math.min(x, window.innerWidth - 230)), y: Math.max(8, Math.min(y, window.innerHeight - 280)) });
  };
  const closeOrgMenu = () => {
    (teamMenuReturn.current?.isConnected ? teamMenuReturn.current : sidebarRef.current)?.focus();
    setOrgMenu(null);
  };
  const renameOrgSection = async (oldName: string, name: string): Promise<string | null> => {
    const code = editPersonalSections((prefs) => renamePersonalSection(prefs, oldName, name));
    if (code) return sectionEditMessage(code);
    editSectionParents((tree) => renameInSectionTree(tree, oldName, name.trim()));
    setSectionEdit(null);
    renamedTeam(oldName, name.trim());
    return null;
  };
  /** Files a bot or a group in a section ("" = Unassigned): the viewer's own on
   * an organization server, the server's otherwise. */
  const assignSection = (kind: SectionItemKind, id: string, section: string) => {
    if (personal) {
      const failed = assignPersonalSection(kind, id, section, knownItems);
      if (failed) setTeamFeedback({ error: true, text: failed });
      return;
    }
    if (kind === "group") {
      dispatch({ type: "patchGroup", groupId: id, patch: { section } });
      return;
    }
    if (!remoteClient) {
      dispatch({ type: "updateBot", botId: id, patch: { section } });
      return;
    }
    void api("/api/sidebar-sections", {
      method: "POST",
      body: JSON.stringify({ name: section, botIds: [id] }),
    })
      .then(({ bots }) => bots.forEach((bot: Bot) => dispatch({ type: "botPatched", bot })))
      .catch((cause) => dispatch({ type: "error", message: readableError(cause) }));
  };

  // Folds and order follow the person (shared/user-preferences.ts): another
  // device's change arrives as a storage event for its key and shows here.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === SIDEBAR_COLLAPSED_SECTIONS_KEY) setCollapsedSections(loadCollapsedSections());
      if (event.key === null || event.key === SIDEBAR_SECTION_ORDER_KEY) setSectionOrder(loadSectionOrder());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return {
    teamMenu,
    setTeamMenu,
    teamMotion,
    teamMenuReturn,
    closeTeamMenu,
    renamedTeam,
    deletingTeam,
    setDeletingTeam,
    teamDeletePending,
    setTeamDeletePending,
    teamDeleteRunning,
    moveToTeam,
    setMoveToTeam,
    renameTeam,
    setRenameTeam,
    shareTeam,
    setShareTeam,
    teamSettings,
    setTeamSettings,
    shareTeamAnchor,
    orgMode,
    sidebarHidden,
    sidebarPeople,
    orgMenu,
    setOrgMenu,
    sectionEdit,
    setSectionEdit,
    personal,
    layoutBots,
    layoutGroups,
    layoutSections,
    openOrgMenu,
    closeOrgMenu,
    renameOrgSection,
    assignSection,
    collapsedSections,
    setCollapsedSections,
    sectionOrder,
    setSectionOrder,
    orgViewerId: () => orgViewerId(state),
  };
}

// re-export for roster / DnD callers that need the same helper
export { orgViewerId };
export type { Bot, Group };
