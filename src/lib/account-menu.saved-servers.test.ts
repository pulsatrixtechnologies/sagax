// #5353: Switch organization › and the desktop's own server chooser (the
// button beside Add account, electron/environments.cjs workspaceMenuTemplate)
// read one list, the desktop's saved servers; the menu asks for it again
// when its page comes on screen, since the desktop refuses the read to a
// page it keeps hidden.
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

import { switchTargets, watchSavedServers } from "./account-menu";

const require = createRequire(import.meta.url);
const { parseEnvironments, workspaceMenuTemplate, workspaceSenderAllowed } = require("../../electron/environments.cjs") as {
  parseEnvironments(raw: string): { activeId: string; environments: Array<{ id: string; kind?: "local" | "remote"; name: string; origin?: string; org?: boolean }> };
  workspaceMenuTemplate(state: unknown, handlers: Record<string, () => void>): Array<{ label?: string; type?: string; checked?: boolean }>;
  workspaceSenderAllowed(event: unknown, contents: unknown, state: unknown, localOrigin: string): boolean;
};

/** Server mode with Personal on screen, as the desktop keeps it on disk. */
const onDisk = JSON.stringify({
  activeId: "local",
  serverModeId: "srv-1",
  personal: true,
  environments: [{ id: "srv-1", kind: "remote", name: "sagax.acme.example", origin: "https://sagax.acme.example", orgName: "Acme", org: true }],
});

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function page() {
  const listeners = new Map<string, Set<() => void>>();
  const target = {
    addEventListener: (type: string, cb: () => void) => { listeners.set(type, (listeners.get(type) ?? new Set()).add(cb)); },
    removeEventListener: (type: string, cb: () => void) => { listeners.get(type)?.delete(cb); },
  };
  const document = { visibilityState: "hidden" as DocumentVisibilityState, ...target };
  const emit = (type: string) => { for (const cb of Array.from(listeners.get(type) ?? [])) cb(); };
  return { page: { ...target, document } as unknown as Parameters<typeof watchSavedServers>[2], document, emit, count: (type: string) => listeners.get(type)?.size ?? 0 };
}

describe("the saved servers behind Switch organization (#5353)", () => {
  it("is the list the desktop's server chooser shows: this computer, then each organization", () => {
    const state = parseEnvironments(onDisk);
    const chooser = workspaceMenuTemplate(state, {}).filter((entry) => entry.type === "radio");
    const menu = switchTargets(state, "This computer");
    expect(menu.map((entry) => entry.active)).toEqual(chooser.map((entry) => entry.checked));
    expect(menu.map((entry) => entry.local)).toEqual([true, false]);
    expect(menu[1]).toMatchObject({ id: "srv-1", name: "Acme", host: "sagax.acme.example" });
  });

  it("is refused by the desktop while the page is hidden, the reason the menu was empty", () => {
    const state = parseEnvironments(onDisk);
    const local = "http://127.0.0.1:4000";
    const frame = { url: `${local}/` };
    const hidden = { mainFrame: frame };
    const shown = { mainFrame: { url: "https://sagax.acme.example/" } };
    expect(workspaceSenderAllowed({ sender: hidden, senderFrame: frame }, shown, { ...state, activeId: "srv-1" }, local)).toBe(false);
    expect(workspaceSenderAllowed({ sender: hidden, senderFrame: frame }, hidden, state, local)).toBe(true);
  });

  it("asks again when the page comes on screen: focus, or the page turning visible", async () => {
    const p = page();
    let onScreen = false;
    const state = vi.fn(async () => { if (!onScreen) throw new Error("refused"); return { activeId: "local" }; });
    const seen: unknown[] = [];
    const stop = watchSavedServers({ state }, (next) => seen.push(next), p.page);
    await flush();
    expect(seen).toEqual([]);
    // still hidden: a visibility event of a hidden page asks nothing
    p.emit("visibilitychange");
    await flush();
    expect(state).toHaveBeenCalledTimes(1);
    onScreen = true;
    p.document.visibilityState = "visible";
    p.emit("visibilitychange");
    await flush();
    expect(seen).toEqual([{ activeId: "local" }]);
    p.emit("focus");
    await flush();
    expect(state).toHaveBeenCalledTimes(3);
    stop();
    expect([p.count("focus"), p.count("pointermove"), p.count("visibilitychange")]).toEqual([0, 0, 0]);
  });

  it("asks at the person's move only while no answer came, a second apart at most", async () => {
    const p = page();
    let onScreen = false;
    let clock = 0;
    const state = vi.fn(async () => { if (!onScreen) throw new Error("refused"); return { activeId: "local" }; });
    const seen: unknown[] = [];
    const stop = watchSavedServers({ state }, (next) => seen.push(next), p.page, () => clock);
    await flush();
    onScreen = true;
    clock = 500;
    p.emit("pointermove");
    await flush();
    expect(state).toHaveBeenCalledTimes(1);
    clock = 1_000;
    p.emit("pointermove");
    await flush();
    expect(seen).toHaveLength(1);
    clock = 60_000;
    p.emit("pointermove");
    await flush();
    expect(state).toHaveBeenCalledTimes(2);
    stop();
  });

  it("tells nothing after the stop, and watches nothing where the desktop gives no list", async () => {
    const p = page();
    let answer: (value: { activeId: string }) => void = () => {};
    const seen: unknown[] = [];
    const stop = watchSavedServers({ state: () => new Promise<{ activeId: string }>((resolve) => { answer = resolve; }) }, (next) => seen.push(next), p.page);
    await flush();
    stop();
    answer({ activeId: "local" });
    await flush();
    expect(seen).toEqual([]);
    const none = page();
    watchSavedServers(undefined, () => {}, none.page)();
    expect(none.count("focus")).toBe(0);
  });
});
