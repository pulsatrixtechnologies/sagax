// #2080 L3: Browser card on Computer (moved out of Experimental). Built-in
// browser switch, profiles, and My Chrome.
import { useEffect, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { browserAvailable, builtInBrowserEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { BrowserProfilesManager } from "../BrowserProfilesManager";
import { MyChromeSettings } from "./MyChromeSettings";
import { BrowserUnavailableNote } from "../SettingsLink";
import { DescribedRow, HelpTip, SettingsGroup, Switch } from "../SettingsPrimitives";
import { DisclosurePill } from "./AppearanceSettings";
import { canEditConfig, canManageExperimental } from "@/lib/viewer";
import { useServerFeature } from "@/lib/server-features";
import { featureMissingOnServer } from "@/lib/server-route";
import { isPersonalFeature } from "../../../shared/person-settings";

function BrowserProfilesBelow({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-settings-card="computer.browserProfiles" data-open={open ? "true" : "false"} className="mt-1 flex flex-col">
      <div className="flex min-h-[32px] items-center justify-between gap-4 border-l-[0.5px] border-border pl-3">
        <span className="text-[13px] leading-[18px] text-ink">{t("settings.profiles.title")}</span>
        <DisclosurePill open={open} onToggle={() => setOpen((value) => !value)} label={t("settings.profiles.title")}>{count}</DisclosurePill>
      </div>
      {open && <div className="mt-2"><BrowserProfilesManager /></div>}
    </div>
  );
}

/** Settings > Computer > Browser: the built-in browser and My Chrome. */
export function ComputerBrowserSettings() {
  const { state, dispatch } = useStore();
  const browser = builtInBrowserEnabled(state.config);
  const desktopBrowser = browserAvailable(state.config);
  const browserInstallable = state.config?.browserEngine?.installable === true;
  const browserBlockedOnWindows = typeof window !== "undefined" && window.ogb?.platform === "win32" && !desktopBrowser && !browserInstallable;
  const editConfig = canEditConfig(state.config);
  const manage = canManageExperimental(state.config);
  const personalServed = useServerFeature("memberPersonSettings") !== "no";
  const personal = state.config?.personalSettings === true && personalServed;
  const profiles = (state.config?.browserProfiles ?? []).filter((profile) => (editConfig ? !profile.personal : profile.personal));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api<ConfigStatus>("/api/config").then((config) => { if (live) dispatch({ type: "configStatus", config }); }, () => {});
    return () => { live = false; };
  }, [dispatch]);

  const mayToggle = manage || (personal && isPersonalFeature("browser"));
  const toggle = async () => {
    if (saving || !mayToggle) return;
    setSaving(true);
    setError("");
    try {
      if (!manage) {
        await api("/api/me/experimental", { method: "PATCH", body: JSON.stringify({ features: { browser: !browser } }) });
        dispatch({ type: "configStatus", config: await api<ConfigStatus>("/api/config") });
        return;
      }
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { browser: !browser } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      if (featureMissingOnServer("memberPersonSettings", cause)) return;
      setError(cause instanceof Error ? cause.message : t("settings.experimental.error"));
    } finally {
      setSaving(false);
    }
  };

  const unavailable = !desktopBrowser && !browserInstallable;
  return (
    <SettingsGroup title={t("computer.group.browser")} groupId="computerBrowser">
      <div data-settings-card="computer.browser" data-unavailable={unavailable ? "" : undefined} className={cn(unavailable && "[&_[id]]:text-ink-secondary")}>
        <DescribedRow
          label={t("settings.experimental.browser")}
          description={unavailable ? t("settings.experimental.unavailable") : !mayToggle ? t("settings.experimental.serverSetting") : !desktopBrowser && browserInstallable ? t("settings.experimental.browserInstall") : undefined}
          rowId="browser"
          below={(editConfig || personal) && (browser || profiles.length > 0) && <BrowserProfilesBelow count={profiles.length} />}
        >
          {unavailable && (
            <HelpTip label={t("settings.moreAbout", { title: t("settings.experimental.browser") })}>
              {browserBlockedOnWindows ? t("settings.experimental.browserWindows") : <BrowserUnavailableNote config={state.config} />}
            </HelpTip>
          )}
          <Switch
            checked={browser}
            aria-label={t("settings.experimental.browserAria")}
            disabled={saving || !mayToggle || (unavailable && !browser)}
            onClick={() => void toggle()}
            className="disabled:cursor-not-allowed disabled:opacity-40"
          />
        </DescribedRow>
      </div>
      {browser && <MyChromeSettings />}
      {error ? <p role="alert" className="px-3.5 py-1 text-[12px] text-danger">{error}</p> : null}
    </SettingsGroup>
  );
}
