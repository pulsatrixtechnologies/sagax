// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExchangeRun } from "@/lib/bot-exchange";
import { setLocale } from "@/lib/i18n";
import { collapseGotoLines, silentChatItem, type GotoGroup, type GotoTarget } from "@/lib/goto-lines";
import type { Bot, Message } from "@/state/store";
import { GotoGroupChip } from "./GotoGroupChip";

const bots = [
  { id: "ts", name: "Timesheets", color: "blue" },
  { id: "sales", name: "Sales", color: "green" },
  { id: "ag", name: "Agreements", color: "orange" },
] as unknown as Bot[];

let seq = 0;
function exchange(botId: string, name: string) {
  const id = `m${++seq}`;
  const message = { id, role: "bot", kind: "text", text: `${name}: done`, at: Date.now() + seq, from: { botId, name } } as Message;
  const run: ExchangeRun = { id: `exchange:${id}`, messages: [message], party: { id: botId, name }, ends: [{ id: "self", name: "Self" }, { id: botId, name }] };
  return { kind: "exchange" as const, run };
}
function thread(botId: string, threadId: string, title: string) {
  return {
    kind: "message" as const,
    message: { id: `t${++seq}`, role: "bot", kind: "activity", at: Date.now() + seq, tool: { name: "Opened thread", ok: true }, threadRef: { botId, threadId, title } } as Message,
  };
}

function ownerStack(): GotoGroup {
  const items = [
    exchange("ts", "Timesheets"),
    exchange("sales", "Sales"),
    exchange("ag", "Agreements"),
    exchange("sales", "Sales"),
    exchange("ag", "Agreements"),
    exchange("ts", "Timesheets"),
  ];
  return collapseGotoLines(items, (item) => silentChatItem(item, false))[0] as GotoGroup;
}

describe("GotoGroupChip", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setLocale("en");
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    setLocale("en");
  });

  const render = async (group: GotoGroup, onSelect: (target: GotoTarget) => boolean) => {
    await act(async () => {
      root.render(createElement(GotoGroupChip, { group, bots, onSelect }));
    });
  };
  const chip = () => host.querySelector<HTMLButtonElement>("[data-testid=goto-group-chip]")!;
  // The list is portalled into <body> (AnchoredPopover), never under the composer.
  const items = () => [...document.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];

  it("draws one chip for six lines, three targets with three faces", async () => {
    await render(ownerStack(), () => true);
    expect(host.textContent).toContain("3 conversations with");
    expect(host.textContent).toContain("3 agents");
    expect(host.textContent).not.toContain("Go to conversation");
    expect(chip().getAttribute("aria-haspopup")).toBe("menu");
    expect(chip().getAttribute("aria-expanded")).toBe("false");
    expect(chip().getAttribute("aria-label")).toBe("3 conversations with 3 agents: show the list");
    expect(host.querySelector("[role=menu]")).toBeNull();
  });

  it("reads in French", async () => {
    setLocale("fr");
    await render(ownerStack(), () => true);
    expect(host.textContent).toContain("3 conversations avec");
    expect(host.textContent).toContain("3 agents");
  });

  it("lists each target once and goes to the one picked", async () => {
    const onSelect = vi.fn((_target: GotoTarget) => true);
    await render(ownerStack(), onSelect);
    await act(async () => chip().click());
    expect(chip().getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("[role=menu]")).not.toBeNull();
    expect(items().map((item) => item.textContent)).toEqual(["Sales", "Agreements", "Timesheets"]);
    expect(document.activeElement).toBe(items()[0]);
    await act(async () => items()[1]!.click());
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ kind: "exchange", key: "bot:ag" });
    expect(chip().getAttribute("aria-expanded")).toBe("false");
  });

  it("opens above the composer, outside the transcript, scrolling when long", async () => {
    // A composer docked over the pane: its top is the lowest the list may reach.
    const pane = document.createElement("div");
    const dock = document.createElement("div");
    dock.setAttribute("data-composer-dock", "");
    dock.getBoundingClientRect = () => ({ top: 600, bottom: 700, left: 0, right: 800, width: 800, height: 100, x: 0, y: 600, toJSON: () => ({}) });
    host.remove();
    pane.append(host, dock);
    document.body.append(pane);
    await render(ownerStack(), () => true);
    chip().getBoundingClientRect = () => ({ top: 560, bottom: 584, left: 300, right: 500, width: 200, height: 24, x: 300, y: 560, toJSON: () => ({}) });
    await act(async () => chip().click());
    const menu = document.querySelector<HTMLElement>("[data-testid=goto-group-menu]")!;
    expect(host.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(menu.className).toContain("z-[70]");
    expect(menu.className).toContain("overflow-y-auto");
    expect(menu.dataset.side).toBe("top");
    expect(Number.parseFloat(menu.style.maxHeight)).toBeLessThanOrEqual(560);
    // A press inside the portalled list is not an outside press.
    await act(async () => { menu.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    expect(chip().getAttribute("aria-expanded")).toBe("true");
    await act(async () => { document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    expect(chip().getAttribute("aria-expanded")).toBe("false");
    pane.remove();
    document.body.append(host);
  });

  it("moves with the arrow keys and closes on Escape back to the chip", async () => {
    await render(ownerStack(), () => true);
    await act(async () => chip().click());
    const menu = document.querySelector<HTMLElement>("[role=menu]")!;
    const key = async (name: string) => {
      await act(async () => {
        (document.activeElement ?? menu).dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
      });
    };
    await key("ArrowDown");
    expect(document.activeElement).toBe(items()[1]);
    await key("End");
    expect(document.activeElement).toBe(items()[2]);
    await key("ArrowDown");
    expect(document.activeElement).toBe(items()[0]);
    await key("ArrowUp");
    expect(document.activeElement).toBe(items()[2]);
    await key("Escape");
    expect(chip().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(chip());
  });

  it("opens the exchange sheet in place when there is no conversation to go to", async () => {
    await render(ownerStack(), () => false);
    await act(async () => chip().click());
    await act(async () => items()[0]!.click());
    const sheet = host.querySelector("[data-testid=bot-exchange-sheet]");
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain("Sales: done");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-close]")!.click());
    expect(host.querySelector("[data-testid=bot-exchange-sheet]")).toBeNull();
  });

  it("shows a thread with the cube, its title and its bot", async () => {
    const group = collapseGotoLines(
      [exchange("sales", "Sales"), thread("ts", "th9", "PR #378")],
      (item) => silentChatItem(item, false),
    )[0] as GotoGroup;
    const onSelect = vi.fn((_target: GotoTarget) => true);
    await render(group, onSelect);
    expect(host.textContent).toContain("2 conversations with");
    expect(host.textContent).toContain("2 agents");
    await act(async () => chip().click());
    const row = document.querySelector<HTMLButtonElement>('[data-goto-target="thread:ts:th9"]')!;
    expect(row.textContent).toContain("PR #378");
    expect(row.textContent).toContain("Timesheets");
    expect(row.querySelector("svg.lucide-box")).not.toBeNull();
    await act(async () => row.click());
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ kind: "thread" });
  });

  it("draws the plain line when every line goes to the same bot", async () => {
    const group = collapseGotoLines([exchange("sales", "Sales"), exchange("sales", "Sales")], () => false)[0] as GotoGroup;
    const onSelect = vi.fn((_target: GotoTarget) => true);
    await render(group, onSelect);
    expect(host.querySelector("[data-testid=goto-group-chip]")).toBeNull();
    expect(host.textContent).toContain("Go to conversation");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-chip]")!.click());
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
