// A small Kubernetes API client: HTTPS JSON, and exec over the v4 websocket
// protocol. Tokens are read on each call so a rotated in-cluster token is
// picked up. TLS verification stays on unless a lab flag is set on the auth.
import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { Duplex } from "node:stream";
import WebSocket from "ws";
import { parse as parseYaml } from "yaml";

import { parseCpuQuantity, parseExecStatus, parseMemoryQuantity } from "./sandboxd-k8s-spec.ts";

export interface K8sResponse {
  status: number;
  body: unknown;
}

export interface K8sExecResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number | null;
}

export interface K8sClient {
  request(method: "GET" | "POST" | "DELETE" | "PATCH", path: string, body?: unknown, contentType?: string): Promise<K8sResponse>;
  /** Run a command to completion. stdout and stderr are collected here, so a
   * caller cannot miss bytes that arrive as the socket opens. Abort closes the
   * exec websocket so Stop does not leave the job's process tree running. */
  exec(namespace: string, pod: string, command: string[], stdin?: Buffer, signal?: AbortSignal): Promise<K8sExecResult>;
  /** stdin and stdout stay open (the desktop relay). stderr is dropped.
   * `prelude` is written to stdin first, before the stream's own bytes. */
  execStream(namespace: string, pod: string, command: string[], prelude?: Buffer): Promise<Duplex>;
  /** An interactive exec in a terminal (tty=true): one raw stream, and the
   * v4 protocol's resize channel (4). The in-chat terminal. */
  execTty?(namespace: string, pod: string, command: string[], size: { cols: number; rows: number }): Promise<{ stream: Duplex; resize(size: { cols: number; rows: number }): Promise<void> }>;
  metrics(namespace: string, pod: string): Promise<{ cpu: number; memoryBytes: number } | null>;
}

export interface K8sAuth {
  server: string;
  ca?: Buffer;
  cert?: Buffer;
  key?: Buffer;
  token?: () => string | undefined;
  /** Lab only. Production kubeconfigs that skip TLS are refused. */
  insecureSkipTlsVerify?: boolean;
}

interface KubeConfig {
  currentContext?: string;
  "current-context"?: string;
  contexts?: { name?: string; context?: { cluster?: string; user?: string } }[];
  clusters?: { name?: string; cluster?: { server?: string; "certificate-authority-data"?: string; "insecure-skip-tls-verify"?: boolean } }[];
  users?: { name?: string; user?: { token?: string; "client-certificate-data"?: string; "client-key-data"?: string } }[];
}

function decode(data: string | undefined): Buffer | undefined {
  if (!data) return undefined;
  return Buffer.from(data, "base64");
}

/** The current context of a kubeconfig. Used by the kind integration test
 * and by an out-of-cluster provisioner. */
export function authFromKubeconfig(file: string, env: NodeJS.ProcessEnv = process.env): K8sAuth {
  const doc = parseYaml(readFileSync(file, "utf8")) as KubeConfig;
  const contextName = env.SAGAX_SANDBOX_K8S_CONTEXT?.trim() || doc["current-context"] || doc.currentContext;
  const context = doc.contexts?.find((entry) => entry.name === contextName)?.context;
  if (!context?.cluster || !context.user) throw new Error("kubeconfig has no current context");
  const cluster = doc.clusters?.find((entry) => entry.name === context.cluster)?.cluster;
  const user = doc.users?.find((entry) => entry.name === context.user)?.user;
  if (!cluster?.server) throw new Error("kubeconfig cluster has no server");
  if (!cluster.server.startsWith("https://")) throw new Error("the Kubernetes API must be https");
  const allowInsecure = /^(1|true|yes|on)$/i.test(env.SAGAX_SANDBOX_K8S_TLS_INSECURE?.trim() ?? "");
  if (cluster["insecure-skip-tls-verify"] && !allowInsecure) {
    throw new Error("kubeconfig sets insecure-skip-tls-verify; refusing unless SAGAX_SANDBOX_K8S_TLS_INSECURE=1");
  }
  const token = user?.token;
  return {
    server: cluster.server,
    ...(decode(cluster["certificate-authority-data"]) ? { ca: decode(cluster["certificate-authority-data"]) } : {}),
    ...(decode(user?.["client-certificate-data"]) ? { cert: decode(user?.["client-certificate-data"]) } : {}),
    ...(decode(user?.["client-key-data"]) ? { key: decode(user?.["client-key-data"]) } : {}),
    ...(token ? { token: () => token } : {}),
    ...(cluster["insecure-skip-tls-verify"] ? { insecureSkipTlsVerify: true } : {}),
  };
}

