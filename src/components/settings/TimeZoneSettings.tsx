// Settings > Account > Language and region > Time zone (parity 2E, #2080 L2):
// one row, the page's plain select (PillSelect) like Language. The first option is Automatic (this computer's zone); picking a
// named zone turns auto off. sagax_settings: account.timeZone / timeZoneAuto.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { CompactRow, PillSelect } from "../SettingsPrimitives";

interface BotSettingsAnswer {
  settings: { timeZone: string | null; timeZoneAuto: boolean };
  hostTimeZone: string;
  effectiveTimeZone: string;
}

const AUTO_VALUE = "__auto__";

export function detectedTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Every zone the runtime knows, UTC first. */
export function timeZoneChoices(): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    return ["UTC", ...all.filter((zone) => zone !== "UTC")];
  } catch {
    return ["UTC"];
  }
}

export function TimeZoneRows() {
  const [answer, setAnswer] = useState<BotSettingsAnswer | null>(null);
  const [error, setError] = useState("");
  const zones = useMemo(timeZoneChoices, []);
  const latest = useRef(0);

  const save = useCallback(async (patch: { timeZone?: string; timeZoneAuto?: boolean }) => {
    const mine = ++latest.current;
    try {
      const next = await api<BotSettingsAnswer>("/api/settings/bot", { method: "PUT", body: JSON.stringify(patch) });
      if (mine !== latest.current) return;
      setAnswer(next);
      setError("");
    } catch {
      setError(t("settings.timeZone.failed"));
    }
  }, []);

  useEffect(() => {
    let live = true;
    void api<BotSettingsAnswer>("/api/settings/bot", { cache: "no-store" }).then((next) => {
      if (!live) return;
      setAnswer(next);
      const here = detectedTimeZone();
      if (next.settings.timeZoneAuto && next.settings.timeZone !== here) void save({ timeZone: here, timeZoneAuto: true });
    }).catch(() => {
      // Gallery and offline: still show the row with this computer's zone.
      if (!live) return;
      const here = detectedTimeZone();
      setAnswer({ settings: { timeZone: here, timeZoneAuto: true }, hostTimeZone: here, effectiveTimeZone: here });
    });
    return () => { live = false; };
  }, [save]);

  const here = detectedTimeZone();
  const auto = answer ? answer.settings.timeZoneAuto : true;
  const zone = answer ? (answer.settings.timeZone ?? answer.effectiveTimeZone) : here;
  // the value is said once, in the control; a zone this runtime does not list stays selectable
  const named = zones.includes(zone) ? zones : [zone, ...zones];
  const options = [
    { value: AUTO_VALUE, label: t("settings.timeZone.autoOption", { zone: here }) },
    ...named.map((name) => ({ value: name, label: name })),
  ];
  return (
    <CompactRow label={t("settings.timeZone.title")} rowId="timeZone">
      <div className="flex min-w-0 flex-col items-end gap-1">
        <PillSelect
          value={auto ? AUTO_VALUE : zone}
          ariaLabel={t("settings.timeZone.title")}
          disabled={!answer}
          onChange={(next) => {
            if (next === AUTO_VALUE) { if (!auto) void save({ timeZone: here, timeZoneAuto: true }); return; }
            if (next === answer?.settings.timeZone && !auto) return;
            void save({ timeZone: next, timeZoneAuto: false });
          }}
          options={options}
        />
        {error ? <span role="alert" className="text-[12px] text-danger">{error}</span> : null}
      </div>
    </CompactRow>
  );
}
