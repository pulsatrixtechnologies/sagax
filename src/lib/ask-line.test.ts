// #3289: a run of hand-off receipts folds into one line whose verb is the
// state; answers drawn in their receipt's line never break the run.
import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { askLineVerb, collapseAskLines } from "./ask-line";

const bots = [{ id: "a", name: "Ann" }, { id: "b", name: "Ben" }, { id: "c", name: "Cy" }];
const receipt = (bot: string, ok = true): Message => ({
  id: `s-${bot}`, role: "bot", kind: "activity", at: 1,
  tool: { name: `Sent to ${bot}`, ok, input: "Brief", handoffId: `h-${bot}` },
  threadRef: { botId: bot, threadId: `${bot}-w`, title: "Work" },
}) as Message;
const result = (bot: string, ok = true): Message => ({
  id: `r-${bot}`, role: "bot", kind: "activity", at: 2, roomRequest: { id: `h-${bot}`, phase: "result" },
  tool: { name: ok ? "replied" : "stopped", ok }, threadRef: { botId: bot, threadId: `${bot}-w`, title: "Work" },
}) as Message;
const item = (message: Message) => ({ kind: "message", message });

describe("collapseAskLines (#3289)", () => {
  it("folds consecutive receipts and the answers between them into one line", () => {
    const rows = [receipt("a"), result("a"), receipt("b"), receipt("c", false)];
    const out = collapseAskLines(rows.map(item), { selfBotId: "me", lookup: [...rows, result("b", false)], bots, silent: () => false });
    expect(out).toHaveLength(1);
    const line = out[0] as Extract<(typeof out)[number], { kind: "askLine" }>;
    expect(line.asks.map((ask) => [ask.name, ask.state])).toEqual([["Ann", "done"], ["Ben", "stopped"], ["Cy", "couldNotAsk"]]);
    expect(line.messages).toHaveLength(4);
    expect(askLineVerb(line.asks)).toBe("asked");
  });

  it("is still asking while one teammate works, and leaves a received ask alone", () => {
    const rows = [receipt("a"), receipt("b")];
    const out = collapseAskLines(rows.map(item), { selfBotId: "me", lookup: [...rows, result("a")], bots, silent: () => false });
    expect(askLineVerb((out[0] as { asks: { state: "running" | "done" }[] }).asks)).toBe("asking");
    const received = { ...receipt("me"), from: { botId: "a", name: "Ann", color: "blue" } } as Message;
    expect(collapseAskLines([item(received)], { selfBotId: "me", lookup: [received], bots, silent: () => false })[0]).toMatchObject({ kind: "message" });
  });
});
