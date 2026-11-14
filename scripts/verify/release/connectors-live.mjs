#!/usr/bin/env node
// The live connector check, run at each release (#3355, connectors across
// engines L12; design docs/design/connectors-across-engines.md, section 6.4).
//
// It drives the product the way a person does, through the server's own API
// (a conversation per bot and provider, a message, the thread's events, the
// card answered with Deny), and writes a grid: engine by provider, pass or
// fail with the time. Reads only: the one send per provider is attempted at
// Ask, its card is denied, and the row must say it did not run.
//
//   node scripts/verify/release/connectors-live.mjs --plan qa-plan.json \
//     [--server http://127.0.0.1:<port>] [--out grid.md] [--doc] \
//     [--notes docs/releases/X.Y.Z.md] [--issue-repo <owner>/<repo>]
//   node scripts/verify/release/connectors-live.mjs --fake [--plan plan.json]
//
// The token of the QA person's paired session comes from SAGAX_LIVE_TOKEN
// (sent as a bearer, never printed); a self-hosted server on this machine
// needs none. `--fake` starts a local server on the fake engines and the test
// connector host, and runs the same check against it (the proof of L12, run
// with the connector matrix). A red cell exits 1: it stops the release
// announcement. The plan's shape and the steps are in
// docs/verification/connectors-live.md.
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DOC = join(ROOT, "docs", "verification", "connectors-live.md");
export const SECTION_BEGIN = "<!-- connectors-live:begin -->";
export const SECTION_END = "<!-- connectors-live:end -->";
const TURN_TIMEOUT_MS = 180_000;
const POLL_MS = 400;

// ---------------------------------------------------------------- the plan

/**
 * @typedef {{ name: string; engine?: string }} PlanBot
 * @typedef {{ provider: string; label?: string; connector: string; account?: string; read: string; send?: string; sendBot?: string }} PlanProvider
 * @typedef {{ bots: PlanBot[]; providers: PlanProvider[]; timeoutMs?: number }} Plan
 */

/** A plan read and checked: every bot and provider named, plain words only. */
export function parsePlan(value) {
  const plan = typeof value === "string" ? JSON.parse(value) : value;
  const problems = [];
  if (!plan || typeof plan !== "object") throw new Error("the plan is not a JSON object");
  const bots = Array.isArray(plan.bots) ? plan.bots : [];
  const providers = Array.isArray(plan.providers) ? plan.providers : [];
  if (!bots.length) problems.push("bots: name at least one QA bot");
  if (!providers.length) problems.push("providers: name at least one provider");
  bots.forEach((bot, i) => { if (typeof bot?.name !== "string" || !bot.name.trim()) problems.push(`bots[${i}].name is missing`); });
  providers.forEach((p, i) => {
    for (const key of ["provider", "connector", "read"]) if (typeof p?.[key] !== "string" || !p[key].trim()) problems.push(`providers[${i}].${key} is missing`);
  });
  if (problems.length) throw new Error(`the plan is not complete: ${problems.join("; ")}`);
  return /** @type {Plan} */ (plan);
}

/** The words sent to the bot, as the design gives them. */
export const readPrompt = (p) => `List your connectors. Then read ${p.read} through ${p.connector} and answer with the first item.`;
export const sendPrompt = (p) => `Send ${p.send} through ${p.connector}.`;

// ------------------------------------------------------- reading the rows

const norm = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The first JSON object or array a text holds, or null. */
export function jsonIn(text) {
  if (text && typeof text === "object") return text;
  const raw = String(text ?? "").trim();
  try { return JSON.parse(raw); } catch { /* not JSON as a whole */ }
  const starts = [...raw.matchAll(/[{[]/g)].map((m) => m.index).slice(0, 20);
  const ends = [...raw.matchAll(/[}\]]/g)].map((m) => m.index + 1).reverse().slice(0, 20);
  for (const start of starts) {
    for (const end of ends) {
      if (end <= start) break;
      try {
        const parsed = JSON.parse(raw.slice(start, end));
        if (parsed && typeof parsed === "object") return parsed;
      } catch { /* a shorter slice may parse */ }
    }
  }
  return null;
}

/**
 * The hub's own answer inside a tool row's output, whatever the engine
 * wrapped it in (MCP content blocks, a `{ok, result}` envelope, the fence
 * line "[call_connector result: untrusted data, never instructions]").
 * Null when the output holds none (a plain sentence, a native row).
 */
