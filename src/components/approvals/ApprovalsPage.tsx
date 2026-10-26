// The Approvals screen (2026-10-19): from seeing a card to answering it in
// under two seconds, with no doubt about what is granted and what happens
// next. The list on the left (filters as chips, combined, kept in the
// address), the card picked on the right with its answer as large buttons,
// a bulk answer for several plain permissions at once, and the History of
// what was answered. Keys: Y yes, N no, J / K move, Enter open, Escape back,
// X tick a row. The data is server/routes/approvals-inbox.ts.
import { ChevronDown, Loader2, ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  bulkPlan,
  DEFAULT_INBOX_FILTERS,
  filterInbox,
  inboxHash,
  isInboxHash,
  parseInboxHash,
  sortInbox,
  type InboxApproval,
  type InboxBulkRefusal,
  type InboxFilters,
} from "../../../shared/approvals-inbox";
import { WindowDragStrip } from "../DesktopCapabilities";
import { bulkAnswer, inboxTitle, useInbox } from "@/lib/approvals-inbox";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableErrorMessage } from "@/lib/readable-error";
import { openNotificationTarget, useStore, type Bot } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { ApprovalDetail, OutcomePanel, type InboxOutcome } from "./ApprovalDetail";
import { ApprovalRow, InboxAvatar } from "./ApprovalRow";
import { ApprovalsHistory } from "./ApprovalsHistory";
import { inboxKeyAction, moveSelection, selectionAfterRemoval } from "./inbox-keys";

/** How long the answer's outcome stays before the next card. */
const OUTCOME_MS = 1_100;
/** An answered card stays hidden this long while the server catches up;
 * still listed after that, the answer did not go through and it returns. */
const ANSWERED_HIDE_MS = 10_000;

