import type { ReactNode } from "react";
import { Eye, FileDiff, Pencil, Power, Share2, Trash2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { changedAfterReview } from "./helpers";
import type { ManagedSkill, SkillRowActions } from "./types";

export interface SkillAction {
  id: "open" | "edit" | "review" | "toggle" | "share" | "unshare" | "remove";
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  run: () => void;
}

/** What a person can do with one skill, in one list: the row's more menu
 * draws every item, the opened skill draws the ones it does not already
 * show (#4148). On and off are a plain item here, never a switch. */
export function skillActions(a: SkillRowActions, skill: ManagedSkill): SkillAction[] {
  const { libraryOn, skillWrites, working, openSkill, toggle, share, unshare, remove, reviewSkill } = a;
  const busy = Boolean(working);
  const items: SkillAction[] = [
    { id: "open", icon: <Eye size={14} />, label: t("botPanel.skills.open"), run: () => openSkill(skill) },
  ];
  if (!skillWrites || skill.origin === "native") return items;
  if (changedAfterReview(skill)) {
    items.push({ id: "review", icon: <FileDiff size={14} />, label: t("botPanel.skills.reviewChanges"), run: () => reviewSkill(skill) });
  }
  items.push(
    { id: "edit", icon: <Pencil size={14} />, label: t("botPanel.skills.edit"), run: () => openSkill(skill, true) },
    {
      id: "toggle",
      icon: <Power size={14} />,
      label: t(skill.enabled ? "connectApps.skill.turnOff" : "connectApps.skill.turnOn"),
      disabled: busy,
      run: () => void toggle(skill),
    },
  );
  if (libraryOn && skill.origin === "private") {
    items.push({ id: "share", icon: <Share2 size={14} />, label: t("botPanel.skills.shareMe"), disabled: busy, run: () => void share(skill, "me") });
  }
  if (libraryOn && (skill.origin === "me" || skill.origin === "library")) {
    items.push({ id: "unshare", icon: <Share2 size={14} />, label: t("botPanel.skills.unshare"), disabled: busy, run: () => void unshare(skill) });
  }
  items.push({ id: "remove", icon: <Trash2 size={14} />, label: t("botPanel.skills.removeTitle"), disabled: busy, run: () => void remove(skill) });
  return items;
}
