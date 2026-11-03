// Per-bot runtime settings on a real server (owner 2026-10-15): at start, the
// global parallel conversations and recovery values of config.json become
// each existing bot's own, once; a bot's own value then wins at runtime and
// a later change of the global value never moves it.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../../scripts/control-omb.ts";
import { waitForExit } from "../testing/cleanup.ts";

it("copies the global values onto the existing bots once, then each bot keeps its own", async () => {
  const fixture = await launchVerificationServer();
  const { dataDir, url, logPath } = fixture.info;
  let server: ChildProcess | undefined;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(url + path, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const start = async () => {
    const log = openSync(logPath, "a", 0o600);
    server = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("../index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: verificationServerEnvironment({}, dataDir, Number(new URL(url).port)), stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      try { return (await fetch(url + "/api/health", { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; }
    }, { timeout: 30_000 }).toBe(true);
  };
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "Migrated bot", "--url", url]) as any;
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    // An older build: global values, no per-bot value, no marker yet.
    const marker = join(dataDir, "bot-runtime-settings.v1");
    rmSync(marker, { force: true });
    const configPath = join(dataDir, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.threads = { ...config.threads, maxConcurrentPerBot: 7, maxParallelPerPerson: 2 };
    config.automaticRecovery = { enabled: false };
    writeFileSync(configPath, JSON.stringify(config));
    await start();
    expect(existsSync(marker)).toBe(true);
    const read = await api("GET", `/api/bots/${bot.id}/runtime-settings`);
    expect(read.status).toBe(200);
    expect(read.body.stored).toEqual({ maxConcurrentThreads: 7, maxParallelPerPerson: 2, automaticRecovery: { enabled: false } });
    const listed = (await api("GET", "/api/bots")).body.bots.find((entry: any) => entry.id === bot.id);
    expect(listed).toMatchObject({ maxConcurrentThreads: 7, maxParallelPerPerson: 2 });

    // The bot's own value wins; the global one no longer moves it.
    expect((await api("PATCH", `/api/bots/${bot.id}/runtime-settings`, { maxConcurrentThreads: 1, busySend: "after" })).status).toBe(200);
    expect((await api("PATCH", "/api/config", { threads: { maxConcurrentPerBot: 9 } })).status).toBe(200);
    expect((await api("GET", `/api/bots/${bot.id}/runtime-settings`)).body.settings).toMatchObject({ maxConcurrentThreads: 1, maxParallelPerPerson: 2, busySend: "after" });
    // A bot made afterwards with no value of its own reads the server default.
    const { bot: fresh } = await runControlOmb(["new-bot", "--name", "Fresh bot", "--url", url]) as any;
    expect((await api("GET", `/api/bots/${fresh.id}/runtime-settings`)).body.settings.maxConcurrentThreads).toBe(9);
  } finally {
    await waitForExit(server, { signal: "SIGTERM" });
    await fixture.close();
  }
}, 180_000);
