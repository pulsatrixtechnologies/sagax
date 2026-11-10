// The connector matrix (#3354, connectors across engines L11; design
// docs/design/connectors-across-engines.md, section 6.1).
//
// Rows: the engine of the bot, generated from BUILT_IN_DRIVERS. Every driver
// kind is either a row that runs on its fake (the fake Claude CLI, the fake
// ACP CLI for an ACP driver, the fake Codex app-server, or a local
// chat-completions stub for the chat family) or is exempted below with a
// written reason; a new driver fails this file until it is one or the other.
//
// Columns: the provider of the connector. Part 1 runs the real server and
// one provider, the test connector host (server/connectors/hosts/test-host.ts),
// on every row: each cell asserts outcomes, never flags.
// 1. List: `connectors` returns the person's connector.
// 2. Read: `call_connector` on a read tool brings the host's marker into the
//    bot's turn, with no card at Ask.
// 3. Write at Ask: exactly one held card on the calling thread. Denied: the
//    host recorded no call. Allowed: exactly one call, with equal arguments.
// 4. Always allow, saved from that card, answers the same call on every other
//    row (another engine, the same bot).
// 5. Full access: no card. A Refuse rule: refused on every row.
// 6. Isolation: the person is the turn's, never one named in the arguments.
// 7. Visible: the calling thread holds the call's tool row; no other thread
//    got a row or a card.
// Turn kinds on the Claude row: a room turn, a peer hop, a routine run, and a
// turn right after a restart of the server.
//
// Part 2 is the provider axis on the real hosts and their fakes (claude.ai,
// grok.com personal and team shapes, a second Grok account, ChatGPT apps),
// through the real call_connector route and hub, not in a bot turn: under
// each engine row's label the call reaches the provider's fake with equal
// arguments, in the person's own sign-in folder only; two people never reach
// each other's, and a turn paid by someone else serves the speaker's.
//
// POSIX-gated like the other CLI e2es (the fakes are shebang scripts).
import { createServer, type Server, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BUILT_IN_DRIVERS } from "../drivers/builtIn.ts";
import { isHeldRequestId } from "../harness/held-requests.ts";
import { CALL_CONNECTOR_INTERNAL_PATH, createCallConnectorInternalRoute } from "../routes/internal-connectors.ts";
import { freePortBlock } from "../testing/ports.ts";
import { createConnectorHub } from "./hub.ts";
import { createConnectorPlanForTurn } from "./turn-plan.ts";
import { createClaudeConnectorHost } from "./hosts/claude-host.ts";
import { createCodexConnectorHost } from "./hosts/codex-host.ts";
import { createGrokConnectorHost } from "./hosts/grok-host.ts";
import { TEST_HOST_CONNECTOR, TEST_HOST_MARKER } from "./hosts/test-host.ts";
import { chatgptAppsAccount } from "./providers/chatgpt-apps.ts";
import type { ConnectorAccount, ConnectorProvider } from "./types.ts";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const FAKE_ACP = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const FAKE_CODEX = join(SERVER_DIR, "testing", "fake-codex-app-server.ts");
const ROOM_AGENT = join(SERVER_DIR, "testing", "room-handoff-agent.ts");
const FIXTURES = join(SERVER_DIR, "testing", "fixtures", "connectors");
const posixOnly = describe.skipIf(process.platform === "win32");

/** A row of the matrix: an engine on its fake. */
interface Row { kind: string; fake: "claude" | "acp" | "codex" | "chat"; model: string; environment?: Record<string, string> }

/** Every driver kind with a row on a fake. */
export const MATRIX_ROWS: readonly Row[] = [
  { kind: "claudeAgent", fake: "claude", model: "claude-fake" },
  { kind: "grokAgent", fake: "acp", model: "fake-model" },
  { kind: "geminiAgent", fake: "acp", model: "fake-model", environment: { GEMINI_API_KEY: "gemini-test-key" } },
  { kind: "opencodeGo", fake: "acp", model: "fake-model", environment: { FAKE_ACP_MODELS: "fake-model" } },
  { kind: "kimiAgent", fake: "acp", model: "fake-model", environment: { FAKE_ACP_MODELS: "fake-model" } },
  { kind: "droidAgent", fake: "acp", model: "fake-model", environment: { FAKE_ACP_MODELS: "fake-model" } },
  { kind: "cursorAgent", fake: "acp", model: "fake-model", environment: { FAKE_ACP_MODELS: "fake-model" } },
  { kind: "hermesAgent", fake: "acp", model: "fake-model", environment: { FAKE_ACP_MODELS: "fake-model" } },
  { kind: "deepseekAgent", fake: "acp", model: "fake-model", environment: { FAKE_ACP_MODELS: "fake-model" } },
  { kind: "copilotAgent", fake: "acp", model: "fake-model", environment: { FAKE_ACP_MODELS: "fake-model" } },
  { kind: "customAcp", fake: "acp", model: "fake-model", environment: { FAKE_ACP_MODELS: "fake-model" } },
  { kind: "codex", fake: "codex", model: "gpt-fake-default" },
  { kind: "openai-compat", fake: "chat", model: "matrix-model" },
];

