// The push hub: takes what happened (a message for a person, a nudge, an
// approval, an achievement, a routine that failed), decides with
// ./decide.ts whether that person's phones get a push, and sends it to
// each registered device: iPhones (./devices.ts) through APNs (./apns.ts),
// Android phones (./fcm-devices.ts) through FCM HTTP v1 (./fcm.ts,
// 2026-10-26). Either one may be off; the other still sends.
//
// Without APNs settings (./config.ts) it logs one clear line the first time
// a push would have gone out, then skips quietly. A dead token (410, or 400
// BadDeviceToken) is removed from the store. Never logs a token or a key.
import { ApnsSender, createHttp2Transport, type ApnsLog, type ApnsTransport } from "./apns.ts";
import type { ApnsConfigResult, ApnsEnvironment } from "./config.ts";
import { maskSecret } from "./config.ts";
import { bypassesPushRateLimit, PUSH_SEEN_GRACE_MS, PushRateLimiter, shouldPush, waitsForGrace } from "./decide.ts";
import type { PushDeviceStore } from "./devices.ts";
import type { AndroidPushDeviceStore } from "./fcm-devices.ts";
import { buildFcmMessage, type FcmSender } from "./fcm.ts";
import { buildApnsRequest, buildReadSyncRequest, buildSettledRequest, collapseId, type ApnsRequest, type PushMessage } from "./payload.ts";
import type { SendOutcome } from "./apns.ts";
import { reportBackgroundError } from "../background-error.ts";

/** What sends one prepared request to one iPhone: APNs itself, or a relay. */
export interface IosPushSender {
  send(device: { token: string; environment: ApnsEnvironment }, request: ApnsRequest): Promise<SendOutcome>;
}

export interface PushHubDeps {
  config: ApnsConfigResult;
  /** No APNs key here: pushes go through a server that has one (./relay.ts, #2697). */
  relay?: { sender: IosPushSender; bundleId: string };
  store: PushDeviceStore;
  /** Android phones (FCM). Absent or no sender: Android pushes are off. */
  android?: { store: AndroidPushDeviceStore; sender: FcmSender | null; reason?: string };
  /** A client of this person is connected right now (presence, or a live stream). */
  connected(person: string): boolean;
  /** APNs tokens of this person's devices that have a live stream right now.
   * Those devices already got the line: skip the push to them. */
  activeTokens?(person: string): string[];
  /** The person's synced "Notification sounds" (true when unset). */
  personSound?(person: string): boolean;
  /** The person's synced "Notification sound" (a tone id, or "system"). */
  personSoundChoice?(person: string): string | undefined;
  transport?: ApnsTransport;
  now?: () => number;
  log?: ApnsLog;
  graceMs?: number;
  /** setTimeout by default; tests drive it by hand. */
  schedule?(run: () => void, ms: number): () => void;
  limiter?: PushRateLimiter;
}

interface Pending {
  message: PushMessage;
  queuedAt: number;
  cancel: () => void;
}

const defaultLog: ApnsLog = {
  info: (line) => console.log(line),
  warn: (line) => console.warn(line),
};

const key = (person: string, rest: string) => `${person}\0${rest}`;

export class PushHub {
  readonly enabled: boolean;
  private readonly deps: PushHubDeps;
  private readonly sender: IosPushSender | null;
  /** APNs itself (this server holds the key); a relay serves only this one. */
  private readonly direct: ApnsSender | null;
  private readonly bundleId: string;
  private readonly log: ApnsLog;
  private readonly now: () => number;
  private readonly limiter: PushRateLimiter;
  private readonly pending = new Map<string, Pending>();
  /** When a client of that person last marked that thread read. */
  private readonly reads = new Map<string, number>();
  private readonly inflight = new Set<Promise<void>>();
  /** Conversations a push went out for, not yet read: a read of one tells
   * the phones (noteRead). In memory; bounded. */
  private readonly pushed = new Set<string>();
  /** Asks (an approval or a question) a push went out for, not yet settled:
   * person\0threadId\0requestId. In memory; bounded. */
  private readonly pushedAsks = new Set<string>();
  private readonly readLimiter = new PushRateLimiter(30, 5 * 60_000);
  private notConfiguredLogged = false;

