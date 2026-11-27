// A ticket's Notes tab (M-20261127-101, M-20261127-137, M-20261127-136): the
// filters Discussion, Internal, Resolution and All with their counts, on the
// row of "+ New note" at the right. The writing zone opens only on that click
// (M-20261127-110): a discussion, an internal note or a resolution, a file
// attached and time added with it. No "Customer notified". Every note shows
// its whole text in the chat's Markdown with its images, newest first; a long
// one folds on "Less"; one the console lets the person change has edit and
// remove at its right.
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Clock, Paperclip, Plus } from "lucide-react";
import { PillTabCount, PillTabs } from "@/components/PillTabs";
import { RecordMarkdown } from "@/components/RecordMarkdown";
import { RECORD_ACTION, RECORD_PRIMARY, RecordAvatar, RecordEntryForm, RecordRowActions } from "@/components/record-window/RecordBlocks";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { attachmentOf, RecordActionRefused, type TicketNote } from "@/lib/record-detail";
import type { RecordDetail } from "@/components/useRecordDetail";
import { RECORD_NOTE_KINDS, RECORD_NOTE_MAX, RECORD_BILLING, type RecordNoteKind } from "../../../../shared/record-actions";
import { BillingTag, NoteKindTag, RecordName } from "./parts";

const FILTERS = ["discussion", "internal", "resolution", "all"] as const;
type Filter = (typeof FILTERS)[number];

/** The kind a note reads as: a description or an issue is the discussion's first note. */
export function noteKind(note: TicketNote): RecordNoteKind | null {
  if (note.kind === "description" || note.kind === "issue" || note.kind === "discussion") return "discussion";
  return note.kind === "internal" || note.kind === "resolution" ? note.kind : null;
}

/** Newest first, the instant when both have one. */
export function newestFirst(notes: readonly TicketNote[]): TicketNote[] {
  return [...notes].sort((a, b) => {
    if (a.timestamp && b.timestamp) {
      const delta = Date.parse(b.timestamp) - Date.parse(a.timestamp);
      if (Number.isFinite(delta)) return delta;
    }
    return b.date.localeCompare(a.date);
  });
}

const NOTE_LONG_LINES = 8;
const NOTE_LINE_PX = 22;

