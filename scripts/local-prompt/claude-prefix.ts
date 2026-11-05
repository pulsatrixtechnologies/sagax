// Measure the fixed prefix of a Claude Code turn (#1997): what the first
// model request of a new conversation carries before any work, split into
// native tools, Sagax's agents tools, a bot's MCP catalog, the system prompt
// and the first message. The real Claude Code CLI talks to a loopback
// stand-in for the Messages API that records each request; nothing reaches a
// real model or account, and every run uses a disposable HOME.
//
//   node --experimental-strip-types scripts/local-prompt/claude-prefix.ts \
//     --cli /absolute/path/to/claude [--plugin-dir DIR ...] [--append-system-prompt-file FILE] [--json OUT] [--keep DIR]
//
// Each variant runs twice: the second run checks that two new conversations
// send byte-identical tools and system text (the part a prompt cache reuses).
// Tokens are estimated at CHARS_PER_TOKEN (shape.ts), not provider billing.
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CLAUDE_UNUSED_TOOLS } from "../../server/drivers/host-tools.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";
import { estimateTokens, systemText, type MessagesRequest } from "./shape.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function args(name: string): string[] {
  const out: string[] = [];
  for (let index = 0; index < process.argv.length; index++) if (process.argv[index] === `--${name}` && process.argv[index + 1]) out.push(process.argv[index + 1]!);
  return out;
}
const CLI = args("cli")[0];
if (!CLI) {
  console.error("usage: claude-prefix.ts --cli /absolute/path/to/claude [--plugin-dir DIR ...] [--append-system-prompt-file FILE] [--json OUT]");
  process.exit(2);
}

/** The agents proxy env a direct chat of a Primary Bot gets (the profile
 * that mounts the most, agents-catalog-wire.test.ts FULL.direct). */
const AGENTS_PROFILE: Record<string, string> = {
  SAGAX_HARNESS_URL: "http://127.0.0.1:9", SAGAX_BOT_ID: "bot-measure", SAGAX_THREAD_ID: "thread-measure", SAGAX_COMMS_TOKEN: "unused", SAGAX_TURN_DEPTH: "0",
  SAGAX_CHIEF_OF_STAFF: "1", SAGAX_SKILL_AUTHORING_ENABLED: "1", SAGAX_SHARED_COMPUTERS_ENABLED: "1", SAGAX_VOICE_NOTES: "1",
};

interface Variant { name: string; toolSearch: boolean; agentsEnv: Record<string, string> }
/** tool-search-off: before #1990 (turn-prepare-mcp forced tool search off, every agents
 * tool listed whole). current: what turn-prepare-mcp.ts sends today for a bot
 * with little recorded use. known-use (#2037): native tool search with the
 * bot's agents use known (core used, no extra pins). */
const VARIANTS: Variant[] = [
  { name: "tool-search-off", toolSearch: false, agentsEnv: { SAGAX_MERGED_TOOLS: "1" } },
  { name: "current", toolSearch: true, agentsEnv: { SAGAX_DEFER_RARE_TOOLS: "1", SAGAX_MERGED_TOOLS: "1" } },
  { name: "known-use", toolSearch: true, agentsEnv: { SAGAX_DEFER_RARE_TOOLS: "1", SAGAX_MERGED_TOOLS: "1", SAGAX_DEFER_KNOWN_USE: JSON.stringify({ core: "used", pinned: [] }) } },
];

async function capture(dir: string): Promise<{ server: Server; port: number; bodies: () => string[] }> {
  mkdirSync(dir, { recursive: true });
  let count = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (!req.url?.startsWith("/v1/messages") || req.url.includes("count_tokens")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ input_tokens: 1, data: [] }));
        return;
      }
      count += 1;
      writeFileSync(join(dir, `request-${String(count).padStart(3, "0")}.json`), body);
      let model = "";
      try { model = (JSON.parse(body) as { model?: string }).model ?? ""; } catch { /* not JSON */ }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const event = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      event("message_start", { type: "message_start", message: { id: `m${count}`, type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } });
      event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
      event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Measured." } });
      event("content_block_stop", { type: "content_block_stop", index: 0 });
      event("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } });
      event("message_stop", { type: "message_stop" });
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;
  const bodies = () => readdirSync(dir).filter((name) => name.startsWith("request-")).sort().map((name) => readFileSync(join(dir, name), "utf8"));
  return { server, port, bodies };
}

