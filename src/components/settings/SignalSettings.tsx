// #2695: the person's signal budget and quiet hours, across all their bots
// (shared/signal-levels.ts). An approval or a question a run waits on, and a
// message from a person, always reach them; other pushes count against the
// daily budget and wait outside quiet hours, then show as one line of the
// next brief. Kept per person on the organization server (USER_PREFERENCE_KEYS),
// so the rows only show there.
import { useSyncExternalStore } from "react";
import { t } from "@/lib/i18n";
import { localChoice } from "@/lib/local-choice";
import { QUIET_HOURS_KEY, SIGNAL_BUDGET_CHOICES, SIGNAL_BUDGET_DEFAULT, SIGNAL_BUDGET_KEY } from "../../../shared/signal-levels";
import { DescribedRow, PillSelect, SettingsGroup } from "../SettingsPrimitives";

type BudgetChoice = `${(typeof SIGNAL_BUDGET_CHOICES)[number]}`;
const BUDGET_VALUES = SIGNAL_BUDGET_CHOICES.map(String) as BudgetChoice[];
const signalBudget = localChoice<BudgetChoice>(SIGNAL_BUDGET_KEY, BUDGET_VALUES, String(SIGNAL_BUDGET_DEFAULT) as BudgetChoice);

/** Quiet hours presets; the stored value is JSON with this computer's time zone. */
export const QUIET_PRESETS = {
  "22-07": { start: "22:00", end: "07:00" },
  "21-08": { start: "21:00", end: "08:00" },
  "23-06": { start: "23:00", end: "06:00" },
} as const;
type QuietPreset = "off" | keyof typeof QUIET_PRESETS;

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Reads the stored JSON as a preset id ("off" when absent or unknown). */
export function quietPresetOf(raw: string | null | undefined): QuietPreset {
  if (!raw) return "off";
  try {
    const value = JSON.parse(raw) as { start?: unknown; end?: unknown };
    const hit = (Object.keys(QUIET_PRESETS) as (keyof typeof QUIET_PRESETS)[]).find((id) => QUIET_PRESETS[id].start === value.start && QUIET_PRESETS[id].end === value.end);
    return hit ?? "off";
  } catch {
    return "off";
  }
}

export function quietValueOf(preset: QuietPreset, timeZone = localTimeZone()): string | null {
  return preset === "off" ? null : JSON.stringify({ ...QUIET_PRESETS[preset], timeZone });
}

/** The stored quiet hours, any time zone (another device may have set
 * them): read straight from localStorage, which the preference sync fills. */
const quietListeners = new Set<() => void>();
function readQuietRaw(): string | null {
  try { return globalThis.localStorage?.getItem(QUIET_HOURS_KEY) ?? null; } catch { return null; }
}
function subscribeQuiet(listener: () => void): () => void {
  quietListeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === QUIET_HOURS_KEY || event.key === null) listener(); };
  window.addEventListener("storage", onStorage);
  return () => {
    quietListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
function writeQuiet(value: string | null): void {
  try {
    if (value) globalThis.localStorage?.setItem(QUIET_HOURS_KEY, value);
    else globalThis.localStorage?.removeItem(QUIET_HOURS_KEY);
  } catch { /* storage blocked: nothing to keep */ }
  for (const listener of quietListeners) listener();
}

export function SignalSettings() {
  const budget = signalBudget.use();
  const quiet = quietPresetOf(useSyncExternalStore(subscribeQuiet, readQuietRaw, () => null));
  return (
    <SettingsGroup title={t("settings.group.signals")} groupId="signals">
      <DescribedRow label={t("settings.signals.budget.title")} description={t("settings.signals.budget.description")} rowId="signalBudget">
        <PillSelect
          value={budget}
          ariaLabel={t("settings.signals.budget.title")}
          onChange={(next) => signalBudget.set(next)}
          options={BUDGET_VALUES.map((value) => ({ value, label: t("settings.signals.budget.perDay", { count: value }) }))}
        />
      </DescribedRow>
      <DescribedRow label={t("settings.signals.quiet.title")} description={t("settings.signals.quiet.description")} rowId="quietHours">
        <PillSelect
          value={quiet}
          ariaLabel={t("settings.signals.quiet.title")}
          onChange={(next) => {
            writeQuiet(quietValueOf(next as QuietPreset));
          }}
          options={[
            { value: "off", label: t("settings.signals.quiet.off") },
            ...(Object.keys(QUIET_PRESETS) as (keyof typeof QUIET_PRESETS)[]).map((id) => ({ value: id, label: t("settings.signals.quiet.range", { start: QUIET_PRESETS[id].start, end: QUIET_PRESETS[id].end }) })),
          ]}
        />
      </DescribedRow>
    </SettingsGroup>
  );
}
