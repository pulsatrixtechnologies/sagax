import { useEffect, useState } from "react";
import type { AppState } from "@/state/store";
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
  state: AppState;
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
  const selectionFor = (botId: string) => ({
    active: selecting,
    selected: selectedBotIds.includes(botId),
    onToggle: () => {
      setSelecting(true);
      setSelectedBotIds((current) => toggleSelected(current, botId));
    },
  });
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
