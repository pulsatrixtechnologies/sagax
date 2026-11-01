// Server, API and event-stream plumbing of the qualification runner. One
// isolated server per task (a temporary data directory and home, free ports,
// the repository's fake engines), so no task can contaminate another and a
// restart task can stop and start its own server on the same data.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { verificationServerArgs, verificationServerEnvironment } from "../control-omb.ts";
import { removeTempDir, waitForExit } from "../../server/testing/cleanup.ts";
import { freePortBlock } from "../../server/testing/ports.ts";
import type { EngineProfile } from "./engines.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const FAKE_CLAUDE_CLI = join(ROOT, "server", "testing", "fake-claude-cli.ts");
export const FAKE_ACP_CLI = join(ROOT, "server", "testing", "fake-acp-cli.ts");

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const now = () => performance.now();

export interface ServerOptions {
  profile: EngineProfile;
  /** Fake knobs for this task, written into the engine's environment. */
  engineEnv?: Record<string, string> | ((paths: ServerPaths) => Record<string, string>);
  /** Extra engine instances (a limited primary), merged before the main one. */
  extraInstances?: (paths: ServerPaths) => Record<string, unknown>;
  /** Extra top level config. */
  config?: Record<string, unknown> | ((paths: ServerPaths) => Record<string, unknown>);
  /** Extra environment for the server child (test seams). */
  serverEnv?: Record<string, string>;
  /** Fake room plan for delegation: the file is created empty. */
  room?: boolean;
}

export interface ServerPaths {
  dataDir: string;
  prompts: string;
  launchLog: string;
  roomPlan: string;
  /** FAKE_CLAUDE_GATE_DIR: a reply holds until its gate file exists here. */
  gates: string;
}

export class QualServer {
  readonly url: string;
  readonly port: number;
  readonly dataDir: string;
  readonly paths: ServerPaths;
  child: ChildProcess | undefined;
  private readonly options: ServerOptions;
  private closed = false;

  private constructor(options: ServerOptions, port: number, dataDir: string) {
    this.options = options;
    this.port = port;
    this.url = `http://127.0.0.1:${port}`;
    this.dataDir = dataDir;
    this.paths = {
      dataDir,
      prompts: join(dataDir, "qual-prompts.jsonl"),
      launchLog: join(dataDir, "qual-launches.jsonl"),
      roomPlan: join(dataDir, "room-plan.json"),
      gates: join(dataDir, "gates"),
    };
  }

  static async start(options: ServerOptions): Promise<QualServer> {
    const port = await freePortBlock([0, 1]);
    const dataDir = mkdtempSync(join(tmpdir(), "sagax-qualification-"));
    mkdirSync(join(dataDir, "tmp"), { recursive: true });
    mkdirSync(join(dataDir, "gates"), { recursive: true });
    const server = new QualServer(options, port, dataDir);
    server.writeConfig();
    try {
      await server.spawnChild();
    } catch (error) {
      await server.close();
      throw error;
    }
    return server;
  }

  private writeConfig() {
    const { profile, engineEnv, extraInstances, config, room } = this.options;
    const env: Record<string, string> = {
      ...profile.engineEnv(this.paths),
      ...(room ? { FAKE_CLAUDE_ROOM_PLAN: this.paths.roomPlan } : {}),
      ...(typeof engineEnv === "function" ? engineEnv(this.paths) : engineEnv),
    };
    const instances = {
      ...extraInstances?.(this.paths),
      claude: {
        driver: "claudeAgent",
        displayName: profile.label,
        config: { cli: profile.claudeCli, permissionMode: "bypassPermissions" },
        ...(Object.keys(env).length ? { environment: env } : {}),
      },
    };
    // 0600: for a real engine this file carries the variables the person
    // chose to pass (see engines.ts), and lives only as long as the server.
    writeFileSync(join(this.dataDir, "config.json"), JSON.stringify({ ...(typeof config === "function" ? config(this.paths) : config), instances }, null, 2), { mode: 0o600 });
  }

