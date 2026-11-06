// A CLI sign-in that prints a page and no one-time code (Cursor's
// `cursor-agent login`). The command runs on the machine that runs the
// engine, with the same binary and environment as its turns. Only an
// allowlisted page is returned. The sign-in is confirmed by the driver's
// own check, never by the process exiting.
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { cursorSignInPrompt, stripSignInSecrets } from "../../shared/cli-sign-in.ts";
import type { ProviderAuthenticationStart, ProviderAuthenticationStatus } from "../contracts.ts";
import { killCliTree, spawnCli } from "../procs.ts";
import { canonicalPath } from "./device-auth.ts";
import { reportBackgroundError } from "../background-error.ts";

const MAX_OUTPUT = 16_384;
const linkHomes = new Set<string>();

type Env = Record<string, string | undefined>;

/** What differs between CLIs that sign in by opening a page. */
export interface LinkSignIn {
  product: string;
  account: string;
  /** `$homeEnv`, else `~/homeDir`. One sign-in at a time runs per home. */
  homeEnv: string;
  homeDir: string;
  loginArgs: readonly string[];
  install: string;
  /** Extra environment for the login command only (NO_OPEN_BROWSER, BROWSER). */
  spawnEnv?: Record<string, string>;
  /** Whether the sign-in a turn uses is now there. */
  signedIn(env: Env, cli: string): boolean | Promise<boolean>;
}

export interface LinkSignInOptions {
  cli: string;
  environment: () => Env;
  onAuthenticated?: () => Promise<void>;
  startupTimeoutMs?: number;
  lifetimeMs?: number;
  pollMs?: number;
  terminateTimeoutMs?: number;
}

type Flow = {
  status: ProviderAuthenticationStatus;
  child: ChildProcess | null;
  ready: boolean;
  resolve: (value: ProviderAuthenticationStart) => void;
  reject: (error: Error) => void;
  startupTimer: NodeJS.Timeout;
  expiryTimer: NodeJS.Timeout;
  pollTimer: NodeJS.Timeout | null;
  homeKey: string;
  stopping?: Promise<void>;
  terminationFailed?: boolean;
};

/** A fixed login command. CLI output stays in bounded private memory; only
 * an allowlisted page is exposed. */
export class LinkSignInController {
  private flow: Flow | null = null;
  private disposed = false;
  private readonly spec: LinkSignIn;
  private readonly options: LinkSignInOptions;

  constructor(spec: LinkSignIn, options: LinkSignInOptions) {
    this.spec = spec;
    this.options = options;
  }

  private home(env: Env): { home: string; homeKey: string } {
    const { homeEnv, homeDir, product } = this.spec;
    const home = env.HOME || env.USERPROFILE || homedir();
    const named = env[homeEnv];
    if (!isAbsolute(home) || (named && !isAbsolute(named))) {
      throw new Error(`Use an absolute HOME and ${homeEnv} path for this server's ${product} provider before signing in.`);
    }
    return { home, homeKey: canonicalPath(resolve(named || join(home, homeDir))) };
  }

  private async confirmed(env: Env): Promise<boolean> {
    try { return await this.spec.signedIn(env, this.options.cli); } catch { return false; }
  }

  async start(): Promise<ProviderAuthenticationStart> {
    const { product, account } = this.spec;
    if (this.disposed) throw new Error("This provider was removed. Refresh Settings before signing in.");
    if (this.flow?.status.phase === "waiting") {
      if (this.flow.ready) return { ...this.flow.status, phase: "waiting" };
      throw new Error(`A ${account} sign-in is already starting. Please wait for the page.`);
    }
    await this.flow?.stopping;
    if (this.disposed) throw new Error("This provider was removed. Refresh Settings before signing in.");
    const env = this.options.environment();
    const { home, homeKey } = this.home(env);
    if (linkHomes.has(homeKey)) {
      throw new Error(`A ${account} sign-in is already running for this server account. Finish or cancel it before starting another.`);
    }
    if (await this.confirmed(env)) {
      return { phase: "succeeded", flowId: null, authorizationUrl: null, expiresAt: null };
    }
    linkHomes.add(homeKey);
    return new Promise<ProviderAuthenticationStart>((resolveStart, reject) => {
      const flow: Flow = {
        status: {
          phase: "waiting", flowId: randomUUID(), authorizationUrl: null,
          expiresAt: new Date(Date.now() + (this.options.lifetimeMs ?? 15 * 60_000)).toISOString(),
        },
        child: null, ready: false, resolve: resolveStart, reject, homeKey, pollTimer: null,
        startupTimer: setTimeout(() => this.finish(flow, "failed", `${product} did not provide a sign-in page in time. Check the server connection and update ${product}, then try again.`), this.options.startupTimeoutMs ?? 30_000),
        expiryTimer: setTimeout(() => this.finish(flow, "expired", `The ${account} sign-in expired. Start sign-in again.`), this.options.lifetimeMs ?? 15 * 60_000),
      };
      flow.startupTimer.unref();
      flow.expiryTimer.unref();
      this.flow = flow;
      this.spawn(flow, env, home);
    });
  }

  async get(flowId: string): Promise<ProviderAuthenticationStatus> {
    if (!flowId || this.flow?.status.flowId !== flowId) throw new Error("This sign-in is no longer available. Start sign-in again.");
    return { ...this.flow.status };
  }

