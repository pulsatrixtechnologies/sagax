// The Sagax server's side of the sandbox provisioner API (server/sandboxd.ts):
// signed requests on the internal control network. Holds no Docker access.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Duplex } from "node:stream";

import { ttyDataFrames, ttyResizeFrame } from "./sandbox-tty-frames.ts";
import { signSandboxdRequest, SANDBOXD_AUTH_HEADER } from "./sandboxd-auth.ts";
import type { SandboxExecInput, SandboxExecOutput, SandboxStats, SandboxStatus, SandboxStdioSpec } from "./sandboxd-core.ts";
import { SANDBOX_KEY_RE } from "./user-sandbox-spec.ts";

/** Kubernetes: the pod-ready wait of the provisioner (90 s) plus a margin. */
export const EXEC_POD_START_ALLOWANCE_MS = 120_000;

export interface SandboxdInfo {
  instance: string;
  egress: "enforced" | "missing" | "not-required";
  maxRunning: number;
  idleMinutes: number;
}

export class SandboxdRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface SandboxdClient {
  info(): Promise<SandboxdInfo>;
  status(key: string): Promise<SandboxStatus>;
  ensure(key: string): Promise<SandboxStatus>;
  stop(key: string): Promise<SandboxStatus>;
  pause(key: string): Promise<SandboxStatus>;
  resume(key: string): Promise<SandboxStatus>;
  /** Count now as use of a running sandbox (the idle stop waits again);
   * starts nothing. */
  markUsed(key: string): Promise<SandboxStatus>;
  stats(key: string): Promise<SandboxStats>;
  remove(key: string, options?: { keepWorkspace?: boolean }): Promise<SandboxStatus>;
  exec(key: string, input: SandboxExecInput): Promise<SandboxExecOutput>;
  /** A byte stream to the VNC port of this sandbox's desktop (the live
   * view). Refused when the sandbox is not running. */
  desktopStream(key: string, options: { control: boolean }): Promise<Duplex>;
  /** The stdin and stdout of a person's MCP server command in this sandbox
   * (server/sandbox-stdio-mcp.ts). The command rides the stream's first
   * line; the signed path names its SHA-256. */
  stdioStream(key: string, spec: SandboxStdioSpec): Promise<Duplex>;
  /** The in-chat terminal in this sandbox: the size rides the signed URL;
   * what is written is framed (server/sandbox-tty-frames.ts), what is read
   * is the terminal's raw output. Optional: a test double may lack it. */
  ttyStream?(key: string, size: { cols: number; rows: number }): Promise<{ stream: Duplex; resize(cols: number, rows: number): void }>;
}

export interface SandboxdTls {
  /** PEM CA that signed the provisioner's certificate. Required for https. */
  ca: Buffer;
}

function caFromEnv(): Buffer | undefined {
  const file = process.env.SAGAX_SANDBOXD_TLS_CA?.trim();
  if (!file) return undefined;
  try { return readFileSync(file); } catch { return undefined; }
}

/** Plain http on the internal network, or https when a CA is supplied.
 * No credentials in the URL, no path, no query. https without a CA is refused. */
export function validSandboxdUrl(raw: string, tls?: SandboxdTls): URL {
  const url = new URL(raw);
  const https = url.protocol === "https:";
  if ((url.protocol !== "http:" && !https) || url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error("SAGAX_SANDBOXD_URL must be http://<host>:<port> on the internal network");
  }
  if (https && !tls?.ca?.length) throw new Error("SAGAX_SANDBOXD_URL https requires a CA (SAGAX_SANDBOXD_TLS_CA)");
  return url;
}

