// Settings > Account > Language and region > Time zone (parity 2E, #2080 L2):
// one row. The first option is Automatic (this computer's zone); picking a
// named zone turns auto off. sagax_settings: account.timeZone / timeZoneAuto.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { DescribedRow } from "../SettingsPrimitives";

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

/** The field's CSS width for a value: its characters plus the padding, at
 * least the width the empty field always had (14rem). */
export function timeZoneFieldWidth(value: string): string {
  return `max(14rem, calc(${value.length}ch + 1.75rem))`;
}

export function TimeZoneRows() {
  const listId = useId();
  const [answer, setAnswer] = useState<BotSettingsAnswer | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const zones = useMemo(timeZoneChoices, []);
  const latest = useRef(0);

  const save = useCallback(async (patch: { timeZone?: string; timeZoneAuto?: boolean }) => {
    const mine = ++latest.current;
    try {
      const next = await api<BotSettingsAnswer>("/api/settings/bot", { method: "PUT", body: JSON.stringify(patch) });
      if (mine !== latest.current) return;
      setAnswer(next);
      setDraft(next.settings.timeZoneAuto ? AUTO_VALUE : (next.settings.timeZone ?? ""));
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
      setDraft(next.settings.timeZoneAuto ? AUTO_VALUE : (next.settings.timeZone ?? next.effectiveTimeZone));
      const here = detectedTimeZone();
      if (next.settings.timeZoneAuto && next.settings.timeZone !== here) void save({ timeZone: here, timeZoneAuto: true });
    }).catch(() => {
      // Gallery and offline: still show the row with this computer's zone.
      if (!live) return;
      const here = detectedTimeZone();
      setAnswer({ settings: { timeZone: here, timeZoneAuto: true }, hostTimeZone: here, effectiveTimeZone: here });
      setDraft(AUTO_VALUE);
    });
    return () => { live = false; };
  }, [save]);

  if (!answer) {
    const here = detectedTimeZone();
    return (
      <DescribedRow label={t("settings.timeZone.title")} rowId="timeZone" description={t("settings.timeZone.autoOption", { zone: here })}>
        <div className="h-8 w-56 max-w-full rounded-full bg-control" aria-hidden="true" />
      </DescribedRow>
    );
  }
  const auto = answer.settings.timeZoneAuto;
  const here = detectedTimeZone();
  const shown = auto ? t("settings.timeZone.autoOption", { zone: here }) : draft;
  const commit = () => {
    const value = draft.trim();
    if (!value || value === AUTO_VALUE || value === t("settings.timeZone.autoOption", { zone: here })) {
      if (!auto) void save({ timeZone: here, timeZoneAuto: true });
      return;
    }
    if (value === answer.settings.timeZone && !auto) return;
    const match = zones.find((zone) => zone.toLowerCase() === value.toLowerCase()) ?? (isTimeZone(value) ? value : null);
    if (!match) {
      setError(t("settings.timeZone.invalid"));
      return;
    }
    void save({ timeZone: match, timeZoneAuto: false });
  };
  return (
    <DescribedRow
      label={t("settings.timeZone.title")}
      rowId="timeZone"
      description={auto ? t("settings.timeZone.autoOption", { zone: here }) : undefined}
    >
      <div className="flex min-w-0 flex-col items-end gap-1">
        <input
          type="text"
          list={listId}
          value={shown}
          spellCheck={false}
          autoComplete="off"
          aria-label={t("settings.timeZone.title")}
          placeholder={t("settings.timeZone.search")}
          onFocus={() => { if (auto) setDraft(""); }}
          onChange={(event) => { setDraft(event.target.value); setError(""); }}
          onBlur={commit}
          onKeyDown={(event) => { if (event.key === "Enter") commit(); }}
          // As wide as its value (Automatic (America/Toronto), a long zone
          // name), never a fixed pill that cuts it (#3041); capped by the row.
          style={{ width: timeZoneFieldWidth(shown) }}
          className="h-8 max-w-full rounded-full bg-control px-3 text-right text-[13px] text-ink outline-none placeholder:text-ink-secondary focus-visible:ring-2 focus-visible:ring-accent/70"
        />
        <datalist id={listId}>
          <option value={t("settings.timeZone.autoOption", { zone: here })} />
          {zones.map((zone) => <option key={zone} value={zone} />)}
        </datalist>
        {error ? <span role="alert" className="text-[12px] text-danger">{error}</span> : null}
      </div>
    </DescribedRow>
  );
}
