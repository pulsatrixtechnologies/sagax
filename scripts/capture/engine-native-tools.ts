// Records the native tools a pinned engine CLI exposes, solo and on an
// organization server (withheld), into server/drivers/engine-native-tools.json.
// server/drivers/engine-tools.test.ts then checks every one of them is on the
// engine's allowlist or deny list (ORG_ENGINE_TOOLS in host-tools.ts).
//
//   node --experimental-strip-types scripts/capture/engine-native-tools.ts <engine> [cli]
//   engine: claude | codex | pi | gemini | qwen | kimi | opencode | hermes | grok
//
// Run it after bumping an engine in engines.lock.json, with that version's
// CLI: it refuses a CLI whose version is not the pinned one. No model call
// leaves the machine (a closed port or a local fake model) and every run uses
// a disposable HOME.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { codexToolSurfaceArgs } from "../../server/drivers/codex-tool-surface.ts";
import { claudeDisallowedTools, claudeOrgTools, codexHostToolArgs } from "../../server/drivers/host-tools.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const inventoryPath = join(root, "server/drivers/engine-native-tools.json");
const ACP_ENGINES = ["gemini", "qwen", "kimi", "opencode", "hermes", "grok"];
const ENGINES = ["claude", "codex", "pi", ...ACP_ENGINES];

const engine = process.argv[2] ?? "";
if (!ENGINES.includes(engine)) { console.error(`usage: capture-engine-native-tools.ts <${ENGINES.join("|")}> [cli]`); process.exit(2); }
const lock = JSON.parse(readFileSync(join(root, "engines.lock.json"), "utf8")) as { engines: Array<{ id: string; bin: string; version: string }> };
const pinned = lock.engines.find((entry) => entry.id === engine);
if (!pinned) { console.error(`${engine} is not in engines.lock.json`); process.exit(2); }
const cli = process.argv[3] ? resolve(process.argv[3]) : pinned.bin;
const versionLine = execFileSync(cli, ["--version"], { encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" } });
const version = versionLine.match(/\d+\.\d+\.\d+/)?.[0];
if (version !== pinned.version) {
  console.error(`${cli} is ${version ?? "an unknown version"}; engines.lock.json pins ${engine} at ${pinned.version}. Capture with the pinned CLI.`);
  process.exit(1);
}

const sorted = (names: Iterable<string>) => [...new Set(names)].sort();
const isMcp = (name: string) => name.startsWith("mcp__") || /read_notes|fixture_tool/.test(name);

/** A one-tool stdio MCP server, the stand-in for Sagax's own. */
function mcpFixture(dir: string): string {
  const path = join(dir, "fixture-mcp.mjs");
  writeFileSync(path, `import {createInterface} from "node:readline";
createInterface({input:process.stdin}).on("line",line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result={};
if(m.method==="initialize")result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:"fixture",version:"1"}};
if(m.method==="tools/list")result={tools:["fixture_tool","approve"].map(name=>({name,description:name,inputSchema:{type:"object",properties:{}}}))};
process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result})+"\\n");});`);
  return path;
}

/** Claude Code: the tools its `init` event lists (what the model is offered,
 * subagents included, checked on 2.1.288 against the model requests). */
async function claudeInit(dir: string, extra: string[]): Promise<string[]> {
  const mcpConfig = join(dir, "mcp.json");
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { agents: { type: "stdio", command: process.execPath, args: [mcpFixture(dir)] } } }));
  const args = ["-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose", "--strict-mcp-config",
    "--mcp-config", mcpConfig, "--permission-prompt-tool", "mcp__agents__approve", "--setting-sources", "project", ...extra];
  const home = mkdtempSync(join(dir, "home-"));
  const child = spawn(cli, args, {
    cwd: home,
    // tool search on, as on the first-party API; the model address is a closed port
    env: { PATH: process.env.PATH ?? "", HOME: home, CLAUDE_CONFIG_DIR: join(home, "cfg"), ANTHROPIC_BASE_URL: "http://127.0.0.1:9", ANTHROPIC_API_KEY: "sk-ant-capture-not-a-key", ENABLE_TOOL_SEARCH: "true", CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  child.stdin.end(`${JSON.stringify({ type: "user", message: { role: "user", content: "capture" } })}\n`);
  try {
    return await new Promise<string[]>((done, fail) => {
      let buffer = "";
      const timer = setTimeout(() => fail(new Error("no init event within 60 s")), 60_000);
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        for (const line of buffer.split("\n")) {
          try {
            const event = JSON.parse(line) as { type?: string; subtype?: string; tools?: string[] };
            if (event.type === "system" && event.subtype === "init") { clearTimeout(timer); done(event.tools ?? []); }
          } catch { /* partial line */ }
        }
      });
      child.on("exit", () => fail(new Error("the CLI exited before its init event")));
    });
  } finally { child.kill("SIGKILL"); }
}

async function captureClaude(dir: string) {
  const solo = await claudeInit(dir, []);
  const orgTools = claudeOrgTools(undefined, true)!;
  const org = await claudeInit(dir, ["--tools", orgTools, "--disallowedTools", claudeDisallowedTools(undefined, true, true).join(",")]);
  return { how: "init event of `claude -p` with an MCP server and the permission prompt tool, tool search on; org: the driver's --tools and --disallowedTools", solo, org };
}

