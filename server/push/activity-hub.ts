// Sends ActivityKit Live Activity pushes when a bot's state changes
// (working, needs you, done). Uses the same ApnsSender as alert pushes;
// never opens a real APNs host from tests (inject transport).
//
// Rate limit: prefer priority 5 for working line updates; priority 10 for
// needsYou and end (Apple's high-priority budget). Cap high-priority sends
// per person; skip a no-op when lastKind already matches.
import { ApnsSender, createHttp2Transport, type ApnsLog, type ApnsTransport } from "./apns.ts";
import {
  buildLiveActivityContentState,
  doneContentState,
  type LiveActivityContentState,
  type LiveActivityPhase,
} from "./activity-content.ts";
import type { LiveActivityTokenStore } from "./activity-devices.ts";
import { buildLiveActivityRequest } from "./activity-payload.ts";
import type { ApnsConfigResult } from "./config.ts";
import { maskSecret } from "./config.ts";
import { PushRateLimiter } from "./decide.ts";

/** High-priority Live Activity pushes per person in the window (Apple budget). */
const HIGH_PRIORITY_MAX = 12;
const HIGH_PRIORITY_WINDOW_MS = 60 * 60_000;
/** Minimum gap between priority-5 working updates for the same token. */
const WORKING_MIN_GAP_MS = 15_000;
/** Stale date for a card while the phone is away (matches LiveActivityPlan.backgroundStaleAfter). */
export const ACTIVITY_STALE_AFTER_SEC = 5 * 60;
/** Done card linger on the lock screen (matches LiveActivityPlan.doneLinger). */
export const ACTIVITY_DONE_LINGER_SEC = 120;

export interface LiveActivityUpdate {
  personId: string;
  botId: string;
  botName: string;
  phase: LiveActivityPhase;
  line?: string;
  threadId?: string;
  requestId?: string;
  options?: string[];
  isPermission?: boolean;
  confidential?: boolean;
  sinceMs?: number;
}

export interface LiveActivityHubDeps {
  config: ApnsConfigResult;
  store: LiveActivityTokenStore;
  transport?: ApnsTransport;
  now?: () => number;
  log?: ApnsLog;
  /** High-priority limiter (tests inject a tight one). */
  highPriorityLimiter?: PushRateLimiter;
  /** Skip pushes while this person has a live stream (app follows locally). */
  personStreaming?(person: string): boolean;
}

const defaultLog: ApnsLog = {
  info: (line) => console.log(line),
  warn: (line) => console.warn(line),
};

export class LiveActivityHub {
  readonly enabled: boolean;
  private readonly deps: LiveActivityHubDeps;
  private readonly sender: ApnsSender | null;
  private readonly log: ApnsLog;
  private readonly now: () => number;
  private readonly highLimiter: PushRateLimiter;
  private readonly inflight = new Set<Promise<void>>();
  private notConfiguredLogged = false;
  /** Last content we built per person\0bot (for done from prior). */
  private readonly lastContent = new Map<string, LiveActivityContentState>();

  constructor(deps: LiveActivityHubDeps) {
    this.deps = deps;
    this.log = deps.log ?? defaultLog;
    this.now = deps.now ?? Date.now;
    this.highLimiter = deps.highPriorityLimiter ?? new PushRateLimiter(HIGH_PRIORITY_MAX, HIGH_PRIORITY_WINDOW_MS);
    let sender: ApnsSender | null = null;
    if (deps.config.configured) {
      try {
        sender = new ApnsSender({
          config: deps.config.config,
          transport: deps.transport ?? createHttp2Transport(),
          now: this.now,
          log: this.log,
        });
      } catch (error) {
        this.log.warn(`push-activity: APNs key could not be loaded (${error instanceof Error ? error.message : String(error)})`);
        this.notConfiguredLogged = true;
      }
    }
    this.sender = sender;
    this.enabled = sender !== null;
  }

