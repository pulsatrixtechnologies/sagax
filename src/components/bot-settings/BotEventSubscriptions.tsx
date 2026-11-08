// Settings > Developer > Per bot > Event subscriptions (#2700): push this
// bot's routine results to a URL or to one of your routines instead of
// polling for them. Each row: where it goes, which events, the last delivery,
// a Test send and Remove. A new subscription shows its signing secret once.
// The server side: server/bot-events/bot-event-subscriptions.ts.
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { readableError } from "@/lib/plain-error";
import { api, useStore, type Bot } from "@/state/store";

import {
  BOT_EVENT_TYPES,
  validBotEventUrl,
  type BotEventDelivery,
  type BotEventSubscription,
  type BotEventType,
} from "../../../shared/bot-event-subscriptions";
import {
  CommandLine,
  ConfirmPill,
  EditorBox,
  EditorField,
  FIELD,
  PILL,
  PillSelect,
  PRIMARY_PILL,
  Switch,
} from "../SettingsPrimitives";
import { PaneEmpty, PaneSection, usePaneRows } from "./PaneSection";

const EVENT_LABEL: Record<BotEventType, LocaleKey> = {
  "run.reported": "botEvents.event.reported",
  "run.quiet": "botEvents.event.quiet",
  "run.failed": "botEvents.event.failed",
};

type TargetKind = "url" | "routine";