/** Codex: the tools of its first Responses request to a local fake model. */
async function codexTools(dir: string, extra: string[]): Promise<string[]> {
  let names: string[] | null = null;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (!req.url?.includes("/responses")) { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ models: [] })); return; }
      try {
        const payload = JSON.parse(body) as { tools?: Array<{ name?: string; type?: string }> };
        names ??= (payload.tools ?? []).map((tool) => tool.name ?? tool.type ?? "");
      } catch { /* not a request */ }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const event = (data: Record<string, unknown>) => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
      event({ type: "response.created", response: { id: "capture" } });
      event({ type: "response.output_item.done", item: { type: "message", role: "assistant", id: "capture", content: [{ type: "output_text", text: "done" }] } });
      event({ type: "response.completed", response: { id: "capture", usage: { input_tokens: 1, input_tokens_details: null, output_tokens: 1, output_tokens_details: null, total_tokens: 2 } } });
      res.end();
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  const home = mkdtempSync(join(dir, "home-"));
  const child = spawn(cli, ["exec", "--skip-git-repo-check",
    "-c", "model_provider=capture", "-c", `model_providers.capture={name="capture",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",env_key="CAPTURE_KEY"}`,
    "-c", "model=gpt-5.5", "-c", `mcp_servers.agents={command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(mcpFixture(dir))}]}`,
    ...codexToolSurfaceArgs(), ...extra, "capture"], {
    cwd: home, env: { PATH: process.env.PATH ?? "", HOME: home, CODEX_HOME: home, CAPTURE_KEY: "capture-not-a-key" }, stdio: ["ignore", "ignore", "ignore"],
  });
  try {
    const deadline = Date.now() + 60_000;
    while (names === null && Date.now() < deadline) await new Promise((done) => setTimeout(done, 100));
    if (names === null) throw new Error("Codex sent no model request within 60 s");
    return names;
  } finally { child.kill("SIGKILL"); server.closeAllConnections(); server.close(); }
}

async function captureCodex(dir: string) {
  return { how: "first request of `codex exec` to a local fake Responses model with an MCP server; org: + codexHostToolArgs", solo: await codexTools(dir, []), org: await codexTools(dir, codexHostToolArgs(true)) };
}

/** pi: its built-ins are the keys of createAllTools; an organization turn
 * passes --no-builtin-tools, which empties the active set. */
async function capturePi() {
  let dir = dirname(realpathSync(cli));
  while (!existsSync(join(dir, "dist/core/tools/index.js")) && dirname(dir) !== dir) dir = dirname(dir);
  const tools = await import(pathToFileURL(join(dir, "dist/core/tools/index.js")).href) as { createAllTools(cwd: string): Record<string, unknown> };
  return { how: "keys of createAllTools in the package; org: --no-builtin-tools", solo: Object.keys(tools.createAllTools(tmpdir())), org: [] as string[] };
}

/** ACP engines: what each offered a local fake model in a control and a
 * withheld turn of its Sagax driver (scripts/verify/dev/verify-org-host-tools.ts). */
function captureAcp(dir: string) {
  const out = join(dir, "inventory.json");
  const run = spawn(process.execPath, ["--experimental-strip-types", join(root, "scripts/verify/dev/verify-org-host-tools.ts"), engine, cli], {
    cwd: root, env: { ...process.env, SAGAX_TOOL_INVENTORY_OUT: out }, stdio: ["ignore", "inherit", "inherit"],
  });
  return new Promise<{ how: string; solo: string[]; org: string[] }>((done, fail) => {
    run.on("exit", () => {
      if (!existsSync(out)) { fail(new Error("scripts/verify/dev/verify-org-host-tools.ts wrote no inventory")); return; }
      const inventory = JSON.parse(readFileSync(out, "utf8")) as { solo: string[]; org: string[] };
      done({ how: "tools offered to a local fake model by a control and a withheld turn of the Sagax driver (scripts/verify/dev/verify-org-host-tools.ts)", ...inventory });
    });
  });
}

const dir = mkdtempSync(join(tmpdir(), `sagax-capture-${engine}-`));
try {
  const captured = engine === "claude" ? await captureClaude(dir)
    : engine === "codex" ? await captureCodex(dir)
    : engine === "pi" ? await capturePi()
    : await captureAcp(dir);
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as { engines: Record<string, unknown> };
  inventory.engines[engine] = {
    version, captured: new Date().toISOString().slice(0, 10), how: captured.how,
    solo: sorted(captured.solo.filter((name) => !isMcp(name))), org: sorted(captured.org.filter((name) => !isMcp(name))),
  };
  inventory.engines = Object.fromEntries(Object.entries(inventory.engines).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(JSON.stringify(inventory.engines[engine], null, 2));
  console.log(`\nWrote ${engine} ${version} to server/drivers/engine-native-tools.json. Now run: pnpm exec vitest run server/drivers/engine-tools.test.ts`);
} finally {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
