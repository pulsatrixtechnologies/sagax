#!/usr/bin/env node
// Fake of an ACP (Agent Client Protocol) CLI's stdio surface, for driver
// tests of acp/core.ts + its harness shims (grok, gemini). Speaks JSON-RPC
// 2.0 over stdin/stdout: answers initialize / authenticate / session/new /
// session/prompt, and streams session/update notifications for a scripted
// turn. Failure modes mirror how real ACP agents misbehave:
//
//   FAKE_ACP_LOAD_NULL  return null for session/load so the resume cursor is
//                       ignored and the driver falls through to session/new
//   FAKE_ACP_REJECT_LIVE_LOAD_FILE  while this file exists, session/load and
//                       session/resume answer an error when the requested
//                       session is already live in THIS process — the
//                       real-agent shape that forces the driver's one-shot
//                       re-spawn fallback. A fresh process holds no live
//                       session, so its load succeeds.
//   FAKE_ACP_CACHED_LIVE_LOAD  acknowledge session/load of a live session but
//                       keep its original MCP credentials, matching Qwen.
//   FAKE_ACP_TEXT_REPLY  answer every session/prompt with only this text.
//   FAKE_ACP_MODE   happy (default) | image | empty-reply | reasoning-only | reasoning-only-error | exit-early | fail-after-text | hang | hang-initialize | stall-after-text | stall-first-prompt | unkeyed-tool | no-auth | auth-required | permission | question
//                   | ask-question-unsupported (send a cursor/ask_question server→client
//                     request mid-prompt; the driver must answer -32601 method
//                     not found, and the prompt completes only after that
//                     rejection arrives)
//                   | interleave (message → tool → message → tool → message)
//                   | no-session-config (reject session/set_mode + set_model
//                     with -32601, i.e. an agent predating those methods)
//                   | ask-peer (spawn the injected "agents" MCP server from
//                     session/new's mcpServers, call list_bots + ask_bot on a
//                     peer, and reply with what the peer said — the comms e2e)
//                   | delegate-peer (same as ask-peer but uses delegate_bot —
//                     returns immediately, the peer runs after our turn.
//                     With FAKE_ACP_REDELEGATE_FILE set, the first wake that
//                     saw the result delegates a second task, once, and
//                     writes that file)
//                   | chief-delegate (delegates only for an ASSIGN_TO_PEER
//                     prompt; ordinary follow-ups stay responsive)
//                   | create-peer (a Primary Bot creates a specialist, then delegates
//                     work to it through the returned id)
//                   | echo-gated (reply by echoing the full prompt, and when
//                     FAKE_ACP_GATE_FILE is set hold the turn open until that
//                     file exists — a deterministic busy window for the
//                     steer-queue e2e, with the echo pinning exactly what a
//                     drained turn was sent)
//                   | safe-agent-reads (simulate a native Auto reviewer around
//                     the real injected agents MCP; not a real classifier test)
//                   | stall-after-text (stream one message chunk, then go
//                     fully silent forever — a wedged agent mid-answer; the
//                     driver's prompt idle guard must fail the turn on its own)
//                   | slow-tool (start a tool call and send nothing while it
//                     "runs" for FAKE_ACP_TOOL_MS, default 600 — a quiet
//                     `sleep` or build — then finish it and answer)
//                   | stall-after-tool (finish a tool call, then go fully
//                     silent forever: the guard must still fire once no tool
//                     is running)
//                   | quiet-then-answer (send nothing for FAKE_ACP_QUIET_MS,
//                     default 600, then answer — a slow model or a rate-limit
//                     wait. With QWEN_HOME set, appends FAKE_ACP_QWEN_LOG
//                     (a JSON array of lines) to Qwen's debug log for this
//                     session, one line every FAKE_ACP_LOG_EVERY_MS (default
//                     100), repeating the last, as Qwen does while it retries)
//                   | voice (a spoken answer with a real CLI's timing,
//                     docs/voice-mode-xai.md "Latency": initialize answers
//                     FAKE_ACP_COLD_MS after process boot, session/new and
//                     session/load|resume each take FAKE_ACP_LOAD_MS (MCP
//                     servers reconnected, history read back), a prompt
//                     waits FAKE_ACP_FIRST_TOKEN_MS, then streams
//                     FAKE_ACP_VOICE_REPLY word by word FAKE_ACP_TOKEN_MS
//                     apart. session/cancel stops that answer and resolves
//                     the prompt cancelled, so a speculative reissue does
//                     not wait out the sentence. With FAKE_ACP_VOICE_TOOL=<tool>,
//                     each prompt first calls that tool on the injected
//                     agents MCP server and ends its reply with
//                     "mcp:<tool>:ok" or "mcp:<tool>:error")
//                   | mcp-tools (connect every server in session/new's mcpServers
//                     the way the agent's own client does, stdio or http,
//                     with grok 1.0.25's initialize (FAKE_ACP_MCP_HANDSHAKE JSON
//                     overrides it), list its tools, and reply one line per
//                     server: "<name>: <tool>,<tool>" or "<name> failed: <why>")
//                   | mcp-call (FAKE_ACP_MCP_CALLS="server:tool,server:tool"; FAKE_ACP_ASK_BEFORE_MCP=use_tool asks first like grok's use_tool:
//                     call each tool once, in order, on that stdio server from
//                     session/new's mcpServers, as the agent's own MCP client
//                     would with no permission check of its own (Grok's
//                     default mode), and reply one line per call:
//                     "server:tool -> <first text block>" or "-> error <why>")
//                   | lend-question (call list_shared_computers through the
//                     injected agents MCP, ask a question card, call it again
//                     once the card is answered, and reply
//                     "before: <first> | after: <second>" — the lent-Mac e2e)
//   FAKE_ACP_MCP_TRANSPORTS  comma list of remote MCP transports the agent
//                       advertises in initialize (mcpCapabilities), e.g. "http,sse"
//   FAKE_ACP_PERMISSION_OPTIONS JSON options override in permission mode
//   FAKE_ACP_DUMP   path to write {argv, env} as JSON, so a test can assert
//                   argv shape (agent/stdio flags) and env hygiene
//   FAKE_ACP_LAUNCH_COUNT_FILE  read-increment-write a process counter at
//                       startup, so a test can tell a reused pooled session
//                       (one launch) from a fresh child per turn (many)
//   FAKE_ACP_RPC_DUMP   rewrite, after every request, this process's full
//                       method list as a JSON array — per process, so a
//                       pooled child keeps one dump and a replacement child
//                       starts its own
//   FAKE_ACP_RPC_APPEND_FILE  append one {"pid","method","cwd"} JSON line per
//                       request, so a test can count RPCs across a pooled
//                       child and its replacement together
//   FAKE_ACP_RPC_FAILURE_FILE  read a JSON-RPC error object on session/prompt;
//                       once read this process stays poisoned even if the
//                       file is removed. A replacement process can recover.
//   FAKE_ACP_RPC_FAILURE_WHILE_FILE=1  not poisoned: fail only while the
//                       file exists (an engine's usage limit that resets).
//   FAKE_ACP_RPC_FAILURE_METHOD  initialize, session/new or session/prompt (default).
//   FAKE_ACP_RPC_FAILURE_GATE  hold the error until this file exists.
//   FAKE_ACP_RPC_FAILURE_AFTER_OUTPUT  emit text + a tool result before failing.
//   FAKE_ACP_RPC_FAILURE_AFTER_USAGE  emit scripted usage updates before failing.
//   FAKE_ACP_LOAD_ERROR  JSON-RPC error object returned by session/load.
//   FAKE_ACP_MODELS      comma-separated model ids. Enables the opencode-shaped
//                        surface: session/new and session/load return
//                        configOptions, and session/set_config_option switches
//                        the model (rejecting an unadvertised one with -32602).
//                        A new session starts on AGY_ACP_DEFAULT_MODEL (Google
//                        Antigravity's own default variable) when it is set,
//                        else on the first. Like agy_acp_server 1.1.1, any id
//                        there is taken unchecked and added to the list.
//   FAKE_ACP_MODELS_FILE  path of a file with the same comma-separated list,
//                        read once when the process starts: a process started
//                        before the file changed keeps the old list, the way
//                        `opencode acp` never re-reads a login added later
//   FAKE_ACP_MODELS_LIST=v2  OpenCode 2's `models` surface: plain `models`
//                        answers an empty list with exit 0 (its first answer
//                        after the background service starts), and `models
//                        --verbose` is rejected with exit 1
//   FAKE_ACP_VERBOSE_FAIL_ONCE  path of a marker file: the first `models
//                        --verbose` creates it and fails, the way a first run
//                        in a new OpenCode home loses the race to create its
//                        database; later runs answer normally
//   FAKE_ACP_MODEL_STICKS  session/set_config_option succeeds but leaves the
//                        model where it was, so the confirmation guard in
//                        core.ts has something to catch
//   FAKE_ACP_VARIANTS JSON map of model -> {id?, currentValue?, options} using
//                        ACP select values/groups; never contacts a provider.
//   FAKE_ACP_CONFIG_UPDATES JSON array of {after, sessionId?, configOptions,
//                        replay?}, emitted after the named RPC response.
//   FAKE_ACP_USAGE_ROOT  put the prompt result's usage at the root instead of
//                        under _meta (what opencode 1.18.18 actually does)
//   FAKE_ACP_USAGE_UPDATES_FILE  JSON array of numbers, re-read on every
//                        session/prompt; each is sent as a usage_update
//                        { used: n, size: 200000 } before the result
//   FAKE_ACP_ROUND_USAGE  send those numbers the way Grok does instead: as
//                        `_x.ai/session_notification` response_completed with
//                        usage { input_tokens: n - cached, cache_read_input_tokens }
//   FAKE_ACP_MODE_ACK_FILE  path of a file read on every mode switch: while it
//                        exists, "empty" answers without configOptions (the
//                        switch cannot be confirmed) and "error" refuses it,
//                        leaving the session in its previous mode either way
//   FAKE_ACP_SESSION_MODEL_STORE  path of a file holding each session's
//                        model, the way Grok 1.0.46 behaves with
//                        FAKE_ACP_SESSION_MODELS: session/new starts on the
//                        _meta.agentProfile.model when it is offered (else on
//                        the first, silently) and records it; session/load
//                        reports the recorded model, whatever the new profile
//                        or -m asks for
//   FAKE_ACP_GROK_CONFIG_MODELS=1  also offer every [model.<slug>] block of
//                        $GROK_HOME/config.toml (else $HOME/.grok), as Grok
//                        lists the blocks Sagax writes for local models
//   Grok launch campaigns: with FAKE_ACP_SESSION_MODEL_STORE, a campaign in
//                        <grok home>/settings_cache.json (payload.settings.
//                        campaigns[{id, models:{default}}]) whose id is not in
//                        campaigns_state.json dismissed_ids makes session/new
//                        run its default, whatever the profile asks (Grok
//                        1.0.46 and 1.0.50 signed in, fresh GROK_HOME)
//   SAGAX_GROK_MODEL_PROBE=1  set by Sagax's model-list probe (initialize
//                        only): this process is not counted or dumped
//
// With FAKE_ACP_DUMP and FAKE_ACP_MODES or FAKE_ACP_MODELS, every
// session/prompt appends {"pid","sessionId","mode","model"} to
// <FAKE_ACP_DUMP>.prompts.jsonl: what the prompt actually ran under, across a
// pooled child and its replacement. The .config.json log is per process, so
// on a pooled child it also holds earlier turns' switches.
//
// Keep this file dependency-free — it runs as a bare `node` subprocess.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";

