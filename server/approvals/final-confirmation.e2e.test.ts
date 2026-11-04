// Real isolated server, signed member MCP requests and fake engines only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startOrgServer, type Auth, type OrgServer } from "../testing/org-server-harness.ts";
import type { FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { openSse } from "../testing/sse.ts";
import { pushesForFrame } from "../push/frames.ts";

const ADMIN: FakeOidcUser = { sub: "fixture-admin", name: "Fixture admin", preferred_username: "fixture-admin", role: "admin" };
const WREN: FakeOidcUser = { sub: "fixture-wren", name: "Wren", preferred_username: "wren", role: "employee" };
const OSPREY: FakeOidcUser = { sub: "fixture-osprey", name: "Osprey", preferred_username: "osprey", role: "employee" };
const QUESTION = "The prepared batch has two writes. May I proceed with the batch?";
const sockets: Socket[] = [];
let fixture: OrgServer;
let wren: Auth;
let osprey: Auth;

const api = async (method: string, path: string, body?: unknown, auth = wren, status = 200) => {
  const result = await fixture.api(method, path, auth, body);
  expect(result.status, `${method} ${path}: ${JSON.stringify(result.body)}`).toBe(status);
  return result.body as any;
};
const member = async (path: string, body?: unknown, user = WREN, method = "POST") => {
  const bearer = fixture.idp.consoleAssertion({ sub: user.sub, aud: fixture.base, role: "employee", teams: [],
    claims: (claims) => ({ ...claims, act: { sub: "perspicax-mcp" }, client_name: "Fixture client" }) });
  const result = await fetch(`${fixture.base}/api/org/member/${path}`, {
    method, headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
  });
  return { status: result.status, body: await result.json() as any };
};
const messages = async (threadId: string, auth = wren) => (await api("GET", `/api/threads/${threadId}/messages?limit=100`, undefined, auth)).messages as any[];
const createBot = async (name: string, engine: string) => {
  const bot = (await api("POST", "/api/bots", { name }, wren, 201)).bot;
  await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: engine, model: "fake-model" }, approvalMode: "ask" });
  return bot;
};
const streamFor = async (auth: Auth) => {
  const { ticket } = await api("POST", "/api/auth/stream-ticket", undefined, auth);
  return openSse(`${fixture.base}/api/events?ticket=${encodeURIComponent(ticket)}`);
};
const questionCard = async (threadId: string) => (await messages(threadId)).find((row) => row.card?.requestType === "question");
const dumpFor = (engine: string) => JSON.parse(readFileSync(join(fixture.home, `${engine}-dump.json`), "utf8"));
const runState = async (runId: string) => (await api("GET", "/api/routines")).runs.find((run: any) => run.id === runId);
const taskState = async (botId: string, threadId: string) => (await api("GET", "/api/bots?messages=0")).bots.find((bot: any) => bot.id === botId)?.tasks.find((task: any) => task.threadId === threadId);

