// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { Bot } from "@/state/store";
import type { DesktopBridgeStatus } from "@/lib/desktop-bridge";
import {
  ComputerCard,
  computerCardTitle,
  computerSelectOptions,
  computerSelectValue,
} from "./ComputerCard";

// The bridge and the organization, per test (null: a solo server).
const env = vi.hoisted(() => ({ bridge: null as unknown, org: null as unknown }));
vi.mock("@/lib/desktop-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/desktop-bridge")>();
  return {
    ...actual,
    useDesktopBridgeStatus: () => env.bridge,
  };
});

vi.mock("@/lib/perspicax-org", () => ({ usePerspicaxOrg: () => env.org }));
vi.mock("@/lib/is-mac-platform", () => ({ isMacPlatform: () => true }));

// The thumbnail endpoint: the capture time of each computer (null: none yet),
// and the cloud computer's status (GET /api/bots/:id/computer).
const captures = vi.hoisted(() => ({ at: {} as Record<string, number | null>, calls: [] as string[], cloud: {} as unknown }));
vi.mock("@/state/store/api", () => ({
  api: vi.fn(async (url: string) => {
    captures.calls.push(url);
    if (new URL(url, "http://localhost").pathname.endsWith("/computer")) return captures.cloud;
    const computer = new URL(url, "http://localhost").searchParams.get("computer") ?? "";
    return { computer, at: captures.at[computer] ?? null, mime: "image/png" };
  }),
}));

vi.mock("../computer/SandboxDesktopModal", () => ({
  SandboxDesktopModal: (props: { title: string; onClose: () => void }) =>
    createElement("div", { "data-sandbox-takeover": "", "data-title": props.title },
      createElement("button", { type: "button", "data-takeover-close": "", onClick: props.onClose }, "close")),
}));

const bot = {
  id: "bot-1",
  name: "Scout",
  title: "",
  description: "",
  messages: [],
  tasks: [],
  threadId: "t1",
  busy: false,
  computer: "cloud",
} as never as Bot;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  captures.at = {};
  captures.calls = [];
  captures.cloud = { configured: true, box: { state: "running" } };
  env.bridge = null;
  env.org = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  delete (window as { ogb?: unknown }).ogb;
  host?.remove();
  root = null;
  host = null;
});

describe("computerSelectValue / options / title", () => {
  it("maps Works on to the PillSelect value", () => {
    expect(computerSelectValue(undefined)).toBe("auto");
    expect(computerSelectValue(null)).toBe("auto");
    expect(computerSelectValue("cloud")).toBe("cloud");
    expect(computerSelectValue("local")).toBe("local");
    expect(computerSelectValue("off")).toBe("off");
  });

  it("lists Auto, This computer, Cloud and Off when the bridge has no named PCs", () => {
    const options = computerSelectOptions(null, false);
    expect(options.map((option) => option.value)).toEqual(["auto", "local", "cloud", "off"]);
  });

  it("names a connected local PC when the bridge lists one", () => {
    const bridge = {
      connected: true,
      tunnel: false,
      workplace: { place: "computer", routines: false, network: "all" },
      activity: [],
      desktops: [{
        id: "desk-1",
        name: "MacBook de JC",
        platform: "darwin",
        online: true,
        busy: false,
        lastSeenAt: Date.now(),
        capabilities: { localVm: true },
      }],
    } as DesktopBridgeStatus;
    const options = computerSelectOptions(bridge, true);
    expect(options.find((option) => option.value === "local")?.label).toContain("MacBook");
    expect(computerCardTitle("local", bridge, true)).toContain("MacBook");
    expect(computerCardTitle("cloud", bridge, true).length).toBeGreaterThan(0);
  });
});

