// The provisioner's Docker Engine API client, over the unix socket only the
// provisioner container mounts. Small on purpose: the calls the sandbox
// lifecycle needs and nothing that could build an arbitrary container.
import { request } from "node:http";
import { Duplex } from "node:stream";

export interface ExecRequest {
  Cmd: string[];
  User: string;
  Env: string[];
  WorkingDir: string;
}

export interface ExecResult {
  exitCode: number | null;
  stdout: Buffer;
  stderr: Buffer;
  truncated: boolean;
}

export interface TtySize {
  cols: number;
  rows: number;
}

/** An interactive exec: one raw stream (a terminal has no separate stderr). */
export interface TtyExec {
  stream: Duplex;
  resize(size: TtySize): Promise<void>;
}

export interface ContainerSummary {
  name: string;
  /** Running or paused: it holds its memory either way. */
  running: boolean;
  /** Frozen by `docker pause` (Docker reports it running too). */
  paused?: boolean;
  labels: Record<string, string>;
  /** Docker's own State.StartedAt, ms. */
  startedAt?: number;
  /** The image it was created from, as named at create (Config.Image). */
  image?: string;
  /** Kubernetes only: the Pod exists but does not run yet (a node being
   * added, the volume attaching, the image pulling). Never set by Docker. */
  starting?: boolean;
}

export interface ContainerStats {
  /** CPU used over the sample, in CPUs (1.0 = one full CPU). */
  cpus: number;
  /** Memory in use, page cache that can be reclaimed left out. */
  memoryBytes: number;
  memoryLimitBytes: number;
}

/** CPUs used between two samples of Docker's stats, and memory without the
 * reclaimable page cache (cgroup v2 inactive_file, v1 total_inactive_file). */
