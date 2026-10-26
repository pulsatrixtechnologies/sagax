import { describe, expect, it } from "vitest";

import type { ExchangeRun } from "@/lib/bot-exchange";
import type { Message } from "@/state/store";
import {
  collapseGotoLines,
  dedupeGotoTargets,
  gotoAgents,
  gotoEntryView,
  gotoTargetOf,
  silentChatItem,
  type GotoGroup,
} from "./goto-lines";

type Item =
  | { kind: "exchange"; run: ExchangeRun }
  | { kind: "message"; message: Message }
  | { kind: "run"; id: string; messages: Message[] };

let seq = 0;
function line(id: string, botId: string, name: string): Message {
  return { id, role: "bot", kind: "text", text: `${name} says`, at: ++seq, from: { botId, name } } as Message;
}
function exchange(botId: string, name: string, id = `m${++seq}`): Item {
  const message = line(id, botId, name);
  return {
    kind: "exchange",
    run: { id: `exchange:${id}`, messages: [message], party: { id: botId, name }, ends: [{ id: "self", name: "Self" }, { id: botId, name }] },
  };
}
function thread(botId: string, threadId: string, title: string): Item {
  return {
    kind: "message",
    message: {
      id: `t${++seq}`,
      role: "bot",
      kind: "activity",
      at: seq,
      tool: { name: `Opened thread #${title}`, ok: true },
      threadRef: { botId, threadId, title },
    } as Message,
  };
}
function toolStep(): Item {
  return { kind: "message", message: { id: `s${++seq}`, role: "bot", kind: "activity", at: seq, tool: { name: "search", ok: true } } as Message };
}
function comm(): Item {
  return { kind: "message", message: { id: `c${++seq}`, role: "bot", kind: "activity", at: seq, tool: { name: "Messaged @Ada", ok: true }, comm: { groupId: "g", withBotId: "ada", withName: "Ada", withColor: "teal" } } as Message };
}
function text(): Item {
  return { kind: "message", message: { id: `x${++seq}`, role: "bot", kind: "text", text: "hello", at: seq } as Message };
}
const hiddenRun = (): Item => ({ kind: "run", id: `run${++seq}`, messages: [toolStep(), toolStep()].map((item) => (item as { message: Message }).message) });

const silent = (item: Item) => silentChatItem(item, false);

describe("gotoTargetOf", () => {
  it("names an exchange by its bot and a thread receipt by its thread", () => {
    expect(gotoTargetOf(exchange("sales", "Sales"))?.key).toBe("bot:sales");
    expect(gotoTargetOf(thread("scout", "th1", "QA"))?.key).toBe("thread:scout:th1");
    expect(gotoTargetOf(text())).toBeNull();
    expect(gotoTargetOf(toolStep())).toBeNull();
  });
});

