// The Code section's data (server/routes/code.ts): the person's Perspicax
// runs, one run's events (with a live stream), its diff, commits and files.
// Pure helpers (grouping, ages, the timeline fold) are exported for tests.
import { useEffect, useState } from "react";

import { RUN_ACTIVE_STATES, RUN_WORKING_STATES, runPr, type CloudAgentPr } from "../../shared/cloud-agents.ts";
import type {
  CodeArtifact,
  CodeCommit,
  CodeEnvironment,
  CodeEvent,
  CodeFileEntry,
  CodeRun,
  CodeStatus,
  DiffFile,
  FollowUpMode,
} from "../../shared/code-runs.ts";
import { api } from "@/state/store";

export type { CodeRun, CodeEvent, CodeEnvironment, CodeStatus, DiffFile, CodeCommit, CodeFileEntry, FollowUpMode };

const enc = encodeURIComponent;

export const loadCodeStatus = () => api<CodeStatus>("/api/code/status");
export const loadCodeEnvironments = async () => (await api<{ items: CodeEnvironment[] }>("/api/code/environments")).items;
export const loadCodeRuns = async () => (await api<{ items: CodeRun[] }>("/api/code/runs")).items;
export const loadCodeRun = async (id: string) => (await api<{ item: CodeRun }>(`/api/code/runs/${enc(id)}`)).item;
export const loadRunEvents = async (id: string, after = 0) => (await api<{ items: CodeEvent[] }>(`/api/code/runs/${enc(id)}/events?after=${after}`)).items;
export const loadRunDiff = (id: string) => api<CodeArtifact<DiffFile>>(`/api/code/runs/${enc(id)}/diff`);
export const loadRunCommits = (id: string) => api<CodeArtifact<CodeCommit>>(`/api/code/runs/${enc(id)}/commits`);
export const loadRunFiles = (id: string) => api<CodeArtifact<CodeFileEntry>>(`/api/code/runs/${enc(id)}/files`);

export async function launchCodeRun(input: { env_id: string; prompt: string; engine?: string; model?: string }): Promise<CodeRun> {
  return (await api<{ item: CodeRun }>("/api/code/runs", { method: "POST", body: JSON.stringify(input) })).item;
}

const action = async (id: string, verb: string, body: unknown = {}) =>
  (await api<{ item: CodeRun }>(`/api/code/runs/${enc(id)}/${verb}`, { method: "POST", body: JSON.stringify(body) })).item;
export const markRunRead = (id: string) => action(id, "read");
export const followUpRun = (id: string, text: string, mode: FollowUpMode) => action(id, "followup", { text, mode });
export const approveRun = (id: string, approvalId: string, option: string) => action(id, "approve", { approval_id: approvalId, option });
export const stopRun = (id: string) => action(id, "stop");
export const archiveRun = (id: string) => action(id, "archive");

/** Whether the section can reach Perspicax, read once per mount. */
/** The status is shared by the sidebar row and the page, and kept a few
 * minutes: a Perspicax without the agents API is asked once, not on every
 * render or page visit. */
const STATUS_TTL_MS = 5 * 60_000;
let statusCache: { at: number; value: Promise<CodeStatus> } | null = null;

export function codeStatusOnce(load: () => Promise<CodeStatus> = loadCodeStatus, now = Date.now()): Promise<CodeStatus> {
  if (statusCache && now - statusCache.at < STATUS_TTL_MS) return statusCache.value;
  const value = load().catch((): CodeStatus => ({ available: false, reason: "unreachable" }));
  statusCache = { at: now, value };
  return value;
}

/** Tests only. */
export function resetCodeStatusCache() {
  statusCache = null;
}

/** The address that opens the Code section (`#code`, or `#code/<run>` for
 * one run): the menus no longer list it. Never `#code=…`, a pairing link. */
export function codeHashTarget(hash: string): { runId?: string } | null {
  const match = /^#code(?:\/([A-Za-z0-9_-]{1,128}))?$/.exec(hash);
  if (!match) return null;
  return match[1] ? { runId: match[1] } : {};
}

export function useCodeStatus(): CodeStatus | null {
  const [status, setStatus] = useState<CodeStatus | null>(null);
  useEffect(() => {
    let live = true;
    void codeStatusOnce().then((value) => { if (live) setStatus(value); });
    return () => { live = false; };
  }, []);
  return status;
}

