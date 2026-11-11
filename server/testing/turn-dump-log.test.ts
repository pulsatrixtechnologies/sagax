import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { removeTempDir } from "./cleanup.ts";
import { turnWithPrompt } from "./turn-dump-log.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTempDir(dir);
});

const turnsLog = () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-turn-dump-log-"));
  dirs.push(dir);
  return join(dir, "turns.jsonl");
};

// The record's shape as fake-claude-cli.ts logs it: the prompt is the stream
// frame the turn was given, its context first, the person's words last.
const turn = (content: string, systemPrompt: string) => ({
  pid: 1, argv: [], env: {}, cwd: "/", systemPrompt,
  prompt: { type: "user", message: { role: "user", content } },
});

it("returns the turn given the text, not a turn that ran after it or quoted it", async () => {
  const log = turnsLog();
  // #3634: the follow-up of an earlier conversation is logged first; its
  // context lists the newer topic ("Asked: ...") without being that turn
  appendFileSync(log, `${JSON.stringify(turn("<system-reminder>\n- Topic \"Bob's second\"\n  Asked: \"BOB-SECOND what came before?\"\n</system-reminder>\n\n[Sagax note, not from the person] finish it", "no digest"))}\n`);
  appendFileSync(log, `${JSON.stringify(turn("[end of recalled passages]\n\nBOB-SECOND what came before?\n\n<workplace>", "bob's digest"))}\n`);
  // another turn lands after it, and a line is still being written
  appendFileSync(log, `${JSON.stringify(turn("[Sagax note, not from the person] finish it", "later"))}\n`);
  appendFileSync(log, "{\"pid\":2,\"prom");
  const found = await turnWithPrompt(log, "BOB-SECOND what came before?", 2_000);
  expect(found.systemPrompt).toBe("bob's digest");

  // a turn that is not logged yet is waited for
  const later = turnWithPrompt(log, "ALICE-LATER \"quoted\" topic", 5_000);
  setTimeout(() => appendFileSync(log, `\n${JSON.stringify(turn("ALICE-LATER \"quoted\" topic", "alice's"))}\n`), 200);
  expect((await later).systemPrompt).toBe("alice's");
});

it("ends on its bound with a message that names the text", async () => {
  const log = turnsLog();
  appendFileSync(log, `${JSON.stringify(turn("something else", "x"))}\n`);
  const started = Date.now();
  await expect(turnWithPrompt(log, "NEVER-SENT", 300)).rejects.toThrow(/"NEVER-SENT".*300 ms.*1 turns logged/);
  expect(Date.now() - started).toBeLessThan(5_000);
});
