// A YAML file of steps that send, wait, ask the person, then continue.
// Nothing here calls a model. Routines (server/routines/routines.ts) are a different
// path and stay as they are. An approval step does not continue until the
// person answers.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import { writeFileAtomic } from "./atomic.ts";

const PRINCIPAL = /^[a-z0-9][a-z0-9_.:-]{0,80}$/;
const NAME = /^[a-z][a-z0-9-]{0,40}$/;
const MAX_STEPS = 30;
const MAX_TEXT = 4_000;

export type WorkflowScope = { organization: false; person?: string } | { organization: true; principalId: string };

/** Finished runs stay readable for an hour, then the clock deletes them.
 * Waiting approvals are kept until the person answers. */
const FINISHED_KEEP_MS = 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 1000;

export type WorkflowStep =
  | { kind: "send"; bot: string; thread: string; text: string }
  | { kind: "wait"; seconds?: number; until?: number }
  | { kind: "approve"; prompt: string; bot?: string; thread?: string };

export interface WorkflowFile {
  name: string;
  steps: WorkflowStep[];
}

export interface WorkflowRun {
  id: string;
  name: string;
  scopeKey: string;
  steps: WorkflowStep[];
  index: number;
  status: "running" | "waiting" | "done" | "stopped";
  /** Set while the current step is an approval that has not been answered. */
  approval?: { prompt: string };
  waitUntil?: number;
  error?: string;
  updatedAt: number;
}

export interface WorkflowEffects {
  now(): number;
  deliver(bot: string, thread: string, text: string): void;
}

/** A stable directory name for one person on a shared server that is not
 * an organization. Hashing keeps the key inside the path rules whatever
 * shape the session key has. */
export function workflowPersonKey(person: string): string {
  return `p${createHash("sha256").update(person).digest("hex").slice(0, 32)}`;
}

export function workflowScope(organization: boolean, principalId: string | null | undefined, person?: string | null): WorkflowScope | null {
  if (!organization) {
    if (person === undefined || person === null || person === "") return { organization: false };
    return { organization: false, person: workflowPersonKey(person) };
  }
  const id = principalId?.trim().toLowerCase() ?? "";
  return PRINCIPAL.test(id) && !id.includes("..") ? { organization: true, principalId: id } : null;
}

export function workflowScopeKey(scope: WorkflowScope): string {
  if (scope.organization) return scope.principalId;
  return scope.person ?? "local";
}

function scopeDir(dataDir: string, scope: WorkflowScope): string {
  return join(dataDir, "workflows", workflowScopeKey(scope));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function oneLineId(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,80}$/.test(value)) return null;
  if (value.includes("..")) return null;
  return value || null;
}

export function parseWorkflowYaml(text: string): WorkflowFile | string {
  if (text.length > 64_000) return "That file is too large.";
  let document: unknown;
  try { document = parseYaml(text); } catch { return "That is not a YAML workflow."; }
  if (!isRecord(document)) return "That is not a YAML workflow.";
  const name = typeof document.name === "string" ? document.name.trim() : "";
  if (!NAME.test(name)) return "name must be 1 to 41 lowercase letters, numbers or hyphens, starting with a letter.";
  if (!Array.isArray(document.steps) || document.steps.length === 0 || document.steps.length > MAX_STEPS) {
    return `steps must be 1 to ${MAX_STEPS} items.`;
  }
  const steps: WorkflowStep[] = [];
  for (const raw of document.steps) {
    if (!isRecord(raw)) return "Each step is send, wait or approve.";
    const keys = Object.keys(raw).filter((key) => key !== "id");
    if (keys.length !== 1) return "Each step is one of send, wait or approve.";
    const kind = keys[0];
    const body = raw[kind!];
    if (!isRecord(body)) return "Each step needs its fields.";
    if (kind === "send") {
      const bot = oneLineId(body.bot);
      const thread = oneLineId(body.thread);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!bot || !thread || !text || text.length > MAX_TEXT) return "send needs bot, thread and text.";
      steps.push({ kind: "send", bot, thread, text });
    } else if (kind === "wait") {
      if (body.seconds !== undefined) {
        const seconds = body.seconds;
        if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) return "wait seconds must be a whole number from 1 to 86400.";
        steps.push({ kind: "wait", seconds });
      } else if (typeof body.until === "string" || typeof body.until === "number") {
        const until = typeof body.until === "number" ? body.until : Date.parse(body.until);
        if (!Number.isFinite(until)) return "wait until must be a time.";
        steps.push({ kind: "wait", until });
      } else return "wait needs seconds or until.";
    } else if (kind === "approve") {
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt || prompt.length > 500) return "approve needs a prompt.";
      const bot = body.bot === undefined ? undefined : oneLineId(body.bot);
      const thread = body.thread === undefined ? undefined : oneLineId(body.thread);
      if (body.bot !== undefined && !bot) return "approve bot is not valid.";
      if (body.thread !== undefined && !thread) return "approve thread is not valid.";
      steps.push({ kind: "approve", prompt, ...(bot ? { bot } : {}), ...(thread ? { thread } : {}) });
    } else return "Each step is one of send, wait or approve.";
  }
  return { name, steps };
}

