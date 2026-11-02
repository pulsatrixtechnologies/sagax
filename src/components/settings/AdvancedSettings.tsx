// Settings > General > Advanced (0.5.6, Decision: the reference design's layout). Grey
// headings over cards of rows: the organization's bots (on a desktop with no
// server only: Organization is hidden there), people's tool access (when
// some exist), event log cleanup, and Diagnostics. Every value keeps its
// route and applies whether or not anyone looks.
//
// 2026-10-16 (the reference design parity): Diagnostics also has "Download logs" (the
// desktop app: one redacted text file, electron/log-bundle.mjs) and "Send
// feedback" (a mail draft to the public mailbox with the version and the
// system; nothing attached, logs only through Download logs).
import { useState } from "react";

import { appVersion, platformLabel } from "@/lib/app-links";
import { consoleRingLines } from "@/lib/console-ring";
import { desktopCapabilitiesNow } from "@/lib/desktop";
import { FEEDBACK_ADDRESS, feedbackMailto } from "@/lib/feedback";
import { launchBridges } from "@/lib/launch";
import { t } from "@/lib/i18n";
import { canEditConfig } from "@/lib/viewer";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { DescribedRow, PILL, SettingsGroup, Switch } from "../SettingsPrimitives";
import { ThreadCleanupSettings } from "../ThreadCleanupSettings";
import { PeopleToolAccessSettings } from "../ToolAccessSettings";
import { OrganizationBotRows } from "./OrganizationBotRules";
import { UsageMeterRow } from "./UsageMeterRow";
import { readableError } from "@/lib/plain-error";

/** The desktop app in "No server" mode: Settings > Organization is hidden
 * there (nothing to show until it joins one). */
export function isSoloDesktop(config: ConfigStatus | null | undefined): boolean {
  const remoteActive = window.ogb?.remoteClient?.active === true;
  return !remoteActive && Boolean(launchBridges(window.ogb)) && config?.onboarding?.launchMode !== "server";
}

/** Whether General > Advanced holds anything for this viewer: its rows are
 * an installation editor's, but for Diagnostics, which is the desktop app's. */
export function generalAdvancedShown(config: ConfigStatus | null | undefined): boolean {
  return canEditConfig(config) || Boolean(typeof window !== "undefined" && (window.ogb?.exportDiagnostics || window.ogb?.exportLogs));
}

export function GeneralAdvancedSettings() {
  const { state } = useStore();
  const editConfig = canEditConfig(state.config);
  return (
    <div className="flex flex-col gap-5" data-general-advanced="">
      {isSoloDesktop(state.config) && (
        <SettingsGroup title={t("organization.group.bots")} groupId="organizationBots">
          <OrganizationBotRows />
        </SettingsGroup>
      )}
      {editConfig && (
        <>
          {/* 2026-10-15: Tool access, Parallel conversations and Automatic
              recovery are each bot's own, in its editor (Permissions and
              Model pages). A person's grants stay here. */}
          <PeopleToolAccessSettings />
          <ThreadCleanupSettings />
          <SettingsGroup title={t("settings.loopGuard.title")} groupId="loopGuard">
            <LoopGuardRow />
          </SettingsGroup>
        </>
      )}
      <SettingsGroup title={t("settings.diagnostics.title")} groupId="diagnostics">
        <DiagnosticsRow />
        <DownloadLogsRow />
        <UsageMeterRow />
        <SendFeedbackRow />
      </SettingsGroup>
    </div>
  );
}

/** Workspace loop guard: on by default; steers then stops a repeating shell failure. */
export function LoopGuardRow() {
  const { state, dispatch } = useStore();
  const enabled = state.config?.loopGuard?.enabled !== false;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ loopGuard: { enabled: !enabled } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.loopGuard.error"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div data-settings-card="general.loopGuard">
      <DescribedRow
        label={t("settings.loopGuard.title")}
        rowId="loopGuard"
        description={error
          ? <span role="alert" className="text-danger">{error}</span>
          : t("settings.loopGuard.short")}
      >
        <Switch
          checked={enabled}
          aria-label={t("settings.loopGuard.aria")}
          disabled={saving}
          onClick={() => void toggle()}
          className="disabled:cursor-wait disabled:opacity-50"
        />
      </DescribedRow>
    </div>
  );
}