/** Every other driver kind, and why it has no row yet. A reason is a sentence. */
export const MATRIX_EXEMPT: Readonly<Record<string, string>> = {
  grok: "the Grok API engine is a chat-completions client like the openai-compat row, but its instance takes only the vendor's own endpoint, so no local stub is wired for it yet",
  qwenAgent: "an ACP driver whose models come from the person's own Qwen settings file, which no fake provides yet; the ACP family runs on the fake ACP CLI through every other ACP row",
  clineAgent: "an ACP driver that mounts the agents server through its own settings file (CLINE_MCP_SETTINGS_PATH), which the fake ACP CLI does not read yet; the ACP family runs through every other ACP row",
  piAgent: "the fake pi CLI has no mode that calls an MCP tool of the agents server yet; pi mounts the same agents server as every row above",
  antigravityAgent: "the fake Antigravity CLI has no mode that calls an MCP tool of the agents server yet; it mounts the same agents server as every row above",
  minimax: "a chat-completions engine on its vendor's fixed endpoint, so no local stub is wired for it yet; the chat family runs through the openai-compat row on a local stub",
  mistral: "a chat-completions engine on its vendor's fixed endpoint, so no local stub is wired for it yet; the chat family runs through the openai-compat row on a local stub",
  cerebras: "a chat-completions engine on its vendor's fixed endpoint, so no local stub is wired for it yet; the chat family runs through the openai-compat row on a local stub",
  groq: "a chat-completions engine on its vendor's fixed endpoint, so no local stub is wired for it yet; the chat family runs through the openai-compat row on a local stub",
  meta: "a chat-completions engine on its vendor's fixed endpoint, so no local stub is wired for it yet; the chat family runs through the openai-compat row on a local stub",
  museCode: "Muse Code has no fake CLI yet; it mounts the same agents server as every row above",
};

describe("connector matrix rows (#3354)", () => {
  it("gives every built-in driver a row on a fake or a written reason", () => {
    const kinds = BUILT_IN_DRIVERS.map((driver) => String(driver.driverKind));
    const rows = new Set(MATRIX_ROWS.map((row) => row.kind));
    const missing = kinds.filter((kind) => !rows.has(kind) && !(MATRIX_EXEMPT[kind] ?? "").trim());
    expect(missing, "add a row on a fake, or a reason to MATRIX_EXEMPT").toEqual([]);
    // no stale entry, and no kind both a row and exempt
    expect(Object.keys(MATRIX_EXEMPT).filter((kind) => !kinds.includes(kind))).toEqual([]);
    expect(MATRIX_ROWS.filter((row) => row.kind in MATRIX_EXEMPT).map((row) => row.kind)).toEqual([]);
    for (const reason of Object.values(MATRIX_EXEMPT)) expect(reason.split(" ").length).toBeGreaterThan(8);
  });
});

interface HostCall { principalId: string; engine: string; connector: string; tool: string; arguments: Record<string, unknown> }

const SEND_ARGS = { to: "someone@example.com", body: "hello from the matrix" };
const readArgs = (row: string) => ({ query: `${row}-read` });
const instanceOf = (row: Row, scenario: "read" | "send") =>
  row.fake === "claude" ? "claude" : row.fake === "codex" ? "codex" : row.fake === "chat" ? "openaiCompat" : `${row.kind}-${scenario}`;
/** The text a row's reply carries once its call landed. */
const DONE = "matrix:call_connector done";
const doneOf = (row: Row) => (row.fake === "claude" ? "mcp:call_connector:" : row.fake === "acp" ? "agents:call_connector ->" : DONE);
/** What a scripted turn calls, by the marker its text holds: the Codex row's
 * plan and the chat stub's answers both come from here. */
const scripted = (row: string, text: string): Array<{ tool: string; arguments: Record<string, unknown> }> =>
  text.includes("MATRIX_LIST")
    ? [{ tool: "connectors", arguments: {} }, { tool: "call_connector", arguments: { connector: TEST_HOST_CONNECTOR, tool: "search_messages", arguments: readArgs(row) } }]
    : text.includes("MATRIX_SEND")
      ? [{ tool: "call_connector", arguments: { connector: TEST_HOST_CONNECTOR, tool: "send_message", arguments: SEND_ARGS } }]
      : [];

/** A local chat-completions endpoint that answers as a model calling the
 * agents tools: each request gets the next call of its turn's script, then a
 * text that quotes every tool result. */
function chatStub(): { server: Server; requests: number } {
  const state = { server: undefined as unknown as Server, requests: 0 };
  state.server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      state.requests += 1;
      const body = JSON.parse(raw || "{}") as { stream?: boolean; messages?: Array<{ role: string; content?: unknown }>; tools?: Array<{ function: { name: string } }> };
      const messages = body.messages ?? [];
      const lastUser = messages.findLastIndex((m) => m.role === "user");
      const text = (m?: { content?: unknown }) => typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? "");
      const results = messages.slice(lastUser + 1).filter((m) => m.role === "tool");
      const plan = scripted("openai-compat", text(messages[lastUser]));
      const names = (body.tools ?? []).map((tool) => tool.function.name);
      const named = (tool: string) => names.find((name) => name === tool || name.endsWith(`_${tool}`)) ?? tool;
      const next = plan[results.length];
      const delta = next
        ? { tool_calls: [{ index: 0, id: `call_${state.requests}`, type: "function", function: { name: named(next.tool), arguments: JSON.stringify(next.arguments) } }] }
        : { content: [DONE, ...results.map(text)].join("\n") };
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
  return state;
}

