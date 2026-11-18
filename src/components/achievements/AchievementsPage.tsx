// The Achievements page's body (AchievementsScreen.tsx holds its header, with
// the count, the points and the streak): the person's trophies on the full
// width of the frame (2026-11-17, as Memory and Routines). A summary strip
// holds the level with its bar and what is left to the next one (one place);
// then the recent unlocks (on All, without a search) as one row of compact
// cards, then one block per group, a title band with the group's progress
// over a responsive grid of compact cards: the badge, the name and its
// points, one line of description, the progress of a locked one, the rarity
// (or the share of this server's people who have it, when there are enough
// people to say so) and what it unlocks. A secret stays masked until found. The header's segment
// (All, Unlocked, Locked), search and Filters (category, reward) narrow the
// rows together. The settings that hide the points or the toasts open from
// the settings button of the header (AchievementSettingsPage, in a dialog).
import { lazy, Suspense, useEffect, useMemo } from "react";
import { Lock, Trophy } from "lucide-react";
import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import { ACHIEVEMENT_CATEGORIES, rarityForPoints, type AchievementCategory, type AchievementDefinition, type AchievementItemState, type AchievementReward, type Unlocks } from "../../../shared/achievements";
import { characterUnlocked, displayReward, loadAchievements, localized, reportAchievement, saveAchievementSettings, unlocksFromSnapshot, useAchievements } from "@/lib/achievements";
import { forgetPublicAchievements } from "@/lib/public-achievements";
import { requestNotificationPermission } from "@/lib/notify";
import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { LocaleKey } from "@/locales";
import { CompactRow, DescribedRow, PillSelect, SettingsGroup, Switch } from "../SettingsPrimitives";
import { achievementIcon } from "./icons";
import { achievementCategoryCounts, achievementMatches, type AchievementRewardFilter, type AchievementStatusFilter, type AchievementsNavCategory } from "./achievement-filters";
import { PAGE_EMPTY, PageHeading, PageSection } from "../content-page";
import "./achievements.css";

const RewardPreview = lazy(() => import("./RewardPreview"));

export const CATEGORY_LABEL: Record<AchievementCategory, LocaleKey> = {
  onboarding: "achievements.category.onboarding",
  productivity: "achievements.category.productivity",
  power: "achievements.category.power",
  voice: "achievements.category.voice",
  claude: "achievements.category.claude",
  collaboration: "achievements.category.collaboration",
  streaks: "achievements.category.streaks",
  mastery: "achievements.category.mastery",
  tiers: "achievements.category.tiers",
  secrets: "achievements.category.secrets",
};

const TIER_LABEL = {
  common: "mascot.tier.common",
  rare: "mascot.tier.rare",
  epic: "mascot.tier.epic",
  legendary: "mascot.tier.legendary",
} as const satisfies Record<string, LocaleKey>;

export function formatPoints(points: number, locale = activeLocale()): string {
  try {
    return new Intl.NumberFormat(locale).format(points);
  } catch {
    return String(points);
  }
}

/** How many looks a Mastery card previews before "+N". */
const MASTERY_PREVIEWS = 5;

/**
 * What a Mastery achievement unlocks, drawn: the character or its skins,
 * greyed until it unlocks (a character that has not landed yet is its
 * placeholder), then "+N" for the rest.
 */
function MasteryUnlockPreview({ item, unlocked, unlocks }: { item: AchievementDefinition; unlocked: boolean; unlocks: Unlocks }) {
  const looks = item.rewards.filter((reward): reward is Extract<AchievementReward, { kind: "character" | "skin" }> => reward.kind === "character" || reward.kind === "skin");
  if (!looks.length) return null;
  const shown = looks.slice(0, MASTERY_PREVIEWS);
  return (
    <div className="flex items-center gap-1" data-mastery-preview={item.id} aria-label={t("achievements.mastery.unlocks")}>
      <span className="mr-0.5 text-[11px] text-ink-tertiary">{t("achievements.mastery.unlocks")}</span>
      {shown.map((reward) => {
        const line = displayReward(reward, unlocks);
        if (!line) return null;
        const showArt = characterUnlocked(unlocks, reward.character);
        return (
          <span
            key={`${reward.character}:${reward.kind === "skin" ? reward.skin : ""}`}
            className="mastery-look grid size-7 place-items-center"
            data-locked={unlocked ? undefined : ""}
            title={line}
          >
            {/* a character not found yet stays a surprise: a lock in its slot */}
            {showArt ? <Suspense fallback={null}><RewardPreview reward={reward} size={24} animated={false} /></Suspense> : (
              <span className="grid size-6 place-items-center rounded-full bg-ink/[0.07] text-ink-tertiary" aria-hidden="true"><Lock size={11} /></span>
            )}
          </span>
        );
      })}
      {looks.length > shown.length && <span className="text-[11px] tabular-nums text-ink-tertiary">{t("achievements.mastery.more", { count: looks.length - shown.length })}</span>}
    </div>
  );
}

