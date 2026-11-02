import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../scripts/control-omb.ts";
import { handleToolCall, request } from "../scripts/mcp-server.ts";
import { waitForExit } from "./testing/cleanup.ts";
import { readHandoffs } from "./testing/handoff-rows.ts";

it("boots and reports an interrupted routine back to its source room", async () => {
  const fixture = await launchVerificationServer();
  const { url, dataDir, logPath } = fixture.info;
  let restarted: ChildProcess | undefined;
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "Recovery lead", "--url", url]) as any;
    await request(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ proactiveMode: "proactive" }) }, url);
    const { channel } = await handleToolCall("create_channel", { name: "Recovery room", member_ids: [bot.id] },
      (path, options) => request(path, options, url)) as any;
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    // Reproduce the persisted state of an interrupted process, not a second
    // live writer. Recovery must emit its group/card changes during startup.
    writeFileSync(join(dataDir, "routines.json"), JSON.stringify({ version: 1, routines: [], runs: [{
      id: "interrupted-room-run", routineId: "interrupted-routine", routineName: "Room report",
      botId: bot.id, target: "bot", runOn: "maus", sourceThreadId: channel.activeTaskId,
      status: "running", prompt: "Report once", createdAt: Date.now(), scheduledFor: Date.now(),
    }] }));
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "TZ"]) {
      if (process.env[key]) env[key] = process.env[key];
    }
    Object.assign(env, {
      HOME: dataDir, USERPROFILE: dataDir, SAGAX_DATA_DIR: dataDir,
      APPDATA: join(dataDir, "AppData", "Roaming"), LOCALAPPDATA: join(dataDir, "AppData", "Local"),
      XDG_CONFIG_HOME: join(dataDir, ".config"), XDG_CACHE_HOME: join(dataDir, ".cache"),
      XDG_DATA_HOME: join(dataDir, ".local", "share"), HERMES_HOME: join(dataDir, ".hermes"),
      TEMP: join(dataDir, "tmp"), TMP: join(dataDir, "tmp"), TMPDIR: join(dataDir, "tmp"),
      SAGAX_PORT: new URL(url).port, SAGAX_WEBHOOK_PORT: String(Number(new URL(url).port) + 1),
      PATH: dirname(process.execPath), FAKE_CLAUDE_MODE: "happy", SAGAX_PROACTIVE_GATHER_MS: "50",
    });
    const log = openSync(logPath, "a", 0o600);
    restarted = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), env, stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      if (restarted?.exitCode !== null) throw new Error(readFileSync(logPath, "utf8"));
      return fetch(url + "/api/health").then(r => r.ok).catch(() => false);
    }, { timeout: 10_000, interval: 150 }).toBe(true);
    const { runs } = await request("/api/routines", {}, url) as any;
    expect(runs[0]).toMatchObject({ status: "failed", error: "Sagax restarted while this routine was running" });
    const { messages } = await request(`/api/threads/${channel.activeTaskId}/messages`, {}, url) as any;
    expect(messages.filter((m: any) => m.routineRun?.runId === "interrupted-room-run"))
      .toMatchObject([{ routineRun: { status: "failed" } }]);
    const { groups } = await request("/api/bots", {}, url) as any;
    expect(groups.find((g: any) => g.id === channel.id).working).toBe(false);
    // A restart cut never wakes the bot (runFailureWakesBot): recovery already
    // told the person. Proactive on does not invent a proposal or a wake here.
    const { messages: botMessages } = await request(`/api/threads/${bot.activeTaskId}/messages`, {}, url) as any;
    expect(botMessages.some((message: any) => message.card?.proactiveProposal)).toBe(false);
    const { runs: after } = await request("/api/routines", {}, url) as any;
    expect(after.every((run: any) => !run.proactive)).toBe(true);
    // Store deliberately catches subscriber exceptions, so a healthy server
    // alone does not prove that recovery broadcasts were safe.
    expect(readFileSync(logPath, "utf8")).not.toMatch(/ReferenceError|store: change listener threw/);
  } finally {
    await waitForExit(restarted, { signal: "SIGTERM" });
    await fixture.close();
  }
}, 30_000);

