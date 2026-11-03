import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { SANDBOXD_AUTH_HEADER, SandboxdVerifier } from "./sandboxd-auth.ts";
import { SandboxError, SandboxService } from "./sandboxd-core.ts";
import { ttyFrameDecoder } from "./sandbox-tty-frames.ts";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new SandboxError(413, "too_large", "the request is too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function createSandboxdHandler(service: SandboxService, verifier: SandboxdVerifier) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? "GET";
    const rawPath = req.url ?? "/";
    try {
      if (method === "GET" && rawPath === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
        return;
      }
      if (!rawPath.startsWith("/v1/")) return send(res, 404, { error: "not found" });
      const body = await readBody(req);
      // Authenticate before anything else is parsed or touched.
      if (!verifier.verify(req.headers[SANDBOXD_AUTH_HEADER], method, rawPath, body)) {
        return send(res, 401, { error: "unauthorized", code: "unauthorized" });
      }
      const url = new URL(rawPath, "http://sandboxd");
      if (method === "GET" && url.pathname === "/v1/status") {
        return send(res, 200, { instance: service.config.instance, egress: service.egress, maxRunning: service.config.maxRunning, idleMinutes: service.config.idleStopMs / 60_000 });
      }
      if (method === "GET" && url.pathname === "/v1/sandboxes") return send(res, 200, { sandboxes: await service.list() });
      const match = /^\/v1\/sandboxes\/([a-f0-9]{32})(?:\/(ensure|stop|exec|pause|resume|stats|used))?$/.exec(url.pathname);
      if (!match) return send(res, 404, { error: "not found" });
      const key = match[1]!;
      const action = match[2];
      if (method === "GET" && !action) return send(res, 200, await service.status(key));
      if (method === "POST" && action === "ensure") return send(res, 200, await service.ensure(key));
      if (method === "POST" && action === "stop") return send(res, 200, await service.stop(key));
      if (method === "POST" && action === "pause") return send(res, 200, await service.pause(key));
      if (method === "POST" && action === "resume") return send(res, 200, await service.resume(key));
      if (method === "POST" && action === "used") return send(res, 200, await service.markUsed(key));
      if (method === "GET" && action === "stats") return send(res, 200, await service.stats(key));
      if (method === "DELETE" && !action) {
        return send(res, 200, await service.remove(key, { keepWorkspace: url.searchParams.get("keepWorkspace") === "1" }));
      }
      if (method === "POST" && action === "exec") {
        let parsed: unknown;
        try { parsed = JSON.parse(body.toString("utf8")); } catch { return send(res, 400, { error: "invalid JSON", code: "bad_exec" }); }
        const input = parsed as { argv?: unknown; env?: unknown; stdinBase64?: unknown; timeoutSec?: unknown; maxOutputBytes?: unknown };
        return send(res, 200, await service.exec(key, {
          argv: input.argv as string[],
          ...(input.env && typeof input.env === "object" ? { env: input.env as Record<string, string> } : {}),
          ...(input.stdinBase64 !== undefined ? { stdinBase64: input.stdinBase64 as string } : {}),
          ...(typeof input.timeoutSec === "number" ? { timeoutSec: input.timeoutSec } : {}),
          ...(typeof input.maxOutputBytes === "number" ? { maxOutputBytes: input.maxOutputBytes } : {}),
        }));
      }
      return send(res, 405, { error: "method not allowed" });
    } catch (error) {
      if (error instanceof SandboxError) return send(res, error.status, { error: error.message, code: error.code });
      console.error(`sandboxd: ${method} ${rawPath.split("?")[0]} failed: ${error instanceof Error ? error.message : String(error)}`);
      return send(res, 500, { error: "the provisioner failed", code: "internal" });
    }
  };
}

export const SANDBOXD_DESKTOP_UPGRADE = "sagax-rfb";
const DESKTOP_PATH = /^\/v1\/sandboxes\/([a-f0-9]{32})\/desktop$/;
/** A person's MCP server command (server/sandbox/sandbox-stdio-mcp.ts). The command
 * and its environment ride the stream's first line, never the URL; the
 * signed URL names that line's SHA-256, so it is authenticated too. */
