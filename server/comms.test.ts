// Communication guards after runtime lot 3. Mentions, native catalog refusals
// and auth stay unchanged. The former ledger/channel scenarios below pin the
// same delivery and isolation guarantees on the current job runtime.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mentionedBots, normalizeGroupDefaultResponder, roomResponders } from "./store.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";
import { withCommsRuntime, type CommsBot, type CommsRuntimeFixture } from "./testing/comms-runtime-fixture.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const PORT = await freePortBlock([0, 1]);
const BASE = `http://127.0.0.1:${PORT}`;

describe("mentionedBots", () => {
  const peers = [
    { id: "1", name: "New Bot" },
    { id: "2", name: "New Bot 2" },
    { id: "3", name: "Milind" },
    { id: "4", name: "Ghost", hidden: true },
  ];
  it("matches a tag at a word start, case-insensitively", () => {
    expect(mentionedBots("hey @milind, look", peers).map((b) => b.id)).toEqual(["3"]);
    expect(mentionedBots("@Milind first thing", peers).map((b) => b.id)).toEqual(["3"]);
  });
  it("prefers the longest name so prefixes never half-match", () => {
    expect(mentionedBots("ask @New Bot 2 about it", peers).map((b) => b.id)).toEqual(["2"]);
  });
  it("dedupes repeats and collects multiple bots", () => {
    expect(mentionedBots("@Milind and @New Bot and @Milind", peers).map((b) => b.id)).toEqual(["3", "1"]);
  });
  it("ignores emails, hidden bots, and mid-word @", () => {
    expect(mentionedBots("mail milind@milind.dev please", peers)).toEqual([]);
    expect(mentionedBots("@Ghost around?", peers)).toEqual([]);
  });
  it("routes Markdown- and punctuation-wrapped mentions", () => {
    expect(mentionedBots("**@Milind** (@New Bot 2) 【@New Bot】", peers).map((bot) => bot.id))
      .toEqual(["3", "2", "1"]);
    expect(mentionedBots("user@Milind /@Milind", peers)).toEqual([]);
  });
  it("requires a word boundary at the end of the name", () => {
    expect(mentionedBots("ask @New Bottle about it", peers)).toEqual([]);
    expect(mentionedBots("@Milindo is someone else", peers)).toEqual([]);
    expect(mentionedBots("@Milind𐐀 is someone else", peers)).toEqual([]);
  });
});

describe("roomResponders", () => {
  const members = [
    { id: "atlas", name: "Atlas" },
    { id: "milind", name: "Milind" },
  ];

  it("routes an unmentioned message to the configured lead", () => {
    expect(roomResponders("hello there", members, { kind: "member", botId: "atlas" })).toEqual([members[0]]);
  });

  it("lets explicit mentions override the configured lead", () => {
    expect(roomResponders("@Milind take this", members, { kind: "member", botId: "atlas" })).toEqual([members[1]]);
  });

  it("supports everyone and mentions-only room policies", () => {
    expect(roomResponders("hello", members, { kind: "everyone" })).toEqual(members);
    expect(roomResponders("hello", members, { kind: "mentions" })).toEqual([]);
    expect(roomResponders("@everyone hello", members, { kind: "mentions" })).toEqual(members);
  });

  it("applies the shared mention boundaries to everyone", () => {
    const mentionsOnly = { kind: "mentions" } as const;
    expect(roomResponders("**@EVERYONE** hello", members, mentionsOnly)).toEqual(members);
    expect(roomResponders("【@everyone】 hello", members, mentionsOnly)).toEqual(members);
    expect(roomResponders("@everyone調査 hello", members, mentionsOnly)).toEqual([]);
    expect(roomResponders("@everyone𐐀 hello", members, mentionsOnly)).toEqual([]);
    expect(roomResponders("user@everyone /@everyone", members, mentionsOnly)).toEqual([]);
  });

  it("keeps bot-to-bot channels on their last-speaker routing", () => {
    expect(normalizeGroupDefaultResponder({ kind: "everyone" }, members.map((member) => member.id), true)).toEqual({
      kind: "mentions",
    });
  });
});

