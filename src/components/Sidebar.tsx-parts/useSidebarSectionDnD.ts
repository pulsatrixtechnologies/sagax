import { useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { addBotCalendarDrag } from "@/lib/bot-drag";
import { SPLIT_DRAG_TYPE, splitDragData } from "@/lib/split-view";
import { FOLDER_DRAG_TYPE, THREAD_DRAG_TYPE } from "@/lib/folder-order";
import {
  mergeSectionOrder,
  moveSection,
  placeSection,
  sameSectionOrder,
  sidebarLayoutInteractive,
  sidebarSectionCollapsed,
  type SectionDropPlace,
} from "@/lib/sidebar-layout";
import {
  saveCollapsedSections,
  saveSectionOrder,
  toggleCollapsedSection,
  type SidebarDensity,
} from "@/lib/sidebar-preferences";
import type { SectionItemKind } from "@/lib/personal-sections";
import { ITEM_DRAG_TYPE, isAutomaticSidebarSection, parseItemDrag, sectionLabel } from "./helpers";

/** Section collapse/reorder and item drag onto sections. */
export function useSidebarSectionDnD({
  density,
  q,
  sectionIds,
  sectionOrder,
  setSectionOrder,
  collapsedSections,
  setCollapsedSections,
  assignSection,
}: {
  density: SidebarDensity;
  q: string;
  sectionIds: string[];
  sectionOrder: string[];
  setSectionOrder: (next: string[]) => void;
  collapsedSections: string[];
  setCollapsedSections: (next: string[]) => void;
  assignSection: (kind: SectionItemKind, id: string, section: string) => void;
}) {
  const [draggingSectionId, setDraggingSectionId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; place: SectionDropPlace } | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const sectionDragRef = useRef<{
    from: string | null;
    over: { id: string; place: SectionDropPlace } | null;
  }>({ from: null, over: null });
  const [itemDropId, setItemDropId] = useState<string | null>(null);

  const layoutInteractive = sidebarLayoutInteractive(density, q);
  const sectionCollapsed = (id: string) =>
    sidebarSectionCollapsed(id, collapsedSections, density, q);

  const toggleSection = (id: string) => {
    if (!layoutInteractive) return;
    const next = toggleCollapsedSection(collapsedSections, id);
    setCollapsedSections(next);
    saveCollapsedSections(next);
  };

  const commitSectionOrder = (visibleOrder: string[]) => {
    if (!layoutInteractive) return;
    const next = mergeSectionOrder(sectionOrder, visibleOrder);
    if (sameSectionOrder(next, sectionOrder)) return;
    setSectionOrder(next);
    saveSectionOrder(next);
  };

  const announceSectionPosition = (id: string, visibleOrder: string[]) => {
    const position = visibleOrder.indexOf(id);
    if (position < 0) return;
    setReorderAnnouncement(
      t("sidebar.section.moved", {
        name: sectionLabel(id),
        position: position + 1,
        count: visibleOrder.length,
      }),
    );
  };

  const moveSidebarSection = (id: string, direction: -1 | 1) => {
    const next = moveSection(sectionIds, id, direction);
    if (sameSectionOrder(next, sectionIds)) return;
    commitSectionOrder(next);
    announceSectionPosition(id, next);
  };

  const resetSectionDrag = () => {
    sectionDragRef.current = { from: null, over: null };
    setDraggingSectionId(null);
    setDropTarget(null);
  };

  const updateSectionDropTarget = (event: React.DragEvent<HTMLDivElement>, id: string) => {
    if (!layoutInteractive || !sectionDragRef.current.from) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const place: SectionDropPlace = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    const next = { id, place };
    sectionDragRef.current.over = next;
    setDropTarget(next);
  };

  // Dragging a bot or a group onto a section files it there (Unassigned: in
  // none). Bot-to-bot chats are a view, not something to file.
  // A bot row also carries the calendar's payload (2026-10-18): dropped on a
  // time of Automations it schedules that bot, the same routine and dialog
  // as the calendar's own drag. That one works in every density and while
  // searching; filing into a section keeps its own rule. Every bot and group
  // row also carries the split view's payload (#1504): dropped on the
  // conversation area, it opens in a section of its own.
  const itemDragProps = (kind: SectionItemKind, itemId: string) => ({
    draggable: true as const,
    "data-sidebar-item-drag": kind,
    onDragStart: (event: React.DragEvent<HTMLDivElement>) => {
      if (event.target instanceof Element && event.target.closest("[data-sidebar-folder-row],[data-sidebar-folder-label],[data-sidebar-thread-row],[data-sidebar-thread-drag]")) return;
      event.dataTransfer.effectAllowed = "move";
      if (layoutInteractive) event.dataTransfer.setData(ITEM_DRAG_TYPE, JSON.stringify({ kind, id: itemId }));
      event.dataTransfer.setData(SPLIT_DRAG_TYPE, splitDragData({ kind, id: itemId }));
      if (kind === "bot") addBotCalendarDrag(event.dataTransfer, itemId);
    },
    onDragEnd: () => setItemDropId(null),
  });
  const acceptItemDrag = (event: React.DragEvent<HTMLDivElement>, id: string): boolean => {
    if (!event.dataTransfer.types.includes(ITEM_DRAG_TYPE)) return false;
    if (isAutomaticSidebarSection(id)) return true;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (itemDropId !== id) setItemDropId(id);
    return true;
  };
  const dropItem = (event: React.DragEvent<HTMLDivElement>, id: string, section: string): boolean => {
    if (!event.dataTransfer.types.includes(ITEM_DRAG_TYPE)) return false;
    event.preventDefault();
    setItemDropId(null);
    if (isAutomaticSidebarSection(id)) return true;
    const item = parseItemDrag(event.dataTransfer.getData(ITEM_DRAG_TYPE));
    if (item) assignSection(item.kind, item.id, section);
    return true;
  };

  const dropSection = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes(FOLDER_DRAG_TYPE) || event.dataTransfer.types.includes(THREAD_DRAG_TYPE)) return;
    event.preventDefault();
    const from =
      event.dataTransfer.getData("application/x-openmausbot-sidebar-section") ||
      event.dataTransfer.getData("text/plain") ||
      sectionDragRef.current.from;
    const over = sectionDragRef.current.over;
    if (from && over) {
      const next = placeSection(sectionIds, from, over.id, over.place);
      if (!sameSectionOrder(next, sectionIds)) {
        commitSectionOrder(next);
        announceSectionPosition(from, next);
      }
    }
    resetSectionDrag();
  };

  return {
    draggingSectionId,
    setDraggingSectionId,
    dropTarget,
    reorderAnnouncement,
    sectionDragRef,
    itemDropId,
    setItemDropId,
    layoutInteractive,
    sectionCollapsed,
    toggleSection,
    moveSidebarSection,
    resetSectionDrag,
    updateSectionDropTarget,
    itemDragProps,
    acceptItemDrag,
    dropItem,
    dropSection,
  };
}