const mode = process.env.FAKE_ACP_MODE ?? "happy";

// Follow the spawning server down, including on Windows where ppid does
// not change after parent exit. Inline: fakes must stay self-contained.
{
  const spawner = process.ppid;
  const orphanWatch = setInterval(() => {
    if (process.ppid !== spawner) process.exit(0);
    try { process.kill(spawner, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") process.exit(0);
    }
  }, 500);
  orphanWatch.unref();
}
const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
// opencode-shaped surface: the session carries its own model catalog and the
// model is chosen with session/set_config_option, because `opencode acp` takes
// no -m. Off unless FAKE_ACP_MODELS is set, so every existing mode is byte-
// identical to before.
const models = (process.env.FAKE_ACP_MODELS_FILE && existsSync(process.env.FAKE_ACP_MODELS_FILE)
  ? readFileSync(process.env.FAKE_ACP_MODELS_FILE, "utf8")
  : process.env.FAKE_ACP_MODELS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
const defaultModelEnv = process.env.AGY_ACP_DEFAULT_MODEL;
if (models.length && defaultModelEnv && !models.includes(defaultModelEnv)) models.push(defaultModelEnv);
let currentModel: string | null = models.length && defaultModelEnv ? defaultModelEnv : models[0] ?? null;
const variantConfigs: Record<string, { id?: string; currentValue?: string; options: any[] }> =
  JSON.parse(process.env.FAKE_ACP_VARIANTS ?? "{}");
let currentVariant = variantConfigs[currentModel ?? ""]?.currentValue;
const variantValues = (entries: any[]): string[] => entries.flatMap((entry) => (
  typeof entry?.value === "string" ? [entry.value] : Array.isArray(entry?.options) ? variantValues(entry.options) : []
));
const modes = (process.env.FAKE_ACP_MODES ?? "").split(",").filter(Boolean);
let currentMode: string | null = modes[0] ?? null;
// assignment id captured from the last hand-off reply, for a later
// assignment_status call. Each turn is a fresh process, so the id is passed
// through a file (same state-passing pattern as FAKE_ACP_GATE_FILE).
const taskIdFile = process.env.FAKE_ACP_TASKID_FILE ?? "";
/** The teammate id as list_bots prints it ("[id: …]"). */
const peerIdOf = (list: string): string => /id: ([\w-]+)/.exec(list)?.[1] ?? "";
/** The hand-off a scripted mode makes to one peer. */
function handoffCall(message: string, options: { consult?: boolean; reason?: string } = {}): { name: string; args: (list: string) => object } {
  const reason = options.reason ? { reason: options.reason } : {};
  return { name: "coordinate_bots", args: (list) => ({ bot_ids: [peerIdOf(list)], message, ...(options.consult ? { consult: true } : {}), ...reason }) };
}
/** The assignment id a hand-off reply names: coordinate_bots answers with
 * JSON receipts (requestId). */
const handoffIdOf = (reply: string): string => /"requestId":"([\w-]+)"/.exec(reply)?.[1] ?? "";
/** The status read for a remembered assignment id. */
const statusCall = (id: string): { name: string; args: () => object } => ({ name: "assignment_status", args: () => ({ id }) });
const logFile = process.env.FAKE_ACP_LOG_FILE ?? "";
const rejectLiveLoadFile = process.env.FAKE_ACP_REJECT_LIVE_LOAD_FILE ?? "";
function fakeLog(line: string): void {
  if (!logFile) return;
  try {
    appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}
let chiefDelegatedTaskId = "";
function rememberDelegatedTaskId(id: string): void {
  chiefDelegatedTaskId = id;
  if (taskIdFile) {
    try {
      writeFileSync(taskIdFile, id);
    } catch {}
  }
}
function savedDelegatedTaskId(): string {
  if (chiefDelegatedTaskId) return chiefDelegatedTaskId;
  if (taskIdFile && existsSync(taskIdFile)) {
    try {
      chiefDelegatedTaskId = readFileSync(taskIdFile, "utf8").trim();
    } catch {}
  }
  return chiefDelegatedTaskId;
}
const configOptions = () => {
  const variant = variantConfigs[currentModel ?? ""];
  const options = [
    ...(models.length ? [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: currentModel,
          options: models.map((value) => ({ value, name: value })),
        },
      ] : []),
    ...(variant ? [{
      id: variant.id ?? "effort",
      name: "Effort",
      category: "thought_level",
      type: "select",
      currentValue: currentVariant,
      options: variant.options,
    }] : []),
    ...(modes.length ? [{
      id: "mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: currentMode,
      options: modes.map((value) => ({ value, name: value })),
    }] : []),
  ];
  return options.length ? options : null;
};
// cursor-shaped surface: the session advertises `models.availableModels` with
// parameterised ids (`default[]`) that differ from the argv `--model` slugs
// (`auto`). Off unless FAKE_ACP_SESSION_MODELS is set, so every existing mode
// stays byte-identical. Format: "id|Name,id|Name" — the name is optional, and
// commas inside an id's `[...]` parameters do not split it.
const acpModels = (process.env.FAKE_ACP_SESSION_MODELS ?? "")
  .split(/,(?![^[]*\])/)
  .filter(Boolean)
  .map((entry) => {
    const [modelId, name] = entry.split("|");
    return name ? { modelId, name } : { modelId };
  });
const sessionModelStore = process.env.FAKE_ACP_SESSION_MODEL_STORE ?? "";
const storedSessionModels = (): Record<string, string> => {
  try { return JSON.parse(readFileSync(sessionModelStore, "utf8")); } catch { return {}; }
};
const fakeGrokHome = () => process.env.GROK_HOME || join(process.env.HOME ?? "", ".grok");
const readJson = (path: string): any => {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
};
/** acpModels, plus the config blocks when FAKE_ACP_GROK_CONFIG_MODELS is set
 * (read on every call: Sagax writes a block just before the turn). */
const offeredModels = (): Array<{ modelId: string; name?: string }> => {
  if (process.env.FAKE_ACP_GROK_CONFIG_MODELS !== "1") return acpModels;
  let text = "";
  try { text = readFileSync(join(fakeGrokHome(), "config.toml"), "utf8"); } catch {}
  const slugs = [...text.matchAll(/^\[model\.(?:"([^"]+)"|([^\]]+))\]\s*$/gm)].map((match) => match[1] ?? match[2]);
  return [...acpModels, ...slugs.filter((slug) => !acpModels.some((entry) => entry.modelId === slug)).map((modelId) => ({ modelId }))];
};
/** The model a not-dismissed launch campaign forces on session/new. */
const campaignModel = (): string | undefined => {
  const cache = readJson(join(fakeGrokHome(), "settings_cache.json"));
  let payload: any = cache?.payload;
  if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { payload = null; } }
  const dismissed: unknown[] = readJson(join(fakeGrokHome(), "campaigns_state.json"))?.dismissed_ids ?? [];
  const live = (payload?.settings?.campaigns ?? []).find((entry: any) => typeof entry?.models?.default === "string" && !dismissed.includes(entry.id));
  return live?.models?.default;
};
const sessionModels = (current?: string) => {
  const offered = offeredModels();
  return offered.length ? { currentModelId: current ?? offered[0].modelId, availableModels: offered } : null;
};
/** Grok-shaped model of a new session: the profile's model when offered. */
const newSessionModel = (params: any, sessionId: string): string | undefined => {
  const offered = offeredModels();
  if (!sessionModelStore || !offered.length) return undefined;
  const wanted = params?._meta?.agentProfile?.model;
  const campaign = campaignModel();
  const model = campaign && offered.some((entry) => entry.modelId === campaign) ? campaign
    : offered.some((entry) => entry.modelId === wanted) ? wanted : offered[0].modelId;
  writeFileSync(sessionModelStore, JSON.stringify({ ...storedSessionModels(), [sessionId]: model }));
  return model;
};
const loadedSessionModel = (sessionId: unknown): string | undefined =>
  sessionModelStore && typeof sessionId === "string" ? storedSessionModels()[sessionId] : undefined;

const argv = process.argv.slice(2);
const dumpEnv = Object.fromEntries(
  [
    "PATH",
    "HOME",
    "USERPROFILE",
    "TEMP",
    "TMP",
    "SystemRoot",
    "FAKE_ACP_MODE",
    "FAKE_ACP_RPC_DUMP",
    "FAKE_ACP_IMAGE_CAPABILITY",
    "FAKE_ACP_DUMP_PROMPT",
    "TEST_POLICY",
    "OPENCODE_API_KEY",
    "OPENCODE_PERMISSION",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "XAI_API_KEY",
    "GROK_AGENT",
    "GROK_HOME",
    "GROK_MANAGED_MCPS_ENABLED",
    "GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED",
    "BOX_TOKEN",
    "SAGAX_TTS_KEY",
    "SAGAX_FISH_AUDIO_API_KEY",
    "SAGAX_CLOUD_READY_TOKEN",
    "SAGAX_CLOUD_BOOTSTRAP",
    "SAGAX_LICENSE_KEY",
    "SAGAX_INSTALLATION_CREDENTIAL",
    "FACTORY_API_KEY",
    "UNSLOTH_STUDIO_AUTH_TOKEN",
    "CURSOR_API_KEY",
    "CLINE_API_KEY",
    "CLINE_PROVIDER",
    "CLINE_MODEL",
    "CLINE_MCP_SETTINGS_PATH",
    "CURSOR_AUTH_TOKEN",
    "KIMI_MODEL_NAME",
    "KIMI_MODEL_API_KEY",
    "KIMI_MODEL_BASE_URL",
    "KIMI_MODEL_PROVIDER_TYPE",
    "KIMI_MODEL_DISPLAY_NAME",
    "TEST_TURN_MODEL",
    "MY_AGENT_TOKEN",
    "VENICE_API_KEY",
    "GEMINI_HOME",
    "AGY_ACP_FORCE_FILE_STORAGE",
    "ANTIGRAVITY_HARNESS_PATH",
    "AGY_ACP_DEFAULT_MODEL",
    "OPENCODE_DISABLE_PROJECT_CONFIG",
    "OPENCODE_PERMISSION",
    "QWEN_CODE_SYSTEM_SETTINGS_PATH",
    "HERMES_HOME",
    "KIMI_CODE_HOME",
    "GEMINI_API_KEY",
    "MISTRAL_API_KEY",
    "SAGAX_ANTHROPIC_API_KEY",
  ].flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]] as const)),
);
// pid rides along so a test can tell a respawned process (new pid, fresh
// dump) from a pooled one whose dump was never rewritten
const dumpState: Record<string, unknown> = { argv, env: dumpEnv, pid: process.pid, cwd: process.cwd() };
const modelProbe = process.env.SAGAX_GROK_MODEL_PROBE === "1";
if (process.env.FAKE_ACP_DUMP && !modelProbe) {
  writeFileSync(process.env.FAKE_ACP_DUMP, JSON.stringify(dumpState, null, 2));
}
if (process.env.FAKE_ACP_LAUNCH_COUNT_FILE && !modelProbe) {
  // count launched processes: read-increment-write, so a test can assert
  // how many children the driver spawned (a pooled session launches once)
  let launches = 0;
  try {
    launches = Number.parseInt(readFileSync(process.env.FAKE_ACP_LAUNCH_COUNT_FILE, "utf8").trim(), 10) || 0;
  } catch {}
  try {
    writeFileSync(process.env.FAKE_ACP_LAUNCH_COUNT_FILE, String(launches + 1));
  } catch {}
}
if (argv.includes("--version")) {
  console.log("fake-acp 1.0.0");
  process.exit(0);
}
// Cursor's driver probes `agent status` / `agent models` on the same binary
// it later spawns for ACP. Answer those without entering the JSON-RPC loop
// so catalog/auth tests do not hang on stdin.
if (argv[0] === "status" || argv[0] === "whoami") {
  const authenticated = process.env.FAKE_ACP_AUTH !== "0";
  console.log(JSON.stringify({ isAuthenticated: authenticated }));
  process.exit(0);
}
if (argv[0] === "models" || argv.includes("--list-models")) {
  const failOnce = process.env.FAKE_ACP_VERBOSE_FAIL_ONCE;
  if (failOnce && argv.includes("--verbose") && !existsSync(failOnce)) {
    writeFileSync(failOnce, "failed once\n");
    console.error("Failed to run the query 'CREATE TABLE `workspace` (…)'");
    process.exit(1);
  }
  if (process.env.FAKE_ACP_MODELS_LIST === "v2") {
    if (argv.includes("--verbose")) {
      console.error("Unrecognized flag: --verbose");
      process.exit(1);
    }
    process.exit(0);
  }
  if (models.length) {
    const verbose = argv.includes("--verbose");
    console.log(
      models.flatMap((slug) => verbose
        ? [
            slug,
            JSON.stringify({
              id: slug.slice(slug.indexOf("/") + 1),
              providerID: slug.slice(0, slug.indexOf("/")),
              name: slug,
              status: "active",
              limit: { context: 200_000 },
            }, null, 2),
          ]
        : [slug]).join("\n"),
    );
    process.exit(0);
  }
  console.log(
    [
      "Available models",
      "",
      "auto - Auto (default)",
      "composer-2.5 - Composer 2.5 (current)",
      "gpt-5.3-codex - Codex 5.3",
      "cursor-live - Cursor Live",
    ].join("\n"),
  );
  process.exit(0);
}

