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
import { DeveloperLink } from "./DeveloperLink";
import { OrganizationBotRows } from "./OrganizationBotRules";
import { PeopleToolAccessSettings } from "../ToolAccessSettings";
import { canEditConfig } from "@/lib/viewer";
import {
  AppIconRow,
  BotHotkeysRows,
  HardwareAccelerationRow,
  SendKeyRow,
  SpellcheckRow,
} from "./AppearanceSettings";

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

/** General: System (open at login, app icon, hotkeys, GPU), Keyboard and
 * typing (send key, spell check), Interface (Advanced mode, always shown so
 * Simple can switch back). On a solo desktop Organization is hidden, so the
 * bot rules stay here under Advanced, with the loop guard. A remote client
 * hides Security and Backups (pages of the other computer), so the server's
 * cleanup and people's tool access stay reachable here for it. */
export function GeneralPage({ remoteActive = false }: { remoteActive?: boolean }) {
  const { state } = useStore();
  const editConfig = canEditConfig(state.config);
  const solo = isSoloDesktop(state.config);
  return (
    <>
      <div data-settings-card="general.system">
        <SettingsGroup title={t("settings.general.system")} groupId="generalSystem">
          <OpenAtLoginRow />
          <AppIconRow />
          <BotHotkeysRows />
          <HardwareAccelerationRow />
        </SettingsGroup>
      </div>

      <div data-settings-card="general.input">
        <SettingsGroup title={t("settings.general.keyboard")} groupId="generalKeyboard">
          <SendKeyRow />
          <SpellcheckRow />
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
      <DeveloperLink />
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
      <DeveloperLink />
    </>
  );
}
