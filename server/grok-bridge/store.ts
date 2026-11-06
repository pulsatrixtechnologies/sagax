// Per-person Grok bridge state (#2193): link config (URL, enable, bot
// labels, phone opt-ins), opaque link id, thread map, nonce store, leases,
// rate counters, circuit breaker, dead letters and audit (metadata only).
// Plain JSON under dataDir; the key lives in secrets.ts.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  BRIDGE_CIRCUIT_FAILURES,
  BRIDGE_CIRCUIT_OPEN_MS,
  BRIDGE_NONCE_TTL_MS,
  BRIDGE_RATE_PER_DAY,
  BRIDGE_RATE_PER_MINUTE,
  newBridgeLinkId,
  type BridgeAuditRow,
  type BridgeTask,
} from "../../shared/grok-bridge.ts";

export const GROK_BRIDGE_STORE_FILE = "grok-bridge.json";

export interface GrokBridgePersonLink {
  linkId: string;
  webhookUrl: string;
  enabled: boolean;
  bots: string[];
  mayCallOwner: boolean;
  mayTextOwner: boolean;
  updatedAt: number;
}

export interface BridgeLease {
  jobKey: string;
  holder: { personId: string; bot: string };
  purpose?: string;
  since: number;
  expiresAt: number;
}

export interface BridgeDeadLetter {
  id: string;
  at: number;
  personId: string;
  bot: string;
  task: BridgeTask;
  threadId: string;
  envelopeId: string;
  reason: string;
  tries: number;
}

interface RateBucket {
  minute: number;
  minuteCount: number;
  day: number;
  dayCount: number;
}

interface CircuitState {
  failures: number;
  openUntil?: number;
}

interface PersonRuntime {
  nonces: Record<string, number>;
  idempotency: Record<string, number>;
  rate: RateBucket;
  circuit: CircuitState;
  /** opaque bridge thread_id → Sagax conversation threadId */
  threads: Record<string, string>;
  /** Sagax conversation threadId → opaque bridge thread_id */
  reverseThreads: Record<string, string>;
}

interface Document {
  version: 1;
  /** personId → link */
  links: Record<string, GrokBridgePersonLink>;
  /** linkId → personId (inbound URL lookup) */
  byLinkId: Record<string, string>;
  leases: Record<string, BridgeLease>;
  deadLetters: BridgeDeadLetter[];
  audit: BridgeAuditRow[];
  runtime: Record<string, PersonRuntime>;
}

const emptyRuntime = (): PersonRuntime => ({
  nonces: {},
  idempotency: {},
  rate: { minute: 0, minuteCount: 0, day: 0, dayCount: 0 },
  circuit: { failures: 0 },
  threads: {},
  reverseThreads: {},
});

const emptyDoc = (): Document => ({
  version: 1,
  links: {},
  byLinkId: {},
  leases: {},
  deadLetters: [],
  audit: [],
  runtime: {},
});

const MAX_AUDIT = 500;
const MAX_DEAD = 100;

export class GrokBridgeStore {
  private readonly file: string;
  private cached: Document | null = null;
  private readonly now: () => number;

  constructor(dataDir: string, now: () => number = Date.now) {
    this.file = join(dataDir, GROK_BRIDGE_STORE_FILE);
    this.now = now;
  }

