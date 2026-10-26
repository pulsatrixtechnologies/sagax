// @vitest-environment happy-dom
// My Chrome in the app: the banner shows which bot drives the person's Chrome
// and where, and one click on Stop ends it; Settings starts off and lists the
// allowed sites with Revoke.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: fixture.api }));

import { MyChromeIndicator, drivingSummary } from "./MyChromeIndicator";
import { MyChromeSettings } from "./settings/MyChromeSettings";
import type { MyChromeStatus } from "@/lib/my-chrome";

const base: MyChromeStatus = {
  offered: true, enabled: true, stopped: false, sites: [{ origin: "https://shop.example", addedAt: 1 }], chromeAddress: "",
  unavailable: null, connected: true, lastActionAt: 1, shellBotIds: [], driving: [],
};

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  fixture.api.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

describe("My Chrome banner", () => {
  it("names the bot and the site, and Stop is one click", async () => {
    let status: MyChromeStatus = { ...base, driving: [{ botId: "b1", botName: "Nova", tabs: [{ url: "https://shop.example/cart", title: "Cart" }] }] };
    fixture.api.mockImplementation(async (path: string) => {
      if (path === "/api/my-chrome/stop") status = { ...status, stopped: true, driving: [] };
      return status;
    });
    act(() => root.render(createElement(MyChromeIndicator)));
    await flush();
    const banner = container.querySelector("[data-my-chrome-indicator]");
    expect(banner?.textContent).toContain("Nova is driving your Chrome on https://shop.example");
    await act(async () => { (banner!.querySelector("button") as HTMLButtonElement).click(); });
    await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/my-chrome/stop", expect.objectContaining({ method: "POST" }));
    expect(container.querySelector("[data-my-chrome-indicator]")).toBeNull();
  });

  it("shows nothing while no bot drives, or when stopped or off", () => {
    expect(drivingSummary(base)).toEqual([]);
    expect(drivingSummary({ ...base, stopped: true, driving: [{ botId: "b", botName: "N", tabs: [] }] })).toEqual([]);
    expect(drivingSummary({ ...base, enabled: false, driving: [{ botId: "b", botName: "N", tabs: [] }] })).toEqual([]);
    expect(drivingSummary(null)).toEqual([]);
  });
});

describe("Settings > My Chrome", () => {
  it("starts off, then lists the allowed sites with Revoke and a Stop button", async () => {
    let status: MyChromeStatus = { ...base, enabled: false, sites: [] };
    fixture.api.mockImplementation(async (path: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) as Record<string, unknown> : {};
      if (path === "/api/my-chrome/enable") status = { ...status, enabled: body.enabled === true };
      if (path === "/api/my-chrome/sites") status = { ...status, sites: [{ origin: String(body.site), addedAt: 2 }] };
      if (path === "/api/my-chrome/sites/revoke") status = { ...status, sites: [] };
      return status;
    });
    act(() => root.render(createElement(MyChromeSettings)));
    await flush();
    const toggle = container.querySelector('[role="switch"], button[aria-label="Let bots drive my own Chrome"]') as HTMLButtonElement;
    expect(container.querySelector("[data-my-chrome-panel]")).toBeNull();
    await act(async () => { toggle.click(); });
    await flush();
    expect(container.querySelector("[data-my-chrome-panel]")).not.toBeNull();
    expect(container.textContent).toContain("No site yet");
    const input = container.querySelector("#my-chrome-site") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "https://shop.example");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { (input.form as HTMLFormElement).requestSubmit(); });
    await flush();
    expect(container.querySelector("[data-my-chrome-sites]")?.textContent).toContain("https://shop.example");
    expect(container.querySelector("[data-my-chrome-stop]")).not.toBeNull();
    await act(async () => { (container.querySelector('button[aria-label="Revoke https://shop.example"]') as HTMLButtonElement).click(); });
    await flush();
    expect(container.querySelector("[data-my-chrome-sites]")?.textContent).not.toContain("https://shop.example");
  });

  it("says it is not available on an organization server", async () => {
    fixture.api.mockResolvedValue({ ...base, offered: false, enabled: false });
    act(() => root.render(createElement(MyChromeSettings)));
    await flush();
    expect(container.textContent).toContain("Not available on an organization server.");
  });
});