posixOnly("connector matrix, engine rows on the test host (#3354)", () => {
  let child: ChildProcess | undefined;
  let home = "";
  let callsFile = "";
  let port = 0;
  let base = "";
  let stderr = "";
  let codexPlan = "";
  let stub: ReturnType<typeof chatStub>;

  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsed };
  };
  const messages = async (threadId: string): Promise<any[]> =>
    (await api("GET", `/api/threads/${threadId}/messages?limit=300`)).body.messages ?? [];
  const botText = async (threadId: string): Promise<string> =>
    (await messages(threadId)).filter((m) => m.role === "bot" && m.kind === "text").map((m) => String(m.text ?? "")).join("\n");
  const heldCards = async (threadId: string): Promise<any[]> =>
    (await messages(threadId)).filter((m) => m.card?.requestType === "permission" && isHeldRequestId(String(m.card?.requestId ?? "")));
  const toolRows = async (threadId: string): Promise<any[]> =>
    (await messages(threadId)).filter((m) => m.kind === "activity" && /call_connector/.test(String(m.tool?.name ?? "")));
  const waitFor = async (predicate: () => Promise<boolean>, what: string, ms = 45_000) => {
    const deadline = Date.now() + ms;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. stderr: ${stderr.slice(-3000)}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  const hostCalls = (): HostCall[] =>
    existsSync(callsFile) ? readFileSync(callsFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as HostCall) : [];
  const sends = (engine: string) => hostCalls().filter((c) => c.engine === engine && c.tool === "send_message");

  const newBot = async (name: string) => {
    const created = await api("POST", "/api/bots", { name });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    return created.body.bot as { id: string; threadId: string };
  };
  const useRow = async (bot: { id: string }, row: Row, scenario: "read" | "send") => {
    const picked = await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: instanceOf(row, scenario), model: row.model } });
    expect(picked.status, JSON.stringify(picked.body)).toBe(200);
  };
  const level = async (bot: { id: string; threadId: string }, approvalMode: "ask" | "full") => {
    for (const path of [`/api/bots/${bot.id}`, `/api/bots/${bot.id}/tasks/${bot.threadId}`]) {
      const set = await api("PATCH", path, { approvalMode });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
    }
  };
  /** One turn; resolves once a new reply that reports the call landed. */
  const turn = async (bot: { id: string; threadId: string }, row: Row, text: string, answer?: (card: any) => Promise<void>) => {
    const before = (await messages(bot.threadId)).filter((m) => m.role === "bot" && m.kind === "text").length;
    const seenCards = new Set((await heldCards(bot.threadId)).map((m) => m.card.requestId));
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text, threadId: bot.threadId })).status).toBe(202);
    const done = doneOf(row);
    const cards: any[] = [];
    await waitFor(async () => {
      for (const card of await heldCards(bot.threadId)) {
        if (seenCards.has(card.card.requestId)) continue;
        seenCards.add(card.card.requestId);
        cards.push(card);
        if (answer) await answer(card);
      }
      const replies = (await messages(bot.threadId)).filter((m) => m.role === "bot" && m.kind === "text");
      return replies.length > before && replies.slice(before).some((m) => String(m.text ?? "").includes(done));
    }, `the ${row.kind} reply to "${text}"`);
    const all = await messages(bot.threadId);
    const replies = all.filter((m) => m.role === "bot" && m.kind === "text");
    // the reply, and the tool rows of the turn with their own results
    const rows = all.slice(all.findLastIndex((m) => m.role === "user")).filter((m) => m.kind === "activity").map((m) => JSON.stringify(m.tool ?? {}));
    return { cards, reply: [...replies.slice(before).map((m) => String(m.text ?? "")), ...rows].join("\n") };
  };
  const respond = (threadId: string, requestId: string, body: Record<string, unknown>) =>
    api("POST", `/api/threads/${threadId}/respond`, { requestId, ...body }).then((answered) => {
      expect(answered.status, JSON.stringify(answered.body)).toBeLessThan(300);
    });

  const claudeCall = (when: string, args: Record<string, unknown>, tool = "call_connector") => ({ server: "agents", tool, when, arguments: args });
  const start = async () => {
    stderr = "";
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home,
        USERPROFILE: home,
        SAGAX_PORT: String(port),
        SAGAX_TEST_CONNECTOR_HOST: callsFile,
        SAGAX_TEST_INTERNAL_CAPABILITY_KEY: "connector-matrix-e2e-capability-key-0123456789",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr!.on("data", (c) => (stderr += c));
    child.stdout!.on("data", (c) => (stderr += c));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  const stop = async () => {
    const running = child;
    child = undefined;
    if (!running || running.exitCode !== null) return;
    running.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      running.on("close", () => resolve());
      setTimeout(() => (running.kill("SIGKILL"), resolve()), 5_000).unref?.();
    });
  };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    chmodSync(FAKE_ACP, 0o755);
    chmodSync(FAKE_CODEX, 0o755);
    expect(existsSync(ROOM_AGENT)).toBe(true);
    home = mkdtempSync(join(tmpdir(), "sagax-connector-matrix-"));
    callsFile = join(home, "host-calls.jsonl");
    codexPlan = join(home, "codex-plan.json");
    stub = chatStub();
    await new Promise<void>((resolve) => stub.server.listen(0, "127.0.0.1", resolve));
    mkdirSync(join(home, ".sagax"), { recursive: true });
    const instances: Record<string, unknown> = {};
    for (const row of MATRIX_ROWS) {
      if (row.fake === "claude") {
        instances.claude = {
          driver: row.kind,
          environment: {
            FAKE_CLAUDE_MCP_ROWS: "1",
            FAKE_CLAUDE_MCP_CALLS: JSON.stringify([
              claudeCall("MATRIX_LIST", {}, "connectors"),
              claudeCall("MATRIX_LIST", { connector: TEST_HOST_CONNECTOR, tool: "search_messages", arguments: readArgs(row.kind) }),
              claudeCall("MATRIX_SEND", { connector: TEST_HOST_CONNECTOR, tool: "send_message", arguments: SEND_ARGS }),
              claudeCall("MATRIX_FOREIGN", { connector: TEST_HOST_CONNECTOR, tool: "search_messages", arguments: { query: "foreign", principalId: "someone-else@example.com", person: "someone-else@example.com" } }),
              claudeCall("ROOM_READ", { connector: TEST_HOST_CONNECTOR, tool: "search_messages", arguments: { query: "room" } }),
              claudeCall("PEER_READ", { connector: TEST_HOST_CONNECTOR, tool: "search_messages", arguments: { query: "peer" } }),
              claudeCall("RESTART_READ", { connector: TEST_HOST_CONNECTOR, tool: "search_messages", arguments: { query: "restart" } }),
              claudeCall("ROUTINE_READ", { connector: TEST_HOST_CONNECTOR, tool: "search_messages", arguments: { query: "routine" } }),
              claudeCall("ASK_PEER", { bot_ids: ["Matrix Peer"], message: "PEER_READ the inbox for me", thread: "new", reply: "none" }, "coordinate_bots"),
            ]),
          },
          config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
        };
        continue;
      }
      if (row.fake === "codex") {
        // every bot on this row runs the same script, picked by its turn's text
        const script = (["MATRIX_LIST", "MATRIX_SEND"] as const).map((marker) => ({
          key: marker, match: [marker], repeat: true, reply: DONE,
          steps: scripted(row.kind, marker).map((step) => ({ ...step, anyOutcome: true })),
        }));
        writeFileSync(codexPlan, JSON.stringify({ "*": { script } }));
        instances.codex = {
          driver: row.kind,
          environment: { FAKE_CODEX_ROOM_PLAN: codexPlan, FAKE_CODEX_MCP_ROWS: "1" },
          config: { cli: FAKE_CODEX },
        };
        continue;
      }
      if (row.fake === "chat") continue;
      for (const scenario of ["read", "send"] as const) {
        instances[instanceOf(row, scenario)] = {
          driver: row.kind,
          environment: {
            ...row.environment,
            FAKE_ACP_MODE: "mcp-call",
            FAKE_ACP_MCP_ROWS: "1",
            FAKE_ACP_MCP_CALLS: scenario === "read" ? "agents:connectors,agents:call_connector" : "agents:call_connector",
            FAKE_ACP_MCP_CALL_ARGS: JSON.stringify({
              "agents:connectors": {},
              "agents:call_connector": scenario === "read"
                ? { connector: TEST_HOST_CONNECTOR, tool: "search_messages", arguments: readArgs(row.kind) }
                : { connector: TEST_HOST_CONNECTOR, tool: "send_message", arguments: SEND_ARGS },
            }),
          },
          config: { cli: FAKE_ACP, fullAuto: true },
        };
      }
    }
    writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({ instances }));
    port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    await start();
    // the chat row: an OpenAI-compatible endpoint on the local stub
    const stubPort = (stub.server.address() as { port: number }).port;
    const configured = await api("PATCH", "/api/config", { openaiCompat: { key: "matrix-fixture-key", url: `http://127.0.0.1:${stubPort}/v1`, model: "matrix-model" } });
    expect(configured.status, JSON.stringify(configured.body)).toBeLessThan(300);
  }, 30_000);

  afterAll(async () => {
    await stop();
    await new Promise<void>((resolve) => (stub ? stub.server.close(() => resolve()) : resolve()));
    // the stopped server's last writes may still be landing
    if (home) rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  describe.each(MATRIX_ROWS.map((row) => [row.kind, row] as const))("row %s", (_kind, row) => {
    it("lists, reads with no card at Ask, and holds one card per send: denied runs nothing, allowed runs once, Full runs with no card", async () => {
      const bot = await newBot(`Matrix ${row.kind}`);
      await level(bot, "ask");
      // 1 and 2: the list, then a read with no card
      await useRow(bot, row, "read");
      const read = await turn(bot, row, "MATRIX_LIST then read the inbox");
      expect(read.cards).toEqual([]);
      expect(read.reply).toContain(TEST_HOST_MARKER);
      expect(read.reply).toContain(TEST_HOST_CONNECTOR);
      const reached = hostCalls().filter((c) => c.arguments.query === `${row.kind}-read`);
      expect(reached, JSON.stringify(hostCalls())).toHaveLength(1);
      expect(reached[0]).toMatchObject({ engine: row.kind, connector: TEST_HOST_CONNECTOR, tool: "search_messages", arguments: readArgs(row.kind) });
      // 7: the call is a tool row of the calling thread
      expect((await toolRows(bot.threadId)).length).toBeGreaterThan(0);

      // 3: a send at Ask, denied
      await useRow(bot, row, "send");
      const denied = await turn(bot, row, "MATRIX_SEND a note", (card) => respond(bot.threadId, card.card.requestId, { behavior: "deny" }));
      expect(denied.cards).toHaveLength(1);
      expect(JSON.stringify(denied.cards[0].card)).toContain("send_message");
      expect(sends(row.kind)).toEqual([]);
      // allowed once: exactly one call, with equal arguments
      const allowed = await turn(bot, row, "MATRIX_SEND a note", (card) => respond(bot.threadId, card.card.requestId, { behavior: "allow" }));
      expect(allowed.cards).toHaveLength(1);
      expect(allowed.reply).toContain(TEST_HOST_MARKER);
      expect(sends(row.kind)).toHaveLength(1);
      expect(sends(row.kind)[0]!.arguments).toEqual(SEND_ARGS);

      // 5: Full access, no card
      await level(bot, "full");
      const full = await turn(bot, row, "MATRIX_SEND a note");
      expect(full.cards).toEqual([]);
      expect(sends(row.kind)).toHaveLength(2);
    }, 120_000);
  });

  it("an Always allow saved from one row's card answers the same call on every other row", async () => {
    const bot = await newBot("Matrix Always");
    await level(bot, "ask");
    const [first, ...others] = MATRIX_ROWS;
    await useRow(bot, first!, "send");
    const saved = await turn(bot, first!, "MATRIX_SEND a note", (card) => respond(bot.threadId, card.card.requestId, { behavior: "allow", rule: "allow" }));
    expect(saved.cards).toHaveLength(1);
    for (const row of others) {
      const before = sends(row.kind).length;
      await useRow(bot, row, "send");
      const again = await turn(bot, row, "MATRIX_SEND a note");
      expect(again.cards, row.kind).toEqual([]);
      expect(sends(row.kind), row.kind).toHaveLength(before + 1);
    }
  }, 180_000);

  it("a Refuse rule saved from one row's card refuses the same call on every row", async () => {
    const bot = await newBot("Matrix Refuse");
    await level(bot, "ask");
    const [first] = MATRIX_ROWS;
    await useRow(bot, first!, "send");
    const before = sends(first!.kind).length;
    const saved = await turn(bot, first!, "MATRIX_SEND a note", (card) => respond(bot.threadId, card.card.requestId, { behavior: "deny", rule: "deny" }));
    expect(saved.cards).toHaveLength(1);
    expect(sends(first!.kind)).toHaveLength(before);
    for (const row of MATRIX_ROWS) {
      const count = sends(row.kind).length;
      await useRow(bot, row, "send");
      const refused = await turn(bot, row, "MATRIX_SEND a note");
      expect(refused.cards, row.kind).toEqual([]);
      expect(sends(row.kind), row.kind).toHaveLength(count);
    }
  }, 180_000);

  it("serves the turn's own person, never one named in the arguments", async () => {
    const bot = await newBot("Matrix Isolation");
    const claude = MATRIX_ROWS.find((row) => row.fake === "claude")!;
    await useRow(bot, claude, "read");
    await turn(bot, claude, "MATRIX_FOREIGN read the inbox");
    const own = hostCalls().find((c) => c.arguments.query === `${claude.kind}-read`)?.principalId;
    const foreign = hostCalls().find((c) => c.arguments.query === "foreign");
    expect(foreign, JSON.stringify(hostCalls())).toBeTruthy();
    expect(foreign!.principalId).toBeTruthy();
    expect(foreign!.principalId).not.toBe("someone-else@example.com");
    if (own) expect(foreign!.principalId).toBe(own);
  }, 60_000);

  it("a room turn calls the connector, and no other thread gets its row or a card", async () => {
    const claude = MATRIX_ROWS.find((row) => row.fake === "claude")!;
    const bot = await newBot("Matrix Room");
    await useRow(bot, claude, "read");
    const made = await api("POST", "/api/groups", { name: "Matrix room", memberIds: [bot.id], setup: { bulletin: "", defaultResponder: { kind: "member", botId: bot.id } } });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    const group = made.body.group as { id: string; threadId: string };
    expect((await api("POST", `/api/groups/${group.id}/messages`, { text: "ROOM_READ the inbox", threadId: group.threadId })).status).toBeLessThan(300);
    await waitFor(async () => (await botText(group.threadId)).includes("mcp:call_connector:"), "the room reply");
    expect(await botText(group.threadId)).toContain("mcp:call_connector:ok");
    expect(hostCalls().filter((c) => c.arguments.query === "room")).toHaveLength(1);
    expect((await toolRows(group.threadId)).length).toBeGreaterThan(0);
    // the bot's own direct thread got nothing of the room's call
    expect(await toolRows(bot.threadId)).toEqual([]);
    expect(await heldCards(bot.threadId)).toEqual([]);
  }, 60_000);

  it("a peer hop calls the connector", async () => {
    const claude = MATRIX_ROWS.find((row) => row.fake === "claude")!;
    const peer = await newBot("Matrix Peer");
    await useRow(peer, claude, "read");
    const asker = await newBot("Matrix Asker");
    await useRow(asker, claude, "read");
    expect((await api("POST", `/api/bots/${asker.id}/messages`, { text: "ASK_PEER about the inbox", threadId: asker.threadId })).status).toBe(202);
    await waitFor(async () => hostCalls().some((c) => c.arguments.query === "peer"), "the peer call to reach the host", 60_000);
    expect(hostCalls().filter((c) => c.arguments.query === "peer")).toHaveLength(1);
  }, 90_000);

  it("a routine run calls the connector, on the run's own thread", async () => {
    const claude = MATRIX_ROWS.find((row) => row.fake === "claude")!;
    const bot = await newBot("Matrix Routine");
    await useRow(bot, claude, "read");
    const made = await api("POST", "/api/routines", { name: "Matrix routine", botId: bot.id, prompt: "ROUTINE_READ the inbox", enabled: true, schedule: { type: "webhook" } });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const ran = await api("POST", `/api/routines/${made.body.routine.id}/run`, {});
    expect(ran.status, JSON.stringify(ran.body)).toBe(201);
    const runId = ran.body.run.id as string;
    await waitFor(async () => hostCalls().some((c) => c.arguments.query === "routine"), "the routine call to reach the host", 60_000);
    expect(hostCalls().filter((c) => c.arguments.query === "routine")).toHaveLength(1);
    const run = async () => (await api("GET", "/api/routines")).body.runs.find((entry: any) => entry.id === runId);
    await waitFor(async () => Boolean((await run())?.threadId), "the run's thread");
    const threadId = (await run()).threadId as string;
    await waitFor(async () => (await toolRows(threadId)).length > 0, "the routine's tool row");
    // the bot's own direct thread got nothing of the run's call
    expect(await toolRows(bot.threadId)).toEqual([]);
  }, 90_000);

  it("a turn right after a restart calls the connector", async () => {
    const claude = MATRIX_ROWS.find((row) => row.fake === "claude")!;
    const bot = await newBot("Matrix Restart");
    await useRow(bot, claude, "read");
    await stop();
    await start();
    const after = await turn(bot, claude, "RESTART_READ the inbox");
    expect(after.reply).toContain("mcp:call_connector:ok");
    expect(hostCalls().filter((c) => c.arguments.query === "restart")).toHaveLength(1);
  }, 90_000);
});