export function sandboxdClient(baseUrl: string, key: () => string, fetchImpl: typeof fetch = fetch, tls?: SandboxdTls): SandboxdClient {
  const ca = tls?.ca?.length ? tls.ca : caFromEnv();
  const base = validSandboxdUrl(baseUrl, ca ? { ca } : undefined);
  const secure = base.protocol === "https:";
  const call = async <T>(method: string, path: string, body?: unknown, timeoutMs = 120_000): Promise<T> => {
    const text = body === undefined ? "" : JSON.stringify(body);
    if (secure) return httpsCall<T>(method, path, text, body !== undefined, timeoutMs);
    const response = await fetchImpl(new URL(path, base), {
      method,
      redirect: "error",
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        [SANDBOXD_AUTH_HEADER]: signSandboxdRequest(key(), method, path, text),
      },
      ...(body === undefined ? {} : { body: text }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string; code?: string };
    if (!response.ok) throw new SandboxdRequestError(response.status, payload.code ?? "error", payload.error ?? `the provisioner answered ${response.status}`);
    return payload as T;
  };
  const httpsCall = <T>(method: string, path: string, text: string, hasBody: boolean, timeoutMs: number): Promise<T> => new Promise((resolve, reject) => {
    const req = httpsRequest({
      hostname: base.hostname,
      port: base.port || 443,
      method,
      path,
      ca,
      // SNI takes a host name only: Node 26 refuses an IP address here, and
      // the certificate check still matches the IP against its SANs.
      ...(isIP(base.hostname) ? {} : { servername: base.hostname }),
      rejectUnauthorized: true,
      timeout: timeoutMs,
      headers: {
        ...(hasBody ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) } : {}),
        [SANDBOXD_AUTH_HEADER]: signSandboxdRequest(key(), method, path, text),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        let payload: { error?: string; code?: string } = {};
        try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { error?: string; code?: string }; } catch { payload = {}; }
        if ((res.statusCode ?? 500) >= 400) reject(new SandboxdRequestError(res.statusCode ?? 500, payload.code ?? "error", payload.error ?? `the provisioner answered ${res.statusCode}`));
        else resolve(payload as T);
      });
    });
    req.on("timeout", () => req.destroy(new Error("the provisioner did not answer")));
    req.on("error", reject);
    req.end(hasBody ? text : undefined);
  });
  const keyPath = (sandboxKey: string, suffix = "") => {
    if (!SANDBOX_KEY_RE.test(sandboxKey)) throw new Error("invalid sandbox key");
    return `/v1/sandboxes/${sandboxKey}${suffix}`;
  };
  /** A signed upgrade on `path`: the socket once the provisioner switched. */
  const upgrade = (path: string, protocol: string) => new Promise<Duplex>((resolve, reject) => {
    const request = secure ? httpsRequest : httpRequest;
    const req = request({
      hostname: base.hostname, port: base.port || (secure ? 443 : 80), method: "POST", path, timeout: 15_000,
      headers: { connection: "Upgrade", upgrade: protocol, [SANDBOXD_AUTH_HEADER]: signSandboxdRequest(key(), "POST", path, "") },
      ...(secure ? { ca, ...(isIP(base.hostname) ? {} : { servername: base.hostname }), rejectUnauthorized: true } : {}),
    });
    req.on("upgrade", (_res, socket, head) => {
      socket.setTimeout(0);
      if (head.length) socket.unshift(head);
      resolve(socket);
    });
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => { if (chunks.length < 16) chunks.push(chunk); });
      res.on("end", () => {
        let code = "error";
        try { code = (JSON.parse(Buffer.concat(chunks).toString("utf8")) as { code?: string }).code ?? code; } catch { /* plain */ }
        reject(new SandboxdRequestError(res.statusCode ?? 502, code, `the provisioner answered ${res.statusCode}`));
      });
    });
    req.on("timeout", () => req.destroy(new Error("the provisioner did not answer")));
    req.on("error", reject);
    req.end();
  });
  return {
    stdioStream: async (sandboxKey, spec) => {
      const line = Buffer.from(JSON.stringify({ argv: spec.argv, env: spec.env ?? {} }));
      const digest = createHash("sha256").update(line).digest("hex");
      const socket = await upgrade(keyPath(sandboxKey, `/stdio?digest=${digest}`), "sagax-stdio");
      socket.write(Buffer.concat([line, Buffer.from("\n")]));
      return socket;
    },
    ttyStream: async (sandboxKey, size) => {
      const cols = Math.max(2, Math.min(1000, Math.floor(size.cols)));
      const rows = Math.max(1, Math.min(500, Math.floor(size.rows)));
      const socket = await upgrade(keyPath(sandboxKey, `/tty?cols=${cols}&rows=${rows}`), "sagax-tty");
      // Keystrokes go framed; reads are the raw terminal output.
      const stream = new Duplex({
        read() { socket.resume(); },
        write(chunk: Buffer, _encoding, callback) {
          const frames = ttyDataFrames(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          for (const frame of frames.slice(0, -1)) socket.write(frame);
          const last = frames.at(-1);
          if (last) socket.write(last, callback); else callback();
        },
        final(callback) { socket.end(); callback(); },
        destroy(error, callback) { socket.destroy(); callback(error); },
      });
      socket.on("data", (chunk: Buffer) => { if (!stream.push(chunk)) socket.pause(); });
      socket.on("end", () => stream.push(null));
      socket.on("close", () => { if (!stream.destroyed) stream.destroy(); });
      socket.on("error", (error) => stream.destroy(error));
      return {
        stream,
        resize(nextCols: number, nextRows: number) {
          if (!socket.destroyed) socket.write(ttyResizeFrame(nextCols, nextRows));
        },
      };
    },
    info: () => call<SandboxdInfo>("GET", "/v1/status"),
    status: (sandboxKey) => call<SandboxStatus>("GET", keyPath(sandboxKey)),
    ensure: (sandboxKey) => call<SandboxStatus>("POST", keyPath(sandboxKey, "/ensure"), {}, 180_000),
    stop: (sandboxKey) => call<SandboxStatus>("POST", keyPath(sandboxKey, "/stop"), {}),
    pause: (sandboxKey) => call<SandboxStatus>("POST", keyPath(sandboxKey, "/pause"), {}),
    resume: (sandboxKey) => call<SandboxStatus>("POST", keyPath(sandboxKey, "/resume"), {}),
    markUsed: (sandboxKey) => call<SandboxStatus>("POST", keyPath(sandboxKey, "/used"), {}, 10_000),
    stats: (sandboxKey) => call<SandboxStats>("GET", keyPath(sandboxKey, "/stats"), undefined, 30_000),
    remove: (sandboxKey, options = {}) => call<SandboxStatus>("DELETE", keyPath(sandboxKey, options.keepWorkspace ? "?keepWorkspace=1" : "")),
    // The provisioner may first wait up to 90 s for the pod to run: the
    // client waits longer than that, so a slow start answers `starting`
    // instead of being cut and taken for a provisioner that is gone.
    exec: (sandboxKey, input) => call<SandboxExecOutput>("POST", keyPath(sandboxKey, "/exec"), input, ((input.timeoutSec ?? 120) + 60) * 1000 + EXEC_POD_START_ALLOWANCE_MS),
    desktopStream: (sandboxKey, options) => {
      const path = keyPath(sandboxKey, `/desktop${options.control ? "?control=1" : ""}`);
      return upgrade(path, "sagax-rfb");
    },
  };
}

