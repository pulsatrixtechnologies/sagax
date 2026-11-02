// "Only when something changes" in the routine modal (2026-10-26).
// A routine can watch a file or a folder of its bot's folder, the output
// of a command run where the bot works, or a read-only MCP tool with fixed
// arguments. Sagax checks it on each due time with no model turn and starts
// the run only on a change, or while a condition holds
// (shared/routine-watch.ts, server/routines/routine-watch.ts). The person sets it on
// their own bots; nothing here asks for an admin. "Check now" reads it once
// where the routine would (POST /api/routines/watch-check), keeping nothing.
import { useState } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import type { RoutineWatchCondition, RoutineWatchOp, RoutineWatchPrecheck, RoutineWatchSourceType } from "../../../shared/routine-watch";
import { ROUTINE_WATCH_LIMITS, ROUTINE_WATCH_OPS } from "../../../shared/routine-watch";
import { readableError } from "@/lib/plain-error";

export type WatchConditionChoice = "none" | "json_path" | "contains" | "exit_code";

export interface WatchDraft {
  on: boolean;
  type: RoutineWatchSourceType;
  path: string;
  recursive: boolean;
  command: string;
  tool: string;
  args: string;
  condition: WatchConditionChoice;
  conditionPath: string;
  conditionOp: RoutineWatchOp;
  conditionValue: string;
  containsText: string;
  containsNegate: boolean;
  exitOp: "eq" | "ne";
  exitValue: string;
  wakeOn: "change" | "match";
  trackItems: string;
  trackKey: string;
  trackFields: string;
  firstRun: "baseline" | "wake";
  whenAsleep: "skip" | "wake";
}

export function draftFromWatch(watch: RoutineWatchPrecheck | undefined | null): WatchDraft {
  const source = watch?.source;
  const condition = watch?.condition;
  return {
    on: Boolean(watch),
    type: source?.type ?? "files",
    path: source?.type === "files" ? source.path : "",
    recursive: source?.type === "files" ? source.recursive === true : false,
    command: source?.type === "command" ? source.command : "",
    tool: source?.type === "tool" ? source.tool : "",
    args: source?.type === "tool" && source.args && Object.keys(source.args).length ? JSON.stringify(source.args, null, 2) : "",
    condition: condition?.test ?? "none",
    conditionPath: condition?.test === "json_path" ? condition.path : "",
    conditionOp: condition?.test === "json_path" ? condition.op : "eq",
    conditionValue: condition?.test === "json_path" && condition.value !== undefined ? String(condition.value) : "",
    containsText: condition?.test === "contains" ? condition.text : "",
    containsNegate: condition?.test === "contains" ? condition.negate === true : false,
    exitOp: condition?.test === "exit_code" ? condition.op : "ne",
    exitValue: condition?.test === "exit_code" ? String(condition.value) : "0",
    wakeOn: watch?.wakeOn ?? "change",
    trackItems: watch?.track?.items ?? "",
    trackKey: watch?.track?.key ?? "",
    trackFields: watch?.track?.fields?.join(", ") ?? "",
    firstRun: watch?.firstRun ?? "baseline",
    whenAsleep: watch?.whenAsleep ?? "skip",
  };
}

/** A typed value from the field: a number or a boolean when it reads as one. */
function typedValue(text: string): string | number | boolean {
  const trimmed = text.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return text;
}

