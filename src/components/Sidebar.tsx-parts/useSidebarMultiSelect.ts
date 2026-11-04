import type { SidebarState } from "./types";
import { useEffect, useRef, useState } from "react";
import { showBotArchive } from "@/lib/bot-capabilities";
import { toggleSelected } from "@/lib/bot-unread";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { currentArchivableBot } from "./helpers";
import type { MenuState } from "./types";

/** Multi-select (Cmd/Ctrl-click or "Select" in a row's menu): grouped actions
 * on bots. `selecting` stays on while the bar is open, even at zero. */
export function useSidebarMultiSelect({
  state,
  density,
}: {
  state: SidebarState;
  density: SidebarDensity;
}) {
  const [selecting, setSelecting] = useState(false);
  const [selectedBotIds, setSelectedBotIds] = useState<string[]>([]);
  const [batchEdit, setBatchEdit] = useState(false);
  const [batchSectionPicker, setBatchSectionPicker] = useState<MenuState | null>(null);
  const [batchArchiveConfirm, setBatchArchiveConfirm] = useState(false);
  // a member archives only the bots they own (showBotArchive)
  const archivableByViewer = (id: string) => {
    const bot = state.bots.find((candidate) => candidate.id === id);
    return Boolean(bot) && Boolean(currentArchivableBot(state.bots, id)) && showBotArchive(state.config, bot!);
  };
  const clearSelection = () => {
    setSelecting(false);
    setSelectedBotIds([]);
    setBatchSectionPicker(null);
  };
  const selections = useRef(new Map<string, { active: boolean; selected: boolean; onToggle: () => void }>());
  // Stable row props let a live preview update its own row only. Toggle
  // closures capture just the id and use React's current-state setter.
  const selectionFor = (botId: string) => {
    const selected = selectedBotIds.includes(botId);
    const held = selections.current.get(botId);
    if (held && held.active === selecting && held.selected === selected) return held;
    const next = {
      active: selecting, selected,
      onToggle: held?.onToggle ?? (() => {
        setSelecting(true);
        setSelectedBotIds((current) => toggleSelected(current, botId));
      }),
    };
    selections.current.set(botId, next);
    return next;
  };
  useEffect(() => {
    const ids = new Set(state.bots.map((bot) => bot.id));
    for (const id of selections.current.keys()) if (!ids.has(id)) selections.current.delete(id);
  }, [state.bots]);
  // The rail has no bar: leaving the wide sidebar ends the selection.
  useEffect(() => {
    if (density === "icons" && selecting) clearSelection();
  });
  // Escape leaves the selection (unless a menu or dialog already took it).
  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA"].includes(event.target.tagName));
      if (event.key === "Escape" && !typing && !event.defaultPrevented && !document.querySelector("[role=dialog], [role=menu], [data-section-picker]")) clearSelection();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return {
    selecting,
    setSelecting,
    selectedBotIds,
    setSelectedBotIds,
    batchEdit,
    setBatchEdit,
    batchSectionPicker,
    setBatchSectionPicker,
    batchArchiveConfirm,
    setBatchArchiveConfirm,
    archivableByViewer,
    clearSelection,
    selectionFor,
  };
}
