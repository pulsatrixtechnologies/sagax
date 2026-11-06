// Outbound queue for Sagax → Grok bridge signed envelopes (#2193): at most 3
// tries with backoff, then a dead letter. Per-person; never crosses users.
import { randomUUID } from "node:crypto";

import {
  BRIDGE_OUTBOUND_TRIES,
  BRIDGE_SIGNATURE_HEADER,
  signBridgeBody,
  bridgeBodyBytes,
  type BridgeEnvelope,
  type BridgeTask,
} from "../../shared/grok-bridge.ts";
import { BACKOFF_BASE_MS } from "../drivers/retry.ts";
import type { GrokBridgeStore } from "./store.ts";

export interface OutboundJob {
  id: string;
  personId: string;
  webhookUrl: string;
  key: string;
  envelope: BridgeEnvelope;
  tries: number;
  nextAt: number;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: Buffer; signal?: AbortSignal }) => Promise<{ status: number; text: () => Promise<string> }>;

export class GrokBridgeOutbound {
  private readonly queue: OutboundJob[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly store: GrokBridgeStore;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(deps: {
    store: GrokBridgeStore;
    fetch?: FetchLike;
    now?: () => number;
  }) {
    this.store = deps.store;
    this.fetchImpl = deps.fetch ?? (async (url, init) => {
      const response = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: init.signal });
      return { status: response.status, text: () => response.text() };
    });
    this.now = deps.now ?? Date.now;
  }

  /** Enqueue a signed delivery. Returns the job id. */
  enqueue(input: { personId: string; webhookUrl: string; key: string; envelope: BridgeEnvelope }): string {
    const job: OutboundJob = {
      id: randomUUID(),
      personId: input.personId.trim().toLowerCase(),
      webhookUrl: input.webhookUrl,
      key: input.key,
      envelope: input.envelope,
      tries: 0,
      nextAt: this.now(),
    };
    this.queue.push(job);
    this.kick();
    return job.id;
  }

  /** Pending jobs for one person (tests / dead-letter panel). */
  pending(personId: string): OutboundJob[] {
    const id = personId.trim().toLowerCase();
    return this.queue.filter((job) => job.personId === id);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private kick(): void {
    if (this.timer) return;
    const next = this.queue.reduce((min, job) => Math.min(min, job.nextAt), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(next)) return;
    const delay = Math.max(0, next - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pump();
    }, delay);
  }

  private async pump(): Promise<void> {
    const now = this.now();
    const ready = this.queue.filter((job) => job.nextAt <= now);
    for (const job of ready) {
      await this.deliver(job);
    }
    if (this.queue.length) this.kick();
  }

  private async deliver(job: OutboundJob): Promise<void> {
    const body = bridgeBodyBytes(job.envelope);
    const signature = signBridgeBody(job.key, body);
    job.tries += 1;
    try {
      const response = await this.fetchImpl(job.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [BRIDGE_SIGNATURE_HEADER]: signature,
        },
        body,
      });
      if (response.status === 429) {
        this.reschedule(job, true);
        return;
      }
      if (response.status >= 200 && response.status < 300) {
        this.remove(job.id);
        this.store.noteDelivery(job.personId, true);
        this.store.audit({
          at: this.now(),
          direction: "out",
          personId: job.personId,
          bot: job.envelope.from.bot,
          task: job.envelope.task,
          threadId: job.envelope.thread_id,
          outcome: "delivered",
          envelopeId: job.envelope.id,
        });
        return;
      }
      if (response.status >= 500 || response.status === 408) {
        this.reschedule(job, false);
        return;
      }
      // 4xx other than 429: dead letter
      this.dead(job, `HTTP ${response.status}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "network";
      this.reschedule(job, false, reason);
    }
  }

  private reschedule(job: OutboundJob, rateLimited: boolean, reason?: string): void {
    if (job.tries >= BRIDGE_OUTBOUND_TRIES) {
      this.dead(job, rateLimited ? "rate_limited" : (reason ?? "delivery_failed"));
      return;
    }
    const backoff = BACKOFF_BASE_MS[Math.min(job.tries - 1, BACKOFF_BASE_MS.length - 1)] ?? 8_000;
    job.nextAt = this.now() + (rateLimited ? Math.max(backoff, 5_000) : backoff);
    this.store.noteDelivery(job.personId, false);
    this.kick();
  }

  private dead(job: OutboundJob, reason: string): void {
    this.remove(job.id);
    this.store.noteDelivery(job.personId, false);
    this.store.addDeadLetter({
      id: job.id,
      at: this.now(),
      personId: job.personId,
      bot: job.envelope.from.bot,
      task: job.envelope.task as BridgeTask,
      threadId: job.envelope.thread_id,
      envelopeId: job.envelope.id,
      reason,
      tries: job.tries,
    });
    this.store.audit({
      at: this.now(),
      direction: "out",
      personId: job.personId,
      bot: job.envelope.from.bot,
      task: job.envelope.task,
      threadId: job.envelope.thread_id,
      outcome: "dead",
      reason,
      envelopeId: job.envelope.id,
    });
  }

  private remove(id: string): void {
    const index = this.queue.findIndex((job) => job.id === id);
    if (index >= 0) this.queue.splice(index, 1);
  }
}