export function inClusterAuth(env: NodeJS.ProcessEnv = process.env): K8sAuth {
  const server = env.SAGAX_SANDBOX_K8S_API?.trim() || "https://kubernetes.default.svc";
  if (!server.startsWith("https://")) throw new Error("SAGAX_SANDBOX_K8S_API must be https");
  const caFile = env.SAGAX_SANDBOX_K8S_CA_FILE?.trim() || "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
  const tokenFile = env.SAGAX_SANDBOX_K8S_TOKEN_FILE?.trim() || "/var/run/secrets/kubernetes.io/serviceaccount/token";
  return {
    server,
    ca: readFileSync(caFile),
    token: () => readFileSync(tokenFile, "utf8").trim(),
  };
}

/** Out-of-cluster file, or empty when the process should use its ServiceAccount.
 * `SAGAX_SANDBOX_K8S_USE_KUBECONFIG=1` with no `KUBECONFIG` is `~/.kube/config`,
 * which is where `kind export kubeconfig` writes. */
export function kubeconfigFileFromEnv(env: NodeJS.ProcessEnv, fallback = join(homedir(), ".kube", "config")): string {
  const explicit = env.SAGAX_SANDBOX_K8S_KUBECONFIG?.trim() || "";
  if (explicit) return explicit;
  if (env.SAGAX_SANDBOX_K8S_USE_KUBECONFIG === "1") return env.KUBECONFIG?.trim() || fallback;
  return "";
}

export function kubernetesClientFromEnv(env: NodeJS.ProcessEnv = process.env): K8sClient {
  const kubeconfig = kubeconfigFileFromEnv(env);
  if (kubeconfig) return kubernetesClient(authFromKubeconfig(kubeconfig, env));
  return kubernetesClient(inClusterAuth(env));
}

const STDIN_FRAME_BYTES = 64 * 1024;

function endpoint(auth: K8sAuth, path: string): URL {
  if (!auth.server.startsWith("https://")) throw new Error("the Kubernetes API must be https");
  return new URL(path, auth.server);
}

