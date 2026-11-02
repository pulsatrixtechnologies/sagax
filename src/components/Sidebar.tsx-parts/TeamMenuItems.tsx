import { Pencil, Share2, Trash2, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export function TeamMenuItems({ onAddBots, onRename, onShare, onDelete }: {
  onAddBots: () => void;
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const item = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover";
  return (
    <>
      <button type="button" role="menuitem" autoFocus className={item} onClick={onAddBots}><Users size={14} />{t("team.addBots")}</button>
      <button type="button" role="menuitem" className={item} onClick={onRename}><Pencil size={14} />{t("team.rename")}</button>
      <button type="button" role="menuitem" className={item} onClick={onShare}><Share2 size={14} />{t("team.share")}</button>
      <button type="button" role="menuitem" className={cn(item, "text-danger")} onClick={onDelete}><Trash2 size={14} />{t("team.delete")}</button>
    </>
  );
}
