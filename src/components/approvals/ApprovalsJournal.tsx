// The Approvals screen's Journal tab (2026-10-26, chantier « Confiance »):
// every action of the person's own bots over the last 7 or 30 days,
// allowed, asked, refused, failed or expired, with what decided it (their
// rule in their words, an Always allow, the approval level, Full access, a
// tool access grant, an organization rule, their own answer, a timeout, an
// error). Filters by outcome, bot and words; a row opens its details and its
// conversation. "Tester une règle" replays a rule on the last 7 days before
// it is saved. The History tab stays as it was; this one is added beside it.
// Data: GET /api/approvals/journal (server/action-journal.ts).
import { AlertTriangle, Ban, Check, ChevronDown, Clock, Hand, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { filterJournal, JOURNAL_DAYS, journalCounts, type JournalEntry, type JournalOutcome, type JournalOutcomeFilter, type JournalPayload, type RuleTestResult } from "../../../shared/action-journal";
import { deciderLine, guardLine, journalTitle, OUTCOME_LABEL, OUTCOME_TONE } from "@/lib/action-journal";
import { withoutIds } from "@/lib/approvals-inbox";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { RuleTestPanel } from "./RuleTest";

const TONE = {
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/12 text-danger",
  neutral: "bg-control text-ink-secondary",
} as const;

const ICON: Record<JournalOutcome, typeof Check> = {
  allowed: Check,
  asked: Hand,
  denied: Ban,
  failed: AlertTriangle,
  expired: Clock,
};

const OUTCOMES: readonly JournalOutcome[] = ["allowed", "asked", "denied", "failed", "expired"];

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function stamp(at: Date, today: Date): string {
  const time = at.toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit" });
  return sameDay(at, today) ? time : `${at.toLocaleDateString(activeLocale(), { day: "numeric", month: "short" })} ${time}`;
}

function JournalRow({ entry, open, onToggle, onOpenThread }: { entry: JournalEntry; open: boolean; onToggle: () => void; onOpenThread?: (entry: JournalEntry) => void }) {
  const Icon = ICON[entry.outcome];
  const at = new Date(entry.at);
  const guard = guardLine(entry);
  const asked = entry.askedBy && entry.askedBy !== entry.decider ? deciderLine({ decider: entry.askedBy, source: entry.askedSource }) : null;
  return (
    <li data-journal-outcome={entry.outcome} data-journal-decider={entry.decider} {...(entry.ruleId ? { "data-journal-has-rule": "" } : {})}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-control/40">
        <span className={cn("mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", TONE[OUTCOME_TONE[entry.outcome]])}>
          <Icon size={11} aria-hidden="true" />
          {t(OUTCOME_LABEL[entry.outcome])}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] text-ink">{journalTitle(entry)}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-secondary">
            <span className="font-medium">{withoutIds(entry.botName)}</span>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 truncate" data-journal-decided="">{deciderLine(entry)}</span>
            {entry.unattended && <span className="text-ink-tertiary">· {t("approvals.journal.unattended")}</span>}
          </div>
          {guard && <div className={cn("mt-0.5 text-[11.5px]", entry.guard?.allow ? "text-ink-tertiary" : "text-warning")} data-journal-guard="">{guard}</div>}
        </div>
        <time dateTime={at.toISOString()} title={at.toLocaleString(activeLocale())} className="shrink-0 pt-0.5 text-[12px] tabular-nums text-ink-secondary">{stamp(at, new Date())}</time>
        <ChevronDown size={14} aria-hidden="true" className={cn("mt-1 shrink-0 text-ink-tertiary transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="flex flex-col gap-1 px-4 pb-3 pl-[88px] text-[12px] text-ink-secondary" data-journal-detail="">
          {entry.summary && <div className="break-words font-mono text-[11.5px] text-ink-tertiary">{withoutIds(entry.summary)}</div>}
          {entry.ruleText && (
            <div data-journal-rule="">{t("approvals.journal.matchedRule", { rule: withoutIds(entry.ruleText) })}</div>
          )}
          {asked && <div>{t("approvals.journal.askedBecause", { why: asked })}</div>}
          {entry.ran === "failed" && entry.outcome === "failed" && entry.decider !== "error" && <div className="text-danger">{t("approvals.journal.ranFailed")}</div>}
          {entry.reason && <div>{t("approvals.journal.reason", { reason: withoutIds(entry.reason) })}</div>}
          {entry.threadId && onOpenThread && (
            <div>
              <button type="button" onClick={() => onOpenThread(entry)} className="text-accent hover:underline" data-journal-open="">{t("approvals.journal.openChat", { bot: withoutIds(entry.botName) })}</button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function ApprovalsJournal({ data, loading, days, onDays, query, onQuery, onOpenThread, testResult }: {
  data: JournalPayload | null;
  loading: boolean;
  days: number;
  onDays: (days: number) => void;
  query: string;
  onQuery: (q: string) => void;
  onOpenThread?: (entry: JournalEntry) => void;
  /** a result to show at once (the gallery) */
  testResult?: RuleTestResult;
}) {
  const [outcome, setOutcome] = useState<JournalOutcomeFilter>("");
  const [bot, setBot] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [testing, setTesting] = useState(Boolean(testResult));
  const entries = data?.entries ?? [];
  const counts = useMemo(() => journalCounts(entries), [entries]);
  const bots = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of entries) if (!seen.has(entry.botId)) seen.set(entry.botId, entry.botName);
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);
  const shown = useMemo(() => filterJournal(entries, { outcome, bot, q: query }), [entries, outcome, bot, query]);
  const chip = (active: boolean) => cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] transition-colors", active ? "bg-ink text-app" : "bg-control/70 text-ink-secondary hover:text-ink");

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-approvals-journal="">
      <div className="flex flex-wrap items-center gap-1.5 px-5 pb-2" data-journal-filters="">
        <button type="button" className={chip(outcome === "")} onClick={() => setOutcome("")}>{t("approvals.filter.all")}<span className="tabular-nums opacity-70">{entries.length}</span></button>
        {OUTCOMES.map((value) => (
          <button key={value} type="button" className={chip(outcome === value)} onClick={() => setOutcome(outcome === value ? "" : value)} data-journal-chip={value}>
            {t(OUTCOME_LABEL[value])}<span className="tabular-nums opacity-70">{counts[value]}</span>
          </button>
        ))}
        <span aria-hidden="true" className="mx-1 h-4 w-px bg-hairline/60" />
        {bots.length > 1 && (
          <select value={bot} onChange={(event) => setBot(event.target.value)} aria-label={t("approvals.filter.byBot")} className="rounded-full bg-control/70 px-2.5 py-1 text-[12.5px] text-ink-secondary">
            <option value="">{t("approvals.filter.allBots")}</option>
            {bots.map((each) => <option key={each.id} value={each.id}>{withoutIds(each.name)}</option>)}
          </select>
        )}
        <div role="radiogroup" aria-label={t("approvals.journal.window")} className="flex rounded-full bg-control/70 p-0.5">
          {JOURNAL_DAYS.map((value) => (
            <button key={value} type="button" role="radio" aria-checked={days === value} onClick={() => onDays(value)} className={cn("rounded-full px-2.5 py-0.5 text-[12px]", days === value ? "bg-card font-medium text-ink shadow-sm" : "text-ink-secondary hover:text-ink")}>
              {t("approvals.journal.days", { n: value })}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <label className="flex min-w-[220px] max-w-md flex-1 items-center gap-2 rounded-xl border border-hairline/50 bg-inset px-3 py-1.5 focus-within:border-accent/60">
          <Search size={14} aria-hidden="true" className="text-ink-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={t("approvals.journal.search")}
            aria-label={t("approvals.journal.search")}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-tertiary"
          />
        </label>
        <button type="button" onClick={() => setTesting((was) => !was)} aria-expanded={testing} className="rounded-full border border-hairline/50 px-3 py-1 text-[12.5px] text-ink hover:bg-control" data-journal-test-toggle="">
          {t("approvals.journal.test.title")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {testing && <div className="mb-3"><RuleTestPanel bots={bots} {...(testResult ? { initialResult: testResult } : {})} /></div>}
        {shown.length === 0 ? (
          <div className="pt-16 text-center text-[13.5px] text-ink-secondary">
            {loading ? t("approvals.loading") : query.trim() || outcome || bot ? t("approvals.history.noMatch") : t("approvals.journal.empty", { days })}
          </div>
        ) : (
          <>
            <ol className="divide-y divide-hairline/30 overflow-hidden rounded-2xl border border-hairline/40 bg-card">
              {shown.map((entry) => (
                <JournalRow key={entry.key} entry={entry} open={open === entry.key} onToggle={() => setOpen(open === entry.key ? null : entry.key)} {...(onOpenThread ? { onOpenThread } : {})} />
              ))}
            </ol>
            {data?.truncated && <p className="pt-2 text-center text-[12px] text-ink-tertiary">{t("approvals.journal.truncated", { n: entries.length })}</p>}
          </>
        )}
      </div>
    </div>
  );
}
