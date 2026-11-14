/** Shared retention budget. A budget never interrupts a running turn.
 * Resource owners keep their existing identity checks and idle timeouts. */
import type { SendTurnInput } from "../contracts.ts";
import { createHash } from "node:crypto";
import { processMemory, resourceMemory, type ProcessMemory } from "./process-memory.ts";
import { reportBackgroundError } from "../background-error.ts";

export const MiB = 1024 * 1024;
export type WarmResourceKind = "codex" | "acp" | "claude" | "pi" | "http-mcp" | "perspicax";
export type WarmResourceLimits = { count: number; bytes: number; personCount: number; personBytes: number };

export function warmResourceLimits(env: NodeJS.ProcessEnv = process.env): WarmResourceLimits {
  const value = (key: string, fallback: number) => /^\d+$/.test(env[key] ?? "") && Number.isSafeInteger(Number(env[key])) ? Number(env[key]) : fallback;
  return {
    count: value("SAGAX_WARM_MAX_COUNT", 64),
    bytes: value("SAGAX_WARM_MAX_BYTES", 2048 * MiB),
    personCount: value("SAGAX_WARM_PERSON_MAX_COUNT", 12),
    personBytes: value("SAGAX_WARM_PERSON_MAX_BYTES", 1024 * MiB),
  };
}

/** The speaker, independently of the payer. Missing speaker is solo only.
 * Never use botId here: one person can own many bots. */
export function warmResourcePerson(turn: Pick<SendTurnInput, "principalId" | "access">): string {
  return turn.principalId ?? turn.access?.identity ?? "solo";
}

/** Old retained proxies cannot read another speaker's next capability,
 * including while asynchronous teardown is still running. */
export function warmResourceTokenThread(turn: Pick<SendTurnInput, "threadId" | "principalId" | "access">): string {
  if (!turn.principalId && !turn.access?.identity) return turn.threadId;
  return `${turn.threadId}-person-${createHash("sha256").update(warmResourcePerson(turn)).digest("hex").slice(0, 32)}`;
}

export interface WarmResourceSpec {
  person: string;
  kind: WarmResourceKind;
  /** Conservative reservation until sampled, also the floor for future growth. */
  bytes: number | (() => number);
  pids?: () => number[];
  count?: () => number;
  /** Additional owner-side protection (preparation, keepalive, in-flight IO). */
  protected?: () => boolean;
  /** Detach from the pool synchronously, then confirm process/session close.
   * false or rejection keeps the resource charged and retries on the next sample. */
  evict: () => void | boolean | Promise<void | boolean>;
}

export interface WarmResourceLease {
  active(): boolean;
  idle(): void;
  touch(): void;
  /** Owner already started its ordinary teardown. Keep charges until exit. */
  retiring(): void;
  forget(): void;
}
type Entry = WarmResourceSpec & { state: "active" | "idle" | "closing"; used: number; rss: number; reserved: number; units: number; pending: boolean };
type Totals = { count: number; memoryBytes: number; sampledRssBytes: number; active: number; idle: number; closing: number };
const empty = (): Totals => ({ count: 0, memoryBytes: 0, sampledRssBytes: 0, active: 0, idle: 0, closing: 0 });

export class WarmResourceBudget {
  private readonly options: { limits?: WarmResourceLimits; sample?: () => Promise<ProcessMemory[]>; intervalMs?: number };
  private readonly entries = new Set<Entry>();
  private clock = 0;
  private timer?: ReturnType<typeof setInterval>;
  private sampling?: Promise<void>;
  private readonly pending = new Set<Promise<void>>();
  private evictions = 0;
  private closeFailures = 0;
  private personEvictions = 0;
  private globalEvictions = 0;

  constructor(options: {
    limits?: WarmResourceLimits;
    sample?: () => Promise<ProcessMemory[]>;
    intervalMs?: number;
  } = {}) { this.options = options; }

  register(spec: WarmResourceSpec): WarmResourceLease {
    const entry: Entry = { ...spec, state: "active", used: ++this.clock, rss: 0, reserved: 0, units: 1, pending: false };
    this.measure(entry);
    this.entries.add(entry);
    if (!this.timer && this.options.intervalMs !== 0) {
      this.timer = setInterval(() => { void this.refresh().catch(reportBackgroundError); }, this.options.intervalMs ?? 15_000);
      this.timer.unref();
    }
    this.enforce();
    return {
      active: () => {
        if (!this.entries.has(entry) || entry.state === "closing") return false;
        entry.state = "active";
        entry.used = ++this.clock;
        return true;
      },
      idle: () => {
        if (!this.entries.has(entry) || entry.state === "closing") return;
        entry.state = "idle";
        entry.used = ++this.clock;
        this.measure(entry);
        this.enforce();
      },
      touch: () => { if (this.entries.has(entry)) entry.used = ++this.clock; },
      retiring: () => { if (this.entries.has(entry)) entry.state = "closing"; },
      forget: () => this.remove(entry),
    };
  }

