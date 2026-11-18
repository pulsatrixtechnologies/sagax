// node scripts/local-prompt/audit-turn.mjs claude|grok /absolute/path/to/cli -o summary.json
// A fresh solo bot, explicit model and effort, real CLI, loopback provider.
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { freePortBlock } from "../../server/testing/ports.ts";
import { stopGracefully, removeTempDir } from "../../server/testing/cleanup.ts";
import { estimateTokens } from "./shape.ts";

const [engine, cli, flag, output] = process.argv.slice(2);
if (
  !["grok", "claude"].includes(engine) ||
  !cli?.startsWith("/") ||
  flag !== "-o" ||
  !output
)
  throw new Error("Expected claude|grok /absolute/path/to/cli -o summary.json");
const home = mkdtempSync(join(tmpdir(), "turn-audit-"));
const data = join(home, "data");
const model = engine === "claude" ? "claude-opus-5-5" : "grok-4.7";
const question = "List my routines and explain their schedules.";
let summary;
let sections = [];
// Use synthetic homes and credentials. Keep only sizes, identifiers and generation settings.
const paths = new Set();
// An offline tool failure lets the CLI demonstrate whether it sends another
// generation request. Neither operation can perform a write.
function sendUnknownTool(res) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  if (engine === "claude") {
    const event = (type, data) =>
      res.write(
        "event: " +
          type +
          "\ndata: " +
          JSON.stringify({ type, ...data }) +
          "\n\n",
      );
    event("message_start", {
      message: {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    });
    event("content_block_start", {
      index: 0,
      content_block: {
        type: "tool_use",
        id: "call_fixture",
        name: "not_a_served_tool",
        input: {},
      },
    });
    event("content_block_stop", { index: 0 });
    event("message_delta", {
      delta: { stop_reason: "tool_use" },
      usage: { output_tokens: 1 },
    });
    event("message_stop", {});
  } else {
    const chunk = (delta, finish_reason) =>
      res.write(
        "data: " +
          JSON.stringify({
            id: "chatcmpl_fixture",
            object: "chat.completion.chunk",
            created: 1,
            model,
            choices: [{ index: 0, delta, finish_reason }],
          }) +
          "\n\n",
      );
    chunk(
      {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "call_fixture",
            type: "function",
            function: {
              name: "use_tool",
              arguments: JSON.stringify({
                tool_name: "sagax_environment_read_file",
                tool_input: {},
              }),
            },
          },
        ],
      },
      null,
    );
    chunk({}, "tool_calls");
    res.write("data: [DONE]\n\n");
  }
  res.end();
}

