import { describe, expect, it } from "vitest";

import {
  bulkPlan,
  DEFAULT_INBOX_FILTERS,
  filterInbox,
  inboxAge,
  inboxAgeTone,
  inboxHash,
  inboxKey,
  inboxRisky,
  isInboxHash,
  parseInboxHash,
  searchInboxHistory,
  sortInbox,
  type InboxApproval,
} from "./approvals-inbox.ts";

function entry(id: string, patch: Partial<InboxApproval> = {}): InboxApproval {
  return { key: inboxKey("t", id), threadId: "t", requestId: id, botId: "b1", botName: "Nova", scope: "mine", kind: "permission", at: 1, decidable: true, bulk: true, ...patch };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("filters", () => {
  const rows = [
    entry("a", { scope: "mine", risk: "read" }),
    entry("b", { scope: "org", risk: "destructive", botId: "b2" }),
    entry("c", { scope: "team", kind: "question", decidable: false }),
    entry("d", { scope: "mine", kind: "proposal" }),
    entry("e", { scope: "mine", risk: "write", needsKey: true }),
  ];
  const ids = (filters: Partial<typeof DEFAULT_INBOX_FILTERS>) => filterInbox(rows, { ...DEFAULT_INBOX_FILTERS, ...filters }).map((row) => row.requestId);

  it("combines scope, bot, type and risk with AND", () => {
    expect(ids({})).toEqual(["a", "b", "c", "d", "e"]);
    expect(ids({ scope: "mine" })).toEqual(["a", "d", "e"]);
    expect(ids({ scope: "mine", risky: true })).toEqual(["e"]);
    expect(ids({ bot: "b2" })).toEqual(["b"]);
    expect(ids({ bot: "b2", scope: "mine" })).toEqual([]);
    expect(ids({ kind: "question" })).toEqual(["c"]);
    // a proposal asks for an Allow too
    expect(ids({ kind: "permission" })).toEqual(["a", "b", "d", "e"]);
  });

  it("calls risky what deletes, runs, needs a key or waits for an admin", () => {
    expect(inboxRisky({ risk: "read" })).toBe(false);
    expect(inboxRisky({ risk: "write" })).toBe(false);
    expect(inboxRisky({ risk: "execute" })).toBe(true);
    expect(inboxRisky({ risk: "destructive" })).toBe(true);
    expect(inboxRisky({ needsKey: true })).toBe(true);
    expect(inboxRisky({ waitingOn: "admin" })).toBe(true);
  });

  it("puts the oldest first", () => {
    expect(sortInbox([entry("n", { at: 30 }), entry("o", { at: 10 }), entry("m", { at: 20 })]).map((row) => row.requestId)).toEqual(["o", "m", "n"]);
  });
});

describe("the address", () => {
  it("keeps the filters, and nothing for the defaults", () => {
    expect(inboxHash(DEFAULT_INBOX_FILTERS)).toBe("#approvals");
    const filters = { ...DEFAULT_INBOX_FILTERS, scope: "org" as const, bot: "bot-1", kind: "question" as const, risky: true };
    const hash = inboxHash(filters);
    expect(hash).toBe("#approvals?scope=org&bot=bot-1&kind=question&risky=1");
    expect(parseInboxHash(hash)).toEqual(filters);
    expect(parseInboxHash(inboxHash({ ...DEFAULT_INBOX_FILTERS, tab: "history", q: "rm -rf" }))).toMatchObject({ tab: "history", q: "rm -rf" });
  });

  it("falls back to defaults on anything unknown", () => {
    expect(parseInboxHash("#approvals?scope=everyone&kind=x&bot=../../etc&risky=yes")).toEqual(DEFAULT_INBOX_FILTERS);
    expect(parseInboxHash("#thread=abc")).toEqual(DEFAULT_INBOX_FILTERS);
    expect(isInboxHash("#approvals")).toBe(true);
    expect(isInboxHash("#approvals?tab=history")).toBe(true);
    expect(isInboxHash("#approvalsx")).toBe(false);
  });
});

describe("age", () => {
  it("is green under an hour, amber under a day, red beyond", () => {
    const now = 10 * DAY;
    expect(inboxAgeTone(now - 59 * MIN, now)).toBe("fresh");
    expect(inboxAgeTone(now - HOUR, now)).toBe("aging");
    expect(inboxAgeTone(now - 23 * HOUR, now)).toBe("aging");
    expect(inboxAgeTone(now - DAY, now)).toBe("stale");
    expect(inboxAgeTone(now + MIN, now)).toBe("fresh");
  });

  it("reads in its largest unit", () => {
    const now = 10 * DAY;
    expect(inboxAge(now - 20_000, now)).toEqual({ n: 0, unit: "now" });
    expect(inboxAge(now - 5 * MIN, now)).toEqual({ n: 5, unit: "min" });
    expect(inboxAge(now - 3 * HOUR, now)).toEqual({ n: 3, unit: "h" });
    expect(inboxAge(now - 4 * DAY, now)).toEqual({ n: 4, unit: "d" });
  });
});

describe("bulk", () => {
  const rows = [
    entry("ok"),
    entry("q", { kind: "question", bulk: "question" }),
    entry("k", { needsKey: true, bulk: "needs-key" }),
    entry("c", { bulk: "confidential" }),
    entry("t", { decidable: false, bulk: "not-yours" }),
  ];

  it("answers plain permissions and says why the others wait", () => {
    const plan = bulkPlan(rows, "allow");
    expect(plan.answered.map((row) => row.requestId)).toEqual(["ok"]);
    expect(plan.skipped.map(({ entry: row, reason }) => [row.requestId, reason])).toEqual([
      ["q", "question"], ["k", "needs-key"], ["c", "confidential"], ["t", "not-yours"],
    ]);
  });

  it("lets a Deny cover a card whose Allow needs a key", () => {
    expect(bulkPlan(rows, "deny").answered.map((row) => row.requestId)).toEqual(["ok", "k"]);
  });

  it("never plans more than fifty", () => {
    const many = Array.from({ length: 60 }, (_, i) => entry(`r${i}`));
    expect(bulkPlan(many, "allow").answered).toHaveLength(50);
  });
});

describe("history search", () => {
  const rows = [
    { at: "2026-10-19T10:00:00.000Z", decision: "allow", who: "Ada", botName: "Nova", tool: "Bash", threadId: "t" },
    { at: "2026-10-19T12:00:00.000Z", decision: "deny", who: "Bob", botName: "Pixel", summary: "rm -rf build", threadId: "t" },
  ];
  it("matches bot, person, tool, summary or decision, newest first", () => {
    expect(searchInboxHistory(rows, "").map((row) => row.who)).toEqual(["Bob", "Ada"]);
    expect(searchInboxHistory(rows, "pixel").map((row) => row.who)).toEqual(["Bob"]);
    expect(searchInboxHistory(rows, "RM -RF").map((row) => row.who)).toEqual(["Bob"]);
    expect(searchInboxHistory(rows, "ada").map((row) => row.who)).toEqual(["Ada"]);
    expect(searchInboxHistory(rows, "zzz")).toEqual([]);
  });
});
