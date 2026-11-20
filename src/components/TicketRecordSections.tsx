import { useId, useLayoutEffect, useRef, useState } from "react";
import { PillTabCount, PillTabs } from "./PillTabs";
import { RecordMarkdown, type ReadRecordImage } from "./RecordMarkdown";
import { t } from "@/lib/i18n";

export interface ScheduleEntry {
  resource: string;
  start: string;
  end: string;
  where: string;
  done?: boolean;
}

export interface TicketNote {
  author: string;
  date: string;
  timestamp: string;
  kind: string;
  body: string;
}

function Avatar({ name }: { name: string }) {
  return <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-popover-field text-[13px] font-medium leading-none">{Array.from(name.trim())[0]?.toLocaleUpperCase() || "?"}</span>;
}

function scheduleRange({ start, end }: ScheduleEntry) {
  if (!start) return t("recordCard.related.unscheduled");
  if (!end) return start;
  const sameDay = /^\d{4}-\d{2}-\d{2} /.test(start) && end.slice(0, 11) === start.slice(0, 11);
  return `${start} - ${sameDay ? end.slice(11) : end}`;
}

export function TicketSchedule({ entries, error }: { entries?: ScheduleEntry[]; error?: string }) {
  return <section data-fit-row="schedule" className="min-w-0 shrink-0">
    <h3 className="flex items-center gap-2 text-[13px] font-normal leading-[18px] text-popover-ink-secondary">{t("recordCard.related.schedule")}{entries && <PillTabCount count={entries.length} />}</h3>
    {error || !entries?.length ? <p role="status" className="pt-2 text-popover-ink-secondary">{error || t(entries ? "recordCard.related.empty" : "recordCard.loading")}</p> :
      <ul className="divide-y divide-popover-hairline pt-1">{entries.map((entry, index) => {
        const name = entry.resource || t("recordCard.related.unassigned");
        return <li key={index} className="flex items-start gap-3 py-2.5">
          <Avatar name={name} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="break-words font-medium">{name}</span>
              {entry.done !== undefined && <span className="text-[13px] text-popover-ink-secondary">{t(entry.done ? "recordCard.related.done" : "recordCard.related.open")}</span>}</p>
            <p className="text-[13px] leading-[18px] text-popover-ink-secondary">{[scheduleRange(entry), entry.where].filter(Boolean).join(" · ")}</p>
          </div>
        </li>;
      })}</ul>}
  </section>;
}

const filters = ["discussion", "internal", "resolution", "all"] as const;
type Filter = typeof filters[number];

/** A note taller than this many lines (22px each, under the 2px its text has above it) may be folded. */
const NOTE_LONG_LINES = 8;
const NOTE_LINE_PX = 22;
const NOTE_TOP_PX = 2;

/** A note shows its whole text (#5053), drawn by the chat's Markdown renderer
 * with its images (M-20261119-084). A long one (more than eight lines) offers
 * "Less" to fold it to three lines, and "More" to open it again. */
function Note({ note, readImage }: { note: TicketNote; readImage?: ReadRecordImage }) {
  const body = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(true);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const node = body.current;
    if (!node || !expanded) return;
    const measure = () => setLong(node.scrollHeight > NOTE_TOP_PX + NOTE_LONG_LINES * NOTE_LINE_PX + 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [expanded, note.body]);
  const name = note.author || t("recordCard.related.unknownAuthor");
  return <li className="flex gap-3 py-3.5">
    <Avatar name={name} />
    <div className="min-w-0 flex-1">
      <p className="flex flex-wrap items-baseline gap-x-2.5"><span className="font-medium">{name}</span><span className="text-[13px] text-popover-ink-secondary">{note.date}</span></p>
      <div ref={body} data-record-note-body="" className={`pt-0.5 ${expanded ? "" : "line-clamp-3"}`}><RecordMarkdown text={note.body} readImage={readImage} /></div>
      {(!expanded || long) && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="pt-1 text-[13px] leading-[18px] text-popover-accent hover:underline">{t(expanded ? "recordCard.related.less" : "recordCard.related.more")}</button>}
    </div>
  </li>;
}

export function TicketNotes({ notes, readImage }: { notes: TicketNote[]; readImage?: ReadRecordImage }) {
  const id = useId();
  const groups: Record<Filter, TicketNote[]> = { discussion: [], internal: [], resolution: [], all: [] };
  const ordered = [...notes].sort((a, b) => {
    if (a.timestamp && b.timestamp) {
      const delta = Date.parse(b.timestamp) - Date.parse(a.timestamp);
      if (Number.isFinite(delta)) return delta;
    }
    return b.date.localeCompare(a.date);
  });
  for (const note of ordered) {
    groups.all.push(note);
    if (note.kind === "description" || note.kind === "issue") groups.discussion.push(note);
    else if (note.kind === "discussion" || note.kind === "resolution" || note.kind === "internal") groups[note.kind].push(note);
  }
  const [selected, setSelected] = useState<Filter>();
  const tab = selected ?? (groups.discussion.length ? "discussion" : "all");
  return <>
    <PillTabs tabs={filters} tab={tab} onTab={setSelected} ariaLabel={t("recordCard.related.notes")} idPrefix={id}
      label={key => t(`recordCard.related.${key}`)} after={key => <PillTabCount count={groups[key].length} />}
      className="-mx-2 gap-y-1 pb-1" />
    <div key={tab} role="tabpanel" id={`${id}-panel-${tab}`} aria-labelledby={`${id}-tab-${tab}`}>
      {groups[tab].length ? <ul className="divide-y divide-popover-hairline">{groups[tab].map((note, index) => <Note key={`${note.timestamp || note.date}-${index}`} note={note} readImage={readImage} />)}</ul> :
        <p className="py-2 text-popover-ink-secondary">{t("recordCard.related.empty")}</p>}
    </div>
  </>;
}
