import { describe, expect, it } from "vitest";

import {
  exchangeSide,
  chipParty,
  collapseBotExchanges,
  commIsBotDm,
  exchangeBody,
  exchangeJumpStays,
  exchangeSheetRow,
  startsNewStretch,
  transcriptDateLabel,
  type ExchangeParty,
} from "./bot-exchange";
import type { Message } from "@/state/store";

const NOTE = "[Message from @Quasar, another bot in this Sagax workspace. Reply to them.]\n\nWhich database?";

function line(id: string, role: "bot" | "user", text: string, at: number, extra?: object): Message {
  return { id, role, kind: "text", text, at, ...extra } as Message;
}

const quasar = { botId: "cry", name: "Quasar", color: "blue" as const };
const unraid = { botId: "un", name: "unRAID", color: "orange" as const };
const members = [
  { id: "un", name: "unRAID", color: "orange" },
  { id: "cry", name: "Quasar", color: "blue" },
];

function kinds(messages: Message[], options?: Parameters<typeof collapseBotExchanges>[1]) {
  return collapseBotExchanges(messages, options).map((item) => item.kind);
}

describe("collapseBotExchanges", () => {
  it("collapses a peer line and leaves the person and a reply to the person inline", () => {
    const messages = [
      line("u", "user", "hello", 1),
      line("p", "user", NOTE, 2, { peerAsk: { botId: "cry", name: "Quasar" } }),
      line("b", "bot", "sure", 3),
    ];
    const items = collapseBotExchanges(messages, { selfBotId: "un" });
    expect(items.map((item) => item.kind)).toEqual(["message", "exchange", "message"]);
    expect(items[0]).toMatchObject({ message: { id: "u" } });
    expect(items[2]).toMatchObject({ message: { id: "b" } });
    if (items[1]?.kind !== "exchange") throw new Error("expected a run");
    expect(items[1].run.messages.map((message) => message.id)).toEqual(["p"]);
    expect(items[1].run.party).toMatchObject({ id: "cry", name: "Quasar" });
  });

  it("joins this bot's reply only when its request is the peer, and names that peer", () => {
    const peer = line("p", "user", NOTE, 2, { peerAsk: { botId: "cry", name: "Quasar" } });
    const reply = line("r", "bot", "on it", 3, { requestMessageId: "p" });
    const items = collapseBotExchanges([line("u", "user", "hello", 1), peer, reply], { selfBotId: "un" });
    expect(items.map((item) => item.kind)).toEqual(["message", "exchange"]);
    if (items[1]?.kind !== "exchange") throw new Error("expected a run");
    expect(items[1].run.messages.map((message) => message.id)).toEqual(["p", "r"]);
    expect(items[1].run.party.name).toBe("Quasar");
  });

  it("keeps a reply whose request is the person, and a summary with no request", () => {
    const peer = line("p", "user", NOTE, 2, { peerAsk: { botId: "cry", name: "Quasar" } });
    const toPerson = line("r", "bot", "here you go", 3, { requestMessageId: "u" });
    const summary = line("s", "bot", "Quasar finished the check", 4);
    const items = collapseBotExchanges([line("u", "user", "hello", 1), peer, toPerson, summary], { selfBotId: "un" });
    expect(kinds([line("u", "user", "hello", 1), peer, toPerson, summary], { selfBotId: "un" })).toEqual([
      "message",
      "exchange",
      "message",
      "message",
    ]);
    expect(items.filter((item) => item.kind === "message").map((item) => item.kind === "message" && item.message.id)).toEqual(["u", "r", "s"]);
  });

  it("collapses another bot's line in this 1:1, and a roomRequest copy", () => {
    const foreign = line("f", "bot", "done", 1, { from: quasar });
    const request = line("q", "bot", "please check", 2, { from: quasar, roomRequest: { id: "rr", phase: "request" } });
    const items = collapseBotExchanges([foreign, request], { selfBotId: "un", self: { id: "un", name: "unRAID", color: "orange" } });
    expect(items).toHaveLength(1);
    if (items[0]?.kind !== "exchange") throw new Error("expected a run");
    expect(items[0].run.party.name).toBe("Quasar");
    expect(items[0].run.ends.map((party) => party.name)).toEqual(["unRAID", "Quasar"]);
  });

  it("leaves a room bot reply inline when it is not a pair, a peer, or a room request", () => {
    const spoken = line("g", "bot", "Hello team", 1, { from: quasar });
    expect(collapseBotExchanges([spoken], {})).toEqual([{ kind: "message", message: spoken }]);
  });

  it("collapses a pair channel and lets a person line split the run", () => {
    const ping = line("a", "bot", "ping", 1, { from: unraid });
    const pong = line("b", "bot", "pong", 2, { from: quasar });
    const wait = line("u", "user", "wait", 3);
    const again = line("c", "bot", "ok", 4, { from: unraid });
    const items = collapseBotExchanges([ping, pong, wait, again], { pairChannel: true, members });
    expect(items.map((item) => item.kind)).toEqual(["exchange", "message", "exchange"]);
    if (items[0]?.kind !== "exchange" || items[2]?.kind !== "exchange") throw new Error("expected runs");
    expect(items[0].run.messages).toHaveLength(2);
    expect(items[0].run.party.name).toBe("Quasar");
    expect(items[2].run.party.name).toBe("Quasar");
    expect(items[2].run.messages.map((message) => message.id)).toEqual(["c"]);
  });

  it("names the only other bot, and keeps a comm chip and a failure inline", () => {
    const first = line("p1", "user", NOTE, 1, { peerAsk: { botId: "cry", name: "Quasar" } });
    const second = line("p2", "user", NOTE, 2, { peerAsk: { botId: "cry", name: "Quasar" } });
    const items = collapseBotExchanges([first, second], { selfBotId: "un" });
    if (items[0]?.kind !== "exchange") throw new Error("expected a run");
    expect(items[0].run.party).toMatchObject({ id: "cry", name: "Quasar" });
    expect(items[0].run.messages).toHaveLength(2);

    const comm = { id: "c", role: "bot", kind: "activity", at: 2, tool: { name: "Messaged @Quasar", ok: true }, comm: { groupId: "dm", withBotId: "cry", withName: "Quasar", withColor: "blue" } } as Message;
    const failure = { id: "e", role: "bot", kind: "activity", at: 2, tool: { name: "error: could not resume", ok: false } } as Message;
    expect(collapseBotExchanges([line("u", "user", "hi", 1), comm, line("b", "bot", "ok", 3)], { selfBotId: "un" }).map((item) => item.kind)).toEqual(["message", "message", "message"]);
    const split = collapseBotExchanges([first, failure, second], { selfBotId: "un" });
    expect(split.map((item) => item.kind)).toEqual(["exchange", "message", "exchange"]);
  });

  it("absorbs a finished tool strictly between exchange lines and leaves a trailing one inline", () => {
    const peer = line("p", "user", NOTE, 1, { peerAsk: { botId: "cry", name: "Quasar" } });
    const tool = { id: "t", role: "bot", kind: "activity", at: 2, tool: { name: "read_file", ok: true } } as Message;
    const reply = line("r", "bot", "on it", 3, { requestMessageId: "p" });
    const trailing = { id: "tail", role: "bot", kind: "activity", at: 4, tool: { name: "read_file", ok: true } } as Message;
    const absorbed = collapseBotExchanges([peer, tool, reply], { selfBotId: "un" });
    expect(absorbed).toHaveLength(1);
    if (absorbed[0]?.kind !== "exchange") throw new Error("expected a run");
    expect(absorbed[0].run.messages.map((message) => message.id)).toEqual(["p", "t", "r"]);
    const left = collapseBotExchanges([peer, reply, trailing], { selfBotId: "un" });
    expect(left.map((item) => item.kind)).toEqual(["exchange", "message"]);
    if (left[1]?.kind !== "message") throw new Error("expected the tool");
    expect(left[1].message.id).toBe("tail");
  });

  // The reported transcript: a teammate's request, then only tool calls
  // (search_tool, use_tool) stamped with that request. They were drawn as
  // eight lines by Quasar.
  it("never makes a tool call a line of the exchange, whatever its request", () => {
    const peer = line("p", "user", NOTE, 1, { peerAsk: { botId: "cry", name: "Quasar" } });
    const tool = (id: string, name: string, at: number, ok?: boolean) =>
      ({ id, role: "bot", kind: "activity", at, requestMessageId: "p", tool: { name, ...(ok === undefined ? {} : { ok }) } }) as Message;
    const steps = [tool("t1", "search_tool", 2, true), tool("t2", "use_tool", 3), tool("t3", "use_tool", 4, false)];
    const items = collapseBotExchanges([peer, ...steps], { selfBotId: "un" });
    expect(items.map((item) => item.kind)).toEqual(["exchange", "message", "message", "message"]);
    if (items[0]?.kind !== "exchange") throw new Error("expected a run");
    expect(items[0].run.messages.map((message) => message.id)).toEqual(["p"]);

    const reply = line("r", "bot", "on it", 9, { requestMessageId: "p" });
    const absorbed = collapseBotExchanges([peer, steps[0]!, steps[1]!, reply], { selfBotId: "un" });
    expect(absorbed).toHaveLength(1);
    if (absorbed[0]?.kind !== "exchange") throw new Error("expected a run");
    expect(absorbed[0].run.messages.map((message) => message.id)).toEqual(["p", "t1", "t2", "r"]);
    // a failed step stays inline, where the chat's own rules apply
    expect(collapseBotExchanges([peer, steps[2]!, reply], { selfBotId: "un" }).map((item) => item.kind))
      .toEqual(["exchange", "message", "exchange"]);
  });

  it("keeps another bot's tool call out of a pair channel's lines", () => {
    const ping = line("a", "bot", "ping", 1, { from: unraid });
    const step = { id: "t", role: "bot", kind: "activity", at: 2, from: quasar, tool: { name: "use_tool", ok: false } } as Message;
    expect(collapseBotExchanges([step], { pairChannel: true, members }).map((item) => item.kind)).toEqual(["message"]);
    expect(collapseBotExchanges([ping, step], { pairChannel: true, members }).map((item) => item.kind)).toEqual(["exchange", "message"]);
  });

  it("resolves a request that sits above the mounted window", () => {
    const peer = line("p", "user", NOTE, 1, { peerAsk: { botId: "cry", name: "Quasar" } });
    const reply = line("r", "bot", "on it", 2, { requestMessageId: "p" });
    const items = collapseBotExchanges([reply], { selfBotId: "un", lookup: [peer, reply] });
    expect(items.map((item) => item.kind)).toEqual(["exchange"]);
    if (items[0]?.kind !== "exchange") throw new Error("expected a run");
    expect(items[0].run.party.name).toBe("Quasar");
    expect(items[0].run.messages.map((message) => message.id)).toEqual(["r"]);
  });
});