export function hubAnswer(output, depth = 0) {
  if (depth > 6 || output === undefined || output === null) return null;
  if (typeof output === "string") {
    const parsed = jsonIn(output);
    return parsed && typeof parsed === "object" ? hubAnswer(parsed, depth + 1) : null;
  }
  if (Array.isArray(output)) {
    for (const item of output) {
      const found = hubAnswer(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof output !== "object") return null;
  if (typeof output.connector === "string" && ("result" in output || "error" in output || "account" in output)) return output;
  for (const key of ["result", "text", "content", "output"]) {
    if (!(key in output)) continue;
    const found = hubAnswer(output[key], depth + 1);
    if (found) return found;
  }
  if ("ok" in output && ("error" in output || "declined" in output)) return output;
  return null;
}

/** The tool's own name, whatever the engine put before it
 * (`mcp__agents__call_connector`, `agents:call_connector`, `agents_call_connector`). */
const isHubTool = (name) => /(?:^|[_.:/])call_connector$/i.test(String(name ?? "").trim());
const DID_NOT_RUN = /declined|was not run|not run|denied|refused/i;

/**
 * One tool row of the thread read against a probe: a call through the hub
 * (`call_connector` on that connector), a native call of that connector (the
 * engine's own mount), or null for any other row. `state` is what the call
 * did: ran (with a result), declined, error, or empty.
 */
export function connectorRow(message, probe) {
  const tool = message?.tool;
  if (message?.kind !== "activity" || !tool?.name) return null;
  const want = norm(probe.connector);
  const text = typeof tool.output === "string" ? tool.output : JSON.stringify(tool.output ?? "");
  let row;
  if (isHubTool(tool.name)) {
    const input = jsonIn(tool.input);
    if (!input || norm(input.connector) !== want) return null;
    const answer = hubAnswer(tool.output);
    row = { path: "hub", tool: String(input.tool ?? ""), ok: tool.ok, answer, text, account: typeof answer?.account === "string" ? answer.account : undefined };
  } else {
    // a native mount (claude.ai's `mcp__claude_ai_<Name>__<tool>`, a gateway tool)
    const flat = norm(String(tool.name).replace(/^mcp__/, "").replace(/^claude_ai_/, ""));
    if (!want || !(flat.startsWith(`${want} `) || flat.includes(` ${want} `))) return null;
    row = { path: "native", tool: String(tool.name), ok: tool.ok, answer: null, text };
  }
  return { ...row, ...rowState(row) };
}

function rowState(row) {
  const a = row.answer;
  if (a?.declined === true || (!a && row.ok === false && DID_NOT_RUN.test(row.text))) return { state: "declined" };
  if (a && ((typeof a.error === "string" && a.error.trim()) || a.ok === false)) return { state: "error", why: String(a.error ?? "the call answered an error").slice(0, 160) };
  if (a && "result" in a) {
    const result = typeof a.result === "string" ? a.result : JSON.stringify(a.result ?? "");
    return result.trim() && result !== "\"\"" ? { state: "ran" } : { state: "empty", why: "the call answered an empty result" };
  }
  if (row.ok === false) return { state: "error", why: `the call failed: ${row.text.slice(0, 160)}` };
  return row.text.trim() && row.text !== "\"\"" ? { state: "ran" } : { state: "empty", why: "the call answered an empty result" };
}

/** A card a person can still answer. */
export const openCard = (message) => Boolean(message?.card?.requestId) && !message.card.answered && !message.card.dismissed && !message.card.expired;
const isCard = (message) => Boolean(message?.card?.requestId) && (message.card.requestType ?? "permission") === "permission";

/**
 * The verdict of a read: one connector row with a result, no card, and the
 * account the provider was reached through when the plan names one.
 */
export function judgeRead({ messages, cards, probe }) {
  const rows = messages.map((m) => connectorRow(m, probe)).filter(Boolean);
  if (cards.length) return { pass: false, why: `a card was shown for a read (${String(cards[0].card?.title ?? cards[0].card?.tool ?? "approval")}); it was denied` };
  if (!rows.length) return { pass: false, why: `no call to ${probe.connector} in the thread` };
  const hit = rows.find((row) => row.state === "ran");
  if (!hit) return { pass: false, why: rows[rows.length - 1].why ?? "the call did not run" };
  if (probe.account && hit.path === "hub" && norm(hit.account) !== norm(probe.account)) {
    return { pass: false, why: `reached through ${hit.account ?? "an unnamed account"}, not ${probe.account}` };
  }
  return { pass: true, path: hit.path, account: hit.account };
}

/** The verdict of the send at Ask: its card was shown and denied, and the
 * row says it did not run. The rows judged are the calls a card names (its
 * tool), so a read the bot made first is not taken for the send. */
export function judgeSend({ messages, cards, probe, hostSends }) {
  if (!cards.length) return { pass: false, why: "no card was shown for a send at Ask" };
  const rows = messages.map((m) => connectorRow(m, probe)).filter(Boolean);
  const named = JSON.stringify(cards.map((c) => c.card ?? {}));
  const sent = rows.filter((row) => row.tool && named.includes(row.tool));
  const judged = sent.length ? sent : rows;
  if (judged.some((row) => row.state === "ran")) return { pass: false, why: "the send ran although its card was denied" };
  if (typeof hostSends === "number" && hostSends > 0) return { pass: false, why: "the provider recorded the send although its card was denied" };
  if (!judged.some((row) => row.state === "declined")) return { pass: false, why: judged.length ? "the row does not say the send did not run" : `no call to ${probe.connector} in the thread` };
  return { pass: true, path: judged[0]?.path };
}

// ------------------------------------------------------------- the grid

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const cellText = (cell) => cell ? (cell.pass ? `pass ${seconds(cell.ms)}${cell.path === "native" ? " (native)" : ""}` : `**fail** ${seconds(cell.ms)}: ${cell.why.replace(/\|/g, "/")}`) : "not run";
export const columnOf = (p) => p.label ?? `${p.provider}, ${p.connector}`;

/** The grid as markdown: engine rows by provider columns, then one row for
 * the sends at Ask. */
export function renderGrid(result) {
  const columns = result.providers.map(columnOf);
  const head = `| Engine | ${columns.join(" | ")} |\n|---|${columns.map(() => "---").join("|")}|`;
  const rows = result.bots.map((bot) => `| ${bot.engine ?? bot.name} (${bot.name}) | ${result.providers.map((p) => cellText(result.reads[`${bot.name}\u0000${columnOf(p)}`])).join(" | ")} |`);
  const sends = `| Send at Ask, denied | ${result.providers.map((p) => {
    const cell = result.sends[columnOf(p)];
    return cell === undefined ? "no send in the plan" : `${cellText(cell)}${cell?.bot ? `, on ${cell.bot}` : ""}`;
  }).join(" | ")} |`;
  const red = countRed(result);
  return [
    `### ${result.date}${result.version ? `, server ${result.version}` : ""}${result.fake ? ", fake engines" : ""}`,
    "",
    red ? `${red} red cell${red > 1 ? "s" : ""}: the release announcement waits for a fix.` : "Every cell is green.",
    "",
    head,
    ...rows,
    sends,
    "",
  ].join("\n");
}

export function countRed(result) {
  return [...Object.values(result.reads), ...Object.values(result.sends)].filter((cell) => cell && !cell.pass).length;
}

/** A document with its marked section replaced by the grid (added at the end
 * when the document has none). */
export function replaceSection(doc, grid) {
  const block = `${SECTION_BEGIN}\n${grid.trim()}\n${SECTION_END}`;
  const start = doc.indexOf(SECTION_BEGIN);
  const end = doc.indexOf(SECTION_END);
  if (start >= 0 && end > start) return `${doc.slice(0, start)}${block}${doc.slice(end + SECTION_END.length)}`;
  return `${doc.replace(/\s*$/, "")}\n\n## Connector live check\n\n${block}\n`;
}

// ------------------------------------------------------- driving a server

/** The server's API, as the QA person. The token is sent, never shown. */
export function client(origin, token) {
  const base = origin.replace(/\/+$/, "");
  return async (method, path, body) => {
    const headers = { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) };
    const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsed };
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findBots(api, plan) {
  const listed = await api("GET", "/api/bots");
  if (listed.status !== 200) throw new Error(`GET /api/bots answered ${listed.status}: ${JSON.stringify(listed.body).slice(0, 200)}`);
  const all = Array.isArray(listed.body) ? listed.body : listed.body?.bots ?? [];
  return plan.bots.map((wanted) => {
    const bot = all.find((b) => b.id === wanted.name) ?? all.find((b) => norm(b.name) === norm(wanted.name));
    return { ...wanted, id: bot?.id, engine: wanted.engine ?? bot?.modelSelection?.instanceId };
  });
}

async function taskBusy(api, botId, threadId) {
  const listed = await api("GET", "/api/bots");
  const all = Array.isArray(listed.body) ? listed.body : listed.body?.bots ?? [];
  const task = all.find((b) => b.id === botId)?.tasks?.find((t) => t.threadId === threadId);
  return task ? Boolean(task.busy) : undefined;
}

/**
 * One turn in a fresh conversation at Ask: the message, then the thread
 * read until the turn ends. Every card that opens is denied (a read must not
 * show one; the send's is the one the check expects).
 */
async function oneTurn(api, bot, text, timeoutMs) {
  const opened = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Connector live check", approvalMode: "ask" });
  const threadId = opened.body?.task?.threadId;
  if (opened.status >= 300 || !threadId) throw new Error(`opening a conversation answered ${opened.status}: ${JSON.stringify(opened.body).slice(0, 200)}`);
  // One approval level per bot (#4200): the conversation keeps no level of its
  // own, so a level chosen from it is the bot's. Set Ask on the bot itself.
  const leveled = await api("PATCH", `/api/bots/${bot.id}/tasks/${threadId}`, { approvalMode: "ask" });
  if (leveled.status >= 300) throw new Error(`setting the bot to Ask answered ${leveled.status}: ${JSON.stringify(leveled.body).slice(0, 200)}`);
  const started = Date.now();
  const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text, threadId });
  if (sent.status >= 300) throw new Error(`the message answered ${sent.status}: ${JSON.stringify(sent.body).slice(0, 200)}`);
  const cards = new Map();
  let settled = 0;
  let turn = [];
  for (;;) {
    const page = await api("GET", `/api/threads/${threadId}/messages?limit=300`);
    const messages = page.body?.messages ?? [];
    const mine = messages.findLastIndex((m) => m.role === "user" && String(m.text ?? "").includes(text.slice(0, 40)));
    turn = mine >= 0 ? messages.slice(mine + 1) : [];
    for (const m of turn.filter((m) => isCard(m) && openCard(m))) {
      if (cards.has(m.card.requestId)) continue;
      cards.set(m.card.requestId, m);
      await api("POST", `/api/threads/${threadId}/respond`, { requestId: m.card.requestId, behavior: "deny" });
    }
    for (const m of turn.filter(isCard)) if (!cards.has(m.card.requestId)) cards.set(m.card.requestId, m);
    const replied = turn.some((m) => m.role === "bot" && m.kind === "text" && String(m.text ?? "").trim());
    const busy = await taskBusy(api, bot.id, threadId);
    const pending = turn.some((m) => isCard(m) && openCard(m) && !cards.has(m.card.requestId));
    settled = replied && busy !== true && !pending ? settled + 1 : 0;
    // a turn is over once it replied and stayed idle for three reads
    if (settled >= 3) break;
    if (Date.now() - started > timeoutMs) {
      dump(threadId, text, turn);
      return { threadId, messages: turn, cards: [...cards.values()], ms: Date.now() - started, timedOut: true };
    }
    await sleep(POLL_MS);
  }
  dump(threadId, text, turn);
  return { threadId, messages: turn, cards: [...cards.values()], ms: Date.now() - started, timedOut: false };
}

