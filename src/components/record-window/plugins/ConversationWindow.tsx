// A Twilio conversation in the record window (M-20261127-146): a message
// opens the conversation it belongs to, in bubbles by day with each one's
// delivery state; beside it, the chosen message the Twilio way (SID, the
// life of its status, from and to, service, segments, price, and an error
// with its cause and what to do, such as 30007). "+ Message" writes an SMS
// (its segments counted as Twilio counts them). Tabs: Conversation, Log (a
// grid), Calls (transcript, listen), Number, and Media only when there is
// some (M-20261127-143).
//
// The console's sections: `view` (stats), `conversation` and `log`
// (messages), `calls` (a recording through `recording`), `number` (a view),
// `media` (files). A console that serves no `conversation` shows the card's
// facts (the one message the card is).
import { useEffect, useId, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, CheckCheck, Download, Pause, Play, Plus, TriangleAlert } from "lucide-react";
import { RECORD_ACTION, RECORD_PRIMARY, RecordAddButton, RecordPod } from "@/components/record-window/RecordBlocks";
import { RecordGrid, type RecordColumn } from "@/components/record-window/RecordGrid";
import { RecordSplit } from "@/components/record-window/RecordSplit";
import { cn } from "@/lib/cn";
import { downloadBlob } from "@/lib/diagram-view";
import { tableCsv } from "@/lib/table-data";
import { t } from "@/lib/i18n";
import { parseCall, parseConversationView, parseLines, parseMessage, parseNumberView, smsSegments, type CallRow, type SmsMessage } from "@/lib/record-plugin-views";
import { RECORD_MESSAGE_MAX } from "../../../../shared/record-actions";
import { AskButton, FactList, PluginFiles, SectionStatus, StatePill, Steps, TONE_TEXT, tabCount, type PluginContext } from "./PluginParts";
import type { PluginWindowSpec } from "./PluginWindow";

/** Twilio's word for a message's state, as its glyph. */
function StateGlyph({ message }: { message: SmsMessage }) {
  if (message.direction === "in") return null;
  const state = message.state ?? "";
  const Icon = state === "delivered" || state === "read" ? CheckCheck : state === "undelivered" || state === "failed" ? TriangleAlert : Check;
  return <Icon size={13} aria-hidden="true" className="shrink-0" />;
}

function Direction({ direction }: { direction: "in" | "out" }) {
  const Icon = direction === "in" ? ArrowDownLeft : ArrowUpRight;
  const label = t(direction === "in" ? "recordWindow.conversation.inbound" : "recordWindow.conversation.outbound");
  return <span role="img" aria-label={label} title={label} className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-popover-hover", direction === "in" ? "text-popover-accent" : "text-warning")}><Icon size={14} aria-hidden="true" /></span>;
}

/** The record's own message among the conversation's (a record id may carry its account's: `AC..:SM..`). */
function isRecord(message: SmsMessage, recordId: string): boolean {
  return message.id === recordId || recordId.endsWith(`:${message.id}`);
}

function Compose({ ctx, onDone }: { ctx: PluginContext; onDone: () => void }) {
  const field = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const count = smsSegments(text);
  const send = () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    ctx.detail.write({ action: "message.send", set: { text } }).then(() => { setText(""); onDone(); }, (failure: unknown) => setError(failure instanceof Error && failure.name === "RecordActionRefused" ? failure.message : t("recordWindow.saveFailed"))).finally(() => setBusy(false));
  };
  return (
    <form className="flex min-w-0 flex-col gap-2 rounded-xl bg-popover-field p-3" data-record-sms-compose="" onSubmit={(event) => { event.preventDefault(); send(); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onDone(); } }}>
      <label className="sr-only" htmlFor={field}>{t("recordWindow.conversation.write")}</label>
      <textarea id={field} autoFocus rows={3} maxLength={RECORD_MESSAGE_MAX} value={text} dir="auto" placeholder={t("recordWindow.conversation.write")}
        className="min-h-16 min-w-0 resize-y rounded-lg bg-popover px-2.5 py-1.5 text-[14px] leading-5 text-popover-ink placeholder:text-popover-placeholder [field-sizing:content] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send(); } }} />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-[13px] leading-[18px] text-popover-ink-secondary" data-record-sms-count="">{t("recordWindow.conversation.count", { chars: count.chars, per: count.per, segments: count.segments, encoding: count.encoding })}</span>
        <span className="ms-auto flex items-center gap-2">
          {error && <span role="alert" className="text-[13px] leading-[18px] text-danger">{error}</span>}
          <button type="button" className={RECORD_ACTION} onClick={onDone} disabled={busy}>{t("recordWindow.cancel")}</button>
          <button type="submit" className={RECORD_PRIMARY} disabled={busy || !text.trim()}>{t("recordWindow.notes.send")}</button>
        </span>
      </div>
    </form>
  );
}

