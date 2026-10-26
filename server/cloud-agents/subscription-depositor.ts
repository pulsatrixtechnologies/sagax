// Personal cloud agent runs (Perspicax #384, lot P1.9, spec section 4.4): a
// run whose `token_source` is `personnel` calls its model through
// Perspicax's proxy with the SHORT access token of its requester's own
// engine subscription. Perspicax keeps that token in memory only and never
// sees a refresh token; this server, which holds the person's sign-in
// (principal-engine-logins.ts), hands it over and renews it:
//
//   - when the run turns live (Perspicax refuses a deposit while it is
//     `queued` or ended): a run launched from Sagax is watched closely
//     (`watch`), every other one (the console, an MCP client, an
//     automation) is found by the regular sweep of `GET /runs?mine=true`;
//   - again before the token expires, while the run stays live;
//   - never for someone else's run (only runs this person asked for, with
//     their own rights).
//
// Without a sign-in here for the run's engine, Perspicax falls back on a
// personal API key the person keeps in its vault (Perspicax reads it, never
// this server). Only when they have neither is a launch refused, and a run
// started elsewhere shows why (`status`) in the Code view.
//
// One person is handled at a time (`person` is serialized per person), so
// the engine CLI never renews the same sign-in twice at once; a renewal that
// gave nothing new waits (backoff) before the CLI runs again. People with no
// live personal run are swept less often. Nothing here writes a token to
// disk or logs one; the in-memory record keeps a digest of what was handed
// over.
import { createHash } from "node:crypto";

import type { PerspicaxRun } from "../../shared/cloud-agents.ts";
import type { CodeSubscription } from "../../shared/code-runs.ts";
import type { SubscriptionTokenBody, SubscriptionTokenDeposit } from "../perspicax-link.ts";
import { ENGINE_DRIVER, ENGINE_PROVIDER, runEngine, type RunEngine, type SubscriptionAccess, type SubscriptionDriver } from "./subscription-access.ts";

/** What the Code view says about a personal run's subscription: `ok`
 * (handed over, valid until `until`), `missing` (neither a sign-in here nor
 * a key in Perspicax for the run's engine), `expired` (the sign-in ran out
 * and the CLI could not renew it), `refused` (Perspicax said no: personal
 * subscriptions off, a bad token). */
export type SubscriptionStatus = CodeSubscription;

export interface DepositorDeps {
  /** The people to sweep: those with a sign-in for Claude or Codex here. */
  people: () => string[];
  /** The person's Perspicax user id (their subject), to keep to their runs. */
  subjectOf: (principalId: string) => string | null;
  /** The person's live sign-in access token, or null. */
  subjectToken: (principalId: string) => Promise<string | null>;
  /** The person's runs (`GET /runs?mine=true`), with their sign-in token. */
  runs: (subjectToken: string) => Promise<PerspicaxRun[]>;
  signedIn: (principalId: string, driver: SubscriptionDriver) => boolean;
  /** The person keeps a key for this provider in Perspicax's vault (names
   * only, from the directory): Perspicax then serves the run without us. */
  vaultKey?: (principalId: string, provider: "anthropic" | "openai") => boolean;
  read: (principalId: string, engine: RunEngine) => Promise<SubscriptionAccess | null>;
  /** The engine CLI renews the person's sign-in in its directory. */
  renew: (principalId: string, engine: RunEngine) => Promise<void>;
  deposit: (subjectToken: string, runId: string, body: SubscriptionTokenBody) => Promise<SubscriptionTokenDeposit>;
  now?: () => number;
  log?: (line: string) => void;
}

/** Hand the token over again when this little life is left. */
export const RENEW_MARGIN_MS = 15 * 60_000;
/** Perspicax refuses a token said to live longer (24 h); stay under it. */
export const MAX_DECLARED_MS = 23 * 3_600_000;
/** A token whose file gives no expiry is declared for this long. */
export const UNKNOWN_LIFE_MS = 30 * 60_000;
export const SWEEP_MS = 60_000;
/** A person with no live personal run last time is swept this often. */
export const QUIET_SWEEP_MS = 5 * 60_000;
/** A run launched here is looked at this often until its token is in. */
export const WATCH_MS = 4_000;
export const WATCH_FOR_MS = 5 * 60_000;
/** After a renewal that gave nothing fresh, the CLI waits this long, then longer. */
export const RENEW_BACKOFF_MS = [5 * 60_000, 15 * 60_000] as const;
/** After Perspicax refused a token, it is offered again this much later. */
export const REFUSED_RETRY_MS = 10 * 60_000;
/** The pause after a failed hand-off that is not a refusal. */
const OTHER_RETRY_MS = 30_000;