/** The watch the draft says, or an error key when it is not complete. */
export function watchFromDraft(draft: WatchDraft): { watch: RoutineWatchPrecheck | null } | { error: LocaleKey } {
  if (!draft.on) return { watch: null };
  let source: RoutineWatchPrecheck["source"];
  if (draft.type === "files") {
    if (/(^|\/)\.\.(\/|$)/.test(draft.path) || draft.path.trim().startsWith("/")) return { error: "routineWatch.errorPath" };
    source = { type: "files", path: draft.path.trim(), ...(draft.recursive ? { recursive: true } : {}) };
  } else if (draft.type === "command") {
    if (!draft.command.trim()) return { error: "routineWatch.errorCommand" };
    source = { type: "command", command: draft.command.trim() };
  } else {
    if (!draft.tool.trim()) return { error: "routineWatch.errorTool" };
    let args: Record<string, unknown> | undefined;
    if (draft.args.trim()) {
      try {
        const parsed = JSON.parse(draft.args) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: "routineWatch.errorArgs" };
        args = parsed as Record<string, unknown>;
      } catch {
        return { error: "routineWatch.errorArgs" };
      }
    }
    source = { type: "tool", tool: draft.tool.trim(), ...(args ? { args } : {}) };
  }
  let condition: RoutineWatchCondition | undefined;
  if (draft.condition === "json_path") {
    if (!draft.conditionPath.trim()) return { error: "routineWatch.errorConditionPath" };
    condition = { test: "json_path", path: draft.conditionPath.trim(), op: draft.conditionOp, ...(draft.conditionOp === "exists" ? {} : { value: typedValue(draft.conditionValue) }) };
  } else if (draft.condition === "contains") {
    if (!draft.containsText.trim()) return { error: "routineWatch.errorContains" };
    condition = { test: "contains", text: draft.containsText, ...(draft.containsNegate ? { negate: true } : {}) };
  } else if (draft.condition === "exit_code" && draft.type === "command") {
    condition = { test: "exit_code", op: draft.exitOp, value: Math.max(0, Math.min(255, Math.round(Number(draft.exitValue) || 0))) };
  }
  const fields = draft.trackFields.split(",").map((field) => field.trim()).filter(Boolean);
  const track = draft.type !== "files" && (draft.trackItems.trim() || draft.trackKey.trim() || fields.length)
    ? { ...(draft.trackItems.trim() ? { items: draft.trackItems.trim() } : {}), ...(draft.trackKey.trim() ? { key: draft.trackKey.trim() } : {}), ...(fields.length ? { fields } : {}) }
    : undefined;
  return {
    watch: {
      kind: "watch",
      source,
      ...(condition && draft.wakeOn === "match" ? { wakeOn: "match" as const } : {}),
      ...(condition ? { condition } : {}),
      ...(track ? { track } : {}),
      ...(draft.firstRun === "wake" ? { firstRun: "wake" as const } : {}),
      ...(draft.whenAsleep === "wake" && draft.type !== "tool" ? { whenAsleep: "wake" as const } : {}),
    },
  };
}

type CheckAnswer =
  | { ok: true; skipped: string }
  | { ok: true; summary: string; excerpt: string; items: number; condition?: { holds: boolean; seen: string }; ms: number }
  | { ok: false; error: string };

