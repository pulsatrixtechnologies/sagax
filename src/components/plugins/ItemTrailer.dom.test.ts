// @vitest-environment happy-dom
// Connect Apps rows (#4453, decided 2026-11-16): the right side of every row
// says where the item is on, then its switch, then "..."; the same menu opens
// on a right click anywhere on the row; "Choose the bots" is a checklist with
// Save; Discover's button is "Install" with For all my bots / For one bot...
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { ItemTrailer, ITEM_ROW_ATTR, whereText, type ItemMenuActions } from "./ItemTrailer";
import { InstallMenu } from "./InstallMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
});

const render = async (node: ReactNode) => { await act(async () => { root.render(node); }); };
/** a row, as the lists draw it: the attribute that lets a right click open the menu */
const row = (trailer: ReactNode) => createElement("div", { [ITEM_ROW_ATTR]: "", "data-test-row": "" }, createElement("span", { "data-test-name": "" }, "Name"), trailer);
const click = async (element: Element | null) => { expect(element).not.toBeNull(); await act(async () => { (element as HTMLElement).click(); }); };
const actionIds = () => [...host.querySelectorAll("[data-entry-action]")].map((item) => item.getAttribute("data-entry-action"));
const rightClick = async (element: Element) => {
  await act(async () => { element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 20 })); });
};
const noop = () => {};

