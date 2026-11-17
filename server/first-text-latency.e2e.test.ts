// #4456: after the engine reuse (#4446) a hosted server still showed the
// first text 16 to 46 s after the person's message, with 1.4 to 3.7 s of
// queue on every turn. This is the benchmark of the target: through the real
// server and a fake engine with a model's own timing and a prompt cache
// (fake-acp-cli.ts FAKE_ACP_MODEL_MS), no provider and no production data:
//   - a no-tool follow-up on a warm engine shows its first text in under 3 s
//     from the person's message (the latency line's `shown`), its input
//     mostly cached (`cached`), and only the changed sections resent;
//   - the second conversation of the same bot finds the stable part of its
//     opening block in the engine's cache (the stable half first, byte for
//     byte the same);
//   - a turn that starts with a tool shows the bot's own first sentence
//     before the tool ends (`shown` before `ttfc` plus the tool's time).
// `pnpm vitest run server/first-text-latency.e2e.test.ts --silent=false`
// runs it and prints each turn's line (docs/grok-latency.md).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { timingLines, withLatencyFixture, type Fixture } from "./testing/latency-fixture.ts";

/** The person waits for words this long at most on a warm follow-up. */
const FIRST_TEXT_TARGET_MS = 3_000;
/** The fake model: time to its first token, and its prefill per thousand
 * uncached characters (an 80 KB opening block uncached costs 1.6 s). */
const MODEL_MS = 900;
const PREFILL_MS_PER_KCHAR = 20;
const TOOL_MS = 4_000;

const field = (line: string, name: string): string | undefined => new RegExp(` ${name}=(\\S+)`).exec(line)?.[1];
const msOf = (line: string, name: string): number => Number(field(line, name)?.replace(/ms$/, "") ?? Number.NaN);

async function turn(fixture: Fixture, botId: string, threadId: string, text: string): Promise<string> {
  const before = timingLines(fixture.serverLog(), threadId).length;
  await fixture.control("send", "--bot", botId, "--task", threadId, "--text", text);
  // a send queued behind the bot's other turns has not started yet when
  // the conversation reads settled: its own line says it ran
  await expect.poll(async () => {
    await fixture.control("wait", "--bot", botId, "--task", threadId, "--timeout", "60");
    return timingLines(fixture.serverLog(), threadId).length;
  }, { timeout: 120_000, interval: 200 }).toBeGreaterThan(before);
  expect((await fixture.control("wait", "--bot", botId, "--task", threadId, "--timeout", "60")).status).toBe("settled");
  return timingLines(fixture.serverLog(), threadId).at(-1)!;
}

function withModel(extra: Record<string, string>, check: (fixture: Fixture) => Promise<void>, serverEnv: Record<string, string> = {}): Promise<void> {
  const cacheDir = mkdtempSync(join(tmpdir(), "first-text-"));
  return withLatencyFixture({
    engineEnv: {
      FAKE_ACP_MODEL_MS: String(MODEL_MS),
      FAKE_ACP_PREFILL_MS_PER_KCHAR: String(PREFILL_MS_PER_KCHAR),
      FAKE_ACP_PROMPT_CACHE_FILE: join(cacheDir, "prompt-cache.json"),
      ...extra,
    },
    serverEnv,
  }, check).finally(() => rmSync(cacheDir, { recursive: true, force: true }));
}

it("shows a warm no-tool follow-up's first text in under 3 s, its input cached and only what changed resent (#4456)", async () => {
  await withModel({}, async (fixture) => {
    const { bot } = await fixture.control("new-bot", "--name", "Arithmetic bot");
    await fixture.api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "grokfixture", model: "grok-4.7" } });
    const threadId = bot.activeTaskId;
    const first = await turn(fixture, bot.id, threadId, "What is 2 plus 2?");
    const followUps = [
      await turn(fixture, bot.id, threadId, "And 3 plus 3?"),
      await turn(fixture, bot.id, threadId, "And 4 plus 4?"),
    ];
    // a second conversation of the same bot: a new session, the same stable part
    const created = await fixture.api("POST", `/api/bots/${bot.id}/tasks`, { title: "Second conversation" });
    const second = await turn(fixture, bot.id, created.task.threadId, "What is 5 plus 5?");
    console.info(`[#4456] first-text benchmark (target: shown under ${FIRST_TEXT_TARGET_MS} ms on a warm follow-up):\n${[first, ...followUps, second].join("\n")}`);

    expect(field(first, "full")).toBe("yes");
    for (const line of followUps) {
      expect(field(line, "path")).not.toBe("spawn");
      expect(field(line, "full")).toBe("no");
      // the target: the person's message to the first text shown
      expect(msOf(line, "shown")).toBeLessThan(FIRST_TEXT_TARGET_MS);
      // the engine's cache holds the conversation: nine tenths of the input
      expect(Number(field(line, "cached"))).toBeGreaterThan(0.9 * Number(field(line, "in")));
      // the opening block is not resent; at most the sections that changed
      expect(Number(field(line, "prompt")?.replace(/ch$/, ""))).toBeLessThan(4_000);
    }
    // the second conversation's opening block: its stable part hits the
    // cache the first conversation filled (more than half of its input)
    expect(field(second, "full")).toBe("yes");
    expect(Number(field(second, "cached"))).toBeGreaterThan(0.5 * Number(field(second, "in")));
  });
}, 240_000);

