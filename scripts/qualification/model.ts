// Result model, metrics and report rendering of the reliability
// qualification harness (docs/plans/grok-convergence-qualification/README.md).
// Pure functions only: no server, no clock, no files, so the numbers a report
// states can be checked by a unit test.

export const REPORT_SCHEMA = 1;

export type EngineKind = "fake" | "real" | "grok-manual";
export type TaskStatus = "completed" | "failed" | "skipped" | "error";
export type RestartRecovery = "recovered" | "not-recovered" | "n/a";

/** One task, as recorded by the runner or typed by hand for Grok Bot. */
export interface TaskRecord {
  id: string;
  category: string;
  title: string;
  engine: EngineKind;
  status: TaskStatus;
  /** The task reached its terminal or explicit waiting state with the expected result. */
  completed: boolean;
  /** Sends the server acknowledged (HTTP 202) that this task made. */
  acceptedSends: number;
  /** Accepted sends whose words never reached an engine, nor the thread. */
  lostAccepted: number;
  /** A reply the person saw twice (same request answered by two replies). */
  duplicateReplies: number;
  /** A request given to an engine more than once. */
  duplicateDispatches: number;
  restartRecovery: RestartRecovery;
  /** A bot still busy (or a queue still holding words) after the settle window. */
  stuck: boolean;
  /** Milliseconds from the send to the first streamed or whole reply text. null when not measured. */
  ttftMs: number | null;
  /** Milliseconds from the send to the last reply of the task. null when not measured. */
  finalMs: number | null;
  /** The two latencies above carry no deliberate hold (gate, sleep, restart) and join p50/p95. */
  timed: boolean;
  wallMs: number;
  /** Every latency sample of the task (one per timed send); ttftMs and finalMs are its worst. */
  samples: Array<{ ttftMs: number | null; finalMs: number | null }>;
  /** What failed, one precise line each. Empty for a clean task. */
  defects: string[];
  notes: string[];
  skipReason?: string;
}

export interface Percentiles { n: number; p50: number | null; p95: number | null }

export interface Summary {
  tasks: number;
  run: number;
  skipped: number;
  completed: number;
  completionRate: number | null;
  lostAccepted: number;
  duplicateReplies: number;
  duplicateDispatches: number;
  restartTasks: number;
  restartRecovered: number;
  restartRecoveryRate: number | null;
  stuck: number;
  ttft: Percentiles;
  final: Percentiles;
  byCategory: Record<string, { run: number; completed: number; ttft: Percentiles; final: Percentiles }>;
}

export interface RunReport {
  schema: typeof REPORT_SCHEMA;
  corpusVersion: string;
  engine: EngineKind;
  /** Free text: what answered ("fake claude CLI, fixture", "Grok Bot 0.x, manual, device X"). */
  engineLabel: string;
  startedAt: string;
  finishedAt: string;
  revision: string;
  node: string;
  tasks: TaskRecord[];
  summary: Summary;
}

/** Nearest-rank percentile, the usual definition for small samples. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

const rounded = (value: number | null) => (value === null ? null : Math.round(value));

function percentiles(values: number[]): Percentiles {
  return { n: values.length, p50: rounded(percentile(values, 50)), p95: rounded(percentile(values, 95)) };
}

const timedValues = (tasks: TaskRecord[], key: "ttftMs" | "finalMs") =>
  tasks.filter((task) => task.timed && task.status === "completed").flatMap((task) => {
    // A manual record has no samples: its two numbers are its one sample.
    const samples = task.samples.length ? task.samples : [{ ttftMs: task.ttftMs, finalMs: task.finalMs }];
    return samples.map((sample) => sample[key]).filter((value): value is number => value !== null);
  });

export function summarize(tasks: TaskRecord[]): Summary {
  const run = tasks.filter((task) => task.status !== "skipped");
  const completed = run.filter((task) => task.completed && task.status === "completed");
  const restart = run.filter((task) => task.restartRecovery !== "n/a");
  const categories = [...new Set(run.map((task) => task.category))].sort();
  const byCategory: Summary["byCategory"] = {};
  for (const category of categories) {
    const inCategory = run.filter((task) => task.category === category);
    byCategory[category] = {
      run: inCategory.length,
      completed: inCategory.filter((task) => task.completed && task.status === "completed").length,
      ttft: percentiles(timedValues(inCategory, "ttftMs")),
      final: percentiles(timedValues(inCategory, "finalMs")),
    };
  }
  const sum = (key: "lostAccepted" | "duplicateReplies" | "duplicateDispatches") =>
    run.reduce((total, task) => total + task[key], 0);
  return {
    tasks: tasks.length,
    run: run.length,
    skipped: tasks.length - run.length,
    completed: completed.length,
    completionRate: run.length ? completed.length / run.length : null,
    lostAccepted: sum("lostAccepted"),
    duplicateReplies: sum("duplicateReplies"),
    duplicateDispatches: sum("duplicateDispatches"),
    restartTasks: restart.length,
    restartRecovered: restart.filter((task) => task.restartRecovery === "recovered").length,
    restartRecoveryRate: restart.length ? restart.filter((task) => task.restartRecovery === "recovered").length / restart.length : null,
    stuck: run.filter((task) => task.stuck).length,
    ttft: percentiles(timedValues(run, "ttftMs")),
    final: percentiles(timedValues(run, "finalMs")),
    byCategory,
  };
}

export function buildReport(input: Omit<RunReport, "schema" | "summary">): RunReport {
  return { schema: REPORT_SCHEMA, ...input, summary: summarize(input.tasks) };
}

/** A blank record, for a skipped or manually recorded task. */
export function blankRecord(base: Pick<TaskRecord, "id" | "category" | "title" | "engine">): TaskRecord {
  return {
    ...base, status: "skipped", completed: false, acceptedSends: 0, lostAccepted: 0, duplicateReplies: 0,
    duplicateDispatches: 0, restartRecovery: "n/a", stuck: false, ttftMs: null, finalMs: null, timed: false,
    wallMs: 0, samples: [], defects: [], notes: [],
  };
}