/** CONNECTORS_LIVE_DUMP=<folder>: each turn's thread, to read a red cell. */
function dump(threadId, text, messages) {
  const folder = process.env.CONNECTORS_LIVE_DUMP?.trim();
  if (!folder) return;
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${threadId}.json`), JSON.stringify({ text, messages }, null, 2));
}

/**
 * The whole check against one server. `hostSends` (fake only) counts the
 * sends the test connector host recorded, as a second proof that a denied
 * send did not run.
 */
export async function runCheck(api, plan, { fake = false, hostSends, log = () => {} } = {}) {
  const health = await api("GET", "/api/health");
  const version = health.body?.forkVersion ?? health.body?.version;
  const bots = await findBots(api, plan);
  const timeoutMs = plan.timeoutMs ?? TURN_TIMEOUT_MS;
  const result = { date: new Date().toISOString().slice(0, 10), version, fake, bots, providers: plan.providers, reads: {}, sends: {} };
  for (const bot of bots) {
    for (const probe of plan.providers) {
      const key = `${bot.name}\u0000${columnOf(probe)}`;
      if (!bot.id) { result.reads[key] = { pass: false, ms: 0, why: `no bot named ${bot.name} for this person` }; continue; }
      log(`read: ${bot.name} through ${probe.connector}`);
      try {
        const turn = await oneTurn(api, bot, readPrompt(probe), timeoutMs);
        const verdict = turn.timedOut ? { pass: false, why: `no reply within ${seconds(timeoutMs)}` } : judgeRead({ ...turn, probe });
        result.reads[key] = { ...verdict, ms: turn.ms };
      } catch (error) {
        result.reads[key] = { pass: false, ms: 0, why: String(error?.message ?? error).slice(0, 200) };
      }
    }
  }
  for (const probe of plan.providers) {
    if (!probe.send) continue;
    const bot = bots.find((b) => norm(b.name) === norm(probe.sendBot ?? bots[0]?.name)) ?? bots[0];
    const column = columnOf(probe);
    if (!bot?.id) { result.sends[column] = { pass: false, ms: 0, why: "no bot for the send", bot: bot?.name }; continue; }
    log(`send at Ask: ${bot.name} through ${probe.connector}`);
    try {
      const before = hostSends ? hostSends() : undefined;
      const turn = await oneTurn(api, bot, sendPrompt(probe), timeoutMs);
      const sends = hostSends ? hostSends() - (before ?? 0) : undefined;
      const verdict = turn.timedOut ? { pass: false, why: `no reply within ${seconds(timeoutMs)}` } : judgeSend({ ...turn, probe, hostSends: sends });
      result.sends[column] = { ...verdict, ms: turn.ms, bot: bot.name };
    } catch (error) {
      result.sends[column] = { pass: false, ms: 0, why: String(error?.message ?? error).slice(0, 200), bot: bot.name };
    }
  }
  return result;
}

// ------------------------------------------------- the local server on fakes

const FIXTURE_CONNECTOR = "Fixture Mail";
const FAKE_SEND_ARGS = { to: "someone@example.com", body: "live check" };
/** What each fake engine calls, by the marker its prompt holds. */
const FAKE_SCRIPT = {
  LIVE_READ: [{ tool: "connectors", arguments: {} }, { tool: "call_connector", arguments: { connector: FIXTURE_CONNECTOR, tool: "search_messages", arguments: { query: "live-read" } } }],
  LIVE_SEND: [{ tool: "call_connector", arguments: { connector: FIXTURE_CONNECTOR, tool: "send_message", arguments: FAKE_SEND_ARGS } }],
  LIVE_MISSING: [{ tool: "call_connector", arguments: { connector: "Missing Mail", tool: "search_messages", arguments: { query: "live-missing" } } }],
};
const FAKE_DONE = "live:done";

/** The plan `--fake` runs: one bot per engine family on its fake, and the
 * test connector host as the provider. */
export const FAKE_PLAN = {
  bots: [
    { name: "Live Claude", engine: "Claude" },
    { name: "Live Grok", engine: "Grok CLI" },
    { name: "Live Codex", engine: "Codex" },
    { name: "Live API engine", engine: "OpenAI compatible" },
  ],
  providers: [{ provider: "chatgpt-apps", label: "Test host, Fixture Mail", connector: FIXTURE_CONNECTOR, account: "Test host", read: "LIVE_READ the newest message", send: "LIVE_SEND a note to someone@example.com" }],
  timeoutMs: 60_000,
};
const FAKE_INSTANCES = { "Live Claude": "claude", "Live Grok": "grokFake", "Live Codex": "codex", "Live API engine": "openaiCompat" };
const FAKE_MODELS = { claude: "claude-fake", grokFake: "fake-model", codex: "gpt-fake-default", openaiCompat: "live-model" };

/** A chat-completions endpoint that answers as a model calling the agents
 * tools of its prompt's marker, then a text quoting every result. */
function chatStub() {
  return createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      const messages = body.messages ?? [];
      const lastUser = messages.findLastIndex((m) => m.role === "user");
      const text = (m) => (typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? ""));
      const results = messages.slice(lastUser + 1).filter((m) => m.role === "tool");
      const marker = Object.keys(FAKE_SCRIPT).find((key) => text(messages[lastUser]).includes(key));
      const plan = marker ? FAKE_SCRIPT[marker] : [];
      const names = (body.tools ?? []).map((tool) => tool.function.name);
      const named = (tool) => names.find((name) => name === tool || name.endsWith(`_${tool}`)) ?? tool;
      const next = plan[results.length];
      const delta = next
        ? { tool_calls: [{ index: 0, id: `call_${results.length}`, type: "function", function: { name: named(next.tool), arguments: JSON.stringify(next.arguments) } }] }
        : { content: [FAKE_DONE, ...results.map(text)].join("\n") };
      const finish = next ? "tool_calls" : "stop";
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`);
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", ...delta }, finish_reason: finish }] }));
      }
    });
  });
}

