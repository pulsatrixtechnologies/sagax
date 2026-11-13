import { t } from "@/lib/i18n";
import type { ManagedSkill } from "./types";

export const originLabel = (skill: ManagedSkill) => {
  if (skill.origin === "native") return t("skills.origin.native");
  if (skill.origin === "me" || skill.origin === "library") return t("botPanel.skills.originShared");
  return t("botPanel.skills.originPrivate");
};

/** The server's warning for a SKILL.md changed after its review. */
export const isChangedAfterReviewWarning = (warning: string) => warning.includes("changed after review");

export const changedAfterReview = (skill: ManagedSkill) => skill.warnings.some(isChangedAfterReviewWarning);