describe("native MCP compatibility refusals", () => {
  let child: ChildProcess;
  let home: string;
  let stderr = "";
  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${BASE}${path}`, { method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const waitUntil = async (predicate: () => Promise<boolean>, timeout: number, what: string): Promise<void> => {
    const deadline = Date.now() + timeout;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error(`${what}. stderr: ${stderr.slice(-2000)}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };
  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    home = mkdtempSync(join(tmpdir(), "sagax-comms-catalog-"));
    mkdirSync(join(home, ".sagax"));
    writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({ instances: {
      grok: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "ask-peer" }, config: { cli: FAKE_CLI, fullAuto: true } },
      askerDelegate: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "delegate-peer" }, config: { cli: FAKE_CLI, fullAuto: true } },
    } }));
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], { cwd: join(SERVER_DIR, ".."),
      env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        HOME: home, USERPROFILE: home, SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1) },
      stdio: ["ignore", "pipe", "pipe"] });
    child.stdout!.resume();
    child.stderr!.on("data", chunk => { stderr += chunk; });
    await waitUntil(async () => {
      if (child.exitCode !== null) throw new Error(`Fixture exited: ${stderr}`);
      try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
    }, 20_000, "fixture never listened");
  }, 30_000);
  afterAll(async () => {
    await waitForExit(child, { signal: "SIGTERM" });
    if (home) await removeTempDir(home);
  });
  it("seals the internal comms endpoints behind the boot token", async () => {
    const agents = await api("GET", "/api/internal/agents?self=x");
    expect(agents.status).toBe(401);
    const ask = await api("POST", "/api/internal/ask-bot", { toBotId: "x", message: "hi" });
    expect(ask.status).toBe(401);
  });

  it.each([
    { instanceId: "grok", tool: "ask_bot", prefix: "peer error:" },
    { instanceId: "askerDelegate", tool: "delegate_bot", prefix: "delegate error:" },
  ])("reports the removed $tool fixture call in ordinary chat instead of an empty reply", async ({ instanceId, tool, prefix }) => {
    const caller = (await api("POST", "/api/bots")).body.bot;
    await api("PATCH", `/api/bots/${caller.id}`, {
      name: "Outdated fixture",
      section: "Fixture protocol regression",
      modelSelection: { instanceId, model: "fake-model" },
    });
    expect((await api("POST", `/api/bots/${caller.id}/messages`, { text: "Try the old communication fixture." })).status).toBe(202);
    let current: any;
    await waitUntil(async () => {
      current = (await api("GET", "/api/bots")).body.bots.find((bot: any) => bot.id === caller.id);
      return !current.busy && current.messages.some((message: any) => message.text?.startsWith(prefix));
    }, 15_000, "the fixture did not surface its protocol error");
    const answer = current.messages.findLast((message: any) => message.role === "bot" && message.kind === "text");
    expect(answer.text).toContain(`Unknown tool: ${tool}`);
    expect(answer.text).toContain("Fixture MCP request failed");
    expect(current.messages.some((message: any) => /^(peer says:|delegated:)\s*$/.test(message.text ?? ""))).toBe(false);
    await api("PATCH", `/api/bots/${caller.id}`, { hidden: true });
  }, 30_000);

});

// The old channels and delegation ledger were replaced deliberately by
// be8ceecc7 and runtime lot 3 (543ea88e7, 6db1f4b60, 012ffc903).
// Keep each old guarantee on the current transport: one durable request,
// one child dispatch/report/wake, attributed request lines, approval and
// conversation scope, honest failures and the native one-hop catalog.
const coordinate = (bot: CommsBot, message: string, mode: "work" | "consult" = "work") =>
  ({ arguments: { bot_ids: [bot.id], message, mode } });
const turns = (f: CommsRuntimeFixture, bot: CommsBot) => f.evidence().filter(turn => turn.botId === bot.id);
const children = (f: CommsRuntimeFixture, bot: CommsBot) => f.assignments().filter(row => row.parentId && row.assignee.botId === bot.id);
const textOf = (turn: any) => JSON.stringify(turn.prompt);

async function runRoutine(f: CommsRuntimeFixture, bot: CommsBot, prompt: string) {
  const { routine } = await f.api("POST", "/api/routines", { name: "Runtime communication fixture", botId: bot.id,
    prompt, enabled: false, schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 } }, 201);
  const started = await f.api("POST", `/api/routines/${routine.id}/run`, {}, 201);
  let run: any;
  await expect.poll(async () => {
    run = (await f.api("GET", "/api/routines")).runs.find((row: any) => row.id === started.run.id);
    return run?.threadId;
  }, { timeout: 20_000, interval: 100 }).toBeTruthy();
  return { routineId: routine.id as string, id: run.id as string, threadId: run.threadId as string };
}

async function finishRun(f: CommsRuntimeFixture, run: { id: string }, expected = "completed") {
  let current: any;
  await expect.poll(async () => {
    current = (await f.api("GET", "/api/routines")).runs.find((row: any) => row.id === run.id);
    return current?.status;
  }, { timeout: 60_000, interval: 100 }).toBe(expected);
  await f.settled();
  return current;
}

async function oneDelivery(f: CommsRuntimeFixture, owner: CommsBot, peer: CommsBot, threadId: string, result: string) {
  await f.settled();
  expect(turns(f, peer)).toHaveLength(1);
  expect(turns(f, owner).filter(turn => turn.resumed)).toHaveLength(1);
  const [child] = children(f, peer);
  expect(children(f, peer)).toHaveLength(1);
  expect(child).toMatchObject({ status: "completed", result, executions: 1, reply: "resume" });
  const received = await f.messages(child.assignee.destination.threadId);
  const request = received.filter((message: any) => message.roomRequest?.phase === "request");
  expect(request).toHaveLength(1);
  expect(request[0].from).toMatchObject({ botId: owner.id });
  expect(request[0].text).toContain(child.brief);
  const returned = await f.messages(threadId);
  const reports = returned.filter((message: any) => message.roomRequest?.id === child.id && message.roomRequest.phase === "result");
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({ from: { botId: peer.id }, tool: { ok: true } });
  expect(textOf(turns(f, owner).find(turn => turn.resumed))).toContain(result);
  expect(f.invariants()).toEqual([]);
}

async function externalCaller(f: CommsRuntimeFixture, bot: CommsBot, threadId = bot.threadId) {
  const file = join(f.dataDir, "external-runtimes.json");
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const token = `comms-external-${randomUUID()}`;
  writeFileSync(file, JSON.stringify({ ...saved, [bot.id]: { token, threadId } }), { mode: 0o600 });
  return async (method: string, path: string, body?: unknown) => {
    const response = await fetch(f.url + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as any };
  };
}