// A routine still running at a restart keeps its teammates' work when the
// runtime still carries it (docs/runtime-contract.md §5): the cut teammate
// turn runs again once, in place; the run goes on instead of failing;
// its resume says what the restart did, and the run completes with it. The
// tree here is one the server before the job runtime left behind, imported
// once at boot (server/runtime/import-legacy.ts).
it("keeps a routine waiting through a restart, reruns its cut teammate once, and completes it", async () => {
  const fixture = await launchVerificationServer();
  const { url, dataDir, logPath } = fixture.info;
  let restarted: ChildProcess | undefined;
  try {
    const cli = (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
    const { bot: chief } = await cli("new-bot", "--name", "Clive", "--section", "Leadership");
    const { bot: mate } = await cli("new-bot", "--name", "Mira", "--section", "Engineering");
    await request(`/api/bots/${chief.id}`, { method: "PATCH", body: JSON.stringify({ chiefOfStaff: true, managedSections: ["Engineering"], acknowledgePeerScope: true }) }, url);
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const at = Date.now() - 60_000;
    writeFileSync(join(dataDir, "routines.json"), JSON.stringify({ version: 1, routines: [], runs: [{
      id: "cut-run", routineId: "cut-routine", routineName: "Weekly export", botId: chief.id, target: "bot", runOn: "maus",
      threadId: chief.activeTaskId, status: "running", prompt: "Have Engineering build the export", createdAt: at, scheduledFor: at, startedAt: at,
      // A run cut once resumes in its own thread (#794); this one was already
      // resumed, so a second cut fails it.
      restartResumes: 1,
    }] }));
    const node = { result: "", executions: 0, approvalGranted: false, kind: "work", restarts: 0, rootId: "cut-root" };
    writeFileSync(join(dataDir, "room-handoffs.json"), JSON.stringify([
      { ...node, id: "cut-root", key: "root", botId: chief.id, threadId: chief.activeTaskId, text: "Have Engineering build the export", createdAt: at, status: "source", reported: true, executions: 1 },
      { ...node, id: "cut-work", parentId: "cut-root", key: "build", botId: mate.id, threadId: mate.activeTaskId, text: "Build the export", createdAt: at + 1, startedAt: at + 2, status: "running", reported: false },
    ]));
    const log = openSync(logPath, "a", 0o600);
    restarted = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...verificationServerEnvironment(process.env, dataDir, Number(new URL(url).port)), FAKE_CLAUDE_MODE: "happy" },
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      if (restarted?.exitCode !== null) throw new Error(readFileSync(logPath, "utf8"));
      return fetch(url + "/api/health").then(r => r.ok).catch(() => false);
    }, { timeout: 10_000, interval: 150 }).toBe(true);
    const run = async () => ((await request("/api/routines", {}, url) as any).runs as any[]).find((r) => r.id === "cut-run");
    const nodes = () => readHandoffs(dataDir);
    // The runtime opens (and imports the legacy file) on its first use, a
    // moment after the server answers its health check.
    await expect.poll(() => existsSync(join(dataDir, "room-handoffs.json.migrated")), { timeout: 10_000 }).toBe(true);
    // The run is not failed: a bot run cut once goes on (main's restart
    // resume, routines.ts restartResumes), and the runtime carries its tree.
    expect(await run()).toMatchObject({ status: "running", restartResumes: 1 });
    expect((await run()).error).toBeUndefined();
    // The cut teammate turn runs again once, told so, and settles.
    await expect.poll(() => nodes().find((n: any) => n.id === "cut-work")?.status, { timeout: 20_000 }).toBe("completed");
    expect(nodes().find((n: any) => n.id === "cut-work")).toMatchObject({ restarts: 1, executions: 1, result: expect.stringContaining("hello from fake claude") });
    const mates = (await request(`/api/threads/${mate.activeTaskId}/messages`, {}, url) as any).messages as any[];
    expect(mates.filter((m) => m.tool?.name === "Resuming after a restart")).toHaveLength(1);
    // Its result resumes the run as a routine turn, and the run completes with it.
    await expect.poll(async () => (await run())?.status, { timeout: 30_000 }).toBe("completed");
    expect((await run()).output).toContain("hello from fake claude");
    await expect.poll(() => nodes().find((n: any) => n.id === "cut-root")?.status, { timeout: 15_000 }).toBe("completed");
    const chiefs = (await request(`/api/threads/${chief.activeTaskId}/messages`, {}, url) as any).messages as any[];
    expect(chiefs.some((m) => m.tool?.name === "Mira was cut off by a restart; resuming")).toBe(true);
    expect(chiefs.some((m) => m.tool?.name === "Mira replied")).toBe(true);
    expect(chiefs.some((m) => String(m.tool?.name ?? "").startsWith("Resumed with Mira results after a restart"))).toBe(true);
    // The tree ran once more and no more.
    expect(nodes().map((n: any) => [n.id, n.status, n.executions])).toEqual([["cut-root", "completed", 2], ["cut-work", "completed", 1]]);
  } finally {
    await waitForExit(restarted, { signal: "SIGTERM" });
    await fixture.close();
  }
}, 45_000);