it("shows the bot's own first sentence at once when it starts with a tool, before the tool ends (#4456)", async () => {
  await withModel({ FAKE_ACP_TOOL_FIRST_MS: String(TOOL_MS), FAKE_ACP_EARLY_WORDS: "Je regarde tes notes." }, async (fixture) => {
    const { bot } = await fixture.control("new-bot", "--name", "Notes bot");
    await fixture.api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "grokfixture", model: "grok-4.7" } });
    const threadId = bot.activeTaskId;
    await turn(fixture, bot.id, threadId, "What is in my notes?");
    const line = await turn(fixture, bot.id, threadId, "And what changed since?");
    console.info(`[#4456] tool-first turn:\n${line}`);
    expect(field(line, "tools")).toBe("1");
    // the sentence came before the tool call, and the person saw it then
    expect(msOf(line, "ttfc")).toBeGreaterThanOrEqual(msOf(line, "ttft"));
    expect(msOf(line, "shown")).toBeLessThan(FIRST_TEXT_TARGET_MS);
    expect(msOf(line, "shown")).toBeLessThan(msOf(line, "total"));
    // the words are the bot's own, in its reply, never a notice of the server
    const messages = await fixture.api("GET", `/api/bots/${bot.id}/tasks/${threadId}/messages`).catch(() => null);
    if (Array.isArray(messages?.messages)) {
      const said = messages.messages.filter((m: any) => m.role === "bot" && m.kind === "text").map((m: any) => m.text).join("\n");
      expect(said).toContain("Je regarde tes notes.");
    }
  });
}, 240_000);

// #4456: the queue, on a bot the size of a production one. #4394 measured
// 0.8 to 3.7 s of queue with queueBusy about the same: the server's main
// thread was busy that long. This bot carries what a production bot does
// (an 80 KB opening block: a long soul, RULES.md, a full MEMORY.md, a
// hundred topic notes, earlier conversations to recall from, a long main
// chat) and every turn's line prints queueBy and queueBusy
// (SAGAX_TURN_LATENCY_BUSY_MS=0), so what of the queue is this turn's own
// work on the main thread reads from the line.
const WORDS = ("invoice backup firewall printer laptop mailbox calendar contract renewal ticket license "
  + "server router switch password vendor budget meeting report schedule onboarding offboarding "
  + "migration tenant domain certificate antivirus patch update outage escalation quote client "
  + "warranty inventory monitor phone voicemail teams sharepoint onedrive storage archive retention "
  + "policy compliance audit training review deadline payroll expense approval travel project "
  + "milestone dashboard metric alert threshold capacity network wireless access badge camera").split(" ");
function prose(seed: number, chars: number): string {
  let x = seed * 2654435761 % 4294967296 || 1;
  const out: string[] = [];
  let length = 0;
  while (length < chars) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const word = WORDS[x % WORDS.length]!;
    out.push(word);
    length += word.length + 1;
    if (out.length % 14 === 0) out.push(".\n");
  }
  return out.join(" ").slice(0, chars);
}

/** a person's earlier conversations with the bot (#4394: 23 new ones in
 * four hours on a production server) */
const EARLIER_CONVERSATIONS = Number(process.env.FIRST_TEXT_EARLIER ?? 40);

function seedProductionWorkspace(dataDir: string, botId: string): void {
  const root = join(dataDir, "workspaces", botId);
  mkdirSync(join(root, "memory"), { recursive: true });
  writeFileSync(join(root, "RULES.md"), `# Rules\n\n${prose(1, 12_000)}\n`);
  const entries = Array.from({ length: 90 }, (_, i) => `- 2026-10-${String(1 + (i % 28)).padStart(2, "0")} · ${prose(100 + i, 120)}`);
  writeFileSync(join(root, "MEMORY.md"), `# Memory\n\n${entries.join("\n")}\n`);
  for (let i = 0; i < 120; i += 1) {
    const name = `${WORDS[i % WORDS.length]}-${i}`;
    writeFileSync(join(root, "memory", `${name}.md`), `---\nname: ${name}\ndescription: ${prose(500 + i, 80)}\n---\n\n${prose(1_000 + i, 1_500)}\n`);
  }
}

