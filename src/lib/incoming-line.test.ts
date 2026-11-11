// #3581: what came in from another bot or an AI client folds into one names
// line, one name per party, a count when there are more requests than names.
// Neutral names only (term-guard).
import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { collapseIncomingLines, incomingEntry, incomingParties, incomingTail, relayAskEntry } from "./incoming-line";

const SELF = "self";
const at = 1_800_000_000_000;
const receipt = (i: number, asker: string, extra: Partial<Message> = {}): Message => ({
  id: `s${i}`, role: "bot", kind: "activity", at: at + i,
  from: { botId: asker, name: asker.toUpperCase(), color: "green" },
  tool: { name: `Asked by ${asker}`, ok: true, input: `Request ${i}`, handoffId: `h${i}` },
  threadRef: { botId: SELF, threadId: `w${i}`, title: "Work" },
  ...extra,
}) as Message;
const copy = (id: string, by: { botId?: string; by?: string }, via: "teammate" | "mcp", extra: Partial<Message> = {}): Message => ({
  id, role: "bot", kind: "text", at, text: "Three duplicates.", relayVia: via, relayOf: `k${id}`,
  relayAsk: { text: "List the duplicates", ...by }, ...extra,
}) as Message;
const items = (rows: Message[]) => rows.map((message) => ({ kind: "message" as const, message }));
const fold = (rows: Message[]) => collapseIncomingLines(items(rows), { selfBotId: SELF, lookup: rows, silent: () => false });

describe("relayAskEntry", () => {
  it("reads who asked and what, for a stored copy and a waiting card alike (one mapping)", () => {
    const card = { ...copy("q", { botId: "b", by: "B" }, "teammate"), kind: "options", text: "Pick one" } as Message;
    expect(relayAskEntry(card)).toEqual({ verb: "askedBy", key: "b", botId: "b", name: "B", request: "List the duplicates", message: card });
    const agent = copy("c", { by: "Client" }, "mcp");
    expect(relayAskEntry(agent)).toEqual({ verb: "askedBy", key: "agent:Client", name: "Client", agent: true, request: "List the duplicates", message: agent });
    // the stored copy's entry is the same, with its reply
    expect(incomingEntry(agent, SELF, [])).toEqual({ ...relayAskEntry(agent), reply: "Three duplicates." });
    expect(relayAskEntry({ ...agent, relayVia: "routine" } as Message)).toBeNull();
  });
});

describe("incomingEntry", () => {
  it("reads a received hand-off as Asked by, with its request kept for the sheet", () => {
    expect(incomingEntry(receipt(0, "b"), SELF, [])).toMatchObject({ verb: "askedBy", key: "b", botId: "b", threadId: "w0", request: "Request 0" });
  });

  it("leaves a hand-off this bot sent to the Asked line", () => {
    expect(incomingEntry(receipt(0, SELF, { threadRef: { botId: "b", threadId: "w", title: "Work" } }), SELF, [])).toBeNull();
  });

  it("reads an AI client's stored copy as Asked by an agent, request and reply kept", () => {
    expect(incomingEntry(copy("c", { by: "Client" }, "mcp"), SELF, [])).toMatchObject({
      verb: "askedBy", key: "agent:Client", agent: true, name: "Client", request: "List the duplicates", reply: "Three duplicates.",
    });
  });

  it("keeps why a copied turn left nothing, never its placeholder words", () => {
    const entry = incomingEntry(copy("c", { botId: "b", by: "B" }, "teammate", { relayTrace: "stopped", text: "This request was stopped before an answer." }), SELF, []);
    expect(entry).toMatchObject({ trace: "stopped" });
    expect(entry?.reply).toBeUndefined();
  });

  it("reads a surfaced notice as Message from, and an answer above the page as Answer from", () => {
    const notice = { id: "n", role: "bot", kind: "activity", at, from: { botId: "b", name: "B", color: "blue" }, tool: { name: "Message from B: #Work", ok: true }, threadRef: { botId: SELF, threadId: "p", title: "Work" } } as Message;
    expect(incomingEntry(notice, SELF, [])).toMatchObject({ verb: "messageFrom", key: "b", threadId: "p" });
    const answer = { id: "a", role: "bot", kind: "activity", at, roomRequest: { id: "gone", phase: "result" }, tool: { name: "B replied", ok: true, output: "Done." }, threadRef: { botId: "b", threadId: "w", title: "B" } } as Message;
    expect(incomingEntry(answer, SELF, [answer])).toMatchObject({ verb: "answerFrom", key: "b", reply: "Done." });
  });

  it("keeps a notice's failed or stopped thread on the line's tail, as Answer from does", () => {
    const notice = (status: string) => ({ id: `n-${status}`, role: "bot", kind: "activity", at, from: { botId: "b", name: "B", color: "blue" }, tool: { name: `Message from B: #Work (${status})`, ok: false }, threadRef: { botId: SELF, threadId: "p", title: "Work" } }) as Message;
    const failed = incomingEntry(notice("failed"), SELF, []);
    expect(failed).toMatchObject({ verb: "messageFrom", trace: "failed" });
    expect(incomingTail([failed!], 1)).toEqual({ trace: "failed" });
    expect(incomingEntry(notice("expired"), SELF, [])).toMatchObject({ verb: "messageFrom", trace: "stopped" });
    const done = { ...notice("x"), tool: { name: "Message from B: #Work", ok: true } } as Message;
    expect(incomingEntry(done, SELF, [])?.trace).toBeUndefined();
  });

  it("is null for the person's own lines and a routine's copy", () => {
    expect(incomingEntry({ id: "u", role: "user", kind: "text", at, text: "Hi" } as Message, SELF, [])).toBeNull();
    expect(incomingEntry(copy("r", {}, "teammate", { relayVia: "routine" }), SELF, [])).toBeNull();
  });
});