export const SANDBOXD_STDIO_UPGRADE = "sagax-stdio";
const STDIO_PATH = /^\/v1\/sandboxes\/([a-f0-9]{32})\/stdio$/;
const MAX_STDIO_SPEC_BYTES = 1_600_000;
/** The in-chat terminal (server/terminal-resources/adapters/sandbox.ts): the
 * size rides the signed URL; keystrokes and resizes come framed
 * (server/sandbox/sandbox-tty-frames.ts); the terminal's output goes back raw. */
export const SANDBOXD_TTY_UPGRADE = "sagax-tty";
const TTY_PATH = /^\/v1\/sandboxes\/([a-f0-9]{32})\/tty$/;

/** Read the first line of an upgraded socket (the stdio spec), bounded. */
function readFirstLine(socket: Duplex, head: Buffer): Promise<{ line: Buffer; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let buffered = head;
    const done = (error: Error | null, value?: { line: Buffer; rest: Buffer }) => {
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.pause();
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value!);
    };
    const check = () => {
      const newline = buffered.indexOf(10);
      if (newline !== -1) return done(null, { line: buffered.subarray(0, newline), rest: buffered.subarray(newline + 1) });
      if (buffered.length > MAX_STDIO_SPEC_BYTES) done(new SandboxError(413, "too_large", "the request is too large"));
    };
    const onData = (chunk: Buffer) => { buffered = Buffer.concat([buffered, chunk]); check(); };
    const onEnd = () => done(new SandboxError(400, "bad_stdio", "the stream ended before its command"));
    const timer = setTimeout(() => done(new SandboxError(408, "timeout", "the command was not sent")), 15_000);
    socket.on("data", onData);
    socket.on("end", onEnd);
    check();
  });
}

function refuseUpgrade(socket: Duplex, status: number, code: string): void {
  const body = JSON.stringify({ error: code, code });
  const reason = status === 401 ? "Unauthorized" : status === 404 ? "Not Found" : status === 409 ? "Conflict" : status === 429 ? "Too Many Requests" : "Error";
  socket.end(`HTTP/1.1 ${status} ${reason}\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`);
}

/** The live view's stream: authenticated like every other call (an empty
 * body is signed), then the socket is spliced to the desktop relay inside
 * that one sandbox. */
