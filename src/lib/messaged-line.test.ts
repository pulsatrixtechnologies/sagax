import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { collapseMessagedLines, conjunctionParts, messagedLineNames, type MessagedLineItem } from "./messaged-line";
import { setLocale, t } from "./i18n";

setLocale("en");

const chip = (id: string, withBotId: string, extra: Partial<NonNullable<Message["comm"]>> = {}, ok = true): { kind: "message"; message: Message } => ({
  kind: "message",
  message: {
    id, role: "bot", kind: "activity", at: 1, tool: { name: `Messaged @${withBotId}`, ok },
    comm: { groupId: `dm-${withBotId}`, withBotId, withName: withBotId, withColor: "blue", direction: "sent", ...extra },
  } as Message,
});
const step = (id: string) => ({ kind: "message", message: { id, role: "bot", kind: "activity", at: 1, tool: { name: "read", ok: true } } as Message });
const words = (id: string) => ({ kind: "message", message: { id, role: "bot", kind: "text", text: "hi", at: 1 } as Message });
const none = new Set<string>();

describe("collapseMessagedLines (#3270)", () => {
  it("folds consecutive sent chips into one line, a hidden step inside included", () => {
    const silentIds = new Set(["s"]);
    const out = collapseMessagedLines([words("a"), chip("c1", "x"), step("s"), chip("c2", "y"), words("b")], none,
      (item) => silentIds.has(item.message?.id ?? ""));
    expect(out.map((item) => item.kind)).toEqual(["message", "messagedLine", "message"]);
    const line = out[1] as MessagedLineItem;
    expect(line.recipients.map((entry) => entry.key)).toEqual(["x", "y"]);
    expect(line.messages.map((message) => message.id)).toEqual(["c1", "s", "c2"]);
  });

  it("names a recipient once, and leaves received chips and failed sends alone", () => {
    const out = collapseMessagedLines([chip("c1", "x"), chip("c2", "x"), chip("r", "z", { direction: "received" }), chip("f", "w", {}, false)], none, () => false);
    expect(out.map((item) => item.kind)).toEqual(["messagedLine", "message", "message"]);
    expect((out[0] as MessagedLineItem).recipients).toHaveLength(1);
  });

  it("takes an older chip without a direction only when it points at a bot pair channel", () => {
    const old = chip("c1", "x", { direction: undefined });
    expect(collapseMessagedLines([old], none, () => false)[0]!.kind).toBe("message");
    expect(collapseMessagedLines([old], new Set(["dm-x"]), () => false)[0]!.kind).toBe("messagedLine");
  });

  it("shows three names then a count, all once expanded", () => {
    const recipients = (collapseMessagedLines(["a", "b", "c", "d", "e"].map((id) => chip(id, id)), none, () => false)[0] as MessagedLineItem).recipients;
    expect(messagedLineNames(recipients, false)).toMatchObject({ others: 2 });
    expect(messagedLineNames(recipients, false).shown).toHaveLength(3);
    expect(messagedLineNames(recipients, true)).toMatchObject({ others: 0 });
  });

  it("never cuts a name: a narrow line draws fewer whole names and a larger count (#3581)", () => {
    const names = Array.from({ length: 15 }, (_, i) => `Bot ${i}`);
    // each name takes 80 px whole, "and N others" 90 px: 260 px holds two
    const fit = { widths: names.map(() => 80), others: () => 90, available: 260 };
    const line = messagedLineNames(names, false, fit);
    expect(line.shown).toEqual(["Bot 0", "Bot 1"]);
    expect(line.others).toBe(13);
    expect(t("chat.messagedOthers.other", { count: line.others })).toBe("13 others");
    expect(messagedLineNames(names, false, { ...fit, available: 170 })).toMatchObject({ shown: ["Bot 0"], others: 14 });
    // always one name, however narrow; opened, the whole list
    expect(messagedLineNames(names, false, { ...fit, available: 10 }).shown).toHaveLength(1);
    expect(messagedLineNames(names, true, fit)).toMatchObject({ others: 0 });
    // three short names that do not fit fold too
    const three = { ...fit, others: () => 60 };
    expect(messagedLineNames(names.slice(0, 3), false, { ...three, available: 230 })).toMatchObject({ shown: ["Bot 0", "Bot 1"], others: 1 });
    expect(messagedLineNames(names.slice(0, 3), false, { ...three, available: 240 })).toMatchObject({ others: 0 });
  });

  it("joins names with the locale's conjunction", () => {
    const literal = (locale: string) => conjunctionParts(2, locale).filter((part) => part.type === "literal").map((part) => (part as { value: string }).value.trim());
    expect(literal("en")).toEqual(["and"]);
    expect(literal("fr")).toEqual(["et"]);
  });
});
