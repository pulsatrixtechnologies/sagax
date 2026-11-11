// #3432 (lot 7 of #3408): Settings, Notifications, « Ce que je reçois »:
// everything the person's bots may send on their own, in one list, beside
// the daily budget and quiet hours (SignalSettings). Nothing here is a
// permission screen: every row is the person's own choice and its switch
// acts at once, with no confirmation. A row that cannot work is not drawn
// (a domain no bot of theirs can carry, screen context off the desktop app,
// a checklist without items). Labels only: a bot or a watch is named, its
// identifier stays out of the screen.
//
// The data is GET /api/me/proactive?view=all (server/routes/proactive-choices.ts):
// the person's choices, and `receive`, the eligible domains with the bots
// that can carry each, its watches and their last alert, and per bot the
// ambient rows it can draw. The bot page draws the same domains for one
// bot (src/components/bot-settings/BotFollowsRows.tsx).
import { useCallback, useEffect, useState } from "react";
import { api, useStore, type Bot } from "@/state/store";
import { useStoreDispatch } from "@/state/store-selector";
import type { BotUpdatePatch } from "@/state/bot-patch-queue";
import { activeLocale, t } from "@/lib/i18n";
import { relativeTime } from "@/lib/memory";
import { localTimeZone } from "@/lib/reach-me";
import { proactiveModeFor } from "../../../shared/proactive-mode";
import {
  PROACTIVE_CHOICES_PATH, PROACTIVE_RECEIVE_VIEW,
  type DomainChoice, type ReceiveBot, type ReceiveDomain, type ReceiveView,
} from "../../../shared/proactive-choices";
import { DescribedRow, PillSelect, SettingsGroup, Switch } from "../SettingsPrimitives";
import { DirectTriggersRows } from "../bot-settings/DirectTriggersRows";
import { QuietModeAllRow } from "../bot-settings/QuietModeRow";
import { useQuietMode } from "@/lib/quiet-mode";

export interface ReceiveState {
  choices: Record<string, DomainChoice>;
  receive: ReceiveView;
}

/** One domain as a page draws it: its label, whether it is on, which of
 * the person's bots carries it, and the watches that run there. */
export interface DomainRowModel {
  domain: string;
  label: string;
  on: boolean;
  /** « Ne plus proposer »: still turned on from here. */
  never: boolean;
  /** The bot that carries it when on; the one a yes from here goes to when off. */
  botId: string;
  carriers: string[];
  /** Stored on with a bot that can no longer carry it: the loop pauses it
   * there, so the row is drawn off with that pause stated; a yes from here
   * moves it to `botId`. */
  pausedOn?: string;
  watches: Array<{ id: string; summary: string; cadence: string; on: boolean; lastAlertAt?: number }>;
  lastAlertAt?: number;
}

function labelOf(label: { fr?: string; en?: string }, fallback: string): string {
  const fr = activeLocale().toLowerCase().startsWith("fr");
  return (fr ? label.fr ?? label.en : label.en ?? label.fr) ?? fallback;
}

/** The rows of the person's domains. With `botId` (the bot page), only the
 * domains that bot can carry, each on when that bot carries it; a yes from
 * there moves the domain to it. A domain stored on with a bot that can no
 * longer carry it is drawn off with its pause stated (nothing runs there),
 * and a yes moves it to the first bot that can. */
export function domainRows(state: ReceiveState, botId?: string): DomainRowModel[] {
  return state.receive.domains.flatMap((row: ReceiveDomain): DomainRowModel[] => {
    if (botId && !row.carriers.includes(botId)) return [];
    const choice = state.choices[row.domain];
    const stored = choice?.state === "on" && choice.botId && row.carriers.includes(choice.botId) ? choice.botId : undefined;
    const carrier = botId ?? stored ?? row.carriers[0]!;
    const on = stored !== undefined && (botId ? stored === botId : true);
    const pausedOn = choice?.state === "on" && stored === undefined ? choice.botId ?? "" : undefined;
    const watches = row.watches
      .filter((watch) => watch.runsOn.includes(carrier))
      .map((watch) => ({
        id: watch.id, summary: watch.summary, cadence: watch.cadence,
        on: !choice?.watchesOff?.[watch.id],
        ...(watch.lastAlertAt ? { lastAlertAt: watch.lastAlertAt } : {}),
      }));
    if (!watches.length) return [];
    return [{
      domain: row.domain, label: labelOf(row.label, row.domain), on, never: choice?.state === "never",
      botId: carrier, carriers: row.carriers, watches,
      ...(pausedOn !== undefined ? { pausedOn } : {}),
      ...(row.lastAlertAt ? { lastAlertAt: row.lastAlertAt } : {}),
    }];
  });
}