export function BotEventSubscriptions({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const rows = usePaneRows();
  const [subs, setSubs] = useState<BotEventSubscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const base = `/api/bots/${encodeURIComponent(bot.id)}/event-subscriptions`;
  const routines = state.routines ?? [];

  useEffect(() => {
    let live = true;
    void api<{ subscriptions: BotEventSubscription[] }>(base)
      .then((body) => { if (live) setSubs(body.subscriptions); })
      .catch((e) => { if (live) { setSubs([]); setError(readableError(e)); } });
    return () => { live = false; };
  }, [base]);

  const replace = (next: BotEventSubscription) => setSubs((list) => (list ?? []).map((sub) => (sub.id === next.id ? next : sub)));
  const test = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const body = await api<{ subscription?: BotEventSubscription }>(`${base}/${encodeURIComponent(id)}/test`, { method: "POST" });
      if (body.subscription) replace(body.subscription);
    } catch (e) { setError(readableError(e)); } finally { setBusy(null); }
  };
  const remove = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await api(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" });
      setSubs((list) => (list ?? []).filter((sub) => sub.id !== id));
    } catch (e) { setError(readableError(e)); } finally { setBusy(null); }
  };

  return (
    <PaneSection
      data-bot-event-subscriptions=""
      title={t("botEvents.title")}
      help={t("botEvents.help")}
      action={!adding && (
        <button type="button" data-bot-event-add="" onClick={() => { setAdding(true); setSecret(null); }} className={cn(PILL, "gap-1")}>
          <Plus size={13} aria-hidden="true" />
          {t("common.add")}
        </button>
      )}
    >
      <div className="flex flex-col gap-3">
        {secret && (
          <div data-bot-event-secret="" className="flex flex-col gap-1.5">
            <p className="text-[12.5px] text-ink">{t("botEvents.secretOnce")}</p>
            <CommandLine command={secret} copyLabel={t("botEvents.copySecret")} />
            <div className="flex justify-end">
              <button type="button" className={PILL} onClick={() => setSecret(null)}>{t("botEvents.secretDone")}</button>
            </div>
          </div>
        )}
        {adding && (
          <AddSubscription
            base={base}
            routines={routines.map((routine) => ({ value: routine.id, label: routine.name }))}
            onCancel={() => setAdding(false)}
            onCreated={(sub, newSecret) => {
              setSubs((list) => [...(list ?? []), sub]);
              setAdding(false);
              if (sub.target.kind === "url") setSecret(newSecret);
            }}
          />
        )}
        {subs === null ? null : subs.length === 0 && !adding ? (
          <PaneEmpty>{t("botEvents.empty")}</PaneEmpty>
        ) : (
          <ul className={cn(rows.bleed, "-my-1", rows.list)}>
            {subs.map((sub) => (
              <li key={sub.id} data-bot-event-subscription="" className={cn("flex flex-wrap items-center gap-2 py-2", rows.plain && "min-h-[44px]", rows.row)}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("truncate text-ink", rows.title)} title={sub.target.kind === "url" ? sub.target.url : undefined}>
                    {sub.target.kind === "url" ? urlLabel(sub.target.url) : t("botEvents.toRoutine", { name: sub.targetName ?? t("botEvents.routineGone") })}
                  </span>
                  <span className={cn("truncate text-ink-secondary", rows.note)}>
                    {sub.events.map((event) => t(EVENT_LABEL[event])).join(", ")}
                  </span>
                </span>
                <DeliveryStatus delivery={sub.lastDelivery} note={rows.note} />
                <button type="button" data-bot-event-test="" disabled={busy === sub.id} onClick={() => void test(sub.id)} className={cn(PILL, "shrink-0")}>
                  {t("botEvents.test")}
                </button>
                <ConfirmPill label={t("botEvents.remove")} confirmLabel={t("botEvents.removeConfirm")} disabled={busy === sub.id} onConfirm={() => void remove(sub.id)} />
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
      </div>
    </PaneSection>
  );
}

function DeliveryStatus({ delivery, note }: { delivery?: BotEventDelivery; note: string }) {
  if (!delivery) return <span className={cn("shrink-0 text-ink-secondary", note)}>{t("botEvents.neverSent")}</span>;
  const ok = delivery.ok;
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", note, ok ? "text-success" : "text-danger")}>
      <span className={cn("size-1.5 rounded-full", ok ? "bg-success" : "bg-danger")} aria-hidden="true" />
      {ok ? t("botEvents.delivered") : delivery.status ? t("botEvents.failedStatus", { status: String(delivery.status) }) : t("botEvents.failed")}
    </span>
  );
}

function AddSubscription({ base, routines, onCancel, onCreated }: {
  base: string;
  routines: Array<{ value: string; label: string }>;
  onCancel: () => void;
  onCreated: (sub: BotEventSubscription, secret: string) => void;
}) {
  const [events, setEvents] = useState<Set<BotEventType>>(new Set(["run.reported", "run.failed"]));
  const [kind, setKind] = useState<TargetKind>("url");
  const [url, setUrl] = useState("");
  const [routineId, setRoutineId] = useState(routines[0]?.value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = events.size > 0 && (kind === "url" ? validBotEventUrl(url) !== null : Boolean(routineId));
  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const body = await api<{ subscription: BotEventSubscription; secret: string }>(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: [...events], target: kind === "url" ? { kind, url: url.trim() } : { kind, routineId } }),
      });
      onCreated(body.subscription, body.secret);
    } catch (e) { setError(readableError(e)); } finally { setSaving(false); }
  };
  return (
    <EditorBox
      data-bot-event-form=""
      label={t("botEvents.formLabel")}
      onSubmit={() => void submit()}
      actions={(
        <>
          {error && <span role="alert" className="mr-auto text-[12.5px] text-danger">{error}</span>}
          <button type="button" className={PILL} onClick={onCancel}>{t("common.cancel")}</button>
          <button type="submit" className={PRIMARY_PILL} disabled={!ready || saving}>{t("botEvents.subscribe")}</button>
        </>
      )}
    >
      {BOT_EVENT_TYPES.map((event) => (
        <EditorField key={event} label={t(EVENT_LABEL[event])} menu>
          <Switch
            checked={events.has(event)}
            aria-label={t(EVENT_LABEL[event])}
            onClick={() => setEvents((current) => {
              const next = new Set(current);
              if (next.has(event)) next.delete(event); else next.add(event);
              return next;
            })}
          />
        </EditorField>
      ))}
      {routines.length > 0 && (
        <EditorField label={t("botEvents.sendTo")} menu>
          <PillSelect<TargetKind>
            value={kind}
            options={[{ value: "url", label: t("botEvents.kindUrl") }, { value: "routine", label: t("botEvents.kindRoutine") }]}
            onChange={setKind}
            ariaLabel={t("botEvents.sendTo")}
          />
        </EditorField>
      )}
      {kind === "url" ? (
        <EditorField label={t("botEvents.url")} hint={t("botEvents.urlHint")}>
          <input data-bot-event-url="" className={FIELD} type="url" inputMode="url" placeholder="https://" value={url} onChange={(event) => setUrl(event.target.value)} />
        </EditorField>
      ) : (
        <EditorField label={t("botEvents.routine")} hint={t("botEvents.routineHint")} menu>
          <PillSelect value={routineId} options={routines} onChange={setRoutineId} ariaLabel={t("botEvents.routine")} />
        </EditorField>
      )}
    </EditorBox>
  );
}

function urlLabel(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return raw;
  }
}
