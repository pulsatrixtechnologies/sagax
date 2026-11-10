// Changes: the bot's version history (2026-10-15). Every save of the
// profile (name, label, description, Personality, working folder, alerts)
// is a version, newest first, with when, who and what changed. Opening a
// version compares it with the current one, and "Restore" (with a
// confirmation) brings the bot back to it through
// POST /api/bots/:id/history/restore. A restore is itself a new version, so
// it can be restored away in turn.
//
// Layout (#2313, the bot profile's Activity tab): one "Changes" group, its
// card holding the versions by day ("Today", "Yesterday", then the date).
// A row per version: an icon for what changed, "Personality changed", who
// and when, the Restore pill and a chevron that unfolds the details (the
// change, a line diff against the current version). Consecutive versions of
// the same day with the same author and the same fields fold into one row
// ("Personality changed ×12") that unfolds them. Ten rows at first, then
// "Show N more".
//
// Server-built list (GET /api/bots/:id/history?full=1). Pure
// presentational: the hook owns the fetch, the reload after a restore, the
// confirmation and the loading/error split. A first-load failure never
// reaches this component; a failed reload with rows already on screen
// arrives as refreshError.
import { useId, useState } from "react";
import { BookOpen, ChevronDown, Cpu, Folder, History, Puzzle, Sparkles, Tag, type LucideIcon } from "lucide-react";

import { PILL, SettingsGroup } from "../SettingsPrimitives";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { formatMemoryBytes } from "@/lib/memory";
import { cachedDateFormat, niceTime } from "@/lib/schedule-label";
import { utf8Bytes } from "@/lib/soul";
import type { LocaleKey } from "@/locales";
import { botVersions, versionComparison, versionRestorePlan, type BotVersion } from "../../../shared/bot-versions";

const ACTOR: Record<string, LocaleKey> = {
  user: "botPanel.history.actor.user",
  bot: "botPanel.history.actor.bot",
  file: "botPanel.history.actor.file",
  import: "botPanel.history.actor.import",
  system: "botPanel.history.actor.system",
};
const FIELD: Record<string, LocaleKey> = {
  soul: "botSettings.nav.soul",
  rules: "botSettings.nav.rules",
  model: "botSettings.nav.model",
  skills: "botSettings.nav.skills",
  files: "botSettings.nav.files",
  name: "botPanel.history.field.name",
  title: "botPanel.history.field.title",
  description: "botPanel.history.field.description",
  cwd: "botPanel.history.field.cwd",
  notifications: "botPanel.history.field.notifications",
  speakReplies: "botPanel.history.field.speakReplies",
};
/** A version's line icon, by what it changed; anything else is History. */
const FIELD_ICON: Record<string, LucideIcon> = {
  soul: Sparkles,
  rules: BookOpen,
  model: Cpu,
  skills: Puzzle,
  files: Folder,
  cwd: Folder,
  name: Tag,
  title: Tag,
};

export interface HistoryRow {
  id: string;
  at: number;
  actor: string;
  via: string;
  field: string;
  summary: string;
  canRestore?: boolean;
  restoreUnavailableReason?: string;
  before?: string;
  after?: string;
}

/** Who changed it, in words ("You", "The bot"); an unknown actor as sent. */
export function historyWho(row: Pick<HistoryRow, "actor">): string {
  const key = ACTOR[row.actor];
  return key ? t(key) : row.actor;
}

/** A field's name in words ("Personality", "Name"); an unknown one as sent. */
export function historyField(field: string): string {
  const key = FIELD[field];
  return key ? t(key) : field;
}

/** "Personality: 0 B → 372 B", "Name: "Ara" → "Aria"", built from the row's
 * own before and after; the server's English summary when they are absent. */
export function historySummary(row: HistoryRow): string {
  const field = historyField(row.field);
  if (row.field === "soul" && typeof row.before === "string" && typeof row.after === "string") {
    return `${field}${t("botPanel.history.separator")}${formatMemoryBytes(utf8Bytes(row.before))} → ${formatMemoryBytes(utf8Bytes(row.after))}`;
  }
  if (typeof row.before === "string" && typeof row.after === "string") {
    return `${field}${t("botPanel.history.separator")}${JSON.stringify(row.before)} → ${JSON.stringify(row.after)}`;
  }
  return row.summary;
}

/** The fields a version changed, in words, joined. */
export function versionFields(version: BotVersion<HistoryRow>): string {
  return [...new Set(version.rows.map((row) => historyField(row.field)))].join(", ");
}

type DiffLine = { kind: "same" | "removed" | "added"; text: string };

/** A line diff (longest common subsequence) from `then` to `now`; long
 * texts fall back to the whole of each side. */