  private remove(entry: Entry): void {
    this.entries.delete(entry);
    if (!this.entries.size && this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }

  private add(total: Totals, entry: Entry): void {
    total.count += entry.units;
    total.memoryBytes += Math.max(entry.rss, entry.reserved);
    total.sampledRssBytes += entry.rss;
    total[entry.state] += 1;
  }

  private measure(entry: Entry): void {
    entry.units = Math.max(1, entry.count?.() ?? 1);
    entry.reserved = Math.max(0, typeof entry.bytes === "function" ? entry.bytes() : entry.bytes);
  }

  private totals(retainedOnly = false): { total: Totals; people: Map<string, Totals> } {
    const total = empty(), people = new Map<string, Totals>();
    for (const entry of this.entries) {
      if (retainedOnly && entry.state !== "idle") continue;
      const person = people.get(entry.person) ?? empty();
      this.add(person, entry); this.add(total, entry);
      people.set(entry.person, person);
    }
    return { total, people };
  }

  private enforce(): void {
    const limits = this.options.limits ?? warmResourceLimits();
    const overPerson = (t: Totals) => t.count > limits.personCount || t.memoryBytes > limits.personBytes;
    // The caps bound what is retained: idle resources only. Closing ones
    // remain charged in metrics, but are already scheduled to leave. #4215:
    // active turns used to count too, so a person (or a server) whose other
    // engines were busy evicted every engine the moment its turn ended, and
    // the conversation's next turn always paid a cold start. A running turn
    // is not retention; real memory pressure stays with the cgroup guard
    // (server/memory/engine-memory-guard.ts).
    const candidates = [...this.entries].filter(e => e.state === "idle").sort((a, b) => a.used - b.used);
    // Local caps first, then the global cap.
    for (const scope of ["person", "global"] as const) {
      for (const entry of candidates) {
        if (entry.state !== "idle" || entry.protected?.()) continue;
        const { total, people } = this.totals(true);
        const over = scope === "person" ? overPerson(people.get(entry.person) ?? empty())
          : total.count > limits.count || total.memoryBytes > limits.bytes;
        if (!over) continue;
        entry.state = "closing";
        this.evictions += 1;
        if (scope === "person") this.personEvictions += 1; else this.globalEvictions += 1;
        this.close(entry);
      }
    }
  }

  private close(entry: Entry): void {
    if (entry.pending) return;
    entry.pending = true;
    // Invoke before yielding: an evicted resource cannot be adopted by a
    // turn racing the asynchronous process teardown.
    let result: ReturnType<WarmResourceSpec["evict"]>;
    try { result = entry.evict(); } catch { result = false; }
    const pending = Promise.resolve(result).then(stopped => {
      if (stopped === false) this.closeFailures += 1;
      else this.remove(entry);
    }, () => { this.closeFailures += 1; }).finally(() => {
      entry.pending = false;
      this.pending.delete(pending);
    });
    this.pending.add(pending);
  }

  /** Refresh growing process trees and session caches, then reapply caps. */
  refresh(): Promise<void> {
    if (this.sampling) return this.sampling;
    this.sampling = (async () => {
      const rows = await (this.options.sample ?? processMemory)().catch(() => []);
      const roots = new Set([...this.entries].flatMap(e => e.pids?.() ?? []));
      const memory = resourceMemory(rows, roots);
      const observed = new Set(rows.map(row => row.pid));
      for (const entry of this.entries) {
        this.measure(entry);
        const pids = entry.pids?.() ?? [];
        // A failed/partial process-table read cannot prove that a live
        // resource shrank. Keep its last reading until a complete sample.
        if (pids.every(pid => observed.has(pid))) entry.rss = pids.reduce((sum, pid) => sum + (memory.get(pid) ?? 0), 0);
        if (entry.state === "closing") this.close(entry);
      }
      this.enforce();
    })().finally(() => { this.sampling = undefined; });
    return this.sampling;
  }

  async settled(): Promise<void> { while (this.pending.size) await Promise.all(this.pending); }

  /** Aggregate only. Never expose person ids, thread ids, PIDs or tokens. */
  stats() {
    const { total, people } = this.totals();
    const limits = this.options.limits ?? warmResourceLimits();
    const kinds: Partial<Record<WarmResourceKind, Totals>> = {};
    for (const entry of this.entries) { const row = kinds[entry.kind] ?? empty(); this.add(row, entry); kinds[entry.kind] = row; }
    return { ...total, resources: this.entries.size, people: people.size, limits, kinds,
      overBudget: total.count > limits.count || total.memoryBytes > limits.bytes || [...people.values()].some(p => p.count > limits.personCount || p.memoryBytes > limits.personBytes),
      evictions: this.evictions, personEvictions: this.personEvictions, globalEvictions: this.globalEvictions, closeFailures: this.closeFailures };
  }
}

/** One per server process, shared by every provider instance and pool. */
export const warmResources = new WarmResourceBudget();
