// Changes: the bot's version history (2026-10-15). Every save of the
// profile (name, label, description, Personality, working folder, alerts)
// is a version, newest first, with when, who and what changed. Opening a
// version compares it with the current one, and "Restore this version"
// (with a confirmation) brings the bot back to it through
// POST /api/bots/:id/history/restore. A restore is itself a new version, so
// it can be restored away in turn.
//
// Server-built list (GET /api/bots/:id/history?full=1). Pure
// presentational: the hook owns the fetch, the reload after a restore, the
// confirmation and the loading/error split. A first-load failure never
// reaches this component; a failed reload with rows already on screen
// arrives as refreshError.
import { PILL } from "../SettingsPrimitives";
import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { t } from "@/lib/i18n";
import { formatMemoryBytes } from "@/lib/memory";
import { whenLabel } from "@/lib/schedule-label";
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
  name: "botPanel.history.field.name",
  title: "botPanel.history.field.title",
  description: "botPanel.history.field.description",
  cwd: "botPanel.history.field.cwd",
  notifications: "botPanel.history.field.notifications",
  speakReplies: "botPanel.history.field.speakReplies",
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

function Comparison({ rows, version }: { rows: HistoryRow[]; version: BotVersion<HistoryRow> }) {
  const changes = versionComparison(rows, version.id);
  if (changes.length === 0) {
    return <p className="text-[12.5px] text-ink-secondary">{t("botPanel.history.sameAsCurrent")}</p>;
  }
  return (
    <div className="flex flex-col gap-3" data-history-compare={version.id}>
      <p className="text-[12px] text-ink-secondary">{t("botPanel.history.compare")}</p>
      {changes.map(({ field, atVersion: then, now }) => (
        <div key={field} data-history-diff={field}>
          <div className="mb-1 text-[12.5px] font-medium text-ink">{historyField(field)}</div>
          {field === "soul" ? (
            <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-lg bg-card p-2 font-sans text-[12.5px] leading-relaxed">
              {lineDiff(then, now).map((line, index) => (
                <div
                  key={index}
                  data-diff={line.kind}
                  className={line.kind === "removed" ? "bg-danger/10 text-ink line-through decoration-danger/50" : line.kind === "added" ? "bg-success/10 text-ink" : "text-ink-secondary"}
                >
                  {line.kind === "removed" ? "- " : line.kind === "added" ? "+ " : "  "}{line.text || " "}
                </div>
              ))}
            </pre>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
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
  /** The version shown open on first render. */
  defaultOpen?: string;
}) {
  const [open, setOpen] = useState<string | null>(defaultOpen ?? null);
  if (!rows) {
    return <div className="text-[13px] text-ink-secondary">{t("botPanel.loading")}</div>;
  }
  if (rows.length === 0) {
    return <div className="text-[13px] text-ink-secondary">{t("botPanel.history.empty")}</div>;
  }

  const sorted = [...rows].sort((a, b) => b.at - a.at);
  const oldestFirst = [...sorted].reverse();
  const versions = botVersions(sorted);

  return (
    <div className="flex flex-col gap-2">
      {refreshError && (
        <div className="text-[12.5px] text-ink-secondary">{t("botPanel.history.refresh")}</div>
      )}
      {/* Settings' card (2026-10-16): one rounded card, a row per version. */}
      <ol className="flex flex-col divide-y divide-hairline/40 overflow-clip rounded-xl border-[0.5px] border-border bg-elevated" data-history-versions="">
        {versions.map((version, index) => {
          const current = index === 0;
          const expanded = open === version.id;
          const plan = current ? null : versionRestorePlan(oldestFirst, version.id);
          const restorable = plan?.ok === true && Object.keys(plan.patch).length > 0;
          const skipped = plan?.ok === true ? plan.skipped.map(historyField).join(", ") : "";
          const restored = version.via === "restore" || version.via === "rollback";
          return (
            <li key={`${bot.id}-${version.id}`} data-history-version={version.id} className="px-3.5 py-2.5">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : version.id)}
                className="flex w-full items-start gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
              >
                <ChevronRight size={14} aria-hidden="true" className={`mt-1 shrink-0 text-ink-secondary transition-transform motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 text-[13px] leading-relaxed text-ink">
                    <span>{whenLabel(version.at)}</span>
                    {current && (
                      <span data-history-current="" className="rounded-full bg-hover px-2 py-0.5 text-[11px] text-ink-secondary">{t("botPanel.history.current")}</span>
                    )}
                    {restored && (
                      <span className="rounded-full bg-hover px-2 py-0.5 text-[11px] text-ink-secondary">{t("botPanel.history.viaRestore")}</span>
                    )}
                  </span>
                  <span className="block text-[12px] text-ink-secondary" title={version.via}>
                    {historyWho(version)} · {t("botPanel.history.versionChanged", { fields: versionFields(version) })}
                  </span>
                </span>
              </button>
              {expanded && (
                <div className="mt-3 flex flex-col gap-3 pl-6">
                  <ul className="flex flex-col gap-0.5 text-[12.5px] text-ink-secondary">
                    {version.rows.map((row) => <li key={row.id}>{historySummary(row)}</li>)}
                  </ul>
                  <Comparison rows={sorted} version={version} />
                  {!current && (
                    <div className="flex flex-col items-start gap-1.5">
                      <button
                        type="button"
                        data-history-restore={version.id}
                        disabled={restoring || !restorable}
                        onClick={() => onRestore(version.id, plan?.ok ? Object.keys(plan.patch).map(historyField).join(", ") : "")}
                        className={PILL}
                      >
                        {t("botPanel.history.restoreVersion")}
                      </button>
                      {skipped && (
                        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("botPanel.history.notRestorable", { fields: skipped })}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
