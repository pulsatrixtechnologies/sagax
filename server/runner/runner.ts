// sagax-runner: the process inside a cloud agent run's Pod (spec
// 2026-10-18-cloud-agents-design.md, sections 3.1 and 4.2; contract
// runner <-> Perspicax of 2026-10-19). One run per process:
//
//   bootstrap -> state setup -> secrets -> clone -> branch -> setup
//   -> erase setup_only -> state running -> engine turn (events relayed)
//   -> verify -> commit -> stats, diff, commits -> bundle -> state idle
//   -> long poll of commands (followup: another turn in the same session;
//      approve: answer an ask; stop: end) ... until stop or a 401.
//
// The runner never listens on a port, never holds a write token, and masks
// every known secret (and the run token) in what it sends.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { RuntimeEvent } from "../contracts.ts";
import { capDiff, parseUnifiedDiff } from "./diff.ts";
import { decisionFor, mapRuntimeEvent, type EngineFactory, type PendingAsk, type RunnerEngineHandle } from "./engine.ts";
import { AGENT_EMAIL_DEFAULT, AGENT_NAME, GitError, RunGit, authorEnv, runBranchProblem, type GitAuthor } from "./git.ts";
import { Masker } from "./mask.ts";
import {
  MAX_DIFF_BYTES,
  RunnerHttpError,
  RunnerUnauthorized,
  parseBootstrap,
  parseSecrets,
  type ControlClient,
  type RunnerBootstrap,
  type RunnerCommand,
  type RunnerEvent,
  type RunState,
} from "./protocol.ts";
import { EventRelay, terminalEvents, truncateUtf8 } from "./relay.ts";
import { SecretStore } from "./secrets.ts";

/** The largest bundle Perspicax accepts (its API body limit). */
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
/** Above this the raw diff is not read whole (memory). */
const MAX_DIFF_TEXT_BYTES = 32 * 1024 * 1024;
const TAIL_BYTES = 4 * 1024;

export type RunnerExit = "stopped" | "expired" | "unauthorized" | "terminated" | "failed";

export interface RunnerDeps {
  client: ControlClient;
  token: string;
  engineFactory: EngineFactory;
  /** HOME of the Pod (/workspace): the clone goes in <workspace>/repo. */
  workspace: string;
  /** Memory-backed directory for the secrets. */
  secretsDir: string;
  /** Writable directory for the engines' own state. */
  stateDir: string;
  /** Environment of setup and verify (PATH, HOME, LANG). */
  env?: Record<string, string | undefined>;
  git?: string;
  shell?: string;
  agentEmail?: string;
  pollWaitSec?: number;
  setupTimeoutMs?: number;
  verifyTimeoutMs?: number;
  relayFlushDelayMs?: number;
  /** Aborted on SIGTERM: the runner stops its engine and exits. */
  signal?: AbortSignal;
  /** PX_RUN_ID: the bootstrap must name the same run. */
  runId?: string;
  /** How long a bootstrap without an answer (or a 5xx) is retried. */
  bootstrapRetryMs?: number;
  log?: (line: string) => void;
}

export interface RunnerResult {
  exit: RunnerExit;
  error?: string;
}

class Stop extends Error {}

/** stop: the `stop` command; expired: max duration; unauthorized: 401;
 * terminated: SIGTERM (the Pod is going away). */