/** The provisioner's unsigned `GET /healthz`: true on 200, false on any
 * other answer, a refused connection or a timeout. Used by the cluster wake
 * (server/sandbox-k8s-wake.ts) to see whether the Kubernetes provisioner is
 * up; it carries no key and starts nothing. */
export function sandboxdHealth(baseUrl: string, tls?: SandboxdTls, fetchImpl: typeof fetch = fetch): (timeoutMs: number) => Promise<boolean> {
  const ca = tls?.ca?.length ? tls.ca : caFromEnv();
  const base = validSandboxdUrl(baseUrl, ca ? { ca } : undefined);
  if (base.protocol !== "https:") {
    return async (timeoutMs) => {
      try {
        const response = await fetchImpl(new URL("/healthz", base), { method: "GET", redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
        await response.body?.cancel().catch(() => {});
        return response.status === 200;
      } catch {
        return false;
      }
    };
  }
  return (timeoutMs) => new Promise<boolean>((resolve) => {
    const req = httpsRequest({
      hostname: base.hostname,
      port: base.port || 443,
      method: "GET",
      path: "/healthz",
      ca,
      // SNI takes a name only; an address is checked against the certificate's IP SANs.
      ...(isIP(base.hostname.replace(/^\[|\]$/g, "")) ? {} : { servername: base.hostname }),
      rejectUnauthorized: true,
      timeout: timeoutMs,
    }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode === 200));
      res.on("error", () => resolve(false));
    });
    req.on("timeout", () => req.destroy(new Error("the provisioner did not answer")));
    req.on("error", () => resolve(false));
    req.end();
  });
}