const recorder = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  paths.add(path);
  let body = "";
  for await (const chunk of req) body += chunk;
  let call;
  try {
    call = JSON.parse(body);
  } catch {
    /* discovery */
  }
  const messages = call?.messages ?? call?.input;
  if (
    summary &&
    Array.isArray(messages) &&
    messages.some(
      (m) =>
        (m.role === "tool" && m.tool_call_id === "call_fixture") ||
        (Array.isArray(m.content) &&
          m.content.some(
            (b) =>
              b.type === "tool_result" &&
              b.tool_use_id === "call_fixture" &&
              b.is_error,
          )),
    )
  ) {
    summary.sawToolResultOnNextGeneration = true;
  }
  if (
    !summary &&
    Array.isArray(messages) &&
    JSON.stringify(messages).includes(question) &&
    !path.endsWith("/count_tokens")
  ) {
    const tools = call.tools ?? [];
    const names = tools.map((t) => t.name ?? t.function?.name);
    const system = [
      call.system,
      call.instructions,
      ...messages
        .filter((m) => ["system", "developer"].includes(m.role))
        .map((m) => m.content),
    ].filter(Boolean);
    const size = (value) => estimateTokens(JSON.stringify(value).length);
    const suffixes = names
      .filter((n) => n?.includes("__"))
      .map((n) => n.split("__").at(-1));
    const content = [system, messages].flat(Infinity);
    const strings = [];
    function collect(value) {
      if (typeof value === "string") strings.push(value);
      else if (value && typeof value === "object")
        Object.values(value).forEach(collect);
    }
    collect(content);
    const matchedSections = sections
      .filter(
        (s) => s.text.trim() && strings.some((v) => v.includes(s.text.trim())),
      )
      .map((s) => ({ id: s.id, tokens: estimateTokens(s.text.length) }))
      .sort((a, b) => b.tokens - a.tokens);
    const effortHeaders = Object.fromEntries(
      Object.entries(req.headers).filter(
        ([key, value]) =>
          /effort|reasoning/.test(key) &&
          ["low", "medium", "high", "xhigh", "minimal", "max"].includes(value),
      ),
    );
    summary = {
      sawToolResultOnNextGeneration: false,
      engine,
      matchedSections,
      effortHeaders,
      requestFields: Object.keys(call),
      model: call.model,
      effort:
        call.output_config?.effort ??
        call.reasoning_effort ??
        call.reasoning?.effort ??
        null,
      thinking: call.thinking ?? null,
      maxOutputTokens:
        call.max_tokens ??
        call.max_output_tokens ??
        call.max_completion_tokens ??
        null,
      systemTokensEstimate: size(system),
      messagesTokensEstimate: size(messages),
      toolsTokensEstimate: size(tools),
      toolCount: names.length,
      namespaced: suffixes.length,
      duplicateNames: names.length - new Set(names).size,
      repeatedMcpSuffixes: [
        ...new Set(suffixes.filter((s, i) => suffixes.indexOf(s) !== i)),
      ],
      toolNames: names,
    };
    sendUnknownTool(res);
    return;
  }
  res.setHeader("content-type", "application/json");
  if (path.endsWith("/models"))
    res.end(JSON.stringify({ data: [{ id: model }] }));
  else if (path.endsWith("/count_tokens")) res.end('{"input_tokens":1}');
  else {
    res.statusCode = 400;
    res.end('{"error":{"message":"End of offline capture"}}');
  }
});
let child;
try {
  await new Promise((r) => recorder.listen(0, "127.0.0.1", r));
  const endpoint = "http://127.0.0.1:" + recorder.address().port;
  const wrapper = join(home, "engine");
  // Log only the selected model and effort. The files of the turn can contain credentials.
  writeFileSync(
    wrapper,
    `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const val = key => args.includes(key) ? args[args.indexOf(key)+1] : null;
if (args.includes("stdio") || args.includes("-p")) fs.writeFileSync(${JSON.stringify(join(home, "selection"))}, JSON.stringify({model:val("-m") ?? val("--model"),effort:val("--reasoning-effort") ?? val("--effort")}));
if (${JSON.stringify(engine)} === "grok" && args.includes("stdio")) args.splice(args.indexOf("stdio"),0,"--cli-chat-proxy-base-url",${JSON.stringify(endpoint)},"--xai-api-base-url",${JSON.stringify(endpoint)});
const program = ${JSON.stringify(cli)};
process.execve(program, [program, ...args], {...process.env, ANTHROPIC_BASE_URL:${JSON.stringify(endpoint)}, ANTHROPIC_API_KEY:"fixture", XAI_API_KEY:"fixture", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:"1"});
`,
    { mode: 0o700 },
  );
  mkdirSync(data);
  writeFileSync(
    join(data, "config.json"),
    JSON.stringify({
      instances: {
        [engine]: { driver: engine + "Agent", config: { cli: wrapper } },
      },
    }),
  );
  const port = await freePortBlock([0, 1]);
  child = spawn(process.execPath, [resolve("server/index.ts")], {
    env: {
      HOME: home,
      USERPROFILE: home,
      PATH: process.env.PATH,
      SAGAX_DATA_DIR: data,
      SAGAX_CONTENT_ENCRYPTION: "off",
      SAGAX_PORT: String(port),
      SAGAX_WEBHOOK_PORT: String(port + 1),
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const base = "http://127.0.0.1:" + port;
  for (let i = 0; i < 1200; i++) {
    if (
      await fetch(base + "/api/health").then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    if (child.exitCode !== null) throw new Error("Fixture server exited");
    await delay(100);
  }
  async function api(method, path, body) {
    const r = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!r.ok) throw new Error(method + " " + path + " returned " + r.status);
    return r.json();
  }
  const { bot } = await api("POST", "/api/bots", { name: "Scout" });
  const route = "/api/bots/" + bot.id;
  await api("PATCH", route, {
    modelSelection: { instanceId: engine, model, effort: "xhigh" },
  });
  sections = (await api("GET", route + "/system-prompt")).sections;
  await api("POST", route + "/messages", { text: question });
  for (let i = 0; !summary?.sawToolResultOnNextGeneration && i < 600; i++)
    await delay(100);
  const selection = join(home, "selection");
  if (!summary)
    throw new Error(
      "No matching provider request. CLI selection: " +
        (existsSync(selection) ? readFileSync(selection, "utf8") : "none") +
        "; loopback paths: " +
        [...paths].join(", "),
    );
  writeFileSync(
    output,
    JSON.stringify(
      {
        ...summary,
        cliSelection: existsSync(selection)
          ? JSON.parse(readFileSync(selection, "utf8"))
          : null,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await stopGracefully(child);
  recorder.closeAllConnections();
  await new Promise((r) => recorder.close(r));
  await removeTempDir(home);
}