export type StopReason = "stop" | "expired" | "unauthorized" | "terminated";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** What the first turn of this Pod sends: the prompt, or a followup on a
 * relaunched Pod (resuming the engine's session when one is known, else
 * with the context rebuilt from the run's summary). */
export function firstTurn(b: RunnerBootstrap): { text: string; resumeCursor?: string; recoveryText?: string; userEcho?: string } {
  if (!b.followup) {
    return b.resume?.session_id ? { text: b.prompt, resumeCursor: b.resume.session_id } : { text: b.prompt };
  }
  const rebuilt = [
    "Original task:",
    b.prompt,
    "",
    `Summary of the work already done on branch ${b.branch}:`,
    b.resume?.summary?.trim() || "(no summary)",
    "",
    "Follow-up request:",
    b.followup.text,
  ].join("\n");
  if (b.resume?.session_id) return { text: b.followup.text, resumeCursor: b.resume.session_id, recoveryText: rebuilt, userEcho: b.followup.text };
  return { text: rebuilt, userEcho: b.followup.text };
}

export function runSystemNote(b: RunnerBootstrap): string {
  return [
    `You are a cloud coding agent working in a clone of ${b.repo.owner}/${b.repo.name}, on branch ${b.branch} (base ${b.base_branch}).`,
    "Work in the current folder. Do not push and do not change remotes: after each turn the runner runs the verification commands, commits your changes and publishes the branch as a draft pull request.",
  ].join(" ");
}

export async function runRunner(deps: RunnerDeps): Promise<RunnerResult> {
  const runner = new Runner(deps);
  const onAbort = () => runner.halt("terminated");
  if (deps.signal?.aborted) onAbort();
  deps.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await runner.run();
  } finally {
    deps.signal?.removeEventListener("abort", onAbort);
  }
}

class Runner {
  private readonly masker = new Masker();
  private readonly relay: EventRelay;
  private readonly secrets: SecretStore;
  private readonly log: (line: string) => void;
  private bootstrap!: RunnerBootstrap;
  private git!: RunGit;
  private engine: RunnerEngineHandle | null = null;
  private unsubscribe: (() => void) | null = null;
  private sessionId: string | null = null;
  private baseSha = "";
  private author: GitAuthor = { name: AGENT_NAME, email: AGENT_EMAIL_DEFAULT };
  private lastPushed = "";
  private state: RunState | null = null;
  private stopReason: StopReason | null = null;
  private interrupted = false;
  private readonly stopped = deferred<void>();
  private readonly pollAbort = new AbortController();
  private poller: Promise<void> | null = null;
  private afterSeq = 0;
  private followups: string[] = [];
  private wake: (() => void) | null = null;
  private active: { turnId?: string; done: (ok: boolean) => void } | null = null;
  private readonly asks = new Map<string, PendingAsk>();
  private readonly shellItems = new Map<string, string>();
  private expiryTimer: NodeJS.Timeout | null = null;

  private readonly deps: RunnerDeps;

  constructor(deps: RunnerDeps) {
    this.deps = deps;
    this.log = deps.log ?? ((line) => process.stderr.write(`${line}\n`));
    this.masker.add(deps.token);
    this.secrets = new SecretStore(deps.secretsDir);
    this.relay = new EventRelay({
      client: deps.client,
      masker: this.masker,
      flushDelayMs: deps.relayFlushDelayMs,
      onUnauthorized: () => this.halt("unauthorized"),
      onError: (error) => this.log(`sagax-runner: events not sent yet (${this.masker.mask(String(error instanceof Error ? error.message : error))})`),
    });
  }

  private emit(event: RunnerEvent, urgent = false): void {
    this.relay.emit(event, urgent);
  }

  private setState(state: RunState, error?: string): void {
    if (this.state === state && !error) return;
    this.state = state;
    this.emit({ kind: "state", data: error ? { state, error: truncateUtf8(error, TAIL_BYTES) } : { state } }, true);
  }

  private warn(text: string): void {
    this.emit({ kind: "warning", data: { text } });
  }

  private get stopping(): boolean {
    return this.stopReason !== null;
  }

  /** Stop request, expiry or dead token: everything waiting wakes up. */
  halt(reason: StopReason): void {
    if (this.stopReason === "unauthorized") return;
    if (this.stopReason && reason !== "unauthorized") return;
    this.stopReason = reason;
    if (reason === "unauthorized") this.relay.kill();
    this.stopped.resolve();
    this.wake?.();
  }

