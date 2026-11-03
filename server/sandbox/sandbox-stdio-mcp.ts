// A person's own MCP server command, run in their server environment and
// relayed to a turn's engine (organization mode). The engine starts the
// usual stdio proxy on the Sagax host (server/user-sandbox-proxy.ts as the
// "sagax-stdio" tool server) holding only a turn capability that names the
// person and the server; every JSON-RPC frame it reads is posted here, and
// this file keeps one live process per person, server and thread inside the
// person's sandbox (sagax-sandboxd's signed stdio stream). The command never
// runs on the Sagax host, and nobody else's turn can reach it.
//
// Frames from the engine pass through as they are. Requests the server makes
// of its client (sampling, roots, elicitation) are answered "not supported";
// its notifications are dropped: the relay is request and answer only.
import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";

import type { SandboxStdioSpec } from "./sandboxd-core.ts";

type RpcId = string | number;
interface Frame {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  result?: unknown;
  error?: unknown;
}

const MAX_LINE_BYTES = 16 * 1024 * 1024;
const DEFAULT_IDLE_MS = 10 * 60_000;
const CALL_TIMEOUT_MS = 10 * 60_000;
const OTHER_TIMEOUT_MS = 2 * 60_000;

export class StdioRelayError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

interface Session {
  stream: Duplex;
  fingerprint: string;
  pending: Map<string, { resolve: (frame: Frame) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  buffer: Buffer;
  lastUsed: number;
  closed: boolean;
  firstLine: boolean;
  /** Why it closed, for a frame that arrives just after. */
  failure?: StdioRelayError;
}

export interface SandboxStdioRelayOptions {
  open: (principalId: string, spec: SandboxStdioSpec, botId?: string) => Promise<Duplex>;
  idleMs?: number;
  now?: () => number;
}

const idKey = (id: unknown) => `${typeof id}:${String(id)}`;

/** A spec's identity: a changed command or variable is a new process. */
export function stdioFingerprint(spec: SandboxStdioSpec): string {
  return createHash("sha256").update(JSON.stringify([spec.argv, Object.entries(spec.env ?? {}).sort()])).digest("hex");
}

export class SandboxStdioRelay {
  private readonly options: SandboxStdioRelayOptions;
  private readonly sessions = new Map<string, Session>();
  private readonly opening = new Map<string, Promise<Session>>();
  private readonly now: () => number;
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(options: SandboxStdioRelayOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  private sessionKey(input: { principalId: string; botId: string; threadId: string; server: string }): string {
    return [input.principalId, input.botId, input.threadId, input.server].join("\u0000");
  }

  private ensureSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  /** Close sessions idle past the limit (their sandbox may then idle out). */
  sweep(): void {
    const limit = this.options.idleMs ?? DEFAULT_IDLE_MS;
    for (const [key, session] of this.sessions) {
      if (!session.pending.size && this.now() - session.lastUsed > limit) this.close(key, session, "idle");
    }
  }

  private close(key: string, session: Session, why: string): void {
    if (this.sessions.get(key) === session) this.sessions.delete(key);
    if (session.closed) return;
    session.closed = true;
    session.failure ??= new StdioRelayError(why === "idle" ? "The MCP server was stopped." : `The MCP server in your server environment stopped (${why}).`, "stopped");
    for (const { reject, timer } of session.pending.values()) {
      clearTimeout(timer);
      reject(session.failure);
    }
    session.pending.clear();
    session.stream.destroy();
  }

  /** The latest frame of one person's open session, for an admin's list. */
  lastUsed(principalId: string, server?: string): number | undefined {
    let latest: number | undefined;
    for (const [key, session] of this.sessions) {
      if (session.closed) continue;
      const [person, , , name] = key.split("\u0000");
      if (person !== principalId || (server && name !== server)) continue;
      if (latest === undefined || session.lastUsed > latest) latest = session.lastUsed;
    }
    return latest;
  }

  /** Every session of one person (they removed or changed a server, or signed out). */
  closePerson(principalId: string, server?: string): void {
    for (const [key, session] of this.sessions) {
      const [person, , , name] = key.split("\u0000");
      if (person === principalId && (!server || name === server)) this.close(key, session, "removed");
    }
  }

  /** Every session of one thread (its engine process ended). */
  closeThread(threadId: string): void {
    for (const [key, session] of this.sessions) {
      if (key.split("\u0000")[2] === threadId) this.close(key, session, "thread ended");
    }
  }

  get size(): number {
    return this.sessions.size;
  }

  private async session(key: string, principalId: string, spec: SandboxStdioSpec, fresh: boolean, botId?: string): Promise<Session> {
    const fingerprint = stdioFingerprint(spec);
    const current = this.sessions.get(key);
    if (current && !current.closed && current.fingerprint === fingerprint && !fresh) return current;
    if (current) this.close(key, current, "restarted");
    const inFlight = this.opening.get(key);
    if (inFlight && !fresh) return inFlight;
    const opening = (async () => {
      const stream = await this.options.open(principalId, spec, botId);
      const session: Session = { stream, fingerprint, pending: new Map(), buffer: Buffer.alloc(0), lastUsed: this.now(), closed: false, firstLine: true };
      stream.on("data", (chunk: Buffer) => this.onData(key, session, chunk));
      stream.on("close", () => this.close(key, session, "exited"));
      stream.on("error", () => this.close(key, session, "error"));
      this.sessions.set(key, session);
      this.ensureSweeper();
      return session;
    })();
    this.opening.set(key, opening);
    try {
      return await opening;
    } finally {
      if (this.opening.get(key) === opening) this.opening.delete(key);
    }
  }

  private onData(key: string, session: Session, chunk: Buffer): void {
    session.buffer = session.buffer.length ? Buffer.concat([session.buffer, chunk]) : chunk;
    let newline: number;
    while ((newline = session.buffer.indexOf(10)) !== -1) {
      const line = session.buffer.subarray(0, newline).toString("utf8").trim();
      session.buffer = session.buffer.subarray(newline + 1);
      if (!line) continue;
      let frame: Frame & { sagaxStdioError?: unknown; message?: unknown };
      try { frame = JSON.parse(line) as Frame; } catch { continue; }
      if (session.firstLine && typeof frame.sagaxStdioError === "string") {
        const message = typeof frame.message === "string" ? frame.message : "the server environment refused the command";
        session.failure = new StdioRelayError(`The MCP server could not start in your server environment: ${message}.`, frame.sagaxStdioError);
        this.close(key, session, frame.sagaxStdioError);
        return;
      }
      session.firstLine = false;
      const hasId = frame.id !== undefined && frame.id !== null;
      if (hasId && typeof frame.method === "string") {
        // The server asks something of its client: not supported here.
        session.stream.write(`${JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: { code: -32601, message: "Not supported by Sagax." } })}\n`);
        continue;
      }
      if (hasId) {
        const waiting = session.pending.get(idKey(frame.id));
        if (waiting) {
          clearTimeout(waiting.timer);
          session.pending.delete(idKey(frame.id));
          waiting.resolve(frame);
        }
      }
    }
    if (session.buffer.length > MAX_LINE_BYTES) this.close(key, session, "a line too long");
  }

  /** Relay one frame from the engine. A request resolves with the server's
   * answer; a notification or an answer to the server resolves with null. */
  async relay(input: { principalId: string; botId: string; threadId: string; server: string; spec: SandboxStdioSpec; frame: unknown }): Promise<Frame | null> {
    const frame = input.frame as Frame | null;
    if (!frame || typeof frame !== "object" || Array.isArray(frame) || frame.jsonrpc !== "2.0") throw new StdioRelayError("Invalid request.", "invalid");
    const key = this.sessionKey(input);
    // A new initialize is a new client (the engine relaunched): a new process.
    const fresh = frame.method === "initialize" && this.sessions.has(key);
    const isRequest = typeof frame.method === "string" && frame.id !== undefined && frame.id !== null;
    if (isRequest && typeof frame.id !== "string" && typeof frame.id !== "number") throw new StdioRelayError("Invalid request.", "invalid");
    const session = await this.session(key, input.principalId, input.spec, fresh, input.botId);
    if (session.closed) throw session.failure ?? new StdioRelayError("The MCP server stopped.", "stopped");
    session.lastUsed = this.now();
    const line = `${JSON.stringify(frame)}\n`;
    if (!isRequest) {
      session.stream.write(line);
      return null;
    }
    const id = frame.id as RpcId;
    if (session.pending.has(idKey(id))) throw new StdioRelayError("A request with this id is already waiting.", "invalid");
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(idKey(id));
        reject(new StdioRelayError("The MCP server did not answer in time.", "timeout"));
      }, frame.method === "tools/call" ? CALL_TIMEOUT_MS : OTHER_TIMEOUT_MS);
      timer.unref?.();
      session.pending.set(idKey(id), { resolve, reject, timer });
      session.stream.write(line);
    }).finally(() => { session.lastUsed = this.now(); });
  }

  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const [key, session] of this.sessions) this.close(key, session, "server stopping");
  }
}
