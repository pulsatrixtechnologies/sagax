// The pieces the windows of the other plugins share (M-20261127-141,
// M-20261127-146), over the frame's own blocks (RecordBlocks.tsx): a tone's
// dot and pill, tiles, a list of labelled facts, a timeline, a meter, a
// button that asks a bot in the chat, a button that writes, a record's notes
// and its files.
// Painted from the popover tokens; no colour of its own.
import { useState, type ReactNode } from "react";
import { Download, FileText, Sparkles } from "lucide-react";
import { RecordMarkdown } from "@/components/RecordMarkdown";
import { RECORD_ACTION, RECORD_PRIMARY, RecordAddButton, RecordAvatar, RecordEntryForm, RecordPod, RecordRowActions, RecordSectionStatus } from "@/components/record-window/RecordBlocks";
import { RecordList, type RecordColumn } from "@/components/record-window/RecordGrid";
import { RecordName } from "@/components/record-window/ticket/parts";
import { cn } from "@/lib/cn";
import { downloadBlob } from "@/lib/diagram-view";
import { activeLocale, t } from "@/lib/i18n";
import { formatRelative } from "@/lib/record-card-format";
import { attachmentOf } from "@/lib/record-detail";
import { parseFile, parseLines, parseNote, type PluginFile, type PluginNote, type ViewFact, type ViewStep, type ViewTile } from "@/lib/record-plugin-views";
import type { RecordCard as Card, RecordTone } from "../../../../shared/record-cards";
import { RECORD_NOTE_MAX, type RecordAction } from "../../../../shared/record-actions";
import type { PluginDetail } from "./usePluginDetail";

/** What a window of another plugin is given (PluginWindow.tsx). */
export interface PluginContext {
  card: Card;
  detail: PluginDetail;
  /** the window's type (its columns and split are kept for it) */
  type: string;
  now: number;
  /** the record as a link the bot reads */
  link: string;
  /** a request handed to a bot in the chat (absent: no such button) */
  ask?: (text: string) => void;
  /** the record put in the composer, for the person's own question */
  compose?: () => void;
  /** back to the record this one replaced */
  back?: () => void;
  /** on to the record left by back */
  forward?: () => void;
}

export const TONE_TEXT: Record<RecordTone, string> = { open: "text-popover-ink-secondary", waiting: "text-warning", done: "text-success", alert: "text-danger" };
export const TONE_FILL: Record<RecordTone, string> = { open: "bg-popover-ink-secondary", waiting: "bg-warning", done: "bg-success", alert: "bg-danger" };
const TONE_TINT: Record<RecordTone, string> = { open: "bg-popover-hover", waiting: "bg-warning/15", done: "bg-success/15", alert: "bg-danger/15" };