  async run(): Promise<RunnerResult> {
    try {
      await this.prepare();
      let turn: ReturnType<typeof firstTurn> | null = firstTurn(this.bootstrap);
      while (turn && !this.stopping) {
        if (turn.userEcho) this.emit({ kind: "message", data: { role: "user", text: turn.userEcho } });
        const finished = await this.runTurn(turn);
        if (!finished || this.stopping) break;
        try {
          await this.publish();
        } catch (error) {
          if (error instanceof RunnerUnauthorized) throw error;
          this.warn(`Publication du tour impossible : ${this.masker.mask(error instanceof Error ? error.message : String(error))}`);
        }
        if (this.stopping) break;
        if (!this.followups.length) this.setState("idle");
        const next = await this.nextFollowup();
        turn = next === null ? null : { text: next };
      }
      return await this.end();
    } catch (error) {
      if (error instanceof RunnerUnauthorized) this.halt("unauthorized");
      if (this.stopReason === "unauthorized") return this.end();
      if (error instanceof Stop || this.stopping) return this.end();
      const message = this.masker.mask(error instanceof Error ? error.message : String(error));
      this.log(`sagax-runner: run failed: ${message}`);
      this.setState("failed", message);
      return this.end({ exit: "failed", error: message });
    }
  }

  // ── setup ────────────────────────────────────────────────────────────

  private async prepare(): Promise<void> {
    const raw = await this.bootstrapWithRetry();
    this.bootstrap = parseBootstrap(raw, this.deps.client.base);
    const b = this.bootstrap;
    if (this.deps.runId && b.run_id !== this.deps.runId) throw new Error("le bootstrap ne correspond pas à PX_RUN_ID");
    // A followup Pod never replays what an earlier Pod consumed (an old stop).
    this.afterSeq = b.commands_after;
    this.author = b.author ?? { name: AGENT_NAME, email: this.deps.agentEmail ?? AGENT_EMAIL_DEFAULT };
    this.setState("setup");
    this.poller = this.pollCommands();
    this.armExpiry(b.limits.max_duration_sec);

    // Secrets first, so their values are masked in anything that follows.
    const secretsRaw = await this.deps.client.secrets();
    if (secretsRaw === null) {
      this.warn("Les secrets de l'environnement ont déjà été remis à ce Pod (409) ; le run continue sans eux.");
    } else {
      const list = parseSecrets(secretsRaw);
      const tooShort = this.masker.add(...list.map((secret) => secret.value));
      if (tooShort.length) this.warn(`${tooShort.length} secret(s) trop court(s) pour être masqué(s) dans la sortie.`);
      for (const problem of this.secrets.write(list)) this.warn(`Secret ${problem.name} ignoré : ${problem.reason}.`);
    }

    const branchProblem = runBranchProblem(b.branch, b.base_branch);
    if (branchProblem) throw new Error(branchProblem);
    this.git = new RunGit({
      dir: join(this.deps.workspace, "repo"),
      gitUrl: b.git_url,
      token: this.deps.token,
      git: this.deps.git,
      env: this.deps.env,
      author: this.author,
    });
    const how = await this.git.cloneOrReuse();
    if (how === "reused") this.emit({ kind: "terminal", data: { text: "Clone existant réutilisé (volume du run).\n" } });
    const { baseSha, startSha } = await this.git.checkoutBranch(b.branch, b.base_branch, b.existing_branch);
    // Perspicax's own record wins: the base at launch and the last push it
    // accepted are what the incremental bundle starts from.
    this.baseSha = b.base_sha && await this.git.hasCommit(b.base_sha) ? b.base_sha : baseSha;
    if (b.base_sha && this.baseSha !== b.base_sha) this.warn("La base indiquée par Perspicax est introuvable dans le clone ; base lue sur le dépôt.");
    this.lastPushed = b.last_pushed_sha && await this.git.hasCommit(b.last_pushed_sha) ? b.last_pushed_sha : (b.last_pushed_sha ? startSha : (startSha === baseSha ? this.baseSha : startSha));
    if (this.stopping) throw new Stop();

    if (b.setup.trim()) {
      const result = await this.shell(b.setup, { env: this.secrets.setupEnv(), timeoutMs: this.deps.setupTimeoutMs ?? 30 * 60_000, label: "setup" });
      if (result.code !== 0) this.warn(`Le script setup a échoué (code ${result.code ?? "délai dépassé"}) ; le run continue sur l'image de base.`);
      // A process setup left behind still holds the setup_only secrets in
      // its environment: none survives setup.
      const killed = killProcessesHolding(this.secrets.setupOnlyValues());
      if (killed) this.warn(`${killed} processus laissé(s) par setup avec des secrets setup_only ont été arrêtés.`);
    }
    // The agent never sees a setup_only secret.
    this.secrets.eraseSetupOnly();
    if (this.stopping) throw new Stop();

    this.engine = await this.deps.engineFactory({
      engine: b.engine,
      model: b.model,
      effort: b.effort,
      cwd: this.git.dir,
      stateDir: this.deps.stateDir,
      approvalMode: b.approval_level,
      environment: {
        ANTHROPIC_BASE_URL: b.model_proxy.anthropic,
        ANTHROPIC_API_KEY: this.deps.token,
        OPENAI_BASE_URL: `${b.model_proxy.openai}/v1`,
        OPENAI_API_KEY: this.deps.token,
        ...authorEnv(this.author),
        // Read-only root and filtered egress: no self-update, no extra calls.
        DISABLE_AUTOUPDATER: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        ...this.secrets.agentEnv(),
      },
    });
    this.unsubscribe = this.engine.adapter.onEvent((event) => this.onEngineEvent(event));
  }