describe("the open sheet", () => {
  const step = { id: "t", role: "bot", kind: "activity", at: 1, tool: { name: "search_tool", ok: true } } as Message;

  it("gives a tool call no words, and shows it only as a chip with Tool calls on", () => {
    expect(exchangeBody(step)).toBe("");
    expect(exchangeSheetRow(step, false)).toBeNull();
    expect(exchangeSheetRow(step, true)).toBe("tool");
    expect(exchangeSheetRow({ id: "s", role: "bot", kind: "screen", at: 1 } as Message, true)).toBeNull();
    expect(exchangeSheetRow(line("r", "bot", "on it", 2), false)).toBe("line");
  });
});

describe("chipParty", () => {
  it("uses the single other bot, else the first bot that is not self", () => {
    const nimbusParty: ExchangeParty = { id: "cry", name: "Quasar" };
    const unraidParty: ExchangeParty = { id: "un", name: "unRAID" };
    expect(chipParty([nimbusParty, nimbusParty], "un").name).toBe("Quasar");
    expect(chipParty([unraidParty, nimbusParty], "un").name).toBe("Quasar");
    expect(chipParty([nimbusParty, unraidParty]).name).toBe("Quasar");
  });
});

describe("transcript dates", () => {
  const labels = { today: "Today", yesterday: "Yesterday" };
  const now = new Date(2026, 9, 5, 12, 0).getTime();

  it("stamps Today, Yesterday, and a quiet weekday with the provided time", () => {
    expect(transcriptDateLabel(new Date(2026, 9, 5, 5, 17).getTime(), now, labels, "en-US", "5:17 AM")).toBe("Today 5:17 AM");
    expect(transcriptDateLabel(new Date(2026, 9, 4, 19, 18).getTime(), now, labels, "en-US", "7:18 PM")).toBe("Yesterday 7:18 PM");
    expect(transcriptDateLabel(new Date(2026, 9, 3, 7, 45).getTime(), now, labels, "en-US", "7:45 AM")).toBe("Sat, Oct 3 7:45 AM");
  });

  it("starts a stretch on the first line, after 30 minutes, and on the next day", () => {
    const morning = new Date(2026, 9, 3, 10, 0).getTime();
    expect(startsNewStretch(undefined, morning)).toBe(true);
    expect(startsNewStretch(morning, morning + 10 * 60_000)).toBe(false);
    expect(startsNewStretch(morning, morning + 30 * 60_000)).toBe(false);
    expect(startsNewStretch(morning, morning + 31 * 60_000)).toBe(true);
    expect(startsNewStretch(morning, new Date(2026, 9, 4, 0, 1).getTime())).toBe(true);
  });

  it("uses Quebec French day names when those labels are passed", () => {
    const labels = { today: "Aujourd'hui", yesterday: "Hier" };
    expect(transcriptDateLabel(new Date(2026, 9, 5, 5, 17).getTime(), now, labels, "fr-CA", "5 h 17")).toBe("Aujourd'hui 5 h 17");
    expect(transcriptDateLabel(new Date(2026, 9, 4, 19, 18).getTime(), now, labels, "fr-CA", "19 h 18")).toBe("Hier 19 h 18");
  });
});

