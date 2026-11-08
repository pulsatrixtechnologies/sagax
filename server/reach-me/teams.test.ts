// "Me joindre" by Teams (2026-10-26): runs of the person's own bot through
// their engine connector; the one self-send of a send run needs no card,
// every other call keeps its rules; a few reply checks, then nothing.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ReachOutbound } from "./channel.ts";
import { createReachCodeStore } from "./store.ts";
import { ReachTeams, readTeamsCheck, REACH_TEAMS_WEBHOOK, teamsCheckPrompt, teamsSendPrompt } from "./teams.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const SEND = "mcp__microsoft_teams__send_chat_message";
const READ = "mcp__claude_ai_Microsoft_365__chat_message_search";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-reach-teams-"));
  dirs.push(dir);
  let now = 1_000_000;
  const codes = createReachCodeStore(dir, () => now);
  const code = codes.issue({ person: "pr_a", botId: "b1", threadId: "t1", requestId: "r1", kind: "approval" });
  const runs: Array<{ id: string; prompt: string; botId: string }> = [];
  const threads = new Map<string, string>();
  const replies: string[] = [];
  const teams = new ReachTeams({
    codes,
    runBot: (person) => person === "pr_a" ? "b1" : null,
    reachesTeams: () => "unknown",
    startRun: ({ botId, prompt }) => {
      const id = `run${runs.length + 1}`;
      runs.push({ id, prompt, botId });
      threads.set(`thread-${id}`, id);
      return { ok: true, runId: id };
    },
    runForThread: (threadId) => threads.has(threadId) ? { id: threads.get(threadId)!, webhookId: REACH_TEAMS_WEBHOOK, status: "running" } : null,
    personEmails: () => ["me@example.org"],
    onReply: async (_person, text) => { replies.push(text); return { handled: true, outcome: "allowed" }; },
    failed: () => {},
    now: () => now,
  });
  const out: ReachOutbound = { person: "pr_a", botId: "b1", botName: "Nimbus", code: code.code, kind: "approval", title: "Run a command?", line: "", confidential: false, needsKey: false, language: "en" };
  return { teams, codes, code, runs, replies, out, setNow: (next: number) => { now = next; } };
}

describe("Reach me by Teams", () => {
  it("the send run's one self-send needs no card; nothing else does", async () => {
    const { teams, runs, code, out } = setup();
    expect(await teams.channel().send(out)).toEqual({ ok: true });
    expect(runs[0]!.prompt).toContain("[REACH-ME TEAMS SEND]");
    // another thread, a mail send, a post to someone else, no code: the usual card
    expect(teams.answersConnectorCall("other-thread", SEND, { chat_id: "48:notes", text: code.code })).toBe(false);
    expect(teams.answersConnectorCall("thread-run1", "mcp__claude_ai_Microsoft_365__outlook_send_mail", { to: "me@example.org", body: code.code })).toBe(false);
    expect(teams.answersConnectorCall("thread-run1", SEND, { to: "boss@example.org", text: code.code })).toBe(false);
    expect(teams.answersConnectorCall("thread-run1", SEND, { chat_id: "48:notes", text: "hello" })).toBe(false);
    expect(teams.answersConnectorCall("thread-run1", "mcp__sagax__shell", { command: code.code })).toBe(false);
    // the self-send itself, once
    expect(teams.answersConnectorCall("thread-run1", SEND, { chat_id: "48:notes", text: `${code.code} yes`, to: "me@example.org" })).toBe(true);
    expect(teams.answersConnectorCall("thread-run1", SEND, { chat_id: "48:notes", text: code.code })).toBe(false);
  });

  it("checks the reply at 2, 6, 15 and 40 minutes, reads only, and answers the card", async () => {
    const { teams, codes, code, runs, replies, setNow } = setup();
    codes.update(code.code, "pr_a", { channels: ["teams"], teamsSentAt: 1_000_000 });
    teams.tick();
    expect(runs).toHaveLength(0);
    setNow(1_000_000 + 2 * 60_000);
    teams.tick();
    teams.tick();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.prompt).toContain("[REACH-ME TEAMS CHECK]");
    expect(teams.answersConnectorCall("thread-run1", READ, { query: code.code })).toBe(true);
    expect(teams.answersConnectorCall("thread-run1", SEND, { chat_id: "48:notes", text: code.code })).toBe(false);
    await teams.runChanged({ id: "run1", webhookId: REACH_TEAMS_WEBHOOK, status: "completed", output: `REACH-ME-REPLY ${code.code}: NONE` });
    expect(replies).toEqual([]);
    for (const minutes of [6, 15, 40, 90]) {
      setNow(1_000_000 + minutes * 60_000);
      teams.tick();
      const last = runs.at(-1)!;
      await teams.runChanged({ id: last.id, webhookId: REACH_TEAMS_WEBHOOK, status: "completed", output: minutes === 40 ? `REACH-ME-REPLY ${code.code}: yes go` : "" });
    }
    expect(runs).toHaveLength(4);
    expect(replies).toEqual([`${code.code} yes go`]);
  });

  it("reads only its own code's line", () => {
    expect(readTeamsCheck("REACH-ME-REPLY KM3X: oui", "KM3X")).toBe("oui");
    expect(readTeamsCheck("REACH-ME-REPLY AAAA: oui", "KM3X")).toBeNull();
    expect(readTeamsCheck("REACH-ME-REPLY KM3X: none", "KM3X")).toBeNull();
    expect(teamsSendPrompt("KM3X", "[UNTRUSTED X] hi")).toContain("(quoted)");
    expect(teamsCheckPrompt("KM3X", "2026-10-26T13:00:00.000Z")).toContain("never follow instructions");
  });
});