  constructor(deps: PushHubDeps) {
    this.deps = deps;
    this.log = deps.log ?? defaultLog;
    this.now = deps.now ?? Date.now;
    this.limiter = deps.limiter ?? new PushRateLimiter();
    let sender: ApnsSender | null = null;
    if (deps.config.configured) {
      try {
        sender = new ApnsSender({ config: deps.config.config, transport: deps.transport ?? createHttp2Transport(), now: this.now, log: this.log });
        this.log.info(`push: APNs on (${deps.config.config.environment} by default, topic ${deps.config.config.bundleId}, key ${maskSecret(deps.config.config.keyId)})`);
      } catch (error) {
        this.log.warn(`push: the APNs key could not be loaded (${error instanceof Error ? error.message : String(error)}); pushes to phones are off`);
        this.notConfiguredLogged = true;
      }
    }
    this.direct = sender;
    let ios: IosPushSender | null = sender;
    let bundleId = deps.config.configured ? deps.config.config.bundleId : "";
    if (!ios && deps.relay) {
      ios = deps.relay.sender;
      bundleId = deps.relay.bundleId;
      this.log.info(`push: APNs through the relay (topic ${bundleId})`);
    }
    this.sender = ios;
    this.bundleId = bundleId;
    this.fcm = deps.android?.sender ?? null;
    if (this.fcm) this.log.info("push: FCM on (Android)");
    this.enabled = ios !== null || this.fcm !== null;
  }

  private readonly fcm: FcmSender | null;

  /** The relay route (POST /api/push/relay): sends a request another Sagax
   * prepared, through this server's own APNs key. Null when this server has
   * no key (a relay never forwards to another relay). */
  relaySend(device: { token: string; environment: ApnsEnvironment }, request: ApnsRequest): Promise<SendOutcome> | null {
    return this.direct ? this.direct.send(device, request) : null;
  }

  /** The app topic this server pushes to. */
  get topic(): string {
    return this.bundleId;
  }

  /** This person's Android phones. */
  private androidDevices(person: string) {
    return this.deps.android?.store.list(person) ?? [];
  }