/** "Every 15 min", "Every day at 08:00", "Every Sunday at 08:00"; "" for a
 * cadence this app does not read (never the raw value on screen). */
export function cadenceText(cadence: string): string {
  const raw = cadence.trim().toLowerCase();
  const every = /^(\d{1,4})(m|h)$/.exec(raw);
  if (every) {
    const count = Number(every[1]);
    if (every[2] === "h") return count === 1 ? t("settings.receive.cadence.hour") : t("settings.receive.cadence.hours", { count });
    return count % 60 === 0
      ? (count === 60 ? t("settings.receive.cadence.hour") : t("settings.receive.cadence.hours", { count: count / 60 }))
      : t("settings.receive.cadence.minutes", { count });
  }
  const daily = /^daily@(\d{1,2}):(\d{2})$/.exec(raw);
  if (daily) return t("settings.receive.cadence.daily", { time: `${daily[1]!.padStart(2, "0")}:${daily[2]}` });
  const weekly = /^weekly:([a-z]{3})@(\d{1,2}):(\d{2})$/.exec(raw);
  const index = weekly ? ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(weekly[1]!) : -1;
  if (weekly && index >= 0) {
    let day = weekly[1]!;
    try {
      // 2023-01-01 was a Sunday
      day = new Date(Date.UTC(2023, 0, 1 + index, 12)).toLocaleDateString(activeLocale(), { weekday: "long", timeZone: "UTC" });
    } catch { /* the short name stays */ }
    return t("settings.receive.cadence.weekly", { day, time: `${weekly[2]!.padStart(2, "0")}:${weekly[3]}` });
  }
  return "";
}

/** The person's choices and what their pages draw; every change is sent at
 * once and drawn before the answer, then the server's answer wins. */
export function useProactiveReceive(): {
  state: ReceiveState | null;
  setDomain: (row: DomainRowModel, on: boolean, botId?: string) => void;
  setWatch: (row: DomainRowModel, watchId: string, on: boolean) => void;
  setBot: (botId: string, change: Partial<Omit<ReceiveBot, "id">>) => void;
} {
  const [state, setState] = useState<ReceiveState | null>(null);
  const load = useCallback(async () => {
    try {
      const answer = await api<{ domains?: Record<string, DomainChoice>; receive?: ReceiveView }>(`${PROACTIVE_CHOICES_PATH}?view=${PROACTIVE_RECEIVE_VIEW}`);
      // an older server has no `receive`: nothing to draw
      setState(answer?.receive ? { choices: answer.domains ?? {}, receive: answer.receive } : null);
    } catch {
      setState(null);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const put = useCallback(async (body: Record<string, unknown>) => {
    try {
      const answer = await api<{ domains?: Record<string, DomainChoice> }>(PROACTIVE_CHOICES_PATH, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, via: "settings" }),
      });
      if (answer?.domains) setState((current) => (current ? { ...current, choices: answer.domains! } : current));
    } catch {
      // refused (no longer eligible, offline): draw what the server holds
      await load();
    }
  }, [load]);

  const setDomain = useCallback((row: DomainRowModel, on: boolean, botId?: string) => {
    const carrier = botId ?? row.botId;
    setState((current) => {
      if (!current) return current;
      const previous = current.choices[row.domain];
      const next: DomainChoice = { ...(previous ?? { at: Date.now(), via: "settings", by: "" }), state: on ? "on" : "off", ...(on ? { botId: carrier } : {}) };
      if (!on) delete next.botId;
      return { ...current, choices: { ...current.choices, [row.domain]: next } };
    });
    void put(on ? { domain: row.domain, state: "on", botId: carrier } : { domain: row.domain, state: "off" });
  }, [put]);

  const setWatch = useCallback((row: DomainRowModel, watchId: string, on: boolean) => {
    setState((current) => {
      if (!current) return current;
      const previous = current.choices[row.domain] ?? { state: "off" as const, at: Date.now(), via: "settings" as const, by: "" };
      const watchesOff = { ...previous.watchesOff };
      if (on) delete watchesOff[watchId];
      else watchesOff[watchId] = { at: Date.now(), via: "settings" };
      return { ...current, choices: { ...current.choices, [row.domain]: { ...previous, watchesOff } } };
    });
    void put({ domain: row.domain, watch: watchId, on });
  }, [put]);

  const setBot = useCallback((botId: string, change: Partial<Omit<ReceiveBot, "id">>) => {
    setState((current) => current && ({
      ...current,
      receive: { ...current.receive, bots: current.receive.bots.map((bot) => (bot.id === botId ? { ...bot, ...change } : bot)) },
    }));
    const path = `/api/bots/${encodeURIComponent(botId)}/background-brief`;
    const send = change.checklist !== undefined
      // a plain switch of the checklist wakes: no vote, no memory line
      ? api(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ checklist: change.checklist }) })
      : api(path, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(change.brief !== undefined ? { enabled: change.brief } : {}), ...(change.screen !== undefined ? { screenContext: change.screen } : {}), timeZone: localTimeZone() }),
      });
    void send.catch(() => load());
  }, [load]);

  return { state, setDomain, setWatch, setBot };
}