describe("exchangeJumpStays", () => {
  it("is false for another bot, so onGo keeps the sheet", () => {
    expect(exchangeJumpStays("cry", "un")).toBe(false);
    expect(exchangeJumpStays("cry", undefined)).toBe(false);
    expect(exchangeJumpStays(undefined, "un")).toBe(false);
    expect(exchangeJumpStays("un", "un")).toBe(true);
  });
});

describe("commIsBotDm", () => {
  const groups = [
    { id: "dm", dm: true },
    { id: "people", dm: true, peopleDm: true },
    { id: "standup" },
  ];
  it("is only a bot-to-bot DM, not a room or a people DM", () => {
    expect(commIsBotDm({ groupId: "dm" }, groups)).toBe(true);
    expect(commIsBotDm({ groupId: "people" }, groups)).toBe(false);
    expect(commIsBotDm({ groupId: "standup" }, groups)).toBe(false);
    expect(commIsBotDm({ groupId: "missing" }, groups)).toBe(false);
    expect(commIsBotDm(undefined, groups)).toBe(false);
  });
});

describe("exchangeSide", () => {
  const first = { id: "a", name: "Nova" };
  it("puts the header's first bot at the start and every other bot at the end", () => {
    expect(exchangeSide({ id: "a", name: "Nova" }, first)).toBe("start");
    expect(exchangeSide({ id: "b", name: "Pixel" }, first)).toBe("end");
    expect(exchangeSide({ id: "c", name: "Third" }, first)).toBe("end");
  });
  it("falls back to the name when an id is missing, and to the start with no header", () => {
    expect(exchangeSide({ name: "Nova" }, first)).toBe("start");
    expect(exchangeSide({ name: "Pixel" }, first)).toBe("end");
    expect(exchangeSide({ id: "b", name: "Pixel" })).toBe("start");
  });
});