/** After a clock write fails, skip that run until this delay so it does not
 * repost every tick. Other due runs keep moving. */
export const WORKFLOW_CLOCK_BACKOFF_MS = 60_000;

export class WorkflowStore {
  private readonly dataDir: string;
  /** Clock waits only. Rebuilt once from disk, then updated by writeRun. */
  private waiting = new Map<string, number>();
  /** Run ids that failed a clock write; value is when they may be due again. */
  private failedUntil = new Map<string, number>();
  /** Serializes approval answers for one run so a double click cannot advance twice. */
  private readonly answerLocks = new Map<string, Promise<unknown>>();
  private indexed = false;
  private nextPrune = 0;
  constructor(dataDir: string) { this.dataDir = dataDir; }

  /** One answer at a time per run. The second waiter re-reads and gets 409. */
  withRunLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.answerLocks.get(id) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    const tail = run.catch(() => undefined);
    this.answerLocks.set(id, tail);
    void tail.then(() => { if (this.answerLocks.get(id) === tail) this.answerLocks.delete(id); }).catch(() => {});
    return run;
  }

  /** Keep the run out of `due` until `until` so a failed write cannot spam. */
  suppressDue(id: string, until: number): void {
    this.failedUntil.set(id, until);
  }

  private dir(scope: WorkflowScope): string {
    return scopeDir(this.dataDir, scope);
  }

  save(scope: WorkflowScope, text: string): WorkflowFile | string {
    const parsed = parseWorkflowYaml(text);
    if (typeof parsed === "string") return parsed;
    const path = join(this.dir(scope), `${parsed.name}.yaml`);
    mkdirSync(this.dir(scope), { recursive: true, mode: 0o700 });
    writeFileAtomic(path, text.endsWith("\n") ? text : `${text}\n`, { mode: 0o600 });
    return parsed;
  }

  list(scope: WorkflowScope): string[] {
    try {
      return readdirSync(this.dir(scope)).filter((name) => name.endsWith(".yaml")).map((name) => name.slice(0, -5)).sort();
    } catch {
      return [];
    }
  }

  read(scope: WorkflowScope, name: string): WorkflowFile | null {
    if (!NAME.test(name)) return null;
    const path = join(this.dir(scope), `${name}.yaml`);
    try {
      if (lstatSync(path).isSymbolicLink()) return null;
      const parsed = parseWorkflowYaml(readFileSync(path, "utf8"));
      return typeof parsed === "string" ? null : parsed;
    } catch {
      return null;
    }
  }

  forget(scope: WorkflowScope, name: string): boolean {
    if (!NAME.test(name)) return false;
    const path = join(this.dir(scope), `${name}.yaml`);
    if (lstatOrMissing(path) !== "file") return false;
    rmSync(path, { force: true });
    return true;
  }

  start(scope: WorkflowScope, name: string, now: number): WorkflowRun | string {
    const file = this.read(scope, name);
    if (!file) return "No workflow with that name.";
    const run: WorkflowRun = {
      id: `wf_${randomBytes(8).toString("hex")}`,
      name: file.name,
      scopeKey: workflowScopeKey(scope),
      steps: file.steps,
      index: 0,
      status: "running",
      updatedAt: now,
    };
    this.writeRun(run);
    return run;
  }

  getRun(id: string): WorkflowRun | null {
    if (!/^wf_[a-f0-9]{16}$/.test(id)) return null;
    const path = join(this.dataDir, "workflows", "runs", `${id}.json`);
    try {
      if (lstatSync(path).isSymbolicLink()) return null;
      return JSON.parse(readFileSync(path, "utf8")) as WorkflowRun;
    } catch {
      return null;
    }
  }

  writeRun(run: WorkflowRun): void {
    const path = join(this.dataDir, "workflows", "runs", `${run.id}.json`);
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    writeFileAtomic(path, `${JSON.stringify(run)}\n`, { mode: 0o600 });
    if (run.status === "waiting" && run.waitUntil !== undefined && !run.approval) this.waiting.set(run.id, run.waitUntil);
    else this.waiting.delete(run.id);
    if (run.status === "done" || run.status === "stopped") this.failedUntil.delete(run.id);
  }

  /** Drop finished runs older than an hour. Approvals stay. */
  pruneFinished(now: number): number {
    this.nextPrune = now + PRUNE_EVERY_MS;
    const dir = join(this.dataDir, "workflows", "runs");
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return 0; }
    let removed = 0;
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      const run = this.getRun(id);
      if (!run) continue;
      const finished = run.status === "done" || run.status === "stopped";
      if (!finished || now - run.updatedAt < FINISHED_KEEP_MS) continue;
      rmSync(join(dir, name), { force: true });
      this.waiting.delete(id);
      removed += 1;
    }
    return removed;
  }

  private rebuildIndex(now: number): void {
    this.waiting.clear();
    const dir = join(this.dataDir, "workflows", "runs");
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { names = []; }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const run = this.getRun(name.slice(0, -5));
      if (run?.status === "waiting" && run.waitUntil !== undefined && !run.approval) this.waiting.set(run.id, run.waitUntil);
    }
    this.indexed = true;
    this.pruneFinished(now);
  }

  /** Runs that are waiting only on a clock, due now. */
  due(now: number): WorkflowRun[] {
    if (!this.indexed) this.rebuildIndex(now);
    else if (now >= this.nextPrune) this.pruneFinished(now);
    const due: WorkflowRun[] = [];
    for (const [id, at] of this.waiting) {
      if (at > now) continue;
      const failUntil = this.failedUntil.get(id);
      if (failUntil !== undefined) {
        if (failUntil > now) continue;
        this.failedUntil.delete(id);
      }
      const run = this.getRun(id);
      if (run?.status === "waiting" && run.waitUntil !== undefined && run.waitUntil <= now && !run.approval) due.push(run);
      else this.waiting.delete(id);
    }
    return due;
  }
}