// ---- rendering ----

const pct = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const ms = (value: number | null) => (value === null ? "n/a" : `${value} ms`);
const cell = (text: string) => text.replace(/\|/g, "/").replace(/\n/g, " ");

export function renderReport(report: RunReport): string {
  const s = report.summary;
  const lines: string[] = [];
  lines.push(`# Qualification report: ${report.engineLabel}`, "");
  lines.push(`Corpus v${report.corpusVersion}, engine kind \`${report.engine}\`, revision \`${report.revision}\`, node ${report.node}.`);
  lines.push(`Started ${report.startedAt}, finished ${report.finishedAt}.`, "");
  lines.push("## Summary", "");
  lines.push("| Metric | Value |", "|---|---|");
  lines.push(`| Tasks run (skipped) | ${s.run} (${s.skipped}) |`);
  lines.push(`| Completion rate | ${pct(s.completionRate)} (${s.completed}/${s.run}) |`);
  lines.push(`| Lost accepted messages | ${s.lostAccepted} |`);
  lines.push(`| Duplicate replies | ${s.duplicateReplies} |`);
  lines.push(`| Duplicate dispatches | ${s.duplicateDispatches} |`);
  lines.push(`| Restart recovery | ${pct(s.restartRecoveryRate)} (${s.restartRecovered}/${s.restartTasks}) |`);
  lines.push(`| Stuck states | ${s.stuck} |`);
  lines.push(`| Time to first token p50 / p95 | ${ms(s.ttft.p50)} / ${ms(s.ttft.p95)} (n=${s.ttft.n} samples) |`);
  lines.push(`| Time to final reply p50 / p95 | ${ms(s.final.p50)} / ${ms(s.final.p95)} (n=${s.final.n} samples) |`);
  lines.push("", "Latency counts only tasks without a deliberate hold (gate, wait for a restart).", "");
  lines.push("## By category", "");
  lines.push("| Category | Run | Completed | First token p50 / p95 | Final p50 / p95 |", "|---|---|---|---|---|");
  for (const [category, c] of Object.entries(s.byCategory)) {
    lines.push(`| ${category} | ${c.run} | ${c.completed} | ${ms(c.ttft.p50)} / ${ms(c.ttft.p95)} | ${ms(c.final.p50)} / ${ms(c.final.p95)} |`);
  }
  lines.push("", "## Tasks", "");
  lines.push("| Id | Category | Status | Lost | Dup reply | Dup dispatch | Restart | First token | Final | Notes |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const task of report.tasks) {
    const note = task.status === "skipped" ? `skipped: ${task.skipReason ?? ""}` : [...task.defects.map((d) => `DEFECT ${d}`), ...task.notes].join("; ");
    lines.push(`| ${task.id} | ${task.category} | ${task.status}${task.stuck ? " (stuck)" : ""} | ${task.lostAccepted} | ${task.duplicateReplies} | ${task.duplicateDispatches} | ${task.restartRecovery} | ${ms(task.ttftMs)} | ${ms(task.finalMs)} | ${cell(note)} |`);
  }
  const defects = report.tasks.filter((task) => task.defects.length);
  lines.push("", "## Defects", "");
  if (!defects.length) lines.push("None recorded.");
  for (const task of defects) for (const defect of task.defects) lines.push(`- ${task.id}: ${defect}`);
  lines.push("");
  return lines.join("\n");
}

// ---- merging with the manual Grok Bot run ----