const out = (obj: unknown) => process.stdout.write(JSON.stringify(obj) + "\n");
const result = (id: unknown, res: unknown) => out({ jsonrpc: "2.0", id, result: res });
const configUpdates = JSON.parse(process.env.FAKE_ACP_CONFIG_UPDATES ?? "[]") as Array<{
  after: string; sessionId?: string; configOptions: unknown[]; replay?: boolean;
}>;
const emitConfigUpdates = (after: string, sessionId: string) => {
  for (const update of configUpdates.filter((entry) => entry.after === after)) {
    out({
      jsonrpc: "2.0", method: "session/update", params: {
        sessionId: update.sessionId ?? sessionId,
        ...(update.replay ? { _meta: { isReplay: true } } : {}),
        update: { sessionUpdate: "config_option_update", configOptions: update.configOptions },
      },
    });
  }
};
// Send response and subsequent updates in one chunk to exercise wire ordering:
// a promise continuation must not overwrite a newer notification with the ACK.
const resultAndConfigUpdates = (id: unknown, res: unknown, after: string, sessionId: string) => {
  const updates = configUpdates.filter((entry) => entry.after === after).map((update) => ({
    jsonrpc: "2.0", method: "session/update", params: {
      sessionId: update.sessionId ?? sessionId,
      ...(update.replay ? { _meta: { isReplay: true } } : {}),
      update: { sessionUpdate: "config_option_update", configOptions: update.configOptions },
    },
  }));
  process.stdout.write([{ jsonrpc: "2.0", id, result: res }, ...updates].map((message) => JSON.stringify(message)).join("\n") + "\n");
};
const rpcMethods: string[] = [];
const recordMethod = (method: string) => {
  if (modelProbe) return;
  rpcMethods.push(method);
  if (process.env.FAKE_ACP_RPC_DUMP) writeFileSync(process.env.FAKE_ACP_RPC_DUMP, JSON.stringify(rpcMethods));
  if (process.env.FAKE_ACP_RPC_APPEND_FILE) {
    try {
      appendFileSync(process.env.FAKE_ACP_RPC_APPEND_FILE, JSON.stringify({ pid: process.pid, method, cwd: process.cwd() }) + "\n");
    } catch {}
  }
};

// session/set_mode + session/set_model calls seen this run
const configCalls: Array<{ method: string; params: unknown }> = [];

// pending server→client permission request id → resolver
let pendingPermissionId: number | null = null;
let onPermissionAnswered: ((allowed: boolean) => void) | null = null;
let lastPermissionCancelled = false;
// pending server→client cursor/ask_question probe → resolver (the unsupported
// method the driver must reject rather than guess a shape for)
let pendingAskQuestionId: number | null = null;
let onAskQuestionAnswered: (() => void) | null = null;

// hang mode: the prompt we are holding open and its keep-alive timer —
// session/cancel resolves it cancelled (the ACP spec's cancel contract)
// and drops the keep-alive
let hangingPromptId: unknown = null;
// stall-first-prompt mode: how many prompts this process has received
let stallPrompts = 0;
let reasoningErrors = 0;
let hangKeepAlive: ReturnType<typeof setInterval> | null = null;