/** The server's synchronous file calls during each of a thread's last
 * `count` queues (fs-sync-calls.mjs), by function: the queue runs from the
 * person's message (`queue` before the send) to the send (its trace mark). */
function queueFileCalls(fixture: Fixture, callsFile: string, threadId: string, lines: readonly string[]): string[] {
  const sends = fixture.serverLog().split("\n")
    .map((line) => new RegExp(`^\\[turn-trace\\] ${threadId.slice(0, 8)} send (\\d+)`).exec(line)?.[1])
    .filter((at): at is string => at !== undefined).map(Number).slice(-lines.length);
  const calls = (existsSync(callsFile) ? readFileSync(callsFile, "utf8") : "").split("\n").filter(Boolean)
    .map((row) => row.split(" ") as [string, string]).map(([at, name]) => [Number(at), name] as const);
  return lines.map((line, i) => {
    const sentAt = sends[i]!;
    const from = sentAt - msOf(line, "queue");
    const counts = new Map<string, number>();
    for (const [at, name] of calls) if (at >= from && at <= sentAt) counts.set(name, (counts.get(name) ?? 0) + 1);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    return `fsSync=${total} (${[...counts].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name.replace(/Sync$/, "")}:${n}`).join(",")})`;
  });
}

it("prints the queue's parts and its main-thread time on a production-sized bot (#4456)", async () => {
  const callsDir = mkdtempSync(join(tmpdir(), "fs-sync-calls-"));
  const callsFile = join(callsDir, "calls.txt");
  await withModel({}, async (fixture) => {
    const { bot } = await fixture.control("new-bot", "--name", "Office bot");
    await fixture.api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "grokfixture", model: "grok-4.7" }, soul: prose(7, 11_500) });
    seedProductionWorkspace(fixture.dataDir, bot.id);
    // earlier conversations to recall from, ten at a time
    for (let batch = 0; batch < EARLIER_CONVERSATIONS / 10; batch += 1) {
      await Promise.all(Array.from({ length: 10 }, async (_, i) => {
        const c = batch * 10 + i;
        const created = await fixture.api("POST", `/api/bots/${bot.id}/tasks`, { title: `Earlier ${c}` });
        for (let t = 0; t < 3; t += 1) await turn(fixture, bot.id, created.task.threadId, prose(10 * c + t, 700));
      }));
    }
    // the long main chat, then the measured follow-ups
    const threadId = bot.activeTaskId;
    for (let t = 0; t < 8; t += 1) await turn(fixture, bot.id, threadId, prose(300 + t, 900));
    const lines: string[] = [];
    for (const text of ["What did we decide about the firewall renewal and the backup budget?", "And the printer contract for the client?", "Which laptop migration is still open?"]) {
      lines.push(await turn(fixture, bot.id, threadId, text));
    }
    // the calls of the last flush (once a second) reach the file
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const files = queueFileCalls(fixture, process.env.FS_SYNC_CALLS_KEEP ?? callsFile, threadId, lines);
    // FS_SYNC_CALLS_KEEP: the calls file stays, with the windows to read it by
    if (process.env.FS_SYNC_CALLS_KEEP) writeFileSync(`${process.env.FS_SYNC_CALLS_KEEP}.windows`, fixture.serverLog().split("\n").filter((line) => line.startsWith(`[turn-trace] ${threadId.slice(0, 8)} send `)).join("\n"));
    console.info(`[#4456] production-sized queue benchmark:\n${lines.map((line, i) => `${line}\n  ${files[i]}`).join("\n")}`);
    const opening = fixture.serverLog().split("\n").find((line) => line.includes("opening prompt") && line.includes(`(thread ${threadId.slice(0, 8)})`));
    console.info(`[#4456] the main chat's ${opening?.replace(/^.*?opening prompt/, "opening prompt") ?? "opening prompt: not logged"}`);
    for (const line of lines) {
      expect(field(line, "queueBy")).toBeDefined();
      expect(msOf(line, "shown")).toBeLessThan(FIRST_TEXT_TARGET_MS);
    }
  }, {
    SAGAX_TURN_LATENCY_BUSY_MS: "0", SAGAX_TURN_TRACE: "1", FS_SYNC_CALLS_FILE: process.env.FS_SYNC_CALLS_KEEP ?? callsFile,
    ...(process.env.FS_SYNC_CALLS_WHERE ? { FS_SYNC_CALLS_WHERE: process.env.FS_SYNC_CALLS_WHERE } : {}),
    NODE_OPTIONS: `--import=${fileURLToPath(new URL("./testing/fs-sync-calls.mjs", import.meta.url))}`,
  }).finally(() => rmSync(callsDir, { recursive: true, force: true }));
}, 360_000);