export interface Comparison {
  corpusVersion: string;
  sagax: RunReport;
  grok: RunReport;
  /** Corpus versions that differ make the numbers incomparable. */
  comparable: boolean;
}

export function compare(sagax: RunReport, grok: RunReport): Comparison {
  return { corpusVersion: sagax.corpusVersion, sagax, grok, comparable: sagax.corpusVersion === grok.corpusVersion };
}

export function renderComparison(c: Comparison): string {
  const a = c.sagax.summary;
  const b = c.grok.summary;
  const lines: string[] = [];
  lines.push("# Qualification comparison: Sagax and Grok Bot", "");
  if (!c.comparable) {
    lines.push(`WARNING: corpus versions differ (Sagax v${c.sagax.corpusVersion}, Grok Bot v${c.grok.corpusVersion}). Do not compare these numbers.`, "");
  }
  lines.push(`Sagax: ${c.sagax.engineLabel} (${c.sagax.engine}). Grok Bot: ${c.grok.engineLabel} (${c.grok.engine}).`, "");
  lines.push("A manual Grok Bot run measures a person with a stopwatch; compare its latency to the Sagax run on a real engine, never to the fake-engine baseline.", "");
  lines.push("## Summary", "", "| Metric | Sagax | Grok Bot |", "|---|---|---|");
  lines.push(`| Tasks run (skipped) | ${a.run} (${a.skipped}) | ${b.run} (${b.skipped}) |`);
  lines.push(`| Completion rate | ${pct(a.completionRate)} | ${pct(b.completionRate)} |`);
  lines.push(`| Lost accepted messages | ${a.lostAccepted} | ${b.lostAccepted} |`);
  lines.push(`| Duplicate replies | ${a.duplicateReplies} | ${b.duplicateReplies} |`);
  lines.push(`| Duplicate dispatches | ${a.duplicateDispatches} | ${b.duplicateDispatches} |`);
  lines.push(`| Restart recovery | ${pct(a.restartRecoveryRate)} | ${pct(b.restartRecoveryRate)} |`);
  lines.push(`| Stuck states | ${a.stuck} | ${b.stuck} |`);
  lines.push(`| First token p50 / p95 | ${ms(a.ttft.p50)} / ${ms(a.ttft.p95)} | ${ms(b.ttft.p50)} / ${ms(b.ttft.p95)} |`);
  lines.push(`| Final reply p50 / p95 | ${ms(a.final.p50)} / ${ms(a.final.p95)} | ${ms(b.final.p50)} / ${ms(b.final.p95)} |`);
  lines.push("", "## Per task", "", "| Id | Sagax | Grok Bot | Sagax final | Grok final | Grok notes |", "|---|---|---|---|---|---|");
  const grokById = new Map(c.grok.tasks.map((task) => [task.id, task]));
  for (const task of c.sagax.tasks) {
    const other = grokById.get(task.id);
    const state = (t: TaskRecord | undefined) => (!t ? "missing" : t.status === "skipped" ? "skipped" : t.completed ? "ok" : "FAILED");
    lines.push(`| ${task.id} | ${state(task)} | ${state(other)} | ${ms(task.finalMs)} | ${ms(other?.finalMs ?? null)} | ${cell([...(other?.defects ?? []), ...(other?.notes ?? [])].join("; "))} |`);
  }
  lines.push("");
  return lines.join("\n");
}

/** A manual run is read from a person's file: check it before trusting it. */
export function validateManualReport(value: unknown, corpusIds: readonly string[]): string[] {
  const problems: string[] = [];
  const report = value as Partial<RunReport> | null;
  if (!report || typeof report !== "object") return ["not an object"];
  if (report.schema !== REPORT_SCHEMA) problems.push(`schema must be ${REPORT_SCHEMA}`);
  if (typeof report.corpusVersion !== "string") problems.push("corpusVersion missing");
  if (report.engine !== "grok-manual") problems.push("engine must be grok-manual");
  if (!Array.isArray(report.tasks)) return [...problems, "tasks missing"];
  const seen = new Set<string>();
  for (const task of report.tasks) {
    if (!task || typeof task.id !== "string") { problems.push("a task has no id"); continue; }
    if (!corpusIds.includes(task.id)) problems.push(`unknown task ${task.id}`);
    if (seen.has(task.id)) problems.push(`task ${task.id} twice`);
    seen.add(task.id);
    if (!["completed", "failed", "skipped", "error"].includes(task.status)) problems.push(`${task.id}: bad status`);
    for (const key of ["ttftMs", "finalMs"] as const) {
      const v = task[key];
      if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) problems.push(`${task.id}: ${key} must be a number or null`);
    }
  }
  for (const id of corpusIds) if (!seen.has(id)) problems.push(`task ${id} missing`);
  return problems;
}