export function createSandboxdUpgradeHandler(service: SandboxService, verifier: SandboxdVerifier) {
  return (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    socket.on("error", () => socket.destroy());
    const method = req.method ?? "GET";
    const rawPath = req.url ?? "/";
    if (!verifier.verify(req.headers[SANDBOXD_AUTH_HEADER], method, rawPath, Buffer.alloc(0))) return refuseUpgrade(socket, 401, "unauthorized");
    let url: URL;
    try { url = new URL(rawPath, "http://sandboxd"); } catch { return refuseUpgrade(socket, 404, "not_found"); }
    const stdio = STDIO_PATH.exec(url.pathname);
    if (stdio) {
      const digest = url.searchParams.get("digest") ?? "";
      if (method !== "POST" || !/^[a-f0-9]{64}$/.test(digest) || String(req.headers.upgrade ?? "").toLowerCase() !== SANDBOXD_STDIO_UPGRADE) return refuseUpgrade(socket, 404, "not_found");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: ${SANDBOXD_STDIO_UPGRADE}\r\n\r\n`);
      void readFirstLine(socket, head).then(async ({ line, rest }) => {
        if (createHash("sha256").update(line).digest("hex") !== digest) throw new SandboxError(401, "unauthorized", "the command does not match its signature");
        let spec: { argv?: unknown; env?: unknown };
        try { spec = JSON.parse(line.toString("utf8")) as { argv?: unknown; env?: unknown }; } catch { throw new SandboxError(400, "bad_stdio", "invalid JSON"); }
        const stream = await service.stdioStream(stdio[1]!, {
          argv: spec.argv as string[],
          ...(spec.env && typeof spec.env === "object" ? { env: spec.env as Record<string, string> } : {}),
        });
        if (socket.destroyed) { stream.destroy(); return; }
        if (rest.length) stream.write(rest);
        stream.on("error", () => socket.destroy());
        socket.on("close", () => stream.destroy());
        stream.on("close", () => socket.destroy());
        socket.pipe(stream).pipe(socket);
      }).catch((error: unknown) => {
        // after the 101 the only answer left is one JSON line, then close
        const code = error instanceof SandboxError ? error.code : "internal";
        if (!(error instanceof SandboxError)) console.error(`sandboxd: stdio stream failed: ${error instanceof Error ? error.message : String(error)}`);
        socket.end(`${JSON.stringify({ sagaxStdioError: code, message: error instanceof SandboxError ? error.message : "the provisioner failed" })}\n`);
      });
      return;
    }
    const tty = TTY_PATH.exec(url.pathname);
    if (tty) {
      if (method !== "POST" || String(req.headers.upgrade ?? "").toLowerCase() !== SANDBOXD_TTY_UPGRADE) return refuseUpgrade(socket, 404, "not_found");
      const cols = Number(url.searchParams.get("cols"));
      const rows = Number(url.searchParams.get("rows"));
      socket.pause();
      const cwd = url.searchParams.get("cwd") ?? undefined;
      void service.ttyStream(tty[1]!, { cols, rows }, cwd).then((terminal) => {
        const stream = terminal.stream;
        if (socket.destroyed) { stream.destroy(); return; }
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: ${SANDBOXD_TTY_UPGRADE}\r\n\r\n`);
        const decode = ttyFrameDecoder();
        const onFrames = (chunk: Buffer) => {
          const frames = decode(chunk);
          if (!Array.isArray(frames)) { socket.destroy(); return; }
          for (const frame of frames) {
            if (frame.type === "data") stream.write(frame.payload);
            else void terminal.resize({ cols: frame.cols, rows: frame.rows });
          }
        };
        if (head.length) onFrames(head);
        socket.on("data", onFrames);
        stream.on("data", (chunk: Buffer) => { if (!socket.destroyed) socket.write(chunk); });
        stream.on("error", () => socket.destroy());
        // The server's side ending (the person closed the terminal) ends
        // the shell; the shell ending ends the stream.
        socket.on("end", () => { stream.destroy(); socket.destroy(); });
        socket.on("close", () => stream.destroy());
        stream.on("close", () => socket.destroy());
        stream.on("end", () => socket.end());
        socket.resume();
      }, (error: unknown) => {
        if (error instanceof SandboxError) return refuseUpgrade(socket, error.status, error.code);
        console.error(`sandboxd: terminal failed: ${error instanceof Error ? error.message : String(error)}`);
        refuseUpgrade(socket, 500, "internal");
      });
      return;
    }
    const match = DESKTOP_PATH.exec(url.pathname);
    if (method !== "POST" || !match || String(req.headers.upgrade ?? "").toLowerCase() !== SANDBOXD_DESKTOP_UPGRADE) return refuseUpgrade(socket, 404, "not_found");
    const control = url.searchParams.get("control") === "1";
    socket.pause();
    void service.desktopStream(match[1]!, { control }).then((stream) => {
      if (socket.destroyed) { stream.destroy(); return; }
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: ${SANDBOXD_DESKTOP_UPGRADE}\r\n\r\n`);
      if (head.length) stream.write(head);
      stream.on("error", () => socket.destroy());
      socket.on("close", () => stream.destroy());
      stream.on("close", () => socket.destroy());
      socket.pipe(stream).pipe(socket);
      socket.resume();
    }, (error: unknown) => {
      if (error instanceof SandboxError) return refuseUpgrade(socket, error.status, error.code);
      console.error(`sandboxd: desktop stream failed: ${error instanceof Error ? error.message : String(error)}`);
      refuseUpgrade(socket, 500, "internal");
    });
  };
}