async function openCard(f: CommsRuntimeFixture, threadId: string, text?: string) {
  let found: any;
  await expect.poll(async () => {
    found = (await f.messages(threadId)).find((message: any) => message.card?.requestId && !message.card.answered
      && (!text || JSON.stringify(message.card).includes(text)));
    return Boolean(found);
  }, { timeout: 20_000, interval: 100 }).toBe(true);
  return found;
}

async function reviewPair(f: CommsRuntimeFixture, deny = false) {
  const peer = await f.bot("Helper");
  const owner = await f.bot("Asker", { approvePeerComms: true });
  f.plan[owner.id] = { steps: [{ ...coordinate(peer, "Guarded work"), ...(deny ? { expectError: true } : {}) }], reply: deny ? "Denied by user; no work sent" : "Requested work", resumeReply: "Guarded result received" };
  f.plan[peer.id] = { reply: "Guarded result" };
  f.save();
  const run = await runRoutine(f, owner, "Ask Helper for guarded work.");
  const card = await openCard(f, run.threadId);
  expect(card.card).toMatchObject({ allowKey: `delegate_bot:${peer.id}`, options: ["Allow", "Deny", "Always allow"] });
  expect(card.card.title).toContain("@Asker");
  expect(card.card.title).toContain("@Helper");
  expect(children(f, peer)).toHaveLength(0);
  expect(turns(f, peer)).toHaveLength(0);
  expect((await f.messages(peer.threadId)).some((message: any) => message.role === "user")).toBe(false);
  return { owner, peer, run, card };
}