describe.skipIf(process.platform === "win32")("final confirmations reach their person (#1984)", () => {
  beforeAll(async () => {
    const env: Record<string, string> = { SAGAX_ANTHROPIC_API_KEY: "sk-ant-fixture-only", SAGAX_PERSPICAX_DIRECTORY_SECONDS: "5" };
    fixture = await startOrgServer({ user: ADMIN, prefix: "sagax-final-confirmation-", env });
    await fixture.kill("SIGTERM");
    fixture.idp.directoryPeople = [ADMIN, WREN, OSPREY].map((user) => fixture.idp.personOf(user));
    env.SAGAX_PERSPICAX_LINK_FILE = join(fixture.home, "link", "pulsabot.json");
    mkdirSync(join(fixture.home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(env.SAGAX_PERSPICAX_LINK_FILE, JSON.stringify({ version: 1, issuer: fixture.idp.issuer,
      client_id: "pulsa-bot", server_id: fixture.idp.serverId, origin: fixture.base, link_token: fixture.idp.linkToken }), { mode: 0o640 });
    const cli = new URL("../testing/fake-claude-cli.ts", import.meta.url).pathname;
    const instances = Object.fromEntries(["routine", "mcp", "card", "go"].map((engine) => [engine, {
      driver: "claudeAgent", access: "api", config: { cli, requireApiKey: true, fullAuto: false },
      environment: {
        FAKE_CLAUDE_MODE: engine === "card" ? "slow" : engine === "go" ? "hang" : "happy",
        FAKE_CLAUDE_DUMP: join(fixture.home, `${engine}-dump.json`),
        FAKE_CLAUDE_TOOL_CALLS: "[]", FAKE_CLAUDE_REPLIES: JSON.stringify([QUESTION, "Both writes completed."]),
        FAKE_CLAUDE_REPLY_STATE: join(fixture.home, `${engine}-replies`),
        FAKE_CLAUDE_SLOW_FINISH_GATE: join(fixture.home, "card-finish"), FAKE_CLAUDE_RELEASE: join(fixture.home, "go-finish"),
      },
    }]));
    writeFileSync(join(fixture.home, ".sagax", "config.json"), JSON.stringify({ instances }));
    await fixture.start();
    await fixture.signIn(ADMIN);
    wren = await fixture.signIn(WREN);
    osprey = await fixture.signIn(OSPREY);
  }, 120_000);

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await fixture?.close();
  });

  it("holds a routine on its final text question, surfaces it in chat, inbox and notification, then resumes the same run", async () => {
    const own = await streamFor(wren);
    const other = await streamFor(osprey);
    try {
      const bot = await createBot("Wren routine", "routine");
      const { routine } = await api("POST", "/api/routines", { name: "Prepared batch", botId: bot.id, prompt: "Apply the two prepared entries.", enabled: false,
        schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 } }, wren, 201);
      const { run } = await api("POST", `/api/routines/${routine.id}/run`, undefined, wren, 201);
      await expect.poll(async () => (await runState(run.id))?.status, { timeout: 25_000 }).toBe("waiting");
      const waiting = await runState(run.id);
      const threadId = waiting.threadId as string;
      expect(waiting.finishedAt).toBeUndefined();
      await expect.poll(() => taskState(bot.id, threadId)).toMatchObject({ activity: "waiting-on-you", busy: false });
      const row = await questionCard(threadId);
      expect(row.card).toMatchObject({ requestId: expect.stringMatching(/^ask-choice-/), subtitle: QUESTION, options: ["Yes", "No"],
        questionRequest: { origin: "output" } });
      const requestId = row.card.requestId as string;
      expect((await messages(bot.threadId)).find((line) => line.routineRun?.runId === run.id)?.routineRun).toMatchObject({ status: "waiting", executionThreadId: threadId });
      expect((await api("GET", "/api/approvals")).pending.find((card: any) => card.requestId === requestId)).toMatchObject({ kind: "question", decidable: true });
      await expect.poll(() => own.frames.some((frame: any) => frame.kind === "notify" && frame.notification?.requestId === requestId)).toBe(true);
      const notice = own.frames.find((frame: any) => frame.kind === "notify" && frame.notification?.requestId === requestId) as any;
      expect(notice.notification).toMatchObject({ kind: "question", choices: ["Yes", "No"] });
      expect(notice.notification.quietOnPhones).not.toBe(true);
      expect(JSON.stringify(other.frames)).not.toContain(requestId);
      expect(JSON.stringify(await api("GET", "/api/approvals", undefined, osprey))).not.toContain(requestId);
      await api("POST", `/api/threads/${threadId}/respond`, { requestId, behavior: "answer", message: "Yes" });
      await expect.poll(async () => (await runState(run.id))?.status, { timeout: 25_000 }).toBe("completed");
      expect((await messages(threadId)).some((line) => line.role === "user" && line.text === "Yes")).toBe(true);
    } finally { own.close(); other.close(); }
  }, 60_000);

  it("converts an MCP-started final question, delivers it to iOS, and fences reads, answers and notifications from another person", async () => {
    const own = await streamFor(wren);
    const other = await streamFor(osprey);
    try {
      const bot = await createBot("Wren MCP", "mcp");
      const sent = await member("agents/send_prompt", { agent_id: bot.id, prompt: "Apply the prepared batch.", mode: "blocking", timeout_ms: 10_000 });
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
      expect(sent.body).toMatchObject({ finished: false, status: "waiting_for_approval" });
      const threadId = sent.body.thread_id as string;
      await expect.poll(async () => (await questionCard(threadId))?.card?.requestId, { timeout: 20_000 }).toMatch(/^ask-choice-/);
      const row = await questionCard(threadId);
      const requestId = row.card.requestId as string;
      expect(row.card.questionRequest.origin).toBe("output");
      const listed = await member("approvals?status=pending", undefined, WREN, "GET");
      expect(listed.body.approvals.find((card: any) => card.id === requestId)).toMatchObject({ threadId, canAnswer: true });
      expect(JSON.stringify((await member("approvals?status=pending", undefined, OSPREY, "GET")).body)).not.toContain(requestId);
      expect((await fixture.api("GET", `/api/threads/${threadId}/messages`, osprey)).status).toBe(404);
      expect((await member(`approvals/${requestId}`, { threadId, option: "Yes" }, OSPREY)).status).toBe(403);
      await expect.poll(() => own.frames.some((frame: any) => frame.kind === "notify" && frame.notification?.requestId === requestId)).toBe(true);
      const notice = own.frames.find((frame: any) => frame.kind === "notify" && frame.notification?.requestId === requestId) as any;
      expect(notice.notification.quietOnPhones).not.toBe(true);
      expect(pushesForFrame(notice, {
        notificationPeople: () => ["fixture-owner"], muted: () => false,
        achievementNotifications: () => false, achievementName: () => undefined, now: () => 42,
      })).toMatchObject([{ kind: "approval", prompt: "question", threadId, requestId, choices: ["Yes", "No"] }]);
      expect(JSON.stringify(other.frames)).not.toContain(requestId);
      await expect.poll(() => taskState(bot.id, threadId)).toMatchObject({ activity: "waiting-on-you", busy: false });
      own.close(); other.close();
      await fixture.restart("SIGTERM");
      expect(await taskState(bot.id, threadId)).toMatchObject({ activity: "waiting-on-you", busy: false });
      expect((await member(`approvals/${requestId}`, { threadId, option: "Yes" })).status).toBe(200);
      await expect.poll(async () => (await messages(threadId)).some((line) => line.text === "Both writes completed."), { timeout: 20_000 }).toBe(true);
      expect((await messages(threadId)).filter((line) => line.card?.requestType === "question")).toHaveLength(1);
    } finally { own.close(); other.close(); }
  }, 60_000);

  it("keeps a real ask_choice call's exact card and does not duplicate it at completion", async () => {
    const bot = await createBot("Wren card", "card");
    const sent = await member("agents/send_prompt", { agent_id: bot.id, prompt: "May I proceed with the batch?", mode: "async" });
    const threadId = sent.body.thread_id as string;
    await expect.poll(() => existsSync(join(fixture.home, "card-dump.json")), { timeout: 20_000 }).toBe(true);
    const token = dumpFor("card").mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN;
    const response = await fetch(`${fixture.base}/api/internal/options-card`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ tool: "ask_choice", question: "Which prepared batch?", options: ["First batch", "Second batch"] }) });
    expect(response.status).toBe(201);
    const raised = await response.json() as any;
    writeFileSync(join(fixture.home, "card-finish"), "finish");
    await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).bots.find((entry: any) => entry.id === bot.id).tasks.find((task: any) => task.threadId === threadId).busy, { timeout: 15_000 }).toBe(false);
    const cards = (await messages(threadId)).filter((row) => row.card?.requestType === "question");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: raised.messageId, card: { subtitle: "Which prepared batch?", options: ["First batch", "Second batch"] } });
    expect(cards[0].card.questionRequest.origin).toBeUndefined();
  }, 45_000);

  it("passes a quoted GO unchanged to the bot and reaches the normal write approval gate", async () => {
    const bot = await createBot("Wren GO", "go");
    const prompt = 'Operator GO (quoted):\n"GO for the prepared Wren entry."\n\nScope:\n- Write only result.txt in this bot workspace.';
    const sent = await member("agents/send_prompt", { agent_id: bot.id, prompt, mode: "async" });
    const threadId = sent.body.thread_id as string;
    await expect.poll(() => existsSync(join(fixture.home, "go-dump.json")), { timeout: 20_000 }).toBe(true);
    const dump = dumpFor("go");
    expect(JSON.stringify(dump)).toContain("Operator GO (quoted):");
    expect(JSON.stringify(dump)).toContain("Do not ask for the same GO again");
    expect(JSON.stringify(dump)).toContain("through the normal write gate");
    expect(JSON.stringify(dump)).toContain("send_prompt may carry Operator GO (quoted):");
    const socket = connect(dump.mcpConfig.mcpServers.ogb.args.at(-1));
    sockets.push(socket);
    let received = "";
    socket.on("data", (chunk) => { received += chunk.toString(); });
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    socket.write(JSON.stringify({ t: "ask", id: "quoted-go-write", kind: "permission", tool: "Write", input: { file_path: join(fixture.home, ".sagax", "task-workspaces", bot.id, "result.txt"), content: "Prepared entry" } }) + "\n");
    await expect.poll(async () => (await messages(threadId)).find((row) => row.card?.requestId === "quoted-go-write")?.card, { timeout: 10_000 }).toMatchObject({ requestType: "permission" });
    expect(received).toBe("");
    expect((await messages(threadId)).filter((row) => row.card?.requestType === "question")).toHaveLength(0);
    expect((await member("approvals/quoted-go-write", { threadId, decision: "deny" })).status).toBe(200);
    await expect.poll(() => received).toContain('"behavior":"deny"');
    writeFileSync(join(fixture.home, "go-finish"), "finish");
  }, 45_000);
});