// ask-peer mode: the "agents" MCP server entry from session/new's mcpServers
type McpEntry = { command: string; args?: string[]; env?: Array<{ name: string; value: string }> };
let agentsMcp: McpEntry | null = null;
// mcp-tools mode: every entry from the last session/new or session/load
type AnyMcpEntry = { name: string; command?: string; args?: string[]; env?: Array<{ name: string; value: string }>; url?: string; headers?: Array<{ name: string; value: string }> };
let sessionMcp: AnyMcpEntry[] = [];
/** grok 1.0.25's initialize (`grok mcp doctor`, captured Oct 8 2026) */
const GROK_MCP_HANDSHAKE = { protocolVersion: "2025-11-25", capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } }, clientInfo: { name: "grok-shell", version: "1.0.25" } };

/** Connect one server as the agent's own MCP client would and list its tools. */
async function listMcpTools(entry: AnyMcpEntry, handshake: unknown): Promise<string[]> {
  const names = (result: any) => (result?.tools ?? []).map((tool: { name: string }) => tool.name);
  if (typeof entry.url === "string") {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    for (const { name, value } of entry.headers ?? []) headers[name] = value;
    const post = async (frame: object) => {
      const response = await fetch(entry.url!, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", ...frame }), signal: AbortSignal.timeout(20_000) });
      const session = response.headers.get("mcp-session-id");
      if (session) headers["mcp-session-id"] = session;
      const text = await response.text();
      const body = text.split("\n").find((line) => line.startsWith("data:"))?.slice(5) ?? text;
      const parsed = body.trim() ? JSON.parse(body) : {};
      if (!response.ok || parsed.error) throw new Error(`HTTP ${response.status} ${parsed.error?.message ?? ""}`.trim());
      return parsed.result;
    };
    await post({ id: 1, method: "initialize", params: handshake });
    await post({ method: "notifications/initialized" });
    return names(await post({ id: 2, method: "tools/list", params: {} }));
  }
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const { name, value } of entry.env ?? []) env[name] = value;
    const child = spawn(entry.command!, entry.args ?? [], { env, stdio: ["pipe", "pipe", "ignore"] });
    const finish = (error: Error | null, tools?: string[]) => { clearTimeout(timer); child.kill(); if (error) reject(error); else resolve(tools!); };
    const timer = setTimeout(() => finish(new Error("mcp timeout")), 20_000);
    child.on("error", (error) => finish(error));
    const write = (frame: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`);
    let pending = "";
    child.stdout.on("data", (chunk) => {
      pending += chunk;
      for (let nl = pending.indexOf("\n"); nl !== -1; nl = pending.indexOf("\n")) {
        const line = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        let frame: any;
        try { frame = JSON.parse(line); } catch { continue; }
        if (frame.error) return finish(new Error(String(frame.error.message)));
        if (frame.id === 1) { write({ method: "notifications/initialized" }); write({ id: 2, method: "tools/list", params: {} }); }
        if (frame.id === 2) return finish(null, names(frame.result));
      }
    });
    write({ id: 1, method: "initialize", params: handshake });
  });
}
// the session this process established, for FAKE_ACP_REJECT_LIVE_LOAD_FILE
let liveSession: string | null = null;
let rpcFailure: unknown = null;
function emitUsageUpdates(): void {
  const usageFile = process.env.FAKE_ACP_USAGE_UPDATES_FILE;
  if (usageFile && existsSync(usageFile)) {
    try {
      for (const used of JSON.parse(readFileSync(usageFile, "utf8")) as unknown[]) {
        if (typeof used === "number") {
          if (process.env.FAKE_ACP_ROUND_USAGE) {
            const cached = Math.floor(used * 0.9);
            out({ jsonrpc: "2.0", method: "_x.ai/session_notification", params: { sessionId: liveSession, update: { sessionUpdate: "response_completed", usage: { input_tokens: used - cached, cache_read_input_tokens: cached, output_tokens: 7 } } } });
          } else {
            out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "usage_update", used, size: 200000 } } });
          }
        }
      }
    } catch {}
  }
}
function failRpc(msg: { method: string; id: unknown }): boolean {
  if (msg.method !== (process.env.FAKE_ACP_RPC_FAILURE_METHOD ?? "session/prompt")) return false;
  // The server's own catalog probe is not a turn: the armed failure (and its gate) belongs to turns, so a status read never waits on it.
  if (process.cwd().endsWith(["", "providers", "opencode", "discovery"].join(sep))) return false;
  const failureFile = process.env.FAKE_ACP_RPC_FAILURE_FILE;
  if (process.env.FAKE_ACP_RPC_FAILURE_WHILE_FILE === "1") rpcFailure = null;
  if (failureFile && existsSync(failureFile)) rpcFailure = JSON.parse(readFileSync(failureFile, "utf8"));
  if (!rpcFailure) return false;
  if (msg.method === "session/prompt" && process.env.FAKE_ACP_RPC_FAILURE_AFTER_USAGE === "1") emitUsageUpdates();
  if (msg.method === "session/prompt" && process.env.FAKE_ACP_RPC_FAILURE_AFTER_OUTPUT === "1") playTurn();
  const fail = () => {
    recordMethod(`${msg.method}.error`);
    out({ jsonrpc: "2.0", id: msg.id, error: rpcFailure });
  };
  const gate = process.env.FAKE_ACP_RPC_FAILURE_GATE;
  if (gate && !existsSync(gate)) {
    const timer = setInterval(() => {
      if (!existsSync(gate)) return;
      clearInterval(timer);
      fail();
    }, 20);
  } else fail();
  return true;
}

/** Minimal one-shot MCP stdio client: initialize, call each tool in
 * sequence, return the text of the last result. Dependency-free. */
function driveMcp(entry: McpEntry, calls: Array<{ name: string | (() => string); args: (prev: string) => object }>, strict = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const { name, value } of entry.env ?? []) env[name] = value;
    const child = spawn(entry.command, entry.args ?? [], { env, stdio: ["pipe", "pipe", "inherit"] });
    child.on("error", reject);
    const timer = setTimeout(() => (child.kill(), reject(new Error("mcp timeout"))), 60_000);
    let step = -1; // -1 = initialize in flight
    let last = "";
    const write = (obj: unknown) => child.stdin.write(JSON.stringify(obj) + "\n");
    const next = () => {
      step += 1;
      if (step >= calls.length) {
        clearTimeout(timer);
        child.kill();
        return resolve(last);
      }
      const call = calls[step];
      const args = call.args(last);
      write({ jsonrpc: "2.0", id: step + 2, method: "tools/call", params: { name: typeof call.name === "function" ? call.name() : call.name, arguments: args } });
    };
    let buf = "";
    child.stdout.on("data", (c) => {
      buf += c;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === undefined) continue;
        // Protocol failures (for example a removed tool) are never a successful
        // empty reply. Tool-result denials remain inspectable by the legacy
        // approval fixtures unless that caller explicitly requires success.
        if (msg.error || (strict && msg.result?.isError)) {
          clearTimeout(timer);
          child.kill();
          reject(new Error(`Fixture MCP request failed: ${JSON.stringify(msg.error ?? msg.result)}`));
          return;
        }
        if (step === -1) {
          write({ jsonrpc: "2.0", method: "notifications/initialized" });
          next();
          continue;
        }
        last = String(msg.result?.content?.[0]?.text ?? "");
        next();
      }
    });
    write({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  });
}

function playTurn() {
  out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "hello from fake acp" } } } });
  out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call", toolCallId: "tc-1", title: "run", rawInput: { path: "/fixture/readme.md", password: "acp-input-secret" } } } });
  out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call_update", toolCallId: "tc-1", status: "completed", rawOutput: { text: "fixture file content", api_key: "acp-output-secret" } } } });
}

/** Scripted text → tool → text → tool → text turn for order-contract tests. */
function playInterleaveTurn() {
  out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "before one" } } } });
  out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call", toolCallId: "tc-1", title: "run" } } });
  out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call_update", toolCallId: "tc-1", status: "completed" } } });
  out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "before two" } } } });
  out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call", toolCallId: "tc-2", title: "run" } } });
  out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call_update", toolCallId: "tc-2", status: "completed" } } });
  out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "after" } } } });
}

/** Scripted reasoning-only turn: thought chunks and nothing else — the shape
 * of a provider that never leaves its thinking stream yet still answers
 * end_turn, which the driver must report as a lost turn, not a success. */
function playReasoningTurn() {
  out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_thought_chunk", content: { text: "considering the request at length" } } } });
  out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_thought_chunk", content: { text: " without ever producing an answer" } } } });
}

// voice mode: what a real agent spends before it answers each request
const bootAt = Date.now();
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const envMs = (name: string) => Math.max(0, Number(process.env[name]) || 0);
let voiceQueue: Promise<void> = Promise.resolve();
/** Set once a cache-prime prompt has been answered, so the next spoken
 * prompt can use FAKE_ACP_CACHED_FIRST_TOKEN_MS. Unset keeps the cold delay. */
let voiceCachePrimed = false;
/** The spoken prompt still streaming. session/cancel resolves it and the
 * loop stops, so a replaced utterance does not hold the thread. */
let voiceInFlight: { id: number; settled: boolean } | null = null;
async function voiceDelay(msg: any): Promise<void> {
  if (msg.method === "initialize") await pause(bootAt + envMs("FAKE_ACP_COLD_MS") - Date.now());
  else if (msg.method === "session/new" || msg.method === "session/load" || msg.method === "session/resume") await pause(envMs("FAKE_ACP_LOAD_MS"));
}

let buf = "";
process.stdin.on("data", (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (mode === "voice") {
      // in order, each request after its own real-world cost
      voiceQueue = voiceQueue.then(() => voiceDelay(msg)).then(() => { handle(msg); }, () => { handle(msg); });
    } else handle(msg);
  }
});

function handle(msg: any) {
  // client's response to the unsupported cursor/ask_question probe
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && msg.id === pendingAskQuestionId) {
    pendingAskQuestionId = null;
    onAskQuestionAnswered?.();
    return;
  }
  // client's response to our permission request
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && msg.id === pendingPermissionId) {
    pendingPermissionId = null;
    const chosen = msg.result?.outcome?.optionId;
    lastPermissionCancelled = msg.result?.outcome?.outcome === "cancelled";
    // which option the client picked, for tests asserting allow_always
    if (process.env.FAKE_ACP_PERMISSION_ANSWER) writeFileSync(process.env.FAKE_ACP_PERMISSION_ANSWER, String(chosen ?? "cancelled"));
    onPermissionAnswered?.(typeof chosen === "string" && chosen.startsWith("allow"));
    return;
  }
  if (!msg.method) return;
  recordMethod(msg.method);

  switch (msg.method) {
    case "initialize": {
      if (failRpc(msg)) break;
      if (mode === "hang-initialize") {
        setInterval(() => {}, 1_000);
        return;
      }
      if (mode === "exit-early") {
        process.stderr.write("fake-acp: simulated crash before result\n");
        process.exit(3);
      }
      const authMethods = mode === "no-auth" ? [] : [{ id: process.env.FAKE_ACP_AUTH_METHOD ?? "cached_token" }];
      const agentName = process.env.FAKE_ACP_AGENT_NAME;
      const acceptsImages = process.env.FAKE_ACP_IMAGE_CAPABILITY === "1";
      // which remote MCP transports this agent advertises, e.g. "http,sse"
      const mcpTransports = (process.env.FAKE_ACP_MCP_TRANSPORTS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
      result(msg.id, {
        protocolVersion: 1,
        authMethods,
        agentInfo: agentName
          ? { name: agentName, version: process.env.FAKE_ACP_AGENT_VERSION ?? "test" }
          : undefined,
        agentCapabilities: agentName || acceptsImages || mcpTransports.length
          ? {
              ...(agentName ? { loadSession: true, sessionCapabilities: { resume: true }, auth: { logout: true } } : {}),
              ...(acceptsImages ? { promptCapabilities: { image: true } } : {}),
              ...(mcpTransports.length ? { mcpCapabilities: { http: mcpTransports.includes("http"), sse: mcpTransports.includes("sse") } } : {}),
            }
          : undefined,
        _meta: {
          modelState: { currentModelId: "fake-acp-model", ...(offeredModels().length ? { availableModels: offeredModels() } : {}) },
          ...(process.env.FAKE_ACP_GROK_VERSION ? { grokShell: true, agentVersion: process.env.FAKE_ACP_GROK_VERSION } : {}),
        },
      });
      break;
    }
    case "authenticate":
      if (mode === "authenticate-failed") {
        out({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "Login expired" } });
        break;
      }
      result(msg.id, {});
      break;
    case "_x.ai/mcp/list":
      result(msg.id, { result: { servers: [], sessionMcpResolved: true } });
      break;
    case "session/new": {
      if (failRpc(msg)) break;
      if (mode === "auth-required") {
        out({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32000, message: "Authentication required", data: { providerId: "opencode-go" } },
        });
        break;
      }
      const servers: McpEntry[] = Array.isArray(msg.params?.mcpServers) ? msg.params.mcpServers : [];
      if (process.env.FAKE_ACP_DUMP) {
        writeFileSync(`${process.env.FAKE_ACP_DUMP}.session.json`, JSON.stringify(msg.params));
        dumpState.mcpServers = servers;
        writeFileSync(process.env.FAKE_ACP_DUMP, JSON.stringify(dumpState, null, 2));
      }
      agentsMcp = servers.find((s: any) => s?.name === "agents") ?? null;
      sessionMcp = servers as AnyMcpEntry[];
      if (process.env.FAKE_ACP_DUMP) {
        writeFileSync(`${process.env.FAKE_ACP_DUMP}.mcp.json`, JSON.stringify(servers, null, 2));
      }
      const opts = configOptions();
      const mdls = sessionModels(newSessionModel(msg.params, "fake-acp-session"));
      liveSession = "fake-acp-session";
      resultAndConfigUpdates(msg.id, {
        sessionId: "fake-acp-session",
        ...(opts ? { configOptions: opts } : {}),
        ...(mdls ? { models: mdls } : {}),
      }, "session/new", "fake-acp-session");
      break;
    }
    case "session/load": {
      if (process.env.FAKE_ACP_LOAD_ERROR) {
        out({ jsonrpc: "2.0", id: msg.id, error: JSON.parse(process.env.FAKE_ACP_LOAD_ERROR) });
        break;
      }
      if (process.env.FAKE_ACP_LOAD_NULL) {
        result(msg.id, null);
        break;
      }
      if (rejectLiveLoadFile && existsSync(rejectLiveLoadFile) && liveSession === msg.params?.sessionId) {
        out({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32000, message: "session already active in this agent" },
        });
        break;
      }
      const cachedLiveLoad = process.env.FAKE_ACP_CACHED_LIVE_LOAD === "1" && liveSession === msg.params?.sessionId;
      // like a real agent that reconnects its MCP servers on load, so a
      // later turn on this process carries that turn's own token
      if ((mode === "safe-agent-reads" || mode === "voice" || mode === "chief-delegate" || mode === "create-peer") && !cachedLiveLoad) {
        agentsMcp = (msg.params?.mcpServers ?? []).find((server: any) => server.name === "agents") ?? null;
      }
      if (process.env.FAKE_ACP_DUMP) {
        writeFileSync(`${process.env.FAKE_ACP_DUMP}.mcp.json`, JSON.stringify(msg.params?.mcpServers ?? []));
      }
      if (!cachedLiveLoad) sessionMcp = msg.params?.mcpServers ?? [];
      const opts = configOptions();
      const mdls = sessionModels(loadedSessionModel(msg.params?.sessionId));
      liveSession = typeof msg.params?.sessionId === "string" ? msg.params.sessionId : liveSession;
      resultAndConfigUpdates(msg.id, { ...(opts ? { configOptions: opts } : {}), ...(mdls ? { models: mdls } : {}) }, "session/load", msg.params.sessionId);
      break;
    }
    case "session/resume": {
      if (rejectLiveLoadFile && existsSync(rejectLiveLoadFile) && liveSession === msg.params?.sessionId) {
        out({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32000, message: "session already active in this agent" },
        });
        break;
      }
      if (process.env.FAKE_ACP_DUMP) {
        writeFileSync(`${process.env.FAKE_ACP_DUMP}.mcp.json`, JSON.stringify(msg.params?.mcpServers ?? []));
      }
      const opts = configOptions();
      const mdls = sessionModels();
      liveSession = typeof msg.params?.sessionId === "string" ? msg.params.sessionId : liveSession;
      result(msg.id, { ...(opts ? { configOptions: opts } : {}), ...(mdls ? { models: mdls } : {}) });
      break;
    }
    // per-session settings (droid sets model/autonomy here, not via argv).
    // Recorded next to FAKE_ACP_DUMP so a test can assert what was applied.
    // NOTE: last writer wins — each turn spawns a fresh child, so a two-turn
    // test would only ever see the final turn's calls.
    case "session/set_mode":
    case "session/set_model": {
      if (mode === "no-session-config") {
        // an older agent that predates these methods
        return out({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
      }
      if (msg.method === "session/set_model" && (mode === "set-model-invalid-params" ||
          (mode === "set-model-invalid-after-first" && configCalls.some((call) => call.method === "session/set_model")))) {
        // an agent whose ACP model namespace does not contain the id it was
        // sent — Cursor's answer when handed an argv slug like `auto`.
        return out({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "Invalid params" } });
      }
      const settingId = msg.method === "session/set_mode" ? "modeId" : "modelId";
      if (typeof msg.params?.sessionId !== "string" || typeof msg.params?.[settingId] !== "string") {
        out({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32602, message: `Invalid params: sessionId and ${settingId} must be strings` },
        });
        break;
      }
      configCalls.push({ method: msg.method, params: msg.params });
      if (process.env.FAKE_ACP_DUMP) {
        writeFileSync(`${process.env.FAKE_ACP_DUMP}.config.json`, JSON.stringify(configCalls, null, 2));
      }
      result(msg.id, {});
      break;
    }
    case "session/set_config_option": {
      const { configId, value } = msg.params ?? {};
      const variant = variantConfigs[currentModel ?? ""];
      if (variant && configId === (variant.id ?? "effort") && variantValues(variant.options).includes(value)) {
        if (!process.env.FAKE_ACP_VARIANT_STICKS) currentVariant = value;
        configCalls.push({ method: msg.method, params: msg.params });
        if (process.env.FAKE_ACP_DUMP) {
          writeFileSync(`${process.env.FAKE_ACP_DUMP}.config.json`, JSON.stringify(configCalls, null, 2));
        }
        resultAndConfigUpdates(msg.id, process.env.FAKE_ACP_EMPTY_VARIANT_ACK ? {} : { configOptions: configOptions() }, "effort", msg.params.sessionId);
        break;
      }
      if (configId === "mode" && modes.includes(value)) {
        const ackFile = process.env.FAKE_ACP_MODE_ACK_FILE;
        const ack = ackFile && existsSync(ackFile) ? readFileSync(ackFile, "utf8").trim() : "";
        if (ack === "error") {
          out({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: "Internal error: could not change mode" } });
          break;
        }
        if (ack === "empty") {
          result(msg.id, {});
          break;
        }
        currentMode = value;
        configCalls.push({ method: msg.method, params: msg.params });
        if (process.env.FAKE_ACP_DUMP) {
          writeFileSync(`${process.env.FAKE_ACP_DUMP}.config.json`, JSON.stringify(configCalls, null, 2));
        }
        result(msg.id, process.env.FAKE_ACP_EMPTY_MODE_ACK ? {} : { configOptions: configOptions() });
        break;
      }
      if (configId !== "model" || !models.includes(value)) {
        out({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32602, message: `Invalid params: model not found: ${value}`, data: { modelId: value } },
        });
        break;
      }
      // FAKE_ACP_MODEL_STICKS: answer OK and keep the old model anyway. Nothing
      // in the protocol forbids it, and it is the shape core.ts's confirmation
      // guard exists for — an error is loud, this is silent.
      if (!process.env.FAKE_ACP_MODEL_STICKS) {
        currentModel = value;
        currentVariant = variantConfigs[value]?.currentValue;
      }
      configCalls.push({ method: msg.method, params: msg.params });
      if (process.env.FAKE_ACP_DUMP) {
        writeFileSync(`${process.env.FAKE_ACP_DUMP}.config.json`, JSON.stringify(configCalls, null, 2));
      }
      resultAndConfigUpdates(msg.id, { configOptions: configOptions() }, "model", msg.params.sessionId);
      break;
    }
    case "session/prompt": {
      if (process.env.FAKE_ACP_DUMP && (modes.length || models.length)) {
        appendFileSync(`${process.env.FAKE_ACP_DUMP}.prompts.jsonl`, JSON.stringify({
          pid: process.pid, sessionId: msg.params?.sessionId, mode: currentMode, model: currentModel,
        }) + "\n");
      }
      emitConfigUpdates("session/prompt", msg.params.sessionId);
      if (process.env.FAKE_ACP_DUMP && process.env.FAKE_ACP_VARIANTS) {
        writeFileSync(`${process.env.FAKE_ACP_DUMP}.selection.json`, JSON.stringify({
          sessionId: msg.params.sessionId, model: currentModel, variant: currentVariant,
        }));
      }
      if (process.env.FAKE_ACP_DUMP && process.env.FAKE_ACP_DUMP_PROMPT === "1") {
        writeFileSync(`${process.env.FAKE_ACP_DUMP}.prompt.json`, JSON.stringify(msg.params?.prompt ?? null, null, 2));
      }
      if (failRpc(msg)) return;
      if (mode === "stall-first-prompt" && ++stallPrompts === 1) {
        // The first prompt gets nothing at all back (a provider that never
        // sends its first token); session/cancel resolves it cancelled and
        // every later prompt answers normally.
        hangingPromptId = msg.id;
        hangKeepAlive = setInterval(() => {}, 1_000);
        return;
      }
      // FAKE_ACP_TEXT_REPLY: a plain text answer and nothing else, the shape of
      // memory upkeep's one-shot call (drivers/acp/background-text.ts)
      if (process.env.FAKE_ACP_TEXT_REPLY !== undefined) {
        out({ jsonrpc: "2.0", method: "session/update", params: { sessionId: msg.params?.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: process.env.FAKE_ACP_TEXT_REPLY } } } });
        result(msg.id, { stopReason: "end_turn", _meta: { inputTokens: 12, outputTokens: 4 } });
        return;
      }
      if (mode === "hang") {
        // never resolve the prompt on our own — lets tests exercise interrupt
        hangingPromptId = msg.id;
        hangKeepAlive = setInterval(() => {}, 1_000);
        return;
      }
      if (mode === "stall-after-text") {
        // Stream a chunk, then go fully silent forever: no updates, no result,
        // no exit. This is the shape of a wedged OpenCode agent that stopped
        // mid-answer — the driver's prompt idle guard must fail the turn on
        // its own, because nothing else will ever arrive.
        out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "half an answer, then silence" } } } });
        hangingPromptId = msg.id;
        hangKeepAlive = setInterval(() => {}, 1_000);
        return;
      }
      if (mode === "fail-after-text") {
        // Stream real text, THEN fail the turn — the shape of a crash
        // mid-answer. This is the one case where the routine-failed/done
        // notification dedup is load-bearing: the reply is non-empty, so
        // nothing else suppresses the generic done.
        out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "half a report, then a crash" } } } });
        recordMethod("session/prompt.error");
        out({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "fake acp: turn failed after streaming" } });
        return;
      }
      const complete = () => {
        emitUsageUpdates();
        recordMethod("session/prompt.result");
        result(
          msg.id,
          // FAKE_ACP_USAGE_ROOT reproduces opencode 1.18.18's shape: usage at
          // the result root with an empty _meta, instead of usage under _meta.
          process.env.FAKE_ACP_USAGE_ROOT
            ? { stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 }, _meta: {} }
            : { stopReason: "end_turn", _meta: { inputTokens: 10, outputTokens: 5 } },
        );
      };
      const promptHead = String(msg.params?.prompt?.[0]?.text ?? "");
      if (mode === "reasoning-only-error") {
        // Grok/xAI's "empty response from model (reasoning_only)": a thought
        // stream, then an rpc -32603 with that detail, for the first N prompts
        // of the turn (FAKE_ACP_REASONING_FAIL_TIMES, default every prompt).
        // After that it answers normally, so one fixture drives both the nudge
        // recovery and the bounded give-up. Each failure is counted to
        // FAKE_ACP_REASONING_COUNT_FILE so a test can prove the bound.
        out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_thought_chunk", content: { text: "thinking hard, producing no answer" } } } });
        const failTimes = process.env.FAKE_ACP_REASONING_FAIL_TIMES === undefined
          ? Infinity
          : Number(process.env.FAKE_ACP_REASONING_FAIL_TIMES);
        if (reasoningErrors < failTimes) {
          reasoningErrors += 1;
          if (process.env.FAKE_ACP_REASONING_COUNT_FILE) {
            try { writeFileSync(process.env.FAKE_ACP_REASONING_COUNT_FILE, String(reasoningErrors)); } catch {}
          }
          recordMethod("session/prompt.error");
          out({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: "Internal error", data: { details: "empty response from model (reasoning_only)" } } });
          return;
        }
        out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "here is the answer after thinking" } } } });
        complete();
        return;
      }
      if (promptHead.includes("[sagax-cache-prime]")) {
        voiceCachePrimed = true;
        out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "ok" } } } });
        complete();
        return;
      }
      if (mode === "voice") {
        const job = { id: msg.id as number, settled: false };
        voiceInFlight = job;
        const finish = (body: Record<string, unknown>) => {
          if (job.settled) return;
          job.settled = true;
          if (voiceInFlight === job) voiceInFlight = null;
          emitUsageUpdates();
          recordMethod("session/prompt.result");
          result(msg.id, body);
        };
        void (async () => {
          // After a cache prime, FAKE_ACP_CACHED_FIRST_TOKEN_MS (when set)
          // stands in for a prefix-cache hit. Unset keeps the cold delay,
          // including an explicit 0.
          const cached = process.env.FAKE_ACP_CACHED_FIRST_TOKEN_MS;
          const firstToken = voiceCachePrimed && cached !== undefined
            ? envMs("FAKE_ACP_CACHED_FIRST_TOKEN_MS")
            : envMs("FAKE_ACP_FIRST_TOKEN_MS");
          await pause(firstToken);
          if (job.settled) return;
          let reply = process.env.FAKE_ACP_VOICE_REPLY || "Sure. It is sunny in Montreal today, with a high of twenty degrees and a light wind. Do you want the forecast for tomorrow too?";
          const tool = process.env.FAKE_ACP_VOICE_TOOL;
          if (tool) {
            const ok = agentsMcp ? await driveMcp(agentsMcp, [{ name: tool, args: () => ({}) }], true).then(() => true, () => false) : false;
            reply += ` mcp:${tool}:${ok ? "ok" : "error"}`;
          }
          if (job.settled) return;
          const tokenMs = envMs("FAKE_ACP_TOKEN_MS");
          for (const word of reply.match(/\S+\s*/g) ?? [reply]) {
            if (job.settled) return;
            out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: word } } } });
            if (tokenMs) await pause(tokenMs);
          }
          finish({ stopReason: "end_turn", _meta: { inputTokens: 10, outputTokens: 5 } });
        })();
        return;
      }
      if (mode === "quiet-then-answer") {
        const lines: string[] = process.env.FAKE_ACP_QWEN_LOG ? JSON.parse(process.env.FAKE_ACP_QWEN_LOG) : [];
        let logTimer: ReturnType<typeof setInterval> | null = null;
        if (lines.length && process.env.QWEN_HOME && liveSession) {
          const dir = `${process.env.QWEN_HOME}/debug`;
          mkdirSync(dir, { recursive: true });
          let i = 0;
          logTimer = setInterval(() => {
            appendFileSync(`${dir}/${liveSession}.txt`, `${new Date().toISOString()} ${lines[Math.min(i++, lines.length - 1)]}\n`);
          }, Number(process.env.FAKE_ACP_LOG_EVERY_MS ?? 100));
        }
        setTimeout(() => {
          if (logTimer) clearInterval(logTimer);
          out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "done" } } } });
          complete();
        }, Number(process.env.FAKE_ACP_QUIET_MS ?? 600));
        return;
      }
      if (mode === "slow-tool" || mode === "stall-after-tool") {
        const tool = (update: Record<string, unknown>) =>
          out({ jsonrpc: "2.0", method: "session/update", params: { update: { toolCallId: "tc-slow", ...update } } });
        // ACP's default status is pending: this tool_call carries none.
        tool({ sessionUpdate: "tool_call", title: "sleep", rawInput: { command: "sleep 45 && echo done" } });
        tool({ sessionUpdate: "tool_call_update", status: "in_progress" });
        const finish = () => tool({ sessionUpdate: "tool_call_update", status: "completed", rawOutput: { output: "done" } });
        if (mode === "stall-after-tool") {
          finish();
          hangingPromptId = msg.id;
          hangKeepAlive = setInterval(() => {}, 1_000);
          return;
        }
        setTimeout(() => {
          finish();
          out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "done" } } } });
          complete();
        }, Number(process.env.FAKE_ACP_TOOL_MS ?? 600));
        return;
      }
      if (mode === "unkeyed-tool") {
        // An agent that violates the ACP spec by omitting toolCallId: the
        // turn's lifecycle pair must still carry one stable id so consumers
        // can pair the start with its completion.
        out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call", title: "run", rawInput: { command: "echo done" } } } });
        out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call_update", status: "completed", rawOutput: { output: "done" } } } });
        out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "done" } } } });
        complete();
        return;
      }
      const promptText = String(msg.params?.prompt?.[0]?.text ?? "");
      // A hand-off's result woke this bot (the runtime's resume, or the
      // legacy wake): the harness revived it to fold the result in.
      // Synthesize instead of driving the mode's usual hand-off flow, which
      // would loop or re-ask for approval on a turn the user did not initiate.
      const runtimeReport = /\[Sagax report from @[^\]\n]*: ([a-z_]+)/.exec(promptText);
      const wokeFromDelegation = promptText.includes("[A delegated task just completed]")
        || promptText.includes("[A delegated task failed]")
        || runtimeReport !== null;
      if (wokeFromDelegation) {
        fakeLog("branch: wokeFromDelegation");
        const failed = promptText.includes("[A delegated task failed]")
          || (runtimeReport !== null && runtimeReport[1] !== "done" && runtimeReport[1] !== "completed");
        const sawResult = promptText.includes("replied to the delegated task") || /\nWhat @\S+ said: "/.test(promptText);
        const redelegateFile = process.env.FAKE_ACP_REDELEGATE_FILE;
        if (mode === "delegate-peer" && agentsMcp && sawResult && redelegateFile && !existsSync(redelegateFile)) {
          writeFileSync(redelegateFile, "1");
          void driveMcp(agentsMcp, [
            { name: "list_bots", args: () => ({}) },
            handoffCall("second delegated task"),
          ])
            .then((reply) => {
              out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: `delegated again: ${reply}` } } } });
              complete();
            })
            .catch((e) => {
              out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: `delegate error: ${(e as Error).message}` } } } });
              complete();
            });
          return;
        }
        out({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: {
                text: failed
                  ? "woke after delegation failure: will tell the user"
                  : sawResult
                    ? "woke after delegation: saw the result"
                    : "woke after delegation: no result",
              },
            },
          },
        });
        complete();
        return;
      }
      if (mode === "chief-delegate" && agentsMcp && promptText.includes("CHECK_STATUS")) {
        fakeLog(`branch: CHECK_STATUS savedTaskId=${JSON.stringify(savedDelegatedTaskId())}`);
        const savedTaskId = savedDelegatedTaskId();
        if (!savedTaskId) {
          out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "status check skipped: no delegated task id" } } } });
          complete();
          return;
        }
        void driveMcp(agentsMcp, [statusCall(savedTaskId)])
          .then((reply) => {
            out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: `status: ${reply}` } } } });
            complete();
          })
          .catch((e) => {
            out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: `status error: ${(e as Error).message}` } } } });
            complete();
          });
        return;
      }
      if (mode === "chief-delegate" && promptText.includes("CHIEF_RESULT_CONTEXT")) {
        const sawDelegatedResult =
          promptText.includes("@LongWorker replied to the delegated task")
          && promptText.includes("long delegated task");
        out({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: {
                text: sawDelegatedResult
                  ? "chief saw delegated result: long delegated task"
                  : "chief did not see delegated result",
              },
            },
          },
        });
        complete();
        return;
      }
      if (
        mode === "chief-delegate"
        && agentsMcp
        && promptText.includes("ASSIGN_TO_PEER")
        && !promptText.includes("CHIEF_FOLLOW_UP")
      ) {
        void driveMcp(agentsMcp, [
          { name: "list_bots", args: () => ({}) },
          handoffCall("long delegated task", { reason: "background assignment" }),
        ])
          .then((reply) => {
            rememberDelegatedTaskId(handoffIdOf(reply));
            out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: `assigned: ${reply}` } } } });
            complete();
          })
          .catch((e) => {
            const message = e instanceof Error ? e.message : String(e);
            out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: `delegate error: ${message}` } } } });
            complete();
          });
        return;
      }
      if (mode === "mcp-call") {
        const calls = (process.env.FAKE_ACP_MCP_CALLS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
        void (async () => {
          const results: string[] = [];
          for (const call of calls) {
            const [server, tool] = call.split(":");
            const entry = sessionMcp.find((candidate) => candidate.name === server);
            if (!entry?.command || !tool) { results.push(`${call} -> error not mounted`); continue; }
            // FAKE_ACP_ASK_BEFORE_MCP=use_tool: ask first the way grok 1.0.46
            // does in default mode when its MCP tools sit behind use_tool
            if (process.env.FAKE_ACP_ASK_BEFORE_MCP === "use_tool") {
              const allowed = await new Promise<boolean>((resolve) => {
                pendingPermissionId = 9200 + results.length;
                onPermissionAnswered = resolve;
                out({ jsonrpc: "2.0", id: pendingPermissionId, method: "session/request_permission", params: {
                  toolCall: {
                    toolCallId: `call-fake-${results.length}`, kind: "other", title: `${server}__${tool}`,
                    rawInput: { variant: "UseTool", tool_name: `${server}__${tool}`, tool_input: { note: "fake" } },
                    _meta: { "x.ai/tool": { version: 1, name: "use_tool", kind: "use_tool", namespace: "grok_build", label: "Use Tool", read_only: false } },
                  },
                  options: [{ optionId: "always-allow", kind: "allow_always" }, { optionId: "allow-once", kind: "allow_once" }, { optionId: "reject-once", kind: "reject_once" }],
                } });
              });
              if (!allowed) { results.push(`${call} -> refused at the agent's prompt`); continue; }
            }
            try {
              results.push(`${call} -> ${await driveMcp({ command: entry.command, args: entry.args, env: entry.env }, [{ name: tool, args: () => ({ note: "fake" }) }])}`);
            } catch (error) {
              results.push(`${call} -> error ${(error as Error).message}`);
            }
          }
          out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: results.join("\n") } } } });
          complete();
        })();
        return;
      }
      if (mode === "mcp-tools") {
        const handshake = process.env.FAKE_ACP_MCP_HANDSHAKE ? JSON.parse(process.env.FAKE_ACP_MCP_HANDSHAKE) : GROK_MCP_HANDSHAKE;
        void Promise.all(sessionMcp.map((entry) => listMcpTools(entry, handshake).then(
          (tools) => `${entry.name}: ${tools.join(",")}`,
          (error: Error) => `${entry.name} failed: ${error.message}`,
        ))).then((lines) => {
          out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: lines.join("\n") } } } });
          complete();
        });
        return;
      }
      if (mode === "ask-peer" && agentsMcp) {
        // the comms e2e: ask a peer bot a question through the injected
        // agents proxy and reply with what the tool said (the peer's fake
        // runs plain happy — its depth-1 turn gets no agents server, so no
        // recursion; its answer resumes this bot in a later turn)
        void driveMcp(agentsMcp, [
          { name: "list_bots", args: () => ({}) },
          handoffCall("ping from fake", { consult: true }),
        ])
          .then((reply) => {
            out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: `peer says: ${reply}` } } } });
            complete();
          })
          .catch((e) => {
            out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: `peer error: ${(e as Error).message}` } } } });
            complete();
          });
        return;
      }
      if (mode === "create-peer" && agentsMcp) {
        // Below Full access create_bot only shows the team setup card. Once
        // the person applies it the Chief resumes, finds Pixel and delegates.
        let listed = "";
        void driveMcp(agentsMcp, [
          { name: "list_bots", args: () => ({}) },
          {
            name: "create_bot",
            args: (bots) => {
              listed = bots;
              return {
                name: "Pixel",
                role: "Product designer",
                instructions: "Design and review the user experience.",
              };
            },
          },
          {
            // Every turn hands work on the same way, the routine's and the
            // person's resumed one after the card alike.
            name: "coordinate_bots",
            args: (created) => {
              const id = /id: ([\w-]+)/.exec(created)?.[1] ?? /^- Pixel\b.*?\[id: ([\w-]+)/m.exec(listed)?.[1] ?? "";
              return handoffCall("Review the new onboarding flow.", { reason: "design review" }).args(`id: ${id}`);
            },
          },
        ])
          .then((reply) => {
            out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: `team created: ${reply}` } } } });
            complete();
          })
          .catch((e) => {
            const message = e instanceof Error ? e.message : String(e);
            out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: `create error: ${message}` } } } });
            complete();
          });
        return;
      }
      if (mode === "echo-gated") {
        // echoing the WHOLE prompt (system + turn text) lets a test assert
        // both what a drained turn was sent and what it was NOT sent (e.g.
        // the webhook untrusted-data paragraph a steered turn must not get)
        const finish = () => {
          out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: `echo: ${promptText}` } } } });
          complete();
        };
        const gate = process.env.FAKE_ACP_GATE_FILE;
        // FAKE_ACP_STARTED_FILE: written the moment the prompt arrives, so a
        // test can act "during the turn" (after the harness's pre-turn
        // checkpoint) without racing the busy flag, which flips at claim.
        const started = process.env.FAKE_ACP_STARTED_FILE;
        if (started) writeFileSync(started, String(Date.now()));
        if (gate && !existsSync(gate)) {
          const poll = setInterval(() => {
            if (!existsSync(gate)) return;
            clearInterval(poll);
            finish();
          }, 50);
          return;
        }
        finish();
        return;
      }
      if (mode === "delegate-peer" && agentsMcp) {
        // async peer-handoff e2e: hand the work on and return immediately;
        // the harness fires the peer's depth-1 turn after our turn settles.
        // We don't need the peer's reply in our text — the result resumes
        // this bot in a later turn, which the wake branch above answers.
        void driveMcp(agentsMcp, [
          { name: "list_bots", args: () => ({}) },
          handoffCall("delegated task", { reason: "followup" }),
        ])
          .then((reply) => {
            out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: `delegated: ${reply}` } } } });
            complete();
          })
          .catch((e) => {
            out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: `delegate error: ${(e as Error).message}` } } } });
            complete();
          });
        return;
      }
      if (mode === "image") {
        out({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "image", data: ONE_PIXEL_PNG, mimeType: "image/png" },
            },
          },
        });
      } else if (mode === "interleave") playInterleaveTurn();
      else if (mode === "reasoning-only") playReasoningTurn();
      else if (mode !== "empty-reply") playTurn();
      if (mode === "safe-agent-reads" && agentsMcp) {
        const entry = agentsMcp;
        // Deliberately independent of the app's policy catalog. These are the
        // two exact calls in the reported regression, repeated in one turn.
        void (async () => {
          for (const name of ["list_bots", "session_search", "list_bots"]) {
            const nativeAuto = ["--permission-mode", "--approval-mode"].some((flag) => argv.includes(flag) && argv[argv.indexOf(flag) + 1] === "auto");
            if (!nativeAuto) {
              const allowed = await new Promise<boolean>((resolve) => {
                pendingPermissionId = 9100;
                onPermissionAnswered = resolve;
                out({ jsonrpc: "2.0", id: pendingPermissionId, method: "session/request_permission", params: {
                  toolCall: { toolCallId: `fixture-${name}`, kind: "other", title: `agents__${name}`, rawInput: {} },
                  options: [{ optionId: "allow-once", kind: "allow_once" }, { optionId: "reject", kind: "reject_once" }],
                } });
              });
              if (!allowed) { complete(); return; }
            }
            const text = await driveMcp(entry, [{ name, args: () => name === "session_search" ? { query: "approval fixture" } : {} }], true);
            out({ jsonrpc: "2.0", method: "session/update", params: { update: {
              sessionUpdate: "agent_message_chunk", content: { text: `${name}: ${text}\n` },
            } } });
          }
          complete();
        })().catch((error) => out({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: String(error) } }));
        return;
      }
      if (mode === "permission") {
        // ask the client to approve a tool, then — like a real agent once its
        // card is answered — close the turn with a visible reply instead of
        // ending bare (a bare end_turn is the lost-turn failure, not a success)
        pendingPermissionId = 9001;
        onPermissionAnswered = () => {
          out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "handled the permission decision" } } } });
          complete();
        };
        out({
          jsonrpc: "2.0",
          id: pendingPermissionId,
          method: "session/request_permission",
          params: {
            toolCall: process.env.FAKE_ACP_PERMISSION_TOOL_CALL
              ? JSON.parse(process.env.FAKE_ACP_PERMISSION_TOOL_CALL)
              : { kind: "execute", rawInput: { command: "echo hi" }, title: "echo hi" },
            options: process.env.FAKE_ACP_PERMISSION_OPTIONS ? JSON.parse(process.env.FAKE_ACP_PERMISSION_OPTIONS) : [
              { optionId: "allow-once", kind: "allow_once" },
              // Grok offers a session-wide allow on some requests and omits
              // it on others; the driver must cope with both.
              ...(process.env.FAKE_ACP_ALLOW_ALWAYS ? [{ optionId: "allow-always", kind: "allow_always" }] : []),
              { optionId: "reject", kind: "reject_once" },
            ],
          },
        });
        return;
      }
      if (mode === "lend-question" && agentsMcp) {
        const entry = agentsMcp;
        const list = () => driveMcp(entry, [{ name: "list_shared_computers", args: () => ({}) }]).catch((e) => `error ${(e as Error).message}`);
        void (async () => {
          const before = await list();
          pendingPermissionId = 9003;
          onPermissionAnswered = () => {
            void list().then((after) => {
              out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: `before: ${before} | after: ${after}` } } } });
              complete();
            });
          };
          out({ jsonrpc: "2.0", id: pendingPermissionId, method: "session/request_permission", params: {
            toolCall: { toolCallId: "interaction_folder", kind: "other", title: "Which folder should I read?" },
            options: [{ optionId: "docs-id", kind: "allow_once", name: "Docs" }, { optionId: "other-id", kind: "allow_once", name: "Other" }],
          } });
        })();
        return;
      }
      if (mode === "question") {
        pendingPermissionId = 9002;
        onPermissionAnswered = () => {
          // FAKE_ACP_HOLD_ON_CANCELLED: a cancelled question leaves the prompt
          // open until session/cancel, the way Antigravity's agent does
          if (process.env.FAKE_ACP_HOLD_ON_CANCELLED && lastPermissionCancelled) {
            hangingPromptId = msg.id;
            return;
          }
          out({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "answered the question" } } } });
          complete();
        };
        out({
          jsonrpc: "2.0",
          id: pendingPermissionId,
          method: "session/request_permission",
          params: {
            toolCall: { toolCallId: "interaction_color", kind: "other", title: "Which color?" },
            options: process.env.FAKE_ACP_QUESTION_OPTIONS ? JSON.parse(process.env.FAKE_ACP_QUESTION_OPTIONS) : [
              { optionId: "blue-id", kind: "allow_once", name: "Blue" },
              {
                optionId: "green-id",
                kind: "allow_once",
                name: process.env.FAKE_ACP_PAD_QUESTION_OPTION ? " Green " : "Green",
              },
            ],
          },
        });
        return;
      }
      if (mode === "ask-question-unsupported") {
        // cursor/ask_question is deliberately unwired in the driver: its wire
        // shape is unverified, so it must be rejected method-not-found rather
        // than answered with a guessed shape. Complete only after the
        // rejection arrives, so a test can await turn.completed.
        pendingAskQuestionId = 9300;
        onAskQuestionAnswered = complete;
        out({
          jsonrpc: "2.0",
          id: pendingAskQuestionId,
          method: "cursor/ask_question",
          params: { questions: [{ question: "Which color?", options: ["Blue", "Green"] }] },
        });
        return;
      }
      complete();
      break;
    }
    case "session/cancel":
      // the interrupted prompt resolves as cancelled. FAKE_ACP_CANCEL_REPLY
      // = "error" rejects it instead, any other value is the stopReason the
      // agent answers with (agents differ on how a cancel settles).
      if (voiceInFlight && !voiceInFlight.settled) {
        const job = voiceInFlight;
        job.settled = true;
        voiceInFlight = null;
        recordMethod("session/prompt.result");
        result(job.id, { stopReason: "cancelled", _meta: {} });
      }
      if (hangingPromptId !== null) {
        const cancelReply = process.env.FAKE_ACP_CANCEL_REPLY;
        if (cancelReply === "error") out({ jsonrpc: "2.0", id: hangingPromptId, error: { code: -32800, message: "Request cancelled" } });
        else result(hangingPromptId, { stopReason: cancelReply || "cancelled", _meta: {} });
        if (hangKeepAlive) clearInterval(hangKeepAlive);
        hangingPromptId = null;
        hangKeepAlive = null;
      }
      break;
    default:
      if (msg.id !== undefined) out({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
  }
}
