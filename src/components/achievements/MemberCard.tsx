// The member card: one Xbox-like block (large avatar, name, chosen title,
// gamerscore, then the achievement list in the same card). The blade is the
// popover; the panel variant is the Achievements tab of a person's sheet.
// Title and points never sit on the name line on their own. A colleague's
// card comes from the public card, which only has unlocked ids. The list
// scrolls inside the card. The sidebar never shows titles or points
// (docs/code/apps.md, Achievements).
import { Trophy } from "lucide-react";
import { ACHIEVEMENTS, achievementById } from "../../../shared/achievements-catalog";
import type { AchievementItemState, AchievementSnapshot } from "../../../shared/achievements";
import { localized } from "@/lib/achievements";
import { t } from "@/lib/i18n";
import { PersonAvatar } from "../MessageAuthor";
import { achievementIcon } from "./icons";
import "./achievements.css";

export interface MemberCardRow {
  id: string;
  name: string;
  icon: string;
  points: number;
  unlocked: boolean;
  current?: number;
  target?: number;
}

/** Your list: locked secrets stay out until they unlock. Locked rows keep progress. */
export function memberCardRows(snapshot: Pick<AchievementSnapshot, "items">): MemberCardRow[] {
  const states = new Map(snapshot.items.map((item) => [item.id, item]));
  return ACHIEVEMENTS.flatMap((item) => {
    const state = states.get(item.id);
    const unlocked = Boolean(state?.unlockedAt);
    if (item.hidden && !unlocked) return [];
    return [rowFrom(item.id, item.name, item.icon, item.points, unlocked, state)];
  });
}

/** A colleague's list: only the ids their public card carried. */
export function publicMemberRows(unlocked: readonly { id: string; points: number }[]): MemberCardRow[] {
  const byId = new Map(unlocked.map((item) => [item.id, item]));
  return ACHIEVEMENTS.flatMap((item) => {
    const entry = byId.get(item.id);
    if (!entry) return [];
    const known = achievementById(item.id);
    if (!known) return [];
    return [rowFrom(known.id, known.name, known.icon, entry.points, true)];
  });
}

function rowFrom(
  id: string,
  name: { en: string; fr: string },
  icon: string,
  points: number,
  unlocked: boolean,
  state?: AchievementItemState,
): MemberCardRow {
  return {
    id,
    name: localized(name),
    icon,
    points,
    unlocked,
    ...(!unlocked && state ? { current: state.current, target: state.target } : {}),
  };
}

/** The chosen title in the person's language, or null when they have none. */
export function achievementTitleName(titleId: string | undefined): string | null {
  if (!titleId) return null;
  for (const item of ACHIEVEMENTS) {
    for (const reward of item.rewards) {
      if (reward.kind === "title" && reward.id === titleId) return localized(reward.name);
    }
  }
  return null;
}

function MemberCardList({ rows }: { rows: readonly MemberCardRow[] }) {
  return (
    <ul className="member-card-list" aria-label={t("achievements.menu")}>
      {rows.map((row) => {
        const Icon = achievementIcon(row.icon);
        const progress = !row.unlocked && row.target !== undefined && row.target > 1 ? `${row.current ?? 0}/${row.target}` : null;
        return (
          <li
            key={row.id}
            className="member-card-row"
            data-achievement={row.id}
            data-unlocked={row.unlocked ? "" : undefined}
            data-locked={row.unlocked ? undefined : ""}
          >
            <span className="member-card-icon" aria-hidden="true">
              <Icon size={15} strokeWidth={2.2} />
            </span>
            <span className="member-card-name">{row.name}</span>
            {progress && <span className="member-card-progress">{progress}</span>}
            <span className="member-card-points">{row.points}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function MemberCard({
  name,
  initials,
  avatarUrl,
  title,
  pointsText,
  level,
  rows,
  onOpenPage,
  emptyText,
  variant = "blade",
}: {
  name: string;
  initials: string;
  avatarUrl?: string;
  title?: string | null;
  pointsText: string | null;
  level?: number;
  rows: readonly MemberCardRow[];
  /** Your card only: the existing achievements page. */
  onOpenPage?: () => void;
  /** When the public card carried no unlocked ids. */
  emptyText?: string;
  /** blade: the popover. panel: the same block on a person's Achievements tab. */
  variant?: "blade" | "panel";
}) {
  const avatarSize = variant === "panel" ? 72 : 64;
  return (
    <div className={variant === "panel" ? "member-card member-card-panel" : "member-card"} data-member-card="" data-member-variant={variant}>
      {/* align-items: center (achievements.css): with no title and no
          points, the name sits centred beside the avatar. Title, score and
          the list stay one block: the highlighted head is not a separate row. */}
      <div className="member-card-head" data-member-highlight="">
        <PersonAvatar avatarUrl={avatarUrl} initials={initials} size={avatarSize} />
        <div className="member-card-identity">
          <div className="truncate text-[14px] font-medium leading-5 text-ink">{name}</div>
          {title ? <div data-member-title="" className="truncate text-[12px] leading-4 text-ink-secondary">{title}</div> : null}
          {pointsText ? (
            <div data-member-points="" className="member-card-score">
              <Trophy size={14} strokeWidth={2.4} aria-hidden="true" />
              <span className="tabular-nums text-ink">{pointsText}</span>
              <span>{t("achievements.pointsUnit")}</span>
              {level !== undefined && <span className="text-ink-tertiary">{t("achievements.level", { level })}</span>}
            </div>
          ) : null}
        </div>
      </div>
      {rows.length > 0 ? <MemberCardList rows={rows} /> : emptyText ? <p className="member-card-empty">{emptyText}</p> : null}
      {onOpenPage && (
        <button type="button" data-achievements-open="" className="member-card-open" onClick={onOpenPage}>
          {t("achievements.card.view")}
        </button>
      )}
    </div>
  );
}
