// Settings > General (id "general") and Settings > Help and about (id
// "about"), JC 2026-11-06: the old App page was a catch-all. General holds
// how this app behaves on the computer (System), the composer keys
// (Keyboard and typing) and Advanced mode; Help and about holds the About
// window, the tours and the help rows. Cleanup went to Backups and storage,
// people's tool access to Security, the usage meter to Usage.
import { useState } from "react";

import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { withTourReset } from "@/lib/guided-tour";
import { completionPatch } from "@/lib/onboarding";
import { CompactRow, LinkRow, SettingsGroup } from "../SettingsPrimitives";
import { OpenAtLoginRow } from "../OpenAtLoginOffer";
import {
  DiagnosticsRow,
  DownloadLogsRow,
  generalAdvancedShown,
  isSoloDesktop,
  LoopGuardRow,
  SendFeedbackRow,
} from "./AdvancedSettings";
import { OrganizationBotRows } from "./OrganizationBotRules";
import { ThreadCleanupSettings } from "../ThreadCleanupSettings";
import { PeopleToolAccessSettings } from "../ToolAccessSettings";
import { canEditConfig } from "@/lib/viewer";
import {
  AppIconRow,
  BotHotkeysRows,
  HardwareAccelerationRow,
  InterfaceModeRow,
  SendKeyRow,
  SpellcheckRow,
} from "./AppearanceSettings";

/** Guided tours: one row, two actions kept (app tour and welcome). Mounted
 * on Help and about so Account stays identity-only. */
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

      <div data-settings-card="general.interface">
        <SettingsGroup title={t("settings.general.interface")} groupId="generalInterface">
          <InterfaceModeRow />
        </SettingsGroup>
      </div>

      {solo && (
        <div data-settings-card="general.bots">
          <SettingsGroup advanced title={t("organization.group.bots")} groupId="organizationBots">
            <OrganizationBotRows />
          </SettingsGroup>
        </div>
      )}
      {editConfig && (
        <div data-settings-card="general.loopGuard">
          <SettingsGroup advanced title={t("settings.loopGuard.title")} groupId="loopGuard">
            <LoopGuardRow />
          </SettingsGroup>
        </div>
      )}
      {remoteActive && editConfig && <PeopleToolAccessSettings />}
      {remoteActive && editConfig && <ThreadCleanupSettings />}
    </>
  );
}

/** Help and about: the About window (version, license, documentation,
 * release notes) and the tours, then Help (diagnostics, logs, feedback). */
export function AboutPage({ remoteActive, openAbout }: { remoteActive: boolean; openAbout: () => void }) {
  const { state } = useStore();
  const showHelp = !remoteActive || generalAdvancedShown(state.config);
  return (
    <>
      <div data-settings-card="about.about">
        <SettingsGroup title={t("settings.about.group")} groupId="aboutApp">
          <LinkRow rowId="about" label={t("settings.app.openAbout")} onClick={openAbout} />
          {!remoteActive && <GuidedToursRow />}
        </SettingsGroup>
      </div>

      {showHelp && (
        <div data-settings-card="about.help">
          <SettingsGroup title={t("settings.app.help")} groupId="appHelp">
            <DiagnosticsRow />
            <DownloadLogsRow />
            <SendFeedbackRow />
          </SettingsGroup>
        </div>
      )}
    </>
  );
}