export function kubernetesClient(auth: K8sAuth): K8sClient {
  const call = (method: string, path: string, body?: unknown, contentType?: string) => new Promise<K8sResponse>((resolve, reject) => {
    const url = endpoint(auth, path);
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const token = auth.token?.();
    const req = httpsRequest({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      method,
      path: `${url.pathname}${url.search}`,
      // SNI takes a host name only (Node 26 refuses an IP, e.g. KUBERNETES_SERVICE_HOST).
      ...(isIP(url.hostname.replace(/^\[|\]$/g, "")) ? {} : { servername: url.hostname }),
      ...(auth.ca ? { ca: auth.ca } : {}),
      ...(auth.cert ? { cert: auth.cert } : {}),
      ...(auth.key ? { key: auth.key } : {}),
      rejectUnauthorized: !auth.insecureSkipTlsVerify,
      headers: {
        accept: "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload ? { "content-type": contentType ?? "application/json", "content-length": String(payload.length) } : {}),
      },
      timeout: 30_000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        const text = raw.toString("utf8");
        let parsed: unknown = text;
        if (text.startsWith("{") || text.startsWith("[")) {
          try { parsed = JSON.parse(text) as unknown; } catch { parsed = text; }
        }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on("timeout", () => req.destroy(new Error("the Kubernetes API timed out")));
    req.on("error", reject);
    req.end(payload);
  });

  const openExec = (namespace: string, pod: string, command: string[], stdin: boolean, tty = false) => new Promise<WebSocket>((resolve, reject) => {
    const url = endpoint(auth, `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/exec`);
    url.protocol = "wss:";
    const params = new URLSearchParams();
    for (const arg of command) params.append("command", arg);
    params.set("stdout", "true");
    // A terminal has one output: Kubernetes refuses stderr beside a tty.
    params.set("stderr", tty ? "false" : "true");
    params.set("stdin", stdin ? "true" : "false");
    params.set("tty", tty ? "true" : "false");
    url.search = params.toString();
    const token = auth.token?.();
    const socket = new WebSocket(url, ["v4.channel.k8s.io"], {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(auth.ca ? { ca: auth.ca } : {}),
      ...(auth.cert ? { cert: auth.cert } : {}),
      ...(auth.key ? { key: auth.key } : {}),
      rejectUnauthorized: !auth.insecureSkipTlsVerify,
      handshakeTimeout: 15_000,
    });
    const fail = (error: Error) => { socket.terminate(); reject(error); };
    socket.on("unexpected-response", (_request, response) => fail(new Error(`exec refused (${response.statusCode ?? 0})`)));
    socket.once("error", fail);
    socket.once("open", () => {
      socket.off("error", fail);
      resolve(socket);
    });
  });

  /** Bytes for the command's stdin (channel 0), in frames of at most 64 KiB. */
  const sendStdin = async (socket: WebSocket, bytes: Buffer): Promise<void> => {
    for (let offset = 0; offset < bytes.length; offset += STDIN_FRAME_BYTES) {
      const chunk = bytes.subarray(offset, offset + STDIN_FRAME_BYTES);
      await new Promise<void>((resolve, reject) => {
        if (socket.readyState !== WebSocket.OPEN) { reject(new Error("the exec stream is closed")); return; }
        socket.send(Buffer.concat([Buffer.from([0]), chunk]), { binary: true }, (error) => (error ? reject(error) : resolve()));
      });
    }
  };

  const frameData = (data: WebSocket.RawData): Buffer => Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);

  return {
    request: (method, path, body, contentType) => call(method, path, body, contentType),
    async exec(namespace, pod, command, stdin, signal) {
      if (signal?.aborted) throw Object.assign(new Error("the exec was cancelled"), { code: "ABORT_ERR", name: "AbortError" });
      const socket = await openExec(namespace, pod, command, stdin !== undefined);
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let exitCode: number | null = null;
      const exitCodeDone = await new Promise<number | null>((resolve, reject) => {
        let settled = false;
        let cancelled = false;
        const finish = (value: number | null | Error) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          if (value instanceof Error) reject(value);
          else resolve(value);
        };
        const onAbort = () => {
          cancelled = true;
          try { socket.terminate(); } catch { /* already closed */ }
          finish(Object.assign(new Error("the exec was cancelled"), { code: "ABORT_ERR", name: "AbortError" }));
        };
        if (signal) {
          if (signal.aborted) { onAbort(); return; }
          signal.addEventListener("abort", onAbort, { once: true });
        }
        socket.on("message", (data) => {
          const frame = frameData(data);
          if (frame.length === 0) return;
          const payload = frame.subarray(1);
          if (frame[0] === 1) stdout.push(Buffer.from(payload));
          else if (frame[0] === 2) stderr.push(Buffer.from(payload));
          else if (frame[0] === 3) exitCode = parseExecStatus(payload.toString("utf8"));
        });
        socket.on("error", (error) => {
          if (cancelled) return;
          finish(error);
        });
        socket.on("close", () => {
          if (cancelled) return;
          finish(exitCode);
        });
        // The v4 protocol cannot close stdin: the reader takes exactly the
        // bytes it was told to expect (sandboxd-k8s.ts withExecEnv). A
        // command that ends before reading them all closes the socket: its
        // exit status still answers, so a failed send is not an error here.
        if (stdin !== undefined) sendStdin(socket, stdin).catch(() => undefined);
      });
      return { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode: exitCodeDone };
    },
    async execStream(namespace, pod, command, prelude) {
      const socket = await openExec(namespace, pod, command, true);
      if (prelude !== undefined) await sendStdin(socket, prelude).catch((error: Error) => { socket.terminate(); throw error; });
      const stream = new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
          if (socket.readyState !== WebSocket.OPEN) { callback(new Error("the exec stream is closed")); return; }
          const payload = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          socket.send(Buffer.concat([Buffer.from([0]), payload]), { binary: true }, callback);
        },
        final(callback) { socket.close(); callback(); },
      });
      socket.on("message", (data) => {
        const frame = frameData(data);
        if (frame.length > 1 && frame[0] === 1) stream.push(Buffer.from(frame.subarray(1)));
      });
      socket.on("close", () => stream.push(null));
      socket.on("error", (error) => stream.destroy(error));
      return stream;
    },
    async execTty(namespace, pod, command, size) {
      const socket = await openExec(namespace, pod, command, true, true);
      const send = (channel: number, payload: Buffer) => new Promise<void>((resolve, reject) => {
        if (socket.readyState !== WebSocket.OPEN) { reject(new Error("the exec stream is closed")); return; }
        socket.send(Buffer.concat([Buffer.from([channel]), payload]), { binary: true }, (error) => (error ? reject(error) : resolve()));
      });
      const resize = async (next: { cols: number; rows: number }) => {
        const Width = Math.max(2, Math.min(1000, Math.floor(next.cols)));
        const Height = Math.max(1, Math.min(500, Math.floor(next.rows)));
        await send(4, Buffer.from(JSON.stringify({ Width, Height }))).catch(() => undefined);
      };
      const stream = new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
          const payload = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          send(0, payload).then(() => callback(), callback);
        },
        final(callback) { socket.close(); callback(); },
        destroy(error, callback) { socket.terminate(); callback(error); },
      });
      socket.on("message", (data) => {
        const frame = frameData(data);
        if (frame.length > 1 && frame[0] === 1) stream.push(Buffer.from(frame.subarray(1)));
      });
      socket.on("close", () => stream.push(null));
      socket.on("error", (error) => stream.destroy(error));
      await resize(size);
      return { stream, resize };
    },
    async metrics(namespace, pod) {
      const response = await call("GET", `/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}`);
      if (response.status === 404 || response.status === 503) return null;
      if (response.status !== 200) return null;
      const containers = (response.body as { containers?: { usage?: { cpu?: string; memory?: string } }[] }).containers ?? [];
      const usage = containers[0]?.usage;
      if (!usage?.cpu && !usage?.memory) return null;
      return { cpu: parseCpuQuantity(usage.cpu ?? "0"), memoryBytes: parseMemoryQuantity(usage.memory ?? "0") };
    },
  };
}
