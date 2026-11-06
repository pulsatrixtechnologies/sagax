// Settings > App (id "about", #2080): startup, input, help, advanced shell,
// and the installation rows that stay here when Organization is hidden (solo
// desktop). Card order: Startup, Input, Help, Advanced (mode + GPU), then
// sibling advanced groups for bot rules / cleanup / usage (no card in a card).
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

/** Cards L2 mounts on App. On a solo desktop Organization is hidden, so bot
 * rules, cleanup and the usage meter stay here as sibling advanced groups
 * (one card level, folded under Advanced in Simple mode). */
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
          {solo && (
            <SettingsGroup advanced title={t("organization.group.bots")} groupId="organizationBots">
              <OrganizationBotRows />
            </SettingsGroup>
          )}
          {editConfig && (
            <>
              <PeopleToolAccessSettings />
              <ThreadCleanupSettings />
              <SettingsGroup advanced title={t("settings.loopGuard.title")} groupId="loopGuard">
                <LoopGuardRow />
              </SettingsGroup>
            </>
          )}
          <SettingsGroup advanced title={t("settings.usage.title")} groupId="usageMeter">
            <UsageMeterRow />
          </SettingsGroup>
        </div>
      )}
    </>
  );
}
