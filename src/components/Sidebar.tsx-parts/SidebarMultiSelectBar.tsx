import type { SidebarState } from "./types";
import { Archive, CheckCheck, FolderInput, Pin, PinOff, SlidersHorizontal, X } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { showBotArchive, showServerSectionMove } from "@/lib/bot-capabilities";
import { viewerLocalBotSettings } from "@/lib/viewer-bot-overrides";
import { viewerIsOrgMember } from "@/lib/viewer";
import { markBotRead } from "@/lib/folder-read";
import { readableError } from "@/lib/plain-error";
import type { PersonalSections } from "@/lib/personal-sections";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { currentArchivableBot } from "./helpers";
import type { MenuState } from "./types";

export function SidebarMultiSelectBar({
  selecting,
  density,
  state,
  selectedBotIds,
  personal,
  clearSelection,
  setBatchEdit,
  setBatchSectionPicker,
  setBatchArchiveConfirm,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch,
}: {
  selecting: boolean;
  density: SidebarDensity;
  state: SidebarState;
  selectedBotIds: string[];
  personal: PersonalSections | null;
  clearSelection: () => void;
  setBatchEdit: (value: boolean) => void;
  setBatchSectionPicker: (value: MenuState | null) => void;
  setBatchArchiveConfirm: (value: boolean) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch: (action: any) => void;
}) {
  if (!selecting || density === "icons") return null;
  const chosen = selectedBotIds.flatMap((id) => state.bots.filter((bot) => bot.id === id));
  const count = chosen.length;
  const allPinned = count > 0 && chosen.every((bot) => bot.pinned);
  const canMove = showServerSectionMove(state.config, personal !== null, chosen);
  const archivable = chosen.filter((bot) => currentArchivableBot(state.bots, bot.id) && showBotArchive(state.config, bot));
  const button = "flex h-8 min-w-0 flex-1 items-center justify-center rounded-full text-sidebar-ink-secondary hover:bg-sidebar-hover hover:text-sidebar-ink disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className="px-4 pb-2">
    <div data-sidebar-select-bar role="toolbar" aria-label={t("sidebar.select.count", { count })} className="flex h-9 w-full items-center justify-evenly rounded-full border border-sidebar-hairline-weak bg-sidebar-card px-1">
      <button type="button" className={button} disabled={count === 0} title={t("sidebar.select.markRead")} aria-label={t("sidebar.select.markRead")}
        onClick={() => {
          for (const bot of chosen) {
            void markBotRead(bot, api, (updated) => dispatch({ type: "botPatched", bot: updated }))
              .catch((cause) => dispatch({ type: "error", message: readableError(cause) }));
          }
          clearSelection();
        }}><CheckCheck size={16} /></button>
      <button type="button" className={button} disabled={count === 0} title={allPinned ? t("sidebar.bot.unpin") : t("sidebar.bot.pin")} aria-label={allPinned ? t("sidebar.bot.unpin") : t("sidebar.bot.pin")}
        onClick={() => {
          for (const bot of chosen) dispatch({ type: "updateBot", botId: bot.id, patch: { pinned: !allPinned } });
          clearSelection();
        }}>{allPinned ? <PinOff size={16} /> : <Pin size={16} />}</button>
      {/* Edit N bots: the bot editor's sections, changed for all of them (BulkEditBotsDialog) */}
      <button type="button" data-sidebar-select-edit className={cn(button, "flex-[1.6] gap-1 text-[12.5px] font-medium text-sidebar-ink")} disabled={chosen.every((bot) => viewerLocalBotSettings(state.config, bot))} title={t("sidebar.select.edit", { count })} aria-label={t("sidebar.select.edit", { count })} aria-haspopup="dialog"
        onClick={() => setBatchEdit(true)}><SlidersHorizontal size={15} aria-hidden="true" /><span className="truncate">{t("sidebar.select.editShort")}</span></button>
      {canMove && <button type="button" className={button} disabled={count === 0} title={t("sidebar.select.move", { count })} aria-label={t("sidebar.select.move", { count })} aria-haspopup="menu"
        onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setBatchSectionPicker({ botId: "", x: rect.left, y: rect.top - 260 }); }}><FolderInput size={16} /></button>}
      {(!viewerIsOrgMember(state.config) || archivable.length > 0) && <button type="button" className={button} disabled={archivable.length === 0} title={t("sidebar.bot.archive")} aria-label={t("sidebar.bot.archive")}
        onClick={() => setBatchArchiveConfirm(true)}><Archive size={16} /></button>}
      <button type="button" className={button} title={t("sidebar.select.clear")} aria-label={t("sidebar.select.clear")} onClick={clearSelection}><X size={16} /></button>
    </div>
    </div>
  );
}
