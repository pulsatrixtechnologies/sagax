// #2436: 0.8.58 died on every start with
//   TypeError: host.isPersistentQuestionCard is not a function
// The RoutineManager constructor recovers a routine run left "waiting" by the
// last stop and asks awaitsPerson -> openQuestionCard (a leaf), which read
// host.isPersistentQuestionCard. The leaf host was only filled at the end of
// server/index.ts, after that boot code had already run. A fresh data dir has
// no run to recover, so every other boot test passed. This one starts the
// real server on a data dir that holds such a run and waits for health 200.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
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

async function boot(home: string) {
  const port = await freePortBlock([0, 1]);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server/index.ts")], {
    cwd: ROOT,
    env: verificationServerEnvironment({ ...process.env }, home, port),
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout!.on("data", (chunk) => { output += chunk; });
  child.stderr!.on("data", (chunk) => { output += chunk; });
  await expect.poll(async () => {
    if (child.exitCode !== null) throw new Error(`server exited during boot:\n${output}`);
    try { return (await fetch(base + "/api/health")).status; } catch { return 0; }
  }, { timeout: 30_000, interval: 100 }).toBe(200);
  return { output: () => output, stop: () => waitForExit(child, { signal: "SIGTERM" }) };
}

it("starts with a routine run left waiting on an open question card (leaf host complete before boot calls a leaf)", async () => {
  const home = mkdtempSync(join(tmpdir(), "omb-boot-host-order-"));
  homes.push(home);
  mkdirSync(join(home, "tmp"), { recursive: true });
  writeFileSync(join(home, "config.json"), JSON.stringify({
    instances: { claude: { driver: "claudeAgent", displayName: "Verification fixture", config: { cli: FAKE_CLI } } },
  }));
  // First start: the starter bot and its thread, with the intro options card.
  const first = await boot(home);
  await first.stop();
  // That card becomes an open question (a requestId, unanswered), the kind a
  // routine turn leaves behind when it asks the person something.
  const db = new DatabaseSync(join(home, "messages.db"));
  const row = db.prepare("SELECT thread_id, id, json FROM messages WHERE kind = 'options' LIMIT 1").get() as { thread_id: string; id: string; json: string } | undefined;
  expect(row).toBeDefined();
  const message = JSON.parse(row!.json);
  message.card = { ...message.card, requestId: "request-open", answered: false };
  db.prepare("UPDATE messages SET json = ? WHERE thread_id = ? AND id = ?").run(JSON.stringify(message), row!.thread_id, row!.id);
  db.close();
  const now = Date.now();
  writeFileSync(join(home, "routines.json"), JSON.stringify({
    routines: [],
    runs: [{
      id: "run-waiting", routineId: "routine-gone", botId: "bot-gone", threadId: row!.thread_id,
      status: "waiting", target: "bot", trigger: "manual", prompt: "Check", createdAt: now - 60_000, startedAt: now - 60_000,
    }],
    postResultsMigrated: true,
  }));
  // Second start: the RoutineManager constructor asks awaitsPerson ->
  // openQuestionCard, which reads host.isPersistentQuestionCard at boot.
  const second = await boot(home);
  expect(second.output()).not.toMatch(/is not a function|TypeError/);
}, 90_000);