/** Read the run's live events (Sagax relays Perspicax's SSE). Calls `onEvent`
 * for each new one; reconnects from the last `seq` after a drop while
 * `keepGoing()` says so (the run still works), until `signal` aborts. A 4xx
 * answer (refused, gone) ends it. Uses fetch, so the session cookie applies
 * as for `api()`. */
export async function followRunEvents(id: string, after: number, onEvent: (event: CodeEvent) => void, signal: AbortSignal, keepGoing: () => boolean = () => true): Promise<void> {
  let cursor = after;
  let backoff = 1_000;
  while (!signal.aborted) {
    try {
      const res = await fetch(`/api/code/runs/${enc(id)}/stream?after=${cursor}`, { signal, headers: { accept: "text/event-stream" } });
      if (res.status >= 400 && res.status < 500) return;
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
      backoff = 1_000;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
          if (!data) continue;
          try {
            const event = JSON.parse(data) as CodeEvent;
            if (typeof event.seq === "number" && event.seq > cursor) {
              cursor = event.seq;
              onEvent(event);
            }
          } catch {}
        }
      }
    } catch {
      if (signal.aborted) return;
    }
    if (signal.aborted || !keepGoing()) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, backoff);
      function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
      signal.addEventListener("abort", done, { once: true });
    });
    if (signal.aborted) return;
    backoff = Math.min(backoff * 2, 15_000);
  }
}

// ------------------------------------------------------------------ helpers

export function runActive(run: Pick<CodeRun, "state">): boolean {
  return RUN_ACTIVE_STATES.has(run.state);
}

export function runWorking(run: Pick<CodeRun, "state">): boolean {
  return RUN_WORKING_STATES.has(run.state);
}

export function runPrOf(run: Pick<CodeRun, "pr">): CloudAgentPr | undefined {
  return runPr(run);
}

export type RunBucket = "today" | "week" | "older";

/** Today (since local midnight), this week (the last 7 days), or older. */
export function runBucket(updatedAt: number, now: number): RunBucket {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  if (updatedAt >= midnight.getTime()) return "today";
  if (updatedAt >= now - 7 * 86_400_000) return "week";
  return "older";
}

/** "now", "5 min", "3 h", "2 j", "3 sem." style compact age (localized by the caller's units). */
export function compactAge(ms: number, now: number): { n: number; unit: "now" | "min" | "h" | "d" | "w" } {
  const s = Math.max(0, now - ms) / 1000;
  if (s < 60) return { n: 0, unit: "now" };
  if (s < 3600) return { n: Math.floor(s / 60), unit: "min" };
  if (s < 86_400) return { n: Math.floor(s / 3600), unit: "h" };
  if (s < 14 * 86_400) return { n: Math.floor(s / 86_400), unit: "d" };
  return { n: Math.floor(s / (7 * 86_400)), unit: "w" };
}

/** Minutes the run worked: from its start to its end (or now while it works). */
export function workedMinutes(run: Pick<CodeRun, "started_at" | "ended_at" | "created_at">, now: number): number {
  const start = Date.parse(run.started_at ?? run.created_at);
  const end = run.ended_at ? Date.parse(run.ended_at) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60_000));
}

/** One row of the run's conversation (RunTimeline). */
export type TimelineItem =
  | { kind: "task"; seq: number; at: string; text: string }
  | { kind: "followup"; seq: number; at: string; text: string; mode: string }
  | { kind: "message"; seq: number; at: string; text: string }
  | { kind: "tools"; seq: number; at: string; calls: { id: string; name: string; summary: string; ok?: boolean; output?: string }[] }
  | { kind: "approval"; seq: number; at: string; approvalId: string; title: string; detail?: string; options: string[]; answer?: string }
  | { kind: "verify"; seq: number; at: string; passed: number; failed: number; commands: { cmd: string; ok: boolean; tail?: string }[] }
  | { kind: "pr"; seq: number; at: string; number: number; url: string; state: string }
  | { kind: "status"; seq: number; at: string; text: string }
  | { kind: "warning"; seq: number; at: string; text: string; details?: string };

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Fold the run's raw events into conversation rows: consecutive tool calls
 * become one folded group, a tool result attaches to its call, an approval
 * carries the answer given later. State changes leave no row. */