describe("collapseIncomingLines", () => {
  it("folds five requests from three bots into one line, three names and a count of 5", () => {
    const rows = [receipt(0, "b"), receipt(1, "c"), receipt(2, "b"), receipt(3, "d"), receipt(4, "c")];
    const out = fold(rows);
    expect(out).toHaveLength(1);
    const line = out[0] as Extract<(typeof out)[number], { kind: "incomingLine" }>;
    expect(line.kind).toBe("incomingLine");
    const parties = incomingParties(line.entries);
    expect(parties.map((party) => party.key)).toEqual(["b", "c", "d"]);
    // newest first in a party's sheet
    expect(parties[0]!.entries.map((entry) => entry.message.id)).toEqual(["s2", "s0"]);
    expect(incomingTail(line.entries, parties.length)).toEqual({ count: 5 });
    expect(line.messages).toHaveLength(5);
  });

  it("counts a request and the copy of its reply right under it once", () => {
    const rows = [receipt(0, "b"), copy("c0", { botId: "b", by: "B" }, "teammate")];
    const line = fold(rows)[0] as { kind: string; entries: { reply?: string }[] };
    expect(line.kind).toBe("incomingLine");
    expect(line.entries).toHaveLength(1);
    expect(line.entries[0]!.reply).toBe("Three duplicates.");
  });

  it("passes over an answer drawn in its receipt's line, and breaks on the person's words", () => {
    const answer = { id: "a0", role: "bot", kind: "activity", at, roomRequest: { id: "h0", phase: "result" }, tool: { name: "replied", ok: true }, threadRef: { botId: SELF, threadId: "w0", title: "Work" } } as Message;
    const person = { id: "u", role: "user", kind: "text", at, text: "Hi" } as Message;
    const out = fold([receipt(0, "b"), answer, receipt(1, "b"), person, receipt(2, "b")]);
    expect(out.map((item) => item.kind)).toEqual(["incomingLine", "message", "incomingLine"]);
  });

  it("with threads on, folds only stored copies", () => {
    const rows = [receipt(0, "b"), copy("c", { by: "Client" }, "mcp")];
    const out = collapseIncomingLines(items(rows), { selfBotId: SELF, lookup: rows, silent: () => false, copiesOnly: true });
    expect(out.map((item) => item.kind)).toEqual(["message", "incomingLine"]);
  });

  it("says why a lone request left no answer", () => {
    const line = fold([copy("c", { by: "Client" }, "mcp", { relayTrace: "failed" })])[0] as unknown as { entries: never[] };
    expect(incomingTail(line.entries, 1)).toEqual({ trace: "failed" });
  });
});