  private read(): Document {
    if (this.cached) return this.cached;
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Document;
      if (parsed.version !== 1 || !parsed.links) throw new Error("schema");
      this.cached = {
        version: 1,
        links: parsed.links ?? {},
        byLinkId: parsed.byLinkId ?? {},
        leases: parsed.leases ?? {},
        deadLetters: parsed.deadLetters ?? [],
        audit: parsed.audit ?? [],
        runtime: parsed.runtime ?? {},
      };
      return this.cached;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.cached = emptyDoc();
        return this.cached;
      }
      this.cached = emptyDoc();
      return this.cached;
    }
  }

  private write(document: Document): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(document), { mode: 0o600 });
    renameSync(tmp, this.file);
    this.cached = document;
  }

  private runtime(personId: string): PersonRuntime {
    const doc = this.read();
    const id = personId.trim().toLowerCase();
    if (!doc.runtime[id]) doc.runtime[id] = emptyRuntime();
    return doc.runtime[id]!;
  }

  getLink(personId: string): GrokBridgePersonLink | null {
    return this.read().links[personId.trim().toLowerCase()] ?? null;
  }

  personForLinkId(linkId: string): string | null {
    return this.read().byLinkId[linkId] ?? null;
  }

  setLink(personId: string, patch: {
    webhookUrl?: string;
    enabled?: boolean;
    bots?: string[];
    mayCallOwner?: boolean;
    mayTextOwner?: boolean;
    clear?: boolean;
  }): GrokBridgePersonLink | null {
    const doc = structuredClone(this.read());
    const id = personId.trim().toLowerCase();
    if (patch.clear) {
      const existing = doc.links[id];
      if (existing) delete doc.byLinkId[existing.linkId];
      delete doc.links[id];
      this.write(doc);
      return null;
    }
    const current = doc.links[id];
    const linkId = current?.linkId ?? newBridgeLinkId();
    const next: GrokBridgePersonLink = {
      linkId,
      webhookUrl: patch.webhookUrl?.trim() ?? current?.webhookUrl ?? "",
      enabled: patch.enabled ?? current?.enabled ?? true,
      bots: patch.bots ?? current?.bots ?? [],
      mayCallOwner: patch.mayCallOwner ?? current?.mayCallOwner ?? false,
      mayTextOwner: patch.mayTextOwner ?? current?.mayTextOwner ?? false,
      updatedAt: this.now(),
    };
    if (!next.webhookUrl) throw Object.assign(new Error("Paste your Grok bridge webhook URL (https)."), { status: 400 });
    doc.links[id] = next;
    doc.byLinkId[linkId] = id;
    this.write(doc);
    return next;
  }

  /** Record a nonce; returns false when it was already seen (replay). */
  rememberNonce(personId: string, nonce: string, ttlMs: number = BRIDGE_NONCE_TTL_MS): boolean {
    const doc = structuredClone(this.read());
    const id = personId.trim().toLowerCase();
    const rt = doc.runtime[id] ?? emptyRuntime();
    const now = this.now();
    for (const [key, until] of Object.entries(rt.nonces)) {
      if (until <= now) delete rt.nonces[key];
    }
    if (rt.nonces[nonce]) {
      doc.runtime[id] = rt;
      this.write(doc);
      return false;
    }
    rt.nonces[nonce] = now + ttlMs;
    doc.runtime[id] = rt;
    this.write(doc);
    return true;
  }

  /** Idempotency key: first delivery wins; repeats within TTL are duplicates. */
  rememberIdempotency(personId: string, key: string, ttlMs: number = BRIDGE_NONCE_TTL_MS): "fresh" | "duplicate" {
    const doc = structuredClone(this.read());
    const id = personId.trim().toLowerCase();
    const rt = doc.runtime[id] ?? emptyRuntime();
    const now = this.now();
    for (const [k, until] of Object.entries(rt.idempotency)) {
      if (until <= now) delete rt.idempotency[k];
    }
    if (rt.idempotency[key]) {
      doc.runtime[id] = rt;
      this.write(doc);
      return "duplicate";
    }
    rt.idempotency[key] = now + ttlMs;
    doc.runtime[id] = rt;
    this.write(doc);
    return "fresh";
  }

  /** Take a rate slot; returns ok or 429. */
  takeRate(personId: string): { ok: true } | { ok: false; retryAfterS: number } {
    const doc = structuredClone(this.read());
    const id = personId.trim().toLowerCase();
    const rt = doc.runtime[id] ?? emptyRuntime();
    const now = this.now();
    const minute = Math.floor(now / 60_000);
    const day = Math.floor(now / 86_400_000);
    if (rt.rate.minute !== minute) {
      rt.rate.minute = minute;
      rt.rate.minuteCount = 0;
    }
    if (rt.rate.day !== day) {
      rt.rate.day = day;
      rt.rate.dayCount = 0;
    }
    if (rt.rate.minuteCount >= BRIDGE_RATE_PER_MINUTE) {
      doc.runtime[id] = rt;
      this.write(doc);
      return { ok: false, retryAfterS: 60 - Math.floor((now % 60_000) / 1000) };
    }
    if (rt.rate.dayCount >= BRIDGE_RATE_PER_DAY) {
      doc.runtime[id] = rt;
      this.write(doc);
      return { ok: false, retryAfterS: 86_400 - Math.floor((now % 86_400_000) / 1000) };
    }
    rt.rate.minuteCount += 1;
    rt.rate.dayCount += 1;
    doc.runtime[id] = rt;
    this.write(doc);
    return { ok: true };
  }

  countsToday(personId: string): { sent: number; day: number } {
    const rt = this.runtime(personId);
    const day = Math.floor(this.now() / 86_400_000);
    return { sent: rt.rate.day === day ? rt.rate.dayCount : 0, day };
  }

  circuitOpen(personId: string): boolean {
    const openUntil = this.runtime(personId).circuit.openUntil;
    return typeof openUntil === "number" && openUntil > this.now();
  }

  noteDelivery(personId: string, ok: boolean): void {
    const doc = structuredClone(this.read());
    const id = personId.trim().toLowerCase();
    const rt = doc.runtime[id] ?? emptyRuntime();
    if (ok) {
      rt.circuit = { failures: 0 };
    } else {
      const failures = (rt.circuit.failures ?? 0) + 1;
      rt.circuit = {
        failures,
        ...(failures >= BRIDGE_CIRCUIT_FAILURES ? { openUntil: this.now() + BRIDGE_CIRCUIT_OPEN_MS } : {}),
      };
    }
    doc.runtime[id] = rt;
    this.write(doc);
  }

  mapThread(personId: string, bridgeThreadId: string, sagaxThreadId: string): void {
    const doc = structuredClone(this.read());
    const id = personId.trim().toLowerCase();
    const rt = doc.runtime[id] ?? emptyRuntime();
    rt.threads[bridgeThreadId] = sagaxThreadId;
    rt.reverseThreads[sagaxThreadId] = bridgeThreadId;
    doc.runtime[id] = rt;
    this.write(doc);
  }

  sagaxThreadFor(personId: string, bridgeThreadId: string): string | undefined {
    return this.runtime(personId).threads[bridgeThreadId];
  }

  bridgeThreadFor(personId: string, sagaxThreadId: string): string | undefined {
    return this.runtime(personId).reverseThreads[sagaxThreadId];
  }

  claim(personId: string, jobKey: string, bot: string, ttlS: number, purpose?: string): { ok: true; lease: BridgeLease } | { ok: false; reason: "held_by_other"; lease: BridgeLease } {
    const doc = structuredClone(this.read());
    const now = this.now();
    for (const [key, lease] of Object.entries(doc.leases)) {
      if (lease.expiresAt <= now) delete doc.leases[key];
    }
    const scoped = `${personId.trim().toLowerCase()}:${jobKey}`;
    const existing = doc.leases[scoped];
    if (existing && existing.expiresAt > now) {
      const same = existing.holder.personId === personId.trim().toLowerCase() && existing.holder.bot === bot;
      if (!same) {
        this.write(doc);
        return { ok: false, reason: "held_by_other", lease: existing };
      }
      existing.expiresAt = now + ttlS * 1000;
      if (purpose) existing.purpose = purpose;
      doc.leases[scoped] = existing;
      this.write(doc);
      return { ok: true, lease: existing };
    }
    const lease: BridgeLease = {
      jobKey,
      holder: { personId: personId.trim().toLowerCase(), bot },
      ...(purpose ? { purpose } : {}),
      since: now,
      expiresAt: now + ttlS * 1000,
    };
    doc.leases[scoped] = lease;
    this.write(doc);
    return { ok: true, lease };
  }

  release(personId: string, jobKey: string, bot: string): boolean {
    const doc = structuredClone(this.read());
    const scoped = `${personId.trim().toLowerCase()}:${jobKey}`;
    const existing = doc.leases[scoped];
    if (!existing) return false;
    if (existing.holder.personId !== personId.trim().toLowerCase() || existing.holder.bot !== bot) return false;
    delete doc.leases[scoped];
    this.write(doc);
    return true;
  }

  listLeases(personId: string): BridgeLease[] {
    const id = personId.trim().toLowerCase();
    const now = this.now();
    return Object.values(this.read().leases).filter((lease) => lease.holder.personId === id && lease.expiresAt > now);
  }

  addDeadLetter(row: BridgeDeadLetter): void {
    const doc = structuredClone(this.read());
    doc.deadLetters = [row, ...doc.deadLetters].slice(0, MAX_DEAD);
    this.write(doc);
  }

  deadLetters(personId: string): BridgeDeadLetter[] {
    const id = personId.trim().toLowerCase();
    return this.read().deadLetters.filter((row) => row.personId === id);
  }

  audit(row: BridgeAuditRow): void {
    const doc = structuredClone(this.read());
    // Never persist message text: callers must not put it on the row.
    doc.audit = [row, ...doc.audit].slice(0, MAX_AUDIT);
    this.write(doc);
  }

  recentAudit(personId: string, limit = 50): BridgeAuditRow[] {
    const id = personId.trim().toLowerCase();
    return this.read().audit.filter((row) => row.personId === id).slice(0, limit);
  }
}