  async cancel(): Promise<void> {
    if (this.flow?.status.phase === "waiting") this.finish(this.flow, "cancelled", `${this.spec.account} sign-in cancelled.`);
    await this.flow?.stopping;
    if (this.flow?.terminationFailed) throw new Error(this.flow.status.message);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.cancel();
    this.flow = null;
  }

  private spawn(flow: Flow, env: Env, cwd: string): void {
    const { product } = this.spec;
    let child: ReturnType<typeof spawnCli>;
    try {
      child = spawnCli(this.options.cli, [...this.spec.loginArgs], {
        env: { ...env, NO_COLOR: "1", ...this.spec.spawnEnv },
        cwd, stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      this.finish(flow, "failed", `${product} could not start on this server. Install or update the configured ${product} CLI, then try again.`);
      return;
    }
    flow.child = child;
    child.stdin?.end();
    let output = "";
    const receive = (chunk: Buffer) => {
      if (flow.status.phase !== "waiting") return;
      if (output.length + chunk.length > MAX_OUTPUT) {
        this.finish(flow, "failed", `${product} returned an unexpected sign-in response. Update the server's ${product} CLI and try again.`);
        return;
      }
      output += chunk.toString("utf8");
      const prompt = !flow.ready ? cursorSignInPrompt(stripVTControlCharacters(output)) : null;
      if (prompt) {
        flow.status = { ...flow.status, authorizationUrl: prompt.authorizationUrl };
        flow.ready = true;
        clearTimeout(flow.startupTimer);
        flow.resolve({ ...flow.status, phase: "waiting" });
        this.watch(flow, env);
      }
    };
    child.stdout?.on("data", receive);
    child.stderr?.on("data", receive);
    child.once("error", (error: NodeJS.ErrnoException) => {
      const message = error.code === "ENOENT"
        ? `${product} is not installed on this server. ${this.spec.install}`
        : `${product} could not start on this server. Check the configured CLI path and its executable permissions.`;
      this.finish(flow, "failed", message);
    });
    child.once("close", () => {
      if (flow.child === child) flow.child = null;
      if (flow.status.phase !== "waiting") return;
      void this.confirmed(env).then((ok) => {
        if (flow.status.phase !== "waiting") return;
        this.finish(flow, ok ? "succeeded" : "failed", ok ? undefined : this.failure(output));
      }).catch(reportBackgroundError);
    });
  }

  private watch(flow: Flow, env: Env): void {
    const poll = () => {
      if (flow.status.phase !== "waiting") return;
      void this.confirmed(env).then((ok) => {
        if (ok && flow.status.phase === "waiting") this.finish(flow, "succeeded");
      }).catch(reportBackgroundError);
    };
    flow.pollTimer = setInterval(poll, this.options.pollMs ?? 2_000);
    flow.pollTimer.unref();
  }

  /** A safe sentence. The CLI's own words may carry the page or a token. */
  private failure(output: string): string {
    const { product } = this.spec;
    const clean = stripSignInSecrets(stripVTControlCharacters(output));
    if (/connection refused|failed to connect|could not connect|network is unreachable|timed out|certificate/i.test(clean)) {
      return `${product} could not reach its sign-in service from this server. Check the server's outbound connection, then try again.`;
    }
    if (/not found|not installed|no such file|command not found/i.test(clean)) {
      return `${product} is not installed on this server. ${this.spec.install}`;
    }
    return `${product} sign-in did not finish. Start sign-in again.`;
  }

  private finish(flow: Flow, phase: Exclude<ProviderAuthenticationStatus["phase"], "waiting">, message?: string): void {
    const { product } = this.spec;
    if (flow.status.phase !== "waiting") return;
    clearTimeout(flow.startupTimer);
    clearTimeout(flow.expiryTimer);
    if (flow.pollTimer) clearInterval(flow.pollTimer);
    flow.status = {
      phase, flowId: flow.status.flowId, authorizationUrl: null, expiresAt: null,
      ...(phase !== "succeeded" && message ? { message } : {}),
    };
    if (!flow.ready) {
      if (phase === "succeeded") flow.resolve({ ...flow.status, phase });
      else flow.reject(new Error(message ?? `${product} sign-in did not finish.`));
    }
    flow.stopping = this.stopChild(flow.child).catch(() => false).then((stopped) => {
      const release = () => linkHomes.delete(flow.homeKey);
      if (stopped) { release(); return; }
      flow.terminationFailed = true;
      flow.status = { ...flow.status, phase: "failed", message: `${product} could not be stopped on this server. Ask the server administrator to stop the login process before trying again.` };
      const child = flow.child;
      if (!child || child.exitCode !== null || child.signalCode !== null) release();
      else child.once("close", release);
    });
    if (phase === "succeeded") void this.options.onAuthenticated?.().catch(reportBackgroundError);
  }

  private async stopChild(child: ChildProcess | null): Promise<boolean> {
    if (!child || await killCliTree(child, this.options.terminateTimeoutMs ?? 1500)) return true;
    if (process.platform !== "win32" && child.pid) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    } else child.kill("SIGKILL");
    await new Promise<void>((resolveStop) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolveStop();
      const timer = setTimeout(resolveStop, 1500);
      timer.unref();
      child.once("close", () => { clearTimeout(timer); resolveStop(); });
    });
    return child.exitCode !== null || child.signalCode !== null;
  }
}
