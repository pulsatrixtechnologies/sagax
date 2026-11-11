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
//
// #3623: a turn that starts an engine process starts the server again (a new
// initialize is a new client), and the engine waits for its tool list before
// the prompt leaves. So the relay keeps, per person, bot, server and command
// (with its variables), the server's last answer to initialize and to an
// unpaged tools/list. A later engine gets both at once from that copy while
// the server starts in the background with the engine's own initialize; every
// other frame waits for that start, then reaches the server as before. Each
// list served from the copy is checked again in the background (a tools/list
// of its own on the new process), and so is a list the server says changed
// (notifications/tools/list_changed): the next turn gets the fresh one. The
// copy is never shared between two people, and goes with a changed command or
// variable (a new sign-in in the server's variables), a removed, changed or
// stopped server, the person's sign-out, a start that failed and a check
// that failed. A call to a tool the server no longer serves gets the
// server's own answer, as before.
import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";

import type { SandboxStdioSpec } from "./sandboxd-core.ts";

type RpcId = string | number;
interface Frame {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

const MAX_LINE_BYTES = 16 * 1024 * 1024;
const DEFAULT_IDLE_MS = 10 * 60_000;
const CALL_TIMEOUT_MS = 10 * 60_000;
const OTHER_TIMEOUT_MS = 2 * 60_000;
/** A server that stopped before its first answer is not started again for
 * this long (same command and variables); a changed spec retries at once. */
export const START_FAILURE_MS = 30 * 60_000;
/** Closes that say something about the server itself: its process ended
 * (or broke the stream) before any answer, or the environment refused this
 * command as such. A refusal of the environment (busy, capacity, paused,
 * not_running, image_missing, egress_policy, pool_full, internal) passes and
 * is never remembered: the next frame tries again (#3181). */
const START_FAILURE_REASONS = new Set(["exited", "error", "a line too long", "bad_stdio", "too_large"]);

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
  /** The server answered at least one frame: it started. */
  answered: boolean;
  principalId: string;
  server: string;
  /** Why it closed, for a frame that arrives just after. */
  failure?: StdioRelayError;
  /** #3623: the server's answer to the engine's initialize, sent when the
   * session opened; every later frame waits for it. */
  ready?: Promise<Frame>;
  /** #3623: the kept copy this session's answers refresh. */
  keptKey: string;
}

/** #3623: what the relay keeps of one server of one person between turns. */
interface Kept {
  /** the server's initialize result, for the protocol version asked */
  init?: { version: unknown; result: unknown };
  /** the server's unpaged tools/list result */
  list?: unknown;
  refreshing?: boolean;
}

/** #3623: a part of a tool list's path, for the turn's latency line:
 * open, hello, list (ms) and kb (the list's size). */
export type StdioRelayPart = (part: string, value: number) => void;

export interface SandboxStdioRelayOptions {
  open: (principalId: string, spec: SandboxStdioSpec, botId?: string) => Promise<Duplex>;
  idleMs?: number;
  now?: () => number;
  /** Told once when a server stops before its first answer (#3181). */
  onStartFailure?: (input: { principalId: string; server: string; error: StdioRelayError }) => void;
}

const idKey = (id: unknown) => `${typeof id}:${String(id)}`;

/** A spec's identity: a changed command or variable is a new process. */
export function stdioFingerprint(spec: SandboxStdioSpec): string {
  return createHash("sha256").update(JSON.stringify([spec.argv, Object.entries(spec.env ?? {}).sort()])).digest("hex");
}

