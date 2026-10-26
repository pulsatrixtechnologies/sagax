// Settings > Computer > Computer care: the scheduled update of the bot's
// computer in a maintenance window, and the disk saver (preview first,
// nothing deleted without a click, the trash only with a confirmation).
// Server side: server/computer-care.ts, server/routes/computer-care.ts.
import { useCallback, useEffect, useState } from "react";
import { HardDrive, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { activeLocale, t } from "@/lib/i18n";
import { formatBytes } from "@/lib/server-environment";
import type { LocaleKey } from "@/locales";
import { DescribedRow, PILL, PillSelect, SettingsGroup, SwitchRow } from "../SettingsPrimitives";
import { ComputerRecoverRow } from "./ComputerRecoverRow";

export interface MaintenanceSchedule {
  enabled: boolean;
  days: number[];
  hour: number;
  windowHours: number;
  timeZone: string;
}

export interface MaintenanceView {
  schedule: MaintenanceSchedule;
  nextWindowAt: number | null;
  lastResult?: { at: number; outcome: "updated" | "postponed" | "failed"; detail?: string };
  running: boolean;
}

export type DiskSaverId = "packageCaches" | "browserCache" | "thumbnails" | "tempFiles" | "trash" | "oldCheckpoints";

export interface DiskSaverPreview {
  computerRunning: boolean;
  items: Array<{ id: DiskSaverId; bytes: number; userFiles: boolean }>;
  totalBytes: number;
}

const DAY_KEYS: LocaleKey[] = [
  "computerCare.day.0", "computerCare.day.1", "computerCare.day.2", "computerCare.day.3",
  "computerCare.day.4", "computerCare.day.5", "computerCare.day.6",
];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WINDOW_HOURS = [1, 2, 3, 4, 6];

/** "daily" for every day, else the one day's number as a string. */
export function daysChoice(days: readonly number[]): string {
  return days.length === 7 ? "daily" : String(days[0] ?? 0);
}

export function daysFromChoice(choice: string): number[] {
  return choice === "daily" ? [...ALL_DAYS] : [Number(choice)];
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function hourLabel(hour: number): string {
  try {
    return new Intl.DateTimeFormat(activeLocale(), { hour: "numeric", minute: "2-digit" }).format(new Date(2026, 0, 1, hour, 0));
  } catch {
    return `${hour}:00`;
  }
}

function whenLabel(at: number): string {
  try {
    return new Intl.DateTimeFormat(activeLocale(), { weekday: "long", hour: "numeric", minute: "2-digit", day: "numeric", month: "short" }).format(new Date(at));
  } catch {
    return new Date(at).toLocaleString();
  }
}

/** The line under the scheduled update: what happened last, and when next. */
export function maintenanceSummary(view: MaintenanceView): string {
  const parts: string[] = [];
  if (view.running) parts.push(t("computerCare.update.running"));
  else if (view.schedule.enabled && view.nextWindowAt) parts.push(t("computerCare.update.next", { when: whenLabel(view.nextWindowAt) }));
  else parts.push(t("computerCare.update.off"));
  const last = view.lastResult;
  if (last) {
    const when = whenLabel(last.at);
    if (last.outcome === "updated") parts.push(t("computerCare.update.lastUpdated", { when }));
    else if (last.outcome === "postponed") parts.push(t("computerCare.update.lastPostponed", { when }));
    else parts.push(t("computerCare.update.lastFailed", { when, detail: last.detail ?? "" }));
  }
  return parts.join(" ");
}

const ITEM_KEYS: Record<DiskSaverId, LocaleKey> = {
  packageCaches: "computerCare.disk.packageCaches",
  browserCache: "computerCare.disk.browserCache",
  thumbnails: "computerCare.disk.thumbnails",
  tempFiles: "computerCare.disk.tempFiles",
  trash: "computerCare.disk.trash",
  oldCheckpoints: "computerCare.disk.oldCheckpoints",
};

/** What a fresh preview pre-selects: everything with bytes to free, never
 * the person's own files. */
export function defaultSelection(preview: DiskSaverPreview): Set<DiskSaverId> {
  return new Set(preview.items.filter((item) => item.bytes > 0 && !item.userFiles).map((item) => item.id));
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : t("computerCare.error"));
  return body as T;
}

export function ComputerCareSettings() {
  const [view, setView] = useState<MaintenanceView | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DiskSaverPreview | null>(null);
  const [selected, setSelected] = useState<Set<DiskSaverId>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [freed, setFreed] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/computer/maintenance", { signal: controller.signal })
      .then(async (response) => {
        // Nothing to care for here (no environments, not the owner): hide.
        if (response.status === 403 || response.status === 409 || response.status === 404) { setUnavailable(true); return; }
        setView(await readJson<MaintenanceView>(response));
      })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)); });
    return () => controller.abort();
  }, []);

  const save = useCallback(async (next: Partial<MaintenanceSchedule>) => {
    if (!view) return;
    setSaving(true);
    setError(null);
    try {
      const schedule = { ...view.schedule, ...next, timeZone: browserTimeZone() };
      const response = await fetch("/api/computer/maintenance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(schedule),
      });
      setView(await readJson<MaintenanceView>(response));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [view]);

  const scan = async () => {
    setScanning(true);
    setError(null);
    setFreed(null);
    try {
      const next = await readJson<DiskSaverPreview>(await fetch("/api/computer/disk-saver"));
      setPreview(next);
      setSelected(defaultSelection(next));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const clean = async () => {
    if (!preview || selected.size === 0) return;
    const userFiles = preview.items.some((item) => item.userFiles && selected.has(item.id));
    const confirm = (message: string) => window.ogb?.confirm ? window.ogb.confirm(message) : Promise.resolve(window.confirm(message));
    const bytes = preview.items.filter((item) => selected.has(item.id)).reduce((sum, item) => sum + item.bytes, 0);
    if (!(await confirm(t(userFiles ? "computerCare.disk.confirmTrash" : "computerCare.disk.confirm", { size: formatBytes(bytes) })))) return;
    setCleaning(true);
    setError(null);
    try {
      const response = await fetch("/api/computer/disk-saver", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categories: [...selected], ...(userFiles ? { confirmUserFiles: true } : {}) }),
      });
      const result = await readJson<{ freedBytes: number; preview: DiskSaverPreview }>(response);
      setFreed(result.freedBytes);
      setPreview(result.preview);
      setSelected(defaultSelection(result.preview));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCleaning(false);
    }
  };

  if (unavailable) return null;
  const schedule = view?.schedule;
  const selectedBytes = preview?.items.filter((item) => selected.has(item.id)).reduce((sum, item) => sum + item.bytes, 0) ?? 0;

  return (
    <SettingsGroup title={t("computerCare.title")} groupId="computerCare">
      <ComputerRecoverRow />
      <div data-settings-card="computer.maintenance" className="px-3.5 py-2.5">
        <SwitchRow
          label={t("computerCare.update.title")}
          description={view ? maintenanceSummary(view) : t("computerCare.loading")}
          help={t("computerCare.update.help")}
          checked={Boolean(schedule?.enabled)}
          disabled={!view || saving}
          onChange={(enabled) => void save({ enabled })}
        />
        {schedule?.enabled && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-secondary">
            <PillSelect
              value={daysChoice(schedule.days)}
              ariaLabel={t("computerCare.update.day")}
              disabled={saving}
              onChange={(choice) => void save({ days: daysFromChoice(choice) })}
              options={[
                { value: "daily", label: t("computerCare.update.daily") },
                ...ALL_DAYS.map((day) => ({ value: String(day), label: t(DAY_KEYS[day]!) })),
              ]}
            />
            <span>{t("computerCare.update.at")}</span>
            <PillSelect
              value={String(schedule.hour)}
              ariaLabel={t("computerCare.update.hour")}
              disabled={saving}
              onChange={(hour) => void save({ hour: Number(hour) })}
              options={Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: hourLabel(hour) }))}
            />
            <span>{t("computerCare.update.for")}</span>
            <PillSelect
              value={String(schedule.windowHours)}
              ariaLabel={t("computerCare.update.window")}
              disabled={saving}
              onChange={(hours) => void save({ windowHours: Number(hours) })}
              options={WINDOW_HOURS.map((hours) => ({ value: String(hours), label: t("computerCare.update.hours", { count: hours }) }))}
            />
          </div>
        )}
      </div>

      <div data-settings-card="computer.diskSaver">
        <DescribedRow
          label={t("computerCare.disk.title")}
          rowId="diskSaver"
          icon={<HardDrive size={14} />}
          description={t("computerCare.disk.hint")}
          below={(
            <>
              {preview && (
                <div className="mt-3 flex flex-col gap-1.5" data-disk-saver-preview="">
                  {!preview.computerRunning && <p className="text-[12px] text-ink-secondary">{t("computerCare.disk.notRunning")}</p>}
                  {preview.items.map((item) => (
                    <label key={item.id} className="flex items-center justify-between gap-3 text-[13px] text-ink" data-disk-saver-item={item.id}>
                      <span className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selected.has(item.id)}
                          disabled={cleaning || item.bytes === 0}
                          onChange={(event) => {
                            const next = new Set(selected);
                            if (event.target.checked) next.add(item.id);
                            else next.delete(item.id);
                            setSelected(next);
                          }}
                        />
                        <span className="min-w-0">
                          {t(ITEM_KEYS[item.id])}
                          {item.userFiles && <span className="ml-1.5 text-[12px] text-danger">{t("computerCare.disk.userFiles")}</span>}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-ink-secondary">{formatBytes(item.bytes)}</span>
                    </label>
                  ))}
                  {freed !== null && <p role="status" className="text-[12px] text-success">{t("computerCare.disk.freed", { size: formatBytes(freed) })}</p>}
                </div>
              )}
              {error && <div role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}
            </>
          )}
        >
          <button type="button" className={`${PILL} gap-1.5`} disabled={scanning || cleaning} onClick={() => void scan()}>
            {scanning ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={12} aria-hidden="true" />}
            {preview ? t("computerCare.disk.rescan") : t("computerCare.disk.scan")}
          </button>
          {preview && (
            <button type="button" className={`${PILL} gap-1.5`} disabled={cleaning || selected.size === 0} onClick={() => void clean()} data-disk-saver-clean="">
              {cleaning ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Trash2 size={12} aria-hidden="true" />}
              {t("computerCare.disk.clean", { size: formatBytes(selectedBytes) })}
            </button>
          )}
        </DescribedRow>
      </div>
    </SettingsGroup>
  );
}