/** Writes a redacted diagnostics file to a location the user picks. The
 * report holds versions, configured-or-not booleans and the server.log tail:
 * never credential values (the desktop shell does not read secret fields). */
export function DiagnosticsRow() {
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  if (!window.ogb?.exportDiagnostics) return null;

  const exportDiagnostics = async () => {
    if (!window.ogb?.exportDiagnostics || exporting) return;
    setExporting(true);
    setResult(null);
    try {
      const path = await window.ogb.exportDiagnostics();
      if (path) setResult({ kind: "success", message: t("settings.diagnostics.saved", { path }) });
    } catch (e) {
      setResult({ kind: "error", message: readableError(e) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div data-settings-card="general.diagnostics">
      <DescribedRow
        label={t("settings.diagnostics.title")}
        rowId="diagnostics"
        description={result
          ? <span role={result.kind === "error" ? "alert" : "status"} className={result.kind === "error" ? "break-all text-danger" : "break-all text-success"}>{result.message}</span>
          : t("settings.diagnostics.short")}
      >
        <button type="button" onClick={() => void exportDiagnostics()} disabled={exporting} aria-label={t("settings.diagnostics.aria")} className={PILL}>
          {exporting ? t("settings.diagnostics.exporting") : t("settings.diagnostics.export")}
        </button>
      </DescribedRow>
    </div>
  );
}

/** Download logs: the recent logs in one redacted text file (desktop app). */
export function DownloadLogsRow() {
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  if (!window.ogb?.exportLogs) return null;

  const download = async () => {
    if (!window.ogb?.exportLogs || saving) return;
    setSaving(true);
    setResult(null);
    try {
      const path = await window.ogb.exportLogs(consoleRingLines());
      if (path) setResult({ kind: "success", message: t("settings.logs.saved", { path }) });
    } catch (e) {
      setResult({ kind: "error", message: readableError(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-settings-card="general.logs">
      <DescribedRow
        label={t("settings.logs.title")}
        rowId="downloadLogs"
        description={result
          ? <span role={result.kind === "error" ? "alert" : "status"} className={result.kind === "error" ? "break-all text-danger" : "break-all text-success"}>{result.message}</span>
          : t("settings.logs.short")}
      >
        <button type="button" onClick={() => void download()} disabled={saving} className={PILL} data-download-logs="">
          {saving ? t("settings.logs.saving") : t("settings.logs.download")}
        </button>
      </DescribedRow>
    </div>
  );
}

/** The system named in the feedback draft: "macOS", "Windows", "Linux", or the browser. */
function feedbackSystem(): string {
  const platform = desktopCapabilitiesNow()?.host?.platform;
  return platformLabel(platform) ?? t("settings.feedback.browser");
}

/** Send feedback: opens a mail draft to the public mailbox; nothing attached. */
export function SendFeedbackRow() {
  const url = feedbackMailto({ version: appVersion(), system: feedbackSystem() });
  return (
    <div data-settings-card="general.feedback">
      <DescribedRow label={t("settings.feedback.title")} rowId="sendFeedback" description={t("settings.feedback.short", { address: FEEDBACK_ADDRESS })}>
        <a
          href={url}
          className={PILL}
          data-send-feedback=""
          onClick={(event) => {
            // the desktop window hands a mail link to the system through
            // window.open (electron/app-permissions.mjs externalMailUrl)
            if (window.ogb) {
              event.preventDefault();
              window.open(url, "_blank", "noopener");
            }
          }}
        >
          {t("settings.feedback.open")}
        </a>
      </DescribedRow>
    </div>
  );
}
