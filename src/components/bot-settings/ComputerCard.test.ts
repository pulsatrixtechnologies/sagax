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

vi.mock("@/lib/desktop-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/desktop-bridge")>();
  return {
    ...actual,
    useDesktopBridgeStatus: () => null,
  };
});

vi.mock("@/lib/perspicax-org", () => ({ usePerspicaxOrg: () => null }));

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
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
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
    expect(host!.querySelector("[data-computer-card-select]")).toBeTruthy();
    act(() => host!.querySelector<HTMLButtonElement>("[data-computer-card]")!.click());
    expect(host!.querySelector("[data-sandbox-takeover]")).toBeTruthy();
    expect(host!.querySelector("[data-sandbox-takeover]")!.getAttribute("data-title")).toContain("Scout");
  });

  it("patches the bot computer from the section PillSelect", () => {
    const onPatch = vi.fn();
    act(() => root!.render(createElement(ComputerCard, { bot, onPatch })));
    const trigger = host!.querySelector<HTMLButtonElement>("[data-computer-card-select] [data-pill-select]")!;
    act(() => trigger.click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((node) => /This computer|Cet ordinateur/i.test(node.textContent ?? ""));
    expect(option).toBeTruthy();
    act(() => option!.click());
    expect(onPatch).toHaveBeenCalledWith({ computer: "local" });
  });
});
