// The agent-browser daemon outlives the MCP transport that started it, so a
// server that only stopped its transports left the daemon and its Chrome
// running after a quit, until the engine's one-hour idle timeout. Real server,
// fake Claude CLI, and an agent-browser stub that logs each command it gets.
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** A home with the stub engine. A running daemon is a file in `running/`
 * plus the pid file agent-browser writes; `close` removes both. */
function engineHome(config: Record<string, unknown> = {}) {
  const home = mkdtempSync(join(tmpdir(), "omb-browser-shutdown-"));
  homes.push(home);
  mkdirSync(join(home, "tmp"), { recursive: true });
  mkdirSync(join(home, "running"), { recursive: true });
  mkdirSync(join(home, ".agent-browser"), { recursive: true });
  const log = join(home, "agent-browser.log");
  const engine = join(home, "agent-browser");
  writeFileSync(engine, [
    "#!/bin/sh",
    `printf '%s %s\\n' "$AGENT_BROWSER_SESSION" "$*" >> '${log}'`,
    `if [ "$1" = session ]; then printf '{"success":true,"data":{"sessions":['; sep=''; for f in '${home}/running'/*; do [ -e "$f" ] || continue; printf '%s"%s"' "$sep" "\${f##*/}"; sep=','; done; printf ']}}\\n'; fi`,
    // The server's PATH holds only node: name rm by its path.
    `if [ "$1" = close ]; then /bin/rm -f '${home}/running/'"$AGENT_BROWSER_SESSION" '${home}/.agent-browser/'"$AGENT_BROWSER_SESSION.pid"; fi`,
    "exit 0",
  ].join("\n"), { mode: 0o755 });
  writeFileSync(join(home, "config.json"), JSON.stringify({
    features: { browser: true },
    instances: { claude: { driver: "claudeAgent", displayName: "Verification fixture", config: { cli: FAKE_CLI } } },
    ...config,
  }));
  // Each start is a new daemon with a pid of its own, which no process has.
  let started = 0;
  const run = (session: string) => {
    writeFileSync(join(home, "running", session), "");
    writeFileSync(join(home, ".agent-browser", `${session}.pid`), String(2_147_483_000 + started++));
  };
  const commands = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
  return { home, log, engine, run, commands };
}

async function startServer(home: string, engine: string) {
  const port = await freePortBlock([0, 1]);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server/index.ts")], {
    cwd: ROOT,
    env: { SAGAX_TEST_FIXED_WORKSPACE: "1", SAGAX_TEST_SEAMS: "1", ...verificationServerEnvironment(process.env, home, port), SAGAX_AGENT_BROWSER_PATH: engine },
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
  return { child, api };
}

/** Run one browser turn for a bot that works on the browser, then stop the
 * server the way quitting the app does. Returns the commands the stub got
 * during shutdown. */
async function browserTurnThenQuit(config: Record<string, unknown> = {}) {
  const fixture = engineHome(config);
  const { child, api } = await startServer(fixture.home, fixture.engine);
  const bot = (await api("POST", "/api/bots", { name: "Shutdown probe" })).body.bot;
  expect((await api("PATCH", `/api/bots/${bot.id}`, { computer: "browser", browser: true })).status).toBe(200);
  expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Check the website." })).status).toBe(202);
  await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).body.bots
    .find((item: { id: string }) => item.id === bot.id)?.busy, { timeout: 20_000 }).toBe(false);
  const session = `bot-${bot.id}`;
  const turnCommands = fixture.commands();
  // The bot's browser is open when the person quits.
  fixture.run(session);
  appendFileSync(fixture.log, "--- shutdown\n");
  await waitForExit(child, { signal: "SIGTERM" });
  return { session, turnCommands, commands: readFileSync(fixture.log, "utf8").split("--- shutdown\n")[1].trim().split("\n"),
    stillRunning: existsSync(join(fixture.home, "running", session)) };
}

// The stub is a POSIX shell script; Windows resolves engines through a
// separate launch contract.
describe.skipIf(process.platform === "win32")("closing the browsers at shutdown", () => {
  it("closes the browser a bot used when the server stops", async () => {
    const { session, turnCommands, commands, stillRunning } = await browserTurnThenQuit();
    expect(turnCommands.some((line) => line.startsWith(`${session} `))).toBe(true);
    expect(commands).toContain(`${session} close`);
    expect(stillRunning).toBe(false);
  }, 60_000);

  it("leaves a Chrome attached over CDP running", async () => {
    const { session, commands, stillRunning } = await browserTurnThenQuit({ browserEngine: { attachCdpUrl: "9222" } });
    expect(commands).not.toContain(`${session} close`);
    expect(stillRunning).toBe(true);
  }, 60_000);

  // A crash closes nothing: the next start finds this data dir's browsers by
  // name and closes them, and leaves anything else under the same HOME.
  it("closes the browsers a crashed server left when it starts again", async () => {
    const fixture = engineHome();
    const first = await startServer(fixture.home, fixture.engine);
    const bot = (await first.api("POST", "/api/bots", { name: "Crash probe" })).body.bot;
    fixture.run(`bot-${bot.id}`);
    fixture.run("someone-elses");
    first.child.kill("SIGKILL");
    await waitForExit(first.child);
    rmSync(fixture.log, { force: true });
    await startServer(fixture.home, fixture.engine);
    await expect.poll(fixture.commands, { timeout: 10_000 }).toContain(`bot-${bot.id} close`);
    expect(fixture.commands()).not.toContain("someone-elses close");
    expect(existsSync(join(fixture.home, "running", "someone-elses"))).toBe(true);
  }, 60_000);
});