function Note({ note, detail }: { note: TicketNote; detail: RecordDetail }) {
  const body = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(true);
  const [long, setLong] = useState(false);
  const [editing, setEditing] = useState(false);
  useLayoutEffect(() => {
    const node = body.current;
    if (!node || !expanded) return;
    const measure = () => setLong(node.scrollHeight > 2 + NOTE_LONG_LINES * NOTE_LINE_PX + 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [expanded, note.body, editing]);
  const name = note.author || t("recordCard.related.unknownAuthor");
  const kind = noteKind(note);
  const id = note.id;
  if (editing && id) {
    return (
      <RecordEntryForm
        data-record-note-edit=""
        fields={[
          { key: "text", label: t("recordWindow.notes.text"), kind: "textarea", value: note.body, required: true, max: RECORD_NOTE_MAX },
          { key: "kind", label: t("recordWindow.notes.kind"), kind: "choice", value: kind ?? "discussion", required: true, choices: RECORD_NOTE_KINDS.map((value) => ({ value, label: t(`recordWindow.notes.${value}` as "recordWindow.notes.internal") })) },
        ]}
        submitLabel={t("recordWindow.save")}
        onCancel={() => setEditing(false)}
        onSubmit={async (values) => {
          await detail.write({ action: "note.update", id, set: { text: String(values.text ?? ""), kind: String(values.kind ?? "discussion") } });
          setEditing(false);
        }}
      />
    );
  }
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-xl bg-popover-field p-3.5" data-record-note="" data-note-kind={kind ?? undefined}>
      <div className="flex min-w-0 items-start gap-3">
        <RecordAvatar name={name} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium"><RecordName name={name} recordRef={note.authorRef} /></span>
            {kind && <NoteKindTag kind={kind} />}
          </span>
          <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{note.date}</span>
        </div>
        <RecordRowActions name={t("recordWindow.notes.noteOf", { name })}
          onEdit={id && detail.can("note.update") ? () => setEditing(true) : undefined}
          onRemove={id && detail.can("note.remove") ? () => detail.write({ action: "note.remove", id }) : undefined} />
      </div>
      <div ref={body} data-record-note-body="" className={expanded ? "" : "line-clamp-3"}><RecordMarkdown text={note.body} readImage={detail.readImage} /></div>
      {(!expanded || long) && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="self-start text-[13px] leading-[18px] text-popover-accent hover:underline">{t(expanded ? "recordCard.related.less" : "recordCard.related.more")}</button>}
    </li>
  );
}

/** The writing zone: the words, then its kind, a file, time with it, and Send at the right. */
function Composer({ initial, detail, onDone }: { initial: RecordNoteKind; detail: RecordDetail; onDone: () => void }) {
  const [kind, setKind] = useState<RecordNoteKind>(initial);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File>();
  const [withTime, setWithTime] = useState(false);
  const [hours, setHours] = useState("");
  const [billing, setBilling] = useState<(typeof RECORD_BILLING)[number]>("B");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const hoursValue = Number(hours.replace(",", "."));
  const ready = text.trim().length > 0 && (!withTime || (Number.isFinite(hoursValue) && hoursValue > 0 && hoursValue <= 24));
  const send = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await detail.write({ action: "note.add", set: { kind, text } });
      // the file and the time go with the note, each its own write
      if (file) await detail.write({ action: "attachment.add", set: await attachmentOf(file) });
      if (withTime) await detail.write({ action: "time.add", set: { hours: hoursValue, note: text.slice(0, 4000), billing } });
      onDone();
    } catch (failure) {
      setError(failure instanceof RecordActionRefused ? failure.message : t("recordWindow.saveFailed"));
    } finally {
      setBusy(false);
    }
  };
  const placeholder = t(kind === "internal" ? "recordWindow.notes.writeInternal" : kind === "resolution" ? "recordWindow.notes.writeResolution" : "recordWindow.notes.writeDiscussion");
  const pill = "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] leading-[18px] text-popover-ink hover:bg-popover-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
  return (
    <form className="flex min-w-0 flex-col gap-2 rounded-xl bg-popover-field p-3" data-record-composer="" onSubmit={(event) => { event.preventDefault(); void send(); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onDone(); } }}>
      <label htmlFor={`${id}-text`} className="sr-only">{placeholder}</label>
      <textarea id={`${id}-text`} autoFocus rows={3} maxLength={RECORD_NOTE_MAX} value={text} dir="auto" placeholder={placeholder}
        className="min-h-20 w-full resize-y bg-transparent text-[15px] leading-[22px] text-popover-ink placeholder:text-popover-placeholder focus-visible:outline-none [field-sizing:content]"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} />
      {withTime && (
        <div className="flex min-w-0 flex-wrap items-center gap-2" data-record-composer-time="">
          <label className="flex items-center gap-2 text-[13px] text-popover-ink-secondary">{t("recordWindow.time.hours")}
            <input type="number" inputMode="decimal" min={0.01} max={24} step={0.05} value={hours} onChange={(event) => setHours(event.target.value)}
              className="w-24 rounded-lg bg-popover px-2.5 py-1.5 text-[14px] text-popover-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" />
          </label>
          <BillingTag billing={billing} onChange={async (next) => setBilling(next)} />
        </div>
      )}
      {file && <span className="text-[13px] leading-[18px] text-popover-ink-secondary" data-record-composer-file="">{t("recordWindow.notes.attached", { name: file.name })}</span>}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <label className="sr-only" htmlFor={`${id}-kind`}>{t("recordWindow.notes.kind")}</label>
        <select id={`${id}-kind`} value={kind} onChange={(event) => setKind(event.target.value as RecordNoteKind)} className={cn(pill, "bg-popover-hover pe-2")} data-record-composer-kind="">
          {RECORD_NOTE_KINDS.map((value) => <option key={value} value={value}>{t(`recordWindow.notes.${value}` as "recordWindow.notes.internal")}</option>)}
        </select>
        {detail.can("attachment.add") && (
          <>
            <input ref={fileInput} type="file" className="hidden" onChange={(event) => setFile(event.target.files?.[0])} aria-hidden="true" tabIndex={-1} />
            <button type="button" className={pill} onClick={() => fileInput.current?.click()} data-record-composer-attach=""><Paperclip size={14} aria-hidden="true" />{t("recordWindow.notes.attach")}</button>
          </>
        )}
        {detail.can("time.add") && (
          <button type="button" className={cn(pill, withTime && "bg-popover-hover")} aria-pressed={withTime} onClick={() => setWithTime(!withTime)} data-record-composer-addtime=""><Clock size={14} aria-hidden="true" />{t("recordWindow.time.add")}</button>
        )}
        <span className="ms-auto flex items-center gap-2">
          {error && <span role="alert" className="text-[13px] leading-[18px] text-danger">{error}</span>}
          <button type="button" className={RECORD_ACTION} onClick={onDone} disabled={busy}>{t("recordWindow.cancel")}</button>
          <button type="submit" className={RECORD_PRIMARY} disabled={!ready || busy} data-record-composer-send="">{t("recordWindow.notes.send")}</button>
        </span>
      </div>
    </form>
  );
}

