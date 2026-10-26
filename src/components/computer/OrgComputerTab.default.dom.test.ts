// @vitest-environment happy-dom
// The Computer tab opens on the destination the bot uses now (JC 2026-10-19),
// not the person's Mac; a manual pick holds until the bot moves.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { defaultScreen, OrgComputerTab, type InUsePlace } from "./OrgComputerTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bridge: DesktopBridgeStatus = {
  connected: true, tunnel: false, activity: [], workplace: { place: "computer", routines: false, network: "all" },
  desktops: [{ id: "d1", name: "Mac de JC", platform: "darwin", online: true, busy: false, lastSeenAt: 1, capabilities: { localVm: true }, system: { os: "macOS", arch: "arm64", cpus: 8, cpuModel: "M3", cpuPercent: 1, memoryGb: 16, memoryUsedGb: 8, diskGb: 500, diskFreeGb: 200 } }],
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const shown = () => host.querySelector("[data-org-computer]")?.getAttribute("data-org-computer");
const render = (inUse?: InUsePlace, threadId = "t1") => act(() => root.render(createElement(OrgComputerTab, { bridge, place: "auto", computerOff: false, botName: "Luna", botId: "b1", threadId, inUse })));

describe("Computer tab default screen", () => {
  it("picks the destination in use, never the Mac by habit", () => {
    expect(defaultScreen(bridge, "auto", "cloud")).toEqual({ source: "server", browser: false });
    expect(defaultScreen(bridge, "auto", "unknown")).toEqual({ source: "server", browser: false });
    expect(defaultScreen(bridge, "auto", "vm").source).toBe("local");
    expect(defaultScreen(bridge, "auto", "browser").browser).toBe(true);
    expect(defaultScreen(bridge, "auto").source).toBe("local");
  });

  it("opens on Cloud when the bot works in the cloud, then follows the bot, and a manual pick holds until it moves", () => {
    render("cloud");
    expect(shown()).toBe("user-sandbox");
    const pickMac = () => act(() => { (host.querySelector('[data-computer-choice="desktop:d1"]') as HTMLElement).click(); });
    pickMac();
    expect(shown()).toBe("user-desktop");
    render("cloud");
    expect(shown()).toBe("user-desktop");
    render("local");
    expect(shown()).toBe("user-desktop");
    render("cloud");
    expect(shown()).toBe("user-sandbox");
    pickMac();
    render("cloud", "t2");
    expect(shown()).toBe("user-sandbox");
  });
});
