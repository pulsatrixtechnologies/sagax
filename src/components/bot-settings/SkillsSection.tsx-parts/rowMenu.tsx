import { Ellipsis, Eye, Pencil, Share2, Trash2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { MenuItem, PopoverMenu } from "../FilesSection";
import type { ManagedSkill, SkillRowActions } from "./types";

export function renderRowMenu(a: SkillRowActions, skill: ManagedSkill, buttonClass: string) {
  const { libraryOn, working, openSkill, share, unshare, remove } = a;
  return (
  <PopoverMenu
    label={t("botPanel.skills.rowMenu", { name: skill.name })}
    menuLabel={t("botPanel.skills.rowMenu", { name: skill.name })}
    icon={<Ellipsis size={15} />}
    buttonClass={buttonClass}
    data-skill-row-menu={skill.name}
  >
    {(close) => (
      <>
        <MenuItem icon={<Eye size={14} />} label={t("botPanel.skills.open")} onClick={() => { close(); openSkill(skill); }} />
        <MenuItem icon={<Pencil size={14} />} label={t("botPanel.skills.edit")} onClick={() => { close(); openSkill(skill, true); }} />
        {libraryOn && skill.origin === "private" && (
          <MenuItem
            icon={<Share2 size={14} />}
            label={t("botPanel.skills.shareMe")}
            disabled={Boolean(working)}
            onClick={() => { close(); void share(skill, "me"); }}
          />
        )}
        {libraryOn && (skill.origin === "me" || skill.origin === "library") && (
          <MenuItem
            icon={<Share2 size={14} />}
            label={t("botPanel.skills.unshare")}
            disabled={Boolean(working)}
            onClick={() => { close(); void unshare(skill); }}
          />
        )}
        <MenuItem
          icon={<Trash2 size={14} />}
          label={t("botPanel.skills.removeTitle")}
          disabled={Boolean(working)}
          onClick={() => { close(); void remove(skill); }}
        />
      </>
    )}
  </PopoverMenu>
  );
}
