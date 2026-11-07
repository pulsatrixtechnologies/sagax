/**
 * Settings > Developer (#2636, JC 2026-11-07: « move every item that is
 * technical into the developer section »). One page of the App group holds
 * every technical option that was spread over Appearance, General, Usage,
 * Experimental, About and Backups. Each option lives here only, under a
 * heading of its own; the origin pages keep one discreet link (DeveloperLink).
 * Open to every member, in Simple and Advanced mode: nothing folds here, it
 * is the technical page. The installation's options (timeouts, loop guard,
 * OpenTelemetry, event log cleanup) stay with those who may edit the config,
 * as before; the person's own options show to everyone.
 */
import { t } from "@/lib/i18n";
import { setShowInspectorButton, useShowInspectorButton } from "@/lib/inspector-preferences";
import { setShowRunCard, useShowRunCard } from "@/lib/run-card-preferences";
import { setShowTurnTiming, useShowTurnTiming } from "@/lib/turn-timing-preferences";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { useStore } from "@/state/store";

import { ClaudeCodeRows } from "../ClaudeCodeSwitches";
import { setDevPodsEnabled, useDevPodPrefs } from "../dev-pods/prefs";
import { McpCallTimeoutSettings } from "../McpCallTimeoutSettings";
import { RoomTurnTimeoutSettings } from "../RoomTurnTimeoutSettings";
import { CompactRow, DescribedRow, SettingsGroup, Switch } from "../SettingsPrimitives";
import { ThreadCleanupSettings } from "../ThreadCleanupSettings";
import { DiagnosticsRow, DownloadLogsRow, generalAdvancedShown, LoopGuardRow } from "./AdvancedSettings";
import { DeveloperBotCard } from "./DeveloperBotCard";
import { canEditConfig } from "@/lib/viewer";
import { TelemetrySettings } from "./TelemetrySettings";
import { UsageMeterRow } from "./UsageMeterRow";

/** A switch row: label at the left, the switch at the right (as Appearance). */
function SwitchLine({ label, checked, onChange, rowId, ariaLabel }: { label: string; checked: boolean; onChange: (next: boolean) => void; rowId?: string; ariaLabel?: string }) {
  return (
    <CompactRow label={label} rowId={rowId}>
      <Switch checked={checked} aria-label={ariaLabel ?? label} onClick={() => onChange(!checked)} />
    </CompactRow>
  );
}

export function DeveloperSettings({ remoteActive }: { remoteActive: boolean }) {
  const { state } = useStore();
  const editConfig = canEditConfig(state.config);
  const runCard = useShowRunCard();
  const inspector = useShowInspectorButton();
  const turnTiming = useShowTurnTiming();
  const devPods = useDevPodPrefs().enabled;
  // Claude Code on this computer: a solo installation only (as Connect apps showed it).
  const organization = usePerspicaxOrg();
  // Diagnostics and logs: this computer's, or the server's when the config allows it (as About did).
  const showDiagnostics = !remoteActive || generalAdvancedShown(state.config);
  return (
    <div className="flex flex-col gap-6">
      {/* Conversation: what the chat shows of a run (was Appearance > Advanced and Usage > Advanced) */}
      <div data-settings-card="developer.conversation">
        <SettingsGroup title={t("settings.developer.conversation")} groupId="developerConversation">
          <SwitchLine label={t("settings.runCard.title")} ariaLabel={t("settings.runCard.show")} checked={runCard} onChange={setShowRunCard} rowId="runCard" />
          <SwitchLine label={t("settings.inspectorButton.title")} ariaLabel={t("settings.inspectorButton.show")} checked={inspector} onChange={setShowInspectorButton} rowId="inspectorButton" />
          <SwitchLine label={t("settings.turnTiming.title")} ariaLabel={t("settings.turnTiming.show")} checked={turnTiming} onChange={setShowTurnTiming} rowId="turnTiming" />
          <UsageMeterRow />
        </SettingsGroup>
      </div>
      {/* Bots: the two timeouts (were Organization > Bot rules, General on a solo desktop) */}
      {editConfig && (
        <div data-settings-card="developer.bots">
          <SettingsGroup title={t("settings.developer.bots")} groupId="developerBots">
            <RoomTurnTimeoutSettings />
            <McpCallTimeoutSettings />
          </SettingsGroup>
        </div>
      )}
      {editConfig && (
        <div data-settings-card="general.loopGuard">
          <SettingsGroup title={t("settings.loopGuard.title")} groupId="loopGuard">
            <LoopGuardRow />
          </SettingsGroup>
        </div>
      )}
      {editConfig && (
        <div data-settings-card="general.telemetry">
          <SettingsGroup title={t("telemetry.title")} groupId="telemetry">
            <TelemetrySettings />
          </SettingsGroup>
        </div>
      )}
      {editConfig && <ThreadCleanupSettings />}
      {/* Per bot (#2658): the bot page's technical cards, one bot at a time */}
      <DeveloperBotCard />
      {/* Claude Code on this computer (#2658, was Connect apps > Installed) */}
      {!organization && editConfig && (
        <div data-settings-card="developer.claudeCode">
          <SettingsGroup title={t("settings.developer.claudeCode")} groupId="developerClaudeCode">
            <ClaudeCodeRows />
          </SettingsGroup>
        </div>
      )}
      {showDiagnostics && (
        <div data-settings-card="developer.diagnostics">
          <SettingsGroup title={t("settings.developer.diagnostics")} groupId="developerDiagnostics">
            <DiagnosticsRow />
            <DownloadLogsRow />
          </SettingsGroup>
        </div>
      )}
      {/* Context pods (was Experimental > Developer) */}
      <div data-settings-card="developer.devPods">
        <SettingsGroup title={t("settings.developer.devPods")} groupId="developerDevPods">
          <DescribedRow label={t("settings.experimental.devPods")} description={t("settings.experimental.devPodsDescription")} rowId="devPods">
            <Switch checked={devPods} aria-label={t("settings.experimental.devPodsAria")} onClick={() => setDevPodsEnabled(!devPods)} />
          </DescribedRow>
        </SettingsGroup>
      </div>
    </div>
  );
}