describe("collapseGotoLines", () => {
  it("folds JC's stack into one group of three targets, newest occurrence last", () => {
    const items: Item[] = [
      exchange("ts", "Timesheets"),
      exchange("sales", "Sales"),
      exchange("ag", "Agreements"),
      exchange("sales", "Sales"),
      exchange("ag", "Agreements"),
      exchange("ts", "Timesheets"),
    ];
    const out = collapseGotoLines(items, silent);
    expect(out).toHaveLength(1);
    const group = out[0] as GotoGroup;
    expect(group.kind).toBe("gotoGroup");
    expect(group.targets.map((target) => target.key)).toEqual(["bot:sales", "bot:ag", "bot:ts"]);
    expect(group.messages).toHaveLength(6);
  });

  it("keeps the most recent run of a target and every stored row of the earlier one", () => {
    const first = exchange("sales", "Sales");
    const second = exchange("sales", "Sales");
    const [target] = dedupeGotoTargets([gotoTargetOf(first)!, gotoTargetOf(second)!]);
    expect(target!.kind).toBe("exchange");
    if (target!.kind !== "exchange") return;
    const firstRun = (first as { run: ExchangeRun }).run;
    const secondRun = (second as { run: ExchangeRun }).run;
    expect(target!.run.id).toBe(secondRun.id);
    expect(target!.run.messages.map((message) => message.id)).toEqual([firstRun.messages[0]!.id, secondRun.messages[0]!.id]);
    expect(target!.run.ends.map((party) => party.id)).toEqual(["self", "sales"]);
  });

  it("keeps the latest receipt of the same thread", () => {
    const older = thread("scout", "th1", "QA");
    const newer = thread("scout", "th1", "QA");
    const out = dedupeGotoTargets([gotoTargetOf(older)!, gotoTargetOf(newer)!]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind === "thread" && out[0]!.message.id).toBe((newer as { message: Message }).message.id);
  });

  it("leaves a lone line as it is", () => {
    const items: Item[] = [text(), exchange("sales", "Sales"), text()];
    expect(collapseGotoLines(items, silent)).toEqual(items);
  });

  it("does not break a stack on rows that draw nothing, and leaves trailing ones outside", () => {
    const a = exchange("sales", "Sales");
    const step = toolStep();
    const run = hiddenRun();
    const b = thread("scout", "th1", "QA");
    const tail = toolStep();
    const out = collapseGotoLines([a, step, run, b, tail], silent);
    expect(out).toHaveLength(2);
    expect((out[0] as GotoGroup).messages).toHaveLength(5);
    expect(out[1]).toBe(tail);
  });

  it("breaks a stack on visible text, and on tool steps once Tool calls is on", () => {
    expect(collapseGotoLines([exchange("a", "A"), text(), exchange("b", "B")], silent)).toHaveLength(3);
    const shown = collapseGotoLines([exchange("a", "A"), toolStep(), exchange("b", "B")], (item) => silentChatItem(item, true));
    expect(shown).toHaveLength(3);
  });

  it("collapses the same bot twice into a one-target group (drawn as the plain line)", () => {
    const out = collapseGotoLines([exchange("sales", "Sales"), exchange("sales", "Sales")], silent);
    expect(out).toHaveLength(1);
    expect((out[0] as GotoGroup).targets).toHaveLength(1);
  });
});

describe("silentChatItem", () => {
  it("hides a failed tool step like any step, keeps status rows and navigation chips visible", () => {
    const failed = { kind: "message", message: { id: "f", role: "bot", kind: "activity", at: 1, tool: { name: "search", ok: false } } } as Item;
    expect(silentChatItem(failed, false)).toBe(true);
    const status = { kind: "message", message: { id: "n", role: "bot", kind: "activity", at: 1, tool: { name: "notice: model", ok: true } } } as Item;
    expect(silentChatItem(status, false)).toBe(false);
    expect(silentChatItem(thread("a", "b", "c"), false)).toBe(false);
    expect(silentChatItem(text(), false)).toBe(false);
  });

  // JC 2026-10-22: a bot-to-bot comm chip is verbose detail. With tool calls
  // off it is silent (hidden, and so it does not break a stack of go-to
  // lines); with tool calls on it shows like any step.
  it("treats a comm chip as silent with tool calls off, visible with them on", () => {
    expect(silentChatItem(comm(), false)).toBe(true);
    expect(silentChatItem(comm(), true)).toBe(false);
  });
});

describe("gotoEntryView / gotoAgents", () => {
  it("shows a bot's face for an exchange and the cube with its owner for a thread", () => {
    const bots = [{ id: "sales", name: "Sales", color: "green" }, { id: "scout", name: "Scout" }];
    const groups = [{ id: "room", name: "Standup" }];
    const ex = gotoEntryView(gotoTargetOf(exchange("sales", "Sales"))!, { bots, groups });
    expect(ex).toMatchObject({ label: "Sales", agentKey: "bot:sales" });
    expect(ex.bot).toMatchObject({ id: "sales", color: "green" });
    const th = gotoEntryView(gotoTargetOf(thread("scout", "th", "PR #378"))!, { bots, groups });
    expect(th).toMatchObject({ bot: null, label: "PR #378", detail: "Scout", agentKey: "bot:scout" });
    const room = gotoEntryView(gotoTargetOf(thread("room", "th", "CI"))!, { bots, groups });
    expect(room).toMatchObject({ bot: null, label: "CI", detail: "Standup" });
    expect(room.agentKey).toBeUndefined();
    const agents = gotoAgents([ex, th, room], { bots });
    expect(agents.map((agent) => agent.key)).toEqual(["bot:scout", "bot:sales"]);
  });
});
