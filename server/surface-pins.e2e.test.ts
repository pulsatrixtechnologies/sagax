// Surface-pin provenance end to end: a person's pin survives a Works on
// change, Auto records no pin at all (owner 2026-10-16: Auto picks each turn),
// the boot repair clears the auto pins an older build left, and it preserves
// unknown pins from before provenance existed. Real server, fake engine, and a
// restartable fixture home so tests can seed bots.json between boots — the
// sourceless pin shapes only exist on disk.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { freePortBlock } from "./testing/ports.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { readCuaConnection } from "./local-computer.ts";
import { DESKTOP_PARENT_IMPORT, DESKTOP_PARENT_STDIO, handDesktopComputer } from "./testing/desktop-computer.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("surface pin provenance against the real server", () => {
  let home = "";
  let data = "";
  let ui = "";
  let stateFile = "";
  let dumpFile = "";
  let finishFile = "";
  let output = "";
  let child: ChildProcess | null = null;
  let base = "";
  let boatServer: Server;
  let boatApi = "";
  let boatDown = false;

  const vmState = (state: Record<string, unknown> = {}) => writeFileSync(stateFile, JSON.stringify(state));
  const resetTurn = () => { vmState(); rmSync(dumpFile, { force: true }); rmSync(finishFile, { force: true }); };
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const apiOk = async (method: string, path: string, body?: unknown) => {
    const result = await api(method, path, body);
    expect(result.status, `${method} ${path}: ${JSON.stringify(result.body)}`).toBeLessThan(400);
    return result.body;
  };
  async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean): Promise<T> {
    const end = Date.now() + 20_000;
    for (;;) {
      const value = await read();
      if (accept(value)) return value;
      if (Date.now() >= end) throw new Error(`Fixture wait expired: ${JSON.stringify(value)}`);
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }
  const dump = (): Promise<any> => until((): any => {
    if (!existsSync(dumpFile)) return null;
    try { return JSON.parse(readFileSync(dumpFile, "utf8")); } catch { return null; }
  }, Boolean);
  const mountedComputer = (sent: any) => sent.mcpConfig.mcpServers.computer;
  // The first screen tools/call, exactly as the mounted proxy issues it
  // (issue #1650: a claim and its pin land on use, not on mount).
  const gate = (c: any) => fetch(c.env.SAGAX_CONTROL_URL, {
    headers: { authorization: `Bearer ${c.env.SAGAX_CONTROL_TOKEN}` },
  }).then(response => response.json() as Promise<any>);
  const threadState = (botId: string, threadId: string) =>
    api("GET", "/api/bots?messages=0").then(({ body }) =>
      body.bots.find((bot: any) => bot.id === botId)?.tasks.find((task: any) => task.threadId === threadId));
  const busy = (botId: string, threadId: string) => until(() => threadState(botId, threadId), Boolean);
  const idle = (botId: string, threadId: string) => until(() => threadState(botId, threadId), task => !task?.busy);
  const savedTask = (botId: string, threadId: string) =>
    (JSON.parse(readFileSync(join(data, "bots.json"), "utf8")) as any[])
      .find((bot: any) => bot.id === botId)?.tasks.find((task: any) => task.threadId === threadId);
  const editSavedBot = (botId: string, edit: (bot: any) => void) => {
    const bots = JSON.parse(readFileSync(join(data, "bots.json"), "utf8")) as any[];
    edit(bots.find((bot: any) => bot.id === botId));
    writeFileSync(join(data, "bots.json"), JSON.stringify(bots, null, 2));
  };

  async function start() {
    const port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    output = "";
    const proc = spawn(process.execPath, ["--import", pathToFileURL(join(ROOT, "server/testing/group-local-vm-hooks.mjs")).href, ...DESKTOP_PARENT_IMPORT, join(ROOT, "server/index.ts")], {
      cwd: ROOT, env: { SAGAX_TEST_FIXED_WORKSPACE: "1", SAGAX_TEST_SEAMS: "1",
        PATH: dirname(process.execPath), ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_DATA_DIR: data,
        APPDATA: join(home, "appdata"), LOCALAPPDATA: join(home, "localappdata"),
        TEMP: home, TMP: home, TMPDIR: home,
        SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1), SAGAX_STATIC_DIR: ui, SAGAX_TEST_VM_STATE: stateFile,
        SAGAX_BOX_API: boatApi, SAGAX_USER_DATA: join(home, "user-data"),
      }, stdio: [...DESKTOP_PARENT_STDIO],
    });
    child = proc;
    proc.stdout!.on("data", chunk => { output += chunk; });
    proc.stderr!.on("data", chunk => { output += chunk; });
    await until(async () => {
      if (proc.exitCode !== null) throw new Error(`server exited during boot:\n${output}`);
      try { return (await fetch(base + "/api/health")).ok; } catch { return false; }
    }, Boolean);
  }
  async function stop() {
    if (!child) return;
    const proc = child;
    child = null;
    writeFileSync(finishFile, "finish");
    await waitForExit(proc, { signal: "SIGTERM" });
  }

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "omb-surface-pins-"));
    data = join(home, "data");
    ui = join(home, "static");
    stateFile = join(home, "vm.json");
    dumpFile = join(home, "dump.json");
    finishFile = join(home, "finish");
    vmState();
    mkdirSync(data);
    mkdirSync(join(ui, "assets"), { recursive: true });
    writeFileSync(join(ui, "index.html"), "<title>Surface pins</title>");
    writeFileSync(join(ui, "assets", "test.css"), "body{}");
    boatServer = createServer(async (req, res) => {
      res.setHeader("content-type", "application/json");
      const path = new URL(req.url ?? "/", "http://box.fixture").pathname;
      if (boatDown && path.startsWith("/boxes")) { res.statusCode = 503; return res.end(JSON.stringify({ error: "Fixture Boat unavailable" })); }
      if (path === "/boxes") return res.end(JSON.stringify({ boxes: [] }));
      return res.end("{}");
    });
    await new Promise<void>(resolve => boatServer.listen(0, "127.0.0.1", resolve));
    boatApi = `http://127.0.0.1:${(boatServer.address() as { port: number }).port}`;
    writeFileSync(join(data, "config.json"), JSON.stringify({ instances: { claude: {
      driver: "claudeAgent", config: { cli: join(ROOT, "server/testing/fake-claude-cli.ts") },
      // A turn on the cloud computer uses it: its first computer call is
      // what reaches the Boat, as with a real model.
      environment: { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_DUMP: dumpFile, FAKE_CLAUDE_SLOW_FINISH_GATE: finishFile, FAKE_CLAUDE_USES_CLOUD_COMPUTER: "1" },
    } } }));
  });
  afterAll(async () => {
    await stop();
    if (boatServer) await new Promise<void>(resolve => boatServer.close(() => resolve()));
    if (home) await removeTempDir(home);
  });
  afterEach(async () => { await stop(); resetTurn(); boatDown = false; });

  it("marks a person's thread pin as theirs and clears provenance with the pin", async () => {
    await start();
    const { bot } = await apiOk("POST", "/api/bots", { name: "Pin Bot" });
    const { task } = await apiOk("POST", `/api/bots/${bot.id}/tasks`, {});
    await apiOk("PATCH", `/api/bots/${bot.id}/tasks/${task.threadId}`, { surface: "local" });
    expect(savedTask(bot.id, task.threadId)).toMatchObject({ surface: "local", surfaceSource: "user" });
    const personPin = await threadState(bot.id, task.threadId);
    expect(personPin).toMatchObject({ surface: "local" });
    expect(personPin).not.toHaveProperty("surfaceAuto");
    await apiOk("PATCH", `/api/bots/${bot.id}/tasks/${task.threadId}`, { surface: null });
    const cleared = savedTask(bot.id, task.threadId)!;
    expect(cleared.surface).toBeUndefined();
    expect(cleared.surfaceSource).toBeUndefined();
    await apiOk("DELETE", `/api/bots/${bot.id}`);
    await stop();
  });

  it("still refuses to change a busy thread's surface", async () => {
    await start();
    const { bot } = await apiOk("POST", "/api/bots", { name: "Busy Pin Bot" });
    const { task } = await apiOk("POST", `/api/bots/${bot.id}/tasks`, {});
    resetTurn();
    await apiOk("POST", `/api/bots/${bot.id}/messages`, { text: "Work slowly.", threadId: task.threadId });
    await busy(bot.id, task.threadId);
    // The turn's first screen call claims the ready VM, and the running
    // Auto turn records nothing: the conversation stays on Auto.
    expect(await gate(mountedComputer(await dump()))).toEqual({ held: false, helpOpen: false });
    const refused = await api("PATCH", `/api/bots/${bot.id}/tasks/${task.threadId}`, { surface: "vm" });
    expect(refused.status).toBe(409);
    expect(savedTask(bot.id, task.threadId)).not.toHaveProperty("surface");
    writeFileSync(finishFile, "finish");
    await idle(bot.id, task.threadId);
    await apiOk("DELETE", `/api/bots/${bot.id}`);
    await stop();
  });

  it("clears every auto pin an older build left at boot, and keeps the person's pin", async () => {
    await start();
    const { bot } = await apiOk("POST", "/api/bots", { name: "Sweep Bot" });
    const [autoMismatch, personMismatch, autoMatch] = (await Promise.all([
      apiOk("POST", `/api/bots/${bot.id}/tasks`, {}),
      apiOk("POST", `/api/bots/${bot.id}/tasks`, {}),
      apiOk("POST", `/api/bots/${bot.id}/tasks`, {}),
    ])).map(({ task }) => task);
    await apiOk("PATCH", `/api/bots/${bot.id}/tasks/${personMismatch.threadId}`, { surface: "local" });
    await stop();
    // Seed positively identified machine pins; missing provenance is unknown.
    editSavedBot(bot.id, saved => {
      Object.assign(saved.tasks.find((task: any) => task.threadId === autoMismatch.threadId), { surface: "local", surfaceSource: "auto" });
      Object.assign(saved.tasks.find((task: any) => task.threadId === autoMatch.threadId), { surface: "vm", surfaceSource: "auto" });
    });
    await start(); // Auto remembers no place: both auto pins go, once.
    expect(output.match(/auto-pinned thread/g)).toHaveLength(1);
    expect(savedTask(bot.id, autoMismatch.threadId)?.surface).toBeUndefined();
    expect(savedTask(bot.id, autoMatch.threadId)?.surface).toBeUndefined();
    expect(savedTask(bot.id, personMismatch.threadId)).toMatchObject({ surface: "local", surfaceSource: "user" });
    await apiOk("PATCH", `/api/bots/${bot.id}`, { computer: "vm" });
    await apiOk("PATCH", `/api/bots/${bot.id}`, { computer: null });
    expect(savedTask(bot.id, personMismatch.threadId)).toMatchObject({ surface: "local", surfaceSource: "user" });
    await stop();
    await start();
    expect(output).not.toContain("auto-pinned thread");
    await apiOk("DELETE", `/api/bots/${bot.id}`);
    await stop();
  });

  it("preserves pre-provenance user pins at boot and after Works on changes", async () => {
    await start();
    const { bot } = await apiOk("POST", "/api/bots", { name: "Repair Bot" });
    const { task } = await apiOk("POST", `/api/bots/${bot.id}/tasks`, {});
    await apiOk("PATCH", `/api/bots/${bot.id}/tasks/${task.threadId}`, { surface: "local" });
    await stop();
    editSavedBot(bot.id, saved => {
      saved.computer = "vm";
      const target = saved.tasks.find((entry: any) => entry.threadId === task.threadId);
      target.surface = "local";
      delete target.surfaceSource;
    });
    await start();
    expect(output).not.toContain("auto-pinned thread");
    expect(savedTask(bot.id, task.threadId)?.surface).toBe("local");
    expect(savedTask(bot.id, task.threadId)?.surfaceSource).toBeUndefined();
    const place = await apiOk("GET", `/api/bots/${bot.id}/computer?threadId=${task.threadId}`);
    expect(place.surface).toBe("local");
    await apiOk("PATCH", `/api/bots/${bot.id}`, { computer: "browser" });
    expect(savedTask(bot.id, task.threadId)?.surface).toBe("local");
    await stop();
    await start();
    expect(output).not.toContain("auto-pinned thread");
    expect(savedTask(bot.id, task.threadId)?.surface).toBe("local");
    await apiOk("DELETE", `/api/bots/${bot.id}`);
    await stop();
  });

  it("mounts the VM for a turn into a thread auto-pinned to this computer", async () => {
    await start();
    const { bot } = await apiOk("POST", "/api/bots", { name: "Incident Bot" });
    const { task } = await apiOk("POST", `/api/bots/${bot.id}/tasks`, {});
    await apiOk("PATCH", `/api/bots/${bot.id}/tasks/${task.threadId}`, { surface: "local" });
    await stop();
    editSavedBot(bot.id, saved => {
      saved.computer = "vm";
      saved.tasks.find((entry: any) => entry.threadId === task.threadId).surfaceSource = "auto";
    });
    await start(); // The boot repair moved the thread to the bot's Works on.
    expect(output.match(/auto-pinned thread/g)).toHaveLength(1);
    await stop();
    await start(); // Known auto pins are repaired only once.
    expect(output).not.toContain("auto-pinned thread");
    resetTurn();
    await apiOk("POST", `/api/bots/${bot.id}/messages`, { text: "Work where you should.", threadId: task.threadId });
    const sent = await dump();
    expect(sent.systemPrompt).toContain("Local VM");
    expect(mountedComputer(sent).args.some((arg: string) => arg.includes("container-mcp"))).toBe(true);
    expect(sent.systemPrompt).not.toContain("You can act on the user's computer");
    writeFileSync(finishFile, "finish");
    await idle(bot.id, task.threadId);
    expect(savedTask(bot.id, task.threadId)?.surface).toBeUndefined();
    await apiOk("DELETE", `/api/bots/${bot.id}`);
    await stop();
  });

  it("records no pin when an Auto turn claims the VM, and the next turn decides again", async () => {
    await start();
    const { bot } = await apiOk("POST", "/api/bots", { name: "New Auto Pin Bot" });
    const { task } = await apiOk("POST", `/api/bots/${bot.id}/tasks`, {});
    resetTurn();
    await apiOk("POST", `/api/bots/${bot.id}/messages`, { text: "Use the available computer.", threadId: task.threadId });
    expect(mountedComputer(await dump()).args.some((arg: string) => arg.includes("container-mcp"))).toBe(true);
    // The first screen tools/call takes the seat, and the conversation
    // stays on Auto: nothing is recorded, before or after.
    expect(savedTask(bot.id, task.threadId)).not.toHaveProperty("surface");
    expect(await gate(mountedComputer(await dump()))).toEqual({ held: false, helpOpen: false });
    writeFileSync(finishFile, "finish");
    await idle(bot.id, task.threadId);
    expect(savedTask(bot.id, task.threadId)).not.toHaveProperty("surface");
    expect(savedTask(bot.id, task.threadId)).not.toHaveProperty("surfaceSource");
    const thread = await threadState(bot.id, task.threadId);
    expect(thread).not.toHaveProperty("surface");
    expect(thread).not.toHaveProperty("surfaceAuto");
    await stop();
    await start();
    expect(savedTask(bot.id, task.threadId)).not.toHaveProperty("surface");
    await apiOk("PATCH", `/api/bots/${bot.id}`, { computer: "off" });
    resetTurn();
    await apiOk("POST", `/api/bots/${bot.id}/messages`, { text: "Continue without a computer.", threadId: task.threadId });
    expect(mountedComputer(await dump())).toBeUndefined();
    writeFileSync(finishFile, "finish");
    await idle(bot.id, task.threadId);
    await apiOk("DELETE", `/api/bots/${bot.id}`);
    await stop();
  });

  it("keeps a person's pin when Works on changes under it", async () => {
    await start();
    const { bot } = await apiOk("POST", "/api/bots", { name: "Person Pin Bot" });
    const { task } = await apiOk("POST", `/api/bots/${bot.id}/tasks`, {});
    await apiOk("PATCH", `/api/bots/${bot.id}/tasks/${task.threadId}`, { surface: "local" });
    await stop();
    editSavedBot(bot.id, saved => { saved.computer = "vm"; });
    await start();
    expect(output).not.toContain("auto-pinned thread");
    expect(savedTask(bot.id, task.threadId)).toMatchObject({ surface: "local", surfaceSource: "user" });
    const place = await apiOk("GET", `/api/bots/${bot.id}/computer?threadId=${task.threadId}`);
    expect(place.surface).toBe("local");
    const record = {
      mode: "embedded", status: "ready", socketPath: join(home, "cua.sock"),
      mcpCommand: "/fixture/cua-driver", mcpArgs: ["mcp"], mcpEnv: {},
    };
    await handDesktopComputer(child!, record);
    try {
      // Validate the fixture on every host before waiting for a provider.
      // The obsolete "bundled" shape is refused, so no dump can ever arrive.
      const platforms: NodeJS.Platform[] = ["darwin", "win32"];
      for (const platform of platforms) {
        expect(readCuaConnection({ platform, record }))
          .toMatchObject({ command: "/fixture/cua-driver", platform, scope: "local-computer" });
      }
      // The incident's other half: the person's pin still wins the mount.
      // Linux requires a separately validated native runtime descriptor.
      if (process.platform !== "linux") {
        resetTurn();
        await apiOk("POST", `/api/bots/${bot.id}/messages`, { text: "Stay where I pinned you.", threadId: task.threadId });
        const sent = await dump();
        expect(sent.systemPrompt).toContain("You can act on the user's computer");
        expect(mountedComputer(sent).env.SAGAX_CUA_COMMAND).toBe("/fixture/cua-driver");
        expect(mountedComputer(sent).args.some((arg: string) => arg.includes("container-mcp"))).toBe(false);
        writeFileSync(finishFile, "finish");
        await idle(bot.id, task.threadId);
      }
    } finally {
      await handDesktopComputer(child!, null);
    }
    await apiOk("DELETE", `/api/bots/${bot.id}`);
    await stop();
  });

  // A place that fails never sticks (the Hosted desktop incident): a
  // select_computer move holds only that request, so the next message runs
  // on Auto, while a person's pin stays and the failure names the composer.
  it("a select_computer move to a cloud computer that fails leaves Auto, and a person's pin stays", async () => {
    await start();
    const { bot } = await apiOk("POST", "/api/bots", { name: "Failed place bot" });
    const { task } = await apiOk("POST", `/api/bots/${bot.id}/tasks`, {});
    await apiOk("PUT", "/api/config", { box: { token: "box_fixture" } });
    // The last row a person reads; a turn's digest comes after it.
    const lastRow = async () => {
      const { messages } = await apiOk("GET", `/api/threads/${task.threadId}/messages?limit=30`);
      return String(messages.filter((message: any) => message.kind !== "digest").at(-1)?.tool?.name ?? "");
    };
    resetTurn();
    await apiOk("POST", `/api/bots/${bot.id}/messages`, { text: "Open Chrome on the cloud computer.", threadId: task.threadId });
    const sent = await dump();
    const token = sent.mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN;
    const selected = await fetch(base + "/api/internal/computer/select", { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ surface: "cloud" }) });
    expect(await selected.json()).toMatchObject({ status: "pending", surface: "cloud" });
    // The Boat goes down before the continuation's first computer call.
    boatDown = true;
    writeFileSync(finishFile, "finish");
    await until(() => lastRow(), row => row.startsWith("error:"));
    await idle(bot.id, task.threadId);
    expect(await lastRow()).toBe("error: Cloud computers can't start right now. It isn't anything you did. This conversation is back on Auto. Send your message again.");
    const cleared = savedTask(bot.id, task.threadId)!;
    expect(cleared.surface).toBeUndefined();
    expect(cleared.surfaceSource).toBeUndefined();
    // The next message runs on Auto, with the Boat still down.
    resetTurn();
    await apiOk("POST", `/api/bots/${bot.id}/messages`, { text: "Carry on where you can.", threadId: task.threadId });
    const next = await dump();
    expect(mountedComputer(next)?.args ?? []).not.toContain("computer");
    writeFileSync(finishFile, "finish");
    await idle(bot.id, task.threadId);
    expect(await lastRow()).not.toMatch(/^error:/);

    // A person's pin to the same failing place stays, and says how to clear it.
    await apiOk("PATCH", `/api/bots/${bot.id}/tasks/${task.threadId}`, { surface: "cloud" });
    resetTurn();
    await apiOk("POST", `/api/bots/${bot.id}/messages`, { text: "Use the cloud computer.", threadId: task.threadId });
    await until(() => lastRow(), row => row.startsWith("error:"));
    await idle(bot.id, task.threadId);
    expect(await lastRow()).toBe("error: Cloud computers can't start right now. It isn't anything you did. Clear this conversation's place in the composer to continue.");
    expect(savedTask(bot.id, task.threadId)).toMatchObject({ surface: "cloud", surfaceSource: "user" });
    boatDown = false;
    await apiOk("DELETE", `/api/bots/${bot.id}`);
    await stop();
  });

  // A line relayed from Slack was written there, not in this conversation,
  // so it never makes this the thread the person is in (server/threads/main-thread.ts):
  // nor when select_computer continues its turn on another computer, a turn
  // that carries the same line.
  it("never takes a relayed line's conversation for where the person writes, when select_computer continues its turn", async () => {
    await start();
    const { bot } = await apiOk("POST", "/api/bots", { name: "Relayed place bot" });
    const { task } = await apiOk("POST", `/api/bots/${bot.id}/tasks`, {});
    // Sagax starts a thread on Approve for me; a guarded send expects Ask.
    await apiOk("PATCH", `/api/bots/${bot.id}/tasks/${task.threadId}`, { approvalMode: "ask" });
    await apiOk("PUT", "/api/config", { box: { token: "box_fixture" } });
    const lastRow = async () => {
      const { messages } = await apiOk("GET", `/api/threads/${task.threadId}/messages?limit=30`);
      return String(messages.filter((message: any) => message.kind !== "digest").at(-1)?.tool?.name ?? "");
    };
    resetTurn();
    await apiOk("POST", `/api/bots/${bot.id}/messages/guarded`, {
      threadId: task.threadId, sendId: randomUUID(), text: "Check the dashboard on the cloud computer.", expectedActiveLeafId: null,
    });
    const sent = await dump();
    const token = sent.mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN;
    const selected = await fetch(base + "/api/internal/computer/select", { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ surface: "cloud" }) });
    expect(await selected.json()).toMatchObject({ status: "pending", surface: "cloud" });
    // The continuation runs, and ends at once on a Boat that is down.
    boatDown = true;
    writeFileSync(finishFile, "finish");
    await until(() => lastRow(), row => row.startsWith("error:"));
    await idle(bot.id, task.threadId);
    expect(savedTask(bot.id, task.threadId)).not.toHaveProperty("askedAt");
    boatDown = false;
    await apiOk("DELETE", `/api/bots/${bot.id}`);
    await stop();
  });
});