function runCli(home: string, port: number, variant: Variant): Promise<void> {
  const node = process.execPath;
  const strip = ["--experimental-strip-types", "--no-warnings"];
  const mcp = {
    mcpServers: {
      agents: { command: node, args: [...strip, join(ROOT, "server/drivers/agents-proxy.ts")], env: { ...AGENTS_PROFILE, ...variant.agentsEnv }, alwaysLoad: true },
      catalog: { command: node, args: [...strip, join(ROOT, "scripts/local-prompt/catalog-mcp-server.ts")] },
    },
  };
  const mcpPath = join(home, "mcp.json");
  writeFileSync(mcpPath, JSON.stringify(mcp));
  const cliArgs = ["-p", "How many endpoint threats this week?", "--model", "claude-sonnet-4-5", "--setting-sources", "project", "--strict-mcp-config", "--mcp-config", mcpPath, "--disallowedTools", CLAUDE_UNUSED_TOOLS.join(",")];
  for (const dir of args("plugin-dir")) cliArgs.push("--plugin-dir", dir);
  for (const file of args("append-system-prompt-file")) cliArgs.push("--append-system-prompt-file", file);
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("SAGAX_") && !key.startsWith("CLAUDE") && !key.startsWith("ANTHROPIC") && key !== "ENABLE_TOOL_SEARCH"));
  const child = spawn(CLI!, cliArgs, {
    cwd: home,
    env: {
      ...inherited, HOME: home, CLAUDE_CONFIG_DIR: join(home, "cfg"), ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_API_KEY: "sk-ant-measure-not-a-key",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", ENABLE_CLAUDEAI_MCP_SERVERS: "false", ENABLE_TOOL_SEARCH: variant.toolSearch ? "true" : "false", CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr!.on("data", (chunk) => (stderr += chunk));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`claude timed out: ${stderr.slice(-500)}`)); }, 120_000);
    child.on("exit", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`claude exited ${code}: ${stderr.slice(-500)}`)); });
  });
}

interface Shape {
  bytes: number;
  tokens: { tools: number; system: number; messages: number; total: number };
  tools: { count: number; native: number; agents: number; catalog: number; nativeBytes: number; agentsBytes: number; catalogBytes: number };
}

function shape(request: MessagesRequest & { tools?: Array<{ name?: string }> }): Shape {
  const tools = request.tools ?? [];
  const split = { count: tools.length, native: 0, agents: 0, catalog: 0, nativeBytes: 0, agentsBytes: 0, catalogBytes: 0 };
  for (const tool of tools) {
    const bytes = JSON.stringify(tool).length;
    const kind = tool.name?.startsWith("mcp__agents__") ? "agents" : tool.name?.startsWith("mcp__catalog__") ? "catalog" : "native";
    split[kind] += 1;
    split[`${kind}Bytes`] += bytes;
  }
  const toolChars = JSON.stringify(tools).length;
  const systemChars = systemText(request).length;
  const messageChars = JSON.stringify(request.messages ?? []).length;
  const tokens = { tools: estimateTokens(toolChars), system: estimateTokens(systemChars), messages: estimateTokens(messageChars) };
  return { bytes: JSON.stringify(request).length, tokens: { ...tokens, total: tokens.tools + tokens.system + tokens.messages }, tools: split };
}

const results: Record<string, { shape: Shape; stablePrefix: boolean }> = {};
for (const variant of VARIANTS) {
  const firsts: string[] = [];
  for (let run = 0; run < 2; run++) {
    // The same HOME path for both runs: the system prompt names the cwd and
    // the memory folder, so two conversations of one bot compare equal.
    const home = join(tmpdir(), `sagax-claude-prefix-${process.pid}-${variant.name}`);
    await removeTempDir(home);
    mkdirSync(home, { recursive: true });
    const recorder = await capture(join(home, "requests"));
    try {
      await runCli(home, recorder.port, variant);
      const first = recorder.bodies()[0];
      if (!first) throw new Error(`${variant.name}: no model request`);
      firsts.push(first);
      const keep = args("keep")[0];
      if (keep) { mkdirSync(keep, { recursive: true }); writeFileSync(join(keep, `${variant.name}-${run + 1}.json`), first); }
    } finally {
      recorder.server.close();
      await removeTempDir(home);
    }
  }
  const [a, b] = firsts.map((body) => JSON.parse(body) as MessagesRequest & { tools?: unknown[] });
  const stablePrefix = JSON.stringify(a!.tools) === JSON.stringify(b!.tools) && systemText(a!) === systemText(b!);
  results[variant.name] = { shape: shape(a!), stablePrefix };
  const s = results[variant.name]!.shape;
  console.log(`${variant.name}: ${s.bytes} B, ~${s.tokens.total} tokens (tools ~${s.tokens.tools} in ${s.tools.count}: native ${s.tools.native}/${s.tools.nativeBytes} B, agents ${s.tools.agents}/${s.tools.agentsBytes} B, catalog ${s.tools.catalog}/${s.tools.catalogBytes} B; system ~${s.tokens.system}; messages ~${s.tokens.messages}); stable prefix ${stablePrefix}`);
}
const out = args("json")[0];
if (out) writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
