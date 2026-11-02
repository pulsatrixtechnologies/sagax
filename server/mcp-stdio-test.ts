// The console's Test for an MCP server started by command (stdio):
// POST connections/test { kind: "mcp" } (server/org/org-admin-ops.ts). The
// command starts with its configured arguments and variables, answers the
// MCP initialize handshake and lists its tools within a time limit, and is
// always stopped after. The answer has the shape of every other line's test,
// { ok, reason, label }: on success the label counts the tools, on a failure
// it says what failed (the command could not start, it exited with a code,
// it refused the handshake, it did not answer in time).
//
// Never in an answer or a log: a variable's value, the arguments, the
// command's stderr. A message the server writes itself is redacted against
// the configured values before it is shown.
//
// An organization's server runs on the Sagax host, the way its bots run it;
// a person's own server runs in that person's server environment
// (server/sandbox-stdio-mcp.ts), never on the host.
import type { Duplex } from "node:stream";

import { createLineSplitter } from "./mcp-bridge.ts";
import { probeEnvironment, STDIO_PROBE_TIMEOUT_MS } from "./mcp-probe.ts";
import type { TestResult } from "./org/org-admin-ops.ts";
import { killCliTree, spawnCli } from "./procs.ts";
import { redactSecretsInText } from "./redact.ts";

export interface StdioTestServer {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface StdioTestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** A command that bridges to a big server prints a big tools list. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const PROTOCOL_VERSION = "2025-06-18";

/** One way to talk to the command: a child process here, or a stream to the
 * person's server environment. */
interface Channel {
  write(line: string): void;
  listen(handlers: { data: (chunk: Buffer) => void; ended: (detail: string) => void; failed: (detail: string) => void }): void;
  close(): void;
}

function scrub(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) if (secret.length >= 3) out = out.split(secret).join("[redacted]");
  return redactSecretsInText(out).replace(/\s+/g, " ").trim().slice(0, 300);
}

/** The values never to show: every variable's value and every argument
 * long enough to be a token. */
function secretsOf(server: StdioTestServer): string[] {
  return [...Object.values(server.env), ...server.args.filter((arg) => arg.length >= 8)]
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort((a, b) => b.length - a.length);
}

function rpcMessage(error: unknown): string {
  const message = error && typeof error === "object" ? (error as { message?: unknown }).message : undefined;
  return typeof message === "string" && message.trim() ? message : "no message";
}

/** The MCP handshake over one channel: initialize, notifications/initialized,
 * tools/list. Settles once, and closes the channel when it does. */
