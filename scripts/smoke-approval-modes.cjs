// Run with `pnpm exec electron scripts/smoke-approval-modes.cjs`.
// Exercises the real private Electron utility-process grant protocol using
// only a disposable home and fake Claude/Antigravity/Codex/Grok CLIs. Never uses the live app.
const { app, utilityProcess } = require("electron");
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { mkdtempSync, mkdirSync, copyFileSync, chmodSync, writeFileSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { createServer } = require("node:net");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const { createTrustedApprovalModeCoordinator } = require("../electron/approval-trusted-mode.cjs");

const root = resolve(__dirname, "..");
const home = mkdtempSync(join(tmpdir(), "omb-approval-smoke-"));
app.setPath("userData", join(home, "electron"));
let child;
let logs = "";

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function until(check) {
  const deadline = Date.now() + 30_000;
  do {
    const result = await check();
    if (result) return result;
    await delay(50);
  } while (Date.now() < deadline);
  throw new Error(`Fixture timed out. ${logs.slice(-2000)}`);
}

app.whenReady().then(async () => {
  const port = await freePort();
  let webhookPort = await freePort();
  while (webhookPort === port) webhookPort = await freePort();
  const agy = join(home, "fake-antigravity.ts");
  copyFileSync(join(root, "server/testing/fake-acp-cli.ts"), agy);
  const harness = join(home, process.platform === "win32" ? "localharness_external.exe" : "localharness_external");
  writeFileSync(harness, "fake harness");
  if (process.platform !== "win32") { chmodSync(agy, 0o755); chmodSync(harness, 0o755); }
  for (const instanceId of ["agy", "agy-question"]) {
    const auth = join(home, "providers/antigravity", createHash("sha256").update(instanceId).digest("hex"), "antigravity-acp");
    mkdirSync(auth, { recursive: true });
    writeFileSync(join(auth, "acp_token.json"), "{}");
  }
  const agyDump = join(home, "agy.json");
  const agyRpc = join(home, "agy-rpc.json");
  // what the latest Antigravity chat prompt ran under (mode and model), from
  // any chat process: a background one-shot of the same CLI logs its own
  // prompt too, so the launch trace keeps only chat processes.
  const agyTrace = join(home, "agy-launches.jsonl");
  const lastPrompt = () => {
    const chat = new Set(readFileSync(agyTrace, "utf8").trim().split("\n").map((line) => JSON.parse(line))
      .filter((launch) => !launch.modelProbe && !launch.reachProbe && !launch.backgroundText && !launch.versionOnly && !launch.connectorCall)
      .map((launch) => launch.pid));
    return readFileSync(`${agyDump}.prompts.jsonl`, "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter((prompt) => chat.has(prompt.pid)).at(-1);
  };
  const codexDump = join(home, "codex.json");
  const grokDump = join(home, "grok.json");
  const grokRpc = join(home, "grok-rpc.json");
  const grokTrace = join(home, "grok-launches.jsonl");
  // The argv of the chat process that ran the latest turn's prompt. Side
  // spawns of the same CLI (a background one-shot, a warm process for
  // another thread) rewrite the plain dump around a turn, so the launch
  // trace and the prompt log name the turn's own process.
  const grokPrompts = () => { try { return readFileSync(`${grokDump}.prompts.jsonl`, "utf8").trim().split("\n").map((line) => JSON.parse(line)); } catch { return []; } };
  const grokChatArgv = (promptsBefore = 0) => {
    const launches = readFileSync(grokTrace, "utf8").trim().split("\n").map((line) => JSON.parse(line))
      .filter((launch) => !launch.modelProbe && !launch.reachProbe && !launch.backgroundText && !launch.versionOnly && !launch.connectorCall);
    const prompted = new Set(grokPrompts().slice(promptsBefore).map((prompt) => prompt.pid));
    return launches.filter((launch) => prompted.has(launch.pid)).at(-1).argv;
  };
  if (process.argv.includes("--model-ui-only")) {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex/config.toml"), 'model_provider = "fixture"\nmodel = "fixture-local"\n[model_providers.fixture]\nname = "Fixture local"\n');
  }
  mkdirSync(join(home, ".grok"), { recursive: true });
  writeFileSync(join(home, ".grok", "auth.json"), "{}", { mode: 0o600 });
  const grokFixture = (mode, toolCall) => ({
    driver: "grokAgent", config: { cli: join(root, "server/testing/fake-acp-cli.ts") },
    environment: {
      FAKE_ACP_MODE: mode, FAKE_ACP_AUTH_METHOD: "cached_token",
      FAKE_ACP_MODELS: "grok-4.6,grok-4.5", FAKE_ACP_DUMP: grokDump, FAKE_ACP_RPC_DUMP: grokRpc, FAKE_ACP_LAUNCH_TRACE_FILE: grokTrace,
      ...(toolCall ? { FAKE_ACP_PERMISSION_TOOL_CALL: JSON.stringify(toolCall) } : {}),
    },
  });
  writeFileSync(join(home, "config.json"), JSON.stringify({ instances: {
    claude: { driver: "claudeAgent", config: { cli: join(root, "server/testing/fake-claude-cli.ts") },
      ...(process.argv.includes("--model-ui-only") ? { environment: { FAKE_CLAUDE_VERSION: "2.1.284" } } : {}) },
    codex: { driver: "codex", config: { cli: join(root, "server/testing/fake-codex-app-server.ts") }, environment: { FAKE_CODEX_MODE: "approval", FAKE_CODEX_DUMP: codexDump } },
    agy: { driver: "antigravityAgent", config: { cli: agy }, environment: { FAKE_ACP_DUMP: agyDump, FAKE_ACP_RPC_DUMP: agyRpc, FAKE_ACP_LAUNCH_TRACE_FILE: agyTrace } },
    "agy-question": { driver: "antigravityAgent", config: { cli: agy }, environment: { FAKE_ACP_MODE: "question" } },
    "grok-reads": grokFixture("safe-agent-reads"),
    "grok-delete": grokFixture("permission", { kind: "delete", title: "Delete the project", rawInput: { path: "/fixture/project" } }),
    "grok-credential": grokFixture("permission", { kind: "other", title: "agents__request_credential", rawInput: { credential_id: "ttsKey" } }),
    "grok-spoof": grokFixture("permission", { kind: "execute", title: "agents__list_bots", rawInput: { command: "cat ~/.ssh/id_ed25519" } }),
    "grok-question": grokFixture("question"),
    ...(process.argv.includes("--model-ui-only") ? {
      "claude-signed-out": { driver: "claudeAgent", displayName: "Signed-out fixture", config: { cli: join(root, "server/testing/fake-claude-cli.ts") }, environment: { FAKE_CLAUDE_AUTH: "out" } },
      "missing-codex": { driver: "codex", displayName: "Missing provider fixture", config: { cli: join(home, "not-installed") } },
    } : {}),
  } }));
  const dump = join(home, "claude-argv.json");
  const testCapabilityKey = randomUUID();
  const coordinator = createTrustedApprovalModeCoordinator({ randomId: randomUUID });
  child = utilityProcess.fork(join(root, "server/index.ts"), [], {
    cwd: root,
    execArgv: ["--experimental-strip-types"],
    env: {
      HOME: home, USERPROFILE: home, SAGAX_DATA_DIR: home, PATH: "",
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(webhookPort),
      SAGAX_TEST_INTERNAL_CAPABILITY_KEY: testCapabilityKey,
      FAKE_CLAUDE_MODE: "happy", FAKE_CLAUDE_DUMP: dump,
      FAKE_ACP_MODE: "permission", FAKE_ACP_AUTH_METHOD: "oauth-personal",
      FAKE_ACP_MODELS: "gemini-3.8-flash-high,gemini-3.8-flash-low", FAKE_ACP_MODES: "default,yolo",
    },
    stdio: "pipe",
  });
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  child.on("message", (message) => coordinator.receive(child, message));
  child.on("exit", () => coordinator.rejectProcess(child));
  const api = async (path, method = "GET", body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { "content-type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  await until(() => api("/api/health").catch(() => null));
  // Full answering a call with no card: its own gate (full-access) or, on
  // the owner route, Full access as bypass (owner-bypass, 2026-11-06).
  const answeredByFull = (row) => row.source === "full-access" || row.source === "owner-bypass";
  // The level a thread runs at. Since #1169 a thread follows its bot, live,
  // and carries a level of its own only while it keeps an exception.
  const levelOf = (bot, task) => task?.approvalMode ?? bot.approvalMode;
  const threadLevel = (bot, threadId) => levelOf(bot, bot.tasks.find((task) => task.threadId === threadId));
  const everyThreadAt = (bot, mode) => bot.tasks.length > 0 && bot.tasks.every((task) => levelOf(bot, task) === mode);
  const verifyUi = () => require("./testing/approval-ui-smoke.cjs")({ root, url: `http://127.0.0.1:${port}`, api, until,
    grant: (botId, mode, options) => coordinator.request(child, botId, mode, options),
  });
  if (process.argv.includes("--skill-ui-only")) {
    await require("./testing/skill-approval-ui-smoke.cjs")({ root, home, url: `http://127.0.0.1:${port}`, api, until,
      capability: (botId, threadId) => api("/api/testing/internal-capability", "POST", { botId, threadId, skillAuthoring: true }, { "x-openmausbot-test-capability": testCapabilityKey }),
    });
    return;
  }
  if (process.argv.includes("--sidebar-attention-only")) {
    await require("./testing/sidebar-attention-ui-smoke.cjs")({ root, url: `http://127.0.0.1:${port}`, api, until });
    return;
  }
  if (process.argv.includes("--ui-only")) { await verifyUi(); return; }
  // One explicit grant covers old, archived and future threads, even if their
  // provider differs. Use the real private bridge, not fixture state edits.
  const whole = (await api("/api/bots", "POST", { name: "All threads fixture", modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } })).body.bot;
  const untouched = (await api("/api/bots", "POST", { name: "Unrelated bot" })).body.bot;
  await coordinator.request(child, whole.id, "ask");
  const threads = [];
  for (const [instanceId, model] of [["claude", "claude-sonnet-5"], ["codex", "gpt-6-astra"], ["grok-reads", "grok-4.6"], ["agy", "gemini-3.8-flash-high"]]) {
    const task = (await api(`/api/bots/${whole.id}/tasks`, "POST", { title: `Existing ${instanceId} conversation` })).body.task;
    assert.equal((await api(`/api/bots/${whole.id}/tasks/${task.threadId}`, "PATCH", { modelSelection: { instanceId, model } })).status, 200);
    threads.push(task.threadId);
  }
  assert.equal((await api(`/api/bots/${whole.id}/tasks/${threads[0]}`, "PATCH", { archivedAt: Date.now() })).status, 200);
  const allGranted = await coordinator.request(child, whole.id, "full", { allThreads: true });
  assert.equal(allGranted.approvalMode, "full");
  assert.ok(everyThreadAt(allGranted, "full"));
  const future = (await api(`/api/bots/${whole.id}/tasks`, "POST", { title: "Future thread" })).body.task;
  assert.equal(threadLevel((await api("/api/bots?messages=0")).body.bots.find(bot => bot.id === whole.id), future.threadId), "full");
  assert.equal((await api("/api/bots?messages=0")).body.bots.find(bot => bot.id === untouched.id).approvalMode, untouched.approvalMode);
  const persisted = JSON.parse(readFileSync(join(home, "bots.json"), "utf8")).find(bot => bot.id === whole.id);
  assert.equal(persisted.approvalMode, "full");
  assert.ok(persisted.tasks.every(task => task.approvalMode === undefined && task.approvalOwn === undefined));
  assert.equal(persisted.approvalGrant, undefined);
  const revoked = await coordinator.request(child, whole.id, "ask", { allThreads: true });
  assert.equal(revoked.approvalMode, "ask");
  assert.ok(everyThreadAt(revoked, "ask"));
  // Auto and Edits reach every thread the same way, in one write with no
  // grant phases (how a team-wide level leaves Custom).
  const autoEverywhere = await coordinator.request(child, whole.id, "auto", { allThreads: true });
  assert.equal(autoEverywhere.approvalMode, "auto");
  assert.ok(everyThreadAt(autoEverywhere, "auto"));
  assert.ok(everyThreadAt(await coordinator.request(child, whole.id, "ask", { allThreads: true }), "ask"));
  console.log(JSON.stringify({ allThreads: true, mixedProviders: true, archivedIncluded: true, futureInherits: true, unrelatedBotUnchanged: true, persisted: true }));
  if (process.argv.includes("--all-threads-only")) { await verifyUi(); return; }
  const created = await api("/api/bots", "POST", { modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } });
  assert.equal(created.status, 201);
  const id = created.body.bot.id;
  // Full needs no desktop channel (omb #2701): any client that reaches this
  // API turns it on. Custom stays the desktop's private channel's own.
  assert.equal((await api(`/api/bots/${id}`, "PATCH", { approvalMode: "full", acknowledgeFullAccess: true })).status, 200);
  assert.equal((await api(`/api/bots/${id}`, "PATCH", { approvalMode: "ask" })).status, 200);
  // Every thread follows its bot's level, live (#1169): the first thread
  // and one opened after the change both run at each new level.
  const firstThread = created.body.bot.threadId;
  const readCreated = async () => (await api("/api/bots?messages=0")).body.bots.find((bot) => bot.id === id);
  // Claude keeps Sagax's broker at every level (#1982): Full and Auto run
  // Auto-accept edits plus their allowlists, never the CLI's own bypass or
  // auto classifier (server/drivers/claude/turn-prepare-args.ts).
  for (const [mode, native] of [["full", "acceptEdits"], ["auto", "acceptEdits"], ["edits", "acceptEdits"], ["ask", "default"]]) {
    await coordinator.request(child, id, mode);
    await until(async () => (await readCreated())?.approvalMode === mode);
    const fresh = (await api(`/api/bots/${id}/tasks`, "POST", { title: `Verify ${mode}` })).body.task;
    assert.equal(threadLevel(await readCreated(), fresh.threadId), mode);
    assert.equal((await api(`/api/bots/${id}/messages`, "POST", { text: `Verify ${mode}`, threadId: fresh.threadId })).status, 202);
    await until(async () => !(await readCreated()).tasks.find((task) => task.threadId === fresh.threadId)?.busy);
    const argv = JSON.parse(readFileSync(dump, "utf8")).argv;
    assert.equal(argv[argv.indexOf("--permission-mode") + 1], native);
    if (firstThread) assert.equal(threadLevel(await readCreated(), firstThread), mode);
    console.log(JSON.stringify({ mode, native, privateGrant: true, newThreadInherits: true, firstThreadFollows: Boolean(firstThread), turnSettled: true }));
  }
  await assert.rejects(coordinator.request(child, id, "custom"), /only for Codex/);
  // An existing conversation follows its bot's level, live (#1169), unless
  // it keeps a level of its own (a thread exception). The private
  // per-thread grant still answers for a thread on the bot's provider.
  for (const [instanceId, model] of [["claude", "claude-sonnet-5"], ["codex", "gpt-6-astra"], ["grok-reads", "grok-4.6"], ["agy", "gemini-3.8-flash-high"]]) {
    const scoped = (await api("/api/bots", "POST", { name: "Existing thread", modelSelection: { instanceId, model } })).body.bot;
    await coordinator.request(child, scoped.id, "ask");
    const old = (await api(`/api/bots/${scoped.id}/tasks`, "POST", { title: "Existing Ask thread" })).body.task;
    const other = (await api(`/api/bots/${scoped.id}/tasks`, "POST", { title: "Leave this thread alone" })).body.task;
    assert.ok(old?.threadId && other?.threadId);
    await assert.rejects(coordinator.request(child, scoped.id, "full", { threadId: old.threadId }), /bot settings/);
    await coordinator.request(child, scoped.id, "full");
    const readScoped = async () => (await api("/api/bots?messages=0")).body.bots.find((bot) => bot.id === scoped.id);
    await until(async () => (await readScoped()).approvalMode === "full");
    if (instanceId === "claude") {
      assert.equal((await api(`/api/bots/${scoped.id}/tasks/${other.threadId}`, "PATCH", { approvalMode: "edits" })).status, 200);
      assert.equal((await api(`/api/bots/${scoped.id}/tasks/${other.threadId}`, "PATCH", { approvalMode: "ask", modelSelection: { instanceId: "codex", model: "gpt-6-astra" } })).status, 200);
      await assert.rejects(coordinator.request(child, scoped.id, "full", { threadId: other.threadId }), /bot's provider/);
      assert.equal((await api(`/api/bots/${scoped.id}/tasks/${other.threadId}`, "PATCH", { approvalMode: "edits" })).status, 400);
    }
    assert.equal(threadLevel(await readScoped(), old.threadId), "full");
    // Full on one thread needs no desktop channel either (omb #2701).
    assert.equal((await api(`/api/bots/${scoped.id}/tasks/${old.threadId}`, "PATCH", { approvalMode: "full" })).status, 200);
    if (instanceId === "codex") {
      assert.equal((await api(`/api/bots/${scoped.id}`, "PATCH", { approvalMode: "custom" })).status, 403);
      assert.equal((await api(`/api/bots/${scoped.id}/tasks/${old.threadId}`, "PATCH", { approvalMode: "custom" })).status, 403);
    }
    await coordinator.request(child, scoped.id, "full", { threadId: old.threadId });
    await until(async () => threadLevel(await readScoped(), old.threadId) === "full");
    // Setting the bot's level makes every thread follow it again, the
    // Claude case's other thread too, whose engine change had kept Ask
    // (#1169, store.patchBot).
    const otherLevel = "full";
    assert.equal(threadLevel(await readScoped(), other.threadId), otherLevel);
    await assert.rejects(coordinator.request(child, scoped.id, "full", { threadId: "missing-thread" }), /bot settings/);
    const grokPromptsBefore = grokPrompts().length;
    const sent = await api(`/api/bots/${scoped.id}/messages`, "POST", { text: "Verify existing thread Full", threadId: old.threadId });
    assert.equal(sent.status, 202);
    await until(async () => !(await readScoped()).tasks.find((task) => task.threadId === old.threadId).busy);
    const source = instanceId === "claude" ? dump : instanceId === "codex" ? codexDump : instanceId === "agy" ? agyDump : grokDump;
    const seen = JSON.parse(readFileSync(source, "utf8"));
    // Full keeps Sagax's broker (#1982): Claude runs Auto-accept edits with
    // its allowlist, Grok runs `default` under the approval gate, and Sagax
    // answers each residual request at Full.
    if (instanceId === "claude") assert.equal(seen.argv[seen.argv.indexOf("--permission-mode") + 1], "acceptEdits");
    if (instanceId === "grok-reads") { const argv = grokChatArgv(grokPromptsBefore); assert.equal(argv[argv.indexOf("--permission-mode") + 1], "default"); }
    // Codex Full: `never` for everything but MCP tool approvals (#1977).
    if (instanceId === "codex") assert.deepEqual(seen.calls.find((call) => call.method === "turn/start").params.approvalPolicy, { granular: { mcp_elicitations: true, rules: false, sandbox_approval: false, request_permissions: false, skill_approval: false } });
    console.log(JSON.stringify({ provider: instanceId, existingThread: "full", otherThread: otherLevel, privateGrant: true, turnSettled: true }));
  }
  const pendingCard = (bot) => bot.messages.find((message) => message.card?.requestId && !message.card.answered && !message.card.dismissed)?.card;
  // Composer grants are independent: an Ask default is not a prerequisite
  // trip through settings, and a thread may use a different provider.
  const direct = (await api("/api/bots", "POST", { name: "Composer scoped access", modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } })).body.bot;
  await coordinator.request(child, direct.id, "ask");
  const selected = (await api(`/api/bots/${direct.id}/tasks`, "POST", { title: "Select Full here" })).body.task;
  const sibling = (await api(`/api/bots/${direct.id}/tasks`, "POST", { title: "Keep Ask here" })).body.task;
  const committed = await coordinator.request(child, direct.id, "full", { threadId: selected.threadId, threadOnly: true });
  assert.equal(committed.approvalMode, "ask");
  assert.equal(threadLevel(committed, selected.threadId), "full");
  assert.equal(threadLevel(committed, sibling.threadId), "ask");
  await assert.rejects(coordinator.request(child, direct.id, "full", { threadId: "missing", threadOnly: true }), /existing thread/);
  await coordinator.request(child, direct.id, "ask", { threadId: selected.threadId, threadOnly: true });
  await api(`/api/bots/${direct.id}/tasks/${selected.threadId}`, "PATCH", { modelSelection: { instanceId: "codex", model: "gpt-6-astra" } });
  const custom = await coordinator.request(child, direct.id, "custom", { threadId: selected.threadId, threadOnly: true });
  assert.equal(custom.approvalMode, "ask");
  assert.equal(threadLevel(custom, selected.threadId), "custom");
  const downgraded = await coordinator.request(child, direct.id, "ask", { threadId: selected.threadId, threadOnly: true });
  assert.equal(threadLevel(downgraded, selected.threadId), "ask");
  assert.equal(downgraded.approvalMode, "ask");
  console.log(JSON.stringify({ composerGrant: true, defaultRemainsAsk: true, customOnDifferentThreadProvider: true, committedReply: true }));
  const parallel = (await api("/api/bots", "POST", { name: "Parallel permission fixture", modelSelection: { instanceId: "grok-delete", model: "grok-4.6" } })).body.bot;
  await coordinator.request(child, parallel.id, "ask");
  const working = (await api(`/api/bots/${parallel.id}/tasks`, "POST", { title: "Already running" })).body.task;
  const idle = (await api(`/api/bots/${parallel.id}/tasks`, "POST", { title: "Configure independently" })).body.task;
  assert.equal((await api(`/api/bots/${parallel.id}/tasks/${working.threadId}`, "POST")).status, 200);
  assert.equal((await api(`/api/bots/${parallel.id}/messages`, "POST", { text: "Hold for fixture approval", threadId: working.threadId })).status, 202);
  const held = await until(async () => pendingCard((await api("/api/bots")).body.bots.find(bot => bot.id === parallel.id)));
  const parallelModes = async () => (await api("/api/bots?messages=0")).body.bots.find(bot => bot.id === parallel.id).tasks.map(task => task.approvalMode ?? "follows");
  const modesBefore = await parallelModes();
  await assert.rejects(coordinator.request(child, parallel.id, "full", { allThreads: true }), /active turns/);
  assert.deepEqual(await parallelModes(), modesBefore);
  await assert.rejects(coordinator.request(child, parallel.id, "full", { threadId: working.threadId, threadOnly: true }), /Stop this thread/);
  const separate = await coordinator.request(child, parallel.id, "full", { threadId: idle.threadId, threadOnly: true });
  assert.equal(separate.tasks.find(task => task.threadId === working.threadId).busy, true);
  assert.equal(threadLevel(separate, working.threadId), "ask");
  assert.equal(threadLevel(separate, idle.threadId), "full");
  // The card is answered in its own conversation, as the app does
  // (src/state/store/dispatch-send.ts): the bot's selected thread is another.
  assert.equal((await api(`/api/threads/${working.threadId}/respond`, "POST", { requestId: held.requestId, behavior: "deny" })).body.outcome, "rejected");
  await until(async () => !(await api("/api/bots?messages=0")).body.bots.find(bot => bot.id === parallel.id).busy);
  console.log(JSON.stringify({ composerGrantWhileSiblingBusy: true, siblingNotInterrupted: true }));
  // The fake reviewer only approves the two known reads under native Auto.
  // Their actual MCP calls reach this real isolated server. This verifies the
  // routing contract, not the availability/quality of Grok's hosted reviewer.
  for (const model of ["grok-4.6", "grok-4.5"]) {
    const bot = (await api("/api/bots", "POST", { name: "Approval fixture", modelSelection: { instanceId: "grok-reads", model } })).body.bot;
    for (const [turn, mode] of ["auto", "auto", "ask"].entries()) {
      await coordinator.request(child, bot.id, mode);
      // The first thread follows the bot's level, live (#1169).
      assert.equal(threadLevel((await api("/api/bots?messages=0")).body.bots.find((candidate) => candidate.id === bot.id), bot.threadId), mode);
      const before = (await api("/api/bots")).body.bots.find((candidate) => candidate.id === bot.id).messages.length;
      const promptsBefore = grokPrompts().length;
      assert.equal((await api(`/api/bots/${bot.id}/messages`, "POST", { text: `Approval fixture ${model} ${mode}` })).status, 202);
      // Native Auto approves the two reads in the engine. Under Ask, Grok
      // Build asks about each MCP call, and the server answers these with
      // `sagax-internal` (#671): Sagax's own agents tools of the bot's scope
      // never produce a card, whatever the level.
      const settled = await until(async () => {
        const state = (await api("/api/bots")).body.bots.find((candidate) => candidate.id === bot.id);
        assert.equal(pendingCard(state), undefined, "Sagax's own reads must not produce an app approval");
        return !state.busy && state;
      });
      const text = settled.messages.slice(before).map((message) => message.text ?? "").join("\n");
      // The fixture emits one `<tool>: <result>` chunk per read, each at the
      // start of a line. Anchor on that: session_search now recalls the
      // previous turn's memory log, so its own result text quotes an earlier
      // "list_bots: Reachable teammates: …" mid-line and an unanchored count
      // sees three reads where the agent only performed two.
      assert.match(text, /^list_bots:/m);
      assert.match(text, /^session_search:/m);
      assert.equal((text.match(/^list_bots:/gm) ?? []).length, 2, "Repeated reads complete without another prompt");
      const argv = grokChatArgv(promptsBefore);
      // Under the approval gate (#1982) an Auto turn runs Grok in `default`
      // too: Sagax answers each ask, its own agents tools with no card.
      assert.equal(argv[argv.indexOf("--permission-mode") + 1], "default");
      assert.equal(argv[argv.indexOf("-m") + 1], model);
      // The same level keeps the live session; a new level gives the
      // integrations new credentials, so the conversation is loaded again.
      const methods = JSON.parse(readFileSync(grokRpc, "utf8"));
      assert.ok(methods.includes(turn < 2 ? "session/new" : "session/load"));
      if (turn < 2) assert.ok(!methods.includes("session/load"));
      console.log(JSON.stringify({ provider: "grok", model, mode, resumed: turn === 2, reviewedReads: mode === "auto", sagaxInternalNoCard: true, realAgentsMcp: true }));
    }
  }
  // A delete, a question and a command that reads a credential file keep
  // their card at Auto. The command is spelled as one of Sagax's own tools:
  // it is judged as the command it is, and its credential read keeps the
  // card at Auto (#3697).
  for (const instanceId of ["grok-delete", "grok-spoof", "grok-question"]) {
    const bot = (await api("/api/bots", "POST", { modelSelection: { instanceId, model: "grok-4.6" } })).body.bot;
    const level = "auto";
    await coordinator.request(child, bot.id, level);
    assert.equal((await api(`/api/bots/${bot.id}/messages`, "POST", { text: "Verify this action still needs a person" })).status, 202);
    const card = await until(async () => pendingCard((await api("/api/bots")).body.bots.find((candidate) => candidate.id === bot.id)));
    if (instanceId === "grok-question") assert.deepEqual(card.options, ["Blue", "Green"]);
    else if (instanceId === "grok-spoof") assert.equal(card.tool, "shell");
    else assert.equal(card.held, "The provider requires your approval for this action.");
    assert.equal((await api(`/api/bots/${bot.id}/respond`, "POST", { requestId: card.requestId, behavior: "deny" })).status, 200);
    await until(async () => !(await api("/api/bots?messages=0")).body.bots.find((candidate) => candidate.id === bot.id)?.busy);
    console.log(JSON.stringify({ provider: "grok", case: instanceId, mode: level, remainedInteractive: true }));
  }
  // request_credential is one of Sagax's own agents tools (#671): the engine's
  // permission prompt is answered `sagax-internal`, with no card. The person
  // still decides through the tool's own secure entry card, and the secret
  // never reaches the bot.
  {
    const bot = (await api("/api/bots", "POST", { modelSelection: { instanceId: "grok-credential", model: "grok-4.6" } })).body.bot;
    await coordinator.request(child, bot.id, "auto");
    const before = (await api("/api/bots")).body.bots.find((candidate) => candidate.id === bot.id).messages.length;
    assert.equal((await api(`/api/bots/${bot.id}/messages`, "POST", { text: "Ask for the credential through the secure flow" })).status, 202);
    const settled = await until(async () => {
      const state = (await api("/api/bots")).body.bots.find((candidate) => candidate.id === bot.id);
      assert.equal(pendingCard(state), undefined, "Sagax's own request_credential must not produce a provider approval card");
      return !state.busy && state;
    });
    assert.match(settled.messages.slice(before).map((message) => message.text ?? "").join("\n"), /handled the permission decision/);
    console.log(JSON.stringify({ provider: "grok", case: "grok-credential", mode: "auto", sagaxInternalNoCard: true }));
  }
  for (const model of ["gemini-3.8-flash-high", "gemini-3.8-flash-low"]) {
    const agyBot = (await api("/api/bots", "POST", { modelSelection: { instanceId: "agy", model } })).body.bot;
    // Full over HTTP is accepted (omb #2701); the loop sets each level
    // through the private channel the desktop app uses.
    assert.equal((await api(`/api/bots/${agyBot.id}`, "PATCH", { approvalMode: "full", acknowledgeFullAccess: true })).status, 200);
    assert.equal((await api(`/api/bots/${agyBot.id}`, "PATCH", { approvalMode: "ask" })).status, 200);
    for (const [turn, mode] of ["full", "full", "ask", "auto"].entries()) {
      await coordinator.request(child, agyBot.id, mode);
      await until(async () => (await api("/api/bots?messages=0")).body.bots.find((bot) => bot.id === agyBot.id)?.approvalMode === mode);
      // The first thread follows the bot's level, live (#1169).
      assert.equal(threadLevel((await api("/api/bots?messages=0")).body.bots.find((bot) => bot.id === agyBot.id), agyBot.threadId), mode);
      const before = (await api("/api/bots")).body.bots.find((bot) => bot.id === agyBot.id).messages.length;
      assert.equal((await api(`/api/bots/${agyBot.id}/messages`, "POST", { text: `Verify ${model} ${mode} turn ${turn}` })).status, 202);
      if (mode === "full") {
        const settled = await until(async () => {
          const bot = (await api("/api/bots")).body.bots.find((bot) => bot.id === agyBot.id);
          assert.equal(pendingCard(bot), undefined, "Full must answer residual tool permissions without a manual card");
          return !bot.busy && bot;
        });
        // What answered the ask rides the call's own row since 2026-10-28
        // (tool-auto-approval.ts), no "(full access)" row of its own: the
        // call ran, and the decision log below records Full access.
        assert.ok(settled.messages.slice(before).some((message) => message.kind === "activity" && message.tool?.ok === true));
        await until(async () => (await api("/api/decisions")).body.decisions.filter((row) => row.botId === agyBot.id && answeredByFull(row) && row.decision === "auto-approved").length === turn + 1);
      } else if (mode === "auto") {
        // Approve for me answers a call that is not destructive (#1934,
        // owner-approval.ts); a delete keeps its card (the Grok cases above).
        await until(async () => {
          const bot = (await api("/api/bots")).body.bots.find((bot) => bot.id === agyBot.id);
          assert.equal(pendingCard(bot), undefined, "Approve for me answers this command without a card");
          return !bot.busy;
        });
        await until(async () => (await api("/api/decisions")).body.decisions.some((row) => row.botId === agyBot.id && row.source === "owner-auto" && row.decision === "auto-approved"));
      } else {
        const card = await until(async () => pendingCard((await api("/api/bots")).body.bots.find((bot) => bot.id === agyBot.id)));
        assert.equal((await api(`/api/bots/${agyBot.id}/respond`, "POST", { requestId: card.requestId, behavior: "allow" })).status, 200);
        await until(async () => !(await api("/api/bots?messages=0")).body.bots.find((bot) => bot.id === agyBot.id)?.busy);
      }
      const native = mode === "full" ? "yolo" : "default";
      // One process serves every approval level of a conversation, so its
      // config log also holds earlier turns' switches. What counts is what
      // this turn's prompt ran under, which the fake records at the prompt.
      const prompted = lastPrompt();
      assert.equal(prompted.mode, native);
      assert.equal(prompted.model, model);
      const calls = JSON.parse(readFileSync(`${agyDump}.config.json`, "utf8"));
      assert.equal(calls.findLast((call) => call.params.configId === "mode")?.params.value, native);
      // The same level keeps the live session; a new level gives the
      // integrations new credentials, so the conversation is resumed.
      const rpc = JSON.parse(readFileSync(agyRpc, "utf8"));
      assert.ok(rpc.includes(turn < 2 ? "session/new" : "session/resume"));
      if (turn < 2) assert.ok(!rpc.includes("session/resume"));
      console.log(JSON.stringify({ provider: "antigravity", model, mode, native, resumed: turn >= 2, autoApproved: mode !== "ask", humanApproved: mode === "ask" }));
    }
  }
  const questionBot = (await api("/api/bots", "POST", { modelSelection: { instanceId: "agy-question", model: "gemini-3.8-flash-high" } })).body.bot;
  await coordinator.request(child, questionBot.id, "full");
  assert.equal((await api(`/api/bots/${questionBot.id}/messages`, "POST", { text: "Ask me a question under Full" })).status, 202);
  const question = await until(async () => pendingCard((await api("/api/bots")).body.bots.find((bot) => bot.id === questionBot.id)));
  assert.deepEqual(question.options, ["Blue", "Green"]);
  assert.equal((await api(`/api/bots/${questionBot.id}/respond`, "POST", { requestId: question.requestId, behavior: "answer", message: "Green" })).status, 200);
  await until(async () => !(await api("/api/bots?messages=0")).body.bots.find((bot) => bot.id === questionBot.id)?.busy);
  console.log(JSON.stringify({ provider: "antigravity", mode: "full", questionRemainedInteractive: true }));
  // The test-only capability drives the real peer dispatch route without
  // introducing another fake-agent workflow or weakening production auth.
  const peerTarget = (await api("/api/bots", "POST", { modelSelection: { instanceId: "agy", model: "gemini-3.8-flash-high" } })).body.bot;
  await coordinator.request(child, peerTarget.id, "ask");
  const peerThread = (await api(`/api/bots/${peerTarget.id}/tasks`, "POST", { title: "Unrelated selected conversation" })).body.task;
  await coordinator.request(child, peerTarget.id, "full");
  await coordinator.request(child, peerTarget.id, "full", { threadId: peerThread.threadId });
  assert.equal((await api(`/api/bots/${id}`, "PATCH", { approvePeerComms: false })).status, 200);
  // A chat turn's capability: coordinate_bots needs one (internal-bot-chat-handlers.ts).
  const capability = await api("/api/testing/internal-capability", "POST", { botId: id, threadId: created.body.bot.threadId, roomCoordination: true }, { "x-openmausbot-test-capability": testCapabilityKey });
  assert.equal(capability.status, 201);
  const peerResponse = await api("/api/internal/coordinate-bots", "POST", { botIds: [peerTarget.id], message: "Peer-initiated permission fixture", consult: true }, { authorization: `Bearer ${capability.body.token}` });
  assert.equal(peerResponse.status, 200);
  // Coordination opens its own work thread without selecting it in the UI.
  const peerWorkThreadId = peerResponse.body.receipts[0].threadId;
  assert.ok(peerWorkThreadId);
  assert.notEqual(peerWorkThreadId, peerThread.threadId);
  const peerDecisions = await until(async () => {
    const rows = (await api("/api/decisions")).body.decisions.filter((row) => row.botId === peerTarget.id && row.threadId === peerWorkThreadId);
    return rows.some(answeredByFull) && rows;
  });
  await until(async () => (await api("/api/bots?messages=0")).body.bots.find((bot) => bot.id === peerTarget.id)
    .tasks.find((task) => task.threadId === peerWorkThreadId)?.busy === false);
  assert.ok(!pendingCard((await api(`/api/threads/${peerWorkThreadId}/messages`)).body));
  assert.ok(!peerDecisions.some((row) => row.decision === "card-shown"));
  assert.equal(lastPrompt().mode, "yolo");
  console.log(JSON.stringify({ provider: "antigravity", mode: "full", peerInitiated: true, native: "yolo", autoApproved: true, humanApproved: false }));

  // Revoking the receiving thread's grant must restore prompts on the resumed
  // delegated session, even when the sender itself has Full access.
  await coordinator.request(child, id, "full");
  await coordinator.request(child, peerTarget.id, "ask");
  assert.equal((await api(`/api/bots/${peerTarget.id}/tasks/${peerWorkThreadId}`, "PATCH", { approvalMode: "ask" })).status, 200);
  const revokedPeer = (await api("/api/bots?messages=0")).body.bots.find((bot) => bot.id === peerTarget.id);
  assert.equal(threadLevel(revokedPeer, peerWorkThreadId), "ask");
  // Every thread follows its bot back to Ask (#1169), the selected one too.
  assert.equal(threadLevel(revokedPeer, peerThread.threadId), "ask");
  // The same teammate already finished this root's first request: more
  // work on it says so (rework), or it is taken for an acknowledgement.
  const askPeerResponse = await api("/api/internal/coordinate-bots", "POST", { botIds: [peerTarget.id], message: "Ask target must not inherit sender Full", consult: true, rework: true }, { authorization: `Bearer ${capability.body.token}` });
  assert.equal(askPeerResponse.status, 200);
  assert.equal(askPeerResponse.body.receipts[0].threadId, peerWorkThreadId);
  const peerCard = await until(async () => pendingCard((await api(`/api/threads/${peerWorkThreadId}/messages`)).body));
  assert.equal(lastPrompt().mode, "default");
  const askDecision = (await api("/api/decisions")).body.decisions.find((row) => row.threadId === peerWorkThreadId && row.requestId === peerCard.requestId);
  assert.equal(askDecision.decision, "card-shown");
  assert.ok(!answeredByFull(askDecision));
  assert.equal((await api(`/api/threads/${peerWorkThreadId}/respond`, "POST", { requestId: peerCard.requestId, behavior: "allow" })).status, 200);
  await until(async () => (await api("/api/bots?messages=0")).body.bots.find((bot) => bot.id === peerTarget.id)
    .tasks.find((task) => task.threadId === peerWorkThreadId)?.busy === false);
  console.log(JSON.stringify({ provider: "antigravity", mode: "ask", senderMode: "full", peerInitiated: true, native: "default", humanApproved: true }));

  // Custom is downgraded for delegated turns. Both the provider dispatch and
  // the residual approval fold must use that same effective Auto mode.
  const customTarget = (await api("/api/bots", "POST", { modelSelection: { instanceId: "codex", model: "gpt-fake-default" } })).body.bot;
  await coordinator.request(child, customTarget.id, "custom");
  const customResponse = await api("/api/internal/coordinate-bots", "POST", { botIds: [customTarget.id], message: "Delegated Custom uses the native Auto reviewer", consult: true }, { authorization: `Bearer ${capability.body.token}` });
  assert.equal(customResponse.status, 200);
  const customThreadId = customResponse.body.receipts[0].threadId;
  assert.ok(customThreadId);
  assert.notEqual(customThreadId, customTarget.threadId);
  const customCard = await until(async () => pendingCard((await api(`/api/threads/${customThreadId}/messages`)).body));
  assert.equal(customCard.held, "The provider requires your approval for this action.");
  assert.equal((await api(`/api/threads/${customThreadId}/respond`, "POST", { requestId: customCard.requestId, behavior: "allow" })).status, 200);
  await until(async () => (await api("/api/bots?messages=0")).body.bots.find((bot) => bot.id === customTarget.id)
    .tasks.find((task) => task.threadId === customThreadId)?.busy === false);
  const customCalls = JSON.parse(readFileSync(codexDump, "utf8")).calls;
  assert.equal(customCalls.find((call) => call.method === "turn/start")?.params.approvalsReviewer, "auto_review");
  console.log(JSON.stringify({ provider: "codex", mode: "custom", peerInitiated: true, effectiveMode: "auto", nativeApprovalShown: true }));
  if (process.argv.includes("--ui")) {
    await verifyUi();
    await require("./testing/sidebar-attention-ui-smoke.cjs")({ root, url: `http://127.0.0.1:${port}`, api, until });
  }
  console.log("Approval smoke passed; Custom over HTTP rejected, private grant and resumed mode transitions verified.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (child?.pid) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
  rmSync(home, { recursive: true, force: true });
  app.exit(process.exitCode || 0);
});
