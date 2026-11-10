import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { collapseMessagedLines, conjunctionParts, messagedLineNames, type MessagedLineItem } from "./messaged-line";

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

  it("joins names with the locale's conjunction", () => {
    const literal = (locale: string) => conjunctionParts(2, locale).filter((part) => part.type === "literal").map((part) => (part as { value: string }).value.trim());
    expect(literal("en")).toEqual(["and"]);
    expect(literal("fr")).toEqual(["et"]);
  });
});
