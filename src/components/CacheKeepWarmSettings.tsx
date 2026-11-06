// Settings → Models: prompt-cache keep-warm for idle Claude threads
// (server/cache-keepwarm.ts). On by default; a bot override or enabled:false turns it off.
// Port of upstream 445fb7ac2 (Cache Tax design; see NOTICE).
import { useRef, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import { DescribedRow, PillSelect, SettingsGroup, Switch } from "./SettingsPrimitives";

type KeepWarm = NonNullable<ConfigStatus["cacheKeepWarm"]>;

/** Window choices, in minutes. 3h matches Cache Tax's auto-warm window. */
export const KEEP_WARM_WINDOWS = [60, 120, 180, 360, 720] as const;

export function CacheKeepWarmSettings() {
  const { state, dispatch } = useStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const current = state.config?.cacheKeepWarm;
  if (!current) return null;
  const save = async (next: KeepWarm) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const config = await api<ConfigStatus>("/api/config", {
        method: "PUT",
        body: JSON.stringify({ cacheKeepWarm: { enabled: next.enabled, windowMinutes: next.windowMinutes } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.keepWarm.error"));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  const windows: number[] = KEEP_WARM_WINDOWS.includes(current.windowMinutes as typeof KEEP_WARM_WINDOWS[number])
    ? [...KEEP_WARM_WINDOWS] : [...KEEP_WARM_WINDOWS, current.windowMinutes].sort((a, b) => a - b);
  // #2080: one group of rows like its neighbours; why and what it costs
  // behind the switch's help instead of two paragraphs.
  return (
    <SettingsGroup title={t("settings.keepWarm.title")} groupId="models-keep-warm">
      <DescribedRow
        label={t("settings.keepWarm.enable")}
        description={t("settings.keepWarm.subtitle")}
        help={<><span className="block">{t("settings.keepWarm.help")}</span><span className="mt-2 block">{t("settings.keepWarm.cost")}</span></>}
        rowId="models.keepWarm"
      >
        <Switch checked={current.enabled} disabled={saving} aria-label={t("settings.keepWarm.enable")}
          onClick={() => void save({ ...current, enabled: !current.enabled })} />
      </DescribedRow>
      <DescribedRow label={t("settings.keepWarm.window")} rowId="models.keepWarm.window">
        <PillSelect
          value={String(current.windowMinutes)}
          ariaLabel={t("settings.keepWarm.window")}
          disabled={saving || !current.enabled}
          onChange={(next) => void save({ ...current, windowMinutes: Number(next) })}
          options={windows.map((minutes) => ({ value: String(minutes), label: t("settings.keepWarm.hours", { hours: Number((minutes / 60).toFixed(2)) }) }))}
        />
      </DescribedRow>
      {saving && <span role="status" className="sr-only">{t("settings.threads.saving")}</span>}
      {error && <p role="alert" className="px-3.5 pb-2 text-[12px] text-danger">{error}</p>}
    </SettingsGroup>
  );
}