/** The cards' grid: as many columns as fit 300 px (3 to 4 at 1440, 2 at 1024, 1 on a phone). */
const CARDS = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-2.5";

/** One achievement as a compact card: the badge, the name and its points,
 * one line of description, the progress of a locked one (3 of 5), then the
 * rarity, the share of people who have it and what it unlocks. A secret
 * stays masked until found. */
function AchievementRow({ item, state, unlocks }: { item: AchievementDefinition; state?: AchievementItemState; unlocks: Unlocks }) {
  const unlocked = Boolean(state?.unlockedAt);
  const secret = item.hidden && !unlocked;
  const tier = rarityForPoints(item.points);
  const Icon = secret ? Lock : achievementIcon(item.icon);
  const mastery = item.category === "mastery";
  // a Mastery card always shows how far it went, 0 included: the bar is the point
  const progress = state && !unlocked && (mastery ? !secret && state.target > 0 : state.target > 1) ? state.current / state.target : null;
  const reward = item.rewards[0];
  const line = reward && !secret && !mastery ? displayReward(reward, unlocks) : null;
  const name = secret ? t("achievements.secretName") : localized(item.name);
  const description = secret ? (item.hint ? localized(item.hint) : t("achievements.secretDescription")) : localized(item.description);
  return (
    <li
      className="achievement-row flex min-w-0 flex-col gap-1.5 rounded-lg border-[0.5px] border-border bg-panel px-3 py-2.5 hover:bg-hover"
      data-tier={tier}
      data-unlocked={unlocked ? "" : undefined}
      data-achievement={item.id}
      data-secret={secret ? "" : undefined}
      data-mastery={mastery ? "" : undefined}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="achievement-row-badge" aria-hidden="true">
          <Icon size={16} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <span className="achievement-row-name block truncate text-[13px] leading-[18px]" title={name}>{name}</span>
          <p className={cn("truncate text-[12px] leading-4 text-ink-secondary", secret && "italic")} title={description}>
            {description}
          </p>
        </div>
        <span className="achievement-row-points shrink-0 self-start" data-achievement-row-points="" title={t("achievements.panel.points", { points: item.points })}>
          {item.points}
        </span>
      </div>
      {progress !== null && state && (
        <div className="flex items-center gap-2">
          <div className="achievement-progress flex-1" role="progressbar" aria-valuemin={0} aria-valuemax={state.target} aria-valuenow={state.current} aria-label={name}>
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span className="text-[11px] tabular-nums text-ink-secondary">{state.current}/{state.target}</span>
        </div>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-[14px]">
        <span className="achievement-row-tier font-semibold uppercase tracking-[0.06em]">{t(TIER_LABEL[tier])}</span>
        {state?.percent !== undefined && <span className="text-ink-secondary">{t("achievements.percent", { percent: state.percent })}</span>}
        {line && <span className="min-w-0 max-w-full truncate text-ink-secondary" title={line}>{line}</span>}
        {mastery && !secret && <MasteryUnlockPreview item={item} unlocked={unlocked} unlocks={unlocks} />}
      </div>
    </li>
  );
}

/** A setting that changes what colleagues see on this person's card: save it,
 * then ask the server for the cards again so every panel follows. */
function saveCardSetting(patch: Parameters<typeof saveAchievementSettings>[0]): void {
  void saveAchievementSettings(patch).then(forgetPublicAchievements);
}

/** A category's label, "All" included, and the settings' heading. */
export function achievementCategoryLabel(id: AchievementCategory | "all" | "settings"): string {
  return id === "all" ? t("achievements.category.all") : id === "settings" ? t("achievements.settings.title") : t(CATEGORY_LABEL[id]);
}

export function AchievementsPage({ category = "all", status: statusFilter = "all", reward = "all", search = "" }: {
  category?: AchievementsNavCategory;
  /** The header's segment: All, Unlocked or Locked. */
  status?: AchievementStatusFilter;
  /** Filters' reward. */
  reward?: AchievementRewardFilter;
  /** The header's search. */
  search?: string;
}) {
  const { status, snapshot } = useAchievements();

  useEffect(() => {
    void loadAchievements();
    reportAchievement("achievements.viewed");
  }, []);

  const states = useMemo(() => new Map((snapshot?.items ?? []).map((item) => [item.id, item])), [snapshot]);
  const counts = useMemo(() => achievementCategoryCounts(new Set((snapshot?.items ?? []).filter((item) => item.unlockedAt).map((item) => item.id))), [snapshot]);
  const unlocks = unlocksFromSnapshot(snapshot ?? { rewards: [] });
  const shown = ACHIEVEMENTS.filter((item) => achievementMatches(item, states.get(item.id)?.unlockedAt, { category, status: statusFilter, reward, search }, unlocks));

  if (status === "unavailable") {
    return <p className={PAGE_EMPTY} data-achievements-unavailable="">{t("achievements.unavailable")}</p>;
  }
  if (!snapshot) return <p role="status" className="flex items-center gap-2 p-3 text-[12px] text-ink-secondary">{t("achievements.loading")}</p>;

  const level = snapshot.level;
  const toNext = level.to - level.from;
  const recent = snapshot.recent.map((id) => ACHIEVEMENTS.find((item) => item.id === id)).filter((item): item is AchievementDefinition => Boolean(item));
  const narrowed = statusFilter !== "all" || reward !== "all" || search.trim() !== "";
  const sections = ACHIEVEMENT_CATEGORIES
    .map((id) => ({ id, items: shown.filter((item) => item.category === id) }))
    .filter((section) => section.items.length > 0);

  return (
    <div className="space-y-5" data-achievements-page="">
      {/* the level, its bar and what is left to the next one: the one place of the level (the header carries the count, the points and the streak) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-2.5 text-[12px] leading-4" data-achievement-progress="">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink" data-achievement-level="">
          <Trophy size={14} className="text-[#e0a82e]" aria-hidden="true" />{t("achievements.level", { level: level.level })}
        </span>
        <div className="achievement-progress order-last w-full sm:order-none sm:w-auto sm:flex-1" style={{ ["--tier" as string]: "#e0a82e" }} role="progressbar" aria-valuemin={0} aria-valuemax={toNext} aria-valuenow={snapshot.points - level.from} aria-label={t("achievements.nextLevel")}>
          <span style={{ width: `${Math.round(((snapshot.points - level.from) / toNext) * 100)}%` }} />
        </div>
        <span className="ml-auto tabular-nums text-ink-secondary sm:ml-0">{t("achievements.toNext", { points: formatPoints(level.to - snapshot.points) })}</span>
      </div>

      {category === "all" && !narrowed && recent.length > 0 && (
        <PageSection title={t("achievements.recent")} data-achievement-recent="">
          <ul className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1">
            {recent.map((item) => {
              const reward = item.rewards[0];
              const showArt = Boolean(reward && (reward.kind === "skin" || reward.kind === "character") && characterUnlocked(unlocks, reward.character));
              const Icon = achievementIcon(item.icon);
              return (
                <li key={item.id} className="achievement-row flex w-[220px] shrink-0 items-center gap-2.5 rounded-lg border-[0.5px] border-border bg-panel px-3 py-2.5 hover:bg-hover" data-tier={rarityForPoints(item.points)} data-unlocked="" data-recent-achievement={item.id}>
                  <span className="achievement-row-badge">
                    {showArt && reward ? (
                      <Suspense fallback={null}><RewardPreview reward={reward} size={26} animated={false} /></Suspense>
                    ) : (
                      <Icon size={16} aria-hidden="true" />
                    )}
                  </span>
                  <span className="achievement-row-name min-w-0 flex-1 truncate text-[13px] leading-[18px]" title={localized(item.name)}>{localized(item.name)}</span>
                  <span className="achievement-row-points shrink-0">+{item.points}</span>
                </li>
              );
            })}
          </ul>
        </PageSection>
      )}

      {/* a block per group: a title band with the group's progress, then its cards */}
      {sections.map((section) => {
        const { unlocked, total } = counts[section.id];
        return (
          <section key={section.id} aria-label={t(CATEGORY_LABEL[section.id])} data-achievement-section={section.id} className="overflow-hidden rounded-xl border-[0.5px] border-border bg-elevated">
            <div className="flex items-center gap-3 border-b-[0.5px] border-border px-3.5 py-2.5">
              <h2 className="min-w-0 truncate text-[14px] font-semibold text-ink">{t(CATEGORY_LABEL[section.id])}</h2>
              <span className="text-[12px] tabular-nums text-ink-secondary" data-achievement-unlocked-count="">{unlocked}/{total}</span>
              <div className="achievement-progress ml-auto w-24 max-sm:w-16" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={unlocked} aria-label={t(CATEGORY_LABEL[section.id])}>
                <span style={{ width: `${total ? Math.round((unlocked / total) * 100) : 0}%` }} />
              </div>
            </div>
            <ul className={cn(CARDS, "p-3")} data-achievement-grid="">
              {section.items.map((item) => <AchievementRow key={item.id} item={item} state={states.get(item.id)} unlocks={unlocks} />)}
            </ul>
          </section>
        );
      })}
      {shown.length === 0 && (
        <div className={PAGE_EMPTY} data-achievements-empty="">
          <Trophy size={20} className="mx-auto mb-2 opacity-60" aria-hidden="true" />
          {t("achievements.empty")}
        </div>
      )}
    </div>
  );
}

/** The feature-wide settings (card, title, toasts, public card), the page's
 * Settings section, opened from the header's ☰ menu as Automations opens its
 * sections. */
export function AchievementSettingsPage({ heading = true }: { heading?: boolean } = {}) {
  const { status, snapshot } = useAchievements();
  useEffect(() => { void loadAchievements(); }, []);
  if (status === "unavailable") {
    return <p className={PAGE_EMPTY} data-achievements-unavailable="">{t("achievements.unavailable")}</p>;
  }
  if (!snapshot) return <p role="status" className="flex items-center gap-2 p-3 text-[12px] text-ink-secondary">{t("achievements.loading")}</p>;
  const states = new Map(snapshot.items.map((item) => [item.id, item]));
  const titles = ACHIEVEMENTS.flatMap((item) => (states.get(item.id)?.unlockedAt ? item.rewards : [])).filter((reward) => reward.kind === "title");
  return (
    <div className="space-y-5" data-achievements-settings-page="">
      {heading && <PageHeading title={t("achievements.settings.title")} subtitle={t("achievements.settings.subtitle")} />}
      <SettingsGroup title={t("achievements.settings.card")} groupId="achievements.settings">
        {titles.length > 0 && (
          <CompactRow label={t("achievements.titleLabel")} rowId="achievements.title">
            <PillSelect
              value={snapshot.settings.title ?? ""}
              ariaLabel={t("achievements.titleLabel")}
              options={[
                { value: "", label: t("achievements.titleNone") },
                ...titles.flatMap((reward) => (reward.kind === "title" ? [{ value: reward.id, label: localized(reward.name) }] : [])),
              ]}
              onChange={(next) => saveCardSetting({ title: next || null })}
            />
          </CompactRow>
        )}
        <DescribedRow label={t("achievements.settings.showPoints")} help={t("achievements.settings.showPointsHint")}>
          <Switch checked={snapshot.settings.showPoints} aria-label={t("achievements.settings.showPoints")} onClick={() => saveCardSetting({ showPoints: !snapshot.settings.showPoints })} />
        </DescribedRow>
        <DescribedRow label={t("achievements.settings.showTitle")} help={t("achievements.settings.showTitleHint")}>
          <Switch checked={snapshot.settings.showTitle !== false} aria-label={t("achievements.settings.showTitle")} onClick={() => saveCardSetting({ showTitle: snapshot.settings.showTitle === false })} />
        </DescribedRow>
        <DescribedRow label={t("achievements.settings.public")} help={t("achievements.settings.publicHint")}>
          <Switch checked={snapshot.settings.public} aria-label={t("achievements.settings.public")} onClick={() => saveCardSetting({ public: !snapshot.settings.public })} />
        </DescribedRow>
      </SettingsGroup>
      <SettingsGroup title={t("achievements.settings.notifications")} groupId="achievements.notifications">
        <DescribedRow label={t("achievements.settings.toasts")} help={t("achievements.settings.toastsHint")}>
          <Switch checked={snapshot.settings.toasts} aria-label={t("achievements.settings.toasts")} onClick={() => void saveAchievementSettings({ toasts: !snapshot.settings.toasts })} />
        </DescribedRow>
        <DescribedRow label={t("achievements.settings.native")} help={t("achievements.settings.nativeHint")}>
          <Switch
            checked={snapshot.settings.native}
            aria-label={t("achievements.settings.native")}
            onClick={() => {
              const next = !snapshot.settings.native;
              if (next) void requestNotificationPermission();
              void saveAchievementSettings({ native: next });
            }}
          />
        </DescribedRow>
      </SettingsGroup>
    </div>
  );
}