function lstatOrMissing(path: string): "file" | "other" | "missing" {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return "other";
    return stat.isFile() ? "file" : "other";
  } catch {
    return "missing";
  }
}

/** Advance one run without a model. An approval stays waiting until
 * `decision` is yes or no. A wait stays waiting until the clock passes. */
export function advanceWorkflow(run: WorkflowRun, effects: WorkflowEffects, decision?: "yes" | "no"): WorkflowRun {
  const next = { ...run, steps: run.steps, updatedAt: effects.now() };
  if (next.status === "done" || next.status === "stopped") return next;
  if (!next.approval && next.status === "waiting") next.status = "running";
  if (next.approval) {
    if (!decision) {
      next.status = "waiting";
      return next;
    }
    delete next.approval;
    if (decision === "no") {
      next.status = "stopped";
      return next;
    }
    next.index += 1;
    next.status = "running";
  }
  let guard = 0;
  while (next.status === "running" && next.index < next.steps.length && guard < MAX_STEPS) {
    guard += 1;
    const step = next.steps[next.index]!;
    if (step.kind === "send") {
      effects.deliver(step.bot, step.thread, step.text);
      next.index += 1;
    } else if (step.kind === "wait") {
      const until = next.waitUntil ?? step.until ?? effects.now() + (step.seconds ?? 1) * 1000;
      if (effects.now() < until) {
        next.waitUntil = until;
        next.status = "waiting";
        return next;
      }
      delete next.waitUntil;
      next.index += 1;
    } else {
      next.approval = { prompt: step.prompt };
      next.status = "waiting";
      delete next.waitUntil;
      if (step.bot && step.thread) effects.deliver(step.bot, step.thread, step.prompt);
      return next;
    }
  }
  if (next.index >= next.steps.length) {
    next.status = "done";
    delete next.waitUntil;
    delete next.approval;
  }
  return next;
}
