// Settings > General (id "general") and Settings > About (id
// "about"), JC 2026-11-06: the old App page was a catch-all. General holds
// how this app behaves on the computer (System), the composer keys
// (Keyboard and typing) and Advanced mode; About holds the About
// window, the tours and Send feedback. People's tool access went to
// Security. #2636 (JC 2026-11-07): the loop guard, OpenTelemetry, event log
// cleanup, the usage meter, diagnostics and logs are on Developer; each page
// here keeps one discreet link to it.
import { useState } from "react";

import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { withTourReset } from "@/lib/guided-tour";
import { completionPatch } from "@/lib/onboarding";
import { CompactRow, LinkRow, SettingsGroup } from "../SettingsPrimitives";
import { OpenAtLoginRow } from "../OpenAtLoginOffer";
import { isSoloDesktop, SendFeedbackRow } from "./AdvancedSettings";
import { OrganizationBotRows } from "./OrganizationBotRules";
import { PeopleToolAccessSettings } from "../ToolAccessSettings";
import { canEditConfig } from "@/lib/viewer";
import {
  AppearanceThemeRows,
  HardwareAccelerationRow,
  SendKeyRow,
  SpellcheckRow,
} from "./AppearanceSettings";
import { localeChoices } from "@/locales";
import { effectiveLanguage, setLanguageChoice, useLanguageChoice } from "@/lib/language-preference";
import { PillSelect } from "../SettingsPrimitives";
import { useSettingsPage } from "../SettingsSubPage";
import { NotificationQuickRows } from "../lazy-settings-sections";
import { AccountCard, type LockedServer } from "./AccountCard";
import { MicrophonePermissionRow, MicrophoneSettings } from "./MicrophoneSettings";
import { TimeZoneRows } from "./TimeZoneSettings";
import { SubPageEntry } from "./sub-page-entry";

/** Guided tours: one row, two actions kept (app tour and welcome). Mounted
 * on About so Account stays identity-only. */
export function GuidedToursRow() {
  const { state, dispatch } = useStore();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const replayAppTour = () => {
    setSaving(true);
    setFailed(false);
    void api("/api/config", {
      method: "PUT",
      body: JSON.stringify({ onboarding: {
        ...(!state.config?.onboarding?.completedAt ? completionPatch().onboarding : {}),
        hintsSeen: withTourReset(state.config?.onboarding),
      } }),
      signal: AbortSignal.timeout(10_000),
    })
      .then((config) => {
        dispatch({ type: "configStatus", config });
        dispatch({ type: "toggleTour", open: true });
      })
      .catch(() => setFailed(true))
      .finally(() => setSaving(false));
  };
  return (
    <>
      <CompactRow label={t("settings.tours.title")} rowId="tours">
        <button type="button" disabled={saving} onClick={replayAppTour} className="ui-button">
          {t("settings.appTour.title")}
        </button>
        <button type="button" onClick={() => dispatch({ type: "toggleWelcome", open: true })} className="ui-button">
          {t("settings.welcome.title")}
        </button>
      </CompactRow>
      {failed && <p role="alert" className="px-3.5 pb-2 text-[12px] text-danger">{t("onboarding.tour.error")}</p>}
    </>
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

/** General (#4457, the owner 2026-11-16): the reference app's General.
 * Account (who is signed in; About me is kept by the bots); Appearance (theme, accent,
 * language, time zone, spell check, send key, then More appearance);
 * Notifications (desktop notifications, the approval chime, then More
 * notifications); Mascots; System (microphone, hardware acceleration, open at
 * login, Shortcuts, Backups and storage); then Advanced (M-20261127-068, the
 * former Developer page). Each card keeps its former page's
 * rules (a remote client shows this desktop's own cards only). On a solo
 * desktop Organization is hidden, so the bot rules stay here under Advanced;
 * a remote client keeps people's tool access here. */
export function GeneralPage({ remoteActive = false, lockedServer = null }: { remoteActive?: boolean; lockedServer?: LockedServer | null }) {
  const { state } = useStore();
  const scope = useSettingsPage();
  const editConfig = canEditConfig(state.config);
  const solo = isSoloDesktop(state.config);
  return (
    <>
      {scope.allowed("account") && (
        <SettingsGroup title={t("settings.section.account")} groupId="account">
          <AccountCard lockedServer={lockedServer} />
        </SettingsGroup>
      )}

      <div data-settings-card="general.input">
        <SettingsGroup title={t("settings.section.appearance")} groupId="generalAppearance">
          {scope.allowed("appearance") && <AppearanceThemeRows />}
          {scope.allowed("account") && <LanguageRow />}
          {scope.allowed("account") && <TimeZoneRows />}
          <SpellcheckRow />
          <SendKeyRow />
          <SubPageEntry id="general.appearance" summary={t("settings.sub.moreAppearance.summary")} />
        </SettingsGroup>
      </div>

      {scope.allowed("notifications") && (
        <div data-settings-card="general.notifications">
          <SettingsGroup title={t("settings.section.notifications")} groupId="generalNotifications">
            <NotificationQuickRows />
            <SubPageEntry id="general.notifications" summary={t("settings.sub.moreNotifications.summary")} />
          </SettingsGroup>
        </div>
      )}

      {scope.allowed("appearance") && (
        <div data-settings-card="general.mascots">
          <SettingsGroup title={t("settings.group.mascots")} groupId="generalMascots">
            <SubPageEntry id="general.mascots" summary={t("settings.sub.moreMascots.summary")} />
          </SettingsGroup>
        </div>
      )}

      <div data-settings-card="general.system">
        <SettingsGroup title={t("settings.general.system")} groupId="generalSystem">
          {/* this computer's microphone: everyone's (#4457, it sat on Voice) */}
          {scope.allowed("voice") && (
            <div data-settings-card="connections.audio" className="flex flex-col">
              <MicrophonePermissionRow />
              <MicrophoneSettings />
            </div>
          )}
          <HardwareAccelerationRow />
          <OpenAtLoginRow />
          <SubPageEntry id="general.shortcuts" summary={t("settings.sub.shortcuts.summary")} />
          <SubPageEntry id="general.backups" summary={t("settings.sub.backups.summary")} />
        </SettingsGroup>
      </div>

      {solo && (
        <div data-settings-card="general.bots">
          <SettingsGroup advanced title={t("organization.group.bots")} groupId="organizationBots">
            <OrganizationBotRows />
          </SettingsGroup>
        </div>
      )}
      {remoteActive && editConfig && <PeopleToolAccessSettings />}

      {/* M-20261127-068: Advanced (former Developer) at the end of General */}
      <SettingsGroup groupId="generalAdvanced">
        <SubPageEntry id="general.advanced" summary={t("settings.sub.advanced.summary")} />
      </SettingsGroup>
    </>
  );
}

/** About: the About window (version, license, documentation,
 * release notes) and the tours, then Help (Send feedback; diagnostics and
 * logs are on Developer, #2636). */
export function AboutPage({ remoteActive, openAbout }: { remoteActive: boolean; openAbout: () => void }) {
  return (
    <>
      <div data-settings-card="about.about">
        <SettingsGroup title={t("settings.about.group")} groupId="aboutApp">
          <LinkRow rowId="about" label={t("settings.app.openAbout")} onClick={openAbout} />
          {!remoteActive && <GuidedToursRow />}
        </SettingsGroup>
      </div>

      <div data-settings-card="about.help">
        <SettingsGroup title={t("settings.app.help")} groupId="appHelp">
          <SendFeedbackRow />
        </SettingsGroup>
      </div>
    </>
  );
}