export function statsFromDocker(raw: Record<string, unknown>): ContainerStats {
  const cpu = (raw.cpu_stats ?? {}) as { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number; online_cpus?: number };
  const pre = (raw.precpu_stats ?? {}) as { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
  const cpuDelta = (cpu.cpu_usage?.total_usage ?? 0) - (pre.cpu_usage?.total_usage ?? 0);
  const systemDelta = (cpu.system_cpu_usage ?? 0) - (pre.system_cpu_usage ?? 0);
  const online = cpu.online_cpus ?? 1;
  const cpus = cpuDelta > 0 && systemDelta > 0 ? (cpuDelta / systemDelta) * online : 0;
  const memory = (raw.memory_stats ?? {}) as { usage?: number; limit?: number; stats?: Record<string, number> };
  const cache = memory.stats?.inactive_file ?? memory.stats?.total_inactive_file ?? 0;
  return { cpus, memoryBytes: Math.max(0, (memory.usage ?? 0) - cache), memoryLimitBytes: memory.limit ?? 0 };
}

export interface DockerApi {
  ping(): Promise<boolean>;
  imageExists(image: string): Promise<boolean>;
  inspectContainer(name: string): Promise<ContainerSummary | null>;
  listContainers(labels: Record<string, string>): Promise<ContainerSummary[]>;
  createContainer(name: string, spec: Record<string, unknown>): Promise<void>;
  startContainer(name: string): Promise<void>;
  stopContainer(name: string, timeoutSeconds: number): Promise<void>;
  pauseContainer(name: string): Promise<void>;
  unpauseContainer(name: string): Promise<void>;
  /** One sample of the container's CPU and memory (Docker's stats API). */
  containerStats(name: string): Promise<ContainerStats>;
  removeContainer(name: string): Promise<void>;
  inspectNetwork(name: string): Promise<{ labels: Record<string, string>; subnets: string[] } | null>;
  listNetworks(labels: Record<string, string>): Promise<{ name: string; subnets: string[] }[]>;
  createNetwork(spec: Record<string, unknown>): Promise<void>;
  removeNetwork(name: string): Promise<void>;
  inspectVolume(name: string): Promise<{ labels: Record<string, string> } | null>;
  /** Kubernetes: raise an existing workspace claim to the configured size
   * when it was made smaller (the default grew from 2 GiB to 20 GiB on
   * 2026-11-02). Best effort; Docker volumes have no size to grow. */
  growVolume?(name: string): Promise<void>;
  createVolume(spec: Record<string, unknown>): Promise<void>;
  removeVolume(name: string): Promise<void>;
  /** Run to completion. `stdin`, when given, is written to the command's
   * stdin, which is then closed; without it the stdin is empty. */
  exec(name: string, exec: ExecRequest, maxBytes: number, stdin?: Buffer): Promise<ExecResult>;
  /** One exec whose stdin and stdout stay open as a byte stream (the live
   * view's relay to the desktop's VNC port, inside the sandbox). stdout is
   * demultiplexed; stderr is dropped. Ending the stream closes the exec. */
  execStream(name: string, exec: ExecRequest): Promise<Duplex>;
  /** One interactive exec in a terminal (Tty): the in-chat terminal. Input
   * and output are one raw byte stream; `resize` sets the terminal's size.
   * Optional so a test double without it still type-checks; the service
   * refuses a terminal when it is missing. */
  execTty?(name: string, exec: ExecRequest, size: TtySize): Promise<TtyExec>;
  /** Create, run to completion, collect output and remove a one-shot
   * container (the egress policy helper only). */
  runOnce(name: string, spec: Record<string, unknown>, timeoutMs: number): Promise<{ exitCode: number; output: string }>;
}

class DockerError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
function safeName(name: string): string {
  if (!NAME_RE.test(name)) throw new Error("invalid Docker object name");
  return encodeURIComponent(name);
}

function labelFilter(labels: Record<string, string>): string {
  return encodeURIComponent(JSON.stringify({ label: Object.entries(labels).map(([key, value]) => `${key}=${value}`) }));
}

export function demuxDockerStream(chunks: Buffer, maxBytes: number): { stdout: Buffer; stderr: Buffer; truncated: boolean } {
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let outSize = 0;
  let errSize = 0;
  let truncated = false;
  let offset = 0;
  while (offset + 8 <= chunks.length) {
    const stream = chunks[offset]!;
    const size = chunks.readUInt32BE(offset + 4);
    const payload = chunks.subarray(offset + 8, Math.min(chunks.length, offset + 8 + size));
    offset += 8 + size;
    if (stream === 2) {
      const room = Math.max(0, maxBytes - errSize);
      if (payload.length > room) truncated = true;
      err.push(payload.subarray(0, room));
      errSize += Math.min(room, payload.length);
    } else {
      const room = Math.max(0, maxBytes - outSize);
      if (payload.length > room) truncated = true;
      out.push(payload.subarray(0, room));
      outSize += Math.min(room, payload.length);
    }
  }
  return { stdout: Buffer.concat(out), stderr: Buffer.concat(err), truncated };
}

/** Docker's multiplexed attach stream, decoded as it arrives: each frame is
 * an 8-byte header (stream id, 3 zero bytes, big-endian size) and a payload.
 * Only stdout (1) is passed on. */
export function dockerStreamDemuxer(onStdout: (chunk: Buffer) => void): (chunk: Buffer) => void {
  let pending: Buffer = Buffer.alloc(0);
  return (chunk) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= 8) {
      const size = pending.readUInt32BE(4);
      if (pending.length < 8 + size) break;
      const stream = pending[0];
      const payload = pending.subarray(8, 8 + size);
      pending = pending.subarray(8 + size);
      if (stream === 1 && payload.length) onStdout(Buffer.from(payload));
    }
  };
}

/** The daemon's own API version, so the client works from Docker 24 (1.43)
 * to Docker 29 (minimum 1.44) without pinning either end. */
function negotiateVersion(socketPath: string): Promise<string> {
  return new Promise((resolve) => {
    const req = request({ socketPath, method: "GET", path: "/version", timeout: 10_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const version = String((JSON.parse(Buffer.concat(chunks).toString("utf8")) as { ApiVersion?: string }).ApiVersion ?? "");
          resolve(/^\d+\.\d+$/.test(version) ? `v${version}` : "v1.44");
        } catch { resolve("v1.44"); }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve("v1.44"));
    req.end();
  });
}