function Chosen({ ctx, message }: { ctx: PluginContext; message: SmsMessage }) {
  const facts = [
    { label: "SID", value: message.id, code: true },
    { label: t("recordWindow.conversation.from"), value: message.from },
    { label: t("recordWindow.conversation.to"), value: message.to },
    ...(message.service ? [{ label: t("recordWindow.conversation.service"), value: message.service }] : []),
    ...(message.segments ? [{ label: t("recordWindow.conversation.segments"), value: message.segments }] : []),
    ...(message.price ? [{ label: t("recordWindow.conversation.price"), value: message.price }] : []),
    ...(message.by ? [{ label: t("recordWindow.conversation.by"), value: message.by }] : []),
  ].filter((fact) => fact.value);
  return (
    <div className="flex min-w-0 flex-col gap-4 p-4" data-record-sms-chosen={message.id}>
      <RecordPod title={t(message.direction === "in" ? "recordWindow.conversation.received" : "recordWindow.conversation.sent")} actions={message.status ? <StatePill label={message.status} tone={message.tone} /> : undefined}>
        {message.error && (
          <div className="mb-3 flex min-w-0 flex-col gap-2 rounded-lg border-s-2 border-warning bg-warning/15 px-3 py-2.5" role="note" data-record-sms-error={message.error.code}>
            <p dir="auto"><span className="font-semibold">{[message.error.code, message.error.title].filter(Boolean).join(" · ")}.</span> {[message.error.cause, message.error.fix].filter(Boolean).join(" ")}</p>
            <span className="flex flex-wrap gap-2">
              <AskButton ask={ctx.ask} label={t("recordWindow.conversation.retry")} prompt={t("recordWindow.conversation.retryPrompt", { code: message.error.code, record: ctx.link })} />
              <AskButton ask={ctx.ask} label={t("recordWindow.conversation.byEmail")} prompt={t("recordWindow.conversation.byEmailPrompt", { record: ctx.link })} />
            </span>
          </div>
        )}
        <Steps steps={message.life} now={ctx.now} />
      </RecordPod>
      <RecordPod><FactList facts={facts} labelWidth="7rem" /></RecordPod>
    </div>
  );
}

