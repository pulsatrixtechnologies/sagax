// Proves, with a REAL engine CLI driven through its Sagax ACP driver, that an
// organization-server turn (withholdHostTools) leaves the engine no shell,
// file, fetch or subagent tool of its own on the Sagax server.
//
// The model is a local fake (OpenAI chat completions and Gemini
// generateContent on 127.0.0.1) that records the tools the engine offers the
// model and then asks for a shell command and a file read on this machine.
// The turn runs in Full access with every permission card approved, the
// worst case. ACP's initialize and session/new answers carry no tool list
// (capabilities and slash commands only), so the proof is what each engine
// offers its model, in every request (background agents included):
//   1. no host tool is offered; the Sagax MCP fixture still answers a call;
//   2. the shell request did not run (its marker file was never created),
//      also when asked through an MCP call tool (tool_call);
//   3. the file request did not read (its canary never reached the model);
//   4. an MCP server or a hook a workspace file declares does not start.
// A control turn without withholdHostTools must show the host tools, so a
// pass is not an empty fixture.
//
//   node --experimental-strip-types scripts/verify-org-host-tools.ts <engine> [cli]
//   engine: gemini | qwen | kimi | opencode | droid | hermes | grok
// Disposable HOME; nothing of the person running it is read or written.
// SAGAX_TOOL_INVENTORY_OUT=<file> also writes the native tools each turn
// offered (scripts/capture/engine-native-tools.ts reads it).
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const engine = process.argv[2] ?? "";
const cliArg = process.argv[3];
const home = mkdtempSync(join(tmpdir(), `sagax-org-${engine}-`));
process.env.HOME = home; process.env.USERPROFILE = home; process.env.SAGAX_DATA_DIR = join(home, "data");
const { ensureDirs } = await import("../server/config.ts"); ensureDirs();
const { localHost } = await import("../server/drivers/local-inject.ts");
const { HOST_TOOL_NAMES_BY_ENGINE, ORG_ENGINE_TOOLS } = await import("../server/drivers/host-tools.ts");

type Spec = { driver: () => Promise<any>; cli: string; cliArgs?: string; model: string; env?: Record<string, string>; setup?: (home: string, baseUrl: string) => void; shell: string; read: string; argsFor: (tool: string, target: string) => Record<string, unknown> };
const shellArgs = (_tool: string, target: string) => ({ command: `touch '${target}'`, cmd: `touch '${target}'`, description: "fixture" });
const readArgs = (_tool: string, target: string) => ({ path: target, file_path: target, absolute_path: target, filePath: target });
const SPECS: Record<string, Spec> = {
  gemini: { driver: async () => (await import("../server/drivers/acp/gemini.ts")).GeminiAgentDriver, cli: "gemini", model: "gemini-2.5-flash", shell: "run_shell_command", read: "read_file", argsFor: (tool, target) => tool === "run_shell_command" ? shellArgs(tool, target) : readArgs(tool, target) },
  qwen: { driver: async () => (await import("../server/drivers/acp/qwen.ts")).QwenAgentDriver, cli: "qwen", model: "omlx::fixture",
    setup: (home) => { mkdirSync(join(home, ".qwen"), { recursive: true }); writeFileSync(join(home, ".qwen/settings.json"), JSON.stringify({ security: { auth: { selectedType: "openai" } } })); }, shell: "run_shell_command", read: "read_file", argsFor: (tool, target) => tool === "run_shell_command" ? shellArgs(tool, target) : readArgs(tool, target) },
  kimi: { driver: async () => (await import("../server/drivers/acp/kimi.ts")).KimiAgentDriver, cli: "kimi", model: "omlx::fixture", shell: "Bash", read: "Read", argsFor: (tool, target) => tool === "Bash" ? shellArgs(tool, target) : readArgs(tool, target) },
  opencode: { driver: async () => (await import("../server/drivers/acp/opencode-go.ts")).OpenCodeDriver, cli: "opencode", model: "omlx::fixture", shell: "bash", read: "read", argsFor: (tool, target) => tool === "bash" ? shellArgs(tool, target) : readArgs(tool, target) },
  droid: { driver: async () => (await import("../server/drivers/acp/droid.ts")).DroidAgentDriver, cli: "droid", model: "omlx::fixture", shell: "Execute", read: "Read", argsFor: (tool, target) => tool === "Execute" ? shellArgs(tool, target) : readArgs(tool, target) },
  hermes: { driver: async () => (await import("../server/drivers/acp/hermes.ts")).HermesAgentDriver, cli: "hermes", model: "omlx::fixture",
    setup: (home, baseUrl) => { mkdirSync(join(home, ".hermes"), { recursive: true }); writeFileSync(join(home, ".hermes/config.yaml"), `model:\n  default: fixture\n  provider: custom\n  base_url: "${baseUrl}"\n  api_key: fixture-not-a-key\n`); }, shell: "terminal", read: "read_file", argsFor: (tool, target) => tool === "terminal" ? shellArgs(tool, target) : readArgs(tool, target) },
  grok: { driver: async () => (await import("../server/drivers/acp/grok.ts")).GrokAgentDriver, cli: "grok", cliArgs: "--no-auto-update", model: "omlx::fixture", env: { GROK_HOME: join(home, ".grok") },
    setup: (home) => { mkdirSync(join(home, ".grok"), { recursive: true }); writeFileSync(join(home, ".grok/config.toml"), "[cli]\nauto_update=false\n"); }, shell: "run_terminal_command", read: "read_file", argsFor: (tool, target) => tool === "run_terminal_command" ? shellArgs(tool, target) : readArgs(tool, target) },
};
const spec = SPECS[engine];
if (!spec) { console.error(`usage: verify-org-host-tools.ts <${Object.keys(SPECS).join("|")}> [cli]`); process.exit(2); }
const hostTools: readonly string[] = HOST_TOOL_NAMES_BY_ENGINE[engine] ?? ORG_ENGINE_TOOLS[engine]?.deny ?? [];
const orgAllow = ORG_ENGINE_TOOLS[engine]?.allow;
const cli = `${cliArg ? resolve(cliArg) : spec.cli}${spec.cliArgs ? ` ${spec.cliArgs}` : ""}`;

