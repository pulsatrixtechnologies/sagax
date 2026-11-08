// App settings, as a real modal with sections rather than one long panel.
// Per-bot settings (persona, model, computer) live in BotSettingsDialog: this
// is the stuff shared by every bot: who you are, your keys, and the
// machine your bots can borrow.
import { FileText, Search, X } from "lucide-react";
import { useStore, type AppSettingsSection } from "@/state/store";
import { localeChoices } from "@/locales";
import { t } from "@/lib/i18n";
import { APP_NAME, appVersion } from "@/lib/app-links";
import { brand } from "@/lib/brand";
import { useUpdaterState } from "@/lib/updater";
import { openUpdatePrompt, requestUpdateCheck } from "@/lib/update-prompt";
import { generalAdvancedShown, isSoloDesktop } from "./settings/AdvancedSettings";
import { CompactRow, PillSelect, type PillOption, SettingRow, SettingsAdvancedScope, SettingsGroup, Switch } from "./SettingsPrimitives";
import { TimeZoneRows } from "./settings/TimeZoneSettings";
import { AboutPage, GeneralPage } from "./settings/AppPage";
import { DeveloperLink } from "./settings/DeveloperLink";
import { PeopleToolAccessSettings } from "./ToolAccessSettings";
import {
  AppearanceSettings,
  DeveloperSettings,
  CredentialsSettings,
  DecisionModelSettings,
  EnginesSettings,
  ExperimentalSettings,
  LocalComputerSection,
  NotificationSettings,
  OrganizationSettings,
  OrgMemorySettings,
  ProvidersSettings,
  SecurityKeySettings,
  UsageSection,
  VoiceSettingsPage,
  WorkspaceBackupSettings,
} from "./lazy-settings-sections";
import { openSettings } from "@/lib/settings-link";
import { shortcutLabel } from "./ShortcutHint";
import { aboutMeFirstLine } from "./AboutMeSettings";
import { SettingsSubPage, SettingsSubPageRow } from "./SettingsSubPage";
import { AccountCard } from "./settings/AccountCard";
import { MyApprovalRules } from "./settings/MyApprovalRules";
import { MyToolGrants } from "./settings/MyToolGrants";
import { cn } from "@/lib/cn";
import { effectiveLanguage, setLanguageChoice, useLanguageChoice } from "@/lib/language-preference";
import { focusSettingsSearchLabel } from "@/lib/settings-search";
import { useSettingsModal } from "./settings/useSettingsModal";
import { NAV_GROUPS } from "./settings/settings-nav";
import { OsPermissionsSection } from "./settings/OsPermissions";

// The threads choice moved with Appearance (0.5.6); old imports still work.
// Re-exported from the thin preference module so this shell chunk does not
// pull AppearanceSettings.tsx (Refs #1971).
export { chooseThreadsView } from "@/lib/thread-preferences";

export { generalAdvancedShown, isSoloDesktop };

export {
  ORGANIZATION_ADVANCED_KEYWORDS,
  NAV_GROUPS,
  SECTIONS,
  cardsMatching,
  organizationHidesSection,
  memberHidesSection,
  orgMemoryAvailable,
  PUBLISHED_PAGES_KEYWORDS,
  publishedPagesMatch,
  sectionMatches,
  type SettingsNavGroup,
} from "./settings/settings-nav";


/** This app's updates (#2080): version in the row title, one status, one
 * action. Shown once the desktop app answers on this computer's page. */
