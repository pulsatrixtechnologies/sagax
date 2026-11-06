// Achievements, a full page of the content frame (activeView "achievements";
// store action showAchievements, from the account menu, the person panel's
// Achievements tab and the `#achievements/<category>` address). The Tools
// page header since 2026-11-06 (the Team map standard, content-page.tsx):
// the trophy, the title, the unlocked count and a grey line; on the right
// the points, the streak, the settings button and the ☰ menu. The toolbar
// row under it: the status segment (All, Unlocked, Locked), the search and
// Filters (the category with each one's unlocked count, the reward).
// Under it, AchievementsPage in the centred column. The settings
// (AchievementSettingsPage, still `#achievements/settings`) open in a dialog
// of the Settings family, over the page.
import { useEffect, useRef, useState } from "react";
import { Flame, Settings, Trophy } from "lucide-react";
import { isBackShortcut } from "@/lib/back-shortcut";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { unlocksFromSnapshot, useAchievements } from "@/lib/achievements";
import { useStore, type AchievementsCategory } from "@/state/store";
import { useCaptionChrome } from "../DesktopCapabilities";
import { useCategoryModalKeyboard } from "../category-modal";
import { DIALOG, DialogCloseButton, DialogLayer } from "../SettingsPrimitives";
import {
  PAGE_FIELD_LABEL, PAGE_FILTER_RESET, PAGE_HEADER_BUTTON, PAGE_INDICATOR, PAGE_SELECT,
  PageBody, PageFilters, PageHeader, PageMenu, PageMenuItem, PageMenuSeparator, PageSearch, PageSegment, PageTopStrip, useDismissMenus,
} from "../content-page";
import { AchievementSettingsPage, AchievementsPage, achievementCategoryLabel, formatPoints } from "./AchievementsPage";
import {
  ACHIEVEMENTS_SCREEN_CATEGORIES, achievementCategoryCounts, achievementRewardFilterLabel, achievementRewardFilters,
  type AchievementRewardFilter, type AchievementStatusFilter, type AchievementsNavCategory,
} from "./achievement-filters";

/** What the page shows: a category, or the settings (the ☰ menu's Settings). */
export type AchievementsScreenCategory = AchievementsCategory;
export { ACHIEVEMENTS_SCREEN_CATEGORIES, achievementCategoryCounts, type AchievementCategoryCounts, type AchievementsNavCategory } from "./achievement-filters";

