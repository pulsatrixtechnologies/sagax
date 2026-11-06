// Settings > App (id "about", #2080 L2): absorbs the rows that leave Account
// and Appearance. Card order matches PLAN.md decision 1: Version and updates
// (drawn by the modal), Startup and windows, Input, Help, Advanced (holding
// installation rows until L3 / Usage until L1), About.
import { useState } from "react";

import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { withTourReset } from "@/lib/guided-tour";
import { completionPatch } from "@/lib/onboarding";
import { CompactRow, SettingsGroup } from "../SettingsPrimitives";
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
import { UsageMeterRow } from "./UsageMeterRow";
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
 * on App > Help so Account stays identity-only. */
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

/** Cards L2 mounts on App while Account and Appearance slim down. Version /
 * updates and the About link stay in the modal. Holding cards use one
 * `advanced` plain group so Simple mode folds them under App > Advanced
 * until L1 (Usage) and L3 (Organization) take them. */
export function AppPageExtras({ remoteActive }: { remoteActive: boolean }) {
  const { state } = useStore();
  const editConfig = canEditConfig(state.config);
  const showHelp = !remoteActive || generalAdvancedShown(state.config);
  const solo = isSoloDesktop(state.config);
  const showHolding = editConfig || solo;

  return (
    <>
      <div data-settings-card="about.startup">
        <SettingsGroup title={t("settings.app.startup")} groupId="appStartup">
          <OpenAtLoginRow />
          <AppIconRow />
          <BotHotkeysRows />
        </SettingsGroup>
      </div>

      <div data-settings-card="about.input">
        <SettingsGroup title={t("settings.app.input")} groupId="appInput">
          <SendKeyRow />
          <SpellcheckRow />
        </SettingsGroup>
      </div>

      {showHelp && (
        <div data-settings-card="about.help">
          <SettingsGroup title={t("settings.app.help")} groupId="appHelp">
            {!remoteActive && <GuidedToursRow />}
            <DiagnosticsRow />
            <DownloadLogsRow />
            <SendFeedbackRow />
          </SettingsGroup>
        </div>
      )}

      <SettingsGroup title={[t("settings.advancedMode.title"), t("settings.hardwareAcceleration.title")].join(", ")} groupId="appAdvancedShell" advanced>
        <InterfaceModeRow />
        <HardwareAccelerationRow />
      </SettingsGroup>

      {showHolding && (
        <div data-settings-card="about.holding">
          <SettingsGroup title={t("settings.app.holding")} groupId="appHolding" advanced plain>
            {solo && (
              <SettingsGroup title={t("organization.group.bots")} groupId="organizationBots">
                <OrganizationBotRows />
              </SettingsGroup>
            )}
            {editConfig && (
              <>
                <PeopleToolAccessSettings />
                <ThreadCleanupSettings />
                <SettingsGroup title={t("settings.loopGuard.title")} groupId="loopGuard">
                  <LoopGuardRow />
                </SettingsGroup>
              </>
            )}
            <SettingsGroup title={t("settings.usage.title")} groupId="usageMeter">
              <UsageMeterRow />
            </SettingsGroup>
          </SettingsGroup>
        </div>
      )}
    </>
  );
}