export function UpdatesRow() {
  const s = useUpdaterState();
  const updater = window.ogb?.updater;
  if (!s || !updater) return null;
  const label =
    s.status === "checking"
      ? t("settings.updates.checking")
      : s.status === "downloading"
        ? s.percent == null
          ? t("settings.updates.startingDownload")
          : t("settings.updates.downloading", { percent: Math.round(s.percent) })
        : s.status === "preparing"
          ? t("settings.updates.preparing")
          : s.status === "downloaded"
            ? s.installMode === "handoff"
              ? t("settings.updates.readyInstall", { app: brand().name, version: s.version ?? "" })
              : t("settings.updates.ready", { app: brand().name, version: s.version ?? "" })
            : s.status === "installing"
              ? s.message ||
                (s.installMode === "handoff"
                  ? t("settings.updates.openingTerminal")
                  : t("settings.updates.restarting"))
              : s.status === "handed-off"
                ? t("settings.updates.handedOff")
                : s.status === "error"
                  ? t("settings.updates.failed", { message: s.message ?? t("settings.updates.unknownError") })
                  : t("settings.updates.upToDate");
  // A native staging failure (retryable === false) cannot be retried in place:
  // the message tells the person to quit and reopen, so this button must do
  // exactly that and stay clickable, never be greyed out.
  const mustRestart = s.retryable === false;
  return (
    <SettingRow title={t("settings.updates.rowTitle", { name: APP_NAME, version: appVersion() })} subtitle={label}>
      <button
        // The update dialog follows the check and asks before any restart
        // ("Restart to install" or "Later"); this button never installs.
        onClick={() =>
          mustRestart
            ? void window.ogb?.relaunch?.()
            : s.status === "downloaded"
              ? openUpdatePrompt()
              : requestUpdateCheck()
        }
        disabled={
          s.status === "checking" || s.status === "downloading" || s.status === "preparing" ||
          s.status === "installing"
        }
        className="ui-button"
      >
        {s.retryable === false
          ? t("settings.updates.quitReopen")
          : s.status === "downloaded"
            ? s.installMode === "handoff"
              ? t("settings.updates.install")
              : t("settings.updates.restart")
            : s.status === "preparing"
              ? t("settings.updates.preparingShort")
              : s.status === "installing"
                ? s.installMode === "handoff"
                  ? t("settings.updates.opening")
                  : t("settings.updates.restartingShort")
                : t("settings.updates.check")}
      </button>
    </SettingRow>
  );
}

/** The named update channel: Stable, or Nightly (versions still in testing).
 * Updates only ever come from Sagax's own GitHub releases
 * (electron/update-feed.mjs); this only widens the channel. */
function PrereleaseRow() {
  const s = useUpdaterState();
  const updater = window.ogb?.updater;
  // An older main process only knows the pre-release switch.
  const setChannel = updater?.setChannel ?? (updater?.setPrereleases ? (next: "stable" | "nightly") => updater.setPrereleases?.(next === "nightly") : undefined);
  if (!setChannel) return null;
  const channel = s?.channel ?? (s?.allowPrerelease === true ? "nightly" : "stable");
  const options: ReadonlyArray<PillOption<"stable" | "nightly">> = [
    { value: "stable", label: t("settings.updates.channel.stable") },
    { value: "nightly", label: t("settings.updates.channel.nightly") },
  ];
  return (
    <SettingRow
      title={t("settings.updates.channel.title")}
      subtitle={t("settings.updates.channel.help")}
      help={t("settings.updates.channel.originHelp")}
    >
      <PillSelect value={channel} options={options} ariaLabel={t("settings.updates.channel.title")} onChange={(next) => void setChannel(next)} />
    </SettingRow>
  );
}

/** Install a downloaded update while the person is away, never with a bot at work. */
function AutoInstallAwayRow() {
  const s = useUpdaterState();
  const setAway = window.ogb?.updater?.setAutoInstallAway;
  if (!setAway || s?.installMode === "handoff") return null;
  const on = s?.autoInstallWhenAway === true;
  return (
    <SettingRow
      title={t("settings.updates.away.title")}
      subtitle={t("settings.updates.away.help")}
    >
      <Switch checked={on} aria-label={t("settings.updates.away.title")} onClick={() => void setAway(!on)} />
    </SettingRow>
  );
}

function LanguageRow() {
  const { state } = useStore();
  // Follows the account: anyone can switch, including a chat-only teammate,
  // and nobody changes another person's screen. The server's language is
  // the default until this person picks one.
  const current = effectiveLanguage(useLanguageChoice(), state.config?.language);
  return (
    <CompactRow label={t("settings.language.title")} rowId="language">
      <PillSelect
        value={current}
        ariaLabel={t("settings.language.aria")}
        onChange={(next) => setLanguageChoice(next)}
        options={[{ value: "", label: t("settings.language.system") }, ...localeChoices.map(({ code, label }) => ({ value: code, label }))]}
      />
    </CompactRow>
  );
}