describe("routine comms on the job runtime", () => {
  it("carries a question through native agents MCP and returns the attributed answer once", () => withCommsRuntime(async f => {
    const peer = await f.bot("Helper");
    const owner = await f.bot("Asker");
    f.plan[owner.id] = { steps: [coordinate(peer, "Which delimiter?", "consult")], reply: "Question sent", resumeReply: "The delimiter is semicolon" };
    f.plan[peer.id] = { reply: "Semicolon" };
    f.save();
    const run = await runRoutine(f, owner, "Ask the helper which delimiter to use.");
    await finishRun(f, run);
    await oneDelivery(f, owner, peer, run.threadId, "Semicolon");
    const shown = turns(f, owner)[0].evidence[0].result.tools.map((tool: any) => tool.name);
    expect(shown).toContain("coordinate_bots");
    expect(shown).not.toContain("ask_bot");
    expect(children(f, peer)[0].mode).toBe("consult");
    expect(textOf(turns(f, peer)[0])).toMatch(/act on nothing|Answer from what you know/);
    expect((await f.api("GET", "/api/bots")).groups.some((group: any) => group.dm)).toBe(false);
  }), 90_000);

  it("lets a Gemini Antigravity bot coordinate through its temporary native agents MCP mount", () => withCommsRuntime(async f => {
    const peer = await f.bot("Gemini Helper", { section: "Gemini MCP" });
    const owner = await f.bot("Gemini Asker", { section: "Gemini MCP", modelSelection: { instanceId: "geminiAsker", model: "gemini-3.8-flash-high" } });
    f.plan[owner.id] = { steps: [coordinate(peer, "Check the status", "consult")], reply: "Asked the helper", resumeReply: "Gemini received the status" };
    f.plan[peer.id] = { reply: "Cross-engine status ready" };
    f.save();
    const run = await runRoutine(f, owner, "Ask the other bot for a status check.");
    await finishRun(f, run);
    await oneDelivery(f, owner, peer, run.threadId, "Cross-engine status ready");
    expect(turns(f, owner)[0].protocol).toBe("acp");
    expect(turns(f, owner)[0].evidence[0].result.tools.map((tool: any) => tool.name)).toContain("coordinate_bots");
    expect(existsSync(join(f.dataDir, ".gemini", "config", "mcp_config.json"))).toBe(false);
  }), 90_000);

  it("lets a section Chief create a safe operator and coordinate its work on the runtime", () => withCommsRuntime(async f => {
    const owner = await f.bot("Atlas", { section: "Launch", chiefOfStaff: true });
    const defaults = owner.modelSelection;
    // Primary Bot creation keeps its existing owner-routine path. Only the
    // additional non-Primary creation path has the own-person-request rule.
    f.plan[owner.id] = {
      steps: [
        { tool: "create_bot", arguments: { name: "Pixel", role: "Product designer", instructions: "Design and review the user experience." } },
        { arguments: { bot_ids: ["Pixel"], message: "Review the new onboarding flow." } },
      ], reply: "Created and assigned Pixel", resumeReply: "Review received",
    };
    f.save();
    const run = await runRoutine(f, owner, "Create the specialist team and start the design review.");
    let operator: CommsBot;
    await expect.poll(async () => {
      operator = (await f.api("GET", "/api/bots")).bots.find((bot: any) => bot.name === "Pixel");
      return Boolean(operator);
    }, { timeout: 20_000, interval: 100 }).toBe(true);
    expect(operator!).toMatchObject({ title: "Product designer", description: "Design and review the user experience.", section: "Launch",
      approvalMode: "auto", approvePeerComms: false, modelSelection: defaults });
    expect((operator! as any).chiefOfStaff).toBeFalsy();
    expect((await f.messages(run.threadId)).some((message: any) => message.card?.title?.includes("Apply setup"))).toBe(false);
    await finishRun(f, run);
    await oneDelivery(f, owner, operator!, run.threadId, `Result from ${operator!.id}`);
    expect(children(f, operator!)[0].brief).toBe("Review the new onboarding flow.");
  }), 90_000);

  it("hands work off asynchronously and returns one durable result without a user nudge", () => withCommsRuntime(async f => {
    const peer = await f.bot("Helper");
    const owner = await f.bot("Asker");
    const sent = { internal: { path: "/api/internal/delegate-bot", body: { toBotId: peer.id, message: "Delegated task" }, saveAs: "task" } };
    f.plan[owner.id] = { steps: [sent, sent], reply: "Work queued", resumeReply: "Delegated result received" };
    f.plan[peer.id] = { reply: "Delegated task finished" };
    f.save();
    const run = await runRoutine(f, owner, "Have Helper finish the delegated task.");
    await finishRun(f, run);
    await oneDelivery(f, owner, peer, run.threadId, "Delegated task finished");
    const receipts = turns(f, owner)[0].evidence.filter((entry: any) => entry.internal).map((entry: any) => entry.internal.body);
    expect(receipts[0]).toMatchObject({ queued: true, taskId: children(f, peer)[0].id });
    expect(receipts[1]).toMatchObject({ duplicate: true, taskId: receipts[0].taskId });
    const unrelated = await f.bot("Unrelated conversation");
    const asOther = await externalCaller(f, unrelated);
    const refused = await asOther("GET", `/api/internal/delegations/${receipts[0].taskId}`);
    expect(refused.status).toBe(403);
    expect(refused.body).not.toHaveProperty("result");
  }), 90_000);

  it("keeps routine authority outside the person's request on the first handoff and a resumed second handoff", () => withCommsRuntime(async f => {
    const peer = await f.bot("Helper");
    const owner = await f.bot("Asker");
    f.plan[owner.id] = { turns: [
      { steps: [coordinate(peer, "First delegated task")], reply: "First task queued" },
      { steps: [{ arguments: { ...coordinate(peer, "Second delegated task").arguments, rework: true } }], reply: "Second task queued" },
      { reply: "Both task results received" },
    ] };
    f.plan[peer.id] = { reply: "Delegated work complete" };
    f.save();
    const run = await runRoutine(f, owner, "ROUTINE_LINEAGE: have Helper ship the CSV export");
    await finishRun(f, run);
    expect(children(f, peer)).toHaveLength(2);
    expect(turns(f, peer)).toHaveLength(2);
    expect(turns(f, owner).filter(turn => turn.resumed)).toHaveLength(2);
    for (const child of children(f, peer)) {
      // The legacy turn adapter maps WorkOrigin.OUTSIDE to outside/chat
      // with this run thread as ref (runtime-coordinator.ts runtimeOrigin).
      // A routine is intentionally OUTSIDE in requestWorkOrigin: neither
      // the first handoff nor a later rework gains the person's authority.
      expect(child.origin).toMatchObject({ kind: "outside", source: "chat", ref: run.threadId });
      expect(child.origin.quote).toBeUndefined();
      const requests = (await f.messages(child.assignee.destination.threadId)).filter((message: any) => message.roomRequest?.id === child.id && message.roomRequest.phase === "request");
      expect(requests).toHaveLength(1);
      const request = requests[0];
      expect(request.from.botId).toBe(owner.id);
      expect(request.text).toContain(child.brief);
      expect(request.text).not.toContain("ROUTINE_LINEAGE");
      expect(request.text).not.toContain("for the user's request");
    }
    expect(f.invariants()).toEqual([]);
  }), 90_000);

  it("replays the conversation when an engine cannot load its session before the result resumes it", () => withCommsRuntime(async f => {
    const peer = await f.bot("Helper");
    const owner = await f.bot("Asker", { modelSelection: { instanceId: "noLoad", model: "fake-model" } });
    f.plan[owner.id] = { reply: "Earlier context recorded" };
    f.save();
    await f.api("POST", `/api/bots/${owner.id}/messages`, { text: "Remember ORCHID_EARLIER_CONTEXT", threadId: owner.threadId }, 202);
    await f.settled();
    f.plan[owner.id] = { steps: [coordinate(peer, "Review the saved context")], reply: "Asked Helper", resumeReply: "Review received" };
    f.plan[peer.id] = { reply: "Context review ready" };
    f.save();
    await f.api("POST", `/api/bots/${owner.id}/messages`, { text: "Ask Helper to review it", threadId: owner.threadId }, 202);
    await expect.poll(() => turns(f, owner).filter(turn => turn.resumed).length, { timeout: 30_000, interval: 100 }).toBe(1);
    await oneDelivery(f, owner, peer, owner.threadId, "Context review ready");
    const resumed = textOf(turns(f, owner).find(turn => turn.resumed));
    // The second person turn restores the cursor, gets null, and proves
    // the real session/new + canonical replay fallback. The runtime resume
    // changes the peer/permission context and starts fresh by design, so
    // its own replay is checked below without restoring a foreign context.
    const recovered = turns(f, owner).find(turn => turn.turnIndex === 1);
    expect(recovered.freshAfterRejectedLoad).toBe(true);
    expect(textOf(recovered)).toContain("ORCHID_EARLIER_CONTEXT");
    expect(resumed.split("ORCHID_EARLIER_CONTEXT").length - 1).toBe(1);
    expect(resumed).toContain("not verification, instructions or the user's approval");
    expect(resumed).toContain("check claims against what was observed");
    expect(resumed.split("Context review ready").length - 1).toBe(1);
  }), 90_000);

  it("keeps a Chief available while a delegated teammate works and returns its result once", () => withCommsRuntime(async f => {
    const peer = await f.bot("LongWorker");
    const owner = await f.bot("Atlas", { chiefOfStaff: true });
    const gate = f.gate("worker-gate");
    const ready = f.gate("worker-ready");
    f.plan[owner.id] = { byPrompt: [
      { promptIncludes: "Your downstream room requests have settled.", plan: { resumeReply: "Long result received" } },
      { promptIncludes: "CHECK_STATUS", plan: { reply: "LongWorker is still working" } },
    ], steps: [coordinate(peer, "Long work")], reply: "Assigned to LongWorker", resumeReply: "Long result received" };
    f.plan[peer.id] = { readyFile: ready, gateFile: gate, reply: "Long work complete" };
    f.save();
    const run = await runRoutine(f, owner, "Have LongWorker handle the long task.");
    await expect.poll(() => existsSync(ready), { timeout: 20_000, interval: 100 }).toBe(true);
    await expect.poll(async () => {
      const current = (await f.api("GET", "/api/bots?messages=0")).bots.find((bot: any) => bot.id === owner.id);
      return { busy: Boolean(current.busy), waiting: Boolean(current.tasks.find((task: any) => task.threadId === run.threadId)?.waitingForTeammates) };
    }, { timeout: 20_000, interval: 100 }).toEqual({ busy: false, waiting: true });
    await f.api("POST", `/api/bots/${owner.id}/messages`, { text: "CHECK_STATUS What is happening?" }, 202);
    await expect.poll(async () => (await f.messages(owner.threadId)).some((message: any) => message.text === "LongWorker is still working"),
      { timeout: 20_000, interval: 100 }).toBe(true);
    expect((await f.messages(run.threadId)).some((message: any) => message.text?.includes("CHECK_STATUS"))).toBe(false);
    expect(children(f, peer)[0].status).toBe("running");
    writeFileSync(gate, "release");
    await finishRun(f, run);
    await oneDelivery(f, owner, peer, run.threadId, "Long work complete");
  }), 90_000);

  it("reports a teammate's approval immediately to the Chief and settles the linked waiting chip", () => withCommsRuntime(async f => {
    const peer = await f.bot("Gatekeeper", { approvalMode: "ask" });
    const owner = await f.bot("Warden", { chiefOfStaff: true });
    f.plan[owner.id] = { steps: [coordinate(peer, "Guarded task")], reply: "Assigned", resumeReply: "Guarded task finished" };
    f.plan[peer.id] = { approve: { tool_name: "Bash", input: { command: "rm -rf build" } }, reply: "Guarded work complete" };
    f.save();
    const run = await runRoutine(f, owner, "Have Gatekeeper do the guarded task.");
    let child: any;
    await expect.poll(() => {
      child = children(f, peer)[0];
      return child?.assignee.destination.threadId;
    }, { timeout: 20_000, interval: 100 }).toBeTruthy();
    const card = await openCard(f, child.assignee.destination.threadId);
    const asOwner = await externalCaller(f, owner, run.threadId);
    const at = Date.now();
    const status = await asOwner("GET", `/api/internal/delegations/${child.id}?wait_ms=30000`);
    expect(status.status).toBe(200);
    expect(Date.now() - at).toBeLessThan(5_000);
    expect(status.body).toMatchObject({ status: "running", toBotName: "Gatekeeper", awaitingPerson: { kind: "approval", threadTitle: expect.any(String) } });
    let chip: any;
    await expect.poll(async () => {
      chip = (await f.messages(run.threadId)).find((message: any) => message.threadRef?.threadId === child.assignee.destination.threadId);
      return chip?.tool?.name;
    }, { timeout: 10_000, interval: 100 }).toBe("Waiting on your approval in @Gatekeeper");
    expect(chip.threadRef.botId).toBe(peer.id);
    await f.api("POST", `/api/threads/${child.assignee.destination.threadId}/respond`, { requestId: card.card.requestId, behavior: "allow" });
    await finishRun(f, run);
    expect((await f.messages(run.threadId)).find((message: any) => message.id === chip.id)).toMatchObject({ tool: { name: "@Gatekeeper got your approval" } });
    await oneDelivery(f, owner, peer, run.threadId, "Guarded work complete");
  }), 90_000);

  it("queues a consultation to a busy peer and delivers it once the peer frees up", () => withCommsRuntime(async f => {
    const peer = await f.bot("GateHelper");
    const owner = await f.bot("GateAsker");
    const gate = f.gate("busy-peer");
    const ready = f.gate("busy-ready");
    f.plan[peer.id] = { byPrompt: [
      { promptIncludes: "Which delimiter?", plan: { reply: "Semicolons" } },
      { promptIncludes: "KEEP_BUSY", plan: { readyFile: ready, gateFile: gate, reply: "Previous work complete" } },
    ], reply: "Unexpected work" };
    f.plan[owner.id] = { steps: [coordinate(peer, "Which delimiter?", "consult")], reply: "Consultation queued", resumeReply: "Semicolons received" };
    f.save();
    await f.api("PATCH", "/api/config", { threads: { maxConcurrentPerBot: 1 } });
    await f.api("POST", `/api/bots/${peer.id}/tasks`, { title: "Consultation destination" }, 201);
    await f.api("POST", `/api/bots/${peer.id}/messages`, { text: "KEEP_BUSY until released", threadId: peer.threadId }, 202);
    await expect.poll(() => existsSync(ready), { timeout: 20_000, interval: 100 }).toBe(true);
    const run = await runRoutine(f, owner, "Ask GateHelper which delimiter to use.");
    await expect.poll(() => children(f, peer)[0]?.status, { timeout: 20_000, interval: 100 }).toBe("queued");
    expect(turns(f, peer)).toHaveLength(0);
    writeFileSync(gate, "release");
    await finishRun(f, run);
    const consultations = turns(f, peer).filter(turn => textOf(turn).includes("Which delimiter?"));
    expect(consultations).toHaveLength(1);
    expect(children(f, peer)).toHaveLength(1);
    expect(children(f, peer)[0]).toMatchObject({ mode: "consult", status: "completed", result: "Semicolons", executions: 1 });
    expect(turns(f, owner).filter(turn => turn.resumed)).toHaveLength(1);
    expect(f.invariants()).toEqual([]);
  }), 90_000);

  it("keeps an allowed native consultation through busy provider reload and resumes once without asking twice", () => withCommsRuntime(async f => {
    const peer = await f.bot("ReloadHelper", { modelSelection: { instanceId: "compat", model: "fake-model" } });
    const owner = await f.bot("ReloadAsker", { approvePeerComms: true });
    f.plan[owner.id] = { steps: [coordinate(peer, "Approved consultation", "consult")], reply: "Consultation queued", resumeReply: "Approved result received" };
    f.save();
    await f.api("PATCH", "/api/config", { threads: { maxConcurrentPerBot: 1 } });
    await f.api("POST", `/api/bots/${peer.id}/tasks`, { title: "Approved consultation destination" }, 201);
    const run = await runRoutine(f, owner, "Ask ReloadHelper for the approved consultation.");
    const card = await openCard(f, run.threadId);
    expect(children(f, peer)).toHaveLength(0);
    await f.api("POST", `/api/bots/${peer.id}/messages`, { text: "Hold until reload", threadId: peer.threadId }, 202);
    await expect.poll(() => f.compatPrompts.some(body => body.includes("Hold until reload")), { timeout: 20_000, interval: 100 }).toBe(true);
    await f.api("POST", `/api/threads/${run.threadId}/respond`, { requestId: card.card.requestId, behavior: "allow" });
    await expect.poll(() => children(f, peer)[0]?.status, { timeout: 20_000, interval: 100 }).toBe("queued");
    f.setCompat("reply");
    await f.api("PUT", "/api/config", { openaiCompat: { key: "comms-fixture-reloaded-key", url: f.compatUrl } });
    await finishRun(f, run);
    const [child] = children(f, peer);
    expect(child).toMatchObject({ mode: "consult", status: "completed", result: "Compat result delivered", executions: 1 });
    expect((await f.messages(run.threadId)).filter((message: any) => message.card?.requestId)).toHaveLength(1);
    expect(children(f, peer)).toHaveLength(1);
    expect(f.compatPrompts.filter(body => body.includes("Approved consultation"))).toHaveLength(1);
    expect(turns(f, owner).filter(turn => turn.resumed)).toHaveLength(1);
    expect(textOf(turns(f, owner).find(turn => turn.resumed))).toContain("Compat result delivered");
    const reports = (await f.messages(run.threadId)).filter((message: any) => message.roomRequest?.id === child.id && message.roomRequest.phase === "result");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ from: { botId: peer.id }, tool: { ok: true } });
    expect(f.invariants()).toEqual([]);
  }), 90_000);

  it("ends only a slow consultation's synchronous wait and keeps the late result on the same request", () => withCommsRuntime(async f => {
    const peer = await f.bot("SlowHelper");
    const owner = await f.bot("SlowAsker");
    const gate = f.gate("slow-peer");
    const ready = f.gate("slow-ready");
    f.plan[peer.id] = { readyFile: ready, gateFile: gate, reply: "Late result" };
    f.save();
    const asOwner = await externalCaller(f, owner);
    const started = Date.now();
    const pending = await asOwner("POST", "/api/internal/ask-bot", { toBotId: peer.id, message: "Wait for the slow result" });
    expect(existsSync(ready)).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15_000);
    expect(pending.body).toMatchObject({ timeout: true, taskId: expect.any(String), waitedMs: 15_000 });
    expect(children(f, peer)[0]).toMatchObject({ id: pending.body.taskId, mode: "consult", status: "running", executions: 1 });
    writeFileSync(gate, "release");
    await expect.poll(async () => (await asOwner("GET", `/api/internal/delegations/${pending.body.taskId}`)).body.status, { timeout: 30_000, interval: 100 }).toBe("done");
    expect((await asOwner("GET", `/api/internal/delegations/${pending.body.taskId}`)).body.result).toBe("Late result");
    expect(children(f, peer)).toHaveLength(1);
    expect(turns(f, peer)).toHaveLength(1);
    expect(turns(f, owner)).toHaveLength(0);
    await f.settled();
    expect(f.invariants()).toEqual([]);
  }), 90_000);

  it("records a successful image-only teammate as completed with one positive terminal report", () => withCommsRuntime(async f => {
    const peer = await f.bot("Helper", { modelSelection: { instanceId: "image", model: "fake-model" } });
    const owner = await f.bot("Asker");
    f.plan[owner.id] = { steps: [coordinate(peer, "Render the fixture image")], reply: "Image assigned", resumeReply: "Image complete" };
    f.save();
    const run = await runRoutine(f, owner, "Have Helper render the image.");
    await finishRun(f, run);
    expect(children(f, peer)).toHaveLength(1);
    const [child] = children(f, peer);
    expect(child.status).toBe("completed");
    const reports = (await f.messages(run.threadId)).filter((message: any) => message.roomRequest?.id === child.id && message.roomRequest.phase === "result");
    expect(reports).toHaveLength(1);
    expect(reports[0].tool.ok).toBe(true);
    expect((await f.messages(child.assignee.destination.threadId)).some((message: any) => message.attachments?.some((attachment: any) => attachment.kind === "image" && attachment.mime === "image/png"))).toBe(true);
    expect(turns(f, owner).filter(turn => turn.resumed)).toHaveLength(1);
    expect(f.invariants()).toEqual([]);
  }), 90_000);

  it("reports a delegated turn cut by provider reload as interrupted rather than silently completed", () => withCommsRuntime(async f => {
    const peer = await f.bot("Helper", { modelSelection: { instanceId: "compat", model: "fake-model" } });
    const owner = await f.bot("Asker");
    f.plan[owner.id] = { steps: [coordinate(peer, "Work until the provider changes")], reply: "Work assigned", resumeReply: "Reported provider interruption" };
    f.save();
    const run = await runRoutine(f, owner, "Have Helper work on the guarded task.");
    await expect.poll(() => f.compatPrompts.some(body => body.includes("Work until the provider changes")), { timeout: 20_000, interval: 100 }).toBe(true);
    f.setCompat("reply");
    await f.api("PUT", "/api/config", { openaiCompat: { key: "comms-interrupted-provider-key", url: f.compatUrl } });
    await f.settled();
    const [child] = children(f, peer);
    expect(child.status).toBe("failed");
    expect(child.result).toContain("provider settings changed");
    expect(child.executions).toBe(1);
    const reports = (await f.messages(run.threadId)).filter((message: any) => message.roomRequest?.id === child.id && message.roomRequest.phase === "result");
    expect(reports).toHaveLength(1);
    expect(reports[0].tool.ok).toBe(false);
    expect(f.invariants()).toEqual([]);
  }), 90_000);

  it("returns a teammate's 64-step cap to its requester without an unattended Continue thread", () => withCommsRuntime(async f => {
    f.setCompat("steps");
    const peer = await f.bot("CapHelper", { modelSelection: { instanceId: "compat", model: "fake-model" } });
    const owner = await f.bot("Asker");
    f.plan[owner.id] = { steps: [coordinate(peer, "Export under the fixture step cap")], reply: "Export assigned", resumeReply: "Reported step cap" };
    f.save();
    const run = await runRoutine(f, owner, "Have CapHelper export the report.");
    await expect.poll(() => children(f, peer)[0]?.status, { timeout: 45_000, interval: 100 }).toBe("failed");
    await f.settled();
    const [child] = children(f, peer);
    expect(child.status).toBe("failed");
    expect(child.result).toContain("Stopped after 64 steps without a final answer");
    const reports = (await f.messages(run.threadId)).filter((message: any) => message.roomRequest?.id === child.id && message.roomRequest.phase === "result");
    expect(reports).toHaveLength(1);
    expect(reports[0].tool.ok).toBe(false);
    expect(reports[0].tool.name).not.toContain("\n");
    const tasks = (await f.api("GET", "/api/bots")).bots.find((bot: any) => bot.id === peer.id).tasks;
    expect(tasks.filter((task: any) => task.title?.startsWith("Continue:"))).toEqual([]);
    expect(children(f, peer)).toHaveLength(1);
    expect(f.invariants()).toEqual([]);
  }), 90_000);

  it("returns a teammate provider's actual failure words to its requester", () => withCommsRuntime(async f => {
    f.setCompat("limit");
    const peer = await f.bot("LimitHelper", { modelSelection: { instanceId: "compat", model: "fake-model" } });
    const owner = await f.bot("LimitAsker");
    f.plan[owner.id] = { steps: [coordinate(peer, "Check the provider report")], reply: "Asked Helper", resumeReply: "Provider refusal reported" };
    f.save();
    await runRoutine(f, owner, "Have LimitHelper check the report.");
    await expect.poll(() => children(f, peer)[0]?.status, { timeout: 45_000, interval: 100 }).toBe("failed");
    await f.settled();
    const [child] = children(f, peer);
    expect(child.status).toBe("failed");
    expect(child.result).toContain("Rate limit reached for fake-model: 30 requests per minute");
    expect(textOf(turns(f, owner).find(turn => turn.resumed))).toContain("Rate limit reached for fake-model: 30 requests per minute");
    expect(children(f, peer)).toHaveLength(1);
    expect(f.invariants()).toEqual([]);
  }), 90_000);

  it("keeps the attributed request and one failed terminal report when a teammate engine crashes", () => withCommsRuntime(async f => {
    const peer = await f.bot("Helper", { modelSelection: { instanceId: "crash", model: "fake-model" } });
    const owner = await f.bot("Asker");
    f.plan[owner.id] = { steps: [coordinate(peer, "Delegated task before the crash")], reply: "Work assigned", resumeReply: "Crash reported" };
    f.save();
    const run = await runRoutine(f, owner, "Have Helper finish the task.");
    await expect.poll(() => children(f, peer)[0]?.status, { timeout: 45_000, interval: 100 }).toBe("failed");
    await f.settled();
    const [child] = children(f, peer);
    expect(child.status).toBe("failed");
    expect(child.result.trim()).not.toBe("");
    expect(child.executions).toBe(1);
    const reports = (await f.messages(run.threadId)).filter((message: any) => message.roomRequest?.id === child.id && message.roomRequest.phase === "result");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ from: { botId: peer.id }, tool: { ok: false } });
    const request = (await f.messages(child.assignee.destination.threadId)).find((message: any) => message.roomRequest?.phase === "request");
    expect(request).toMatchObject({ from: { botId: owner.id } });
    expect(request.text).toContain("Delegated task before the crash");
    expect(f.invariants()).toEqual([]);
  }), 90_000);

  it("refuses a teammate whose engine is unavailable before sending or creating runtime work", () => withCommsRuntime(async f => {
    // Preserve #819's missing registry entry case: this is not an engine
    // that exists but crashes or is interrupted after it was dispatched.
    const peer = await f.bot("Helper", { modelSelection: { instanceId: "missing-instance", model: "fake-model" } });
    const owner = await f.bot("Asker");
    f.plan[owner.id] = { steps: [{ ...coordinate(peer, "Must not be delivered"), expectError: true }], reply: "Helper cannot work with the unavailable engine" };
    f.save();
    const run = await runRoutine(f, owner, "Have Helper pick this up.");
    await finishRun(f, run);
    const answer = turns(f, owner)[0].evidence.find((entry: any) => entry.step?.arguments?.message === "Must not be delivered").response;
    expect(answer.result.isError).toBe(true);
    expect(JSON.stringify(answer)).toMatch(/unavailable|not installed|cannot|can't|ne peut pas/i);
    expect(children(f, peer)).toHaveLength(0);
    expect(turns(f, peer)).toHaveLength(0);
    expect((await f.messages(peer.threadId)).some((message: any) => message.role === "user" || message.roomRequest)).toBe(false);
    expect((await f.messages(run.threadId)).some((message: any) => message.roomRequest?.phase === "result")).toBe(false);
    expect(f.invariants()).toEqual([]);
  }), 90_000);

  it("holds native peer work on its source card and starts the teammate only after Allow", () => withCommsRuntime(async f => {
    const { owner, peer, run, card } = await reviewPair(f);
    await f.api("POST", `/api/threads/${run.threadId}/respond`, { requestId: card.card.requestId, behavior: "allow" });
    await finishRun(f, run);
    await oneDelivery(f, owner, peer, run.threadId, "Guarded result");
  }), 90_000);

  it("records Deny and never starts the teammate or creates a request in its conversation", () => withCommsRuntime(async f => {
    const { owner, peer, run, card } = await reviewPair(f, true);
    await f.api("POST", `/api/threads/${run.threadId}/respond`, { requestId: card.card.requestId, behavior: "deny" });
    await f.settled();
    const persisted = (await f.messages(run.threadId)).find((message: any) => message.card?.requestId === card.card.requestId);
    expect(persisted.card.answered).toBe("deny");
    expect((await f.messages(run.threadId)).some((message: any) => message.text === "Denied by user; no work sent")).toBe(true);
    expect(children(f, peer)).toHaveLength(0);
    expect(turns(f, peer)).toHaveLength(0);
    expect((await f.messages(peer.threadId)).some((message: any) => message.role === "user" || message.roomRequest)).toBe(false);
    const response = turns(f, owner)[0].evidence.find((entry: any) => entry.step?.arguments?.message === "Guarded work").response;
    expect(response.result.isError).toBe(true);
    expect(JSON.stringify(response)).toContain("Denied by user");
    expect(f.invariants()).toEqual([]);
  }), 90_000);

  it("offers no peer-starting tools on an actual depth-one native MCP connection and refuses another hop", () => withCommsRuntime(async f => {
    const peer = await f.bot("Helper");
    const owner = await f.bot("Asker");
    // Coordinated descendants now use the runtime tree. Their real nested
    // dispatch/catalog is pinned in direct-coordination.e2e.test.ts
    // ("coordinates a lead and its specialist...") and the typed depth
    // refusal in runtime/runtime.test.ts ("refuses with typed reasons...").
    // This separate non-coordinated capability keeps the one-hop guard.
    const scoped = await f.catalogAtDepth(owner, peer, 1);
    for (const name of ["ask_bot", "delegate_bot", "check_delegation", "wait_delegation", "coordinate_bots", "send_to_bot", "list_room_targets", "start_thread", "route_message", "send_prompt", "await_turn", "create_agent", "delete_agent"]) {
      expect(scoped.names, name).not.toContain(name);
    }
    for (const name of ["memory_update", "memory_log", "attach_file", "list_bots"]) expect(scoped.names, name).toContain(name);
    expect(scoped.ask.status).toBe(200);
    expect(scoped.ask.body.error).toMatch(/one hop|depth/i);
    expect(children(f, peer)).toHaveLength(0);
    expect(turns(f, peer)).toHaveLength(0);
    expect((await f.messages(peer.threadId)).some((message: any) => message.role === "user" || message.roomRequest)).toBe(false);
  }), 60_000);
});