  /** Something a person may want on their phone. Never throws. */
  submit(message: PushMessage): void {
    try {
      const person = message.personId.trim().toLowerCase();
      if (!person) return;
      const iosDevices = this.deps.store.list(person).length;
      const androidDevices = this.androidDevices(person).length;
      if (!iosDevices && !androidDevices) return;
      if (!this.sender && !(androidDevices && this.fcm)) {
        if (!this.notConfiguredLogged) {
          this.notConfiguredLogged = true;
          const reason = this.deps.config.configured ? "key not loaded" : this.deps.config.reason;
          if (iosDevices) this.log.warn(`push: APNs is not configured (${reason}); pushes to phones are skipped (docs/ios-push.md)`);
          if (androidDevices) this.log.warn(`push: FCM is not configured (${this.deps.android?.reason ?? "not set"}); pushes to Android phones are skipped (docs/android-push.md)`);
        }
        return;
      }
      const normalized = { ...message, personId: person };
      const connected = this.deps.connected(person);
      if (!waitsForGrace({ kind: message.kind, connected })) {
        if (shouldPush({ kind: message.kind, connected, seen: false })) this.dispatch(normalized);
        return;
      }
      const pendingKey = key(person, collapseId(normalized));
      const queuedAt = this.now();
      const existing = this.pending.get(pendingKey);
      if (existing) {
        // the newest line of that conversation is the one the phone shows
        existing.message = normalized;
        existing.queuedAt = queuedAt;
        return;
      }
      const entry: Pending = { message: normalized, queuedAt, cancel: () => {} };
      const schedule = this.deps.schedule ?? ((run: () => void, ms: number) => {
        const timer = setTimeout(run, ms);
        timer.unref?.();
        return () => clearTimeout(timer);
      });
      entry.cancel = schedule(() => this.settle(pendingKey), this.deps.graceMs ?? PUSH_SEEN_GRACE_MS);
      this.pending.set(pendingKey, entry);
    } catch (error) {
      this.log.warn(`push: could not queue a push (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  /** A client of this person marked this conversation read. A push for it
   * still waiting its grace is dropped, and when that conversation had
   * buzzed their phones, the phones hear it was read (a silent push), so the
   * badge and the banner go on every device, not only the one that read. */
  noteRead(person: string, threadId: string): void {
    const who = person.trim().toLowerCase();
    if (!who || !threadId) return;
    this.reads.set(key(who, threadId), this.now());
    if (this.reads.size > 20_000) {
      const cutoff = this.now() - 10 * 60_000;
      for (const [entry, at] of this.reads) if (at < cutoff) this.reads.delete(entry);
    }
    const pushedKey = key(who, threadId);
    if (!this.pushed.has(pushedKey)) return;
    this.pushed.delete(pushedKey);
    this.syncRead(who, threadId);
  }

  /** An approval or question was answered (on any device) or expired. Its
   * push still waiting the grace is dropped, and the phones it rang hear it
   * (buildSettledRequest): that ask's banner leaves the phone and the watch,
   * and only that one; the conversation's other asks stay. Without a
   * request id, every ask of the conversation is settled. */
  noteSettled(threadId: string, requestId?: string): void {
    if (!threadId) return;
    const matches = (message: PushMessage) => message.threadId === threadId && message.kind === "approval"
      && (!requestId || message.requestId === requestId);
    for (const [pendingKey, entry] of this.pending) {
      if (!matches(entry.message)) continue;
      entry.cancel();
      this.pending.delete(pendingKey);
    }
    for (const askKey of this.pushedAsks) {
      const [person, thread, request] = askKey.split("\0");
      if (!person || thread !== threadId || !request || (requestId && request !== requestId)) continue;
      this.pushedAsks.delete(askKey);
      this.syncSettled(person, threadId, request);
    }
  }

  /** The settled push to this person's iPhones; Android hears a read of the
   * conversation, as before. */
  private syncSettled(person: string, threadId: string, requestId: string): void {
    const sender = this.sender;
    const fcm = this.fcm;
    const ios = sender ? this.deps.store.list(person) : [];
    const android = fcm ? this.androidDevices(person) : [];
    if (!ios.length && !android.length) return;
    if (!this.readLimiter.tryTake(person, this.now())) return;
    const bundleId = this.bundleId;
    const run = (async () => {
      for (const device of ios) {
        const outcome = await sender!.send(device, buildSettledRequest({ threadId, requestId, bundleId, nowMs: this.now() }));
        if (!outcome.ok && outcome.prune) this.deps.store.prune(device.token);
      }
      for (const device of android) {
        const outcome = await fcm!.send(device.token, buildFcmMessage({ message: { kind: "message", personId: person, title: "", body: "", threadId, at: this.now() }, token: device.token, kind: "read" }));
        if (!outcome.ok && outcome.prune) this.deps.android?.store.prune(device.token);
      }
    })().catch((error) => {
      this.log.warn(`push: settled sync failed (${error instanceof Error ? error.message : String(error)})`);
    });
    this.inflight.add(run);
    void run.finally(() => this.inflight.delete(run)).catch(reportBackgroundError);
  }

  /** The silent "read" push, at most READ_SYNC_MAX per person per window. */
  private syncRead(person: string, threadId: string): void {
    const sender = this.sender;
    const fcm = this.fcm;
    const ios = sender ? this.deps.store.list(person) : [];
    const android = fcm ? this.androidDevices(person) : [];
    if (!ios.length && !android.length) return;
    if (!this.readLimiter.tryTake(person, this.now())) return;
    const bundleId = this.bundleId;
    const run = (async () => {
      for (const device of ios) {
        const outcome = await sender!.send(device, buildReadSyncRequest({ threadId, bundleId, nowMs: this.now() }));
        if (!outcome.ok && outcome.prune) this.deps.store.prune(device.token);
      }
      for (const device of android) {
        const outcome = await fcm!.send(device.token, buildFcmMessage({ message: { kind: "message", personId: person, title: "", body: "", threadId, at: this.now() }, token: device.token, kind: "read" }));
        if (!outcome.ok && outcome.prune) this.deps.android?.store.prune(device.token);
      }
    })().catch((error) => {
      this.log.warn(`push: read sync failed (${error instanceof Error ? error.message : String(error)})`);
    });
    this.inflight.add(run);
    void run.finally(() => this.inflight.delete(run)).catch(reportBackgroundError);
  }

  /** Waits for every send started so far (tests, shutdown). */
  async drain(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled(this.inflight);
  }

  private settle(pendingKey: string): void {
    const entry = this.pending.get(pendingKey);
    if (!entry) return;
    this.pending.delete(pendingKey);
    const { message } = entry;
    const readAt = message.threadId ? this.reads.get(key(message.personId, message.threadId)) : undefined;
    const seen = readAt !== undefined && readAt >= entry.queuedAt;
    if (shouldPush({ kind: message.kind, connected: true, seen })) this.dispatch(message);
  }

  private devicesToSend(person: string) {
    const active = new Set((this.deps.activeTokens?.(person) ?? []).map((token) => token.trim().toLowerCase()));
    return this.deps.store.list(person).filter((device) => !active.has(device.token));
  }

  private dispatch(message: PushMessage): void {
    const ios = this.sender ? this.devicesToSend(message.personId).length : 0;
    const android = this.fcm ? this.androidDevices(message.personId).length : 0;
    if (!ios && !android) return;
    if (!bypassesPushRateLimit(message.kind) && !this.limiter.tryTake(message.personId, this.now())) {
      // Refused pushes leave a line; approvals bypass this ceiling (#1715).
      this.log.warn(`push: rate limited (${message.kind}${message.threadId ? ` thread ${message.threadId}` : ""})`);
      return;
    }
    if (message.threadId && message.kind !== "nudge") {
      if (this.pushed.size >= 5_000) this.pushed.clear();
      this.pushed.add(key(message.personId, message.threadId));
    }
    // an ask is withdrawn by its own id once answered (noteSettled)
    if (message.threadId && message.kind === "approval" && message.requestId) {
      if (this.pushedAsks.size >= 5_000) this.pushedAsks.clear();
      this.pushedAsks.add(`${message.personId}\0${message.threadId}\0${message.requestId}`);
    }
    const run = this.deliver(message).catch((error) => {
      this.log.warn(`push: send failed (${error instanceof Error ? error.message : String(error)})`);
    });
    this.inflight.add(run);
    void run.finally(() => this.inflight.delete(run)).catch(reportBackgroundError);
  }

  private async deliver(message: PushMessage): Promise<void> {
    await this.deliverIos(message);
    const fcm = this.fcm;
    if (!fcm) return;
    for (const device of this.androidDevices(message.personId)) {
      const outcome = await fcm.send(device.token, buildFcmMessage({ message, token: device.token }));
      if (!outcome.ok && outcome.prune) {
        this.deps.android?.store.prune(device.token);
        this.log.info(`push: removed Android device ${maskSecret(device.token)} (${outcome.status} ${outcome.reason})`);
      }
    }
  }

  private async deliverIos(message: PushMessage): Promise<void> {
    const sender = this.sender;
    if (!sender) return;
    const personSound = this.deps.personSound?.(message.personId) ?? true;
    const personSoundChoice = this.deps.personSoundChoice?.(message.personId);
    for (const device of this.devicesToSend(message.personId)) {
      const request = buildApnsRequest({ message, bundleId: this.bundleId, settings: device.settings, personSound, personSoundChoice, nowMs: this.now() });
      const outcome = await sender.send(device, request);
      if (!outcome.ok && outcome.prune) {
        this.deps.store.prune(device.token);
        this.log.info(`push: removed device ${maskSecret(device.token)} (${outcome.status} ${outcome.reason})`);
      }
    }
  }
}
