import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ActivityRow } from "./activity/activity.ts";
import type { AdminActionRow } from "./activity/admin-activity.ts";
import type { DecisionRow } from "./decision-log.ts";
import { buildJournal, deciderOf, journalWire, replayable, sealJournal, testRuleOnJournal, verifyJournal, type JournalInput, type JournalRow } from "./action-journal.ts";
import { reviewCustomRules } from "./rules/custom-rules-review.ts";
import { JOURNAL_SELF, type JournalEntry } from "../shared/action-journal.ts";
import type { CustomRule } from "../shared/custom-rules.ts";

const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 9, 26, 12, minute, second)).toISOString();

function row(partial: Partial<DecisionRow> & Pick<DecisionRow, "decision" | "source">): DecisionRow {
  return { at: at(0), threadId: "thr-a", botId: "bot-nova", botName: "Nova", tool: "Bash", ...partial };
}

function input(decisions: DecisionRow[], extra: Partial<JournalInput> = {}): JournalInput {
  return {
    decisions,
    owns: (botId) => botId === "bot-nova",
    botName: (botId) => (botId === "bot-nova" ? "Nova" : undefined),
    rule: (source, ruleId) => {
      if (ruleId === "cr-org") return { text: "supprimer des fichiers", behavior: "deny", org: true };
      if (source.startsWith("custom-rule")) return { text: "lire des fichiers dans ~/Projets", behavior: "allow" };
      if (source.startsWith("owner-rule")) return { text: "Run `ls` in this folder", behavior: "allow" };
      return undefined;
    },
    answeredBy: (actor) => (actor?.kind === "session" && actor.userId === "pr_me" ? JOURNAL_SELF : "Someone"),
    deletedBot: "Deleted bot",
    ...extra,
  };
}

