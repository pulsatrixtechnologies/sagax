import { Ellipsis } from "lucide-react";
import { t } from "@/lib/i18n";
import { MenuItem, PopoverMenu } from "../FilesSection";
import { skillActions, type SkillAction } from "./actions";
import type { ManagedSkill, SkillRowActions } from "./types";

/** The skill row's more menu. The plain row has no switch and no review
 * line, so its menu carries Turn on / Turn off and Review changes (#4148);
 * the classic row keeps its switch and its inline Review changes. */
export function renderRowMenu(a: SkillRowActions, skill: ManagedSkill, buttonClass: string, compact = false) {
  const items = skillActions(a, skill).filter((item: SkillAction) => compact || (item.id !== "toggle" && item.id !== "review"));
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
        {items.map((item) => (
          <MenuItem
            key={item.id}
            icon={item.icon}
            label={item.label}
            disabled={item.disabled}
            data-skill-menu-item={item.id}
            onClick={() => { close(); item.run(); }}
          />
        ))}
      </>
    )}
  </PopoverMenu>
  );
}