describe("ComputerCard", () => {
  it("opens SandboxDesktopModal on card click, not the computer panel", () => {
    const onPatch = vi.fn();
    act(() => root!.render(createElement(ComputerCard, { bot, onPatch })));
    expect(host!.querySelector("[data-sandbox-takeover]")).toBeNull();
    // JC 2026-11-06: no dropdown beside the section title
    expect(host!.querySelector("[data-computer-card-select]")).toBeNull();
    expect(host!.querySelector("[data-pill-select]")).toBeNull();
    act(() => host!.querySelector<HTMLButtonElement>("[data-computer-card]")!.click());
    expect(host!.querySelector("[data-sandbox-takeover]")).toBeTruthy();
    expect(host!.querySelector("[data-sandbox-takeover]")!.getAttribute("data-title")).toContain("Scout");
  });

  it("patches the bot computer from the row's right-click menu", () => {
    const onPatch = vi.fn();
    act(() => root!.render(createElement(ComputerCard, { bot, onPatch })));
    const row = host!.querySelector<HTMLButtonElement>("[data-computer-card]")!;
    act(() => { row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })); });
    const menu = document.querySelector('[data-computer-card-menu][role="menu"]');
    expect(menu).toBeTruthy();
    expect(menu!.querySelector('[data-computer-card-option="cloud"]')!.getAttribute("aria-checked")).toBe("true");
    const option = [...menu!.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
      .find((node) => /This computer|Cet ordinateur/i.test(node.textContent ?? ""));
    expect(option).toBeTruthy();
    act(() => option!.click());
    expect(onPatch).toHaveBeenCalledWith({ computer: "local" });
    expect(document.querySelector("[data-computer-card-menu]")).toBeNull();
  });

  it("has a ... button that opens the same menu as the right click", () => {
    const onPatch = vi.fn();
    act(() => root!.render(createElement(ComputerCard, { bot, onPatch })));
    const row = host!.querySelector<HTMLButtonElement>("[data-computer-card]")!;
    act(() => { row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })); });
    const rightClick = [...document.querySelectorAll("[data-computer-card-option]")].map((n) => `${n.getAttribute("data-computer-card-option")}:${n.textContent}`);
    act(() => document.querySelector<HTMLElement>("[data-computer-card-menu]")!.parentElement!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(document.querySelector("[data-computer-card-menu]")).toBeNull();
    const more = host!.querySelector<HTMLButtonElement>("[data-computer-card-more]");
    expect(more).toBeTruthy();
    act(() => more!.click());
    const viaButton = [...document.querySelectorAll("[data-computer-card-option]")].map((n) => `${n.getAttribute("data-computer-card-option")}:${n.textContent}`);
    expect(viaButton.length).toBeGreaterThan(0);
    expect(viaButton).toEqual(rightClick);
  });

  it("puts the ... in the section header row, bare and always visible, not in the card", () => {
    act(() => root!.render(createElement(ComputerCard, { bot, onPatch: vi.fn() })));
    const more = host!.querySelector<HTMLButtonElement>("[data-computer-card-more]")!;
    const heading = host!.querySelector("h3")!;
    expect(more.parentElement).toBe(heading.parentElement);
    expect(more.closest("[data-computer-card]")).toBeNull();
    expect(host!.querySelector("[data-computer-card]")!.parentElement!.contains(more)).toBe(false);
    expect(more.className).toContain("ui-icon-button");
    expect(more.className).not.toMatch(/hidden|group-hover/);
  });

  it("has no ... button when read only", () => {
    act(() => root!.render(createElement(ComputerCard, { bot, readOnly: true })));
    expect(host!.querySelector("[data-computer-card-more]")).toBeNull();
  });

  it("has no menu when the viewer cannot change the computer", () => {
    act(() => root!.render(createElement(ComputerCard, { bot, readOnly: true })));
    const row = host!.querySelector<HTMLButtonElement>("[data-computer-card]")!;
    act(() => { row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    expect(document.querySelector("[data-computer-card-menu]")).toBeNull();
  });

  it("shows a capture of the selected computer from the thumbnail endpoint", async () => {
    const at = Date.now() - 5_000;
    captures.at = { cloud: at };
    await act(async () => { root!.render(createElement(ComputerCard, { bot, onPatch: vi.fn() })); });
    const thumb = host!.querySelector<HTMLButtonElement>("[data-computer-thumb]")!;
    expect(thumb.dataset.computerThumb).toBe("screen");
    const img = thumb.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(`/api/bots/bot-1/computer/thumbnail?computer=cloud&v=${at}`);
    expect(thumb.title.length).toBeGreaterThan(0);
    expect(thumb.dataset.computerThumbStale).toBeUndefined();
    expect(img.className).not.toContain("grayscale");
  });

  it("says the screen is unavailable while an awake computer has no capture, never a wallpaper", async () => {
    await act(async () => { root!.render(createElement(ComputerCard, { bot, onPatch: vi.fn() })); });
    const thumb = host!.querySelector<HTMLButtonElement>("[data-computer-thumb]")!;
    expect(thumb.dataset.computerThumb).toBe("unavailable");
    expect(thumb.querySelector("img")).toBeNull();
    expect(thumb.style.background).not.toContain("gradient");
    expect(thumb.title).toContain("No picture of this screen yet");
    const status = host!.querySelector<HTMLElement>("[data-computer-status]")!;
    expect(status.dataset.computerStatus).toBe("awake");
    expect(status.dataset.computerProblem).toBe("no-capture");
    expect(status.textContent).toBe("Awake \u00b7 No picture yet");
  });

  it("shows the cloud computer asleep, thumbnail and line alike, when it is stopped", async () => {
    captures.at = { cloud: Date.now() - 60 * 60_000 };
    captures.cloud = { configured: true, box: { state: "stopped" } };
    await act(async () => { root!.render(createElement(ComputerCard, { bot, onPatch: vi.fn() })); });
    const thumb = host!.querySelector<HTMLButtonElement>("[data-computer-thumb]")!;
    expect(thumb.dataset.computerThumb).toBe("asleep");
    expect(thumb.querySelector("[data-computer-idle-bot]")).toBeTruthy();
    expect(thumb.querySelector("img")).toBeNull();
    expect(host!.querySelector<HTMLElement>("[data-computer-status]")!.dataset.computerStatus).toBe("asleep");
    expect(host!.querySelector("[data-computer-status]")!.textContent).toBe("Asleep");
  });

  it("shows the person's computer asleep when its desktop is offline", async () => {
    env.org = { id: "org" };
    env.bridge = { connected: false, tunnel: false, desktops: [{ id: "d1", name: "Studio-Mac", platform: "darwin", online: false, lastSeenAt: 1 }], workplace: {}, activity: [] };
    await act(async () => { root!.render(createElement(ComputerCard, { bot: { ...bot, computer: "local" } as Bot, onPatch: vi.fn() })); });
    expect(host!.querySelector<HTMLElement>("[data-computer-thumb]")!.dataset.computerThumb).toBe("asleep");
    expect(host!.querySelector<HTMLElement>("[data-computer-status]")!.dataset.computerStatus).toBe("asleep");
  });

  it("says Screen Recording is missing on this computer, in the thumbnail and the line", async () => {
    env.org = { id: "org" };
    env.bridge = { connected: true, tunnel: false, desktops: [{ id: "d1", name: "Studio-Mac.local", platform: "darwin", online: true, lastSeenAt: 1 }], workplace: {}, activity: [] };
    (window as { ogb?: unknown }).ogb = {
      screenFrame: vi.fn().mockResolvedValue(null),
      screenThumbnail: vi.fn().mockResolvedValue(null),
      permStatus: vi.fn().mockResolvedValue({ mic: "granted", screen: "denied", host: "Studio-Mac" }),
    };
    await act(async () => { root!.render(createElement(ComputerCard, { bot: { ...bot, computer: "local" } as Bot, onPatch: vi.fn() })); });
    const thumb = host!.querySelector<HTMLButtonElement>("[data-computer-thumb]")!;
    expect(thumb.dataset.computerThumb).toBe("unavailable");
    expect(thumb.title).toContain("Screen Recording");
    const status = host!.querySelector<HTMLElement>("[data-computer-status]")!;
    expect(status.dataset.computerProblem).toBe("permission");
    expect(status.textContent).toBe("Awake \u00b7 No screen access");
  });

  it("switches the picture at once when the bot moves to another computer", async () => {
    captures.at = { cloud: Date.now() - 5_000, vm: Date.now() - 1_000 };
    await act(async () => { root!.render(createElement(ComputerCard, { bot, onPatch: vi.fn() })); });
    expect(host!.querySelector("[data-computer-thumb] img")!.getAttribute("src")).toContain("computer=cloud");
    // Rendered with the new computer before its answer: never the old picture.
    act(() => root!.render(createElement(ComputerCard, { bot: { ...bot, computer: "vm" } as Bot, onPatch: vi.fn() })));
    expect(host!.querySelector("[data-computer-thumb] img")?.getAttribute("src") ?? "").not.toContain("computer=cloud");
    await act(async () => { await Promise.resolve(); });
    expect(host!.querySelector("[data-computer-thumb] img")!.getAttribute("src")).toBe(`/api/bots/bot-1/computer/thumbnail?computer=vm&v=${captures.at.vm}`);
    expect(captures.calls.some((call) => call.includes("computer=vm"))).toBe(true);
  });

  it("greys out an old capture and opens it larger in the viewer", async () => {
    captures.at = { cloud: Date.now() - 60 * 60_000 };
    await act(async () => { root!.render(createElement(ComputerCard, { bot, onPatch: vi.fn() })); });
    const thumb = host!.querySelector<HTMLButtonElement>("[data-computer-thumb]")!;
    expect(thumb.dataset.computerThumbStale).toBe("");
    expect(thumb.querySelector("img")!.className).toContain("grayscale");
    act(() => thumb.click());
    const full = document.querySelector<HTMLImageElement>("[data-computer-thumb-full]")!;
    expect(full.getAttribute("src")).toBe(`/api/bots/bot-1/computer/thumbnail?computer=cloud&v=${captures.at.cloud}&size=full`);
    expect(document.querySelector("[data-sandbox-takeover]")).toBeNull();
  });

  it("asks for no picture when the bot has no computer", async () => {
    await act(async () => { root!.render(createElement(ComputerCard, { bot: { ...bot, computer: "off" } as Bot, onPatch: vi.fn() })); });
    expect(captures.calls).toEqual([]);
    expect(host!.querySelector<HTMLElement>("[data-computer-thumb]")!.dataset.computerThumb).toBe("asleep");
    expect(host!.querySelector<HTMLElement>("[data-computer-status]")!.dataset.computerStatus).toBe("asleep");
  });
});