  private async spawnChild() {
    const childEnv = verificationServerEnvironment(
      { FAKE_CLAUDE_MODE: "happy", SAGAX_CONTENT_ENCRYPTION: process.env.SAGAX_CONTENT_ENCRYPTION },
      this.dataDir,
      this.port,
    );
    Object.assign(childEnv, this.options.serverEnv ?? {});
    const child = spawn(process.execPath, verificationServerArgs(childEnv), {
      cwd: ROOT,
      env: childEnv,
      stdio: "ignore",
    });
    this.child = child;
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("the qualification server exited before it was ready");
      try {
        const response = await fetch(`${this.url}/api/health`, { signal: AbortSignal.timeout(1_000) });
        const body = response.ok ? await response.json() as { app?: string } : null;
        if (body?.app === "openmausbot") return;
      } catch { /* still starting */ }
      if (Date.now() > deadline) throw new Error("the qualification server did not become ready in 30 seconds");
      await sleep(100);
    }
  }

  get alive(): boolean {
    return Boolean(this.child && this.child.exitCode === null && this.child.signalCode === null);
  }

  /** Stop the server, politely or by force, and wait until it is gone. */
  async stop(signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): Promise<void> {
    const child = this.child;
    if (!child) return;
    if (signal === "SIGKILL") {
      child.kill("SIGKILL");
      await waitForExit(child, { graceMs: 5_000 });
    } else {
      await waitForExit(child, { signal: "SIGTERM" });
    }
  }

  /** Start the same server again on the same data and port. */
  async restart(signal: "SIGTERM" | "SIGKILL"): Promise<void> {
    await this.stop(signal);
    await this.spawnChild();
  }

  /** Every engine process this server launched (fake claude logs one line per launch). */
  enginePids(): number[] {
    if (!existsSync(this.paths.launchLog)) return [];
    return readFileSync(this.paths.launchLog, "utf8").split("\n").filter(Boolean).flatMap((line) => {
      try { return [(JSON.parse(line) as { pid: number }).pid]; } catch { return []; }
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.stop("SIGTERM").catch(() => undefined);
    // A crash leaves its engine behind until that engine notices; make sure.
    for (const pid of this.enginePids()) {
      try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    }
    await removeTempDir(this.dataDir);
  }

  async api<T = any>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<{ status: number; body: T }> {
    const response = await fetch(this.url + path, {
      method,
      headers: { "content-type": "application/json", origin: this.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, body: parsed as T };
  }

  /** Let a held reply finish: the fake engine polls for this file. */
  openGate(name: string) {
    writeFileSync(join(this.paths.gates, name), "go");
  }

  promptLog(): string[] {
    if (!existsSync(this.paths.prompts)) return [];
    return readFileSync(this.paths.prompts, "utf8").split("\n").filter(Boolean);
  }
}

// ---- event stream ----

export interface TimedFrame { t: number; frame: any }

/** One /api/events connection with the arrival time of every frame. */
export class SseTap {
  readonly frames: TimedFrame[] = [];
  /** Highest numbered frame seen, the cursor a reconnect offers. */
  lastSeq = 0;
  hello: { cursor?: string; resumed?: boolean } | undefined;
  /** The server's stream id, from its hello: a cursor is "<stream id>:<seq>". */
  get streamId(): string {
    return (this.hello?.cursor ?? "").split(":")[0] ?? "";
  }
  private controller = new AbortController();
  private done: Promise<void> = Promise.resolve();

  static async open(url: string, since?: string | number): Promise<SseTap> {
    const tap = new SseTap();
    const query = since === undefined ? "" : `?since=${encodeURIComponent(String(since))}`;
    const response = await fetch(`${url}/api/events${query}`, {
      headers: { accept: "text/event-stream", origin: url },
      signal: tap.controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`event stream refused: ${response.status}`);
    tap.done = tap.read(response.body.getReader());
    await tap.waitFor((frame) => frame.kind === "hello", 5_000);
    return tap;
  }

  private async read(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let split: number;
        while ((split = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const data = chunk.split("\n").find((line) => line.startsWith("data: "));
          if (!data) continue;
          try {
            const frame = JSON.parse(data.slice(6));
            if (frame.kind === "hello") this.hello = frame;
            if (typeof frame.seq === "number" && frame.seq > this.lastSeq) this.lastSeq = frame.seq;
            this.frames.push({ t: now(), frame });
          } catch { /* a partial or comment frame */ }
        }
      }
    } catch { /* aborted or the server went away */ }
  }

  async waitFor(predicate: (frame: any) => boolean, timeoutMs: number): Promise<any | undefined> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.frames.find((entry) => predicate(entry.frame));
      if (hit) return hit.frame;
      if (Date.now() > deadline) return undefined;
      await sleep(25);
    }
  }

  close() {
    this.controller.abort();
  }

  async closed() {
    this.close();
    await this.done;
  }
}
