// Real isolated server + native Claude permission broker + a software
// security key (server/testing/fake-authenticator.ts). No real model calls,
// user profiles, shell commands or live application data are used.
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../../scripts/control-omb.ts";
import { fakeAuthenticator } from "../testing/fake-authenticator.ts";

it("an Allow in a chosen class needs the person's key, bound to that card, once", async () => {
  // Desktop mode: the first key needs this computer's own person or a
  // recent interactive sign-in; a headless server's loopback is neither
  // (server/auth/recent-sign-in.ts, 2026-10-18).
  const owner = randomBytes(32).toString("base64url");
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "hang", SAGAX_TEST_DESKTOP_OWNER_TOKEN: owner });
  const { url, dataDir } = fixture.info;
  const port = new URL(url).port;
  const localhost = `http://localhost:${port}`;
  const sockets: Socket[] = [];
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(url + path, { method, headers: { origin: url, "content-type": "application/json", "x-openmausbot-desktop-owner": owner },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    return { status: response.status, body: await response.json() as any };
  };
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const result = await call(method, path, body);
    expect(result.status, `${method} ${path}: ${JSON.stringify(result.body)}`).toBe(status);
    return result.body;
  };
  const key = fakeAuthenticator();
  /** What the ceremony page does: fetch the options, ask the key, post. */
  const ceremony = async (start: { ceremonyId: string; kind: string }) => {
    const options = (await api("GET", `/api/security-keys/ceremony/${start.ceremonyId}`)).options;
    const response = start.kind === "register" ? key.register(options, localhost, "localhost") : key.assert(options, localhost, "localhost");
    await api("POST", `/api/security-keys/ceremony/${start.ceremonyId}`, { response });
  };
  const card = async (thread: string, id: string) =>
    (await api("GET", `/api/threads/${thread}/messages?limit=100`)).messages.find((message: any) => message.card?.requestId === id)?.card;
  const ask = async (socketPath: string, command: string) => {
    const socket = connect(socketPath);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    const id = randomUUID();
    let buffer = "";
    const reply = new Promise<any>((resolve, reject) => {
      socket.once("error", reject);
      socket.setTimeout(15_000, () => socket.destroy(new Error(`Permission reply timed out: ${id}`)));
      socket.on("data", (chunk) => {
        buffer += chunk;
        if (buffer.includes("\n")) resolve(JSON.parse(buffer.split("\n")[0]!));
      });
    });
    void reply.catch(() => {});
    socket.write(JSON.stringify({ t: "ask", id, tool: "Bash", input: { command } }) + "\n");
    await expect.poll(async () => Boolean(await card(threadId, id)), { timeout: 15_000 }).toBe(true);
    return { id, reply };
  };
  let threadId = "";
  try {
    // a key, then the class
    await ceremony(await api("POST", "/api/security-keys/register", { name: "Fixture key", via: "desktop-window" }));
    await api("PUT", "/api/security-keys/classes", { classes: ["destructive"] });

    const bot = (await api("POST", "/api/bots", { name: "Step-up fixture", modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }, 201)).bot;
    threadId = bot.threadId;
    await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, { approvalMode: "ask" });
    const dump = join(dataDir, "fake-claude-dump.json");
    rmSync(dump, { force: true });
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId, text: "Hold this verification task while its approvals are exercised." }, 202);
    await expect.poll(() => existsSync(dump), { timeout: 15_000 }).toBe(true);
    const socketPath = JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.ogb.args.at(-1) as string;

    const first = await ask(socketPath, "rm /tmp/sagax-step-up-fixture-a");
    // no key: refused, with what to sign
    const refused = await call("POST", `/api/threads/${threadId}/respond`, { requestId: first.id, behavior: "allow" });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "step_up_required", classes: ["destructive"], target: { kind: "approval", requestId: first.id } });
    expect((await card(threadId, first.id)).answered).toBeUndefined();
    // the AI client and voice paths carry no key either: same refusal
    expect((await call("POST", `/api/bots/${bot.id}/respond`, { threadId, requestId: first.id, behavior: "allow" })).status).toBe(403);

    const second = await ask(socketPath, "rm /tmp/sagax-step-up-fixture-b");
    // a step-up signed for the second card does not approve the first
    const forSecond = await api("POST", "/api/security-keys/begin", { target: { kind: "approval", threadId, requestId: second.id, answer: {} }, via: "desktop-window" });
    await ceremony(forSecond);
    expect((await call("POST", `/api/threads/${threadId}/respond`, { requestId: first.id, behavior: "allow", stepUp: forSecond.ceremonyId })).body)
      .toMatchObject({ code: "step_up_failed", reason: "wrong-target" });

    // the right one, once
    const forFirst = await api("POST", "/api/security-keys/begin", { target: refused.body.target, via: "desktop-window" });
    await ceremony(forFirst);
    expect((await api("POST", `/api/threads/${threadId}/respond`, { requestId: first.id, behavior: "allow", stepUp: forFirst.ceremonyId })).outcome).toBe("allowed-once");
    expect(await first.reply).toMatchObject({ id: first.id, behavior: "allow" });
    // replayed on another card: refused
    expect((await call("POST", `/api/threads/${threadId}/respond`, { requestId: second.id, behavior: "allow", stepUp: forFirst.ceremonyId })).status).toBe(403);

    // declining never needs a key
    await api("POST", `/api/threads/${threadId}/respond`, { requestId: second.id, behavior: "deny" });
    expect(await second.reply).toMatchObject({ id: second.id, behavior: "deny" });
    await api("POST", `/api/bots/${bot.id}/interrupt`, { threadId });
    const idle = (await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Approval level" }, 201)).task.threadId as string;
    await api("PATCH", `/api/bots/${bot.id}/tasks/${idle}`, { approvalMode: "ask" });

    // A looser approval level needs the key too, once "rule-change" is chosen
    await api("PUT", "/api/security-keys/classes", { classes: ["destructive", "rule-change", "always-grant"] });
    const looser = await call("PATCH", `/api/bots/${bot.id}/tasks/${idle}`, { approvalMode: "auto", acknowledgeLocalAuto: true });
    expect(looser.status, JSON.stringify(looser.body)).toBe(403);
    expect(looser.body).toMatchObject({ code: "step_up_required", target: { kind: "settings", action: "approval-mode", detail: { op: "thread", botId: bot.id, thread: idle, mode: "auto" } } });
    const forMode = await api("POST", "/api/security-keys/begin", { target: looser.body.target, via: "desktop-window" });
    await ceremony(forMode);
    await api("PATCH", `/api/bots/${bot.id}/tasks/${idle}`, { approvalMode: "auto", acknowledgeLocalAuto: true, stepUp: forMode.ceremonyId });
    // back to Ask tightens: no key
    await api("PATCH", `/api/bots/${bot.id}/tasks/${idle}`, { approvalMode: "ask" });
    // a permission refresh copying the bot's Auto onto the thread loosens too
    const refresh = await call("PATCH", `/api/bots/${bot.id}/tasks/${idle}`, { refreshPermissions: true, acknowledgeLocalAuto: true });
    expect(refresh.status, JSON.stringify(refresh.body)).toBe(403);
    expect(refresh.body).toMatchObject({ code: "step_up_required", target: { action: "approval-mode", detail: { op: "refresh", thread: idle } } });

    // the desktop's Full goes through a one-time allowance asked here first
    const full = await call("POST", "/api/security-keys/approval-mode", { botId: bot.id, op: "bot", thread: "*", mode: "full" });
    expect(full.body).toMatchObject({ code: "step_up_required" });
    const forFull = await api("POST", "/api/security-keys/begin", { target: full.body.target, via: "desktop-window" });
    await ceremony(forFull);
    const allowed = await api("POST", "/api/security-keys/approval-mode", { botId: bot.id, op: "bot", thread: "*", mode: "full", stepUp: forFull.ceremonyId });
    expect(allowed.allowance).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // the step-up for "bot Full" does not count for "all threads to Full"
    expect((await call("POST", "/api/security-keys/approval-mode", { botId: bot.id, op: "all-threads", thread: "*", mode: "full", stepUp: forFull.ceremonyId })).status).toBe(403);

    // a saved command runs without asking: it needs the key ("always-grant")
    const saved = await call("POST", `/api/bots/${bot.id}/command-allowlist`, { command: "printf saved", cwd: dataDir, providerInstanceId: "claude" });
    expect(saved.status, JSON.stringify(saved.body)).toBe(403);
    expect(saved.body).toMatchObject({ code: "step_up_required", target: { action: "command-allowlist" } });
  } finally {
    for (const socket of sockets) socket.destroy();
    await fixture.close();
  }
}, 90_000);
