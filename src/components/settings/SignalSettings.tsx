// #2695: the person's signal budget and quiet hours, across all their bots
// (shared/signal-levels.ts). An approval or a question a run waits on, and a
// message from a person, always reach them; other pushes count against the
// daily budget and wait outside quiet hours, then show as one line of the
// next brief. Kept per person on the organization server (USER_PREFERENCE_KEYS,
// synced by the app); on a personal computer the rows save the same two keys
// through /api/me/signals (server/routes/signal-settings.ts).
//
// #4250 (S2): the one page of the one attention policy
// (shared/attention-policy.ts): quiet hours (ONE setting per person, obeyed
// by the desktop, the phones and every channel), the day budget, and the
// channels each level may use outside the app. A bot keeps only its own
// channels ("Reach me" on its page); here the person says which of them
// urgent signals and the other signals may use.
import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { localChoice } from "@/lib/local-choice";
import type { LocaleKey } from "@/locales";
import { levelChannelsValue, NOTIFY_CHANNELS_KEY, readLevelChannels, type LevelChannels } from "../../../shared/attention-policy";
import { REACH_CHANNELS, type ReachChannelId } from "../../../shared/reach-me";
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

/** A stored JSON preference (the quiet hours, any time zone, another
 * device may have set them; the channels per level): read straight from
 * localStorage, which the preference sync fills. */
function storedPreference(key: string) {
  const listeners = new Set<() => void>();
  const read = (): string | null => {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  };
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) listener(); };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  };
  const write = (value: string | null): void => {
    try {
      if (value) globalThis.localStorage?.setItem(key, value);
      else globalThis.localStorage?.removeItem(key);
    } catch { /* storage blocked: nothing to keep */ }
    for (const listener of listeners) listener();
  };
  return { read, subscribe, write };
}
const quietPreference = storedPreference(QUIET_HOURS_KEY);
const channelsPreference = storedPreference(NOTIFY_CHANNELS_KEY);
const readQuietRaw = quietPreference.read;
const writeQuiet = quietPreference.write;

/** The levels whose channels the person picks; FYI never leaves the app. */
const CHANNEL_LEVELS = ["urgent", "card"] as const;
const LEVEL_WORDS: Record<(typeof CHANNEL_LEVELS)[number], () => { title: string; description: string }> = {
  urgent: () => ({ title: t("settings.signals.channels.urgent.title"), description: t("settings.signals.channels.urgent.description") }),
  card: () => ({ title: t("settings.signals.channels.card.title"), description: t("settings.signals.channels.card.description") }),
};

/** #4250 (S2): the channels of `level` with `channel` turned on or off. */
export function toggleLevelChannel(channels: LevelChannels, level: (typeof CHANNEL_LEVELS)[number], channel: ReachChannelId, on: boolean): LevelChannels {
  const current = channels[level].filter((entry) => entry !== channel);
  const next = on ? REACH_CHANNELS.filter((entry) => entry === channel || current.includes(entry)) : current;
  return { ...channels, [level]: next };
}

/** One level's channels: a chip per channel, pressed when allowed. It sits on
 * the row's full-width line under the description, so the chips wrap inside
 * the card at phone width (the control slot never shrinks). */
function LevelChannelChips({ level, channels, onChange }: { level: (typeof CHANNEL_LEVELS)[number]; channels: LevelChannels; onChange: (next: LevelChannels) => void }) {
  return (
    <div role="group" aria-label={LEVEL_WORDS[level]().title} data-signal-channels={level} className="mt-2 flex min-w-0 flex-wrap gap-1.5">
      {REACH_CHANNELS.map((channel) => {
        const on = channels[level].includes(channel);
        return (
          <button
            key={channel}
            type="button"
            aria-pressed={on}
            data-signal-channel={channel}
            onClick={() => onChange(toggleLevelChannel(channels, level, channel, !on))}
            className={cn(
              "inline-flex h-7 items-center rounded-full border px-3 text-[12.5px] transition-colors motion-reduce:transition-none",
              on ? "border-transparent bg-selected text-ink" : "border-border text-ink-secondary hover:bg-hover hover:text-ink",
            )}
          >
            {t(`botPanel.reachMe.${channel}.label` as LocaleKey)}
          </button>
        );
      })}
    </div>
  );
}

/** Personal computer: what the server holds, and a save after each change. */
const SIGNALS_PATH = "/api/me/signals";
function saveSolo(input: { budget?: string | null; quiet?: string | null; channels?: string | null }): void {
  void api(SIGNALS_PATH, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }).catch(() => { /* kept on this computer; saved at the next change */ });
}

export function SignalSettings({ organization = false }: { organization?: boolean }) {
  useEffect(() => {
    if (organization) return;
    let live = true;
    void api<{ budget: string | null; quiet: string | null; channels?: string | null }>(SIGNALS_PATH).then((stored) => {
      if (!live || !stored) return;
      if (stored.budget && (BUDGET_VALUES as string[]).includes(stored.budget)) signalBudget.set(stored.budget as BudgetChoice);
      if (stored.quiet !== readQuietRaw()) writeQuiet(stored.quiet);
      if (stored.channels !== undefined && stored.channels !== channelsPreference.read()) channelsPreference.write(stored.channels);
    }).catch(() => { /* this computer's values stay */ });
    return () => { live = false; };
  }, [organization]);
  const budget = signalBudget.use();
  const quiet = quietPresetOf(useSyncExternalStore(quietPreference.subscribe, readQuietRaw, () => null));
  const channels = readLevelChannels(useSyncExternalStore(channelsPreference.subscribe, channelsPreference.read, () => null));
  const changeChannels = (next: LevelChannels) => {
    const value = levelChannelsValue(next);
    channelsPreference.write(value);
    if (!organization) saveSolo({ channels: value });
  };
  return (
    <SettingsGroup title={t("settings.group.signals")} groupId="signals">
      <DescribedRow label={t("settings.signals.budget.title")} description={t("settings.signals.budget.description")} rowId="signalBudget">
        <PillSelect
          value={budget}
          ariaLabel={t("settings.signals.budget.title")}
          onChange={(next) => {
            signalBudget.set(next);
            if (!organization) saveSolo({ budget: next });
          }}
          options={BUDGET_VALUES.map((value) => ({ value, label: t("settings.signals.budget.perDay", { count: value }) }))}
        />
      </DescribedRow>
      <DescribedRow label={t("settings.signals.quiet.title")} description={t("settings.signals.quiet.description")} rowId="quietHours">
        <PillSelect
          value={quiet}
          ariaLabel={t("settings.signals.quiet.title")}
          onChange={(next) => {
            const value = quietValueOf(next as QuietPreset);
            writeQuiet(value);
            if (!organization) saveSolo({ quiet: value });
          }}
          options={[
            { value: "off", label: t("settings.signals.quiet.off") },
            ...(Object.keys(QUIET_PRESETS) as (keyof typeof QUIET_PRESETS)[]).map((id) => ({ value: id, label: t("settings.signals.quiet.range", { start: QUIET_PRESETS[id].start, end: QUIET_PRESETS[id].end }) })),
          ]}
        />
      </DescribedRow>
      {CHANNEL_LEVELS.map((level) => (
        <DescribedRow
          key={level}
          label={LEVEL_WORDS[level]().title}
          description={LEVEL_WORDS[level]().description}
          rowId={`signalChannels-${level}`}
          below={<LevelChannelChips level={level} channels={channels} onChange={changeChannels} />}
        />
      ))}
    </SettingsGroup>
  );
}