export class SandboxStdioRelay {
  private readonly options: SandboxStdioRelayOptions;
  private readonly sessions = new Map<string, Session>();
  private readonly opening = new Map<string, { promise: Promise<Session>; fingerprint: string }>();
  /** principal\0server\0fingerprint: a start that failed, kept
   * START_FAILURE_MS (#3181). Two servers of the same name with different
   * commands keep a mark each. */
  private readonly startFailures = new Map<string, { at: number; error: StdioRelayError }>();
  /** #3623: principal\0bot\0server\0fingerprint -> the kept answers. */
  private readonly kept = new Map<string, Kept>();
  private relayIds = 0;
  private readonly now: () => number;
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(options: SandboxStdioRelayOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  private sessionKey(input: { principalId: string; botId: string; threadId: string; server: string }): string {
    return [input.principalId, input.botId, input.threadId, input.server].join("\u0000");
  }

  private keptKey(input: { principalId: string; botId: string; server: string }, fingerprint: string): string {
    return [input.principalId, input.botId, input.server, fingerprint].join("\u0000");
  }

  /** An id of the relay's own requests, never one an engine sends. */
  private relayId(): string {
    this.relayIds += 1;
    return `sagax-relay-${this.relayIds}`;
  }

  /** The kept answers of one server, made when missing; a copy for another
   * command of the same server goes (only the current one is ever served). */
  private keep(keptKey: string): Kept {
    let entry = this.kept.get(keptKey);
    if (entry) return entry;
    const prefix = keptKey.slice(0, keptKey.lastIndexOf("\u0000") + 1);
    for (const old of this.kept.keys()) if (old.startsWith(prefix)) this.kept.delete(old);
    entry = {};
    this.kept.set(keptKey, entry);
    return entry;
  }

  /** Drops the kept answers of one person (or one of their servers): a
   * removed, changed or stopped server, or the person signed out. */
  forgetKept(principalId: string, server?: string): void {
    for (const key of this.kept.keys()) {
      const [person, , name] = key.split("\u0000");
      if (person === principalId && (!server || name === server)) this.kept.delete(key);
    }
  }

  /** Whether a tools/list answer can be kept: a whole list, not a page. */
  private static keepableList(result: unknown): boolean {
    const value = result as { tools?: unknown; nextCursor?: unknown } | null;
    return Boolean(value) && typeof value === "object" && Array.isArray(value!.tools) && (value!.nextCursor === undefined || value!.nextCursor === null);
  }

  /** Asks the server for its tool list again and keeps the answer (#3623):
   * after a list served from the copy, and when the server says it changed.
   * A failed check drops the copy, so the next turn asks the server. */
  private async refreshList(keptKey: string, open: () => Promise<Session>): Promise<void> {
    const entry = this.kept.get(keptKey);
    if (!entry || entry.refreshing) return;
    entry.refreshing = true;
    try {
      const session = await open();
      if (session.closed) throw session.failure ?? new StdioRelayError("The MCP server stopped.", "stopped");
      if (session.ready) await session.ready;
      const answer = await this.request(session, { jsonrpc: "2.0", id: this.relayId(), method: "tools/list", params: {} });
      if (this.kept.get(keptKey) !== entry) return;
      if (answer.error === undefined && SandboxStdioRelay.keepableList(answer.result)) entry.list = answer.result;
      else delete entry.list;
    } catch {
      if (this.kept.get(keptKey) === entry) this.kept.delete(keptKey);
    } finally {
      entry.refreshing = false;
    }
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
    if (!session.answered && START_FAILURE_REASONS.has(why)) {
      // It died before answering anything: remembered, so the next turns do
      // not start it again and again (#3181). Old marks (another command
      // that is no longer asked for) go once expired.
      for (const [old, mark] of this.startFailures) {
        if (this.now() - mark.at >= START_FAILURE_MS) this.startFailures.delete(old);
      }
      this.startFailures.set(this.failureKey(session.principalId, session.server, session.fingerprint), { at: this.now(), error: session.failure });
      this.kept.delete(session.keptKey);
      this.options.onStartFailure?.({ principalId: session.principalId, server: session.server, error: session.failure });
    }
    for (const { reject, timer } of session.pending.values()) {
      clearTimeout(timer);
      reject(session.failure);
    }
    session.pending.clear();
    session.stream.destroy();
  }

  private failureKey(principalId: string, server: string, fingerprint: string): string {
    return `${principalId}\u0000${server}\u0000${fingerprint}`;
  }

  private recentStartFailure(principalId: string, server: string, fingerprint: string): StdioRelayError | undefined {
    const key = this.failureKey(principalId, server, fingerprint);
    const failed = this.startFailures.get(key);
    if (!failed) return undefined;
    if (this.now() - failed.at >= START_FAILURE_MS) {
      this.startFailures.delete(key);
      return undefined;
    }
    return failed.error;
  }

  /** Whether this server, with this command and these variables, stopped
   * before its first answer in the last START_FAILURE_MS: a turn does not
   * mount it (#3181). */
  startFailed(principalId: string, server: string, spec: SandboxStdioSpec): boolean {
    return this.recentStartFailure(principalId, server, stdioFingerprint(spec)) !== undefined;
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
    this.forgetKept(principalId, server);
    for (const key of this.startFailures.keys()) {
      const [person, name] = key.split("\u0000");
      if (person === principalId && (!server || name === server)) this.startFailures.delete(key);
    }
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

  /** The live session of `key`, opened when missing. `hello`: the engine's
   * initialize (under a relay id), sent first on a new process; the
   * session's `ready` is its answer. */
  private async session(key: string, keptKey: string, principalId: string, server: string, spec: SandboxStdioSpec, fresh: boolean, botId?: string, hello?: Frame): Promise<Session> {
    const fingerprint = stdioFingerprint(spec);
    const current = this.sessions.get(key);
    if (current && !current.closed && current.fingerprint === fingerprint && !fresh && !hello) return current;
    if (current) this.close(key, current, "restarted");
    const inFlight = this.opening.get(key);
    if (inFlight && inFlight.fingerprint === fingerprint && !fresh && !hello) return inFlight.promise;
    const opening = { fingerprint } as { promise: Promise<Session>; fingerprint: string };
    opening.promise = (async () => {
      const stream = await this.options.open(principalId, spec, botId);
      const session: Session = { stream, fingerprint, pending: new Map(), buffer: Buffer.alloc(0), lastUsed: this.now(), closed: false, firstLine: true, answered: false, principalId, server, keptKey };
      if (this.opening.get(key) !== opening) {
        // a newer start (another initialize or command) took this key meanwhile
        this.close(key, session, "restarted");
        return session;
      }
      stream.on("data", (chunk: Buffer) => this.onData(key, session, chunk));
      stream.on("close", () => this.close(key, session, "exited"));
      stream.on("error", () => this.close(key, session, "error"));
      this.sessions.set(key, session);
      this.ensureSweeper();
      if (hello) {
        session.ready = this.request(session, hello);
        session.ready.catch(() => undefined);
      }
      return session;
    })();
    this.opening.set(key, opening);
    try {
      return await opening.promise;
    } finally {
      if (this.opening.get(key) === opening) this.opening.delete(key);
    }
  }

  private onData(key: string, session: Session, chunk: Buffer): void {
    // a closed session reads nothing more: a late frame never counts as an answer
    if (session.closed) return;
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
      if (!session.answered) {
        session.answered = true;
        this.startFailures.delete(this.failureKey(session.principalId, session.server, session.fingerprint));
      }
      const hasId = frame.id !== undefined && frame.id !== null;
      // #3623: the server's tools changed: the kept list is checked again
      if (!hasId && frame.method === "notifications/tools/list_changed") {
        void this.refreshList(session.keptKey, async () => session);
        continue;
      }
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

  /** Writes one request to the server and waits for its answer. */
  private request(session: Session, frame: Frame): Promise<Frame> {
    const id = frame.id as RpcId;
    if (session.pending.has(idKey(id))) return Promise.reject(new StdioRelayError("A request with this id is already waiting.", "invalid"));
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(idKey(id));
        reject(new StdioRelayError("The MCP server did not answer in time.", "timeout"));
      }, frame.method === "tools/call" ? CALL_TIMEOUT_MS : OTHER_TIMEOUT_MS);
      timer.unref?.();
      session.pending.set(idKey(id), { resolve, reject, timer });
      session.stream.write(`${JSON.stringify(frame)}\n`);
    }).finally(() => { session.lastUsed = this.now(); });
  }

  /** Relay one frame from the engine. A request resolves with the server's
   * answer; a notification or an answer to the server resolves with null.
   * `onPart`: the parts of a tool list's path (#3623, toolsSlow). */
  async relay(input: { principalId: string; botId: string; threadId: string; server: string; spec: SandboxStdioSpec; frame: unknown; onPart?: StdioRelayPart }): Promise<Frame | null> {
    const frame = input.frame as Frame | null;
    if (!frame || typeof frame !== "object" || Array.isArray(frame) || frame.jsonrpc !== "2.0") throw new StdioRelayError("Invalid request.", "invalid");
    const key = this.sessionKey(input);
    const isRequest = typeof frame.method === "string" && frame.id !== undefined && frame.id !== null;
    if (isRequest && typeof frame.id !== "string" && typeof frame.id !== "number") throw new StdioRelayError("Invalid request.", "invalid");
    const fingerprint = stdioFingerprint(input.spec);
    const failed = this.recentStartFailure(input.principalId, input.server, fingerprint);
    if (failed) throw failed;
    const keptKey = this.keptKey(input, fingerprint);
    const part = input.onPart ?? (() => undefined);
    const open = (fresh: boolean, hello?: Frame) => this.session(key, keptKey, input.principalId, input.server, input.spec, fresh, input.botId, hello);
    const live = (session: Session) => {
      if (session.closed) throw session.failure ?? new StdioRelayError("The MCP server stopped.", "stopped");
      session.lastUsed = this.now();
      return session;
    };

    if (isRequest && frame.method === "initialize") {
      // A new initialize is a new client (the engine relaunched): a new
      // process, started with the engine's own initialize.
      const version = (frame as { params?: { protocolVersion?: unknown } }).params?.protocolVersion;
      const opened = open(this.sessions.has(key), { ...frame, id: this.relayId() });
      const kept = this.kept.get(keptKey)?.init;
      if (kept && kept.version === version) {
        // the start's failure reaches the next frame
        opened.catch(() => undefined);
        return { jsonrpc: "2.0", id: frame.id, result: kept.result };
      }
      let at = this.now();
      const session = live(await opened);
      part("open", this.now() - at);
      at = this.now();
      let answer: Frame;
      try { answer = await session.ready!; } catch (error) { throw session.failure ?? error; }
      part("hello", this.now() - at);
      if (answer.error === undefined && answer.result !== undefined) this.keep(keptKey).init = { version, result: answer.result };
      return { ...answer, id: frame.id };
    }

    const cursor = (frame as { params?: { cursor?: unknown } }).params?.cursor;
    const listing = isRequest && frame.method === "tools/list" && (cursor === undefined || cursor === null);
    if (listing) {
      const kept = this.kept.get(keptKey)?.list;
      if (kept !== undefined) {
        void this.refreshList(keptKey, () => open(false));
        return { jsonrpc: "2.0", id: frame.id, result: kept };
      }
    }

    if (!isRequest) {
      // a notification never holds the engine: it reaches the server once
      // the server's start is answered, in the order it came
      void open(false).then(async (session) => {
        if (session.ready) await session.ready;
        if (!session.closed) session.stream.write(`${JSON.stringify(frame)}\n`);
      }).catch(() => undefined);
      return null;
    }
    const session = live(await open(false));
    if (session.ready) {
      try { await session.ready; } catch (error) { throw session.failure ?? error; }
      live(session);
    }
    const at = this.now();
    const answer = await this.request(session, frame);
    if (listing) {
      part("list", this.now() - at);
      if (input.onPart) part("kb", Math.round(Buffer.byteLength(JSON.stringify(answer)) / 1024));
      if (answer.error === undefined && SandboxStdioRelay.keepableList(answer.result)) this.keep(keptKey).list = answer.result;
    }
    return answer;
  }

  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const [key, session] of this.sessions) this.close(key, session, "server stopping");
  }
}