export function TicketNotesTab({ detail }: { detail: RecordDetail }) {
  const id = useId();
  const state = detail.section("notes");
  const [filter, setFilter] = useState<Filter>("all");
  const [composing, setComposing] = useState(false);
  const notes = newestFirst(state.page?.lines ?? []);
  const groups: Record<Filter, TicketNote[]> = { discussion: [], internal: [], resolution: [], all: notes };
  for (const note of notes) { const kind = noteKind(note); if (kind) groups[kind].push(note); }
  const canAdd = detail.can("note.add");
  return (
    <div className="flex min-w-0 flex-col gap-3 p-4" data-record-tab-panel="notes">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <PillTabs tabs={FILTERS} tab={filter} onTab={setFilter} ariaLabel={t("recordWindow.notes.filters")} idPrefix={id}
          label={(key) => t(`recordWindow.notes.${key}` as "recordWindow.notes.all")} after={(key) => <PillTabCount count={groups[key].length} />}
          className="gap-y-1" data-record-note-filters="" />
        {canAdd && !composing && (
          <button type="button" className={cn(RECORD_ACTION, "ms-auto")} onClick={() => setComposing(true)} data-record-note-new=""><Plus size={14} aria-hidden="true" />{t("recordWindow.notes.new")}</button>
        )}
      </div>
      {composing && <Composer initial={filter === "internal" || filter === "resolution" ? filter : "discussion"} detail={detail} onDone={() => setComposing(false)} />}
      <div role="tabpanel" id={`${id}-panel-${filter}`} aria-labelledby={`${id}-tab-${filter}`} aria-busy={state.loading}>
        {state.error ? <p role="status" className="py-2 text-popover-ink-secondary">{state.error}</p>
          : !state.page ? <p role="status" className="py-2 text-popover-ink-secondary">{t("recordCard.loading")}</p>
          : groups[filter].length ? <ul className="flex min-w-0 flex-col gap-2.5">{groups[filter].map((note, index) => <Note key={note.id ?? `${note.timestamp || note.date}-${index}`} note={note} detail={detail} />)}</ul>
          : <p className="py-2 text-popover-ink-secondary">{t("recordWindow.notes.none")}</p>}
      </div>
    </div>
  );
}