export function timelineItems(events: readonly CodeEvent[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  const approvals = new Map<string, Extract<TimelineItem, { kind: "approval" }>>();
  for (const event of events) {
    const p = event.payload ?? {};
    const base = { seq: event.seq, at: event.at };
    switch (event.kind) {
      case "requested":
        out.push({ kind: "task", ...base, text: text(p.prompt) });
        break;
      case "followup":
        out.push({ kind: "followup", ...base, text: text(p.text), mode: text(p.mode) || "queue" });
        break;
      case "message":
        if (p.role === "user") out.push({ kind: "followup", ...base, text: text(p.text), mode: "queue" });
        else if (text(p.text)) out.push({ kind: "message", ...base, text: text(p.text) });
        break;
      case "tool_call": {
        const last = out.at(-1);
        // Runner protocol: `{id, name, input_summary}`.
        const call = { id: text(p.id) || String(event.seq), name: text(p.name) || "tool", summary: text(p.input_summary) || text(p.summary) };
        if (last?.kind === "tools") last.calls.push(call);
        else out.push({ kind: "tools", ...base, calls: [call] });
        break;
      }
      case "tool_result": {
        for (let i = out.length - 1; i >= 0; i--) {
          const row = out[i]!;
          if (row.kind !== "tools") continue;
          const call = row.calls.find((c) => c.id === text(p.id)) ?? row.calls.at(-1);
          if (call) { call.ok = p.ok !== false; call.output = text(p.output_summary) || text(p.output); }
          break;
        }
        break;
      }
      case "approval": {
        // Runner protocol: `{approval_id, title, detail, choices}`.
        const raw = Array.isArray(p.choices) ? p.choices : Array.isArray(p.options) ? p.options : [];
        const options = raw.filter((o): o is string => typeof o === "string");
        const row = { kind: "approval" as const, ...base, approvalId: text(p.approval_id), title: text(p.title), ...(text(p.detail) ? { detail: text(p.detail) } : {}), options };
        approvals.set(row.approvalId, row);
        out.push(row);
        break;
      }
      case "approval_answer": {
        const row = approvals.get(text(p.approval_id));
        if (row) row.answer = text(p.option);
        break;
      }
      case "pr":
        if (typeof p.number === "number" && text(p.url).startsWith("https://")) out.push({ kind: "pr", ...base, number: p.number, url: text(p.url), state: text(p.state) });
        break;
      case "status":
        if (text(p.text)) out.push({ kind: "status", ...base, text: text(p.text) });
        break;
      case "verify": {
        const commands = (Array.isArray(p.commands) ? p.commands : []).flatMap((row) => {
          if (!row || typeof row !== "object") return [];
          const c = row as Record<string, unknown>;
          return [{ cmd: text(c.cmd), ok: c.ok === true, ...(text(c.tail) ? { tail: text(c.tail) } : {}) }];
        });
        if (commands.length) {
          const passed = commands.filter((c) => c.ok).length;
          out.push({ kind: "verify", ...base, passed, failed: commands.length - passed, commands });
        }
        break;
      }
      case "warning":
        if (text(p.text)) out.push({ kind: "warning", ...base, text: text(p.text), ...(text(p.details) ? { details: text(p.details) } : {}) });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Merge a fresh event into a list kept sorted by seq, without duplicates. */
export function mergeEvents(list: readonly CodeEvent[], incoming: readonly CodeEvent[]): CodeEvent[] {
  const bySeq = new Map(list.map((event) => [event.seq, event]));
  for (const event of incoming) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** Daily ok/fail counts of the last `days` days, oldest first (MiniBars). */
export function dailyOutcomes(runs: readonly Pick<CodeRun, "state" | "created_at">[], now: number, days = 7): { day: number; ok: number; fail: number }[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const rows = Array.from({ length: days }, (_, i) => ({ day: midnight.getTime() - (days - 1 - i) * 86_400_000, ok: 0, fail: 0 }));
  for (const run of runs) {
    const at = Date.parse(run.created_at);
    const row = rows.find((r) => at >= r.day && at < r.day + 86_400_000);
    if (!row) continue;
    if (run.state === "failed" || run.state === "expired") row.fail += 1;
    else if (run.state === "finished" || run.state === "idle") row.ok += 1;
  }
  return rows;
}