function handshake(channel: Channel, secrets: string[], options: StdioTestOptions): Promise<TestResult> {
  const timeoutMs = options.timeoutMs ?? STDIO_PROBE_TIMEOUT_MS;
  const signal = options.signal;
  return new Promise((resolve) => {
    let settled = false;
    let phase: "initialize" | "tools/list" = "initialize";
    let firstLine = true;
    let bytes = 0;
    const finish = (result: TestResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      try { channel.close(); } catch { /* already gone */ }
      resolve(result);
    };
    const fail = (reason: string, label: string) => finish({ ok: false, reason, label });
    const onAbort = () => fail("cancelled", "The test was cancelled.");
    const timer = setTimeout(() => fail("timeout", phase === "initialize"
      ? `The command did not answer the MCP initialize request within ${Math.round(timeoutMs / 100) / 10} s.`
      : `The command did not list its tools within ${Math.round(timeoutMs / 100) / 10} s.`), timeoutMs);
    timer.unref?.();
    const send = (frame: unknown) => {
      try {
        channel.write(`${JSON.stringify(frame)}\n`);
      } catch {
        fail("exited", "The command closed its input before the MCP handshake finished.");
      }
    };
    const splitter = createLineSplitter((raw) => {
      const line = raw.trim();
      if (settled || !line) return;
      let frame: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
        frame = parsed as Record<string, unknown>;
      } catch {
        // A line that is not JSON-RPC (a banner on stdout): skipped.
        return;
      }
      if (firstLine && typeof frame.sagaxStdioError === "string") {
        const message = typeof frame.message === "string" ? frame.message : frame.sagaxStdioError;
        fail("environment_refused", `The server environment could not start the command: ${scrub(message, secrets)}.`);
        return;
      }
      firstLine = false;
      const hasId = frame.id !== undefined && frame.id !== null;
      if (hasId && typeof frame.method === "string") {
        // The server asks something of its client: not supported by a test.
        send({ jsonrpc: "2.0", id: frame.id, error: { code: -32601, message: "Not supported by Sagax." } });
        return;
      }
      if (frame.id === 1 && phase === "initialize") {
        if (frame.error !== undefined) {
          fail("handshake_refused", `The command refused the MCP initialize request: ${scrub(rpcMessage(frame.error), secrets)}.`);
          return;
        }
        if (!frame.result || typeof frame.result !== "object") {
          fail("protocol", "The command answered initialize without a result.");
          return;
        }
        phase = "tools/list";
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        return;
      }
      if (frame.id === 2 && phase === "tools/list") {
        if (frame.error !== undefined) {
          fail("tools_refused", `The command refused to list its tools: ${scrub(rpcMessage(frame.error), secrets)}.`);
          return;
        }
        const tools = (frame.result as { tools?: unknown } | undefined)?.tools;
        if (!Array.isArray(tools)) {
          fail("protocol", "The command did not return a valid MCP tools list.");
          return;
        }
        const count = tools.filter((tool) => !!tool && typeof tool === "object" && typeof (tool as { name?: unknown }).name === "string").length;
        finish({ ok: true, reason: null, label: count === 1 ? "The server answered with 1 tool." : `The server answered with ${count} tools.` });
      }
    });
    channel.listen({
      data: (chunk) => {
        if (settled) return;
        bytes += chunk.byteLength;
        if (bytes > MAX_OUTPUT_BYTES) {
          fail("protocol", "The command wrote more than 8 MB without finishing the MCP handshake.");
          return;
        }
        splitter.push(chunk);
      },
      ended: (detail) => fail("exited", `The command stopped before the MCP handshake finished (${detail}).`),
      failed: (detail) => fail("spawn_failed", detail),
    });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "Sagax", version: "test" } } });
  });
}

/** Start the command on this host, run the handshake, stop it. */
export function testStdioMcpCommand(server: StdioTestServer, options: StdioTestOptions = {}): Promise<TestResult> {
  const secrets = secretsOf(server);
  let child: ReturnType<typeof spawnCli>;
  try {
    child = spawnCli(server.command, server.args, { cwd: process.cwd(), env: probeEnvironment(server), stdio: ["pipe", "pipe", "pipe"] });
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    return Promise.resolve({ ok: false, reason: "spawn_failed", label: `Could not start the command${typeof code === "string" ? ` (${code})` : ""}. Check that it is installed and executable.` });
  }
  const channel: Channel = {
    write: (line) => { child.stdin.write(line); },
    listen: (handlers) => {
      child.stdout.on("data", handlers.data);
      // Drained, never kept: stderr is native logs and may hold secrets.
      child.stderr.resume();
      child.stdin.on("error", () => { /* a dying child's input: the close says why */ });
      child.once("error", (error) => {
        const code = (error as { code?: unknown }).code;
        handlers.failed(`Could not start the command${typeof code === "string" ? ` (${code})` : ""}. Check that it is installed and executable.`);
      });
      child.once("close", (code, signal) => handlers.ended(code !== null ? `exit code ${code}` : `signal ${signal ?? "unknown"}`));
    },
    close: () => { void killCliTree(child); },
  };
  return handshake(channel, secrets, options);
}

/** Open the command in a person's server environment, run the handshake,
 * close the stream (which stops the command there). */
export async function testStdioMcpStream(open: () => Promise<Duplex>, server: StdioTestServer, options: StdioTestOptions = {}): Promise<TestResult> {
  const secrets = secretsOf(server);
  let stream: Duplex;
  try {
    stream = await open();
  } catch (error) {
    const message = error instanceof Error ? error.message : "the server environment refused the command";
    return { ok: false, reason: "environment_refused", label: `The server environment could not start the command: ${scrub(message, secrets)}` };
  }
  const channel: Channel = {
    write: (line) => { stream.write(line); },
    listen: (handlers) => {
      stream.on("data", (chunk: Buffer | string) => handlers.data(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
      stream.once("close", () => handlers.ended("the server environment closed the stream"));
      stream.once("error", () => handlers.ended("the server environment stream failed"));
    },
    close: () => { stream.destroy(); },
  };
  return handshake(channel, secrets, options);
}
