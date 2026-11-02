/** Spawn an ACP child and wire its JSON-RPC session for its whole lifetime. */
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import { describeSpawnFailure, spawnCli } from "../../procs.ts";
import { appendNative } from "../native.ts";
import { permissionLaunchCwd } from "../permission-command.ts";
import {
  ACP_COMPACTION_COLLAPSE_RATIO,
  CLIENT_FILE_MAX_BYTES,
} from "./constants.ts";
import {
  acpNativeIncomingLogMessage,
  acpRpcError,
} from "./helpers.ts";
import { createPermissionHandler } from "./session-permission.ts";
import { createStreamHandlers } from "./session-stream.ts";
import type {
  AcpConnection,
  AcpSession,
  AcpSupport,
} from "./types.ts";

export type OpenSessionDeps = {
  support: AcpSupport;
  DRIVER_KIND: string;
  SOURCE: string;
  DENY_TIMEOUT_NOTE: string;
  QUESTION_NO_MATCH_NOTE: string;
  emit: (event: any) => void;
  base: (threadId: string, turnId: string) => Record<string, unknown>;
  sessionAllows: Map<string, Set<string>>;
  active: Map<string, { interrupt: () => void }>;
  sessions: Map<string, AcpSession>;
  settle: (threadId: string, session: AcpSession, ok: boolean, stopReason: string | null) => void;
  nativeLogMessage: (msg: any) => unknown;
};

