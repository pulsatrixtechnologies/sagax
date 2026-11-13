import { BookOpen, Eye, Users } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { PILL } from "../../SettingsPrimitives";
import { ProfileRow } from "../ProfileRow";
import { skillActions } from "./actions";
import { isChangedAfterReviewWarning } from "./helpers";
import { renderRowMenu } from "./rowMenu";
import type { ManagedSkill, SkillRowActions } from "./types";

const iconButton = "flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-40";

/** A skill that waits for the person: changed after its review, or any
 * warning to read (#4104 keeps it above the fold, #4148 says so on the row). */
export const skillNeedsPerson = (skill: ManagedSkill) => skill.warnings.length > 0;

/** The bots a shared skill is shared with, or null for a private one. */
function sharedLabel(a: SkillRowActions, skill: ManagedSkill): string | null {
  if (!a.libraryOn || (skill.origin !== "me" && skill.origin !== "library")) return null;
  const bots = (skill.assignedBots ?? []).map((entry) => entry.name);
  return bots.length > 0 ? t("botPanel.skills.sharedWith", { bots: bots.join(", ") }) : t("botPanel.skills.detailShared");
}

/** The small people glyph of a shared skill (#4148): who it is shared with
 * shows on hover, on keyboard focus and on a tap, and is its accessible
 * name. */
function SharedGlyph({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label}
        data-skill-shared=""
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
        className={iconButton}
      >
        <Users size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          data-skill-shared-tip=""
          className="pointer-events-none absolute bottom-[calc(100%+4px)] right-0 z-30 w-max max-w-[240px] rounded-lg bg-panel px-2.5 py-1.5 text-[12px] leading-4 text-ink shadow-xl ring-1 ring-ink/10 popover-surface"
        >
          {label}
        </span>
      )}
    </span>
  );
}

/** The grey line of a skill row: a short orange state when it needs the
 * person, "Off" when it is off, then its description cut to one line. */
function skillStateLine(skill: ManagedSkill) {
  const needs = skillNeedsPerson(skill);
  const off = !skill.enabled && skill.origin !== "native";
  const parts: ReactNode[] = [];
  if (needs) parts.push(<span key="needs" className="text-warning" data-skill-needs="">{t("botPanel.skills.needsReview")}</span>);
  if (off) parts.push(<span key="off" data-skill-off-state="">{t("botProfile.v6.value.off")}</span>);
  if (skill.description) parts.push(<span key="description">{skill.description}</span>);
  return parts.flatMap((part, index) => (index === 0 ? [part] : [" · ", part]));
}

/** A skill on the bot's profile page (#4148): the page's row (ProfileRow,
 * the Settings card's metrics), its book glyph, its name, one grey line, and
 * at the right the shared glyph and the more menu. A click (or Enter)
 * opens the skill, where everything else is. */
export function renderPlainSkillRow(a: SkillRowActions, skill: ManagedSkill) {
  const { skillWrites, openSkill } = a;
  const shared = sharedLabel(a, skill);
  const off = !skill.enabled && skill.origin !== "native";
  return (
    <ProfileRow
      key={skill.name}
      data-skill-row={skill.name}
      data-skill-state={skillNeedsPerson(skill) ? "needs-person" : off ? "off" : "on"}
      icon={<BookOpen strokeWidth={1.5} />}
      label={<span data-skill-name="">{skill.name}</span>}
      muted={off}
      state={skillStateLine(skill)}
      onOpen={() => openSkill(skill)}
      action={
        <>
          {shared && <SharedGlyph label={shared} />}
          {skillWrites && skill.origin !== "native" && renderRowMenu(a, skill, iconButton, true)}
          {skill.origin === "native" && (
            <button type="button" onClick={() => openSkill(skill)} className={iconButton} aria-label={t("botPanel.skills.open")}>
              <Eye size={15} />
            </button>
          )}
        </>
      }
    />
  );
}

/** What the opened skill shows that its row no longer does (#4148): private
 * or shared and with whom, and every warning in full. The whole
 * description, where it was learned and Review changes are the open view's
 * own. */
export function SkillDetails({ a, skill }: { a: SkillRowActions; skill: ManagedSkill }) {
  const shared = sharedLabel(a, skill);
  const origin = skill.origin === "native"
    ? t("skills.origin.nativeHint")
    : shared ?? (a.libraryOn ? t("botPanel.skills.detailPrivate") : null);
  const warnings = skill.warnings.filter((warning) => !isChangedAfterReviewWarning(warning));
  return (
    <div className="flex flex-col gap-2" data-skill-details={skill.name}>
      {origin && (
        <p className="flex items-center gap-2 text-[12px] leading-4 text-ink-secondary" data-skill-origin="">
          {shared ? <Users size={14} aria-hidden="true" className="shrink-0" /> : null}
          <span className="min-w-0 break-words">{origin}</span>
        </p>
      )}
      {warnings.length > 0 && (
        <p role="status" className="rounded-lg bg-warning/10 px-3 py-2 text-[12px] text-warning" data-skill-warnings="">
          {warnings.join(" · ")}
        </p>
      )}
    </div>
  );
}

/** The opened skill's actions, beside its Edit (#4148): the same list as
 * the row's more menu, less Open, Edit and Review changes, which the open
 * view already draws. */
export function SkillDetailActions({ a, skill }: { a: SkillRowActions; skill: ManagedSkill }) {
  const items = skillActions(a, skill).filter((item) => item.id !== "open" && item.id !== "edit" && item.id !== "review");
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-skill-detail-actions="">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          disabled={item.disabled}
          onClick={item.run}
          data-skill-detail-action={item.id}
          className={cn(PILL, "shrink-0")}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
