// An in-memory DockerApi for the sandbox provisioner tests: records every
// create body so the tests can assert what would reach a real daemon.
import { Duplex } from "node:stream";

import type { ContainerSummary, DockerApi, ExecRequest, ExecResult, TtyExec, TtySize } from "../sandbox/sandboxd-docker.ts";

export class FakeDocker implements DockerApi {
  containers = new Map<string, { running: boolean; paused?: boolean; labels: Record<string, string>; spec: Record<string, unknown>; startedAt: number }>();
  networks = new Map<string, { labels: Record<string, string>; subnets: string[]; spec: Record<string, unknown> }>();
  volumes = new Map<string, { labels: Record<string, string> }>();
  images = new Set<string>(["sagax-sandbox:test"]);
  calls: string[] = [];
  execs: { name: string; exec: ExecRequest; stdin?: Buffer }[] = [];
  execResult: (exec: ExecRequest) => ExecResult = () => ({ exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.alloc(0), truncated: false });
  helperOutput = { exitCode: 0, output: "sagax-egress-ok\n" };
  now: () => number = Date.now;

  async ping() { return true; }
  async imageExists(image: string) { return this.images.has(image); }
  async inspectContainer(name: string): Promise<ContainerSummary | null> {
    const found = this.containers.get(name);
    const image = typeof found?.spec.Image === "string" ? { image: found.spec.Image } : {};
    return found ? { name, running: found.running, ...(found.paused ? { paused: true } : {}), labels: found.labels, startedAt: found.startedAt, ...image } : null;
  }
  async listContainers(labels: Record<string, string>) {
    return [...this.containers].filter(([, value]) => Object.entries(labels).every(([key, want]) => value.labels[key] === want))
      .map(([name, value]) => ({ name, running: value.running, ...(value.paused ? { paused: true } : {}), labels: value.labels, startedAt: value.startedAt }));
  }
  async createContainer(name: string, spec: Record<string, unknown>) {
    this.calls.push(`create ${name}`);
    if (this.containers.has(name)) throw new Error("conflict");
    this.containers.set(name, { running: false, labels: (spec.Labels ?? {}) as Record<string, string>, spec, startedAt: 0 });
  }
  async startContainer(name: string) {
    this.calls.push(`start ${name}`);
    const found = this.containers.get(name);
    if (!found) throw new Error("no such container");
    found.running = true;
    found.startedAt = this.now();
  }
  async stopContainer(name: string) {
    this.calls.push(`stop ${name}`);
    const found = this.containers.get(name);
    if (found) { found.running = false; found.paused = false; }
  }
  async removeContainer(name: string) { this.calls.push(`rm ${name}`); this.containers.delete(name); }
  async inspectNetwork(name: string) {
    const found = this.networks.get(name);
    return found ? { labels: found.labels, subnets: found.subnets } : null;
  }
  async listNetworks(labels: Record<string, string>) {
    return [...this.networks].filter(([, value]) => Object.entries(labels).every(([key, want]) => value.labels[key] === want))
      .map(([name, value]) => ({ name, subnets: value.subnets }));
  }
  async createNetwork(spec: Record<string, unknown>) {
    const name = String(spec.Name);
    this.calls.push(`net ${name}`);
    const subnets = ((spec.IPAM as { Config: { Subnet: string }[] }).Config).map((entry) => entry.Subnet);
    this.networks.set(name, { labels: (spec.Labels ?? {}) as Record<string, string>, subnets, spec });
  }
  async removeNetwork(name: string) { this.calls.push(`rmnet ${name}`); this.networks.delete(name); }
  async inspectVolume(name: string) { return this.volumes.get(name) ?? null; }
  async createVolume(spec: Record<string, unknown>) {
    this.calls.push(`vol ${String(spec.Name)}`);
    this.volumes.set(String(spec.Name), { labels: (spec.Labels ?? {}) as Record<string, string> });
  }
  async removeVolume(name: string) { this.calls.push(`rmvol ${name}`); this.volumes.delete(name); }
  async exec(name: string, exec: ExecRequest, _maxBytes?: number, stdin?: Buffer) {
    if (!this.containers.get(name)?.running) throw new Error("container not running");
    this.execs.push({ name, exec, ...(stdin ? { stdin } : {}) });
    return this.execResult(exec);
  }
  /** The desktop relay: greets like a VNC server, then echoes what it gets
   * prefixed with "echo:". Every stream opened is kept for the tests. */
  streams: Duplex[] = [];
  async execStream(name: string, exec: ExecRequest) {
    if (!this.containers.get(name)?.running) throw new Error("container not running");
    this.execs.push({ name, exec });
    if (exec.Cmd[0] === "fake-mcp-server") return fakeMcpServerStream(name, exec, this.streams);
    const stream: Duplex = new Duplex({
      read() {},
      write(chunk: Buffer, _encoding, callback) { stream.push(Buffer.concat([Buffer.from("echo:"), chunk])); callback(); },
      final(callback) { stream.push(null); callback(); },
    });
    stream.push(Buffer.from("RFB 003.008\n"));
    this.streams.push(stream);
    return stream;
  }
  /** The in-chat terminal: answers "size" with its size, echoes the rest
   * prefixed with "tty:". Every size it was given is kept. */
  ttySizes: TtySize[] = [];
  async execTty(name: string, exec: ExecRequest, size: TtySize): Promise<TtyExec> {
    if (!this.containers.get(name)?.running) throw new Error("container not running");
    this.execs.push({ name, exec });
    this.ttySizes.push(size);
    let current = size;
    const stream: Duplex = new Duplex({
      read() {},
      write(chunk: Buffer, _encoding, callback) {
        const text = chunk.toString();
        stream.push(Buffer.from(text.trim() === "size" ? `size ${current.cols}x${current.rows}\n` : `tty:${text}`));
        callback();
      },
      final(callback) { stream.push(null); callback(); },
    });
    this.streams.push(stream);
    const sizes = this.ttySizes;
    return {
      stream,
      async resize(next) { current = next; sizes.push(next); },
    };
  }
  async pauseContainer(name: string) {
    this.calls.push(`pause ${name}`);
    const found = this.containers.get(name);
    if (!found?.running) throw new Error("not running");
    found.paused = true;
  }
  async unpauseContainer(name: string) {
    this.calls.push(`unpause ${name}`);
    const found = this.containers.get(name);
    if (found) found.paused = false;
  }
  stats = { cpus: 0.25, memoryBytes: 300 * 1024 * 1024, memoryLimitBytes: 1536 * 1024 * 1024 };
  async containerStats(name: string) {
    if (!this.containers.get(name)?.running) throw new Error("not running");
    return this.stats;
  }
  async runOnce(name: string) {
    this.calls.push(`helper ${name}`);
    return this.helperOutput;
  }
}