describe("where an item is on", () => {
  it("says all your bots, some, or none", () => {
    expect(whereText({ kind: "all" })).toBe("All your bots");
    expect(whereText({ kind: "some", count: 2 })).toBe("2 bots");
    expect(whereText({ kind: "some", count: 1 })).toBe("1 bot");
    expect(whereText({ kind: "none" })).toBe("No bot");
    expect(whereText("bot")).toBe("This bot");
  });

  it("reads state icon, scope chip only if narrower, switch, \"...\", in that order, in fixed columns", async () => {
    await render(row(createElement(ItemTrailer, { name: "Notes", where: { kind: "some", count: 2 }, whereKind: "some", on: true, onToggle: noop, actions: { detail: noop }, state: { tone: "ok", text: "Connected" } })));
    const trailer = host.querySelector("[data-item-trailer]")!;
    const order = [...trailer.children].map((child) => child.matches("[data-row-state]") ? "state" : child.matches("[data-row-scope]") ? "scope" : child.matches("[data-row-switch]") ? "switch" : child.matches("[data-entry-menu]") ? "menu" : "other");
    expect(order).toEqual(["state", "scope", "switch", "menu"]);
    expect(trailer.querySelector("[data-row-scope]")?.textContent).toBe("2 bots");
  });

  it("does not print \"All your bots\" on every row: the default is the menu's first line", async () => {
    await render(row(createElement(ItemTrailer, { name: "Notes", where: { kind: "all" }, whereKind: "all", on: true, onToggle: noop, actions: { detail: noop } })));
    expect(host.querySelector("[data-row-scope]")).toBeNull();
    // the empty state column and the present switch keep the columns lined up
    const trailer = host.querySelector("[data-item-trailer]")!;
    expect(trailer.children).toHaveLength(3);
    await click(host.querySelector("[data-entry-menu]"));
    expect(host.querySelector("[data-item-where]")?.textContent).toBe("All your bots");
  });

  it("says No bot as a chip, and \"This bot\" only in the menu", async () => {
    await render(row(createElement(ItemTrailer, { name: "Notes", where: { kind: "none" }, whereKind: "none", on: false, onToggle: noop, actions: { detail: noop } })));
    expect(host.querySelector("[data-row-scope]")?.textContent).toBe("No bot");
    await render(row(createElement(ItemTrailer, { name: "Notes", where: "bot", on: true, onToggle: noop, actions: { detail: noop } })));
    expect(host.querySelector("[data-row-scope]")).toBeNull();
  });

  it("a state is ONE icon: its sentence is the tooltip and the accessible name; a warning is a button that fixes", async () => {
    const fix = vi.fn();
    await render(row(createElement(ItemTrailer, { name: "Notes", on: true, onToggle: noop, state: { tone: "fix", text: "Key expired", onFix: fix } })));
    const button = host.querySelector<HTMLButtonElement>("[data-row-state-fix]")!;
    expect(button.getAttribute("aria-label")).toBe("Key expired");
    expect(button.textContent).toBe("");
    const tip = host.querySelector('[role="tooltip"]')!;
    expect(tip.textContent).toBe("Key expired");
    expect(button.getAttribute("aria-describedby")).toBe(tip.id);
    await click(button);
    expect(fix).toHaveBeenCalledTimes(1);
    // a check and an info are focusable icons with the same tooltip
    for (const [tone, text] of [["ok", "Connected"], ["info", "Not offered on this deployment"]] as const) {
      await render(row(createElement(ItemTrailer, { name: "Notes", on: true, state: { tone, text } })));
      const icon = host.querySelector<HTMLElement>(`[data-row-state="${tone}"] [role="img"]`)!;
      expect(icon.getAttribute("aria-label")).toBe(text);
      expect(icon.tabIndex).toBe(0);
      expect(host.querySelector('[role="tooltip"]')?.textContent).toBe(text);
    }
  });

  it("the switch writes for all the person's bots at once and never opens the row", async () => {
    const onToggle = vi.fn();
    await render(row(createElement(ItemTrailer, { name: "Notes", where: { kind: "none" }, whereKind: "none", on: false, onToggle })));
    const toggle = host.querySelector<HTMLButtonElement>("[data-row-switch]")!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("a locked switch says why and does nothing", async () => {
    const onToggle = vi.fn();
    await render(row(createElement(ItemTrailer, { name: "Notes", where: "bot", on: true, lockedReason: "Set by the organization" })));
    const toggle = host.querySelector<HTMLButtonElement>("[data-row-switch]")!;
    expect(toggle.getAttribute("data-row-switch")).toBe("locked");
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("title")).toBe("Set by the organization");
    await click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe("the item's menu: the \"...\" and a right click are one menu", () => {
  const all: ItemMenuActions = { allBots: vi.fn(), offEverywhere: vi.fn(), choose: { load: () => [], save: noop }, detail: vi.fn(), remove: vi.fn(), update: vi.fn() };

  it("offers Turn on for all my bots, Choose the bots, Turn off everywhere, See the detail, Uninstall; Update first", async () => {
    await render(row(createElement(ItemTrailer, { name: "Notes", where: { kind: "some", count: 1 }, whereKind: "some", on: false, actions: all })));
    await click(host.querySelector("[data-entry-menu]"));
    expect(actionIds()).toEqual(["update", "all", "choose", "off", "detail", "remove"]);
    expect(host.querySelector('[data-entry-action="all"]')?.textContent).toContain("Turn on for all my bots");
    expect(host.querySelector('[data-entry-action="choose"]')?.textContent).toContain("Choose the bots...");
    expect(host.querySelector('[data-entry-action="off"]')?.textContent).toContain("Turn off everywhere");
    expect(host.querySelector('[data-entry-action="detail"]')?.textContent).toContain("See the detail");
    expect(host.querySelector('[data-entry-action="remove"]')?.textContent).toContain("Uninstall");
  });

  it("leaves out what changes nothing: on everywhere has no Turn on, off everywhere has no Turn off", async () => {
    await render(row(createElement(ItemTrailer, { name: "Notes", where: { kind: "all" }, whereKind: "all", on: true, actions: all })));
    await click(host.querySelector("[data-entry-menu]"));
    expect(actionIds()).not.toContain("all");
    expect(actionIds()).toContain("off");
    await render(row(createElement(ItemTrailer, { name: "Notes", where: { kind: "none" }, whereKind: "none", on: false, actions: all })));
    expect(actionIds()).not.toContain("off");
  });

  it("runs the line and closes", async () => {
    const detail = vi.fn();
    await render(row(createElement(ItemTrailer, { name: "Notes", where: "bot", on: true, actions: { detail } })));
    await click(host.querySelector("[data-entry-menu]"));
    await click(host.querySelector('[data-entry-action="detail"]'));
    expect(detail).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("opens the same menu on a right click anywhere on the row, and keeps the browser's own menu off", async () => {
    await render(row(createElement(ItemTrailer, { name: "Notes", where: { kind: "all" }, whereKind: "all", on: true, actions: { detail: noop, remove: noop } })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
    await act(async () => { host.querySelector("[data-test-name]")!.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    expect(actionIds()).toEqual(["detail", "remove"]);
    // a press elsewhere closes it, and so does Escape
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(host.querySelector('[role="menu"]')).toBeNull();
    await act(async () => { host.querySelector("[data-test-name]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("a row with nothing to offer has no \"...\" and no menu on a right click", async () => {
    await render(row(createElement(ItemTrailer, { name: "Notes", where: "bot", on: true, lockedReason: "x" })));
    expect(host.querySelector("[data-entry-menu]")).toBeNull();
    await rightClick(host.querySelector("[data-test-name]")!);
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });
});

describe("Choose the bots", () => {
  const bots = [{ id: "bot-a", name: "Rocket", on: true }, { id: "bot-b", name: "Orbit", on: false }, { id: "bot-c", name: "Comet", on: false }];

  const open = async (save: (next: Record<string, boolean>) => void) => {
    await render(row(createElement(ItemTrailer, { name: "Notes", where: { kind: "some", count: 1 }, whereKind: "some", on: false, actions: { choose: { load: () => bots, save } } })));
    await click(host.querySelector("[data-entry-menu]"));
    await click(host.querySelector('[data-entry-action="choose"]'));
  };

  it("lists the person's bots with a check on the ones it is on, and Save is off until something changes", async () => {
    await open(vi.fn());
    const names = [...host.querySelectorAll("[data-choose-bot]")].map((item) => item.textContent);
    expect(names).toEqual(["Rocket", "Orbit", "Comet"]);
    expect([...host.querySelectorAll("[data-choose-bot]")].map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(host.querySelector("[data-choose-bots]")?.textContent).toContain("Choose the bots");
    expect(host.querySelector<HTMLButtonElement>("[data-choose-save]")!.disabled).toBe(true);
  });

  it("Save writes only the bots that changed, then closes", async () => {
    const save = vi.fn();
    await open(save);
    await click(host.querySelector('[data-choose-bot="bot-b"]'));
    await click(host.querySelector('[data-choose-bot="bot-a"]'));
    expect(host.querySelector<HTMLButtonElement>("[data-choose-save]")!.disabled).toBe(false);
    await click(host.querySelector("[data-choose-save]"));
    expect(save).toHaveBeenCalledWith({ "bot-a": false, "bot-b": true });
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("Cancel closes without writing", async () => {
    const save = vi.fn();
    await open(save);
    await click(host.querySelector('[data-choose-bot="bot-c"]'));
    const cancel = [...host.querySelectorAll("[data-choose-bots] button")].find((button) => button.textContent === "Cancel");
    await click(cancel ?? null);
    expect(save).not.toHaveBeenCalled();
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("reads the bots when it opens (a plugin's state is per bot), and says so while it reads", async () => {
    let finish!: (list: typeof bots) => void;
    const load = () => new Promise<typeof bots>((resolve) => { finish = resolve; });
    await render(row(createElement(ItemTrailer, { name: "Notes", where: { kind: "all" }, whereKind: "all", on: true, actions: { choose: { load, save: noop } } })));
    await click(host.querySelector("[data-entry-menu]"));
    await click(host.querySelector('[data-entry-action="choose"]'));
    expect(host.querySelector("[data-choose-bots] [role=status]")?.textContent).toContain("Reading your bots");
    await act(async () => { finish(bots); });
    expect(host.querySelectorAll("[data-choose-bot]")).toHaveLength(3);
  });
});

describe("Install under Discover", () => {
  it("is Install with a small menu: For all my bots, For the bots I choose... (the same checklist as Choose the bots)", async () => {
    const onAll = vi.fn();
    const onBots = vi.fn();
    await render(createElement(InstallMenu, { name: "Notes", label: "Install", onAll, bots: [{ id: "bot-a", name: "Rocket" }, { id: "bot-b", name: "Orbit" }], onBots }));
    const button = host.querySelector("[data-install-button]")!;
    expect(button.textContent).toBe("Install");
    await click(button);
    expect([...host.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(["For all my bots", "For the bots I choose..."]);
    await click(host.querySelector("[data-install-all]"));
    expect(onAll).toHaveBeenCalledTimes(1);
    // the bots I choose: the checklist, confirmed with Install, installs on those bots only
    await click(host.querySelector("[data-install-button]"));
    await click(host.querySelector("[data-install-one]"));
    expect([...host.querySelectorAll("[data-choose-bot]")].map((item) => item.textContent)).toEqual(["Rocket", "Orbit"]);
    expect(host.querySelector<HTMLButtonElement>("[data-choose-save]")!.disabled).toBe(true);
    await click(host.querySelector('[data-choose-bot="bot-b"]'));
    expect(host.querySelector("[data-choose-save]")?.textContent).toBe("Install");
    await click(host.querySelector("[data-choose-save]"));
    expect(onBots).toHaveBeenCalledWith(["bot-b"], expect.anything());
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("with no bot to choose it is a plain Install: no menu with one line in it", async () => {
    const onAll = vi.fn();
    await render(createElement(InstallMenu, { name: "Notes", label: "Install", onAll }));
    await click(host.querySelector("[data-install-button]"));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(onAll).toHaveBeenCalledTimes(1);
  });
});