export function lineDiff(then: string, now: string): DiffLine[] {
  const a = then.split("\n");
  const b = now.split("\n");
  if (a.length * b.length > 250_000) {
    return [...a.map((text) => ({ kind: "removed" as const, text })), ...b.map((text) => ({ kind: "added" as const, text }))];
  }
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ kind: "same", text: a[i]! }); i++; j++; }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ kind: "removed", text: a[i++]! });
    else out.push({ kind: "added", text: b[j++]! });
  }
  while (i < a.length) out.push({ kind: "removed", text: a[i++]! });
  while (j < b.length) out.push({ kind: "added", text: b[j++]! });
  return out;
}

function shown(value: string, field: string): string {
  if (field === "notifications" || field === "speakReplies") {
    return value === "on" ? t("botPanel.history.on") : value === "off" ? t("botPanel.history.off") : value;
  }
  return value === "" ? t("botPanel.history.emptyValue") : value;
}

type Version = BotVersion<HistoryRow>;

/** One row of the list: a version, or consecutive look-alike versions
 * (same day, same author, same fields) folded together, newest first. */
interface Entry {
  id: string;
  day: string;
  current: boolean;
  versions: Version[];
}

/** Rows per page of the list, and per "Show more". */
const PAGE = 10;
const BADGE = "shrink-0 rounded-full bg-control px-2 text-[11px] leading-4 text-ink-secondary";
const ROW_BUTTON = "flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70";
const ICON = "size-5 shrink-0 text-ink-secondary";

function restoredVersion(version: Version): boolean {
  return version.via === "restore" || version.via === "rollback";
}

function fieldsKey(version: Version): string {
  return [...new Set(version.rows.map((row) => row.field))].sort().join(",");
}

function versionIcon(version: Version): LucideIcon {
  const icons = new Set(version.rows.map((row) => FIELD_ICON[row.field] ?? History));
  return icons.size === 1 ? [...icons][0]! : History;
}

/** The local calendar day of a time, as YYYY-MM-DD. */
function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const DAY: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
const DAY_WITH_YEAR: Intl.DateTimeFormatOptions = { ...DAY, year: "numeric" };

/** "Today", "Yesterday", else "Tue, Nov 4" (with the year when it is not
 * this one). */
function dayLabel(at: number, now: number): string {
  const today = new Date(now);
  if (dayKey(at) === dayKey(now)) return t("botPanel.history.today");
  if (dayKey(at) === dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime())) {
    return t("botPanel.history.yesterday");
  }
  const withYear = new Date(at).getFullYear() !== today.getFullYear();
  return cachedDateFormat(withYear ? DAY_WITH_YEAR : DAY).format(new Date(at));
}

/** The list's rows: the current version alone, then each run of look-alike
 * versions as one row. */
function historyEntries(versions: Version[]): Entry[] {
  const entries: Entry[] = [];
  versions.forEach((version, index) => {
    const last = entries[entries.length - 1];
    const head = last?.versions[0];
    const alike = last && head && !last.current
      && head.actor === version.actor
      && restoredVersion(head) === restoredVersion(version)
      && fieldsKey(head) === fieldsKey(version)
      && last.day === dayKey(version.at);
    if (alike) last.versions.push(version);
    else entries.push({ id: version.id, day: dayKey(version.at), current: index === 0, versions: [version] });
  });
  return entries;
}

function flip(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The chevron at a row's right end: a mouse shortcut for the row's own
 * button, which is what the keyboard and screen readers use. */
function RowChevron({ open, onClick, expandId }: { open: boolean; onClick: () => void; expandId?: string }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      data-history-expand={expandId}
      onClick={onClick}
      className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-hover hover:text-ink motion-reduce:transition-none"
    >
      <ChevronDown size={16} className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
    </button>
  );
}