function Conversation({ ctx, composing, setComposing }: { ctx: PluginContext; composing: boolean; setComposing: (on: boolean) => void }) {
  const { card, detail } = ctx;
  const state = detail.section("conversation");
  const stats = parseConversationView(detail.section("view").data)?.stats;
  const messages = parseLines(state.data, parseMessage);
  const [chosen, setChosen] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  // the latest message (and the SMS being written) in view, scrolling the conversation's own side only, never the page under the window
  useEffect(() => {
    const side = end.current?.closest<HTMLElement>("[data-record-side]");
    if (side) side.scrollTop = side.scrollHeight;
  }, [messages.length, composing]);
  if (!state.data) return <div className="p-4"><SectionStatus state={state} /></div>;
  const selected = messages.find((one) => one.id === chosen) ?? messages.find((one) => isRecord(one, card.id)) ?? messages.at(-1);
  let day = "";
  // the month's numbers and + Message across both sides, out of what scrolls (the mockup's row)
  const head = (stats || detail.can("message.send")) && (
    <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-popover-hairline px-4 py-2.5" data-record-sms-head="">
      {stats && (
        <p className="min-w-0 text-[13px] leading-[18px] text-popover-ink-secondary" data-record-sms-stats="">
          {stats.title && <span>{stats.title} </span>}
          {stats.parts.map((part, index) => (
            <span key={index}>{index > 0 && " · "}<span className={cn(part.strong && "font-medium text-popover-ink", part.tone && part.tone !== "open" && TONE_TEXT[part.tone])}>{part.text}</span></span>
          ))}
        </p>
      )}
      {detail.can("message.send") && <button type="button" className={cn(RECORD_ACTION, "ms-auto")} disabled={composing} onClick={() => setComposing(true)} data-record-sms-new=""><Plus size={14} aria-hidden="true" />{t("recordWindow.conversation.new")}</button>}
    </div>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {head}
      <RecordSplit
        type={ctx.type}
        fallback={740}
        least={380}
        rightLeast={340}
        left={
          <div className="flex min-w-0 flex-col gap-3 p-4">
            <RecordPod bodyClassName="gap-2" data-record-sms-thread="">
              {messages.map((message) => {
                const heading = message.day && message.day !== day ? message.day : "";
                if (message.day) day = message.day;
                const failed = message.state === "undelivered" || message.state === "failed";
                return (
                  <div key={message.id} className="contents">
                    {heading && <p className="py-1 text-center text-[13px] leading-[18px] text-popover-ink-secondary" data-record-sms-day="">{heading}</p>}
                    <button type="button" aria-pressed={selected?.id === message.id} onClick={() => setChosen(message.id)} data-record-sms={message.direction} data-record-sms-state={message.state ?? ""}
                      className={cn("flex max-w-[78%] flex-col gap-1 rounded-2xl px-3.5 py-2.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                        message.direction === "out" ? "self-end bg-popover-accent/20" : "self-start bg-popover-hover",
                        selected?.id === message.id && "ring-2 ring-popover-accent", failed && selected?.id !== message.id && "ring-1 ring-danger/60")}>
                      <span dir="auto" className="whitespace-pre-wrap break-words">{message.body}</span>
                      <span className="flex flex-wrap items-center gap-1 text-[12px] leading-4 text-popover-ink-secondary">
                        <span>{message.when}</span>
                        {message.direction === "out" && message.status && <span className={cn("inline-flex items-center gap-1", TONE_TEXT[message.tone])}>· <StateGlyph message={message} />{message.status}</span>}
                      </span>
                    </button>
                  </div>
                );
              })}
              <div ref={end} />
              <div className="flex justify-end pt-1"><AskButton ask={ctx.ask} label={t("recordWindow.plugin.suggestReply")} prompt={t("recordWindow.conversation.suggestPrompt", { record: ctx.link })} /></div>
            </RecordPod>
            {composing && <Compose ctx={ctx} onDone={() => setComposing(false)} />}
          </div>
        }
        right={selected ? <Chosen ctx={ctx} message={selected} /> : <p className="p-4 text-popover-ink-secondary">{t("recordWindow.conversation.none")}</p>}
      />
    </div>
  );
}

