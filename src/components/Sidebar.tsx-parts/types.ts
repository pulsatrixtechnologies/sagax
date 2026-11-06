import type { RefObject } from "react";
import type { AppState, Bot, Group } from "@/state/store";
import type { SectionItemKind } from "@/lib/personal-sections";
import type { SectionDropPlace } from "@/lib/sidebar-layout";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import type { hiddenSidebarRows } from "@/lib/sidebar-hidden-entries";

/** State read by the sidebar's prop-only layout helpers. */
export type SidebarState = Pick<AppState, "activeView" | "bots" | "groups" | "config" | "instances" | "pendingQueued" | "sections" | "selectedId">;

export interface MenuState {
  botId: string;
  x: number;
  y: number;
}

export type TeamFeedback = {
  error: boolean;
  text: string;
  restoreBot?: { id: string; name: string };
};

export type TeamMapEntry = {
  key: string;
  /** Displayed team label (#2045 / #2083). Sidebar slots and sub-teams use this. */
  name: string;
  chiefs: Bot[];
  members: Bot[];
  /** Sub-team level (#2045), 0 or absent at the top. */
  depth?: number;
  parent?: string;
};

export type ItemDragProps = {
  draggable: true;
  "data-sidebar-item-drag": SectionItemKind;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
};

export type SelectionFor = (botId: string) => {
  active: boolean;
  selected: boolean;
  onToggle: () => void;
};

export type SectionListDrag = {
  draggingSectionId: string | null;
  dropTarget: { id: string; place: SectionDropPlace } | null;
  itemDropId: string | null;
  setItemDropId: (id: string | null) => void;
  setDraggingSectionId: (id: string | null) => void;
  sectionDragRef: RefObject<{ from: string | null; over: { id: string; place: SectionDropPlace } | null }>;
  acceptItemDrag: (event: React.DragEvent<HTMLDivElement>, id: string) => boolean;
  updateSectionDropTarget: (event: React.DragEvent<HTMLDivElement>, id: string) => void;
  dropItem: (event: React.DragEvent<HTMLDivElement>, id: string, section: string) => boolean;
  dropSection: (event: React.DragEvent<HTMLDivElement>) => void;
  resetSectionDrag: () => void;
  itemDragProps: (kind: SectionItemKind, itemId: string) => ItemDragProps;
  toggleSection: (id: string) => void;
  moveSidebarSection: (id: string, direction: -1 | 1) => void;
  layoutInteractive: boolean;
};

export type SidebarSectionListProps = {
  density: SidebarDensity;
  quietRows: boolean;
  q: string;
  state: SidebarState;
  sectionIds: string[];
  teamMap: TeamMapEntry[];
  botChats: Group[];
  peopleDms: Group[];
  sectionedRooms: Group[];
  unsectionedRooms: Group[];
  builtInBots: Bot[];
  loneGeneral: boolean;
  sectionCollapsed: (id: string) => boolean;
  inTopGrid: (bot: Bot) => boolean;
  renameBotId: string | null;
  setRenameBotId: (id: string | null) => void;
  setMenu: (menu: MenuState) => void;
  setRoomMenu: (menu: { groupId: string; x: number; y: number }) => void;
  selectionFor: SelectionFor;
  orgMode: boolean;
  remoteClient: boolean;
  sectionEdit: { mode: "rename"; name: string } | null;
  setSectionEdit: (value: { mode: "rename"; name: string } | null) => void;
  renameOrgSection: (oldName: string, name: string) => Promise<string | null>;
  openOrgMenu: (event: React.MouseEvent<HTMLElement>, name: string | null, id: string | null) => void;
  teamMenuReturn: RefObject<HTMLElement | null>;
  setTeamMenu: (value: { name: string; x: number; y: number }) => void;
  drag: SectionListDrag;
  hiddenRows: ReturnType<typeof hiddenSidebarRows>;
};
