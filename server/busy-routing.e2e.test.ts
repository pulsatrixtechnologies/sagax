// A message sent while the bot works, routed by the bot (server/busy-routing.ts,
// Owner 2026-10-18: no chooser). The real harness with two fake engines:
// - the fake claude CLI in `slow` mode, which takes words live (steer); each
//   prompt carrying [gate:NAME] holds its reply until the test drops that
//   gate, and a steered message carrying a marker makes it call
//   route_message, as the model reading it mid-turn would;
// - the fake ACP CLI (grokAgent, echo-gated), which cannot take words live:
//   the server classifies instead, a parallel task or the queue, never an
//   error.
//
// POSIX-gated like the other CLI e2es (the fakes are shebang scripts).
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const FAKE_ACP = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");

posixOnly("busy sends routed by the bot e2e", () => {
  let child: ChildProcess;
  let home: string;
  let gates: string;
  let acpGate: string;
  let base = "";
  let stderr = "";

  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const getBot = async (id: string) => (await api("GET", "/api/bots")).body.bots.find((b: any) => b.id === id);
  const messages = async (threadId: string): Promise<any[]> =>
    (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).body.messages ?? [];
  const tasks = async (botId: string): Promise<any[]> => (await getBot(botId)).tasks ?? [];
  const open = (name: string) => writeFileSync(join(gates, name), "go");
  const waitFor = async (predicate: () => Promise<boolean>, what: string, ms = 30_000) => {
    const deadline = Date.now() + ms;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. stderr: ${stderr.slice(-3000)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const busyBot = async (instanceId: string, first: string) => {
    const bot = (await api("POST", "/api/bots")).body.bot;
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId, model: instanceId === "claude" ? "claude-fake" : "fake-model" } });
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: first, threadId: bot.threadId })).status).toBe(202);
    await waitFor(async () => (await getBot(bot.id)).busy === true, "the main turn to start");
    // the fake claude takes words live once its turn is under way (its tool chip)
    if (instanceId === "claude") await waitFor(async () => (await messages(bot.threadId)).some((m) => m.kind === "activity"), "the tool chip");
    return bot as { id: string; threadId: string };
  };
  const auto = (bot: { id: string; threadId: string }, text: string) =>
    api("POST", `/api/bots/${bot.id}/messages`, { text, threadId: bot.threadId, routeWhileBusy: true });

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    chmodSync(FAKE_ACP, 0o755);
    home = mkdtempSync(join(tmpdir(), "sagax-busy-route-"));
    gates = join(home, "gates");
    acpGate = join(home, "acp-gate");
    mkdirSync(gates, { recursive: true });
    mkdirSync(join(home, ".sagax"), { recursive: true });
    const route = (when: string, mode: "parallel" | "after", resources?: string[]) => ({
      server: "agents", tool: "route_message", onSteer: true, when,
      arguments: { handle: "$ROUTE_HANDLE", mode, ...(resources ? { resources } : {}) },
    });
    writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({
      instances: {
        claude: {
          driver: "claudeAgent",
          environment: {
            FAKE_CLAUDE_MODE: "slow",
            FAKE_CLAUDE_GATE_DIR: gates,
            FAKE_CLAUDE_MCP_CALLS: JSON.stringify([
              route("ROUTE_PARALLEL_ONE", "parallel", ["id:4242"]),
              route("ROUTE_PARALLEL_TWO", "parallel", ["ID:4242"]),
              route("ROUTE_AFTER", "after"),
            ]),
          },
          config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
        },
        grok: {
          driver: "grokAgent",
          environment: { FAKE_ACP_MODE: "echo-gated", FAKE_ACP_GATE_FILE: acpGate },
          config: { cli: FAKE_ACP, fullAuto: true },
        },
      },
    }));
    const port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home, SAGAX_PORT: String(port) },
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
  }, 30_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (!child || child.exitCode !== null) return resolve();
      child.on("close", () => resolve());
      setTimeout(() => (child.kill("SIGKILL"), resolve()), 5_000).unref?.();
    });
    rmSync(home, { recursive: true, force: true });
  });

  it("an engine that steers: a correction joins the work, the bot routes the rest (parallel, one line per resource, after)", async () => {
    const bot = await busyBot("claude", "[gate:main] refactor the billing module");

    // a correction: steered in with the routing note, nothing else happens
    const correction = await auto(bot, "actually keep the old function names");
    expect(correction.status, JSON.stringify(correction.body)).toBe(202);
    expect(correction.body.steered, JSON.stringify(correction.body)).toBe(true);

    // an independent request: the bot calls route_message parallel; the
    // person's row becomes the request of a parallel task (no second row)
    const first = await auto(bot, "ROUTE_PARALLEL_ONE [gate:p1] Prépare le courriel de bienvenue du client 4242");
    expect(first.body.steered).toBe(true);
    const firstId = first.body.message.id as string;
    await waitFor(async () => (await messages(bot.threadId)).some((m) => m.id === firstId && m.parallelTask?.role === "request"), "the first request to become a parallel task");
    const p1 = (await messages(bot.threadId)).find((m) => m.id === firstId).parallelTask.threadId as string;
    await waitFor(async () => (await tasks(bot.id)).find((task) => task.threadId === p1)?.busy === true, "the first parallel task to run");
    const firstTask = (await tasks(bot.id)).find((task) => task.threadId === p1);
    expect(firstTask.parallelOf).toMatchObject({ threadId: bot.threadId, messageId: firstId, routed: true, resources: ["id:4242"] });
    expect((await messages(bot.threadId)).filter((m) => m.text?.includes("ROUTE_PARALLEL_ONE") && m.role === "user")).toHaveLength(1);
    expect((await messages(bot.threadId)).find((m) => m.id === firstId).steered).toBe(false);

    // a second task on the same record waits in that record's line
    const second = await auto(bot, "ROUTE_PARALLEL_TWO [gate:p2] Ajoute une note au dossier 4242 pour la facture");
    const secondId = second.body.message.id as string;
    await waitFor(async () => (await messages(bot.threadId)).some((m) => m.id === secondId && m.parallelTask?.role === "request"), "the second request to become a parallel task");
    const p2 = (await messages(bot.threadId)).find((m) => m.id === secondId).parallelTask.threadId as string;
    await new Promise((r) => setTimeout(r, 1_000));
    expect((await tasks(bot.id)).find((task) => task.threadId === p2)?.busy).toBe(false);
    expect((await messages(bot.threadId)).find((m) => m.parallelTask?.role === "card" && m.parallelTask.threadId === p2).parallelTask.state).toBe("queued");

    // a dependent request: route_message after keeps the row and waits
    const later = await auto(bot, "ROUTE_AFTER Ensuite, envoie le résumé au client");
    const laterId = later.body.message.id as string;
    await waitFor(async () => (await messages(bot.threadId)).find((m) => m.id === laterId)?.steered === false, "the dependent request to be set aside");

    // the first task finishes: the record's line moves, the second starts
    open("p1");
    await waitFor(async () => (await tasks(bot.id)).find((task) => task.threadId === p2)?.busy === true, "the second task once the record is free");
    open("p2");
    await waitFor(async () => (await messages(bot.threadId)).filter((m) => m.parallelTask?.role === "result").length === 2, "both results");

    // the main turn ends with the correction folded in; the set-aside request runs next, on its own row
    open("main");
    await waitFor(async () => (await messages(bot.threadId)).some((m) => m.role === "bot" && m.text?.startsWith("reply to:") && m.text.includes("You set this message aside")), "the set-aside request's turn");
    await waitFor(async () => (await getBot(bot.id)).busy === false, "every turn to settle");
    const main = await messages(bot.threadId);
    const mainReply = main.find((m) => m.role === "bot" && !m.parallelTask && m.text?.startsWith("reply to:") && !m.text.includes("You set this message aside"));
    expect(mainReply.text).toContain("keep the old function names");
    expect(mainReply.text, mainReply.text).toContain("[Sent while you work · route ");
    expect(main.filter((m) => m.role === "user" && m.text === "ROUTE_AFTER Ensuite, envoie le résumé au client")).toHaveLength(1);
    expect(main.find((m) => m.id === laterId).queueId).toBeTruthy();
  }, 90_000);

  it("an engine that cannot steer: the server routes, parallel or the queue, never an error", async () => {
    if (existsSync(acpGate)) rmSync(acpGate);
    const bot = await busyBot("grok", "audit the September invoices");
    // depends on the running work: queued behind it
    const dependent = await auto(bot, "Ensuite, envoie le rapport au client");
    expect(dependent.status).toBe(202);
    expect(dependent.body.queued).toBe(true);
    // a correction cannot join a turn that takes no words live: it waits too
    const correction = await auto(bot, "actually only the paid ones");
    expect(correction.body.queued).toBe(true);
    // 2026-11-01: an engine with no one-shot model (Grok over ACP) gives
    // the bot no say, and the guess is the running work's one follow-up,
    // never a second session answering beside it
    const independent = await auto(bot, "Draft the onboarding email for the new client");
    expect(independent.status).toBe(202);
    expect(independent.body.queued).toBe(true);
    expect((await tasks(bot.id)).filter((task) => task.parallelOf)).toHaveLength(0);
    writeFileSync(acpGate, "go");
    await waitFor(async () => (await getBot(bot.id)).busy === false && (await messages(bot.threadId)).some((m) => m.role === "user" && m.text === "Draft the onboarding email for the new client"), "the queue to drain");
    // the three waiting lines were answered by one follow-up turn
    const rows = await messages(bot.threadId);
    const firstWaiting = rows.findIndex((m) => m.role === "user" && m.text === "Ensuite, envoie le rapport au client");
    expect(rows.slice(firstWaiting).filter((m) => m.role === "user").map((m) => m.text)).toEqual([
      "Ensuite, envoie le rapport au client", "actually only the paid ones", "Draft the onboarding email for the new client",
    ]);
    await waitFor(async () => (await messages(bot.threadId)).slice(firstWaiting).some((m) => m.role === "bot" && m.kind === "text"), "the follow-up's answer");
    expect((await messages(bot.threadId)).slice(firstWaiting).filter((m) => m.role === "bot" && m.kind === "text")).toHaveLength(1);
    expect(stderr).toMatch(/\[busy-route\] .* after \(default, no live steer\)/);
  }, 90_000);

  it("a send that names no mode still joins the running turn (API, older builds)", async () => {
    const bot = await busyBot("claude", "[gate:main3] long work");
    const plain = await api("POST", `/api/bots/${bot.id}/messages`, { text: "ROUTE_PARALLEL_ONE but no route note", threadId: bot.threadId });
    expect(plain.body.steered).toBe(true);
    await new Promise((r) => setTimeout(r, 800));
    expect((await tasks(bot.id)).some((task) => task.parallelOf)).toBe(false);
    open("main3");
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the turn to settle");
    const reply = (await messages(bot.threadId)).find((m) => m.role === "bot" && m.text?.startsWith("reply to:"));
    expect(reply.text).not.toContain("Sent while you work");
  }, 60_000);
});