  /** Bot state change for one person. Never throws. */
  submit(update: LiveActivityUpdate): void {
    try {
      const person = update.personId.trim().toLowerCase();
      const botId = update.botId.trim();
      if (!person || !botId) return;
      const tokens = this.deps.store.listForBot(person, botId);
      if (!tokens.length) return;
      if (!this.sender) {
        if (!this.notConfiguredLogged) {
          this.notConfiguredLogged = true;
          const reason = this.deps.config.configured ? "key not loaded" : this.deps.config.reason;
          this.log.warn(`push-activity: APNs is not configured (${reason}); Live Activity pushes skipped`);
        }
        return;
      }
      if (this.deps.personStreaming?.(person)) return;
      const run = this.deliver({ ...update, personId: person, botId }).catch((error) => {
        this.log.warn(`push-activity: send failed (${error instanceof Error ? error.message : String(error)})`);
      });
      this.inflight.add(run);
      void run.finally(() => this.inflight.delete(run));
    } catch (error) {
      this.log.warn(`push-activity: could not queue (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  async drain(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled(this.inflight);
  }

  private contentKey(person: string, botId: string) {
    return `${person}\0${botId}`;
  }

  private async deliver(update: LiveActivityUpdate): Promise<void> {
    const sender = this.sender;
    if (!sender || !this.deps.config.configured) return;
    const bundleId = this.deps.config.config.bundleId;
    const nowMs = this.now();
    const tokens = this.deps.store.listForBot(update.personId, update.botId);
    if (!tokens.length) return;

    const event = update.phase === "done" || update.phase === "answered" ? "end" as const : "update" as const;
    const prior = this.lastContent.get(this.contentKey(update.personId, update.botId));
    let contentState: LiveActivityContentState;
    if (event === "end" && prior) {
      if (update.phase === "answered") {
        const { requestId: _omit, ...rest } = prior;
        contentState = {
          ...rest,
          kind: "answered",
          face: "happy",
          options: [],
          isPermission: false,
          line: update.line ?? prior.line,
        };
      } else {
        contentState = doneContentState(prior, nowMs);
      }
    } else {
      contentState = buildLiveActivityContentState({
        phase: update.phase,
        botName: update.botName,
        line: update.line,
        threadId: update.threadId,
        requestId: update.requestId,
        options: update.options,
        isPermission: update.isPermission,
        confidential: update.confidential,
        sinceMs: update.sinceMs,
      }, nowMs);
    }

    const priority: 5 | 10 = event === "end" || update.phase === "needsYou" ? 10 : 5;
    if (priority === 10 && !this.highLimiter.tryTake(update.personId, nowMs)) {
      this.log.warn(`push-activity: high-priority rate limited (${update.phase} bot ${update.botId})`);
      return;
    }

    const staleDateSec = event === "update" ? Math.floor(nowMs / 1000) + ACTIVITY_STALE_AFTER_SEC : undefined;
    const dismissalDateSec = event === "end"
      ? Math.floor(nowMs / 1000) + (update.phase === "answered" ? 0 : ACTIVITY_DONE_LINGER_SEC)
      : undefined;

    const request = buildLiveActivityRequest({
      event,
      contentState,
      bundleId,
      nowMs,
      staleDateSec,
      dismissalDateSec,
      priority,
    });

    for (const device of tokens) {
      if (device.lastKind === contentState.kind && event === "update" && contentState.kind === "working") {
        const gap = nowMs - (device.lastSentAt ?? 0);
        if (gap < WORKING_MIN_GAP_MS) continue;
      }
      if (device.lastKind === contentState.kind && event === "update" && device.lastSentAt
        && contentState.kind === "needsYou" && nowMs - device.lastSentAt < 2_000) {
        continue;
      }
      const outcome = await sender.send(
        { token: device.token, environment: device.environment },
        request,
      );
      if (outcome.ok) {
        this.deps.store.noteSent(update.personId, device.token, contentState.kind, nowMs);
      } else if (outcome.prune) {
        this.deps.store.prune(device.token);
        this.log.info(`push-activity: removed token ${maskSecret(device.token)} (${outcome.status} ${outcome.reason})`);
      }
    }

    if (event === "end") {
      this.deps.store.removeForBot(update.personId, update.botId);
      this.lastContent.delete(this.contentKey(update.personId, update.botId));
    } else {
      this.lastContent.set(this.contentKey(update.personId, update.botId), contentState);
    }
  }
}