function Log({ ctx, onNew }: { ctx: PluginContext; onNew: () => void }) {
  const state = ctx.detail.section("log");
  if (!state.data) return <SectionStatus state={state} />;
  const rows = parseLines(state.data, parseMessage);
  const columns: RecordColumn<SmsMessage>[] = [
    { id: "when", label: t("recordCard.related.date"), kind: "date", width: 120, text: (row) => row.when },
    { id: "direction", label: t("recordWindow.conversation.direction"), width: 72, text: (row) => t(row.direction === "in" ? "recordWindow.conversation.inbound" : "recordWindow.conversation.outbound"), cell: (row) => <Direction direction={row.direction} /> },
    { id: "from", label: t("recordWindow.conversation.from"), width: 150, text: (row) => row.from },
    { id: "to", label: t("recordWindow.conversation.to"), width: 150, text: (row) => row.to },
    { id: "status", label: t("recordCard.related.status"), width: 140, text: (row) => row.status, cell: (row) => row.status ? <StatePill label={row.status} tone={row.tone} /> : null },
    { id: "segments", label: t("recordWindow.conversation.segments"), width: 100, kind: "number", text: (row) => row.segments ?? "" },
    { id: "price", label: t("recordWindow.conversation.price"), width: 100, kind: "number", text: (row) => row.price ?? "" },
    { id: "sid", label: "SID", width: 170, text: (row) => row.id, cell: (row) => <code className="rounded-md bg-popover-hover px-1.5 py-0.5 font-mono text-[12px] leading-5 [overflow-wrap:anywhere]">{row.id}</code> },
  ];
  // the rows the filter keeps, as the app's tables export them (formulas neutralized, the BOM for the spreadsheets)
  const exportRows = (visible: readonly SmsMessage[]) => {
    const csv = tableCsv(columns.map((column) => column.label || column.id), visible.map((row) => columns.map((column) => column.text(row))));
    downloadBlob(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }), "messages.csv");
  };
  return (
    <RecordPod>
      <RecordGrid type={ctx.type} grid="log" label={t("recordWindow.conversation.log")} columns={columns} rows={rows} rowKey={(row) => row.id}
        toolbar={(visible) => <>
          <button type="button" className={RECORD_ACTION} onClick={() => exportRows(visible)} data-record-export=""><Download size={14} aria-hidden="true" />{t("recordWindow.conversation.export")}</button>
          {ctx.detail.can("message.send") && <RecordAddButton label={t("recordWindow.conversation.new")} onAdd={onNew} />}
        </>} />
    </RecordPod>
  );
}