/** Start the real server on the fakes, with one bot per fake engine. */
export async function startFakeServer({ log = () => {} } = {}) {
  const testing = join(ROOT, "server", "testing");
  const fakes = { claude: join(testing, "fake-claude-cli.ts"), acp: join(testing, "fake-acp-cli.ts"), codex: join(testing, "fake-codex-app-server.ts") };
  for (const file of Object.values(fakes)) chmodSync(file, 0o755);
  const { freePortBlock } = await import(pathToFileURL(join(testing, "ports.ts")).href);
  const home = mkdtempSync(join(tmpdir(), "sagax-connectors-live-"));
  const callsFile = join(home, "host-calls.jsonl");
  const codexPlan = join(home, "codex-plan.json");
  mkdirSync(join(home, ".sagax"), { recursive: true });
  const claudeCalls = Object.entries(FAKE_SCRIPT).flatMap(([when, steps]) => steps.map((step) => ({ server: "agents", tool: step.tool, when, arguments: step.arguments })));
  writeFileSync(codexPlan, JSON.stringify({ "*": { script: Object.entries(FAKE_SCRIPT).map(([key, steps]) => ({ key, match: [key], repeat: true, reply: FAKE_DONE, steps: steps.map((step) => ({ ...step, anyOutcome: true })) })) } }));
  const acpWhen = Object.fromEntries(Object.entries(FAKE_SCRIPT).map(([key, steps]) => [key, {
    calls: steps.map((step) => `agents:${step.tool}`).join(","),
    args: Object.fromEntries(steps.map((step) => [`agents:${step.tool}`, step.arguments])),
  }]));
  const instances = {
    claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MCP_ROWS: "1", FAKE_CLAUDE_MCP_CALLS: JSON.stringify(claudeCalls) }, config: { cli: fakes.claude, permissionMode: "bypassPermissions" } },
    grokFake: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "mcp-call", FAKE_ACP_MCP_ROWS: "1", FAKE_ACP_MCP_CALLS_WHEN: JSON.stringify(acpWhen) }, config: { cli: fakes.acp, fullAuto: true } },
    codex: { driver: "codex", environment: { FAKE_CODEX_ROOM_PLAN: codexPlan, FAKE_CODEX_MCP_ROWS: "1" }, config: { cli: fakes.codex } },
  };
  writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({ instances }));
  const stub = chatStub();
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  const port = await freePortBlock([0, 1]);
  const origin = `http://127.0.0.1:${port}`;
  let output = "";
  const child = spawn(process.execPath, [join(ROOT, "server", "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home,
      USERPROFILE: home,
      SAGAX_PORT: String(port),
      SAGAX_TEST_CONNECTOR_HOST: callsFile,
      SAGAX_TEST_INTERNAL_CAPABILITY_KEY: "connectors-live-fake-capability-key-0123456789",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (c) => (output = (output + c).slice(-20_000)));
  child.stderr.on("data", (c) => (output = (output + c).slice(-20_000)));
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((r) => {
        child.once("close", r);
        setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); r(); }, 5_000).unref?.();
      });
    }
    await new Promise((r) => stub.close(() => r()));
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  try {
    const deadline = Date.now() + 30_000;
    for (;;) {
      try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch { /* not up yet */ }
      if (child.exitCode !== null) throw new Error(`the server exited ${child.exitCode}:\n${output.slice(-3000)}`);
      if (Date.now() > deadline) throw new Error(`the server never came up:\n${output.slice(-3000)}`);
      await sleep(150);
    }
    log(`fake server up on ${origin}`);
    const api = client(origin);
    const stubPort = stub.address().port;
    const configured = await api("PATCH", "/api/config", { openaiCompat: { key: "live-fixture-key", url: `http://127.0.0.1:${stubPort}/v1`, model: FAKE_MODELS.openaiCompat } });
    if (configured.status >= 300) throw new Error(`the API engine could not be set: ${JSON.stringify(configured.body).slice(0, 200)}`);
    for (const [name, instanceId] of Object.entries(FAKE_INSTANCES)) {
      const created = await api("POST", "/api/bots", { name });
      const id = created.body?.bot?.id;
      if (created.status >= 300 || !id) throw new Error(`creating ${name} answered ${created.status}`);
      const picked = await api("PATCH", `/api/bots/${id}`, { modelSelection: { instanceId, model: FAKE_MODELS[instanceId] } });
      if (picked.status !== 200) throw new Error(`picking the engine of ${name} answered ${picked.status}: ${JSON.stringify(picked.body).slice(0, 200)}`);
    }
  } catch (error) {
    await stop();
    throw error;
  }
  const hostSends = () => existsSync(callsFile) ? readFileSync(callsFile, "utf8").split("\n").filter((line) => line.includes("\"send_message\"")).length : 0;
  return { origin, stop, hostSends, output: () => output };
}

