// A fake Sagax desktop app for tests: it connects to an organization server
// as the signed-in person (their session cookie), answers the desktop
// bridge's operations with a handler, and serves the network tunnel, opening
// connections through a resolver of its own (so a host only "its" network
// knows can be reached through it, and nothing else).
import { randomBytes, randomUUID } from "node:crypto";
import { connect } from "node:net";
import type { Socket } from "node:net";

type Operation = Record<string, unknown> & { action: string };
type ToolResult = { content: { type: string; text?: string }[]; isError?: boolean };

const TUNNEL = { OPEN: 1, OPENED: 2, FAILED: 3, DATA: 4, END: 5 } as const;
const message = (type: number, stream: number, payload: Buffer = Buffer.alloc(0)) => {
  const header = Buffer.alloc(5);
  header[0] = type;
  header.writeUInt32BE(stream, 1);
  return Buffer.concat([header, payload]);
};

export interface FakeDesktop {
  id: string;
  secret: string;
  operations: Operation[];
  /** stage_file: name -> bytes written */
  staged: Map<string, Buffer>;
  /** host:port the tunnel was asked to open */
  opened: string[];
  /** Progress steps sent for a job, and whether the server took them. */
  progress: { message: string; ok: boolean }[];
  tunnelOpen: Promise<void>;
  close(): Promise<void>;
}

export async function connectFakeDesktop(options: {
  base: string;
  cookie: string;
  name?: string;
  attachmentsDir?: string;
  /** The platform the app reports (default linux). */
  platform?: "darwin" | "win32" | "linux";
  handle?: (operation: Operation, progress: (message: string) => Promise<void>) => Promise<ToolResult> | ToolResult;
  /** Where the tunnel connects for a host:port; null refuses (outside-lan). */
  resolve?: (host: string, port: number) => { host: string; port: number } | null;
  tunnel?: boolean;
}): Promise<FakeDesktop> {
  const id = randomUUID();
  const secret = randomBytes(32).toString("hex");
  const headers = { "content-type": "application/json", cookie: options.cookie, "x-sagax-bridge-secret": secret };
  const post = async (path: string, body: unknown, signal?: AbortSignal) => {
    const res = await fetch(`${options.base}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal });
    const parsed = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) throw Object.assign(new Error(String(parsed.error ?? res.status)), { status: res.status });
    return parsed;
  };
  await post("/api/desktop-bridge/connect", {
    id, name: options.name ?? "Fake desktop", platform: options.platform ?? "linux", attachmentsDir: options.attachmentsDir ?? "/tmp/sagax-fake/attachments",
    capabilities: { shell: true, files: true, fetch: true, browser: true, computer: false, localVm: true },
  });
  const operations: Operation[] = [];
  const staged = new Map<string, Buffer>();
  const opened: string[] = [];
  const progressSent: { message: string; ok: boolean }[] = [];
  const abort = new AbortController();
  let stopped = false;
  const handle = async (operation: Operation, jobId: string): Promise<ToolResult> => {
    if (operation.action === "stage_file") {
      const name = String(operation.name);
      const data = Buffer.from(String(operation.content ?? ""), "base64");
      staged.set(name, Buffer.concat([operation.offset ? staged.get(name) ?? Buffer.alloc(0) : Buffer.alloc(0), data]));
      return { content: [{ type: "text", text: "ok" }] };
    }
    if (operation.action === "read_file") {
      const wanted = String(operation.path ?? "");
      for (const [name, bytes] of staged) if (wanted.endsWith(`/${name}`)) return { content: [{ type: "text", text: `desktop:${bytes.toString("utf8")}` }] };
    }
    const progress = async (message: string) => {
      const answer = await post(`/api/desktop-bridge/${id}/progress`, { jobId, message }, abort.signal).catch(() => ({ ok: false }));
      progressSent.push({ message, ok: answer.ok === true });
    };
    return options.handle ? options.handle(operation, progress) : { content: [{ type: "text", text: `desktop:${operation.action}` }] };
  };
  void (async () => {
    while (!stopped) {
      try {
        const { job } = await post(`/api/desktop-bridge/${id}/poll`, {}, abort.signal) as { job?: { id: string; operation: Operation } | null };
        if (!job) continue;
        operations.push(job.operation);
        const result = await handle(job.operation, job.id).catch((error: Error) => ({ content: [{ type: "text", text: error.message }], isError: true }));
        await post(`/api/desktop-bridge/${id}/result`, { jobId: job.id, result }, abort.signal);
      } catch {
        if (stopped) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  })();

  const tunnel = options.tunnel === false ? null : openFakeTunnel({
    url: `${options.base.replace(/^http/, "ws")}/api/desktop-bridge/${id}/tunnel`,
    headers: { cookie: options.cookie, "x-sagax-bridge-secret": secret },
    resolve: options.resolve, opened,
  });
  const tunnelOpen = tunnel ? tunnel.ready : Promise.resolve();
  return {
    id, secret, operations, staged, opened, progress: progressSent, tunnelOpen,
    async close() {
      stopped = true;
      abort.abort();
      tunnel?.close();
      await fetch(`${options.base}/api/desktop-bridge/${id}/disconnect`, { method: "POST", headers, body: "{}" }).catch(() => undefined);
    },
  };
}

/** The desktop's side of the network tunnel (electron/desktop-tunnel.mjs in
 * the app), opening each connection through `resolve`. */
export function openFakeTunnel(options: {
  url: string;
  headers: Record<string, string>;
  resolve?: (host: string, port: number) => { host: string; port: number } | null;
  opened?: string[];
}): { ready: Promise<void>; close(): void } {
  const streams = new Map<number, Socket>();
  const socket = new WebSocket(options.url, { headers: options.headers } as unknown as string[]);
  socket.binaryType = "arraybuffer";
  const ready = new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("tunnel refused"));
  });
  socket.onmessage = (event) => {
    const data = Buffer.from(event.data as ArrayBuffer);
    const type = data[0]!;
    const stream = data.readUInt32BE(1);
    const payload = data.subarray(5);
    if (type === TUNNEL.OPEN) {
      const { host, port } = JSON.parse(payload.toString("utf8")) as { host: string; port: number };
      options.opened?.push(`${host}:${port}`);
      const target = options.resolve ? options.resolve(host, port) : { host, port };
      if (!target) { socket.send(message(TUNNEL.FAILED, stream, Buffer.from(JSON.stringify({ code: "outside-lan", message: "outside your local network" })))); return; }
      const upstream = connect(target.port, target.host);
      streams.set(stream, upstream);
      upstream.on("connect", () => socket.send(message(TUNNEL.OPENED, stream)));
      upstream.on("data", (chunk: Buffer) => socket.send(message(TUNNEL.DATA, stream, chunk)));
      upstream.on("end", () => socket.send(message(TUNNEL.END, stream)));
      upstream.on("error", () => { streams.delete(stream); socket.send(message(TUNNEL.FAILED, stream, Buffer.from(JSON.stringify({ message: "refused" })))); });
    } else if (type === TUNNEL.DATA) streams.get(stream)?.write(payload);
    else if (type === TUNNEL.END) streams.get(stream)?.end();
  };
  return { ready, close: () => { socket.close(); for (const stream of streams.values()) stream.destroy(); } };
}