const INPUT = "rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong";
const OPS_LABEL: Record<RoutineWatchOp, string> = { eq: "=", ne: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤", contains: "∋", exists: "∃" };

export function WatchFields({ draft, onChange, botId, routineId, runOn }: {
  draft: WatchDraft;
  onChange: (draft: WatchDraft) => void;
  botId: string;
  routineId?: string;
  runOn?: string;
}) {
  const [checking, setChecking] = useState(false);
  const [answer, setAnswer] = useState<CheckAnswer | null>(null);
  const set = (patch: Partial<WatchDraft>) => { setAnswer(null); onChange({ ...draft, ...patch }); };
  const built = watchFromDraft(draft);
  const check = async () => {
    if (!("watch" in built) || !built.watch) return;
    setChecking(true);
    try {
      setAnswer(await api("/api/routines/watch-check", {
        method: "POST",
        body: JSON.stringify({ botId, precheck: built.watch, ...(routineId ? { routineId } : {}), ...(runOn ? { runOn } : {}) }),
      }) as CheckAnswer);
    } catch (cause) {
      setAnswer({ ok: false, error: readableError(cause) });
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className="rounded-xl border border-hairline/40 bg-inset/40 px-3 py-2.5" data-testid="routine-watch">
      <label className="flex items-start gap-2 text-[12.5px] text-ink">
        <input type="checkbox" checked={draft.on} onChange={(event) => set({ on: event.target.checked })} className="mt-0.5" />
        <span>
          <span className="block font-medium">{t("routineWatch.title")}</span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-secondary">{t("routineWatch.help", { minutes: ROUTINE_WATCH_LIMITS.minIntervalMinutes })}</span>
        </span>
      </label>
      {draft.on && <div className="mt-3 space-y-3 border-t border-hairline/35 pt-3">
        <div role="radiogroup" aria-label={t("routineWatch.sourceLabel")} className="grid gap-2 sm:grid-cols-3">
          {(["files", "command", "tool"] as const).map((type) => (
            <button key={type} type="button" role="radio" aria-checked={draft.type === type} onClick={() => set({ type, ...(type !== "command" && draft.condition === "exit_code" ? { condition: "none" as const } : {}) })}
              className={cn("rounded-lg border px-3 py-2 text-left", draft.type === type ? "border-accent/60 bg-accent/[0.08]" : "border-border hover:bg-ink/[0.03]")}>
              <span className="block text-[12px] font-medium text-ink">{t(`routineWatch.source.${type}` as LocaleKey)}</span>
              <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-secondary">{t(`routineWatch.source.${type}Help` as LocaleKey)}</span>
            </button>
          ))}
        </div>
        {draft.type === "files" && <div className="space-y-2">
          <label className="flex flex-wrap items-center gap-2 text-[12px] text-ink">
            <span>{t("routineWatch.path")}</span>
            <input aria-label={t("routineWatch.path")} value={draft.path} onChange={(event) => set({ path: event.target.value })} placeholder={t("routineWatch.pathPlaceholder")} className={cn(INPUT, "min-w-0 flex-1")} />
          </label>
          <label className="flex items-center gap-2 text-[12px] text-ink">
            <input type="checkbox" checked={draft.recursive} onChange={(event) => set({ recursive: event.target.checked })} />
            <span>{t("routineWatch.recursive", { depth: ROUTINE_WATCH_LIMITS.maxDepth })}</span>
          </label>
        </div>}
        {draft.type === "command" && <label className="block text-[12px] text-ink">
          <span className="mb-1 block">{t("routineWatch.command")}</span>
          <input aria-label={t("routineWatch.command")} value={draft.command} onChange={(event) => set({ command: event.target.value })} placeholder="git status --short" className={cn(INPUT, "w-full font-mono")} />
        </label>}
        {draft.type === "tool" && <div className="space-y-2">
          <label className="block text-[12px] text-ink">
            <span className="mb-1 block">{t("routineWatch.tool")}</span>
            <input aria-label={t("routineWatch.tool")} value={draft.tool} onChange={(event) => set({ tool: event.target.value })} placeholder="server__search_items" className={cn(INPUT, "w-full font-mono")} />
          </label>
          <label className="block text-[12px] text-ink">
            <span className="mb-1 block">{t("routineWatch.args")}</span>
            <textarea aria-label={t("routineWatch.args")} value={draft.args} onChange={(event) => set({ args: event.target.value })} rows={3} placeholder={'{ "status": "open" }'} className={cn(INPUT, "w-full font-mono")} />
          </label>
        </div>}
        <p className="text-[10.5px] leading-relaxed text-ink-secondary">{t(`routineWatch.where.${draft.type}` as LocaleKey, { kb: Math.round(ROUTINE_WATCH_LIMITS.maxOutputBytes / 1024), files: ROUTINE_WATCH_LIMITS.maxFiles, seconds: Math.round(ROUTINE_WATCH_LIMITS.timeoutMs / 1000) })}</p>

        <div className="space-y-2">
          <label className="flex flex-wrap items-center gap-2 text-[12px] text-ink">
            <span>{t("routineWatch.condition")}</span>
            <select aria-label={t("routineWatch.condition")} value={draft.condition} onChange={(event) => set({ condition: event.target.value as WatchConditionChoice })} className={INPUT}>
              <option value="none">{t("routineWatch.condition.none")}</option>
              <option value="json_path">{t(draft.type === "files" ? "routineWatch.condition.filesValue" : "routineWatch.condition.jsonPath")}</option>
              {draft.type !== "files" && <option value="contains">{t("routineWatch.condition.contains")}</option>}
              {draft.type === "command" && <option value="exit_code">{t("routineWatch.condition.exitCode")}</option>}
            </select>
          </label>
          {draft.condition === "json_path" && <div className="flex flex-wrap items-center gap-2">
            <input aria-label={t("routineWatch.conditionPath")} value={draft.conditionPath} onChange={(event) => set({ conditionPath: event.target.value })} placeholder={draft.type === "files" ? "count" : "$.items.length"} className={cn(INPUT, "w-44 font-mono")} />
            <select aria-label={t("routineWatch.conditionOp")} value={draft.conditionOp} onChange={(event) => set({ conditionOp: event.target.value as RoutineWatchOp })} className={INPUT}>
              {ROUTINE_WATCH_OPS.map((op) => <option key={op} value={op}>{OPS_LABEL[op]} {t(`routineWatch.op.${op}` as LocaleKey)}</option>)}
            </select>
            {draft.conditionOp !== "exists" && <input aria-label={t("routineWatch.conditionValue")} value={draft.conditionValue} onChange={(event) => set({ conditionValue: event.target.value })} className={cn(INPUT, "w-32")} />}
          </div>}
          {draft.condition === "contains" && <div className="flex flex-wrap items-center gap-2">
            <select aria-label={t("routineWatch.containsMode")} value={draft.containsNegate ? "lacks" : "has"} onChange={(event) => set({ containsNegate: event.target.value === "lacks" })} className={INPUT}>
              <option value="has">{t("routineWatch.contains.has")}</option>
              <option value="lacks">{t("routineWatch.contains.lacks")}</option>
            </select>
            <input aria-label={t("routineWatch.containsText")} value={draft.containsText} onChange={(event) => set({ containsText: event.target.value })} className={cn(INPUT, "min-w-0 flex-1")} />
          </div>}
          {draft.condition === "exit_code" && <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink">
            <select aria-label={t("routineWatch.conditionOp")} value={draft.exitOp} onChange={(event) => set({ exitOp: event.target.value === "eq" ? "eq" : "ne" })} className={INPUT}>
              <option value="ne">{t("routineWatch.exit.ne")}</option>
              <option value="eq">{t("routineWatch.exit.eq")}</option>
            </select>
            <input aria-label={t("routineWatch.conditionValue")} inputMode="numeric" value={draft.exitValue} onChange={(event) => set({ exitValue: event.target.value })} className={cn(INPUT, "w-16")} />
          </div>}
          {draft.condition !== "none" && <label className="flex flex-wrap items-center gap-2 text-[12px] text-ink">
            <span>{t("routineWatch.wakeOn")}</span>
            <select aria-label={t("routineWatch.wakeOn")} value={draft.wakeOn} onChange={(event) => set({ wakeOn: event.target.value === "match" ? "match" : "change" })} className={INPUT}>
              <option value="change">{t("routineWatch.wakeOn.change")}</option>
              <option value="match">{t("routineWatch.wakeOn.match")}</option>
            </select>
          </label>}
        </div>

        {draft.type !== "files" && <details className="text-[12px] text-ink" open={Boolean(draft.trackItems || draft.trackKey || draft.trackFields)}>
          <summary className="cursor-pointer select-none text-[11.5px] font-medium text-ink-secondary hover:text-ink">{t("routineWatch.track")}</summary>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-secondary">{t("routineWatch.trackHelp")}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <input aria-label={t("routineWatch.trackItems")} value={draft.trackItems} onChange={(event) => set({ trackItems: event.target.value })} placeholder={t("routineWatch.trackItemsPlaceholder")} className={cn(INPUT, "font-mono")} />
            <input aria-label={t("routineWatch.trackKey")} value={draft.trackKey} onChange={(event) => set({ trackKey: event.target.value })} placeholder={t("routineWatch.trackKeyPlaceholder")} className={cn(INPUT, "font-mono")} />
            <input aria-label={t("routineWatch.trackFields")} value={draft.trackFields} onChange={(event) => set({ trackFields: event.target.value })} placeholder={t("routineWatch.trackFieldsPlaceholder")} className={cn(INPUT, "font-mono")} />
          </div>
        </details>}

        <div className={cn("grid gap-2", draft.type !== "tool" && "sm:grid-cols-2")}>
          <label className="block text-[12px] text-ink">
            <span className="mb-1 block">{t("routineWatch.firstRun")}</span>
            <select aria-label={t("routineWatch.firstRun")} value={draft.firstRun} onChange={(event) => set({ firstRun: event.target.value === "wake" ? "wake" : "baseline" })} className={cn(INPUT, "w-full")}>
              <option value="baseline">{t("routineWatch.firstRun.baseline")}</option>
              <option value="wake">{t("routineWatch.firstRun.wake")}</option>
            </select>
          </label>
          {draft.type !== "tool" && <label className="block text-[12px] text-ink">
            <span className="mb-1 block">{t("routineWatch.whenAsleep")}</span>
            <select aria-label={t("routineWatch.whenAsleep")} value={draft.whenAsleep} onChange={(event) => set({ whenAsleep: event.target.value === "wake" ? "wake" : "skip" })} className={cn(INPUT, "w-full")}>
              <option value="skip">{t("routineWatch.whenAsleep.skip")}</option>
              <option value="wake">{t("routineWatch.whenAsleep.wake")}</option>
            </select>
          </label>}
        </div>
        {draft.type !== "tool" && draft.whenAsleep === "wake" && <p className="text-[10.5px] leading-relaxed text-warning">{t("routineWatch.whenAsleep.wakeCost")}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void check()} disabled={checking || !("watch" in built) || !botId} className="rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-ink/[0.04] disabled:opacity-50">
            {checking ? t("routineWatch.checking") : t("routineWatch.checkNow")}
          </button>
          {"error" in built && <span className="text-[11px] text-danger">{t(built.error)}</span>}
        </div>
        {answer && <div className="rounded-lg border border-hairline/50 bg-elevated px-3 py-2 text-[11.5px] text-ink" role="status">
          {!answer.ok ? <span className="text-danger">{answer.error}</span>
            : "skipped" in answer ? <span className="text-ink-secondary">{answer.skipped}</span>
            : <>
              <div className="font-medium">{t("routineWatch.checked", { summary: answer.summary, ms: answer.ms })}</div>
              {answer.condition && <div className={answer.condition.holds ? "text-success" : "text-ink-secondary"}>{t(answer.condition.holds ? "routineWatch.conditionHolds" : "routineWatch.conditionNotHolds", { seen: answer.condition.seen })}</div>}
              {answer.excerpt && <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] text-ink-secondary">{answer.excerpt}</pre>}
            </>}
        </div>}
      </div>}
    </div>
  );
}