// ---- fake model ---------------------------------------------------------
const CANARY = `sagax-canary-${Math.random().toString(36).slice(2)}`;
const secret = join(home, "server-secret.txt"); writeFileSync(secret, CANARY);
let marker = "";
type Capture = { names: string[]; bodies: string[]; all: string[] };
let capture: Capture = { names: [], bodies: [], all: [] };
let round = 0;
// A background request (a title, a memory extractor) is recorded, its tools
// checked like any other, but it is not given the fixture's tool calls.
function auxiliary(payload: any, gemini: boolean): boolean {
  const system = gemini
    ? JSON.stringify(payload.systemInstruction ?? payload.system_instruction ?? "")
    : JSON.stringify((payload.messages ?? []).find((message: any) => message.role === "system")?.content ?? payload.system ?? "");
  return /memory extraction|session_title|generate a (?:short |concise )?title|title for (?:this|the) conversation|summari[sz]e the conversation/i.test(system.slice(0, 600));
}
let schemas = new Map<string, Record<string, unknown>>();
/** Keep only the argument names the tool's own schema declares. */
function fit(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  const properties = schemas.get(tool);
  if (!properties) return args;
  const kept = Object.fromEntries(Object.entries(args).filter(([key]) => key in properties));
  return Object.keys(kept).length ? kept : args;
}
function plan(names: string[], body: string): Array<{ name: string; args: Record<string, unknown> }> | null {
  const step = round++;
  if (step === 0) {
    // Ask for the shell and the file whatever the engine offered: an absent
    // tool must not run either. Through an MCP call tool too, where the
    // engine has one (it must not reach a withheld built-in).
    const calls = [{ name: spec.shell, args: fit(spec.shell, spec.argsFor(spec.shell, marker)) }, { name: spec.read, args: fit(spec.read, spec.argsFor(spec.read, secret)) }];
    if (names.includes("tool_search")) calls.push({ name: "tool_search", args: { query: "read_notes" } });
    if (names.includes("tool_call")) {
      calls.push({ name: "tool_call", args: { name: spec.shell, arguments: spec.argsFor(spec.shell, marker) } });
      calls.push({ name: "tool_call", args: { name: spec.read, arguments: spec.argsFor(spec.read, secret) } });
    }
    return calls;
  }
  if (step === 1) {
    // Then the Sagax MCP fixture: directly, or through the engine's MCP call.
    const direct = names.find((name) => /read_notes/.test(name));
    if (direct) return [{ name: direct, args: {} }];
    const found = body.match(/[\w.-]*read_notes/g)?.sort((a, b) => b.length - a.length)[0];
    if (found && names.includes("tool_call")) return [{ name: "tool_call", args: { name: found, arguments: {} } }];
    if (names.includes("use_tool")) return [{ name: "use_tool", args: { tool_name: found ?? "notes__read_notes", tool_input: {} } }];
  }
  return null;
}
const provider = createServer(async (req, res) => {
  let body = ""; for await (const chunk of req) body += chunk;
  const url = req.url ?? "";
  if (req.method === "GET" && /\/models\/?$/.test(url)) { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: [{ id: "fixture", object: "model", owned_by: "fixture" }] })); return; }
  if (url.includes(":countTokens")) { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ totalTokens: 1 })); return; }
  const gemini = /:(?:stream)?[gG]enerateContent/.test(url);
  const chat = url.endsWith("/chat/completions");
  if (!gemini && !chat) { res.writeHead(404).end(); return; }
  const payload = JSON.parse(body || "{}");
  const names: string[] = gemini
    ? (payload.tools ?? []).flatMap((group: any) => (group.functionDeclarations ?? group.function_declarations ?? []).map((fn: any) => fn.name))
    : (payload.tools ?? []).map((tool: any) => tool.function?.name ?? tool.name);
  const isAux = auxiliary(payload, gemini);
  const declared: any[] = gemini
    ? (payload.tools ?? []).flatMap((group: any) => group.functionDeclarations ?? group.function_declarations ?? [])
    : (payload.tools ?? []).map((tool: any) => tool.function ?? tool);
  if (!isAux) schemas = new Map(declared.map((fn: any) => [fn.name, (fn.parameters ?? fn.parametersJsonSchema ?? fn.input_schema ?? {}).properties ?? {}]));
  if (process.env.SAGAX_VERIFY_DUMP) writeFileSync(`${process.env.SAGAX_VERIFY_DUMP}.${Date.now()}.json`, body);
  capture.bodies.push(body);
  for (const name of names) if (!capture.all.includes(name)) capture.all.push(name);
  if (!isAux && names.length && capture.names.length === 0) capture.names = names;
  const calls = isAux || names.length === 0 ? null : plan(names, body);
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  if (gemini) {
    const parts = calls ? calls.map((call) => ({ functionCall: { name: call.name, args: call.args } })) : [{ text: "Fixture finished." }];
    const chunk = { candidates: [{ index: 0, content: { role: "model", parts }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }, modelVersion: "fixture" };
    if (url.includes("stream")) { res.writeHead(200, { "content-type": "text/event-stream" }).end(`data: ${JSON.stringify(chunk)}\r\n\r\n`); return; }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(chunk)); return;
  }
  const message = calls
    ? { role: "assistant", content: null, tool_calls: calls.map((call, index) => ({ index, id: `fixture-${round}-${index}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } })) }
    : { role: "assistant", content: "Fixture finished." };
  const base = { id: "fixture", created: 0, model: "fixture", usage };
  if (!payload.stream) { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message, finish_reason: calls ? "tool_calls" : "stop" }] })); return; }
  const frame = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  res.writeHead(200, { "content-type": "text/event-stream" }).end(frame(message, null) + frame({}, calls ? "tool_calls" : "stop") + "data: [DONE]\n\n");
});
await new Promise<void>((done) => provider.listen(0, "127.0.0.1", done));
const port = (provider.address() as { port: number }).port;
localHost("omlx")!.baseUrl = `http://127.0.0.1:${port}/v1`;

// ---- Sagax-injected MCP fixture (stands in for agents / Perspicax) ---------
const mcp = join(home, "notes-mcp.mjs");
const receipt = join(home, "mcp-receipt.txt");
writeFileSync(mcp, `import {createInterface} from "node:readline";import {appendFileSync} from "node:fs";
createInterface({input:process.stdin}).on("line",line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result={};
if(m.method==="initialize")result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:"notes",version:"1"}};
if(m.method==="tools/list")result={tools:[{name:"read_notes",description:"Read the fixture notes",inputSchema:{type:"object",properties:{},additionalProperties:false}}]};
if(m.method==="tools/call"){appendFileSync(process.env.RECEIPT,"read_notes\\n");result={content:[{type:"text",text:"notes"}]};}
process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result})+"\\n");});`);

const environment: Record<string, string> = {
  HOME: home, USERPROFILE: home, PATH: process.env.PATH ?? "",
  ...(engine === "gemini" ? { GEMINI_API_KEY: "fixture-not-a-key", GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${port}`, GEMINI_CLI_HOME: join(home, "gemini-home") } : {}),
  ...spec.env,
};
spec.setup?.(home, `http://127.0.0.1:${port}/v1`);
// A workspace file in the turn's folder declaring an MCP server of its own:
// on an organization turn it must not start (it would run on the server).
const workspaceSpawn = join(home, "workspace-mcp-started.txt");
const workspaceServer = { command: process.execPath, args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(workspaceSpawn)}, "started")`] };
// And hooks: a hook is a command run on the server.
const hookRan = join(home, "workspace-hook-ran.txt");
const hook = [{ matcher: "*", hooks: [{ type: "command", command: `touch '${hookRan}'` }] }];
const hooks = Object.fromEntries(["SessionStart", "BeforeAgent", "UserPromptSubmit", "BeforeTool", "PreToolUse"].map((event) => [event, hook]));
for (const dir of [".gemini", ".qwen"]) {
  mkdirSync(join(home, "work", dir), { recursive: true });
  writeFileSync(join(home, "work", dir, "settings.json"), JSON.stringify({ mcpServers: { workspace: workspaceServer }, hooks }));
}
const Driver = await spec.driver();
const instance = await Driver.create({ instanceId: `org-${engine}`, displayName: `${engine} org fixture`, enabled: true, config: { cli, fullAuto: true }, environment });
const events: any[] = [];
instance.adapter.onEvent((event: any) => {
  events.push(event);
  if (event.type === "request.opened") void instance.adapter.respondToRequest(event.threadId, event.requestId, { behavior: "allow" });
});

async function run(label: string, withhold: boolean) {
  round = 0; capture = { names: [], bodies: [], all: [] }; rmSync(receipt, { force: true });
  marker = join(home, `ran-${label}.txt`); rmSync(workspaceSpawn, { force: true }); rmSync(hookRan, { force: true });
  const start = events.length;
  const { turnId } = await instance.adapter.sendTurn({
    threadId: `org-${label}`, cwd: join(home, "work"), model: spec.model, approvalMode: "full",
    text: "Run the shell command and read the file you are asked to.",
    ...(withhold ? { withholdHostTools: true } : {}),
    integrations: { custom: { notes: { command: process.execPath, args: [mcp], env: { RECEIPT: receipt } } } },
  });
  const deadline = Date.now() + 120_000;
  while (!events.slice(start).some((event) => event.type === "turn.completed" && event.turnId === turnId) && Date.now() < deadline) await delay(100);
  const mine = events.slice(start).filter((event) => event.turnId === turnId || event.type === "runtime.error");
  return {
    label, withhold, names: capture.names, allNames: capture.all, mcpCalled: existsSync(receipt), completed: mine.find((event) => event.type === "turn.completed"),
    errors: mine.filter((event) => event.type === "runtime.error").map((event) => event.message),
    shellRan: existsSync(marker), workspaceMcpStarted: existsSync(workspaceSpawn), workspaceHookRan: existsSync(hookRan), canaryReachedModel: capture.bodies.some((body) => body.includes(CANARY)),
    tools: mine.filter((event) => event.type === "item.started" || event.type === "item.completed").map((event) => `${event.type}:${event.item?.kind ?? ""}:${event.item?.title ?? event.item?.name ?? ""}`).slice(0, 12),
  };
}

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`); if (!ok) failed++; };
try {
  const control = await run("control", false);
  console.log(JSON.stringify({ control }, null, 1));
  const org = await run("org", true);
  console.log(JSON.stringify({ org }, null, 1));
  const leakedControl = hostTools.filter((tool) => control.names.includes(tool));
  check("control turn (solo): the engine offers host tools, so the fixture sees them", leakedControl.length > 0, leakedControl.slice(0, 6).join(","));
  check("organization turn: the model was reached", org.names.length > 0 || capture.bodies.length > 0, `${org.names.length} tools`);
  const leaked = org.allNames.filter((name) => hostTools.includes(name));
  check("organization turn: no host shell, file, fetch or subagent tool offered in any model request (background agents included)", leaked.length === 0, leaked.join(",") || org.allNames.join(","));
  check("organization turn: the Sagax MCP tool still works (the fixture server was called)", org.mcpCalled, org.allNames.join(","));
  check("organization turn: the shell request did not run on the server", !org.shellRan);
  check("organization turn: the file request did not read the server file", !org.canaryReachedModel);
  check("organization turn: an MCP server declared by a workspace file did not start", !org.workspaceMcpStarted);
  check("organization turn: a hook declared by a workspace file did not run", !org.workspaceHookRan);
  check("organization turn: completed", org.completed !== undefined, JSON.stringify(org.errors));
  // The fixture's MCP tool is named after its read_notes tool, whatever the
  // engine's prefix; everything else offered is a native tool.
  const native = (names: string[]) => names.filter((name) => !/read_notes/.test(name));
  if (orgAllow) {
    const offTheList = native(org.allNames).filter((name) => !orgAllow.includes(name));
    check("organization turn: every native tool offered is on the engine's allowlist (ORG_ENGINE_TOOLS)", offTheList.length === 0, offTheList.join(","));
  }
  if (process.env.SAGAX_TOOL_INVENTORY_OUT) {
    writeFileSync(process.env.SAGAX_TOOL_INVENTORY_OUT, JSON.stringify({ engine, solo: native(control.allNames), org: native(org.allNames), mcpCalled: org.mcpCalled, failed }));
  }
} finally {
  await instance.dispose();
  provider.closeAllConnections(); await new Promise<void>((done) => provider.close(() => done()));
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