/** The rows of one domain: its switch (and, when on and more than one bot
 * can carry it, which bot), then each watch with its own switch. Shared by
 * Settings and the bot page. */
export function DomainRows({ row, bots, onDomain, onWatch, botPage = false, note }: {
  row: DomainRowModel;
  bots: ReadonlyArray<Pick<Bot, "id" | "name">>;
  onDomain: (on: boolean, botId?: string) => void;
  onWatch: (watchId: string, on: boolean) => void;
  /** The bot page: the domain's switch is this bot's; no bot picker. */
  botPage?: boolean;
  /** The bot page: which other bot carries it now. */
  note?: string;
}) {
  const nameOf = (id: string) => bots.find((bot) => bot.id === id)?.name ?? t("settings.receive.aBot");
  const pausedName = row.pausedOn ? bots.find((bot) => bot.id === row.pausedOn)?.name : undefined;
  const carriers = row.carriers.filter((id) => bots.some((bot) => bot.id === id));
  const parts = [
    !row.on && note ? note : "",
    !row.on && row.pausedOn !== undefined
      ? (pausedName ? t("settings.receive.paused", { name: pausedName }) : t("settings.receive.pausedNoBot"))
      : "",
    !botPage && row.on && carriers.length <= 1 ? t("settings.receive.carriedBy", { name: nameOf(row.botId) }) : "",
    !row.on && row.never ? t("settings.receive.never") : "",
    row.lastAlertAt ? t("settings.receive.lastAlert", { when: relativeTime(row.lastAlertAt) }) : t("settings.receive.noAlertYet"),
  ].filter(Boolean);
  return (
    <>
      <DescribedRow label={row.label} description={parts.join(" · ")} rowId={`receive.domain.${row.domain}`}>
        {!botPage && row.on && carriers.length > 1 && (
          <PillSelect
            value={row.botId}
            ariaLabel={t("settings.receive.carrier", { domain: row.label })}
            onChange={(next) => onDomain(true, next)}
            options={carriers.map((id) => ({ value: id, label: nameOf(id) }))}
          />
        )}
        <Switch checked={row.on} aria-label={row.label} onClick={() => onDomain(!row.on)} />
      </DescribedRow>
      {row.on && row.watches.map((watch) => {
        const when = cadenceText(watch.cadence);
        const last = watch.lastAlertAt ? t("settings.receive.lastAlert", { when: relativeTime(watch.lastAlertAt) }) : "";
        return (
          <DescribedRow key={watch.id} label={watch.summary} description={[when, last].filter(Boolean).join(" · ") || undefined} rowId={`receive.watch.${watch.id}`}>
            <Switch checked={watch.on} aria-label={watch.summary} onClick={() => onWatch(watch.id, !watch.on)} />
          </DescribedRow>
        );
      })}
    </>
  );
}