export function AchievementsScreen({ initialCategory }: { initialCategory?: AchievementsScreenCategory }) {
  const { state, dispatch } = useStore();
  const { dragProps, noDragStyle, controlsShiftStyle } = useCaptionChrome();
  const { snapshot } = useAchievements();
  const focus = state.achievementsFocus;
  const start = initialCategory ?? focus.category;
  const [category, setCategory] = useState<AchievementsNavCategory>(start === "settings" ? "all" : start);
  const [settingsOpen, setSettingsOpen] = useState(start === "settings");
  const [status, setStatus] = useState<AchievementStatusFilter>("all");
  const [reward, setReward] = useState<AchievementRewardFilter>("all");
  const [search, setSearch] = useState("");
  const mainRef = useRef<HTMLElement>(null);
  const filtersRef = useRef<HTMLDetailsElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  useDismissMenus([filtersRef, menuRef]);

  // A link to another category (or to the settings) while the page shows re-selects it.
  const seen = useRef(focus.nonce);
  useEffect(() => {
    if (seen.current === focus.nonce) return;
    seen.current = focus.nonce;
    if (focus.category === "settings") setSettingsOpen(true);
    else { setCategory(focus.category); setSettingsOpen(false); }
  }, [focus]);

  // The page takes focus so Escape and Cmd/Ctrl+[ work at once; Tab then
  // reaches the header's controls.
  useEffect(() => { mainRef.current?.focus({ preventScroll: true }); }, []);

  const back = () => dispatch({ type: "showChat" });
  const closeMenus = () => { for (const menu of [filtersRef.current, menuRef.current]) menu?.removeAttribute("open"); };

  const counts = achievementCategoryCounts(new Set((snapshot?.items ?? []).filter((item) => item.unlockedAt).map((item) => item.id)));
  const activeFilters = (category !== "all" ? 1 : 0) + (reward !== "all" ? 1 : 0);
  const clearFilters = () => { setCategory("all"); setReward("all"); };
  const pointsLabel = snapshot ? `${t("achievements.colleaguePoints", { points: formatPoints(snapshot.points) })}, ${t("achievements.level", { level: snapshot.level.level })}` : "";

  return (
    <main
      ref={mainRef}
      tabIndex={-1}
      data-achievements-screen=""
      className="flex h-full min-w-0 flex-1 flex-col bg-app outline-none"
      onKeyDown={(event) => {
        // Escape (unless a popover inside already took it) closes an open
        // menu, then leaves the settings, then goes back; Cmd/Ctrl+[ goes back.
        if (event.defaultPrevented) return;
        if (event.key === "Escape" && (filtersRef.current?.open || menuRef.current?.open)) { event.preventDefault(); closeMenus(); return; }
        if (event.key === "Escape" && settingsOpen) { event.preventDefault(); setSettingsOpen(false); return; }
        if (event.key === "Escape" || isBackShortcut(event)) { event.preventDefault(); back(); }
      }}
    >
      <PageTopStrip />
      <PageHeader
        name="achievements"
        icon={Trophy}
        title={t("achievements.menu")}
        count={t("achievements.unlockedCount", { count: counts.all.unlocked, total: counts.all.total })}
        subtitle={t("achievements.pageSubtitle")}
        {...dragProps}
        topbar
        primaryStyle={noDragStyle}
        actionsStyle={{ ...noDragStyle, ...controlsShiftStyle }}
        primary={<>
          <PageSegment label={t("achievements.filter")} value={status} onChange={setStatus} options={[
            { value: "all", label: t("achievements.category.all") },
            { value: "unlocked", label: t("achievements.filter.unlocked") },
            { value: "locked", label: t("achievements.filter.locked") },
          ]} />
          <PageSearch value={search} onChange={setSearch} placeholder={t("achievements.search")} label={t("achievements.searchLabel")} data-achievement-search="" />
          <div className="ml-auto">
            <PageFilters name="achievements" menuRef={filtersRef} activeCount={activeFilters}>
              <label className="block">
                <span className={PAGE_FIELD_LABEL}>{t("achievements.categories")}</span>
                <select aria-label={t("achievements.categories")} data-achievement-category-select="" value={category} onChange={(event) => setCategory(event.target.value as AchievementsNavCategory)} className={PAGE_SELECT}>
                  {ACHIEVEMENTS_SCREEN_CATEGORIES.map((id) => (
                    <option key={id} value={id} data-achievement-category={id}>{achievementCategoryLabel(id)} ({counts[id].unlocked}/{counts[id].total})</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={PAGE_FIELD_LABEL}>{t("achievements.rewardFilter")}</span>
                <select aria-label={t("achievements.rewardFilter")} data-achievement-reward-select="" value={reward} onChange={(event) => setReward(event.target.value as AchievementRewardFilter)} className={PAGE_SELECT}>
                  {achievementRewardFilters(unlocksFromSnapshot(snapshot ?? { rewards: [] })).map((id) => <option key={id} value={id}>{achievementRewardFilterLabel(id)}</option>)}
                </select>
              </label>
              {activeFilters > 0 && <button type="button" data-achievement-filter-reset="" onClick={clearFilters} className={PAGE_FILTER_RESET}>{t("routines.scope.reset")}</button>}
            </PageFilters>
          </div>
        </>}
        actions={<>
          {snapshot && <span role="status" data-achievement-points="" title={pointsLabel} aria-label={pointsLabel} className={cn(PAGE_INDICATOR, "font-medium text-ink")}>
            <Trophy size={14} className="text-[#e0a82e]" aria-hidden="true" />{formatPoints(snapshot.points)}
          </span>}
          {snapshot && snapshot.streak > 0 && <span role="status" data-achievement-streak="" title={t("achievements.streak", { days: snapshot.streak })} aria-label={t("achievements.streak", { days: snapshot.streak })} className={cn(PAGE_INDICATOR, "text-ink")}>
            <Flame size={14} className="text-[#f97316]" aria-hidden="true" />{snapshot.streak}
          </span>}
          <button type="button" data-achievements-settings-open="" aria-label={t("achievements.settings.title")} title={t("achievements.settings.title")} aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(true)} className={PAGE_HEADER_BUTTON}>
            <Settings size={16} aria-hidden="true" />
          </button>
          <PageMenu name="achievements" menuRef={menuRef} label={t("achievements.pageMenu")}>
            <PageMenuItem icon={Trophy} current data-achievements-menu-list="" onClick={() => { closeMenus(); setSettingsOpen(false); }}>{t("achievements.panel.all")}</PageMenuItem>
            <PageMenuSeparator />
            <PageMenuItem icon={Settings} data-achievements-menu-settings="" onClick={() => { closeMenus(); setSettingsOpen(true); }}>{t("achievements.settings.title")}</PageMenuItem>
          </PageMenu>
        </>}
      />
      <PageBody data-achievements-pane="">
        <AchievementsPage category={category} status={status} reward={reward} search={search} />
      </PageBody>
      {settingsOpen && <AchievementSettingsDialog onClose={() => { setSettingsOpen(false); mainRef.current?.focus({ preventScroll: true }); }} />}
    </main>
  );
}

/** The achievement settings (Your card, When you unlock one) in a dialog
 * drawn like Settings, opened from the header's settings button. */
export function AchievementSettingsDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useCategoryModalKeyboard(dialogRef, "[data-dialog-close]", onClose);
  return (
    <DialogLayer onBackdropMouseDown={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="achievement-settings-title"
        tabIndex={-1}
        data-achievements-settings-dialog=""
        className={cn(DIALOG.frame, DIALOG.width.lg)}
      >
        <DialogCloseButton label={t("common.close")} onClick={onClose} />
        <div className={DIALOG.header}>
          <h2 id="achievement-settings-title" className={DIALOG.title}>{t("achievements.settings.title")}</h2>
          <p className={DIALOG.subtitle}>{t("achievements.settings.subtitle")}</p>
        </div>
        <div className={DIALOG.body}>
          <AchievementSettingsPage heading={false} />
        </div>
      </div>
    </DialogLayer>
  );
}