export function dockerApi(socketPath: string, pinnedVersion?: string): DockerApi {
  let version: Promise<string> | null = pinnedVersion ? Promise.resolve(pinnedVersion) : null;
  const call = async (method: string, path: string, body?: unknown, options: { raw?: boolean; maxBytes?: number; timeoutMs?: number } = {}) => {
    version ??= negotiateVersion(socketPath);
    const apiVersion = await version;
    return new Promise<{ status: number; body: Buffer; truncated: boolean }>((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const req = request({
        socketPath,
        method,
        path: `/${apiVersion}${path}`,
        headers: payload ? { "content-type": "application/json", "content-length": payload.length } : {},
        timeout: options.timeoutMs ?? 60_000,
      }, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const cap = (options.maxBytes ?? 4 * 1024 * 1024) * 2 + 65_536;
        res.on("data", (chunk: Buffer) => {
          if (size + chunk.length > cap) {
            truncated = true;
            chunks.push(chunk.subarray(0, Math.max(0, cap - size)));
            size = cap;
            res.destroy();
            return;
          }
          size += chunk.length;
          chunks.push(chunk);
        });
        const finish = () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), truncated });
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", (error) => truncated ? finish() : reject(error));
      });
      req.on("timeout", () => req.destroy(new Error("Docker request timed out")));
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  };

  const json = async (method: string, path: string, body?: unknown, okStatuses: number[] = [200, 201, 204]) => {
    const response = await call(method, path, body);
    if (!okStatuses.includes(response.status)) {
      let message = response.body.toString("utf8").slice(0, 500);
      try { message = (JSON.parse(message) as { message?: string }).message ?? message; } catch { /* plain text */ }
      throw new DockerError(response.status, `Docker ${method} ${path.split("?")[0]} failed (${response.status}): ${message}`);
    }
    const text = response.body.toString("utf8");
    return text ? JSON.parse(text) as Record<string, unknown> : {};
  };
  const orNull = async <T>(work: () => Promise<T>): Promise<T | null> => {
    try { return await work(); } catch (error) {
      if (error instanceof DockerError && error.status === 404) return null;
      throw error;
    }
  };
  const summary = (raw: Record<string, unknown>): ContainerSummary => {
    const config = (raw.Config ?? {}) as { Labels?: Record<string, string>; Image?: string };
    const state = (raw.State ?? {}) as { Running?: boolean; Paused?: boolean; StartedAt?: string };
    const started = state.StartedAt ? Date.parse(state.StartedAt) : NaN;
    return {
      name: String(raw.Name ?? "").replace(/^\//, ""),
      running: state.Running === true,
      ...(state.Paused === true ? { paused: true } : {}),
      labels: config.Labels ?? {},
      ...(Number.isFinite(started) && started > 0 ? { startedAt: started } : {}),
      ...(typeof config.Image === "string" && config.Image ? { image: config.Image } : {}),
    };
  };
  const subnetsOf = (raw: Record<string, unknown>) =>
    (((raw.IPAM as { Config?: { Subnet?: string }[] } | undefined)?.Config) ?? []).map((entry) => entry.Subnet).filter((value): value is string => Boolean(value));
  /** Start an exec and take over its connection (HTTP upgrade to raw tcp). */
  const attachExec = async (id: string, tty: boolean) => {
    version ??= negotiateVersion(socketPath);
    const apiVersion = await version;
    const payload = Buffer.from(JSON.stringify({ Detach: false, Tty: tty }));
    return new Promise<import("node:net").Socket>((resolve, reject) => {
      const req = request({
        socketPath, method: "POST", path: `/${apiVersion}/exec/${id}/start`, timeout: 30_000,
        headers: { "content-type": "application/json", "content-length": payload.length, connection: "Upgrade", upgrade: "tcp" },
      });
      req.on("upgrade", (_res, upgraded, head) => {
        upgraded.setTimeout(0);
        if (head.length) upgraded.unshift(head);
        resolve(upgraded);
      });
      req.on("response", (res) => { res.resume(); reject(new DockerError(res.statusCode ?? 0, `Docker exec attach failed (${res.statusCode})`)); });
      req.on("timeout", () => req.destroy(new Error("Docker request timed out")));
      req.on("error", reject);
      req.end(payload);
    });
  };

  return {
    async ping() {
      try { return (await call("GET", "/_ping")).status === 200; } catch { return false; }
    },
    async imageExists(image) {
      const response = await call("GET", `/images/${encodeURIComponent(image)}/json`);
      return response.status === 200;
    },
    inspectContainer: (name) => orNull(async () => summary(await json("GET", `/containers/${safeName(name)}/json`))),
    async listContainers(labels) {
      const rows = await json("GET", `/containers/json?all=1&filters=${labelFilter(labels)}`) as unknown as { Names?: string[]; State?: string; Labels?: Record<string, string> }[];
      return rows.map((row) => ({
        name: (row.Names?.[0] ?? "").replace(/^\//, ""),
        running: row.State === "running" || row.State === "paused",
        ...(row.State === "paused" ? { paused: true } : {}),
        labels: row.Labels ?? {},
      }));
    },
    async createContainer(name, spec) { await json("POST", `/containers/create?name=${safeName(name)}`, spec); },
    async startContainer(name) { await json("POST", `/containers/${safeName(name)}/start`, undefined, [204, 304]); },
    async stopContainer(name, timeoutSeconds) { await json("POST", `/containers/${safeName(name)}/stop?t=${Math.max(0, Math.floor(timeoutSeconds))}`, undefined, [204, 304, 404]); },
    async pauseContainer(name) { await json("POST", `/containers/${safeName(name)}/pause`, undefined, [204, 304]); },
    async unpauseContainer(name) { await json("POST", `/containers/${safeName(name)}/unpause`, undefined, [204, 304]); },
    async containerStats(name) { return statsFromDocker(await json("GET", `/containers/${safeName(name)}/stats?stream=false`)); },
    async removeContainer(name) { await json("DELETE", `/containers/${safeName(name)}?force=1&v=0`, undefined, [204, 404]); },
    inspectNetwork: (name) => orNull(async () => {
      const raw = await json("GET", `/networks/${safeName(name)}`);
      return { labels: (raw.Labels ?? {}) as Record<string, string>, subnets: subnetsOf(raw) };
    }),
    async listNetworks(labels) {
      const rows = await json("GET", `/networks?filters=${labelFilter(labels)}`) as unknown as Record<string, unknown>[];
      return rows.map((row) => ({ name: String(row.Name ?? ""), subnets: subnetsOf(row) }));
    },
    async createNetwork(spec) { await json("POST", "/networks/create", spec); },
    async removeNetwork(name) { await json("DELETE", `/networks/${safeName(name)}`, undefined, [204, 404]); },
    inspectVolume: (name) => orNull(async () => {
      const raw = await json("GET", `/volumes/${safeName(name)}`);
      return { labels: (raw.Labels ?? {}) as Record<string, string> };
    }),
    async createVolume(spec) { await json("POST", "/volumes/create", spec); },
    async removeVolume(name) { await json("DELETE", `/volumes/${safeName(name)}`, undefined, [204, 404]); },
    async exec(name, exec, maxBytes, stdin) {
      const created = await json("POST", `/containers/${safeName(name)}/exec`, {
        AttachStdin: stdin !== undefined, AttachStdout: true, AttachStderr: true, Tty: false, Privileged: false, ...exec,
      });
      const id = String(created.Id ?? "");
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Docker returned no exec id");
      let output: { body: Buffer; truncated: boolean };
      if (stdin === undefined) {
        const started = await call("POST", `/exec/${id}/start`, { Detach: false, Tty: false }, { raw: true, maxBytes, timeoutMs: 15 * 60_000 });
        if (started.status !== 200 && started.status !== 101) throw new DockerError(started.status, `Docker exec start failed (${started.status})`);
        output = started;
      } else {
        // stdin needs the hijacked connection: write it, close our side
        // (the command reads end of file), read the multiplexed output.
        const socket = await attachExec(id, false);
        output = await new Promise<{ body: Buffer; truncated: boolean }>((resolve) => {
          const chunks: Buffer[] = [];
          let size = 0;
          let truncated = false;
          const cap = maxBytes * 2 + 65_536;
          const timer = setTimeout(() => socket.destroy(new Error("Docker exec timed out")), 15 * 60_000);
          const finish = () => { clearTimeout(timer); resolve({ body: Buffer.concat(chunks), truncated }); };
          socket.on("data", (chunk: Buffer) => {
            if (truncated) return;
            if (size + chunk.length > cap) {
              truncated = true;
              chunks.push(chunk.subarray(0, Math.max(0, cap - size)));
              size = cap;
              socket.destroy();
              return;
            }
            size += chunk.length;
            chunks.push(chunk);
          });
          socket.on("end", finish);
          socket.on("close", finish);
          // a command that ends before reading all of stdin breaks the pipe:
          // what it wrote and its exit code (inspected below) still answer
          socket.on("error", finish);
          socket.end(stdin);
        });
      }
      const streams = demuxDockerStream(output.body, maxBytes);
      let exitCode: number | null = null;
      for (let attempt = 0; attempt < 20; attempt++) {
        const inspected = await json("GET", `/exec/${id}/json`) as { Running?: boolean; ExitCode?: number | null };
        if (!inspected.Running) { exitCode = inspected.ExitCode ?? null; break; }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return { exitCode, stdout: streams.stdout, stderr: streams.stderr, truncated: streams.truncated || output.truncated };
    },
    async execTty(name, exec, size) {
      const created = await json("POST", `/containers/${safeName(name)}/exec`, {
        AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true, Privileged: false,
        ConsoleSize: [size.rows, size.cols], ...exec,
      });
      const id = String(created.Id ?? "");
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Docker returned no exec id");
      const socket = await attachExec(id, true);
      const stream = new Duplex({
        write(chunk: Buffer, _encoding, callback) { socket.write(chunk, callback); },
        final(callback) { socket.end(); callback(); },
        read() { socket.resume(); },
        destroy(error, callback) { socket.destroy(); callback(error); },
      });
      // A terminal's output is raw: no 8-byte stream headers to remove.
      socket.on("data", (chunk: Buffer) => { if (!stream.push(chunk)) socket.pause(); });
      socket.on("end", () => stream.push(null));
      socket.on("close", () => { if (!stream.destroyed) stream.destroy(); });
      socket.on("error", (error) => stream.destroy(error));
      return {
        stream,
        async resize(next) {
          const rows = Math.max(1, Math.min(500, Math.floor(next.rows)));
          const cols = Math.max(2, Math.min(1000, Math.floor(next.cols)));
          await call("POST", `/exec/${id}/resize?h=${rows}&w=${cols}`, undefined, { timeoutMs: 10_000 }).catch(() => undefined);
        },
      };
    },
    async execStream(name, exec) {
      const created = await json("POST", `/containers/${safeName(name)}/exec`, {
        AttachStdin: true, AttachStdout: true, AttachStderr: false, Tty: false, Privileged: false, ...exec,
      });
      const id = String(created.Id ?? "");
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Docker returned no exec id");
      const socket = await attachExec(id, false);
      const stream = new Duplex({
        write(chunk: Buffer, _encoding, callback) { socket.write(chunk, callback); },
        final(callback) { socket.end(); callback(); },
        read() { socket.resume(); },
        destroy(error, callback) { socket.destroy(); callback(error); },
      });
      const demux = dockerStreamDemuxer((chunk) => { if (!stream.push(chunk)) socket.pause(); });
      socket.on("data", demux);
      socket.on("end", () => stream.push(null));
      socket.on("close", () => { if (!stream.destroyed) stream.destroy(); });
      socket.on("error", (error) => stream.destroy(error));
      return stream;
    },
    async runOnce(name, spec, timeoutMs) {
      await json("DELETE", `/containers/${safeName(name)}?force=1`, undefined, [204, 404]);
      await json("POST", `/containers/create?name=${safeName(name)}`, spec);
      try {
        await json("POST", `/containers/${safeName(name)}/start`, undefined, [204, 304]);
        const waited = await call("POST", `/containers/${safeName(name)}/wait`, undefined, { timeoutMs });
        const exitCode = Number((JSON.parse(waited.body.toString("utf8") || "{}") as { StatusCode?: number }).StatusCode ?? -1);
        const logs = await call("GET", `/containers/${safeName(name)}/logs?stdout=1&stderr=1`);
        const streams = demuxDockerStream(logs.body, 64 * 1024);
        return { exitCode, output: `${streams.stdout.toString("utf8")}${streams.stderr.toString("utf8")}` };
      } finally {
        await json("DELETE", `/containers/${safeName(name)}?force=1`, undefined, [204, 404]).catch(() => {});
      }
    },
  };
}
