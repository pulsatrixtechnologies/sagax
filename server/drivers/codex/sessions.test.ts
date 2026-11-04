import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexDriver } from "../codex.ts";
import type { ProviderInstance, SendTurnInput } from "../../contracts.ts";
import { recordEvents, type EventRecorder } from "../../testing/events.ts";
import { removeTempDir } from "../../testing/cleanup.ts";

const cli = fileURLToPath(new URL("../../testing/fake-codex-app-server.ts", import.meta.url));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe("Codex retained app-server", () => {
  let scratch: string;
  let instance: ProviderInstance;
  let events: EventRecorder;
  let dump: string;
  let crashFile: string | undefined;
  const create = async (environment: Record<string, string> = {}) => {
    scratch = mkdtempSync(join(tmpdir(), "codex-warm-"));
    dump = join(scratch, "dump.json");
    const home = join(scratch, "codex");
    mkdirSync(home);
    instance = await CodexDriver.create({ instanceId: "fixture-codex", displayName: "Osprey", enabled: true,
      config: CodexDriver.decodeConfig({ cli, managed: { url: "http://127.0.0.1:1/v1", models: ["fixture-model", "other-model"] } }),
      environment: { CODEX_HOME: home, SAGAX_COMPANY_API_KEY: "fixture-only", FAKE_CODEX_MODE: "resume", FAKE_CODEX_DUMP: dump,
        FAKE_CODEX_SIGNOUT_FILE: join(scratch, "signed-out"), ...environment },
    });
    events = recordEvents(instance.adapter);
  };
  const seen = () => JSON.parse(readFileSync(dump, "utf8")) as { pid: number; calls: Array<{ method: string; params: any }>; env: Record<string, string> };
  const send = async (extra: Partial<SendTurnInput> = {}) => {
    const { turnId } = await instance.adapter.sendTurn({ threadId: "thread-osprey", botId: "bot-osprey", cwd: scratch,
      text: "Check the fixture", model: "fixture-model", ...extra });
    return events.until(e => e.type === "turn.completed" && e.turnId === turnId);
  };
  afterEach(async () => {
    vi.useRealTimers();
    events?.stop();
    await instance?.dispose();
    if (scratch) removeTempDir(scratch);
    if (crashFile) rmSync(crashFile, { force: true });
    crashFile = undefined;
    vi.unstubAllEnvs();
  });

  it("reuses one process, initializes once and counts only each turn's usage", async () => {
    await create({ FAKE_CODEX_RESTORED_USAGE: "1" });
    expect(await send({ system: "First rule" })).toMatchObject({ ok: true, usage: { input: 7, output: 3, cachedInput: 4 } });
    const pid = seen().pid;
    expect(alive(pid)).toBe(true);
    expect(await send({ resumeCursor: "codex-thread-1", system: "First rule" })).toMatchObject({ ok: true, usage: { input: 7, output: 3, cachedInput: 4 } });
    expect(seen().pid).toBe(pid);
    expect(seen().calls.filter(c => c.method === "initialize")).toHaveLength(1);
    expect(seen().calls.filter(c => c.method === "turn/start")).toHaveLength(2);
    expect(seen().calls.find(c => c.method === "thread/resume")?.params.developerInstructions).toContain("First rule");
    await instance.dispose();
    expect(alive(pid)).toBe(false);
  });

  it("retires an idle process using the shared idle policy and respawns for the next turn", async () => {
    vi.stubEnv("SAGAX_CODEX_SESSION_IDLE_MS", "10000");
    await create();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const done = send();
    // IO is real; advance no timers while the fake supplies its protocol frames.
    await done;
    const pid = seen().pid;
    await vi.advanceTimersByTimeAsync(10001);
    vi.useRealTimers();
    await expect.poll(() => alive(pid)).toBe(false);
    expect(instance.adapter.hasSession("thread-osprey")).toBe(false);
    expect(await send({ resumeCursor: "codex-thread-1" })).toMatchObject({ ok: true });
    expect(seen().pid).not.toBe(pid);
  });

  it.each([
    { name: "model", value: { model: "other-model" } },
    { name: "permissions", value: { approvalMode: "full" as const } },
    { name: "command credential revoke", value: { commandEnvironment: { FIXTURE_KEY: "new-fixture" } } },
    { name: "MCP credential", value: { integrations: { custom: { fixture: { command: process.execPath, args: [], env: { FIXTURE_KEY: "new-fixture" } } } } } },
    { name: "session reset", value: { sessionReset: true } },
    { name: "bot", value: { botId: "bot-wren" } },
    { name: "stable instructions", value: { system: "Updated rule" } },
  ])("retires before a changed $name contract", async ({ value }) => {
    await create();
    await send();
    const pid = seen().pid;
    expect(await send({ resumeCursor: "codex-thread-1", ...value })).toMatchObject({ ok: true });
    expect(seen().pid).not.toBe(pid);
    expect(alive(pid)).toBe(false);
  });

  it("delivers changed volatile context without a new process or a second initialize", async () => {
    await create();
    await send({ systemStable: "Stable rules", systemVolatile: "First context" });
    const pid = seen().pid;
    await send({ resumeCursor: "codex-thread-1", systemStable: "Stable rules", systemVolatile: "Updated context" });
    expect(seen().pid).toBe(pid);
    expect(seen().calls.filter(c => c.method === "initialize")).toHaveLength(1);
    expect(JSON.stringify(seen().calls.filter(c => c.method === "turn/start").at(-1)?.params)).toContain("Updated context");
  });

  it("refuses an earlier turn's approval on the reused process, including Full access", async () => {
    await create({ FAKE_CODEX_STALE_REQUEST: "1" });
    await send({ approvalMode: "full" });
    const pid = seen().pid;
    await send({ approvalMode: "full", resumeCursor: "codex-thread-1" });
    expect(seen().pid).toBe(pid);
    await expect.poll(() => (JSON.parse(readFileSync(dump, "utf8"))).decision).toMatchObject({ error: { message: "Sagax: the turn ended" } });
    expect(events.events.filter(e => e.type === "request.opened")).toHaveLength(0);
  });

  it("never shares a process or turn capability across principals, including the same thread and bot ids", async () => {
    await create();
    const access = (identity: string) => ({ via: "subscription" as const, identity });
    const integrations = (token: string) => ({ agents: { command: process.execPath, args: [], env: { SAGAX_COMMS_TOKEN: token } } });
    await send({ access: access("subscription:osprey"), integrations: integrations("fixture-osprey") });
    const osprey = seen().pid;
    await send({ access: access("subscription:wren"), integrations: integrations("fixture-wren") });
    expect(seen().pid).not.toBe(osprey);
    expect(alive(osprey)).toBe(false);
    const tokenFile = seen().env.SAGAX_COMMS_TOKEN_FILE;
    expect(readFileSync(tokenFile, "utf8")).toBe("fixture-wren");
    expect(events.events.filter(e => e.type === "turn.completed")).toHaveLength(2);
  });

  it("refreshes a turn token without respawning and never reuses a changed non-token MCP value", async () => {
    await create();
    const integrations = (token: string, scope = "osprey") => ({ agents: { command: process.execPath, args: [], env: {
      SAGAX_COMMS_TOKEN: token, SAGAX_TURN_DEPTH: "0", SAGAX_MCP_PRINCIPAL: scope,
    } } });
    await send({ integrations: integrations("fixture-one") });
    const pid = seen().pid;
    await send({ resumeCursor: "codex-thread-1", integrations: integrations("fixture-two") });
    expect(seen().pid).toBe(pid);
    expect(readFileSync(seen().env.SAGAX_COMMS_TOKEN_FILE, "utf8")).toBe("fixture-two");
    await send({ resumeCursor: "codex-thread-1", integrations: integrations("fixture-three", "wren") });
    expect(seen().pid).not.toBe(pid);
    expect(alive(pid)).toBe(false);
  });

  it("isolates people on the same organization account without any MCP mount", async () => {
    await create();
    const access = { via: "org-key" as const, identity: "org-key" };
    await send({ access, principalId: "osprey" });
    const pid = seen().pid;
    await send({ access, principalId: "wren" });
    expect(seen().pid).not.toBe(pid);
    expect(alive(pid)).toBe(false);
  });

  it.each(["before-ack", "after-ack"])("respawns once after a %s crash and completes the same logical turn", async phase => {
    vi.stubEnv("FAKE_CODEX_RETRY_SCALE", "0.001");
    crashFile = join(tmpdir(), `codex-crash-${crypto.randomUUID()}`);
    await create({ FAKE_CODEX_CRASH_ONCE: crashFile, FAKE_CODEX_CRASH_PHASE: phase });
    const result = await send();
    expect(result).toMatchObject({ ok: true });
    expect(events.events.filter(e => e.type === "turn.started")).toHaveLength(1);
    expect(events.events.filter(e => e.type === "turn.retrying")).toHaveLength(1);
    expect(events.events.filter(e => e.type === "turn.completed")).toHaveLength(1);
    if (phase === "after-ack") {
      expect(seen().calls.some(c => c.method === "thread/resume")).toBe(true);
      expect(JSON.stringify(seen().calls.find(c => c.method === "turn/start")?.params.input)).toContain("crash-step");
    }
  });

  it("respawns after an idle crash without losing the next message", async () => {
    await create();
    await send();
    const pid = seen().pid;
    process.kill(pid, "SIGKILL");
    await expect.poll(() => instance.adapter.hasSession("thread-osprey")).toBe(false);
    expect(await send({ resumeCursor: "codex-thread-1", text: "Second message" })).toMatchObject({ ok: true });
    expect(seen().pid).not.toBe(pid);
  });

  it("cancels via turn/interrupt, closes the process and permits a fresh turn", async () => {
    await create({ FAKE_CODEX_MODE: "approval" });
    const { turnId } = await instance.adapter.sendTurn({ threadId: "thread-osprey", text: "Wait for permission", model: "fixture-model", cwd: scratch });
    await events.until(e => e.type === "request.opened");
    const pid = seen().pid;
    await instance.adapter.interruptTurn("thread-osprey");
    await events.until(e => e.type === "turn.completed" && e.turnId === turnId);
    expect(seen().calls.some(c => c.method === "turn/interrupt")).toBe(true);
    expect(alive(pid)).toBe(false);
    expect(events.events.filter(e => e.type === "turn.completed")).toHaveLength(1);
    expect(events.events.filter(e => e.type === "turn.retrying")).toHaveLength(0);
  });

  it("cancels during preparation without starting a process or reviving the turn", async () => {
    await create();
    const { turnId } = await instance.adapter.sendTurn({ threadId: "early-stop", text: "Fixture", model: "fixture-model" });
    await instance.adapter.interruptTurn("early-stop");
    expect(await events.until(e => e.type === "turn.completed" && e.turnId === turnId)).toMatchObject({ ok: false, stopReason: "interrupted" });
    expect(events.events.filter(e => e.type === "turn.started")).toHaveLength(1);
    expect(events.events.filter(e => e.type === "session.started")).toHaveLength(0);
    expect(instance.adapter.hasSession("early-stop")).toBe(false);
  });

  it("keeps simultaneous principals in separate processes and cancels only the selected thread", async () => {
    await create({ FAKE_CODEX_MODE: "approval" });
    const start = (threadId: string, identity: string) => instance.adapter.sendTurn({ threadId, text: "Fixture", model: "fixture-model",
      access: { via: "subscription", identity } });
    const first = await start("osprey-thread", "subscription:osprey");
    await events.until(e => e.type === "request.opened" && e.turnId === first.turnId);
    const firstPid = seen().pid;
    const second = await start("wren-thread", "subscription:wren");
    const ask = await events.until(e => e.type === "request.opened" && e.turnId === second.turnId);
    const secondPid = seen().pid;
    expect(firstPid).not.toBe(secondPid);
    await instance.adapter.interruptTurn("osprey-thread");
    expect(alive(firstPid)).toBe(false);
    expect(alive(secondPid)).toBe(true);
    await instance.adapter.respondToRequest("wren-thread", ask.requestId!, { behavior: "deny" });
    expect(await events.until(e => e.type === "turn.completed" && e.turnId === second.turnId)).toMatchObject({ ok: true });
  });

  it("closes idle sessions for deletion, engine/model changes, stopAll and sign-out", async () => {
    await create();
    await send();
    let pid = seen().pid;
    instance.adapter.releaseWarmSession?.("thread-osprey");
    await expect.poll(() => alive(pid)).toBe(false);
    await send();
    pid = seen().pid;
    await instance.adapter.stopAll();
    expect(alive(pid)).toBe(false);
    await send();
    pid = seen().pid;
    await instance.signOut?.();
    expect(alive(pid)).toBe(false);
  });

  it("retires an idle process when its account file changes outside Sagax", async () => {
    await create();
    await send();
    const { pid, env } = seen();
    writeFileSync(join(env.CODEX_HOME, "auth.json"), '{"fixture":"rotated"}');
    await expect.poll(() => alive(pid), { timeout: 5000 }).toBe(false);
  });
});