describe("the Journal of the person's own bots (2026-10-26)", () => {
  it("keeps one row per request with the final outcome, what kept the card and who answered", () => {
    const { rows } = buildJournal(input([
      row({ requestId: "r1", decision: "card-shown", source: "no-grant", summary: "rm -rf build" }),
      row({ at: at(1), requestId: "r1", decision: "user-denied", source: "user", actor: { kind: "session", sessionId: "s1", label: "Mac", userId: "pr_me" } }),
    ]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "denied", decider: "person", askedBy: "level", answeredBy: JOURNAL_SELF, summary: "rm -rf build", botName: "Nova" });
  });

  it("names the rule that decided: the person's, the organization's, an Always allow, Full access", () => {
    const { rows } = buildJournal(input([
      row({ requestId: "a", decision: "auto-approved", source: "custom-rule", rule: "cr-1" }),
      row({ requestId: "b", decision: "auto-denied", source: "custom-rule-deny", rule: "cr-org" }),
      row({ requestId: "c", decision: "auto-approved", source: "owner-rule", rule: "or-1" }),
      row({ requestId: "d", decision: "auto-approved", source: "owner-bypass" }),
      row({ requestId: "e", decision: "auto-approved", source: "owner-auto" }),
      row({ requestId: "f", decision: "expired", source: "timeout" }),
      row({ requestId: "g", decision: "auto-denied", source: "restart" }),
      // L3: a row that only carries ruleId (canonical) still names the rule
      row({ requestId: "h", decision: "auto-approved", source: "custom-rule", ruleId: "cr-1" }),
    ]));
    const byKey = Object.fromEntries(rows.map((entry) => [entry.requestId, entry]));
    expect(byKey.a).toMatchObject({ outcome: "allowed", decider: "custom-rule", ruleText: "lire des fichiers dans ~/Projets", ruleBehavior: "allow", ruleId: "cr-1" });
    expect(byKey.b).toMatchObject({ outcome: "denied", decider: "org-rule", ruleBehavior: "deny" });
    expect(byKey.c).toMatchObject({ outcome: "allowed", decider: "always-allow" });
    expect(byKey.d).toMatchObject({ decider: "full-access" });
    expect(byKey.e).toMatchObject({ decider: "level" });
    expect(byKey.f).toMatchObject({ outcome: "expired", decider: "expired" });
    expect(byKey.g).toMatchObject({ outcome: "failed", decider: "error" });
    expect(byKey.h).toMatchObject({ outcome: "allowed", decider: "custom-rule", ruleText: "lire des fichiers dans ~/Projets", ruleId: "cr-1" });
  });

  it("shows only the person's own bots", () => {
    const { rows } = buildJournal(input([
      row({ requestId: "mine", decision: "auto-approved", source: "full-access" }),
      row({ requestId: "theirs", botId: "bot-atlas", botName: "Atlas", decision: "auto-approved", source: "full-access" }),
    ]));
    expect(rows.map((entry) => entry.requestId)).toEqual(["mine"]);
  });

  it("folds the tool run into its approval, a failed run marks it failed, and the engine's own runs show without a card", () => {
    const runs: ActivityRow[] = [
      { at: at(0, 2), threadId: "thr-a", tool: "Bash", app: null, label: "Ran a command", outcome: "failed" },
      { at: at(5), threadId: "thr-a", tool: "Read", app: null, label: "Read a file", outcome: "ran" },
    ];
    const { rows } = buildJournal(input([row({ requestId: "r1", decision: "auto-approved", source: "owner-auto" })], { runs: [{ botId: "bot-nova", runs }] }));
    expect(rows).toHaveLength(2);
    expect(rows.find((entry) => entry.requestId === "r1")).toMatchObject({ outcome: "failed", ran: "failed", decider: "level" });
    expect(rows.find((entry) => entry.tool === "Read")).toMatchObject({ outcome: "allowed", decider: "no-card", ran: "ran" });
  });

  it("carries the tool guard's verdict on agent tools, shadow mode included", () => {
    const audit: AdminActionRow[] = [
      { at: at(0), category: "client", action: "agents.create_agent", actor: { kind: "worker" },
        after: { outcome: "card", callerBotId: "bot-nova", requestId: "r1", guard: "not_granted", guardAllow: false, guardMode: "shadow", scope: "agents:admin" } },
      { at: at(9), category: "client", action: "agents.create_agent", actor: { kind: "worker" },
        after: { outcome: "refused", code: "not_granted", callerBotId: "bot-nova", guard: "not_granted", guardAllow: false, guardMode: "enforce", scope: "agents:admin" } },
    ];
    const { rows } = buildJournal(input([row({ requestId: "r1", tool: "mcp__agents__create_agent", decision: "card-shown", source: "no-grant" })], { agentAudit: audit }));
    expect(rows.find((entry) => entry.requestId === "r1")?.guard).toEqual({ allow: false, reason: "not_granted", mode: "shadow", scope: "agents:admin" });
    expect(rows.find((entry) => entry.outcome === "denied")).toMatchObject({ decider: "grant", tool: "agents__create_agent", guard: { mode: "enforce" } });
  });

  it("never sends the kept call on the wire, and caps the list", () => {
    const decisions = Array.from({ length: 5 }, (_, index) => row({ at: at(index), requestId: `r${index}`, decision: "auto-approved", source: "full-access", call: { input: "{\"command\":\"ls\"}" } }));
    const { rows, truncated } = buildJournal(input(decisions, { max: 3 }));
    expect(rows).toHaveLength(3);
    expect(truncated).toBe(true);
    expect(rows[0]!.replayable).toBe(true);
    expect(journalWire(rows[0]!)).not.toHaveProperty("call");
    expect(rows.map((entry) => entry.requestId)).toEqual(["r4", "r3", "r2"]);
  });

  it("maps every decision source to a decider", () => {
    expect(deciderOf("safety-hold")).toBe("safety");
    expect(deciderOf("sagax-internal")).toBe("sagax");
    expect(deciderOf("auto-review")).toBe("reviewer");
    expect(deciderOf("command-allowlist")).toBe("always-allow");
    expect(deciderOf("admin-rule")).toBe("admin-rule");
  });
});

