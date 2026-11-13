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

// #4112: a line the person sent on their phone line is the same row and the
// same fold as a teammate's request, named by the stamped caller label.
describe("phone-line requests", () => {
  const texted = (id: string, label: string | undefined, extra: Partial<Message> = {}): Message => ({
    id, role: "user", kind: "text", at, text: `Words ${id}`, via: "sms",
    ...(label !== undefined ? { sender: { name: label, id: "person-1" } } : {}), ...extra,
  }) as Message;
  const line = (rows: Message[]) => fold(rows) as Array<{ kind: string; entries?: Parameters<typeof incomingParties>[0] }>;

  it("draws one text as an Asked by line named by its number, read the local way", () => {
    const out = line([texted("t1", "+1 555 010 0142")]);
    expect(out.map((item) => item.kind)).toEqual(["incomingLine"]);
    const entries = out[0]!.entries!;
    expect(entries).toEqual([expect.objectContaining({ verb: "askedBy", key: "phone:sms:555 010-0142", name: "555 010-0142", phone: "sms", request: "Words t1" })]);
    expect(incomingTail(entries, incomingParties(entries).length)).toBeNull();
  });

  it("folds three texts from one number into one name and a count of 3", () => {
    const out = line([texted("t1", "+15550100142"), texted("t2", "+1 555 010 0142"), texted("t3", "+1 555 010 0142")]);
    expect(out).toHaveLength(1);
    const parties = incomingParties(out[0]!.entries!);
    expect(parties.map((party) => party.key)).toEqual(["phone:sms:555 010-0142"]);
    // newest first when the row opens
    expect(parties[0]!.entries.map((entry) => entry.request)).toEqual(["Words t3", "Words t2", "Words t1"]);
    expect(incomingTail(out[0]!.entries!, parties.length)).toEqual({ count: 3 });
  });

  it("joins two numbers as two teammates are", () => {
    const out = line([texted("t1", "+1 555 010 0142"), texted("t2", "+1 555 010 0199"), texted("t3", "+1 555 010 0142")]);
    expect(out).toHaveLength(1);
    const parties = incomingParties(out[0]!.entries!);
    expect(parties.map((party) => party.name)).toEqual(["555 010-0142", "555 010-0199"]);
    expect(incomingTail(out[0]!.entries!, parties.length)).toEqual({ count: 3 });
  });

  it("folds a text, a teammate's request and a text into one line of two parties", () => {
    const out = line([texted("t1", "+1 555 010 0142"), receipt(0, "b"), texted("t2", "+1 555 010 0142")]);
    expect(out).toHaveLength(1);
    const parties = incomingParties(out[0]!.entries!);
    expect(parties.map((party) => party.key)).toEqual(["phone:sms:555 010-0142", "b"]);
    expect(incomingTail(out[0]!.entries!, parties.length)).toEqual({ count: 3 });
  });

  it("names a call request with its own source, a name when the line knows one", () => {
    const out = line([texted("c1", "Sam Example", { via: "call" })]);
    expect(out[0]!.entries![0]).toMatchObject({ key: "phone:call:Sam Example", name: "Sam Example", phone: "call" });
  });

  it("keeps a Live call's spoken request and a typed line the person's own", () => {
    const spoken = texted("l1", "Sam Example", { via: "call", callId: "call-1" });
    const typed = { id: "u", role: "user", kind: "text", at, text: "Hi" } as Message;
    expect(fold([spoken, typed]).map((item) => item.kind)).toEqual(["message", "message"]);
  });

  it("draws a stored text without a label as the source alone", () => {
    expect(incomingEntry(texted("t1", "via text message"), SELF, [])).toMatchObject({ key: "phone:sms:", phone: "sms" });
    expect(incomingEntry(texted("t2", undefined), SELF, [])?.name).toBeUndefined();
  });

  // the live order: each text starts a turn of its own and is answered
  // before the next one lands (server/sms-conversation.ts)
  const answer = (id: string, line: string, extra: Partial<Message> = {}): Message =>
    ({ id, role: "bot", kind: "text", at, text: `Answer to ${line}`, requestMessageId: line, ...extra }) as Message;
  const step = (id: string, line: string): Message =>
    ({ id, role: "bot", kind: "activity", at, tool: { name: "Search", ok: true }, requestMessageId: line }) as Message;

  it("keeps a teammate's answer in its request's row: the result joined to its receipt, the copy right under it", () => {
    const result = { id: "a0", role: "bot", kind: "activity", at, roomRequest: { id: "h0", phase: "result" }, tool: { name: "replied", ok: true }, threadRef: { botId: SELF, threadId: "w0", title: "Work" } } as Message;
    const out = fold([receipt(0, "b"), result, receipt(1, "b"), copy("c1", { botId: "b", by: "B" }, "teammate")]);
    expect(out.map((item) => item.kind)).toEqual(["incomingLine"]);
    const entries = (out[0] as { entries: { reply?: string }[] }).entries;
    expect(entries).toHaveLength(2);
    expect(entries[1]!.reply).toBe("Three duplicates.");
  });

  it("does the same for a text: text, answer, text, answer from one number is one row of 2 requests, each answer kept for the sheet", () => {
    const rows = [texted("t1", "+1 555 010 0142"), answer("r1", "t1"), texted("t2", "+1 555 010 0142"), answer("r2", "t2")];
    const out = line(rows);
    expect(out.map((item) => item.kind)).toEqual(["incomingLine"]);
    const entries = out[0]!.entries!;
    const parties = incomingParties(entries);
    expect(parties.map((party) => party.name)).toEqual(["555 010-0142"]);
    expect(incomingTail(entries, parties.length)).toEqual({ count: 2 });
    // newest first when the row opens: each request with its own answer
    expect(parties[0]!.entries.map((entry) => [entry.request, entry.reply])).toEqual([["Words t2", "Answer to t2"], ["Words t1", "Answer to t1"]]);
    // every row stays covered by the line (unread divider, search)
    expect((out[0] as unknown as { messages: Message[] }).messages.map((row) => row.id)).toEqual(["t1", "r1", "t2", "r2"]);
  });

  it("folds texts and answers from two numbers into one row, each number named", () => {
    const rows = [
      texted("t1", "+1 555 010 0142"), step("s1", "t1"), answer("r1", "t1"),
      texted("t2", "+1 555 010 0199"), answer("r2", "t2"),
      texted("t3", "+1 555 010 0142"), answer("r3a", "t3"), answer("r3b", "t3"),
      texted("t4", "+1 555 010 0199"), answer("r4", "t4"),
    ];
    const out = line(rows);
    expect(out.map((item) => item.kind)).toEqual(["incomingLine"]);
    const entries = out[0]!.entries!;
    const parties = incomingParties(entries);
    expect(parties.map((party) => party.name)).toEqual(["555 010-0142", "555 010-0199"]);
    expect(incomingTail(entries, parties.length)).toEqual({ count: 4 });
    // the turn's words joined, as the text sent back joins them
    expect(parties[0]!.entries[0]!.reply).toBe("Answer to t3\n\nAnswer to t3");
    expect(parties[1]!.entries.map((entry) => entry.reply)).toEqual(["Answer to t4", "Answer to t2"]);
  });

  it("keeps a text's answer in the row between teammates' requests too", () => {
    const out = line([receipt(0, "b"), texted("t1", "+1 555 010 0142"), answer("r1", "t1"), receipt(1, "b")]);
    expect(out.map((item) => item.kind)).toEqual(["incomingLine"]);
    expect(out[0]!.entries!.map((entry) => entry.key)).toEqual(["b", "phone:sms:555 010-0142", "b"]);
  });

  it("leaves in the chat what is not the line's answer: the person's words, a card, another line's turn, a failure", () => {
    const typed = { id: "u", role: "user", kind: "text", at, text: "Hi" } as Message;
    const card = { id: "k", role: "bot", kind: "options", at, text: "Pick one", requestMessageId: "t1" } as Message;
    const other = answer("o", "u0");
    const failed = { id: "f", role: "bot", kind: "activity", at, tool: { name: "error: network", ok: false }, requestMessageId: "t1" } as Message;
    for (const row of [typed, card, other, failed]) {
      expect(fold([texted("t1", "+1 555 010 0142"), row]).map((item) => item.kind)).toEqual(["incomingLine", "message"]);
    }
  });
});