  /** Perspicax may be briefly unreachable while the Pod starts: retry a
   * missing answer or a 5xx for about two minutes; anything else fails. */
  private async bootstrapWithRetry(): Promise<unknown> {
    const deadline = Date.now() + (this.deps.bootstrapRetryMs ?? 120_000);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.deps.client.bootstrap();
      } catch (error) {
        const retryable = error instanceof RunnerHttpError && (error.status === 0 || error.status >= 500);
        if (!retryable || Date.now() > deadline || this.stopping) throw error;
        await sleep(Math.min(15_000, 1_000 * 2 ** Math.min(attempt, 4)));
      }
    }
  }

  // ── turns ────────────────────────────────────────────────────────────

  /** One engine turn. false = the run stops (stop, expiry, 401). */
  private async runTurn(turn: { text: string; resumeCursor?: string; recoveryText?: string }): Promise<boolean> {
    const engine = this.engine!;
    this.setState("running");
    this.interrupted = false;
    const completion = deferred<boolean>();
    this.active = { done: completion.resolve };
    const resumeCursor = turn.resumeCursor ?? this.sessionId ?? undefined;
    try {
      const started = await engine.adapter.sendTurn({
        ...engine.turnDefaults,
        threadId: this.bootstrap.run_id,
        text: turn.text,
        system: runSystemNote(this.bootstrap),
        ...(resumeCursor ? { resumeCursor } : {}),
        ...(turn.recoveryText ? { recoveryText: turn.recoveryText } : {}),
      });
      if (this.active) this.active.turnId = started.turnId;
    } catch (error) {
      this.active = null;
      throw new Error(`Le moteur n'a pas pu démarrer le tour : ${error instanceof Error ? error.message : String(error)}`);
    }
    const outcome = await Promise.race([completion.promise, this.stopped.promise.then(() => null)]);
    if (outcome === null) {
      // Stop during the turn: the engine stops, nothing is published.
      await this.interruptActive();
      await Promise.race([completion.promise, sleep(10_000, true)]);
      this.active = null;
      return false;
    }
    this.active = null;
    this.asks.clear();
    if (!outcome && !this.interrupted) this.warn("Le tour du moteur s'est terminé en erreur ; le travail fait jusque-là est conservé.");
    return true;
  }

  private async interruptActive(): Promise<void> {
    if (!this.engine || !this.active) return;
    await this.engine.adapter.interruptTurn(this.bootstrap.run_id, this.active.turnId).catch(() => undefined);
  }

  private onEngineEvent(raw: RuntimeEvent): void {
    if (raw.threadId && this.bootstrap && raw.threadId !== this.bootstrap.run_id) return;
    // Masked whole, before any cut or truncation: a secret is never split
    // into two halves that each escape the mask.
    const event = this.masker.maskDeep(raw);
    if (event.type === "turn.completed") {
      this.active?.done(event.ok);
      return;
    }
    if (event.type === "session.started" && event.sessionId) this.sessionId = event.sessionId;
    if (event.type === "request.resolved" && event.requestId) {
      this.asks.delete(event.requestId);
      if (!this.asks.size && this.state === "waiting_for_approval") this.setState("running");
    }
    const { events, ask } = mapRuntimeEvent(event);
    for (const out of events) this.emit(out);
    if (event.type === "item.started" && event.itemType === "tool" && event.summary && event.itemId) this.shellItems.set(event.itemId, event.summary);
    if (event.type === "item.completed" && event.itemType === "tool" && event.itemId && this.shellItems.has(event.itemId)) {
      const command = this.shellItems.get(event.itemId)!;
      this.shellItems.delete(event.itemId);
      for (const out of terminalEvents(`$ ${command}\n${event.output ?? ""}\n`)) this.emit(out);
    }
    if (ask) {
      this.asks.set(ask.approvalId, ask);
      this.setState("waiting_for_approval");
    }
  }

  private nextFollowup(): Promise<string | null> {
    if (this.stopping) return Promise.resolve(null);
    if (this.followups.length) return Promise.resolve(this.followups.shift()!);
    return new Promise((resolve) => {
      this.wake = () => {
        this.wake = null;
        resolve(this.stopping ? null : this.followups.shift() ?? null);
      };
    });
  }

  // ── commands ─────────────────────────────────────────────────────────

  private async pollCommands(): Promise<void> {
    let failures = 0;
    while (!this.stopping) {
      try {
        const { commands, lastSeq } = await this.deps.client.commands(this.afterSeq, this.deps.pollWaitSec ?? 25, this.pollAbort.signal);
        failures = 0;
        for (const command of commands) {
          if (command.seq <= this.afterSeq) continue;
          await this.dispatch(command);
        }
        if (lastSeq !== null && lastSeq > this.afterSeq) this.afterSeq = lastSeq;
      } catch (error) {
        if (error instanceof RunnerUnauthorized) { this.halt("unauthorized"); return; }
        if (this.pollAbort.signal.aborted || this.stopping) return;
        failures++;
        this.log(`sagax-runner: commands not read (${error instanceof Error ? error.message : String(error)})`);
        await sleep(Math.min(30_000, 500 * 2 ** Math.min(failures, 6)));
      }
    }
  }

  /** The run's own deadline, from now (the bootstrap, then each duration an
   * admin extended). Perspicax enforces it too; the Pod's hard deadline is
   * the 12 h cap. */
  private armExpiry(seconds: number): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(() => {
      this.warn("Durée maximale du run atteinte : le runner s'arrête.");
      this.halt("expired");
    }, Math.min(seconds * 1000, 2 ** 31 - 1));
    this.expiryTimer.unref?.();
  }

  private async dispatch(command: RunnerCommand): Promise<void> {
    this.afterSeq = Math.max(this.afterSeq, command.seq);
    if (command.kind === "stop") {
      this.halt("stop");
      return;
    }
    if (command.kind === "limits") {
      this.armExpiry(command.data.max_duration_sec);
      this.log(`sagax-runner: durée du run prolongée (${Math.round(command.data.max_duration_sec / 60)} min restantes)`);
      return;
    }
    if (command.kind === "approve") {
      const ask = this.asks.get(command.data.approval_id);
      if (!ask || !this.engine) {
        this.warn(`Approbation ${command.data.approval_id.slice(0, 64)} inconnue ou déjà réglée.`);
        return;
      }
      this.asks.delete(ask.approvalId);
      await this.engine.adapter.respondToRequest(this.bootstrap.run_id, ask.requestId, decisionFor(ask, command.data.option)).catch((error) => {
        this.warn(`Réponse d'approbation non transmise au moteur : ${error instanceof Error ? error.message : String(error)}`);
      });
      if (!this.asks.size && this.state === "waiting_for_approval") this.setState("running");
      return;
    }
    const { text, mode } = command.data;
    this.emit({ kind: "message", data: { role: "user", text } });
    if (this.active && this.engine) {
      if (mode === "steer" && this.engine.adapter.steer) {
        const outcome = await this.engine.adapter.steer(this.bootstrap.run_id, text).catch(() => "refused" as const);
        if (outcome !== "refused") return;
      }
      if (mode === "interrupt") {
        this.followups.unshift(text);
        this.interrupted = true;
        await this.interruptActive();
        return;
      }
    }
    this.followups.push(text);
    this.wake?.();
  }

  // ── after a turn ─────────────────────────────────────────────────────

  private async publish(): Promise<void> {
    const b = this.bootstrap;
    const verify = [];
    // An interrupted turn goes straight on to the next request: its work is
    // committed and published, verify runs after the next turn.
    for (const cmd of this.interrupted ? [] : b.verify) {
      if (this.stopping) return;
      const result = await this.shell(cmd, { env: this.secrets.agentEnv(), timeoutMs: this.deps.verifyTimeoutMs ?? 20 * 60_000, label: "verify" });
      verify.push({ cmd, ok: result.code === 0, exit_code: result.code, tail: result.tail });
    }
    if (verify.length) this.emit({ kind: "verify", data: { commands: verify } });
    if (this.stopping) return;

    const branch = await this.git.currentBranch();
    if (branch !== b.branch) {
      this.warn(`Le moteur a quitté la branche ${b.branch} ; le runner y revient.`);
      await this.git.git(["checkout", "--quiet", b.branch]);
    }
    const title = (b.title.trim() || "Travail de l'agent").split("\n")[0]!.slice(0, 120);
    const failed = verify.filter((v) => !v.ok).length;
    const body = verify.length ? `\n\nVérifications : ${verify.length - failed}/${verify.length} réussies.` : "";
    await this.git.commitAll(this.masker.mask(`${title}${body}\n\nRun ${b.run_id}`));

    const from = (await this.git.text(["merge-base", this.baseSha, "HEAD"], { allowFail: true })).trim() || this.baseSha;
    const stats = await this.git.stats(from);
    this.emit({ kind: "stats", data: stats });
    const rawDiff = await this.git.diffText(from, MAX_DIFF_TEXT_BYTES).catch(() => null);
    if (rawDiff === null) this.warn("Le diff est trop volumineux pour être affiché ; seuls les totaux sont envoyés.");
    const maskedDiff = rawDiff === null ? "" : this.masker.mask(rawDiff);
    const { files, truncated } = capDiff(parseUnifiedDiff(maskedDiff), MAX_DIFF_BYTES);
    this.emit({ kind: "diff", data: { files } });
    if (truncated) this.warn("Le diff est trop volumineux : certains fichiers n'ont que leurs totaux.");
    this.emit({ kind: "commits", data: { commits: await this.git.commits(from) } });

    if (stats.head_sha === this.lastPushed) return;
    // A secret value (or the run token) in what would be pushed: the branch
    // is not published. The masked diff would hide it from the person while
    // the pull request carried it in clear.
    const leaked = await this.leakedFiles(from, rawDiff, maskedDiff);
    if (leaked) {
      this.warn(`Branche non publiée : un secret de l'environnement figure dans ${leaked}. Retirez-le puis demandez une suite.`);
      return;
    }
    let bundle: Buffer;
    try {
      bundle = await this.git.bundle(b.branch, this.lastPushed, MAX_BUNDLE_BYTES);
    } catch (error) {
      this.warn(`Bundle non créé : ${error instanceof GitError ? error.message : error instanceof Error ? error.message : String(error)}`);
      return;
    }
    await Promise.race([this.relay.flush(), this.stopped.promise, sleep(30_000, true)]);
    if (this.stopping) return;
    try {
      const result = await this.deps.client.bundle(bundle);
      if (result.status === "refused") {
        this.warn(`Perspicax a refusé la branche : ${this.masker.mask(result.reason ?? "sans raison donnée")}`);
      } else {
        // received (the push follows on Perspicax's side) or pushed: the
        // next bundle starts from this commit.
        this.lastPushed = result.head_sha ?? stats.head_sha;
      }
    } catch (error) {
      if (error instanceof RunnerUnauthorized) throw error;
      const detail = error instanceof RunnerHttpError ? error.message : String(error);
      this.warn(`Branche non publiée : ${detail}`);
    }
  }

  /** Files of the run's changes (or commit messages) that contain a known
   * secret, named for the warning; null when clean. */
  private async leakedFiles(from: string, rawDiff: string | null, maskedDiff: string): Promise<string | null> {
    const messages = await this.git.text(["log", "--format=%B", `${from}..HEAD`]);
    const where: string[] = [];
    if (this.masker.mask(messages) !== messages) where.push("un message de commit");
    if (rawDiff === null) {
      // Too big to read whole: check each changed file's new content.
      const names = (await this.git.text(["diff", "--name-only", "-z", `${from}..HEAD`])).split("\0").filter(Boolean);
      for (const name of names) {
        const blob = await this.git.git(["cat-file", "-p", `HEAD:${name}`], { allowFail: true, maxBytes: 64 * 1024 * 1024 }).catch(() => null);
        const text = blob?.stdout.toString("utf8") ?? "";
        if (text && this.masker.mask(text) !== text) where.push(name);
      }
    } else if (maskedDiff !== rawDiff) {
      for (const file of parseUnifiedDiff(rawDiff)) {
        const added = file.hunks.flatMap((h) => h.lines.filter((l) => l.kind === "add").map((l) => l.text)).join("\n");
        if (this.masker.mask(added) !== added || this.masker.mask(file.path) !== file.path) where.push(this.masker.mask(file.path));
      }
      if (!where.length) where.push("le diff");
    }
    return where.length ? where.slice(0, 10).join(", ") : null;
  }

  /** setup and verify: bash -c in the clone, output masked and relayed. */
  private shell(command: string, options: { env: Record<string, string>; timeoutMs: number; label: string }): Promise<{ code: number | null; tail: string }> {
    return new Promise((resolve) => {
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(this.deps.env ?? process.env)) if (value !== undefined) env[key] = value;
      Object.assign(env, authorEnv(this.author), { GIT_TERMINAL_PROMPT: "0" }, options.env);
      this.emit({ kind: "terminal", data: { text: truncateUtf8(`$ ${this.masker.mask(command)}\n`, 16 * 1024) } });
      const child = spawn(this.deps.shell ?? "bash", ["-c", command], { cwd: this.git.dir, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
      const stream = this.masker.stream();
      let tail = "";
      let buffered = "";
      const out = (chunk: Buffer) => {
        const text = stream.push(chunk.toString("utf8"));
        buffered += text;
        tail = (tail + text).slice(-TAIL_BYTES * 2);
        if (buffered.length >= 8 * 1024) { for (const e of terminalEvents(buffered)) this.emit(e); buffered = ""; }
      };
      child.stdout.on("data", out);
      child.stderr.on("data", out);
      const killGroup = (signal: NodeJS.Signals) => { try { process.kill(-child.pid!, signal); } catch { child.kill(signal); } };
      const timer = setTimeout(() => { killGroup("SIGTERM"); setTimeout(() => killGroup("SIGKILL"), 5_000).unref?.(); }, options.timeoutMs);
      let settled = false;
      const onStop = () => { if (!settled) killGroup("SIGTERM"); };
      void this.stopped.promise.then(onStop);
      const done = (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Nothing the command started outlives it (a daemon keeps the
        // environment it was given).
        killGroup("SIGKILL");
        const rest = stream.end();
        buffered += rest;
        tail += rest;
        if (buffered) for (const e of terminalEvents(buffered)) this.emit(e);
        this.emit({ kind: "terminal", data: { text: `[${options.label}: code ${code ?? "arrêté"}]\n` } });
        resolve({ code, tail: truncateTail(tail) });
      };
      child.on("error", () => done(127));
      // exit, not close: a background process holding the pipes must not
      // keep the command running until its timeout. A short grace lets
      // the last output arrive.
      child.on("exit", (code) => { setTimeout(() => done(code), 200); });
      child.on("close", (code) => done(code));
    });
  }

  // ── end ──────────────────────────────────────────────────────────────

  private async end(result?: RunnerResult): Promise<RunnerResult> {
    const reason = this.stopReason;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    // The contract: `stop` -> finished. An expiry or a SIGTERM is
    // Perspicax's to name (expired, stopped).
    if (reason === "stop") this.setState("finished");
    this.pollAbort.abort();
    this.wake?.();
    if (reason !== "unauthorized") {
      await Promise.race([this.relay.flush(), sleep(15_000, true)]);
    }
    this.relay.kill();
    this.unsubscribe?.();
    await this.interruptActive();
    await this.engine?.dispose().catch(() => undefined);
    this.secrets.wipeAll();
    await Promise.race([this.poller ?? Promise.resolve(), sleep(1_000, true)]);
    if (result) return result;
    if (reason === "unauthorized") return { exit: "unauthorized" };
    if (reason === "expired") return { exit: "expired" };
    if (reason === "terminated") return { exit: "terminated" };
    return { exit: "stopped" };
  }
}

function truncateTail(text: string): string {
  if (Buffer.byteLength(text) <= TAIL_BYTES) return text;
  const bytes = Buffer.from(text);
  return bytes.subarray(bytes.length - TAIL_BYTES).toString("utf8").replace(/^�+/, "");
}

/** A backoff keeps the process alive (unref = false): during the bootstrap
 * retries nothing else holds the event loop. Guards that only bound a wait
 * pass unref = true. */
function sleep(ms: number, unref = false): Promise<void> {
  return new Promise((resolve) => { const t = setTimeout(resolve, ms); if (unref) t.unref?.(); });
}

/** Linux: kill every process of this uid (but this one) whose environment
 * holds one of `values`. Returns how many were killed. Elsewhere (tests on
 * macOS) there is no /proc and nothing to do beyond the group kill. */
export function killProcessesHolding(values: string[], procDir = "/proc"): number {
  if (!values.length || !existsSync(procDir)) return 0;
  let killed = 0;
  for (const name of readdirSync(procDir)) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    let environ: string;
    try { environ = readFileSync(join(procDir, name, "environ"), "latin1"); } catch { continue; }
    const utf8 = Buffer.from(environ, "latin1").toString("utf8");
    if (!values.some((value) => utf8.includes(value))) continue;
    try { process.kill(Number(name), "SIGKILL"); killed++; } catch { /* gone or not ours */ }
  }
  return killed;
}