function Calls({ ctx }: { ctx: PluginContext }) {
  const state = ctx.detail.section("calls");
  const [playing, setPlaying] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // one recording at a time: the one playing, and the last ask (a recording read after another click, or after the tab closed, never plays)
  const audio = useRef<{ player: HTMLAudioElement; url: string } | null>(null);
  const asked = useRef(0);
  const stop = () => {
    const now = audio.current;
    audio.current = null;
    if (!now) return;
    now.player.pause();
    URL.revokeObjectURL(now.url);
  };
  useEffect(() => () => { asked.current += 1; stop(); }, []);
  if (!state.data) return <SectionStatus state={state} />;
  const rows = parseLines(state.data, parseCall);
  const listen = (call: CallRow) => {
    setFailed(false);
    const again = playing === call.id;
    const mine = ++asked.current;
    stop();
    setPlaying(null);
    if (again) return;
    ctx.detail.bytes("recording", call.id).then((blob) => {
      if (asked.current !== mine) return;
      const url = URL.createObjectURL(blob);
      const player = new Audio(url);
      audio.current = { player, url };
      player.onended = () => { if (audio.current?.player === player) { stop(); setPlaying(null); } };
      setPlaying(call.id);
      return player.play();
    }).catch(() => { if (asked.current === mine) { stop(); setPlaying(null); setFailed(true); } });
  };
  return (
    <RecordPod>
      {failed && <p role="status" className="text-[13px] leading-[18px] text-danger">{t("recordWindow.conversation.listenFailed")}</p>}
      <ul className="flex min-w-0 flex-col divide-y divide-popover-hairline" aria-label={t("recordWindow.conversation.calls")}>
        {rows.map((call) => (
          <li key={call.id} className="flex min-w-0 items-center gap-3 py-3" data-record-call={call.direction}>
            <Direction direction={call.direction} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">{[call.when, call.duration].filter(Boolean).join(" · ")} · <code className="rounded-md bg-popover-hover px-1.5 py-0.5 font-mono text-[12px] leading-5">{call.id}</code></span>
              {call.transcript && <span dir="auto" className="text-[13px] leading-[18px] text-popover-ink-secondary">{t("recordWindow.conversation.transcript", { text: call.transcript })}</span>}
            </span>
            {call.recording && (
              <button type="button" className={cn(RECORD_ACTION, "px-2.5")} onClick={() => listen(call)} aria-pressed={playing === call.id} data-record-listen="">
                {playing === call.id ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}{t(playing === call.id ? "recordWindow.conversation.pause" : "recordWindow.conversation.listen")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </RecordPod>
  );
}

function NumberTab({ ctx }: { ctx: PluginContext }) {
  const state = ctx.detail.section("number");
  const view = parseNumberView(state.data);
  if (!view) return <SectionStatus state={state} />;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 @min-[52rem]:grid-cols-2">
      <RecordPod title={view.number} data-record-number="">
        <FactList facts={view.facts} />
        {view.capabilities.length > 0 && (
          <div className="mt-2.5 grid min-w-0 gap-x-4 [grid-template-columns:minmax(0,8rem)_minmax(0,1fr)]">
            <span className="text-[13px] leading-7 text-popover-ink-secondary">{t("recordWindow.conversation.capabilities")}</span>
            <span className="flex flex-wrap gap-1.5">{view.capabilities.map((one) => <span key={one} className="inline-flex h-7 items-center rounded-full bg-popover-hover px-2.5 text-[13px] leading-[18px]">{one}</span>)}</span>
          </div>
        )}
      </RecordPod>
      {view.routing.length > 0 && <RecordPod title={view.routingTitle}><FactList facts={view.routing} labelWidth="8rem" /></RecordPod>}
    </div>
  );
}

function ConversationBody({ ctx, tab, setTab }: { ctx: PluginContext; tab: string; setTab: (tab: string) => void }) {
  const [composing, setComposing] = useState(false);
  if (tab === "conversation") return <Conversation ctx={ctx} composing={composing} setComposing={setComposing} />;
  return (
    <div className="flex min-w-0 flex-col gap-4 p-4" data-record-conversation-tab={tab}>
      {tab === "log" && <Log ctx={ctx} onNew={() => { setComposing(true); setTab("conversation"); }} />}
      {tab === "calls" && <Calls ctx={ctx} />}
      {tab === "number" && <NumberTab ctx={ctx} />}
      {tab === "media" && <PluginFiles detail={ctx.detail} section="media" add={false} />}
    </div>
  );
}

export const CONVERSATION_WINDOW: PluginWindowSpec = {
  first: "conversation",
  open: ["view", "conversation", "number"],
  core: "conversation",
  reads: { conversation: ["view", "conversation"], log: ["log"], calls: ["calls"], number: ["number"], media: ["media"] },
  tabs: (ctx) => {
    const { detail } = ctx;
    const count = (section: string) => {
      const state = detail.section(section);
      return tabCount(detail, section, state.data ? parseLines(state.data, (line) => line).length : undefined);
    };
    const number = detail.section("number");
    return [
      { id: "conversation", label: t("recordWindow.conversation.conversation"), count: detail.section("conversation").refused ? undefined : count("conversation"), canAdd: detail.can("message.send") },
      { id: "log", label: t("recordWindow.conversation.log"), count: count("log") },
      { id: "calls", label: t("recordWindow.conversation.calls"), count: count("calls") },
      { id: "number", label: t("recordWindow.conversation.number"), count: number.refused ? 0 : number.data && !parseNumberView(number.data) ? 0 : undefined },
      { id: "media", label: t("recordWindow.conversation.media"), count: tabCount(detail, "media") ?? 0 },
    ];
  },
  sides: (tab) => tab === "conversation",
  body: (ctx, tab, setTab) => <ConversationBody ctx={ctx} tab={tab} setTab={setTab} />,
};