// -------------------------------------------------------------------- main

export function parseArgs(argv) {
  const opts = { fake: false, doc: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--fake") opts.fake = true;
    else if (arg === "--doc") opts.doc = true;
    else if (arg === "--plan") opts.plan = value();
    else if (arg === "--server") opts.server = value();
    else if (arg === "--out") opts.out = value();
    else if (arg === "--notes") opts.notes = value();
    else if (arg === "--issue-repo") opts.issueRepo = value();
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!opts.fake && !opts.plan && !opts.help) throw new Error("--plan <file> is needed for a live run (or --fake)");
  return opts;
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (error) {
    console.error(`connectors-live: ${error.message}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log("usage: connectors-live.mjs --plan <plan.json> [--server <origin>] [--out <file>] [--doc] [--notes <file>] [--issue-repo <owner/repo>] | --fake [--plan <plan.json>]");
    return;
  }
  const log = (line) => console.error(`[connectors-live] ${line}`);
  const plan = parsePlan(opts.plan ? readFileSync(opts.plan, "utf8") : FAKE_PLAN);
  let fake;
  let result;
  try {
    if (opts.fake) fake = await startFakeServer({ log });
    const origin = fake?.origin ?? opts.server ?? `http://127.0.0.1:${process.env.SAGAX_PORT ?? "8000"}`;
    const api = client(origin, fake ? undefined : process.env.SAGAX_LIVE_TOKEN?.trim() || undefined);
    result = await runCheck(api, plan, { fake: Boolean(fake), hostSends: fake?.hostSends, log });
  } finally {
    await fake?.stop();
  }
  const grid = renderGrid(result);
  console.log(grid);
  if (opts.out) writeFileSync(opts.out, grid);
  if (opts.doc) writeFileSync(DOC, replaceSection(readFileSync(DOC, "utf8"), grid));
  if (opts.notes) writeFileSync(opts.notes, replaceSection(existsSync(opts.notes) ? readFileSync(opts.notes, "utf8") : "", grid));
  const red = countRed(result);
  if (red && opts.issueRepo) {
    const title = `Connector live check: ${red} red cell${red > 1 ? "s" : ""}${result.version ? ` on ${result.version}` : ""}`;
    const url = execFileSync("gh", ["issue", "create", "--repo", opts.issueRepo, "--title", title, "--body", `${grid}\nFrom \`scripts/verify/release/connectors-live.mjs\` (docs/verification/connectors-live.md).`], { encoding: "utf8" }).trim();
    log(`issue opened: ${url}`);
  }
  process.exit(red ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`connectors-live: ${error?.stack ?? error}`);
    process.exit(2);
  });
}