export function SettingsModal() {
  const {
    state, dispatch, advanced, retroSkin, remoteActive, dialogRef, paneRef,
    searchLabels, closeSettings, openAbout, query, setQuery, q,
    lockedServer, allowed, memoryShown, availableSections, section, visibleSections,
    pagesHit, sectionLabelKey, sectionIntroKey, subPageId, subPage, openSubPage, closeSubPage,
    editConfig,
  } = useSettingsModal();

  return (
    <div
      // in: the backdrop fades and the sheet settles from 98% (starting:, the
      // first paint); out: a quick page cross-fade (navigate, "back")
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 transition-opacity duration-base ease-out-quint starting:opacity-0 motion-reduce:transition-none sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && closeSettings()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-settings-title"
        tabIndex={-1}
        className="flex h-[min(700px,calc(100dvh-96px))] w-[min(900px,calc(100vw-40px))] overflow-hidden rounded-[14px] border border-border bg-app outline-none transition-[opacity,scale] duration-base ease-out-quint starting:scale-98 starting:opacity-0 motion-reduce:transition-none"
      >
        {/* section nav */}
        <span id="app-settings-title" className="sr-only">{t("settings.title")}</span>
        <nav className="hidden min-h-0 w-[198px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-hairline-weak bg-panel px-3 py-4 sm:flex">
          <div className="shrink-0 px-2 py-2 text-[13px] font-semibold text-ink">
            {t("settings.title")}
          </div>
          <div className="mb-2 mt-1 flex shrink-0 items-center gap-2 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 focus-within:border-border-strong">
            <Search size={14} className="shrink-0 text-ink-secondary" />
            <input
              data-settings-search
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.stopPropagation();
                if (query) setQuery("");
                else closeSettings();
              }}
              placeholder={t("settings.search")}
              aria-label={t("settings.searchAria")}
              className="w-full bg-transparent text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </div>
          {visibleSections.length === 0 && !pagesHit && (
            <div className="px-2.5 py-4 text-[12.5px] leading-relaxed text-ink-secondary">
              {t("settings.noMatch", { query: query.trim() })}
            </div>
          )}
          {/* 2026-10-16: the rail in headed groups, as Cursor Settings
              groups its own (you, AI, the workspace, this app last). A
              heading shows while one of its entries does, a search too. */}
          {NAV_GROUPS.map((group) => {
            // #2080 (L0): App (id "about") is a page of the rail; the About
            // window opens from its link. #2090: Updates is its own page too.
            const entries = visibleSections.filter((entry) => entry.group === group.id);
            if (entries.length === 0) return null;
            const headingId = `app-settings-nav-${group.id}`;
            return (
              <div key={group.id} role="group" aria-labelledby={headingId} data-settings-nav-group={group.id} className="flex shrink-0 flex-col gap-0.5">
                <div id={headingId} className="px-[9px] pb-1 pt-3 text-[11.5px] font-medium leading-4 text-ink-tertiary">
                  {t(group.labelKey)}
                </div>
                {entries.map(({ id, labelKey, icon: Icon }) => (
                  <div key={id} className="flex min-w-0 flex-col">
                    <button
                      onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: id })}
                      aria-current={section === id ? "page" : undefined}
                      data-settings-nav-row={id}
                      className={cn(
                        "flex items-center gap-[9px] rounded-lg px-[9px] py-[7px] text-left text-[13px] leading-[18px] text-ink transition-colors motion-reduce:transition-none",
                        // JC 2026-11-07: the hover fill (hover, 17% grey) read as a
                        // second selected row next to bg-selected (32% grey). The
                        // hover is a barely visible ink wash, as the reference asks.
                        section === id ? "bg-selected" : "hover:bg-ink/[0.05]",
                      )}
                    >
                      {/* The reference design's nav item (198px rail, 7/9px padding, 9px gap,
                          8px corners, 15px icon) with its thinner glyph stroke */}
                      <Icon size={15} strokeWidth={1.5} className="shrink-0" />
                      {t(labelKey)}
                    </button>
                    {section === id && q && searchLabels.length > 0 && (
                      <ul data-settings-search-hits="" className="mb-0.5 flex flex-col">
                        {searchLabels.map((label) => (
                          <li key={label}>
                            <button
                              type="button"
                              className="w-full truncate rounded-md py-0.5 pl-[33px] pr-2 text-left text-[12px] leading-4 text-ink-secondary hover:bg-hover hover:text-ink"
                              onClick={() => {
                                const pane = paneRef.current;
                                if (pane) focusSettingsSearchLabel(pane, label);
                              }}
                            >
                              {label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
          {pagesHit && (
            <button
              type="button"
              data-settings-pages-hit=""
              onClick={() => openSettings(dispatch, "pages")}
              className="mt-2 flex items-center gap-[9px] rounded-lg px-[9px] py-[7px] text-left text-[13px] leading-[18px] text-ink hover:bg-hover"
            >
              <FileText size={15} strokeWidth={1.5} className="shrink-0" />
              <span className="min-w-0"><span className="block truncate">{t("settings.section.pages")}</span><span className="block truncate text-[12px] text-ink-secondary">{t("connectApps.title")}</span></span>
            </button>
          )}
        </nav>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <button
            onClick={closeSettings}
            aria-label={t("settings.close")}
            title={`${t("settings.close")} (${shortcutLabel("close-panel")})`}
            className="absolute right-2.5 top-2.5 z-10 flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink-secondary"
          >
            <X size={18} />
          </button>
          <div className="shrink-0 px-4 pb-1 pr-12 pt-3 sm:hidden">
            <select
              aria-label={t("settings.title")}
              value={section}
              onChange={(event) => {
                setQuery("");
                dispatch({ type: "toggleAppSettings", open: true, section: event.target.value as AppSettingsSection });
              }}
              className="w-full min-w-0 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink focus:border-border-strong focus:outline-none sm:hidden"
            >
              {NAV_GROUPS.map((group) => {
                const entries = availableSections.filter((entry) => entry.group === group.id);
                return entries.length === 0 ? null : (
                  <optgroup key={group.id} label={t(group.labelKey)}>
                    {entries.map(({ id, labelKey }) => (
                      <option key={id} value={id}>{t(labelKey)}</option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>

          {subPage && subPageId ? (
            <SettingsSubPage
              pageId={subPageId}
              sectionLabel={sectionLabelKey ? t(sectionLabelKey) : ""}
              title={t(subPage.titleKey)}
              onBack={closeSubPage}
            >
              {subPage.render()}
            </SettingsSubPage>
          ) : (
          <div ref={paneRef} data-settings-pane="" className="flex flex-1 flex-col overflow-y-auto">
            {/* #2080: the page title at 20px and, under it, the page's one
                sentence (introKey), on every page; the pages draw no intro. */}
            <div data-settings-page-header="" className="px-4 pt-2 sm:px-8 sm:pt-6">
              <h2 className="hidden text-[20px] font-semibold leading-7 tracking-[-0.012em] text-ink sm:block">
                {sectionLabelKey ? t(sectionLabelKey) : null}
              </h2>
              {sectionIntroKey && (
                <p data-settings-intro="" className="mt-0.5 text-[13px] leading-[18px] text-ink-secondary">{t(sectionIntroKey)}</p>
              )}
            </div>
            <div className="flex flex-col gap-3 px-4 pb-6 pt-4 sm:px-8">
            {/* Developer is the technical page (#2636): nothing folds there, in Simple mode too */}
            <SettingsAdvancedScope key={section} pageId={section} fold={!advanced && section !== "developer"} searching={Boolean(q)}>
            {/* 0.5.6: the reference design's layout (OrganizationSettings): grey
                headings over cards of rows. Memory and, from General >
                Advanced (2026-10-15), routines in the conversation, group
                turns and MCP calls are rows of its groups. */}
            {section === "organization" && (
              allowed("organization")
                ? <OrganizationSettings memoryShown={memoryShown} />
                : memoryShown && (
                  <SettingsGroup title={t("organization.group.memory")} groupId="organizationMemory">
                    <OrgMemorySettings />
                  </SettingsGroup>
                )
            )}
            {section === "account" && (
              <>
                {/* #2080 L2: identity and region only. Open at login, tours,
                    diagnostics and the former Advanced rows live on App. */}
                <SettingsGroup groupId="account">
                  <AccountCard lockedServer={lockedServer} />
                  {(!state.config?.viewer || state.config.viewer.operator) && (
                    <SettingsSubPageRow
                      bare
                      cardId="general.aboutMe"
                      title={t("settings.profile.aboutMe")}
                      summary={aboutMeFirstLine(state.config?.profile?.aboutMe)}
                      actionLabel={t("settings.aboutMe.edit")}
                      onOpen={() => openSubPage("general.aboutMe")}
                    />
                  )}
                </SettingsGroup>
                <SettingsGroup title={t("settings.group.languageRegion")} groupId="languageRegion">
                  <LanguageRow />
                  <TimeZoneRows />
                </SettingsGroup>
              </>
            )}

            {/* Security (2026-10-28, out of Account): security keys and the
                classes they confirm, every rule the person saved (paged),
                their own tool access. */}
            {section === "security" && (
              <div className="flex min-w-0 flex-col gap-3" data-security-page="">
                <SecurityKeySettings />
                {/* every Always allow, Always deny and Ask first the person saved, revocable (2026-10-19) */}
                <MyApprovalRules />
                {/* the person's own tool access, theirs without an admin (2026-10-26) */}
                <MyToolGrants />
                {/* everyone's tool access, for whoever edits the installation (JC 2026-11-06, out of App) */}
                {editConfig && <PeopleToolAccessSettings />}
              </div>
            )}

            {/* Vault (2026-10-28, out of Account): logins, API keys and notes
                bots use without seeing them, Import, Export, Add an item,
                the one-time card, purchases and 1Password. */}
            {section === "credentials" && (
              <div className="flex min-w-0 flex-col gap-3" data-vault-page="">
                <CredentialsSettings />
              </div>
            )}

            {/* #2080: Updates, untitled card + links (release notes, About). */}
            {section === "updates" && (
              <>
                <div data-settings-card="updates">
                  <SettingsGroup groupId="updates">
                    <UpdatesRow />
                    <PrereleaseRow />
                    <AutoInstallAwayRow />
                  </SettingsGroup>
                </div>
              </>
            )}

            {/* General (JC 2026-11-06): System, Keyboard and typing, Advanced mode. */}
            {section === "general" && <GeneralPage remoteActive={remoteActive} />}

            {/* About (JC 2026-11-07, was Help and about): the About window, tours, help rows. */}
            {section === "about" && <AboutPage remoteActive={remoteActive} openAbout={openAbout} />}

            {section === "appearance" && (
              <>
                <AppearanceSettings />
                {/* run card, inspector and turn timing are on Developer (#2636) */}
                <DeveloperLink />
              </>
            )}

            {section === "experimental" && <ExperimentalSettings />}

            {/* Developer (#2636, JC 2026-11-07): every technical option, for every member. */}
            {section === "developer" && <DeveloperSettings remoteActive={remoteActive} openAbout={openAbout} />}

            {/* Providers (2026-10-30) */}
            {section === "providers" && (
              // the link with Grok Bot sits in Providers > Advanced (#2295)
              <ProvidersSettings />
            )}

            {section === "engines" && (
              <div className="flex min-w-0 flex-col gap-6">
                <EnginesSettings />
                {/* Decision model (2026-10-14): a group of Models, shown
                    while its experiment is on. */}
                {allowed("decisionModel") && <DecisionModelSettings />}
              </div>
            )}

            {/* Voice (2026-10-28, out of Models and voice) */}
            {section === "voice" && <VoiceSettingsPage />}

            {/* Backups (#2080): export and restore only. Grok Bot / primary-bot preference import left this page (JC 2026-11-06). Updates stay on their own page (#2090). */}
            {section === "backups" && (
              <>
                <WorkspaceBackupSettings />
                {/* event log cleanup and retention are on Developer (#2636) */}
                <DeveloperLink />
              </>
            )}

            {section === "computer" && <LocalComputerSection />}

            {/* every OS permission with its button (#2614) */}
            {section === "permissions" && <OsPermissionsSection />}

            {section === "usage" && (
              <>
                <UsageSection />
                {/* the usage meter in the chat is on Developer (#2636) */}
                <DeveloperLink />
              </>
            )}
            {/* Privacy (2026-10-14): a group of Notifications on an organization server. */}
            {section === "notifications" && <NotificationSettings privacy={allowed("privacy")} />}
            </SettingsAdvancedScope>
            </div>
          </div>
          )}
          {/* Hibou 98 only: the era's dialog footer. Settings save as you go,
              so OK simply closes, like the other skins' close box. */}
          {retroSkin && (
            <div className="r98-dialog-footer">
              <button type="button" className="r98-dialog-ok" onClick={() => dispatch({ type: "toggleAppSettings", open: false })}>
                {t("retro.button.ok")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
    );
}