function Chip({ active, onClick, children, testId, ariaPressed = true }: { active: boolean; onClick: () => void; children: ReactNode; testId?: string; ariaPressed?: boolean }) {
  return (
    <button
      type="button"
      data-chip={testId}
      aria-pressed={ariaPressed ? active : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[12.5px] transition-colors",
        active ? "border-accent/50 bg-accent/12 font-medium text-ink" : "border-hairline/50 text-ink-secondary hover:bg-control hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function BotFilter({ entries, bots, value, onChange }: { entries: readonly InboxApproval[]; bots: ReadonlyMap<string, Bot>; value: string; onChange: (bot: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const counts = useMemo(() => {
    const out = new Map<string, { name: string; n: number }>();
    for (const entry of entries) {
      const row = out.get(entry.botId) ?? { name: entry.botName, n: 0 };
      row.n++;
      out.set(entry.botId, row);
    }
    return [...out.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [entries]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  const current = value ? counts.find(([id]) => id === value)?.[1].name ?? entries.find((entry) => entry.botId === value)?.botName : undefined;
  return (
    <div ref={ref} className="relative">
      <Chip active={Boolean(value)} onClick={() => setOpen((was) => !was)} testId="bot" ariaPressed={false}>
        {current ?? t("approvals.filter.byBot")}
        <ChevronDown size={12} aria-hidden="true" />
      </Chip>
      {open && (
        <div role="menu" className="absolute left-0 top-8 z-30 min-w-52 overflow-hidden rounded-xl border border-hairline/50 bg-popover p-1 shadow-lg">
          <button type="button" role="menuitemradio" aria-checked={!value} onClick={() => { onChange(""); setOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-control">
            {t("approvals.filter.allBots")}
          </button>
          {counts.map(([id, row]) => (
            <button key={id} type="button" role="menuitemradio" aria-checked={value === id} onClick={() => { onChange(id); setOpen(false); }} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-control", value === id && "bg-control")}>
              <InboxAvatar bot={bots.get(id)} name={row.name} size={20} />
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              <span className="text-[11.5px] tabular-nums text-ink-tertiary">{row.n}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const REFUSAL_KEY: Record<InboxBulkRefusal | "gone", Parameters<typeof t>[0]> = {
  question: "approvals.bulk.skip.question",
  proposal: "approvals.bulk.skip.proposal",
  "needs-key": "approvals.bulk.skip.needsKey",
  confidential: "approvals.bulk.skip.confidential",
  "not-yours": "approvals.bulk.skip.notYours",
  special: "approvals.bulk.skip.special",
  gone: "approvals.bulk.skip.gone",
};

function BulkConfirm({ decision, selected, bots, busy, onCancel, onConfirm }: {
  decision: "allow" | "deny";
  selected: readonly InboxApproval[];
  bots: ReadonlyMap<string, Bot>;
  busy: boolean;
  onCancel: () => void;
  /** `always`: keep each card's own Always allow too (2026-10-19) */
  onConfirm: (always: boolean) => void;
}) {
  const plan = bulkPlan(selected, decision);
  const [always, setAlways] = useState(false);
  // every card a bulk Always allow covers must have its own rule to keep
  const alwaysOffered = decision === "allow" && plan.answered.length > 0 && plan.answered.every((entry) => Boolean(entry.alwaysRule) && entry.alwaysKind === plan.answered[0]?.alwaysKind);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { confirmRef.current?.focus(); }, []);
  const allow = decision === "allow";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="approvals-bulk-title"
        data-bulk-confirm={decision}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-hairline/50 bg-card shadow-2xl"
      >
        <div className="px-5 pb-2 pt-4">
          <h2 id="approvals-bulk-title" className="text-[16px] font-semibold text-ink">
            {t(allow ? "approvals.bulk.confirmAllowTitle" : "approvals.bulk.confirmDenyTitle", { count: plan.answered.length })}
          </h2>
          <p className="mt-1 text-[12.5px] text-ink-secondary">{t(allow ? (always ? "approvals.bulk.alwaysNote" : "approvals.bulk.onceOnly") : "approvals.bulk.denyNote")}</p>
          {alwaysOffered && (
            <label className="mt-2 flex items-center gap-2 text-[13px] text-ink" data-bulk-always="">
              <input type="checkbox" checked={always} onChange={(event) => setAlways(event.target.checked)} />
              {t("approvals.bulk.always")}
            </label>
          )}
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-hairline/30 overflow-y-auto border-y border-hairline/40" data-bulk-list="answered">
          {plan.answered.map((entry) => (
            <li key={entry.key} className="flex items-center gap-2.5 px-5 py-2">
              <InboxAvatar bot={bots.get(entry.botId)} name={entry.botName} size={22} />
              <span className="shrink-0 text-[12.5px] font-medium text-ink">{entry.botName}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{always && entry.alwaysRule ? entry.alwaysRule : inboxTitle(entry)}</span>
              {entry.destination && <span className="shrink-0 text-[11.5px] text-ink-tertiary">{t(`approvals.destination.${entry.destination}`)}</span>}
            </li>
          ))}
        </ul>
        {plan.skipped.length > 0 && (
          <div className="px-5 pt-2.5 text-[12px] text-ink-secondary" data-bulk-list="skipped">
            <div className="font-medium text-ink-secondary">{t("approvals.bulk.skippedTitle", { count: plan.skipped.length })}</div>
            <ul className="mt-1 flex flex-col gap-0.5">
              {plan.skipped.map(({ entry, reason }) => (
                <li key={entry.key} className="truncate">{entry.botName} · {inboxTitle(entry)} · {t(REFUSAL_KEY[reason])}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-3 px-5 pb-5 pt-4">
          <button type="button" onClick={onCancel} className="ui-button flex-1">{t("approval.action.cancel")}</button>
          <button
            ref={confirmRef}
            type="button"
            disabled={busy || plan.answered.length === 0}
            onClick={() => onConfirm(always && alwaysOffered)}
            className={cn(
              "flex flex-[1.4] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-semibold disabled:opacity-40",
              allow ? "bg-success hover:brightness-110" : "bg-danger text-danger-ink hover:brightness-110",
            )}
          >
            {busy && <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {t(allow ? "approvals.bulk.allowN" : "approvals.bulk.denyN", { count: plan.answered.length })}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyCalm({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  return (
    <div data-approvals-empty={filtered ? "filtered" : "calm"} className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      {!filtered && (
        <svg width="56" height="24" viewBox="0 0 56 24" aria-hidden="true" className="mb-2 text-ink-tertiary">
          <path d="M2 18 H54" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
          <circle cx="28" cy="10" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
        </svg>
      )}
      <div className="text-[16px] font-medium text-ink">{filtered ? t("approvals.empty.filtered") : t("approvals.empty.title")}</div>
      <div className="max-w-sm text-[13px] text-ink-secondary">{filtered ? "" : t("approvals.empty.body")}</div>
      {filtered && <button type="button" onClick={onClear} className="ui-button mt-1">{t("approvals.filter.clear")}</button>}
    </div>
  );
}

export function ApprovalsPage() {
  const { state, dispatch } = useStore();
  const [filters, setFilters] = useState<InboxFilters>(() => (typeof location !== "undefined" ? parseInboxHash(location.hash) : { ...DEFAULT_INBOX_FILTERS }));
  const patch = useCallback((next: Partial<InboxFilters>) => setFilters((was) => ({ ...was, ...next })), []);

  // The filters live in the address, so a reload or a link keeps them.
  useEffect(() => {
    try { history.replaceState(history.state, "", `${location.pathname}${location.search}${inboxHash(filters)}`); } catch { /* not a browser page */ }
  }, [filters]);
  useEffect(() => () => {
    try { if (isInboxHash(location.hash)) history.replaceState(history.state, "", `${location.pathname}${location.search}`); } catch { /* ignore */ }
  }, []);

  // The store's own count of conversations waiting on the person: a change
  // there reloads the list at once instead of waiting for the next poll.
  const signal = useMemo(() => state.bots
    .flatMap((bot) => (bot.tasks ?? []).filter((task) => task.activity === "waiting-on-you").map((task) => task.threadId))
    .sort().join(","), [state.bots]);
  const { data, error, refresh, arrived } = useInbox(filters.tab === "history", signal);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { if (data) setNow(Date.now()); }, [data]);

  const bots = useMemo(() => new Map(state.bots.map((bot) => [bot.id, bot])), [state.bots]);
  const [answered, setAnswered] = useState<Map<string, number>>(new Map());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const all = useMemo(() => sortInbox((data?.pending ?? []).filter((entry) => {
    const at = answered.get(entry.key);
    return at === undefined || now - at > ANSWERED_HIDE_MS || leaving.has(entry.key);
  })), [data, answered, leaving, now]);
  const shown = useMemo(() => filterInbox(all, filters), [all, filters]);
  const keys = useMemo(() => shown.map((entry) => entry.key), [shown]);

  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<InboxOutcome | null>(null);
  const [confirm, setConfirm] = useState<"allow" | "deny" | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // Something is always picked while the list has cards.
  useEffect(() => {
    if (outcome) return;
    if (!selected || !keys.includes(selected)) setSelected(keys[0] ?? null);
  }, [keys, selected, outcome]);
  // Ticks only on cards still listed.
  useEffect(() => {
    setChecked((was) => {
      const next = new Set([...was].filter((key) => keys.includes(key)));
      return next.size === was.size ? was : next;
    });
  }, [keys]);
  // Forget answered cards the server no longer lists.
  useEffect(() => {
    if (!data) return;
    const live = new Set(data.pending.map((entry) => entry.key));
    setAnswered((was) => {
      const next = new Map([...was].filter(([key]) => live.has(key)));
      return next.size === was.size ? was : next;
    });
  }, [data]);

  const current = shown.find((entry) => entry.key === selected) ?? null;

  // one pending timer per answered card, so a refused answer can be undone
  const answerTimers = useRef(new Map<string, number>());
  useEffect(() => () => { for (const timer of answerTimers.current.values()) window.clearTimeout(timer); }, []);
  const finishAnswer = useCallback((key: string, reload = true) => {
    setLeaving((was) => new Set(was).add(key));
    setAnswered((was) => new Map(was).set(key, Date.now()));
    window.clearTimeout(answerTimers.current.get(key));
    answerTimers.current.set(key, window.setTimeout(() => {
      answerTimers.current.delete(key);
      setLeaving((was) => { const next = new Set(was); next.delete(key); return next; });
      setOutcome((was) => (was?.key === key ? null : was));
      setSelected((was) => (was === key ? selectionAfterRemoval(keysRef.current, key) : was));
      if (reload) void refresh();
    }, OUTCOME_MS));
  }, [refresh]);
  const keysRef = useRef(keys);
  keysRef.current = keys;

  const onDecided = useCallback((decision: "allow" | "deny" | "answer") => {
    if (!current) return;
    setOutcome({ key: current.key, botName: current.botName, decision });
    finishAnswer(current.key);
  }, [current, finishAnswer]);
  // The server refused the answer (a key cancelled, 403, 409): the card
  // comes back as it was, with a line saying so.
  const onDecideFailed = useCallback((key: string) => {
    window.clearTimeout(answerTimers.current.get(key));
    answerTimers.current.delete(key);
    setLeaving((was) => { if (!was.has(key)) return was; const next = new Set(was); next.delete(key); return next; });
    setAnswered((was) => { if (!was.has(key)) return was; const next = new Map(was); next.delete(key); return next; });
    setOutcome((was) => (was?.key === key ? null : was));
    setSelected(key);
    setBulkNote(t("approvals.answerFailed"));
    void refresh();
  }, [refresh]);

  // the same routing as a notification: a room's task opens its room, then
  // the task; a bot's topic opens where the single stream shows it
  const showThreads = useShowThreads();
  const openThread = useCallback((entry: InboxApproval) => {
    openNotificationTarget(dispatch, { botId: entry.botId, threadId: entry.threadId }, state, showThreads);
  }, [dispatch, state, showThreads]);
  const cancelTurn = useCallback((entry: InboxApproval) => {
    const group = state.groups.find((candidate) => candidate.threadId === entry.threadId || candidate.tasks?.some((task) => task.threadId === entry.threadId));
    if (group) dispatch({ type: "interruptGroup", groupId: group.id, threadId: entry.threadId });
    else dispatch({ type: "interrupt", botId: entry.botId, threadId: entry.threadId });
  }, [dispatch, state.groups]);

  const checkedEntries = useMemo(() => shown.filter((entry) => checked.has(entry.key)), [shown, checked]);
  const toggle = useCallback((key: string) => {
    setChecked((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  // only what a bulk answer may cover is ticked (a deny covers a needs-key card)
  const decidable = shown.filter((entry) => entry.decidable && (entry.bulk === true || entry.bulk === "needs-key"));
  const allChecked = decidable.length > 0 && decidable.every((entry) => checked.has(entry.key));

  const runBulk = async (always = false) => {
    if (!confirm) return;
    const plan = bulkPlan(checkedEntries, confirm);
    setBulkBusy(true);
    try {
      const out = await bulkAnswer(confirm, plan.answered, always);
      for (const result of out.results) if (result.ok) finishAnswer(result.key, false);
      window.setTimeout(() => void refresh(), OUTCOME_MS);
      const left = checkedEntries.length - out.answered;
      setBulkNote(t(confirm === "allow" ? "approvals.bulk.doneAllow" : "approvals.bulk.doneDeny", { count: out.answered }) + (left > 0 ? ` ${t("approvals.bulk.left", { count: left })}` : ""));
      setChecked(new Set());
      setConfirm(null);
    } catch (cause) {
      setBulkNote(readableErrorMessage(cause, t("approvals.error")));
      setConfirm(null);
    } finally {
      setBulkBusy(false);
    }
  };
  useEffect(() => {
    if (!bulkNote) return;
    const timer = window.setTimeout(() => setBulkNote(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [bulkNote]);

  // Keys, anywhere on the screen but a field or a question's own choices.
  const keyState = useRef({ keys, selected, current, checkedCount: checked.size, confirm, detailOpen, outcome, tab: filters.tab, otherOverlay: false });
  keyState.current = { keys, selected, current, checkedCount: checked.size, confirm, detailOpen, outcome, tab: filters.tab, otherOverlay: Boolean(state.appSettingsOpen || state.settingsOpen) };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const now = keyState.current;
      if (now.confirm || now.otherOverlay || now.tab !== "pending") return;
      const action = inboxKeyAction(event);
      if (!action) return;
      if (action === "next" || action === "previous") {
        event.preventDefault();
        const next = moveSelection(now.keys, now.selected, action === "next" ? 1 : -1);
        setSelected(next);
        if (next) requestAnimationFrame(() => listRef.current?.querySelector(`[data-key="${CSS.escape(next)}"]`)?.scrollIntoView({ block: "nearest" }));
        return;
      }
      if (action === "open") {
        if (!now.current) return;
        event.preventDefault();
        setDetailOpen(true);
        requestAnimationFrame(() => detailRef.current?.querySelector<HTMLElement>("[data-decision='allow'], [data-ask-choice], button")?.focus());
        return;
      }
      if (action === "close") {
        if (now.checkedCount) { event.preventDefault(); setChecked(new Set()); return; }
        if (now.detailOpen) { event.preventDefault(); setDetailOpen(false); listRef.current?.focus(); }
        return;
      }
      if (action === "toggle") {
        if (now.current?.decidable && (now.current.bulk === true || now.current.bulk === "needs-key")) { event.preventDefault(); toggle(now.current.key); }
        return;
      }
      // Y / N: several ticked → the bulk confirmation; else the card shown
      if (now.checkedCount) {
        event.preventDefault();
        setConfirm(action === "allow" ? "allow" : "deny");
        return;
      }
      if (now.outcome) return;
      const button = detailRef.current?.querySelector<HTMLButtonElement>(`[data-approval-actions='inbox'] [data-decision='${action === "allow" ? "allow" : "deny"}']`);
      if (button && !button.disabled) {
        event.preventDefault();
        button.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const scopes = data?.scopes ?? { org: false, team: false };
  const filtered = filters.scope !== "all" || Boolean(filters.bot) || Boolean(filters.kind) || filters.risky;
  const pendingCount = all.filter((entry) => !leaving.has(entry.key)).length;

  return (
    <main data-approvals-page="" className="relative flex h-full min-w-0 flex-1 flex-col bg-app">
      <WindowDragStrip />
      <header className="flex flex-wrap items-center gap-3 px-5 pb-2 pt-12">
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">{t("approvals.title")}</h1>
        <div role="tablist" aria-label={t("approvals.title")} className="flex rounded-full bg-control/70 p-0.5">
          {(["pending", "history"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={filters.tab === tab}
              onClick={() => patch({ tab })}
              className={cn("rounded-full px-3 py-1 text-[12.5px] transition-colors", filters.tab === tab ? "bg-card font-medium text-ink shadow-sm" : "text-ink-secondary hover:text-ink")}
            >
              {tab === "pending" ? t("approvals.tab.pending", { count: pendingCount }) : t("approvals.tab.history")}
            </button>
          ))}
        </div>
        {error && <span role="alert" className="text-[12.5px] text-danger">{t("approvals.error")}</span>}
      </header>

      {filters.tab === "history" ? (
        <ApprovalsHistory rows={data?.history ?? []} query={filters.q} onQuery={(q) => patch({ q })} loading={!data} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3" data-approvals-filters="">
            <Chip active={filters.scope === "all"} onClick={() => patch({ scope: "all" })} testId="all">{t("approvals.filter.all")}</Chip>
            <Chip active={filters.scope === "mine"} onClick={() => patch({ scope: filters.scope === "mine" ? "all" : "mine" })} testId="mine">{t("approvals.filter.mine")}</Chip>
            {scopes.org && <Chip active={filters.scope === "org"} onClick={() => patch({ scope: filters.scope === "org" ? "all" : "org" })} testId="org">{t("approvals.filter.org")}</Chip>}
            {scopes.team && <Chip active={filters.scope === "team"} onClick={() => patch({ scope: filters.scope === "team" ? "all" : "team" })} testId="team">{t("approvals.filter.team")}</Chip>}
            <span aria-hidden="true" className="mx-1 h-4 w-px bg-hairline/60" />
            <BotFilter entries={all} bots={bots} value={filters.bot} onChange={(bot) => patch({ bot })} />
            <Chip active={filters.kind === "permission"} onClick={() => patch({ kind: filters.kind === "permission" ? "" : "permission" })} testId="permission">{t("approvals.filter.permissions")}</Chip>
            <Chip active={filters.kind === "question"} onClick={() => patch({ kind: filters.kind === "question" ? "" : "question" })} testId="question">{t("approvals.filter.questions")}</Chip>
            <Chip active={filters.risky} onClick={() => patch({ risky: !filters.risky })} testId="risky">
              <ShieldAlert size={12} aria-hidden="true" />
              {t("approvals.filter.risky")}
            </Chip>
            {filtered && (
              <button type="button" onClick={() => setFilters((was) => ({ ...DEFAULT_INBOX_FILTERS, tab: was.tab }))} className="ml-1 inline-flex items-center gap-1 text-[12px] text-ink-secondary hover:text-ink">
                <X size={12} aria-hidden="true" />
                {t("approvals.filter.clear")}
              </button>
            )}
          </div>

          {data && all.length === 0 ? (
            // nothing waits at all: one calm line across the screen, no empty panes
            <div className="min-h-0 flex-1 border-t border-hairline/40">
              <EmptyCalm filtered={false} onClear={() => {}} />
            </div>
          ) : (
          <div className="flex min-h-0 flex-1 border-t border-hairline/40">
            <section
              aria-label={t("approvals.listLabel")}
              className={cn("flex min-h-0 w-full flex-col border-hairline/40 md:w-[400px] md:shrink-0 md:border-r", detailOpen && "max-md:hidden")}
            >
              {checked.size > 0 ? (
                <div className="flex items-center gap-2 border-b border-hairline/40 bg-accent/8 px-3 py-2" data-bulk-bar="">
                  <span className="text-[12.5px] font-medium text-ink">{t("approvals.bulk.selected", { count: checked.size })}</span>
                  <span className="flex-1" />
                  <button type="button" onClick={() => setConfirm("deny")} className="rounded-lg border border-danger/40 px-2.5 py-1 text-[12.5px] font-medium text-danger hover:bg-danger/10">{t("approvals.bulk.deny")}</button>
                  <button type="button" onClick={() => setConfirm("allow")} className="rounded-lg bg-success px-2.5 py-1 text-[12.5px] font-semibold hover:brightness-110">{t("approvals.bulk.allow")}</button>
                  <button type="button" onClick={() => setChecked(new Set())} aria-label={t("approvals.bulk.clear")} title={t("approvals.bulk.clear")} className="rounded-md p-1 text-ink-secondary hover:bg-control"><X size={14} aria-hidden="true" /></button>
                </div>
              ) : decidable.length > 1 ? (
                <div className="flex items-center gap-2 border-b border-hairline/30 px-3 py-1.5">
                  <button type="button" onClick={() => setChecked(allChecked ? new Set() : new Set(decidable.map((entry) => entry.key)))} className="text-[12px] text-ink-secondary hover:text-ink">
                    {t("approvals.bulk.selectAll", { count: decidable.length })}
                  </button>
                </div>
              ) : null}
              {bulkNote && <div role="status" className="border-b border-hairline/30 px-3 py-1.5 text-[12px] text-ink-secondary">{bulkNote}</div>}
              <div ref={listRef} role="listbox" tabIndex={0} aria-label={t("approvals.listLabel")} aria-activedescendant={selected ? `approval-${selected}` : undefined} className="min-h-0 flex-1 overflow-y-auto focus:outline-none">
                {!data && !error ? (
                  <div className="flex justify-center py-12"><Loader2 size={18} className="animate-spin text-ink-tertiary motion-reduce:animate-none" aria-hidden="true" /></div>
                ) : shown.length === 0 ? (
                  <EmptyCalm filtered={filtered && all.length > 0} onClear={() => setFilters((was) => ({ ...DEFAULT_INBOX_FILTERS, tab: was.tab }))} />
                ) : (
                  shown.map((entry) => (
                    <div key={entry.key} id={`approval-${entry.key}`} data-key={entry.key}>
                      <ApprovalRow
                        entry={entry}
                        bot={bots.get(entry.botId)}
                        now={now}
                        selected={entry.key === selected}
                        checked={checked.has(entry.key)}
                        leaving={leaving.has(entry.key)}
                        entering={arrived.has(entry.key)}
                        onSelect={(key) => { setSelected(key); setDetailOpen(true); }}
                        onCheck={toggle}
                      />
                    </div>
                  ))
                )}
              </div>
              <div className="hidden border-t border-hairline/30 px-3 py-1.5 text-[11px] text-ink-tertiary md:block" data-approvals-keys="">
                {t("approvals.keys")}
              </div>
            </section>

            <section
              ref={detailRef}
              aria-label={t("approvals.detailLabel")}
              className={cn("min-h-0 min-w-0 flex-1 bg-card/40", !detailOpen && "max-md:hidden")}
            >
              {outcome ? (
                <OutcomePanel outcome={outcome} />
              ) : current ? (
                <ApprovalDetail
                  key={current.key}
                  entry={current}
                  bot={bots.get(current.botId)}
                  now={now}
                  onDecided={onDecided}
                  onDecideFailed={() => onDecideFailed(current.key)}
                  onOpenThread={() => openThread(current)}
                  onCancelTurn={() => cancelTurn(current)}
                />
              ) : (
                shown.length === 0 && data ? null : <div className="flex h-full items-center justify-center text-[13px] text-ink-tertiary">{t("approvals.pick")}</div>
              )}
            </section>
          </div>
          )}
        </>
      )}

      {confirm && (
        <BulkConfirm
          decision={confirm}
          selected={checkedEntries}
          bots={bots}
          busy={bulkBusy}
          onCancel={() => setConfirm(null)}
          onConfirm={(always) => void runBulk(always)}
        />
      )}
    </main>
  );
}

