// The agent-browser daemon outlives the MCP transport that started it, so a
// server that only stopped its transports left the daemon and its Chrome
// running after a quit, until the engine's one-hour idle timeout. Real server,
// fake Claude CLI, and an agent-browser stub that logs each command it gets.
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { verificationServerEnvironment } from "../scripts/control-omb.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FAKE_CLI = join(ROOT, "server/testing/fake-claude-cli.ts");

const homes: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) await waitForExit(child, { signal: "SIGTERM" });
  for (const home of homes.splice(0)) await removeTempDir(home);
});

/** Run one browser turn for a bot that works on the browser, then stop the
 * server the way quitting the app does. Returns the commands the stub got
 * during shutdown: preparing a session also closes it once, during the turn. */
async function browserTurnThenQuit(config: Record<string, unknown> = {}, browserProfile?: string,
  beforeQuit?: (api: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>, log: string) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), "omb-browser-shutdown-"));
  homes.push(home);
  mkdirSync(join(home, "tmp"), { recursive: true });
  const log = join(home, "agent-browser.log");
  const engine = join(home, "agent-browser");
  // `session list` answers with no sessions, so a close counts as finished.
  writeFileSync(engine, [
    "#!/bin/sh",
    `printf '%s %s\\n' "$AGENT_BROWSER_SESSION" "$*" >> '${log}'`,
    `if [ "$1" = session ]; then printf '%s\\n' '{"success":true,"data":{"sessions":[]}}'; fi`,
    "exit 0",
  ].join("\n"), { mode: 0o755 });
  writeFileSync(join(home, "config.json"), JSON.stringify({
    features: { browser: true },
    instances: { claude: { driver: "claudeAgent", displayName: "Verification fixture", config: { cli: FAKE_CLI } } },
    ...config,
  }));
  const port = await freePortBlock([0, 1]);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server/index.ts")], {
    cwd: ROOT,
    env: { SAGAX_TEST_FIXED_WORKSPACE: "1", SAGAX_TEST_SEAMS: "1",  ...verificationServerEnvironment(process.env, home, port), SAGAX_AGENT_BROWSER_PATH: engine },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout!.on("data", (chunk) => { output += chunk; });
  child.stderr!.on("data", (chunk) => { output += chunk; });
  await expect.poll(async () => {
    if (child.exitCode !== null) throw new Error(`server exited during boot:\n${output}`);
    try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; }
  }, { timeout: 20_000, interval: 50 }).toBe(true);
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method, headers: { origin: base, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const bot = (await api("POST", "/api/bots", { name: "Shutdown probe" })).body.bot;
  expect((await api("PATCH", `/api/bots/${bot.id}`, { computer: "browser", browser: true, ...(browserProfile ? { browserProfile } : {}) })).status).toBe(200);
  expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Check the website." })).status).toBe(202);
  await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).body.bots
    .find((item: { id: string }) => item.id === bot.id)?.busy, { timeout: 20_000 }).toBe(false);
  const session = browserProfile ?? `bot-${bot.id}`;
  // The person's Chrome has no saved state of OMB's to prepare, so a turn on
  // My Chrome runs no engine command of its own; every other browser does.
  const turnCommands = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
  await beforeQuit?.(api, log);
  appendFileSync(log, "--- shutdown\n");
  await waitForExit(child, { signal: "SIGTERM" });
  return { session, turnCommands, commands: readFileSync(log, "utf8").split("--- shutdown\n")[1].trim().split("\n") };
}

// The stub is a POSIX shell script; Windows resolves engines through a
// separate launch contract.
describe.skipIf(process.platform === "win32")("closing the browsers at shutdown", () => {
  it("closes the browser a bot used when the server stops", async () => {
    const { session, turnCommands, commands } = await browserTurnThenQuit();
    expect(turnCommands.some((line) => line.startsWith(`${session} `))).toBe(true);
    expect(commands).toContain(`${session} close`);
  }, 60_000);

  it("leaves the person's Chrome running for a profile set to My Chrome", async () => {
    const { session, turnCommands, commands } = await browserTurnThenQuit({
      browserEngine: { attachCdpUrl: "9222" },
      browserProfiles: [{ id: "profile-mine", name: "Mine", browser: "chrome" }],
    }, "profile-mine");
    expect(turnCommands.filter((line) => line.startsWith(`${session} `))).toEqual([]);
    expect(commands).not.toContain(`${session} close`);
  }, 60_000);

  it("keeps a built-in profile on its own browser even when a Chrome address is configured", async () => {
    const { session, turnCommands, commands } = await browserTurnThenQuit({ browserEngine: { attachCdpUrl: "9222" } });
    expect(turnCommands.some((line) => line.startsWith(`${session} `))).toBe(true);
    expect(commands).toContain(`${session} close`);
  }, 60_000);

  it("closes a profile's built-in browser, saving its logins, when the profile switches to My Chrome", async () => {
    const work = { id: "profile-work", name: "Work" };
    const { session } = await browserTurnThenQuit({ browserProfiles: [work] }, "profile-work", async (api, log) => {
      appendFileSync(log, "--- switch\n");
      const switched = await api("PATCH", "/api/config", { browserProfiles: [{ ...work, browser: "chrome" }], expectedBrowserProfiles: [work] });
      expect(switched.status).toBe(200);
      expect(switched.body.browserProfiles).toEqual([{ ...work, browser: "chrome" }]);
      await expect.poll(() => readFileSync(log, "utf8").split("--- switch\n")[1]?.split("\n"), { timeout: 10_000 }).toContain("profile-work close");
      // The list the person saw carries the choice, so switching back is not
      // mistaken for another window's edit.
      const back = await api("PATCH", "/api/config", { browserProfiles: [work], expectedBrowserProfiles: [{ ...work, browser: "chrome" }] });
      expect(back.status).toBe(200);
      expect(back.body.browserProfiles).toEqual([work]);
      // Letting go of the person's Chrome is a close of that session too.
      await expect.poll(() => readFileSync(log, "utf8").split("--- switch\n")[1]?.split("\n").filter((line) => line === "profile-work close").length, { timeout: 10_000 }).toBe(2);
    });
    expect(session).toBe("profile-work");
  }, 60_000);
});