// Part 2: the provider axis, on the real hosts and their fakes.

/** What a provider's fake recorded of the latest call for one person. */
interface Recorded { input: Record<string, unknown>; folder: string }

interface ProviderColumn {
  name: string;
  provider: ConnectorProvider;
  account: (person: string) => ConnectorAccount;
  tool: string;
  /** the latest call the provider's fake ran for that person, if any */
  last: (person: string) => Recorded | undefined;
}

const PEOPLE = ["ana@example.com", "ben@example.com"] as const;
const isPerson = (principalId: string) => (PEOPLE as readonly string[]).includes(principalId);
const lines = <T>(file: string): T[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as T) : []);
const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

posixOnly("connector matrix, provider columns on the real hosts (#3354)", () => {
  let root = "";
  const personDir = (person: string) => join(root, person.split("@")[0]!);
  const folder = (person: string, provider: string, slot = "primary") => join(personDir(person), provider, slot);
  const claudeCalls = () => join(root, "claude-calls.jsonl");
  const grokCalls = () => join(root, "grok-calls.jsonl");
  const codexDump = (person: string) => join(folder(person, "codex"), "dump.json");
  const codexLog = () => join(root, "codex-methods.jsonl");

  const GROK_TOOL = "cursor__user-Mail-search_5fmessages___1";
  const CODEX_TOOL = "example_mail.list_messages";
  const grokAccount = (slot: "primary" | "second", team = false) => (): ConnectorAccount => ({
    provider: "grok-com", driver: "grokAgent", instanceId: "default", slot, key: `grok-com:default:${slot}`,
    label: slot === "second" ? "Grok (personal account)" : "Grok", auth: "subscription",
    connectors: [{ id: team ? "team_mail" : "mail", name: team ? "Team Mail" : "Mail", state: "connected", tools: [{ id: GROK_TOOL }] }], at: 1,
  });

  let columns: ProviderColumn[] = [];
  let hub: ReturnType<typeof createConnectorHub>;

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    chmodSync(FAKE_ACP, 0o755);
    chmodSync(FAKE_CODEX, 0o755);
    root = realpathSync(mkdtempSync(join(tmpdir(), "sagax-connector-columns-")));
    for (const person of PEOPLE) {
      for (const [provider, slot] of [["claude", "primary"], ["grok", "primary"], ["grok", "second"], ["codex", "primary"]] as const) {
        const dir = folder(person, provider, slot);
        mkdirSync(join(dir, ".grok"), { recursive: true });
        writeFileSync(join(dir, ".grok", "auth.json"), "{}");
      }
    }
    const codexLaunch = (person: string) => ({
      cli: FAKE_CODEX,
      env: { ...process.env, HOME: folder(person, "codex"), CODEX_HOME: folder(person, "codex"), FAKE_CODEX_CONNECTOR_REPLAY: FIXTURES, FAKE_CODEX_METHOD_LOG: codexLog(), FAKE_CODEX_DUMP: codexDump(person) },
    });
    const codexHost = createCodexConnectorHost({ gate: (_label, run) => run(), timeoutMs: 30_000, listTimeoutMs: 30_000, launch: (person) => (isPerson(person) ? codexLaunch(person) : undefined) });
    hub = createConnectorHub([
      createClaudeConnectorHost({
        gate: (_label, run) => run(),
        timeoutMs: 30_000,
        launch: (person) => (isPerson(person)
          ? { cli: FAKE_CLAUDE, env: { ...process.env, CLAUDE_CONFIG_DIR: folder(person, "claude"), FAKE_CLAUDE_CONNECTOR_MODE: "obey", FAKE_CLAUDE_CONNECTOR_CALLS: claudeCalls() } }
          : undefined),
      }),
      createGrokConnectorHost({
        gate: (_label, run) => run(),
        timeoutMs: 30_000,
        launch: (person, account) => (isPerson(person)
          ? { cli: FAKE_ACP, env: { ...process.env, HOME: folder(person, "grok", account.slot), GROK_HOME: join(folder(person, "grok", account.slot), ".grok"), FAKE_ACP_MODE: "pinned", FAKE_ACP_PINNED: "obey", FAKE_ACP_PINNED_CALLS: grokCalls() } }
          : undefined),
      }),
      codexHost,
    ]);
    const listing = await codexHost.listApps(codexLaunch(PEOPLE[0]));
    expect(listing?.auth).toBe("subscription");
    const apps = chatgptAppsAccount({ provider: "chatgpt-apps", driver: "codex", instanceId: "default", slot: "primary" }, "ChatGPT", listing!);
    const mail = apps.connectors.find((entry) => entry.name === "Example Mail")!;
    expect(mail.tools.map((tool) => tool.id)).toContain(CODEX_TOOL);

    const underPerson = (person: string, dir: string | null | undefined) => Boolean(dir) && dir!.startsWith(`${personDir(person)}/`);
    columns = [
      {
        name: "claude.ai",
        provider: "claude-ai",
        account: () => ({ provider: "claude-ai", driver: "claudeAgent", instanceId: "claude", slot: "primary", key: "claude-ai:claude:primary", label: "Claude", auth: "subscription", connectors: [{ name: "Example Mail", state: "connected", tools: [] }], at: 1 }),
        tool: "search_messages",
        last: (person) => {
          const call = lines<{ input: Record<string, unknown>; configDir: string | null }>(claudeCalls()).filter((c) => underPerson(person, c.configDir)).at(-1);
          return call ? { input: call.input, folder: call.configDir! } : undefined;
        },
      },
      ...([["grok.com personal", grokAccount("primary")], ["grok.com team", grokAccount("primary", true)], ["second Grok account", grokAccount("second")]] as const).map(([name, account]): ProviderColumn => ({
        name,
        provider: "grok-com",
        account,
        tool: GROK_TOOL,
        last: (person) => {
          const call = lines<{ input: Record<string, unknown>; grokHome: string | null }>(grokCalls()).filter((c) => underPerson(person, c.grokHome)).at(-1);
          return call ? { input: call.input, folder: call.grokHome! } : undefined;
        },
      })),
      {
        name: "ChatGPT apps",
        provider: "chatgpt-apps",
        account: () => ({ ...apps, connectors: [mail] }),
        tool: CODEX_TOOL,
        last: (person) => {
          if (!existsSync(codexDump(person))) return undefined;
          const dump = JSON.parse(readFileSync(codexDump(person), "utf8")) as { env: Record<string, string | undefined>; calls: Array<{ method: string; params: { arguments?: Record<string, unknown> } }> };
          const call = dump.calls.find((entry) => entry.method === "mcpServer/tool/call");
          return call && underPerson(person, dump.env.CODEX_HOME) ? { input: call.params.arguments ?? {}, folder: dump.env.CODEX_HOME! } : undefined;
        },
      },
    ];
  }, 60_000);
  afterAll(async () => {
    await hub?.close();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  /** One call_connector through the real route, allowed by the person's
   * settings (the held request answers allow), on a turn of `engine`.
   * `accounts` is the person's registry read (the turn plan's, when given). */
  async function callThrough(person: string, engine: string, column: ProviderColumn, args: Record<string, unknown>,
    accounts: (principalId: string) => readonly ConnectorAccount[] = (principalId) => (principalId === person ? [column.account(person)] : [])): Promise<{ status: number; body: any }> {
    const account = column.account(person);
    const route = createCallConnectorInternalRoute({
      ownsThread: () => true,
      principal: () => person,
      confined: () => false,
      accounts,
      hub: () => hub,
      hold: () => ({ engine, decision: Promise.resolve({ behavior: "allow" as const }) }),
    });
    let status = 0;
    let body: any;
    await route({
      req: {} as never,
      res: {} as ServerResponse,
      url: new URL(`http://local${CALL_CONNECTOR_INTERNAL_PATH}`),
      path: CALL_CONNECTOR_INTERNAL_PATH,
      method: "POST",
      json: (_res: ServerResponse, code: number, payload: unknown) => { status = code; body = payload; return true; },
      capability: { botId: "bot-1", threadId: "thread-1", generation: 1 },
      readBody: async () => ({ connector: account.connectors[0]!.name, tool: column.tool, arguments: args }),
    } as never);
    return { status, body };
  }

  it("the route, under every engine row's label, reaches every provider's fake with equal arguments, in the person's own folder", async () => {
    for (const column of columns) {
      for (const row of MATRIX_ROWS) {
        const args = { query: column.name, row: row.kind };
        const answer = await callThrough(PEOPLE[0], row.kind, column, args);
        expect(answer.status, `${column.name} / ${row.kind}`).toBe(200);
        expect(answer.body.ok, `${column.name} / ${row.kind}: ${JSON.stringify(answer.body)}`).toBe(true);
        const last = column.last(PEOPLE[0]);
        expect(last?.input, `${column.name} / ${row.kind}`).toEqual(args);
        expect(last!.folder.startsWith(folder(PEOPLE[0], column.provider === "claude-ai" ? "claude" : column.provider === "grok-com" ? "grok" : "codex", column.account(PEOPLE[0]).slot)), last!.folder).toBe(true);
      }
    }
    const counted = hub.stats();
    for (const row of MATRIX_ROWS) {
      for (const column of columns) {
        expect(counted.find((stat) => stat.engine === row.kind && stat.provider === column.provider)?.ok, `${row.kind} ${column.provider}`).toBeGreaterThan(0);
      }
    }
    // no model turn on the ChatGPT apps host
    expect(lines<{ method: string }>(codexLog()).filter((line) => line.method === "turn/start")).toEqual([]);
  }, 300_000);

  it("two people: each call runs in its own person's folder only", async () => {
    for (const column of columns) {
      const args = { query: column.name, person: "second" };
      const answer = await callThrough(PEOPLE[1], "claudeAgent", column, args);
      expect(answer.body.ok, `${column.name}: ${JSON.stringify(answer.body)}`).toBe(true);
      expect(column.last(PEOPLE[1])?.input, column.name).toEqual(args);
      // nothing of the second person's ran in the first person's folders
      expect(column.last(PEOPLE[0])?.input, column.name).not.toEqual(args);
    }
  }, 120_000);

  it("a turn paid by someone else's sign-in serves the speaker's connectors, never the payer's", async () => {
    const [speaker, payer] = PEOPLE;
    for (const column of columns) {
      const own = column.account(speaker);
      const payers = { ...column.account(payer), label: `${column.account(payer).label} (payer)` };
      const read: string[] = [];
      const planFor = createConnectorPlanForTurn<{ id: string; toolScope?: unknown }, { instanceId: string; driverKind: string }>({
        accountConnectorInput: (_bot, instance, who, via, slot) => ({
          identity: "perspicax", restrictedByPolicy: false, driver: instance.driverKind, instanceId: instance.instanceId,
          via: via ?? "subscription", payerPrincipalId: payer, speaker: who, ownerPrincipalId: speaker, localPrincipalId: "", ...(slot ? { slot } : {}),
        }),
        isRelayPart: () => false,
        withholdHostToolsFor: () => true,
        accounts: (principal) => { read.push(principal); return principal === speaker ? [own] : principal === payer ? [payers] : []; },
      });
      const plan = planFor({ id: "bot-1" }, { instanceId: own.instanceId, driverKind: own.driver }, { origin: "person", principalId: speaker }, "thread-1");
      expect(plan.principal, column.name).toBe(speaker);
      expect(plan.accounts(), column.name).toEqual([own]);
      const payerBefore = column.last(payer)?.input;
      const args = { query: column.name, paidBy: "someone else" };
      const answer = await callThrough(plan.principal, own.driver, column, args, (principalId) => (principalId === plan.principal ? plan.accounts() : []));
      expect(answer.body.ok, `${column.name}: ${JSON.stringify(answer.body)}`).toBe(true);
      expect(column.last(speaker)?.input, column.name).toEqual(args);
      // the payer's folder ran nothing of it
      expect(column.last(payer)?.input, column.name).toEqual(payerBefore);
      expect(read, column.name).not.toContain(payer);
    }
  }, 120_000);

  it("leaves no host process running", async () => {
    await new Promise((r) => setTimeout(r, 300));
    const pids = [
      ...lines<{ pid: number }>(grokCalls()).map((c) => c.pid),
      ...lines<{ pid: number }>(claudeCalls()).map((c) => c.pid),
      ...lines<{ pid: number }>(codexLog()).map((c) => c.pid),
    ];
    expect(pids.length).toBeGreaterThan(0);
    expect([...new Set(pids)].filter(alive)).toEqual([]);
  });
});
