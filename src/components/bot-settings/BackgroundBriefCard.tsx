// The background brief queue. No connected app: the queue stays empty and
// the screen says so. A pass only reads. A server without the route yet (an
// older one) says it comes with the server update, never an error.
// 2026-10-29: the brief runs on its own each day at the time the person
// picks (on by default for a Primary Bot), and arrives in the conversation
// and through "Me joindre". The person turns it off or moves its time here.
// #2699: screen context, off by default, on the desktop app only (hidden
// elsewhere): the bot sees the app and window in front, to propose at the
// right time.
import { useCallback, useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { localTimeZone } from "@/lib/reach-me";
import { routeMissingOnServer } from "@/lib/server-route";
import { Monitor, Sunrise } from "lucide-react";
import { cn } from "@/lib/cn";
import { PILL, PLAIN_FIELD, Switch, useSettingsSurface } from "../SettingsPrimitives";
import { useBotEditor } from "./BotEditorContext";
import { PaneSection } from "./PaneSection";
import { readableError } from "@/lib/plain-error";

interface BriefView {
  apps?: number;
  notice?: "no_apps";
  settings?: { enabled?: boolean; at?: string; timeZone?: string; screenContext?: boolean };
  screenContextAvailable?: boolean;
  suggestions?: Array<{ id: string; text: string; status: string }>;
  error?: string;
}

/** The settings a change sends: the time zone is this device's. */
export function briefSchedulePatch(change: { enabled?: boolean; at?: string; screenContext?: boolean }): { enabled?: boolean; at?: string; screenContext?: boolean; timeZone: string } {
  return { ...change, timeZone: localTimeZone() };
}

export function briefQueueText(view: BriefView | null): string | null {
  if (!view) return null;
  if (view.notice === "no_apps" || view.apps === 0) return t("brief.noApps");
  return null;
}

export function BackgroundBriefCard({ botId }: { botId: string }) {
  const { request: api } = useBotEditor();
  const [view, setView] = useState<BriefView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsUpdate, setNeedsUpdate] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api(`/api/bots/${botId}/background-brief`) as BriefView;
      setView(next);
      setError(null);
      setNeedsUpdate(false);
    } catch (err) {
      if (routeMissingOnServer(err)) { setNeedsUpdate(true); return; }
      setError(readableError(err));
    }
  }, [api, botId]);

  useEffect(() => { void load(); }, [load]);

  const read = async () => {
    setError(null);
    try {
      await api(`/api/bots/${botId}/background-brief/pass`, { method: "POST", body: JSON.stringify({ costUsd: 0 }) });
      await load();
    } catch (err) {
      setError(readableError(err));
    }
  };

  const saveSchedule = async (change: { enabled?: boolean; at?: string; screenContext?: boolean }) => {
    setError(null);
    try {
      await api(`/api/bots/${botId}/background-brief`, { method: "PUT", body: JSON.stringify(briefSchedulePatch(change)) });
      await load();
    } catch (err) {
      setError(readableError(err));
    }
  };

  const note = briefQueueText(view);
  const enabled = view?.settings?.enabled === true;
  const at = view?.settings?.at ?? "08:00";
  const pending = (view?.suggestions ?? []).filter((item) => item.status === "pending");
  const plain = useSettingsSurface() === "plain";
  if (needsUpdate) {
    return (
      <PaneSection title={t("brief.title")}>
        <p data-brief-needs-update="" className="text-[12.5px] text-ink-secondary">{t("serverRoute.needsUpdate")}</p>
      </PaneSection>
    );
  }
  const time = (
    <input
      type="time"
      aria-label={t("brief.at")}
      value={at}
      disabled={!enabled}
      onChange={(event) => { if (event.target.value) void saveSchedule({ at: event.target.value }); }}
      className={plain ? cn(PLAIN_FIELD, "w-auto") : "rounded-lg border border-hairline/40 bg-inset px-2 py-1 text-[12.5px] text-ink disabled:opacity-50"}
    />
  );
  const toggle = <Switch checked={enabled} aria-label={t("brief.daily")} onClick={() => void saveSchedule({ enabled: !enabled })} />;
  // #2699: shown only where it works (the desktop app on macOS or Windows).
  const screenOn = view?.settings?.screenContext === true;
  const screenToggle = view?.screenContextAvailable === true
    ? <Switch checked={screenOn} aria-label={t("brief.screen")} data-brief-screen="" onClick={() => void saveSchedule({ screenContext: !screenOn })} />
    : null;
  // The bot's profile page (#2313): the daily brief is one row (icon,
  // title, the delivery note as its subtitle, the time and the switch at
  // the right), the queue is text, and Read is a pill.
  if (plain) {
    return (
      <PaneSection title={t("brief.title")}>
        <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-1 basis-[200px] items-center gap-3">
            <Sunrise aria-hidden="true" className="size-5 shrink-0 text-ink-secondary" />
            <div className="min-w-0">
              <div className="text-[14px] leading-5 text-ink">{t("brief.daily")}</div>
              {enabled && <div className="text-[12px] leading-4 text-ink-secondary">{t("brief.delivery")}</div>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">{time}{toggle}</div>
        </div>
        {screenToggle && (
          <div className="mt-2 flex min-h-[44px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-1 basis-[200px] items-center gap-3">
              <Monitor aria-hidden="true" className="size-5 shrink-0 text-ink-secondary" />
              <div className="min-w-0">
                <div className="text-[14px] leading-5 text-ink">{t("brief.screen")}</div>
                <div className="text-[12px] leading-4 text-ink-secondary">{t("brief.screenHint")}</div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">{screenToggle}</div>
          </div>
        )}
        <div className="mt-2 flex flex-col gap-1 text-[12px] leading-4 text-ink-secondary">
          {note && <p role="status" data-brief-empty="">{note}</p>}
          {!note && pending.length === 0 && <p>{t("brief.queueEmpty")}</p>}
          {pending.length > 0 && (
            <ul className="flex flex-col gap-1 text-[13px] leading-[18px] text-ink">
              {pending.map((item) => <li key={item.id}>{item.text}</li>)}
            </ul>
          )}
          {error && <p role="alert" className="text-danger">{error}</p>}
        </div>
        <div className="mt-3 flex">
          <button type="button" onClick={() => void read()} className={PILL}>{t("brief.read")}</button>
        </div>
      </PaneSection>
    );
  }
  return (
    <PaneSection title={t("brief.title")}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink">
        {toggle}
        <span>{t("brief.daily")}</span>
        {time}
      </div>
      {enabled && <p className="mb-2 text-[12px] text-ink-secondary">{t("brief.delivery")}</p>}
      {screenToggle && (
        <div className="mb-2 flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[12.5px] text-ink">{screenToggle}<span>{t("brief.screen")}</span></div>
          <p className="text-[12px] text-ink-secondary">{t("brief.screenHint")}</p>
        </div>
      )}
      {note && <p role="status" data-brief-empty="">{note}</p>}
      {!note && pending.length === 0 && <p className="text-[12.5px] text-ink-secondary">{t("brief.queueEmpty")}</p>}
      {pending.length > 0 && (
        <ul className="flex flex-col gap-1 text-[12.5px] text-ink">
          {pending.map((item) => <li key={item.id}>{item.text}</li>)}
        </ul>
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      <button type="button" onClick={() => void read()} className="mt-2 text-[12.5px] text-ink-secondary underline">{t("brief.read")}</button>
    </PaneSection>
  );
}