describe("Tester cette règle: the real matcher on the last days", () => {
  // a folder reached through no symbolic link (an allow refuses one)
  const demo = join(realpathSync(tmpdir()), "journal-demo");
  const draft = (when: string, behavior: CustomRule["behavior"]): CustomRule => ({
    id: "rule-test-draft", ownerId: "pr_me", botId: null, when, behavior, riskScope: [], enabled: true, createdAt: 0, updatedAt: 0,
  });
  const rows: JournalRow[] = [
    { key: "a", at: at(1), botId: "bot-nova", botName: "Nova", threadId: "t", tool: "Write", outcome: "allowed", decider: "full-access",
      call: { input: JSON.stringify({ file_path: `${demo}/notes.txt`, content: "x" }) }, replayable: true },
    { key: "b", at: at(2), botId: "bot-nova", botName: "Nova", threadId: "t", tool: "Read", outcome: "asked", decider: "level",
      call: { input: JSON.stringify({ file_path: `${demo}/plan.md` }) }, replayable: true },
    { key: "q", at: at(3), botId: "bot-nova", botName: "Nova", threadId: "t", tool: "AskUserQuestion", outcome: "asked", decider: "level", source: "question" },
  ];
  const replayWith = (rule: CustomRule) => (entry: JournalRow) => replayable(entry)
    ? reviewCustomRules([rule], { tool: entry.tool, ...(entry.call?.input ? { input: entry.call.input } : {}) }, entry.botId, "/home/demo").decision
    : null;

  it("a deny rule lists what it would have refused and what changes", () => {
    const result = testRuleOnJournal(rows, "rule-test-draft", replayWith(draft(`modifier des fichiers dans ${demo}`, "deny")), 7);
    expect(result.scanned).toBe(2);
    expect(result.matched).toBe(1);
    expect(result.counts).toMatchObject({ denied: 1, changed: 1 });
    expect(result.hits[0]).toMatchObject({ key: "a", actual: "allowed", would: "denied", changed: true });
  });

  it("an allow rule shows the card it would have spared", () => {
    const result = testRuleOnJournal(rows, "rule-test-draft", replayWith(draft(`lire des fichiers dans ${demo}`, "allow")), 7);
    expect(result.hits.map((hit) => [hit.key, hit.would, hit.changed])).toEqual([["b", "allowed", true]]);
  });

  it("a phrase the matcher cannot read matches nothing", () => {
    const result = testRuleOnJournal(rows, "rule-test-draft", () => null, 7, true);
    expect(result).toMatchObject({ unreadable: true, matched: 0, hits: [] });
  });
});

describe("journal hash chain", () => {
  const entry = (key: string, atIso: string, summary: string): JournalEntry => ({
    key, at: atIso, botId: "bot-nova", botName: "Nova", threadId: "thr-a", tool: "Bash", outcome: "allowed", decider: "person", summary,
  });

  it("links SHA-256 hashes, verifies, and leaves out the summary", () => {
    const chain = sealJournal([
      entry("b", "2026-10-26T12:02:00.000Z", "the message said hello and the token is secret-value"),
      entry("a", "2026-10-26T12:01:00.000Z", "earlier words"),
    ]);
    expect(chain.entries.map((link) => link.at)).toEqual(["2026-10-26T12:01:00.000Z", "2026-10-26T12:02:00.000Z"]);
    expect(chain.entries[1]!.prev).toBe(chain.entries[0]!.hash);
    expect(verifyJournal(chain)).toEqual({ ok: true });
    expect(JSON.stringify(chain)).not.toContain("secret-value");
    expect(JSON.stringify(chain)).not.toContain("hello");
    const broken = { ...chain, entries: chain.entries.map((link, index) => index === 1 ? { ...link, tool: "Write" } : link) };
    expect(verifyJournal(broken)).toEqual({ ok: false, index: 1 });
  });
});
