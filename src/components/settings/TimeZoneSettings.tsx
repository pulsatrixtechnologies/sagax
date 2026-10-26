// Settings > General > Appearance > Time zone (parity 2E): the person's own
// zone, which the clock a bot is told and their routines' wall-clock times
// read (server/bot-settings.ts, GET and PUT /api/settings/bot). "Detect
// automatically" follows this computer's zone, as the phone's row does.
// sagax_settings: account.timeZone and account.timeZoneAuto.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { CompactRow, Switch } from "../SettingsPrimitives";

interface BotSettingsAnswer {
  settings: { timeZone: string | null; timeZoneAuto: boolean };
  hostTimeZone: string;
  effectiveTimeZone: string;
}

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
  const listId = useId();
  const [answer, setAnswer] = useState<BotSettingsAnswer | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const zones = useMemo(timeZoneChoices, []);
  // only the latest request's answer is shown (an automatic save and a click can overlap)
  const latest = useRef(0);

  const save = useCallback(async (patch: { timeZone?: string; timeZoneAuto?: boolean }) => {
    const mine = ++latest.current;
    try {
      const next = await api<BotSettingsAnswer>("/api/settings/bot", { method: "PUT", body: JSON.stringify(patch) });
      if (mine !== latest.current) return;
      setAnswer(next);
      setDraft(next.settings.timeZone ?? "");
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
      setDraft(next.settings.timeZone ?? next.effectiveTimeZone);
      // Automatic: this computer's zone is the person's zone.
      const here = detectedTimeZone();
      if (next.settings.timeZoneAuto && next.settings.timeZone !== here) void save({ timeZone: here, timeZoneAuto: true });
    }).catch(() => { /* a server without these settings shows nothing */ });
    return () => { live = false; };
  }, [save]);

  if (!answer) return null;
  const auto = answer.settings.timeZoneAuto;
  const shown = auto ? detectedTimeZone() : draft;
  const commit = () => {
    const value = draft.trim();
    if (!value || value === answer.settings.timeZone) return;
    const match = zones.find((zone) => zone.toLowerCase() === value.toLowerCase()) ?? (isTimeZone(value) ? value : null);
    if (!match) {
      setError(t("settings.timeZone.invalid"));
      return;
    }
    void save({ timeZone: match, timeZoneAuto: false });
  };
  return (
    <>
      <CompactRow label={t("settings.timeZone.auto")} rowId="timeZoneAuto">
        <Switch
          checked={auto}
          aria-label={t("settings.timeZone.auto")}
          onClick={() => void save(auto ? { timeZoneAuto: false } : { timeZone: detectedTimeZone(), timeZoneAuto: true })}
        />
      </CompactRow>
      <CompactRow label={t("settings.timeZone.title")} rowId="timeZone">
        <div className="flex min-w-0 flex-col items-end gap-1">
          <input
            type="text"
            list={listId}
            value={shown}
            disabled={auto}
            spellCheck={false}
            autoComplete="off"
            aria-label={t("settings.timeZone.title")}
            placeholder={t("settings.timeZone.search")}
            onChange={(event) => { setDraft(event.target.value); setError(""); }}
            onBlur={commit}
            onKeyDown={(event) => { if (event.key === "Enter") commit(); }}
            className="h-8 w-56 max-w-full rounded-full bg-control px-3 text-right text-[13px] text-ink outline-none placeholder:text-ink-secondary focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-60"
          />
          <datalist id={listId}>{zones.map((zone) => <option key={zone} value={zone} />)}</datalist>
          {error ? <span role="alert" className="text-[12px] text-danger">{error}</span> : null}
        </div>
      </CompactRow>
    </>
  );
}