function Comparison({ rows, version }: { rows: HistoryRow[]; version: Version }) {
  const changes = versionComparison(rows, version.id);
  if (changes.length === 0) {
    return <p className="text-[12px] leading-4 text-ink-secondary">{t("botPanel.history.sameAsCurrent")}</p>;
  }
  return (
    <div className="flex flex-col gap-2.5" data-history-compare={version.id}>
      <p className="text-[12px] leading-4 text-ink-secondary">{t("botPanel.history.compare")}</p>
      {changes.map(({ field, atVersion: then, now }) => (
        <div key={field} data-history-diff={field} className="flex flex-col gap-1">
          <div className="text-[12px] leading-4 text-ink">{historyField(field)}</div>
          {field === "soul" ? (
            <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap font-sans text-[12px] leading-relaxed">
              {lineDiff(then, now).map((line, index) => (
                <div
                  key={index}
                  data-diff={line.kind}
                  className={line.kind === "removed" ? "rounded-sm bg-danger/10 text-ink line-through decoration-danger/50" : line.kind === "added" ? "rounded-sm bg-success/10 text-ink" : "text-ink-secondary"}
                >
                  {line.kind === "removed" ? "- " : line.kind === "added" ? "+ " : "  "}{line.text || " "}
                </div>
              ))}
            </pre>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px] leading-4">
              <dt className="text-ink-secondary">{t("botPanel.history.then")}</dt>
              <dd className="min-w-0 break-words text-ink">{shown(then, field)}</dd>
              <dt className="text-ink-secondary">{t("botPanel.history.now")}</dt>
              <dd className="min-w-0 break-words text-ink">{shown(now, field)}</dd>
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}

export function HistorySection({
  bot,
  rows,
  refreshError,
  onRestore,
  restoring,
  defaultOpen,
}: {
  bot: { id: string };
  rows: HistoryRow[] | null;
  refreshError?: boolean;
  /** Asks to restore a version (the hook confirms first); `fields` names
   * what comes back, in words. */
  onRestore: (versionId: string, fields: string) => void;
  restoring?: boolean;
  /** The version shown open on first render (its folded row unfolded). */
  defaultOpen?: string;
}) {
  const baseId = useId();
  const [pages, setPages] = useState(1);
  // Folds and folded runs the person toggled, against what defaultOpen opens.
  const [toggledFolds, setToggledFolds] = useState<ReadonlySet<string>>(() => new Set());
  const [toggledRuns, setToggledRuns] = useState<ReadonlySet<string>>(() => new Set());

  const note = refreshError
    ? <p role="note" className="ml-auto min-w-0 truncate text-[12px] leading-4 text-ink-secondary">{t("botPanel.history.refresh")}</p>
    : null;

  if (!rows || rows.length === 0) {
    return (
      <SettingsGroup groupId="history" title={t("botSettings.nav.history")} accessory={note}>
        <div className="flex min-h-[44px] items-center gap-3 px-4 py-2" data-history-empty={rows ? "" : undefined}>
          <History aria-hidden="true" className={ICON} />
          <span className="text-[14px] leading-5 text-ink-secondary">{rows ? t("botPanel.history.emptyVersions") : t("botPanel.loading")}</span>
        </div>
      </SettingsGroup>
    );
  }

  const sorted = [...rows].sort((a, b) => b.at - a.at);
  const oldestFirst = [...sorted].reverse();
  const entries = historyEntries(botVersions(sorted));
  const defaultIndex = defaultOpen ? entries.findIndex((entry) => entry.versions.some((version) => version.id === defaultOpen)) : -1;
  const limit = Math.max(pages * PAGE, defaultIndex + 1);
  const visible = entries.slice(0, limit);
  const hidden = entries.length - visible.length;
  const now = Date.now();

  const days: Array<{ key: string; at: number; entries: Entry[] }> = [];
  for (const entry of visible) {
    const last = days[days.length - 1];
    if (last?.key === entry.day) last.entries.push(entry);
    else days.push({ key: entry.day, at: entry.versions[0]!.at, entries: [entry] });
  }

  const foldOpen = (id: string) => toggledFolds.has(id) !== (id === defaultOpen);
  const runOpen = (entry: Entry) => toggledRuns.has(entry.id) !== (defaultIndex >= 0 && entries[defaultIndex] === entry);

  const versionRow = (version: Version, current: boolean, inRun: boolean) => {
    const open = foldOpen(version.id);
    const foldId = `${baseId}-fold-${version.id}`;
    const toggle = () => setToggledFolds((set) => flip(set, version.id));
    const plan = current ? null : versionRestorePlan(oldestFirst, version.id);
    const restorable = plan?.ok === true && Object.keys(plan.patch).length > 0;
    const skipped = plan?.ok === true ? plan.skipped.map(historyField).join(", ") : "";
    const Icon = versionIcon(version);
    return (
      <li key={`${bot.id}-${version.id}`} data-history-version={version.id}>
        <div className={inRun ? "flex min-h-[44px] items-center gap-3 py-1.5 pl-12 pr-4" : "flex min-h-[56px] items-center gap-3 px-4 py-2"}>
          <button type="button" aria-expanded={open} aria-controls={open ? foldId : undefined} onClick={toggle} className={ROW_BUTTON}>
            {!inRun && <Icon aria-hidden="true" className={ICON} />}
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2">
                {inRun ? (
                  <span className="truncate text-[14px] leading-5 text-ink" title={version.via}>{niceTime(version.at)}</span>
                ) : (
                  <span className="truncate text-[14px] leading-5 text-ink">{t("botPanel.history.versionChanged", { fields: versionFields(version) })}</span>
                )}
                {current && <span data-history-current="" className={BADGE}>{t("botPanel.history.current")}</span>}
                {restoredVersion(version) && <span className={BADGE}>{t("botPanel.history.viaRestore")}</span>}
              </span>
              {!inRun && (
                <span className="block truncate text-[12px] leading-4 text-ink-secondary" title={version.via}>
                  {historyWho(version)} · {niceTime(version.at)}
                </span>
              )}
            </span>
          </button>
          {!current && (
            <button
              type="button"
              data-history-restore={version.id}
              disabled={restoring || !restorable}
              title={!restorable && skipped ? t("botPanel.history.notRestorable", { fields: skipped }) : undefined}
              onClick={() => onRestore(version.id, plan?.ok ? Object.keys(plan.patch).map(historyField).join(", ") : "")}
              className={PILL}
            >
              {t("botPanel.history.restore")}
            </button>
          )}
          <RowChevron open={open} onClick={toggle} />
        </div>
        {open && (
          <div id={foldId} data-history-fold={version.id} className="mb-2 ml-12 mr-4 flex flex-col gap-3 rounded-lg bg-inset px-3 py-2">
            <ul className="flex flex-col gap-0.5 text-[12px] leading-4 text-ink-secondary">
              {version.rows.map((row) => <li key={row.id} className="break-words">{historySummary(row)}</li>)}
            </ul>
            {!current && <Comparison rows={sorted} version={version} />}
            {skipped && (
              <p className="text-[12px] leading-4 text-ink-secondary">{t("botPanel.history.notRestorable", { fields: skipped })}</p>
            )}
          </div>
        )}
      </li>
    );
  };

  const runRow = (entry: Entry) => {
    const head = entry.versions[0]!;
    const oldest = entry.versions[entry.versions.length - 1]!;
    const open = runOpen(entry);
    const listId = `${baseId}-run-${entry.id}`;
    const toggle = () => setToggledRuns((set) => flip(set, entry.id));
    const Icon = versionIcon(head);
    const from = niceTime(oldest.at);
    const to = niceTime(head.at);
    return (
      <li key={`${bot.id}-run-${entry.id}`} data-history-group={entry.id} data-history-count={entry.versions.length}>
        <div className="flex min-h-[56px] items-center gap-3 px-4 py-2">
          <button type="button" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={toggle} className={ROW_BUTTON}>
            <Icon aria-hidden="true" className={ICON} />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[14px] leading-5 text-ink">{t("botPanel.history.versionChanged", { fields: versionFields(head) })}</span>
                <span className="shrink-0 text-[14px] leading-5 text-ink-secondary">{t("botPanel.history.times", { count: entry.versions.length })}</span>
                {restoredVersion(head) && <span className={BADGE}>{t("botPanel.history.viaRestore")}</span>}
              </span>
              <span className="block truncate text-[12px] leading-4 text-ink-secondary" title={head.via}>
                {historyWho(head)} · {from === to ? to : t("botPanel.history.timeRange", { from, to })}
              </span>
            </span>
          </button>
          <RowChevron open={open} onClick={toggle} expandId={entry.id} />
        </div>
        {open && (
          <ol id={listId} className="flex flex-col pb-1">
            {entry.versions.map((version) => versionRow(version, false, true))}
          </ol>
        )}
      </li>
    );
  };

  return (
    <SettingsGroup groupId="history" title={t("botSettings.nav.history")} accessory={note}>
      <div data-history-versions="">
        {days.map((day) => {
          const headingId = `${baseId}-day-${day.key}`;
          return (
            <div key={day.key} role="group" aria-labelledby={headingId}>
              <h4 id={headingId} data-history-day={day.key} className="m-0 px-4 pb-1 pt-3 text-[12px] font-normal leading-4 text-ink-secondary">
                {dayLabel(day.at, now)}
              </h4>
              <ol className="flex flex-col">
                {day.entries.map((entry) => (entry.versions.length > 1 ? runRow(entry) : versionRow(entry.versions[0]!, entry.current, false)))}
              </ol>
            </div>
          );
        })}
        {hidden > 0 && (
          <div className="flex justify-center px-4 pb-2 pt-1">
            <button
              type="button"
              data-history-more=""
              onClick={() => setPages(Math.ceil(limit / PAGE) + 1)}
              className={PILL}
            >
              {t("botPanel.history.showMore", { count: hidden })}
            </button>
          </div>
        )}
      </div>
    </SettingsGroup>
  );
}