function BotSwitchRows({ bots, rows, field, onChange }: {
  bots: readonly Bot[];
  rows: readonly ReceiveBot[];
  field: "brief" | "screen" | "checklist";
  onChange: (botId: string, on: boolean) => void;
}) {
  return (
    <>
      {rows.flatMap((row) => {
        const bot = bots.find((entry) => entry.id === row.id);
        const on = row[field];
        if (!bot || on === undefined) return [];
        return [(
          <DescribedRow key={row.id} label={bot.name} rowId={`receive.${field}.${row.id}`}>
            <Switch checked={on} aria-label={t(`settings.receive.${field}.switch`, { name: bot.name })} onClick={() => onChange(row.id, !on)} />
          </DescribedRow>
        )];
      })}
    </>
  );
}

function Heading({ part }: { part: string }) {
  return <span className="min-w-0 truncate text-[13px] leading-[18px] text-ink-secondary">· {part}</span>;
}

export function ProactiveReceiveSettings() {
  const { state: store } = useStore();
  const dispatch = useStoreDispatch();
  const { state, setDomain, setWatch, setBot } = useProactiveReceive();
  // #3480: quiet mode for all the person's bots, drawn when they have a bot
  const quiet = useQuietMode();
  const quietShown = Boolean(quiet && quiet.bots.length > 0);
  if (!state && !quietShown) return null;
  const bots = store.bots ?? [];
  const mine = state ? state.receive.bots.filter((row) => bots.some((bot) => bot.id === row.id)) : [];
  const rows = state ? domainRows(state) : [];
  const title = t("settings.receive.title");
  const has = (field: "brief" | "screen" | "checklist") => mine.some((row) => row[field] !== undefined);
  return (
    <div data-settings-card="notifications.receive" className="flex flex-col gap-3">
      {quietShown && quiet && (
        <SettingsGroup title={title} groupId="receiveQuietMode" accessory={<Heading part={t("quietMode.label")} />}>
          <QuietModeAllRow all={quiet.all} />
        </SettingsGroup>
      )}
      {rows.length > 0 && (
        <SettingsGroup title={title} groupId="receiveDomains" accessory={<Heading part={t("settings.receive.group.domains")} />}>
          {rows.map((row) => (
            <DomainRows key={row.domain} row={row} bots={bots}
              onDomain={(on, botId) => setDomain(row, on, botId)}
              onWatch={(watchId, on) => setWatch(row, watchId, on)} />
          ))}
        </SettingsGroup>
      )}
      {has("brief") && (
        <SettingsGroup title={title} groupId="receiveBrief" accessory={<Heading part={t("settings.receive.group.brief")} />}>
          <BotSwitchRows bots={bots} rows={mine} field="brief" onChange={(botId, on) => setBot(botId, { brief: on })} />
        </SettingsGroup>
      )}
      {has("screen") && (
        <SettingsGroup title={title} groupId="receiveScreen" accessory={<Heading part={t("settings.receive.group.screen")} />}>
          <BotSwitchRows bots={bots} rows={mine} field="screen" onChange={(botId, on) => setBot(botId, { screen: on })} />
        </SettingsGroup>
      )}
      {has("checklist") && (
        <SettingsGroup title={title} groupId="receiveChecklists" accessory={<Heading part={t("settings.receive.group.checklists")} />}>
          <BotSwitchRows bots={bots} rows={mine} field="checklist" onChange={(botId, on) => setBot(botId, { checklist: on })} />
        </SettingsGroup>
      )}
      {mine.length > 0 && (
        <SettingsGroup title={title} groupId="receiveAddressed" accessory={<Heading part={t("settings.receive.group.addressed")} />}>
          {mine.map((row) => {
            const bot = bots.find((entry) => entry.id === row.id)!;
            const on = proactiveModeFor(bot) === "proactive";
            const patch = (value: Pick<BotUpdatePatch, "proactiveMode" | "directTriggers">) => dispatch({ type: "updateBot", botId: bot.id, patch: value });
            return (
              <div key={bot.id} data-receive-bot="">
                <DescribedRow label={bot.name} description={t("settings.receive.addressed.hint")} rowId={`receive.addressed.${bot.id}`}>
                  <Switch checked={on} aria-label={t("settings.receive.addressed.switch", { name: bot.name })} disabled={Boolean(bot.busy)}
                    onClick={() => patch({ proactiveMode: on ? "off" : "proactive" })} />
                </DescribedRow>
                {on && <DirectTriggersRows bot={bot} proactiveOn={on} patch={(value) => patch(value)} />}
              </div>
            );
          })}
        </SettingsGroup>
      )}
    </div>
  );
}