export function createOpenSession(deps: OpenSessionDeps) {
  const {
    support, DRIVER_KIND, SOURCE, DENY_TIMEOUT_NOTE, QUESTION_NO_MATCH_NOTE,
    emit, base, sessionAllows, active, sessions, settle, nativeLogMessage,
  } = deps;

  return (
    threadId: string,
    launch: { command: string; args?: string[] },
    argv: string[],
    env: Record<string, string | undefined>,
    cwd: string,
    contractKey: string,
  ): AcpSession => {

    const commandCwd = permissionLaunchCwd(cwd);
    const child = spawnCli(launch.command, argv, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    }, "bot");
    let nextId = 1;
    const privateResponses = new Set<number>();
    const rpcPending = new Map<
      number,
      {
        method: string;
        resolve: (v: any) => void;
        reject: (e: Error) => void;
        timer: ReturnType<typeof setTimeout> | null;
        idleTimer: ReturnType<typeof setTimeout> | null;
        armIdle: () => void;
      }
    >();

    const send = (obj: unknown) => {
      // A permission/file response resumes an agent that was waiting on us.
      const message = obj as { id?: unknown; result?: unknown; error?: unknown };
      if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
        for (const pending of rpcPending.values()) pending.armIdle();
      }
      try {
        child.stdin.write(JSON.stringify(obj) + "\n");
      } catch {}
      appendNative(threadId, { dir: "out", source: SOURCE, msg: nativeLogMessage(obj) });
    };
    const request = (
      method: string,
      params: unknown,
      timeoutMs?: number,
      receive?: (result: any) => void,
      idleMs?: number,
      idleMessage?: string | (() => string),
    ) =>
      new Promise<any>((resolve, reject) => {
        const id = nextId++;
        if (method === "_x.ai/mcp/list") privateResponses.add(id);
        let timer: ReturnType<typeof setTimeout> | null = null;
        if (timeoutMs) {
          timer = setTimeout(() => {
            rpcPending.delete(id);
            reject(Object.assign(new Error(`${method} timed out`), { acpSessionFailure: true }));
          }, timeoutMs);
          timer.unref?.();
        }
        // Idle watchdog: unlike a wall-clock timeout, the deadline restarts
        // on every inbound line (see the stdout handler), so a long-lived
        // streaming agent is never cut off — only one that has gone fully
        // silent trips it.
        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        const armIdle = () => {
          if (!(idleMs && idleMs > 0)) return;
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            // Waiting for a person, or for a tool the agent is running,
            // is not an unresponsive agent.
            if (session.current?.asks.size || session.current?.runningTools.size) { armIdle(); return; }
            rpcPending.delete(id);
            const error = new Error((typeof idleMessage === "function" ? idleMessage() : idleMessage) ?? `${method} stopped responding`);
            Object.assign(error, { acpPromptStall: true });
            reject(error);
          }, idleMs);
          idleTimer.unref?.();
        };
        armIdle();
        rpcPending.set(id, {
          method,
          // Consume configuration in wire order: an update following this
          // response may arrive before the awaiting continuation resumes.
          resolve: (result) => { receive?.(result); resolve(result); },
          reject,
          timer,
          get idleTimer() { return idleTimer; },
          armIdle,
        });
        send({ jsonrpc: "2.0", id, method, params });
      });
    let lastInboundAt = Date.now();
    const acp: AcpConnection = {
      send,
      request,
      get lastInboundAt() { return lastInboundAt; },
      touch: () => { for (const p of rpcPending.values()) p.armIdle(); },
      failAll: (error: Error) => {
        for (const p of rpcPending.values()) {
          if (p.timer) clearTimeout(p.timer);
          if (p.idleTimer) clearTimeout(p.idleTimer);
          p.reject(error);
        }
        rpcPending.clear();
      },
      close: () => {
        acp.failAll(new Error("session closed"));
        child.stdout.removeAllListeners("data");
      },
    };

    const resolveClientPath = async (requestPath: unknown): Promise<string> => {
      if (typeof requestPath !== "string" || !isAbsolute(requestPath)) {
        throw new Error("ACP file paths must be absolute.");
      }
      const workspace = await realpath(cwd).catch(() => resolve(cwd));
      const requested = resolve(requestPath);
      const lexical = relative(resolve(cwd), requested);
      if (lexical === ".." || lexical.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(lexical)) {
        throw new Error("ACP file path is outside the session workspace.");
      }
      const suffix = [basename(requested)];
      let ancestor = dirname(requested);
      while (!(await lstat(ancestor).catch(() => null))) {
        const parent = dirname(ancestor);
        if (parent === ancestor) throw new Error("ACP file path has no accessible parent.");
        suffix.unshift(basename(ancestor));
        ancestor = parent;
      }
      const candidate = resolve(await realpath(ancestor), ...suffix);
      const rel = relative(workspace, candidate);
      if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
        throw new Error("ACP file path is outside the session workspace.");
      }
      const existing = await lstat(candidate).catch(() => null);
      if (existing?.isSymbolicLink()) throw new Error("ACP file path cannot be a symbolic link.");
      return candidate;
    };

    const handleClientFileRequest = async (msg: any): Promise<void> => {
      const fail = (error: unknown) => send({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32602, message: error instanceof Error ? error.message : String(error) },
      });
      try {
        if (!support.clientFileSystem) throw new Error("Client file access is disabled.");
        const params = msg.params ?? {};
        const path = await resolveClientPath(params.path);
        if (msg.method === "fs/read_text_file") {
          const info = await stat(path);
          if (!info.isFile() || info.size > CLIENT_FILE_MAX_BYTES) {
            throw new Error(`ACP can only read text files under ${CLIENT_FILE_MAX_BYTES} bytes.`);
          }
          const content = await readFile(path, "utf8");
          if (params.line == null && params.limit == null) {
            send({ jsonrpc: "2.0", id: msg.id, result: { content } });
            return;
          }
          const line = typeof params.line === "number" && Number.isInteger(params.line) && params.line > 0 ? params.line : 1;
          const limit = typeof params.limit === "number" && Number.isInteger(params.limit) && params.limit >= 0 ? params.limit : undefined;
          const lines = content.split("\n");
          const start = line - 1;
          send({
            jsonrpc: "2.0",
            id: msg.id,
            result: { content: lines.slice(start, limit === undefined ? undefined : start + limit).join("\n") },
          });
          return;
        }
        if (typeof params.content !== "string" || Buffer.byteLength(params.content) > CLIENT_FILE_MAX_BYTES) {
          throw new Error(`ACP can only write text files under ${CLIENT_FILE_MAX_BYTES} bytes.`);
        }
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, params.content, "utf8");
        send({ jsonrpc: "2.0", id: msg.id, result: {} });
      } catch (error) {
        fail(error);
      }
    };

    let sessionRef: AcpSession;
    const handleServerRequest = createPermissionHandler({
      support, DRIVER_KIND, DENY_TIMEOUT_NOTE, QUESTION_NO_MATCH_NOTE,
      threadId, commandCwd, send, emit, base, sessionAllows, handleClientFileRequest,
      getSession: () => sessionRef,
      active,
    });

    // stream handlers close over the session binding via getSession
    const { handleNotification } = createStreamHandlers({
      support, threadId, emit, base, ACP_COMPACTION_COLLAPSE_RATIO,
      getSession: () => sessionRef,
    });

    const session: AcpSession = {
      child,
      acp,
      launch,
      env,
      cwd,
      contractKey,
      sessionKey: null,
      sessionId: null,
      sessionConfigResult: null,
      initResult: null,
      authenticated: false,
      idleTimer: null,
      closing: false,
      dead: false,
      stderr: "",
      current: null,
    };
    sessionRef = session;
    let buf = "";
    // decode as UTF-8 across chunk boundaries — a raw `buf += chunk` splits
    // multibyte characters that straddle two reads and corrupts the text
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        appendNative(threadId, { dir: "in", source: SOURCE, msg: nativeLogMessage(acpNativeIncomingLogMessage(msg, privateResponses)) });
        // Inbound traffic proves the child is alive and making progress,
        // so every idle deadline restarts; only total silence trips it.
        lastInboundAt = Date.now();
        for (const p of rpcPending.values()) p.armIdle();
        if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
          const pend = rpcPending.get(msg.id);
          if (pend) {
            rpcPending.delete(msg.id);
            if (pend.timer) clearTimeout(pend.timer);
            if (pend.idleTimer) clearTimeout(pend.idleTimer);
            if (msg.error) {
              pend.reject(acpRpcError(msg.error, pend.method));
            } else {
              pend.resolve(msg.result);
            }
          }
        } else if (msg.id !== undefined && msg.method) {
          const current = session.current;
          if (!current) {
            // between turns nothing is brokered: cancel a permission
            // request and refuse anything else — the agent must never
            // block on an unanswered request
            send(msg.method === "session/request_permission"
              ? { jsonrpc: "2.0", id: msg.id, result: { outcome: { outcome: "cancelled" } } }
              : { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
          } else {
            handleServerRequest(msg, current);
          }
        } else if (msg.method) {
          handleNotification(msg);
        }
      }
    });

    child.stderr.on("data", (c) => {
      if (!support.redactStderr) session.stderr += c;
      if (session.stderr.length > 8192) session.stderr = session.stderr.slice(-8192);
    });
    child.on("error", (e) => {
      session.dead = true;
      // A call warm has pending RPCs but no current turn. Reject them
      // too, so the first real turn never waits for a dead handshake.
      session.acp.failAll(e);
      const current = session.current;
      if (!current) return;
      emit({ ...base(threadId, current.turnId), type: "runtime.error", ...describeSpawnFailure(e, launch.command, cwd) });
      settle(threadId, session, false, "spawn_error");
    });
    child.on("close", (code) => {
      session.dead = true;
      session.acp.failAll(new Error(`${DRIVER_KIND} exited ${code} before the prompt result${session.stderr ? `: ${session.stderr.trim().slice(-300)}` : ""}`));
      const current = session.current;
      if (current) {
        emit({
          ...base(threadId, current.turnId),
          type: "runtime.error",
          message: `${DRIVER_KIND} exited ${code} before the prompt result${session.stderr ? `: ${session.stderr.trim().slice(-300)}` : ""}`,
        });
        settle(threadId, session, false, "exit_before_result");
      } else if (sessions.get(threadId) === session) {
        // drop the record between turns; a later turn respawns. The
        // identity check keeps an old child's exit from unlinking a
        // session that already replaced this one.
        sessions.delete(threadId);
      }
    });
    return session;


  };
}
