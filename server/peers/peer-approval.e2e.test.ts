import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../../scripts/control-omb.ts";
import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { handoffOutcome, readHandoffs } from "../testing/handoff-rows.ts";

it("preserves peer approval expiry through real HTTP responses and durable delegation receipts", async () => {
  const fixture = await launchVerificationServer(process.env);
  const { url, dataDir, logPath } = fixture.info;
  const gate = join(dataDir, "finish-provider");
  const expiry = join(dataDir, "expire-peer-approval");
  const evidence: unknown[] = [];
  let child: ChildProcess | undefined;
  const api = async (method: string, path: string, body?: unknown, token?: string, expectedStatus?: number) => {
    const response = await fetch(url + path, {
      method, headers: { "content-type": "application/json", origin: url,
        ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    if (expectedStatus !== undefined) expect(response.status).toBe(expectedStatus);
    else expect(response.ok, `${method} ${path}: ${JSON.stringify(result)}`).toBe(true);
    return result as any;
  };
  const cli = (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=100`)).messages as any[];
  const card = async (threadId: string) => {
    let found: any;
    await expect.poll(async () => {
      found = (await messages(threadId)).find(m => m.card?.requestId && !m.card.answered && !m.card.dismissed);
      return Boolean(found);
    }, { timeout: 15_000 }).toBe(true);
    return found;
  };
  try {
    expect((await cli("doctor")).ok).toBe(true);
    const from = (await cli("new-bot", "--name", "Approval source")).bot;
    const target = (await cli("new-bot", "--name", "Approval target")).bot;
    target.threadId = target.activeTaskId;
    // A new bot starts at Full access (#2218), which contacts peers without a
    // card (#2469); Ask is the level whose peer contact waits for a card.
    await api("PATCH", `/api/bots/${from.id}`, { approvePeerComms: true, approvalMode: "ask" });
    // Reuse the shared launcher's disposable data and restricted environment.
    // The import hook controls only the peer timer, not approval or dispatch.
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const env = verificationServerEnvironment({ ...process.env, FAKE_CLAUDE_MODE: "slow",
      FAKE_CLAUDE_SLOW_FINISH_GATE: gate }, dataDir, Number(new URL(url).port));
    env.SAGAX_TEST_PEER_APPROVAL = "1";
    const log = openSync(logPath, "a", 0o600);
    child = spawn(process.execPath, ["--import", new URL("../testing/peer-approval-hooks.mjs", import.meta.url).href,
      fileURLToPath(new URL("../index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)), env, stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      try { return (await fetch(url + "/api/health")).ok; } catch { return false; }
    }, { timeout: 20_000 }).toBe(true);
    // Routines retain the one-hop ask/delegate lifecycle. Ordinary chat uses
    // coordinate_bots instead; do not bypass that production routing boundary.
    const created = await api("POST", "/api/routines", {
      name: "Peer approval fixture", prompt: "Hold this fixture turn while approval is tested.",
      botId: from.id, enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
    });
    const started = await api("POST", `/api/routines/${created.routine.id}/run`);
    await expect.poll(async () => {
      const run = (await api("GET", "/api/routines")).runs.find((r: any) => r.id === started.run.id);
      from.threadId = run?.threadId;
      return Boolean(from.threadId);
    }, { timeout: 15_000 }).toBe(true);
    let token = "";
    await expect.poll(() => {
      try { token = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")).mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN; }
      catch { return false; }
      return Boolean(token);
    }, { timeout: 15_000 }).toBe(true);
    for (const outcome of ["deny", "expired"] as const) {
      const pending = api("POST", "/api/internal/ask-bot", { toBotId: target.id, message: "Do not dispatch without approval" }, token);
      void pending.catch(() => {}); // retain the rejection for the awaited assertion below
      const approval = await card(from.threadId);
      if (outcome === "deny") await api("POST", `/api/threads/${from.threadId}/respond`, { requestId: approval.card.requestId, behavior: "deny" });
      else writeFileSync(expiry, "expire");
      const result = await pending;
      expect(result).toMatchObject({ approvalOutcome: outcome, approvalSource: outcome === "deny" ? "user" : "system" });
      expect(result.error).toBe(outcome === "deny" ? "denied by user" : "the approval card expired without an answer");
      const settled = (await messages(from.threadId)).find(m => m.id === approval.id);
      expect(settled.card).toMatchObject({ answered: "deny", dismissed: outcome !== "deny" });
      evidence.push({ operation: "ask-bot", outcome, result, card: settled.card });
      rmSync(expiry, { force: true });
    }
    // A peer may become private while its approval is open. The failure
    // receipt may echo the addressed id, but must not disclose its new name.
    const unavailableAsk = api("POST", "/api/internal/ask-bot", { toBotId: target.id, message: "Check access again after approval" }, token);
    void unavailableAsk.catch(() => {});
    const unavailableCard = await card(from.threadId);
    await api("PATCH", `/api/bots/${target.id}`, { hidden: true, name: "Private renamed teammate" });
    await api("POST", `/api/threads/${from.threadId}/respond`, { requestId: unavailableCard.card.requestId, behavior: "allow" });
    const unavailableResult = await unavailableAsk;
    expect(unavailableResult.receipt).toMatchObject({ botId: target.id, outcome: "failed" });
    expect(unavailableResult.receipt).not.toHaveProperty("botName");
    expect(JSON.stringify(unavailableResult)).not.toContain("Private renamed teammate");
    expect((await messages(target.threadId)).some(m => m.role === "user")).toBe(false);
    evidence.push({ operation: "ask-bot-after-visibility-revocation", result: unavailableResult, targetDispatched: false });
    await api("PATCH", `/api/bots/${target.id}`, { hidden: false, name: target.name });

    // A routine's delegate_bot runs on the job runtime since lot 3 (0.8.24,
    // docs/runtime-contract.md): its durable receipt is the runtime's row in
    // runtime.db, the one check_delegation reads back. delegation-receipts.json
    // keeps run_with_engine parts only. The call is not held on the card: the
    // work waits queued for the person's review (reviewHolds), and a card
    // nobody answers refuses it at the next tick. The row ends failed (outcome
    // refused), never completed, with the expiry as its result and no turn
    // started; the system dismissed the card, the person never answered it.
    const queued = await api("POST", "/api/internal/delegate-bot", { toBotId: target.id, message: "Fixture delegation awaiting approval" }, token);
    expect(queued).toMatchObject({ queued: true, approvalRequired: true, receipt: { botId: target.id, outcome: "queued" } });
    writeFileSync(gate, "finish");
    const approval = await card(from.threadId);
    writeFileSync(expiry, "expire");
    let receipt: any;
    await expect.poll(() => (receipt = readHandoffs(dataDir).find(row => row.id === queued.taskId))?.status,
      { timeout: 15_000 }).toBe("failed");
    expect(receipt).toMatchObject({ botId: target.id, executions: 0, approvalGranted: false,
      result: "the approval card expired without an answer; no work sent." });
    expect(handoffOutcome(dataDir, queued.taskId)).toBe("refused");
    expect((await messages(from.threadId)).find(m => m.id === approval.id).card).toMatchObject({ answered: "deny", dismissed: true });
    expect((await messages(target.threadId)).some(m => m.role === "user")).toBe(false);
    expect((await api("GET", "/api/bots?messages=0")).bots.find((bot: any) => bot.id === target.id).busy).toBe(false);
    evidence.push({ operation: "delegate-bot", receipt, outcome: "refused", targetDispatched: false });
    expect((await cli("wait", "--bot", from.id, "--task", from.threadId, "--timeout", "25")).status).toBe("settled");

    // Ordinary chat's multi-target gate must retain each refusal's origin,
    // rather than saying that every target was denied by the user.
    rmSync(expiry, { force: true });
    rmSync(gate, { force: true });
    rmSync(fixture.fixtureDumpPath, { force: true });
    const other = (await cli("new-bot", "--name", "Second approval target")).bot;
    await cli("send", "--bot", from.id, "--task", from.threadId, "--text", "Check the completed handoff and request two teammates.");
    await expect.poll(() => {
      try { token = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")).mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN; }
      catch { return false; }
      return Boolean(token);
    }, { timeout: 15_000 }).toBe(true);
    // check_delegation reads the same runtime row back, in its own words.
    const readback = await api("GET", `/api/internal/delegations/${queued.taskId}?fromBotId=${from.id}&fromThreadId=${from.threadId}`, undefined, token);
    expect(readback).toMatchObject({ status: "failed", result: "the approval card expired without an answer; no work sent." });
    const pendingBatch = api("POST", "/api/internal/coordinate-bots", {
      botIds: [target.id, other.id], message: "Neither teammate should start", requestKey: "approval-fixture-batch",
    }, token, 403);
    void pendingBatch.catch(() => {});
    let cards: any[] = [];
    await expect.poll(async () => {
      cards = (await messages(from.threadId)).filter(m => m.card?.requestId && !m.card.answered && !m.card.dismissed);
      return cards.length;
    }, { timeout: 15_000 }).toBe(2);
    const first = cards.find(m => m.card.title.endsWith(`@${target.name}`));
    expect(first).toBeDefined();
    await api("POST", `/api/threads/${from.threadId}/respond`, { requestId: first.card.requestId, behavior: "deny" });
    writeFileSync(expiry, "expire");
    const batch = await pendingBatch;
    expect(batch.approvals).toEqual([
      { botId: target.id, error: "denied by user", approvalOutcome: "deny", approvalSource: "user" },
      { botId: other.id, error: "the approval card expired without an answer", approvalOutcome: "expired", approvalSource: "system" },
    ]);
    expect(batch.error).toContain("no work sent");
    expect((await messages(target.threadId)).some(m => m.role === "user")).toBe(false);
    expect((await messages(other.activeTaskId)).some(m => m.role === "user")).toBe(false);
    evidence.push({ operation: "check-delegation", readback }, { operation: "coordinate-bots", result: batch });
    writeFileSync(gate, "finish");
    expect((await cli("wait", "--bot", from.id, "--task", from.threadId, "--timeout", "25")).status).toBe("settled");
  } finally {
    await waitForExit(child, { signal: "SIGTERM" });
    const evidencePath = `${logPath}.peer-approval.json`;
    writeFileSync(evidencePath, JSON.stringify({ evidence }, null, 2));
    console.info(JSON.stringify({ logPath, evidencePath }));
    await fixture.close();
  }
}, 100_000);

// Isolation between people: a teammate hidden and renamed while the person's
// peer card is open is another person's private bot by the time the card is
// answered. Every receipt path that answers then (ask_bot's refused review,
// delegate_bot and coordinate_bots after an allow) names it by the id the
// caller sent, never by its new name, and nothing reaches it.
it("never names a teammate hidden and renamed while its peer card is open, on every receipt path", async () => {
  const gates = mkdtempSync(join(tmpdir(), "peer-approval-gates-"));
  const held = join(gates, "held");
  const PRIVATE = "Private renamed teammate";
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_GATE_DIR: gates });
  const { url } = fixture.info;
  const api = async (method: string, path: string, body?: unknown, token?: string, expectedStatus?: number) => {
    const response = await fetch(url + path, {
      method, headers: { "content-type": "application/json", origin: url,
        ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    if (expectedStatus !== undefined) expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(expectedStatus);
    else expect(response.ok, `${method} ${path}: ${JSON.stringify(result)}`).toBe(true);
    return result as any;
  };
  const cli = (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=100`)).messages as any[];
  try {
    expect((await cli("doctor")).ok).toBe(true);
    const from = (await cli("new-bot", "--name", "Privacy source")).bot;
    const target = (await cli("new-bot", "--name", "Privacy teammate")).bot;
    // A new bot starts at Full access (#2218), which contacts peers without a
    // card (#2469); Ask is the level whose peer contact waits for a card.
    await api("PATCH", `/api/bots/${from.id}`, { approvePeerComms: true, approvalMode: "ask" });
    // One chat turn held open by its gate: its comms token stays active
    // while each card waits on the person.
    await cli("send", "--bot", from.id, "--task", from.activeTaskId, "--text", "Hold this turn while teammates are reviewed [gate:held]");
    let token = "";
    await expect.poll(() => {
      try { token = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")).mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN; }
      catch { return false; }
      return Boolean(token);
    }, { timeout: 15_000 }).toBe(true);
    const openCard = async () => {
      let found: any;
      await expect.poll(async () => {
        found = (await messages(from.activeTaskId)).find(m => m.card?.requestId && !m.card.answered && !m.card.dismissed);
        return Boolean(found);
      }, { timeout: 15_000 }).toBe(true);
      return found;
    };
    // The teammate turns private while the card is open, then the person answers.
    const answerAfterHiding = async (pending: Promise<any>, behavior: "allow" | "deny") => {
      void pending.catch(() => {}); // retained for the awaited assertion
      const card = await openCard();
      await api("PATCH", `/api/bots/${target.id}`, { hidden: true, name: PRIVATE });
      await api("POST", `/api/threads/${from.activeTaskId}/respond`, { requestId: card.card.requestId, behavior });
      const result = await pending;
      await api("PATCH", `/api/bots/${target.id}`, { hidden: false, name: target.name });
      return result;
    };

    const denied = await answerAfterHiding(api("POST", "/api/internal/ask-bot",
      { toBotId: target.id, message: "Ask once the teammate is private" }, token), "deny");
    expect(denied).toMatchObject({ approvalOutcome: "deny", approvalSource: "user", receipt: { botId: target.id, outcome: "failed" } });
    expect(denied.receipt).not.toHaveProperty("botName");
    expect(JSON.stringify(denied)).not.toContain(PRIVATE);

    const delegated = await answerAfterHiding(api("POST", "/api/internal/delegate-bot",
      { toBotId: target.id, message: "Delegate once the teammate is private" }, token), "allow");
    expect(delegated).toMatchObject({ error: "that bot is no longer available to this bot", receipt: { botId: target.id, outcome: "failed" } });
    expect(delegated.receipt).not.toHaveProperty("botName");
    expect(JSON.stringify(delegated)).not.toContain(PRIVATE);

    const coordinated = await answerAfterHiding(api("POST", "/api/internal/coordinate-bots",
      { botIds: [target.id], message: "Coordinate once the teammate is private" }, token, 409), "allow");
    expect(coordinated.receipts).toEqual([{ botId: target.id, outcome: "failed", detail: "that bot is no longer available to this bot" }]);
    expect(JSON.stringify(coordinated)).not.toContain(PRIVATE);

    // Nothing reached the teammate, not even an empty work thread, and the
    // person's conversation never shows the new name.
    const teammate = (await api("GET", "/api/bots?messages=0")).bots.find((bot: any) => bot.id === target.id);
    expect(teammate.tasks.map((task: any) => task.threadId)).toEqual([target.activeTaskId]);
    expect((await messages(target.activeTaskId)).some(m => m.role === "user")).toBe(false);
    expect(JSON.stringify(await messages(from.activeTaskId))).not.toContain(PRIVATE);
    writeFileSync(held, "finish");
    expect((await cli("wait", "--bot", from.id, "--task", from.activeTaskId, "--timeout", "25")).status).toBe("settled");
  } finally {
    writeFileSync(held, "finish");
    await fixture.close();
    await removeTempDir(gates);
  }
}, 100_000);
