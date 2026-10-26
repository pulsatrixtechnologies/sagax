// @vitest-environment happy-dom
// The bot's one "..." menu in the bot panel: it carries what the mascot
// menu, the editor's quick actions and the header's Export and Inspector
// buttons used to offer (JC 2026-10-14).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ advanced: true, dispatch: vi.fn(), state: {} as Record<string, unknown> }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("@/state/store", async (importOriginal) => {
  const store = await importOriginal<typeof import("@/state/store")>();
  return { ...store, useStore: () => ({ state: { ...store.initialState, ...fixture.state }, dispatch: fixture.dispatch }) };
});

import { BotActionsMenu } from "./BotActionsMenu";
import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";

const bot = { id: "atlas", name: "Atlas", title: "", description: "", color: "purple", messages: [], modelSelection: { instanceId: "fixture", model: "m" } } as unknown as Bot;
const other = { ...bot, id: "other", name: "Other" } as Bot;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  setLocale("en");
  fixture.advanced = true;
  fixture.dispatch = vi.fn();
  fixture.state = { bots: [bot, other] };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const open = (props: Partial<Parameters<typeof BotActionsMenu>[0]> = {}) => {
  act(() => { root.render(createElement(BotActionsMenu, { bot, anchor: { x: 10, y: 10 }, onAnchor: vi.fn(), onRename: vi.fn(), ...props })); });
};
const items = () => [...document.querySelectorAll("[data-bot-actions-menu] [data-menu-item]")].map((element) => element.getAttribute("data-menu-item"));

describe("bot actions menu", () => {
  it("is one button in the header that opens a menu", () => {
    act(() => { root.render(createElement(BotActionsMenu, { bot, anchor: null, onAnchor: vi.fn(), onRename: vi.fn() })); });
    const button = container.querySelector("[data-bot-actions-button]");
    expect(button?.getAttribute("aria-label")).toBe("Bot menu");
    expect(button?.getAttribute("aria-haspopup")).toBe("menu");
    expect(document.querySelector("[data-bot-actions-menu]")).toBeNull();
  });

  it("offers Edit bot, Rename, the desktop, primary bot, the bot's link, reset, export, archive and the Inspector", () => {
    open();
    expect(items()).toEqual(["edit-bot", "rename", "put-on-desktop", "make-primary", "copy-bot-link", "reset-history", "export-zip", "archive", "inspector"]);
    // no messages yet: the conversation export says so instead of offering nothing
    expect(document.querySelector("[data-bot-actions-menu]")?.textContent).toContain("No messages to export yet.");
  });

  it("offers copy and download once the conversation has messages", () => {
    open({ bot: { ...bot, messages: [{ id: "m1", role: "user", text: "hi", ts: 1 }] } as unknown as Bot });
    expect(items()).toEqual(expect.arrayContaining(["copy-markdown", "download-markdown"]));
  });

  it("keeps the Inspector for Advanced mode", () => {
    fixture.advanced = false;
    open();
    expect(items()).not.toContain("inspector");
    expect(items()).toContain("edit-bot");
  });

  it("opens the editor and starts the rename where the name shows", () => {
    const onRename = vi.fn();
    const onAnchor = vi.fn();
    open({ onRename, onAnchor });
    act(() => { (document.querySelector("[data-menu-item=edit-bot]") as HTMLElement).click(); });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "openPersonaEditor", botId: "atlas", section: "overview" });
    expect(onAnchor).toHaveBeenCalledWith(null);
    act(() => { (document.querySelector("[data-menu-item=rename]") as HTMLElement).click(); });
    expect(onRename).toHaveBeenCalled();
  });

  it("resets the history after asking: a new conversation, then the open ones archived", () => {
    const withThreads = { ...bot, threadId: "t1", tasks: [
      { threadId: "t1", title: "a", createdAt: 1 },
      { threadId: "t2", title: "routine", createdAt: 2, routineRunId: "r1" },
      { threadId: "t3", title: "b", createdAt: 3 },
      { threadId: "t4", title: "work", createdAt: 4, openedBy: { botId: "other", name: "Other" } },
      { threadId: "t5", title: "client", createdAt: 5, hidden: true },
    ] } as unknown as Bot;
    open({ bot: withThreads });
    act(() => { (document.querySelector("[data-menu-item=reset-history]") as HTMLElement).click(); });
    expect(document.body.textContent).toContain("Reset Atlas's history?");
    expect(document.body.textContent).toContain("Memory, files, routines");
    act(() => { ([...document.querySelectorAll("button")].find((button) => button.textContent === "Reset the history") as HTMLElement).click(); });
    const created = fixture.dispatch.mock.calls.find(([action]) => action.type === "newTask")?.[0];
    expect(created).toMatchObject({ type: "newTask", botId: "atlas" });
    expect(fixture.dispatch.mock.calls.some(([action]) => action.type === "updateTask")).toBe(false);
    act(() => { created.onCreated(); });
    const archived = fixture.dispatch.mock.calls.filter(([action]) => action.type === "updateTask").map(([action]) => action.threadId);
    expect(archived).toEqual(["t1", "t3"]);
  });

  it("asks before archiving, and archiving the last bot is blocked with the reason", () => {
    open();
    act(() => { (document.querySelector("[data-menu-item=archive]") as HTMLElement).click(); });
    expect(document.body.textContent).toContain("Archive Atlas?");
    fixture.state = { bots: [bot] };
    open();
    const archive = document.querySelector("[data-bot-actions-menu] [data-menu-item=archive]") as HTMLButtonElement;
    expect(archive.disabled).toBe(true);
    expect(archive.textContent).toContain("Keep at least one active bot");
  });

  it("speaks French, with bot and never robot", () => {
    setLocale("fr");
    open();
    const text = document.querySelector("[data-bot-actions-menu]")?.textContent ?? "";
    for (const label of ["Modifier le bot", "Renommer le bot", "Mettre sur le bureau", "Définir comme bot principal", "Exporter la conversation", "Exporter le bot (.zip)", "Archiver…", "Inspecteur"]) {
      expect(text).toContain(label);
    }
    expect(text).not.toMatch(/robot/i);
  });
});