/** A person's MCP server command in their sandbox (sandbox-stdio-mcp): a
 * line-delimited JSON-RPC server with one tool, `whoami`, answering which
 * container it runs in and the names of the variables it was given. */
function fakeMcpServerStream(container: string, exec: ExecRequest, streams: Duplex[]): Duplex {
  let buffer = "";
  const stream: Duplex = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, callback) {
      buffer += chunk.toString("utf8");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const frame = JSON.parse(line) as { id?: number | string; method?: string; params?: { name?: string } };
        if (frame.id === undefined || !frame.method) continue;
        const reply = (result: unknown) => stream.push(`${JSON.stringify({ jsonrpc: "2.0", id: frame.id, result })}\n`);
        if (frame.method === "initialize") reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-mcp-server", version: "1" } });
        else if (frame.method === "tools/list") reply({ tools: [{ name: "whoami", description: "who and where", inputSchema: { type: "object", properties: {} } }] });
        else if (frame.method === "tools/call") reply({ content: [{ type: "text", text: `container=${container} env=${exec.Env.map((entry) => entry.split("=")[0]).join(",")} user=${exec.User}` }] });
        else stream.push(`${JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: { code: -32601, message: "no" } })}\n`);
      }
      callback();
    },
    final(callback) { stream.push(null); callback(); },
  });
  streams.push(stream);
  return stream;
}