export function ToneDot({ tone, className }: { tone: RecordTone; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", TONE_FILL[tone], className)} data-tone={tone} />;
}

/** A state in a pill: its dot and its words in the popover ink over the tone's tint. */
export function StatePill({ label, tone, className }: { label: string; tone: RecordTone; className?: string }) {
  return (
    <span className={cn("inline-flex h-7 max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium leading-[18px] text-popover-ink", TONE_TINT[tone], className)} data-record-pill={tone}>
      <ToneDot tone={tone} className="size-1.5" />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

/** Tiles: a big value under its label, a quieter line under it, the tone on that line. */
export function Tiles({ tiles, columns = 4 }: { tiles: readonly ViewTile[]; columns?: 2 | 4 }) {
  if (!tiles.length) return null;
  return (
    <div className={cn("grid min-w-0 grid-cols-2 gap-3", columns === 4 && "@min-[44rem]:grid-cols-4")} data-record-tiles="">
      {tiles.map((tile) => (
        <div key={tile.label} className="flex min-w-0 flex-col gap-1 rounded-xl bg-popover-field px-4 py-3" data-record-tile="">
          <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{tile.label}</span>
          <span dir="auto" className="break-words text-[20px] font-semibold leading-7">{tile.value}</span>
          {tile.detail && <span dir="auto" className={cn("text-[13px] leading-[18px]", tile.tone && tile.tone !== "open" ? TONE_TEXT[tile.tone] : "text-popover-ink-secondary")}>{tile.detail}</span>}
        </div>
      ))}
    </div>
  );
}

/** Labelled values, the label at the left; a record opens in the window, code is code. */
export function FactList({ facts, labelWidth = "8rem" }: { facts: readonly ViewFact[]; labelWidth?: string }) {
  if (!facts.length) return null;
  return (
    <dl className="grid min-w-0 gap-x-4 gap-y-2.5" style={{ gridTemplateColumns: `minmax(0, ${labelWidth}) minmax(0, 1fr)` }} data-record-facts="">
      {facts.map((fact) => (
        <div key={`${fact.label}-${fact.value}`} className="contents">
          <dt className="text-[13px] leading-[22px] text-popover-ink-secondary">{fact.label}</dt>
          <dd className={cn("min-w-0 break-words", fact.tone && fact.tone !== "open" && TONE_TEXT[fact.tone])}>
            {fact.code ? <code className="rounded-md bg-popover-hover px-1.5 py-0.5 font-mono text-[13px] leading-5 [overflow-wrap:anywhere]">{fact.value}</code>
              : fact.ref ? <RecordName name={fact.value} recordRef={fact.ref} /> : <span dir="auto">{fact.value}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A timeline: a dot in its tone on a rail, the words, then when. */
export function Steps({ steps, now }: { steps: readonly ViewStep[]; now: number }) {
  if (!steps.length) return null;
  const lang = activeLocale();
  return (
    <ol className="flex min-w-0 flex-col" data-record-steps="">
      {steps.map((step, index) => (
        <li key={step.id ?? `${index}-${step.text}`} className="relative flex min-w-0 gap-3 pb-4 last:pb-0" data-record-step={step.tone ?? "open"}>
          {index < steps.length - 1 && <span aria-hidden="true" className="absolute start-[4px] top-4 bottom-0 w-px bg-popover-hairline" />}
          <ToneDot tone={step.tone ?? "open"} className={cn("mt-[7px] size-2.5", !step.tone && "bg-popover-hairline")} />
          <span className="flex min-w-0 flex-col">
            <span dir="auto" className="break-words">{step.text}</span>
            {(step.when || step.at || step.detail) && (
              <span className="text-[13px] leading-[18px] text-popover-ink-secondary">
                {[step.when ?? (step.at ? formatRelative(step.at, now, lang, undefined) : ""), step.detail].filter(Boolean).join(" · ")}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A share as a bar (a volume's use): the console's share, its words beside. */
export function Meter({ share, label, className }: { share?: number; label: string; className?: string }) {
  if (share === undefined) return null;
  return (
    <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share)} className={cn("block h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-popover-hover", className)}>
      <span className="block h-full rounded-full bg-popover-accent" style={{ width: `${share}%` }} />
    </span>
  );
}

/** A request handed to a bot in the chat (it answers there, as a card when it proposes). */
export function AskButton({ label, prompt, ask, primary = false }: { label: string; prompt: string; ask?: (text: string) => void; primary?: boolean }) {
  const [asked, setAsked] = useState(false);
  if (!ask) return null;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" className={primary ? RECORD_PRIMARY : RECORD_ACTION} title={t("recordWindow.plugin.askHint")} data-record-ask="" onClick={() => { ask(prompt); setAsked(true); }}>
        <Sparkles size={14} aria-hidden="true" />{label}
      </button>
      {asked && <span role="status" className="text-[12px] leading-4 text-popover-ink-secondary">{t("recordWindow.plugin.asked")}</span>}
    </span>
  );
}

/** One write of the window, offered only when the console takes it. */
export function WriteButton({ label, action, detail, primary = false, icon }: { label: string; action: RecordAction; detail: PluginDetail; primary?: boolean; icon?: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  if (!detail.can(action.action)) return null;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" disabled={busy} className={primary ? RECORD_PRIMARY : RECORD_ACTION} data-record-write={action.action}
        onClick={() => {
          setBusy(true);
          setError("");
          detail.write(action).then(() => setDone(true), (failure: unknown) => setError(failure instanceof Error && failure.name === "RecordActionRefused" ? failure.message : t("recordWindow.saveFailed"))).finally(() => setBusy(false));
        }}>
        {icon}{label}
      </button>
      {error && <span role="alert" className="text-[12px] leading-4 text-danger">{error}</span>}
      {done && !error && <span role="status" className="sr-only">{t("recordWindow.plugin.sent")}</span>}
    </span>
  );
}

/** A section's state while it has no data: the frame's one status block. */
export const SectionStatus = RecordSectionStatus;

/** A tab's count: the console's, else the lines read, else unknown (shown). Refused: none (hidden). */
export function tabCount(detail: PluginDetail, section: string, read?: number): number | undefined {
  const state = detail.section(section);
  if (state.refused) return 0;
  return detail.counts[section] ?? read;
}

/** The record's notes (a threat's): newest first, + to write one, each edited or removed at its right. */
export function PluginNotes({ detail, now }: { detail: PluginDetail; now: number }) {
  const state = detail.section("notes");
  const [writing, setWriting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const notes = parseLines(state.data, parseNote);
  const lang = activeLocale();
  const form = (note?: PluginNote) => (
    <RecordEntryForm data-record-note-form=""
      fields={[{ key: "text", label: t("recordWindow.notes.text"), kind: "textarea", required: true, max: RECORD_NOTE_MAX, value: note?.text ?? "", placeholder: t("recordWindow.plugin.notePlaceholder") }]}
      submitLabel={note ? t("recordWindow.save") : t("recordWindow.notes.send")}
      onCancel={() => { setWriting(false); setEditing(null); }}
      onSubmit={async (values) => {
        const text = String(values.text ?? "");
        await detail.write(note?.id ? { action: "note.update", id: note.id, set: { text } } : { action: "note.add", set: { text, kind: "discussion" } });
        setWriting(false);
        setEditing(null);
      }} />
  );
  return (
    <RecordPod title={t("recordWindow.tabs.notes")} count={detail.counts.notes ?? (state.data ? notes.length : undefined)}
      actions={detail.can("note.add") && !writing ? <RecordAddButton label={t("recordWindow.notes.new")} onAdd={() => setWriting(true)} /> : undefined} data-record-plugin-notes="">
      {writing && form()}
      {!state.data ? <SectionStatus state={state} /> : !notes.length ? <p className="py-2 text-popover-ink-secondary">{t("recordWindow.notes.none")}</p> : (
        <ul className="flex min-w-0 flex-col divide-y divide-popover-hairline">
          {notes.map((note, index) => (
            <li key={note.id ?? index} className="flex min-w-0 gap-3 py-3 first:pt-1" data-record-note="">
              {editing === note.id ? <div className="min-w-0 flex-1">{form(note)}</div> : (
                <>
                  <RecordAvatar name={note.author || "?"} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <span className="font-medium"><RecordName name={note.author} recordRef={note.authorRef} /></span>
                      <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{note.when ?? (note.at ? formatRelative(note.at, now, lang, undefined) : "")}</span>
                    </span>
                    <RecordMarkdown text={note.text} />
                  </div>
                  <RecordRowActions name={t("recordWindow.notes.noteOf", { name: note.author })}
                    onEdit={note.id && detail.can("note.update") ? () => setEditing(note.id!) : undefined}
                    onRemove={note.id && detail.can("note.remove") ? () => detail.write({ action: "note.remove", id: note.id! }) : undefined} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </RecordPod>
  );
}

/** The record's files (a page's attachments): one list under the one filter, + to attach one, each opened or removed. */
export function PluginFiles({ detail, section = "attachments", add = true }: { detail: PluginDetail; section?: string; /** the person can attach a file here */ add?: boolean }) {
  const state = detail.section(section);
  const [adding, setAdding] = useState(false);
  const [failed, setFailed] = useState(false);
  const files = parseLines(state.data, parseFile);
  const columns: RecordColumn<PluginFile>[] = [
    { id: "name", label: t("recordCard.related.name"), text: (row) => row.name },
    { id: "author", label: t("recordWindow.plugin.author"), text: (row) => row.author ?? "" },
    { id: "date", label: t("recordCard.related.date"), kind: "date", text: (row) => row.date ?? "" },
  ];
  const open = (file: PluginFile) => () => {
    setFailed(false);
    detail.bytes("download", file.id).then((blob) => downloadBlob(blob, file.name), () => setFailed(true));
  };
  const canAdd = add && detail.can("attachment.add");
  return (
    <div className="flex min-w-0 flex-col gap-3" data-record-plugin-files={section}>
      {failed && <p role="status" className="text-[13px] leading-[18px] text-danger">{t("recordCard.related.downloadFailed")}</p>}
      {adding && (
        <RecordEntryForm data-record-attachment-form=""
          fields={[{ key: "file", label: t("recordWindow.attachments.file"), kind: "file", required: true }]}
          submitLabel={t("recordWindow.attachments.add")} onCancel={() => setAdding(false)}
          onSubmit={async (values) => {
            if (!(values.file instanceof File)) return;
            await detail.write({ action: "attachment.add", set: await attachmentOf(values.file) });
            setAdding(false);
          }} />
      )}
      {!state.data ? <SectionStatus state={state} /> : (
        <RecordPod>
          <RecordList label={t("recordWindow.tabs.attachments")} columns={columns} rows={files} rowKey={(row) => row.id}
            toolbar={canAdd && !adding ? <RecordAddButton label={t("recordWindow.plugin.attach")} onAdd={() => setAdding(true)} /> : undefined}
            row={(row) => (
              <>
                <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-popover-hover text-popover-ink-secondary"><FileText size={16} /></span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <button type="button" className="min-w-0 break-all text-start font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={open(row)} data-record-attachment="">{row.name}</button>
                  <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{[row.size, row.date, row.author].filter(Boolean).join(" · ")}</span>
                </span>
                <button type="button" className={RECORD_ACTION} onClick={open(row)} aria-label={t("recordWindow.attachments.open", { name: row.name })}><Download size={14} aria-hidden="true" />{t("recordWindow.attachments.openShort")}</button>
                <RecordRowActions name={row.name} onRemove={detail.can("attachment.remove") ? () => detail.write({ action: "attachment.remove", id: row.id }) : undefined} />
              </>
            )} />
        </RecordPod>
      )}
    </div>
  );
}
