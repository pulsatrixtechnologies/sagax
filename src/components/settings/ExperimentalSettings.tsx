// Settings > Experimental, laid out as Grok Bot's settings pages (0.5.6,
// JC): one group, each feature a row with its label and a switch. A feature
// this server cannot run keeps its row, greyed, with "Not available on this
// server" (the Data window on a server older than 0.5.3, #539/#560; the
// built-in browser with no engine) and the reason behind the help button.
// Routines in the conversation and Group turns are Organization's
// (2026-10-15): one way to reach them, no second switch here.
import { useEffect, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { browserAvailable, builtInBrowserEnabled, dataWindowEnabled, decisionModelEnabled, meetingNotetakerEnabled, skillAuthoringEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { LocaleKey } from "@/locales";
import { BrowserProfilesManager } from "../BrowserProfilesManager";
import { MyChromeSettings } from "./MyChromeSettings";
import { BrowserUnavailableNote } from "../SettingsLink";
import { DescribedRow, HelpTip, SettingsGroup, Switch } from "../SettingsPrimitives";
import { DisclosurePill } from "./AppearanceSettings";
import { setDevPodsEnabled, useDevPodPrefs } from "../dev-pods/prefs";
import { canEditConfig } from "@/lib/viewer";

type ExperimentalFeature = "skillAuthoring" | "browser" | "decisionModel" | "dataWindow" | "meetingNotetaker";

/** One feature: its label, and a grey "Not available on this server" line
 * with the reason on demand when the server cannot run it. */
function FeatureRow({
  feature,
  label,
  ariaKey,
  checked,
  unavailable,
  reason,
  note,
  busy,
  onToggle,
  below,
}: {
  feature: ExperimentalFeature;
  label: string;
  ariaKey: LocaleKey;
  checked: boolean;
  unavailable?: boolean;
  reason?: React.ReactNode;
  /** A short grey line for an available feature that still needs a step. */
  note?: React.ReactNode;
  busy: boolean;
  onToggle: () => void;
  below?: React.ReactNode;
}) {
  return (
    <div data-experimental-feature={feature} data-unavailable={unavailable ? "" : undefined} className={cn(unavailable && "[&_[id]]:text-ink-secondary")}>
      <DescribedRow
        label={label}
        description={unavailable ? t("settings.experimental.unavailable") : note}
        rowId={feature}
        below={below}
      >
        {unavailable && reason && <HelpTip label={t("settings.moreAbout", { title: label })}>{reason}</HelpTip>}
        <Switch
          checked={checked}
          aria-label={t(ariaKey)}
          // a feature already on can always be turned off
          disabled={busy || (unavailable && !checked)}
          onClick={onToggle}
          className="disabled:cursor-not-allowed disabled:opacity-40"
        />
      </DescribedRow>
    </div>
  );
}

/** The shared browser profiles, under the browser row: a count that opens
 * the manager in place. */
function BrowserProfilesBelow({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-settings-card="experimental.browserProfiles" data-open={open ? "true" : "false"} className="mt-1 flex flex-col">
      <div className="flex min-h-[32px] items-center justify-between gap-4 border-l-[0.5px] border-border pl-3">
        <span className="text-[13px] leading-[18px] text-ink">{t("settings.profiles.title")}</span>
        <DisclosurePill open={open} onToggle={() => setOpen((value) => !value)} label={t("settings.profiles.title")}>{count}</DisclosurePill>
      </div>
      {open && <div className="mt-2"><BrowserProfilesManager /></div>}
    </div>
  );
}

export function ExperimentalSettings() {
  const { state, dispatch } = useStore();
  const skillAuthoring = skillAuthoringEnabled(state.config);
  const browser = builtInBrowserEnabled(state.config);
  const decisionModel = decisionModelEnabled(state.config);
  const dataWindow = dataWindowEnabled(state.config);
  // A server that predates the Data window (Sagax 0.5.2 and earlier, e.g. an
  // organization server not updated yet) sends no dataWindow and refuses to
  // save one: the row stays, greyed.
  const dataWindowServed = typeof state.config?.features?.dataWindow === "boolean";
  const meetingNotetaker = meetingNotetakerEnabled(state.config);
  // A server without the notetaker sends no meetingNotetaker: the row stays, greyed.
  const meetingNotetakerServed = typeof state.config?.features?.meetingNotetaker === "boolean";
  const desktopBrowser = browserAvailable(state.config);
  const browserInstallable = state.config?.browserEngine?.installable === true;
  const browserBlockedOnWindows = typeof window !== "undefined" && window.ogb?.platform === "win32" && !desktopBrowser && !browserInstallable;
  const profiles = state.config?.browserProfiles ?? [];
  // The browser profiles and the "my Chrome" link write the installation
  // (browserProfiles and more): only a viewer who may edit the config sees
  // them. A server.experimental-only delegate keeps the feature switches,
  // which are all this right opens (shared/permissions.ts).
  const editConfig = canEditConfig(state.config);
  const [saving, setSaving] = useState<ExperimentalFeature | null>(null);
  const [error, setError] = useState("");

  // The switches show the server's saved state, read again when this page
  // opens: never a copy this page kept from earlier.
  useEffect(() => {
    let live = true;
    api<ConfigStatus>("/api/config").then((config) => { if (live) dispatch({ type: "configStatus", config }); }, () => {});
    return () => { live = false; };
  }, [dispatch]);

  const toggle = async (feature: ExperimentalFeature, next: boolean) => {
    if (saving) return;
    setSaving(feature);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { [feature]: next } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.experimental.error"));
    } finally {
      setSaving(null);
    }
  };
  const busy = saving !== null;
  // The dev context pods are this computer's own choice: no server round trip.
  const devPods = useDevPodPrefs().enabled;
  const on = Number(skillAuthoring) + Number(browser) + Number(decisionModel) + Number(dataWindow) + Number(meetingNotetaker) + Number(devPods);

  return (
    <div data-settings-card="experimental.features" className="flex flex-col gap-2">
      <SettingsGroup
        title={t("settings.experimental.title")}
        groupId="experimental"
        accessory={<span className="min-w-0 truncate text-[13px] leading-[18px] text-ink-secondary" data-experimental-count="">· {t("settings.card.countOn", { count: on, total: 6 })}</span>}
      >
        <FeatureRow
          feature="skillAuthoring"
          label={t("settings.experimental.skillAuthoring")}
          ariaKey="settings.experimental.skillAuthoringAria"
          checked={skillAuthoring}
          busy={busy}
          onToggle={() => void toggle("skillAuthoring", !skillAuthoring)}
        />
        <FeatureRow
          feature="browser"
          label={t("settings.experimental.browser")}
          ariaKey="settings.experimental.browserAria"
          checked={browser}
          unavailable={!desktopBrowser && !browserInstallable}
          reason={browserBlockedOnWindows ? t("settings.experimental.browserWindows") : <BrowserUnavailableNote config={state.config} />}
          // the engine can be installed: the switch works, one step remains
          note={!desktopBrowser && browserInstallable ? t("settings.experimental.browserInstall") : undefined}
          busy={busy}
          onToggle={() => void toggle("browser", !browser)}
          below={editConfig && (browser || profiles.length > 0) && <BrowserProfilesBelow count={profiles.length} />}
        />
        {browser && editConfig && <MyChromeSettings />}
        <FeatureRow
          feature="decisionModel"
          label={t("settings.experimental.decisionModel")}
          ariaKey="settings.experimental.decisionModel"
          checked={decisionModel}
          busy={busy}
          onToggle={() => void toggle("decisionModel", !decisionModel)}
        />
        <FeatureRow
          feature="dataWindow"
          label={t("settings.experimental.dataWindow")}
          ariaKey="settings.experimental.dataWindowAria"
          checked={dataWindow}
          unavailable={!dataWindowServed}
          reason={t("settings.experimental.dataWindowServerOld")}
          busy={busy}
          onToggle={() => void toggle("dataWindow", !dataWindow)}
        />
        <FeatureRow
          feature="meetingNotetaker"
          label={t("settings.experimental.meetingNotetaker")}
          ariaKey="settings.experimental.meetingNotetakerAria"
          checked={meetingNotetaker}
          unavailable={!meetingNotetakerServed}
          reason={t("settings.experimental.meetingNotetakerServerOld")}
          note={t("settings.experimental.meetingNotetakerHint")}
          busy={busy}
          onToggle={() => void toggle("meetingNotetaker", !meetingNotetaker)}
        />
        <div data-experimental-feature="devPods">
          <DescribedRow label={t("settings.experimental.devPods")} rowId="devPods">
            <Switch checked={devPods} aria-label={t("settings.experimental.devPodsAria")} onClick={() => setDevPodsEnabled(!devPods)} />
          </DescribedRow>
        </div>
      </SettingsGroup>
      {error ? <p role="alert" className="px-1 text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}