const LIVE = new Set(["waking", "provisioning", "setup", "running", "waiting_for_approval", "idle"]);

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export class SubscriptionDepositor {
  private readonly deps: DepositorDeps;
  private readonly now: () => number;
  private readonly handed = new Map<string, { digest: string; until: number }>();
  private readonly statuses = new Map<string, { principalId: string; status: SubscriptionStatus; error?: string }>();
  private readonly watched = new Map<string, { principalId: string; until: number }>();
  /** One pass per person at a time. */
  private readonly busy = new Map<string, Promise<string[]>>();
  /** (person, engine) -> no CLI renewal before this time, and the step. */
  private readonly renewWait = new Map<string, { until: number; step: number }>();
  /** run -> no deposit before this time (Perspicax refused the last one). */
  private readonly refusedUntil = new Map<string, number>();
  /** person -> when they had no live personal run (quiet sweep). */
  private readonly quietSince = new Map<string, number>();
  private readonly lastSwept = new Map<string, number>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private watchTimer: NodeJS.Timeout | null = null;
  private sweeping: Promise<void> | null = null;
  private watching = false;

  constructor(deps: DepositorDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /** What the Code view shows for a run, to the person it belongs to only. */
  status(runId: string, principalId?: string): SubscriptionStatus | undefined {
    const entry = this.statuses.get(runId);
    return entry && (principalId === undefined || entry.principalId === principalId) ? entry.status : undefined;
  }

  /** Before a launch: the person can run this engine on their own
   * subscription here, or on a key of theirs in Perspicax. The refusal is
   * the text the bot or the Code view shows. */
  ready(principalId: string, engineName: string): { ok: true } | { ok: false; message: string } {
    const engine = runEngine(engineName);
    if (!engine) return { ok: true };
    if (this.deps.signedIn(principalId, ENGINE_DRIVER[engine])) return { ok: true };
    if (this.deps.vaultKey?.(principalId, ENGINE_PROVIDER[engine])) return { ok: true };
    return { ok: false, message: missingMessage(engine) };
  }

  /** A run launched here: looked at often until its token is handed over. */
  watch(principalId: string, runId: string): void {
    if (!this.deps.signedIn(principalId, "claudeAgent") && !this.deps.signedIn(principalId, "codex")) return;
    this.watched.set(runId, { principalId, until: this.now() + WATCH_FOR_MS });
    if (!this.watchTimer) {
      this.watchTimer = setInterval(() => { void this.tickWatched(); }, WATCH_MS);
      this.watchTimer.unref?.();
    }
  }

  start(): void {
    this.stop();
    this.sweepTimer = setInterval(() => { void this.sweep(); }, SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.sweepTimer = null;
    this.watchTimer = null;
  }

  /** One pass over every person's live personal runs (a quiet person only
   * every QUIET_SWEEP_MS). */
  async sweep(): Promise<void> {
    if (this.sweeping) return this.sweeping;
    this.sweeping = (async () => {
      const now = this.now();
      const seen = new Set<string>();
      const swept = new Set<string>();
      for (const principalId of this.deps.people()) {
        const quiet = this.quietSince.has(principalId);
        if (quiet && now - (this.lastSwept.get(principalId) ?? 0) < QUIET_SWEEP_MS) continue;
        swept.add(principalId);
        for (const id of await this.person(principalId).catch(() => [] as string[])) seen.add(id);
      }
      // Runs of the people swept that ended or left: forget them.
      for (const [id, entry] of this.statuses) {
        if (swept.has(entry.principalId) && !seen.has(id) && !this.watched.has(id)) {
          this.statuses.delete(id);
          this.handed.delete(id);
          this.refusedUntil.delete(id);
        }
      }
    })().finally(() => { this.sweeping = null; });
    return this.sweeping;
  }

  private async tickWatched(): Promise<void> {
    if (this.watching) return;
    this.watching = true;
    try {
      const now = this.now();
      const people = new Set<string>();
      for (const [runId, entry] of this.watched) {
        if (entry.until < now || this.handed.has(runId)) this.watched.delete(runId);
        else people.add(entry.principalId);
      }
      if (this.watched.size === 0 && this.watchTimer) {
        clearInterval(this.watchTimer);
        this.watchTimer = null;
      }
      for (const principalId of people) await this.person(principalId).catch(() => []);
    } finally {
      this.watching = false;
    }
  }

  /** One person's live personal runs: hand over or renew each one's token.
   * Serialized per person. Returns the ids of the runs it looked at. */
  person(principalId: string): Promise<string[]> {
    const running = this.busy.get(principalId);
    if (running) return running;
    const pass = this.personPass(principalId).finally(() => { this.busy.delete(principalId); });
    this.busy.set(principalId, pass);
    return pass;
  }

  private async personPass(principalId: string): Promise<string[]> {
    this.lastSwept.set(principalId, this.now());
    const subject = this.deps.subjectOf(principalId);
    const signIn = subject ? await this.deps.subjectToken(principalId) : null;
    if (!subject || !signIn) return [];
    const runs = (await this.deps.runs(signIn)).filter((run) =>
      run.token_source === "personnel" && LIVE.has(run.state)
      && run.requested_by === subject && run.runs_as === subject);
    if (runs.length) this.quietSince.delete(principalId);
    else if (!this.quietSince.has(principalId)) this.quietSince.set(principalId, this.now());
    const fresh = new Map<RunEngine, SubscriptionAccess | null>();
    for (const run of runs) await this.one(principalId, signIn, run, fresh);
    return runs.map((run) => run.id);
  }

  /** The person's access for an engine, renewed by the CLI when it nears its
   * end (once per pass, and not again during a backoff). */
  private async access(principalId: string, engine: RunEngine, fresh: Map<RunEngine, SubscriptionAccess | null>): Promise<SubscriptionAccess | null> {
    if (fresh.has(engine)) return fresh.get(engine)!;
    const now = this.now();
    let access = await this.deps.read(principalId, engine);
    const stale = (value: SubscriptionAccess | null) => !value || (value.expiresAt !== null && value.expiresAt - now < RENEW_MARGIN_MS);
    const key = `${principalId}\n${engine}`;
    const wait = this.renewWait.get(key);
    if (stale(access) && (!wait || wait.until <= now)) {
      const before = access?.accessToken;
      await this.deps.renew(principalId, engine).catch(() => {});
      access = (await this.deps.read(principalId, engine)) ?? access;
      if (stale(access) && access?.accessToken === before) {
        const step = Math.min((wait?.step ?? -1) + 1, RENEW_BACKOFF_MS.length - 1);
        this.renewWait.set(key, { until: now + RENEW_BACKOFF_MS[step], step });
      } else {
        this.renewWait.delete(key);
      }
    }
    fresh.set(engine, access);
    return access;
  }

  private async one(principalId: string, signIn: string, run: PerspicaxRun, fresh: Map<RunEngine, SubscriptionAccess | null>): Promise<void> {
    const engine = runEngine(run.engine);
    if (!engine) return;
    if (!this.deps.signedIn(principalId, ENGINE_DRIVER[engine])) {
      // Perspicax serves it on the person's vault key, if they keep one.
      if (!this.deps.vaultKey?.(principalId, ENGINE_PROVIDER[engine])) this.setStatus(principalId, run.id, { state: "missing", engine });
      return;
    }
    const now = this.now();
    if ((this.refusedUntil.get(run.id) ?? 0) > now) return;
    const access = await this.access(principalId, engine, fresh);
    if (!access || (access.expiresAt !== null && access.expiresAt <= now + 60_000)) {
      this.setStatus(principalId, run.id, { state: "expired", engine });
      return;
    }
    const until = Math.min(access.expiresAt ?? now + UNKNOWN_LIFE_MS, now + MAX_DECLARED_MS);
    const sum = digest(access.accessToken);
    const before = this.handed.get(run.id);
    if (before && before.digest === sum && before.until - now >= RENEW_MARGIN_MS) return;
    const answer = await this.deps.deposit(signIn, run.id, {
      provider: access.provider,
      access_token: access.accessToken,
      expires_at: new Date(until).toISOString(),
      ...(access.accountId ? { account_id: access.accountId } : {}),
    });
    if (answer.ok) {
      this.handed.set(run.id, { digest: sum, until });
      this.refusedUntil.delete(run.id);
      this.setStatus(principalId, run.id, { state: "ok", engine, until: new Date(until).toISOString() });
      return;
    }
    if (answer.error === "forbidden" || answer.error === "rejected") {
      this.refusedUntil.set(run.id, now + REFUSED_RETRY_MS);
      this.setStatus(principalId, run.id, { state: "refused", engine }, answer.error);
      return;
    }
    // An older Perspicax (405) or a run gone: wait as long as for a refusal;
    // any other failure: a short pause, never a retry every few seconds.
    this.refusedUntil.set(run.id, now + (answer.error === "unsupported" || answer.error === "gone" ? REFUSED_RETRY_MS : OTHER_RETRY_MS));
    this.setStatus(principalId, run.id, this.statuses.get(run.id)?.status ?? { state: "expired", engine }, answer.error);
  }

  private setStatus(principalId: string, runId: string, next: SubscriptionStatus, error?: string): void {
    const before = this.statuses.get(runId);
    const label = `${next.state}${error ? ` (${error})` : ""}`;
    const previous = before ? `${before.status.state}${before.error ? ` (${before.error})` : ""}` : "";
    if (label !== previous) this.deps.log?.(`[cloud-agents] run ${runId}: subscription ${label}, ${next.engine}`);
    this.statuses.set(runId, { principalId, status: next, ...(error ? { error } : {}) });
  }
}

const ENGINE_LABEL: Readonly<Record<RunEngine, string>> = { "claude-code": "Claude", codex: "ChatGPT (Codex)" };

function missingMessage(engine: RunEngine): string {
  return `This run uses your own ${ENGINE_LABEL[engine]} subscription, and you have neither a ${ENGINE_LABEL[engine]} sign-in in Sagax nor a key for it in Perspicax. Connect it in Sagax (Settings, My subscriptions and keys), then start the run again.`;
}
