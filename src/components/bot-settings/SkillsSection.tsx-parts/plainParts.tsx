import { BookOpen, ChevronDown, Eye } from "lucide-react";
import { useId, useState } from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { skillSourceLabel } from "@/lib/skills-ui";
import { PILL, Switch } from "../../SettingsPrimitives";
import { changedAfterReview, originLabel } from "./helpers";
import { renderRowMenu } from "./rowMenu";
import type { ManagedSkill, SkillRowActions } from "./types";

/** The plain surface's fold for a skill's source: InlineFold's look, the
 * label in the row's grey weight (no medium weight on the profile page). */
function PlainSourceFold({ label, source }: { label: string; source: string }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div data-inline-fold={open ? "open" : "closed"} className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-[44px] items-center gap-1 rounded-md text-[12px] text-ink-secondary outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none md:min-h-[28px]"
      >
        {label}
        <ChevronDown size={13} aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      <div id={bodyId} hidden={!open} className="mt-1">
        <p className="break-all font-mono text-[11px] text-ink-secondary" title={source}>{source}</p>
      </div>
    </div>
  );
}

const iconButton = "flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink disabled:opacity-40";

export function renderPlainSkillRow(a: SkillRowActions, skill: ManagedSkill) {
  const { libraryOn, skillWrites, working, openSkill, toggle } = a;
  const showOrigin = libraryOn || skill.origin === "native";
  const sharedWith = libraryOn && (skill.origin === "me" || skill.origin === "library") ? skill.assignedBots ?? [] : [];
  const reviewAgain = changedAfterReview(skill);
  return (
    <div key={skill.name} className="flex min-h-[56px] flex-col justify-center px-4 py-2.5" data-skill-row={skill.name}>
      <div className="flex items-center gap-3">
        <BookOpen aria-hidden="true" className="size-5 shrink-0 text-ink-secondary" />
        <button
          type="button"
          onClick={() => openSkill(skill)}
          className="flex min-w-0 flex-1 flex-col text-left"
          data-skill-open={skill.name}
        >
          <span className="truncate text-[14px] leading-5 text-ink" data-skill-name="">{skill.name}</span>
          {(showOrigin || skill.description) && (
            <span className="line-clamp-2 text-[12px] leading-4 text-ink-secondary">
              {showOrigin && (
                <span title={skill.origin === "native" ? t("skills.origin.nativeHint") : undefined} data-skill-origin="">
                  {originLabel(skill)}
                </span>
              )}
              {showOrigin && skill.description && " · "}
              {skill.description}
            </span>
          )}
        </button>
        {skillWrites && skill.origin !== "native" && (
          <>
            <Switch
              checked={skill.enabled}
              aria-label={t(skill.enabled ? "botPanel.skills.disable" : "botPanel.skills.enable", { name: skill.name })}
              disabled={Boolean(working)}
              onClick={() => void toggle(skill)}
            />
            {renderRowMenu(a, skill, iconButton)}
          </>
        )}
        {skill.origin === "native" && (
          <button type="button" onClick={() => openSkill(skill)} className={iconButton} aria-label={t("botPanel.skills.open")}>
            <Eye size={15} />
          </button>
        )}
      </div>
      {(skill.source || sharedWith.length > 0 || skill.warnings.length > 0) && (
        <div className="flex flex-col gap-0.5 pl-8">
          {skill.source && (
            <div data-skill-source={skill.name}>
              <PlainSourceFold label={t("botPanel.skills.sourceLabel", { label: skillSourceLabel(skill.source) })} source={skill.source} />
            </div>
          )}
          {sharedWith.length > 0 && (
            <p className="text-[12px] leading-4 text-ink-secondary">
              {t("botPanel.skills.sharedWith", { bots: sharedWith.map((entry) => entry.name).join(", ") })}
            </p>
          )}
          {reviewAgain ? (
            <div className="flex flex-wrap items-center gap-2 py-1 text-[12px] text-warning" data-skill-warning={skill.name}>
              <span>{t("botPanel.skills.changedAfterReview")}</span>
              <button type="button" className={PILL} onClick={() => openSkill(skill)}>
                {t("botPanel.skills.reviewChanges")}
              </button>
            </div>
          ) : skill.warnings.length > 0 ? (
            <p className="text-[12px] leading-4 text-warning">{skill.warnings.join(" · ")}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
