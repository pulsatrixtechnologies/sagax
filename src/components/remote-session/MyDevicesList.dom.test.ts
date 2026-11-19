// @vitest-environment happy-dom
// My devices (2026-11-07): one card row per Sagax install of the person,
// this one first; a computer carries the access menu and "⋯", a phone only
// its presence; choosing an access level saves it on the server.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MyDevice } from "@/lib/desktop-bridge";
import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const saved = vi.hoisted(() => [] as Array<[string, string]>);
vi.mock("@/lib/desktop-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/desktop-bridge")>()),
  setComputerAccess: async (computer: string, access: string) => { saved.push([computer, access]); },
}));
const { MyDevicesList, deviceLine } = await import("./MyDevicesList");

const NOW = Date.UTC(2026, 10, 7, 20, 0, 0);
const mac: MyDevice = { key: "k1", name: "Work MacBook", kind: "computer", platform: "darwin", online: true, lastSeenAt: NOW, access: "always", current: true, desktopId: "d1" };
const mini: MyDevice = { key: "k2", name: "Mac mini", kind: "computer", platform: "darwin", online: false, lastSeenAt: NOW - 3_600_000, access: "ask", current: false, desktopId: null };
const phone: MyDevice = { key: "k3", name: "My iPhone", kind: "phone", platform: "ios", online: false, lastSeenAt: NOW - 5 * 3_600_000, access: null, current: false, desktopId: null };

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { setLocale("en"); saved.length = 0; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const mount = async (devices: MyDevice[]) => { await act(async () => { root.render(createElement(MyDevicesList, { devices })); }); };

describe("MyDevicesList", () => {
  it("lists this computer first, then the others, a phone for presence only", async () => {
    await mount([mac, mini, phone]);
    const rows = [...host.querySelectorAll("[data-my-device]")];
    expect(rows.map((row) => row.querySelector("[data-my-device-name]")?.textContent)).toEqual(["Work MacBook", "Mac mini", "My iPhone"]);
    expect(rows[0]!.textContent).toContain("Computer · Online now");
    expect(rows[0]!.textContent).toContain("This device");
    expect(rows[0]!.querySelector("[data-my-device-rename]")).not.toBeNull();
    expect(rows[1]!.querySelector("[data-my-device-rename]")).toBeNull();
    // this device's access is set in "Execution on this computer": no choice and no menu on its row
    expect(rows[0]!.querySelector("[data-my-device-access]")).toBeNull();
    expect(rows[0]!.querySelector("[data-my-device-more]")).toBeNull();
    expect(rows[1]!.querySelector("[data-my-device-access]")?.getAttribute("data-my-device-access")).toBe("ask");
    expect(rows[1]!.querySelector("[data-my-device-more]")).not.toBeNull();
    expect(rows[2]!.querySelector("[data-my-device-access]")).toBeNull();
    expect(rows[2]!.querySelector("[data-my-device-more]")).toBeNull();
    expect(deviceLine(phone, NOW)).toMatch(/^iOS · Last opened 5 hours? ago$|^iOS · Last opened 5 hr/);
  });

  it("saves the access chosen for a computer", async () => {
    await mount([mac, mini]);
    const pill = host.querySelectorAll<HTMLElement>("[data-my-device-access] [data-pill-select]")[0]!;
    await act(async () => { pill.click(); });
    const never = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes("Never allow"))!;
    await act(async () => { never.click(); });
    expect(saved).toEqual([["Mac mini", "never"]]);
    expect(host.querySelectorAll("[data-my-device-access]")[0]!.getAttribute("data-my-device-access")).toBe("never");
  });

  it("numbers two phones of one name, the first keeps it", async () => {
    await mount([mac, { ...phone, key: "p1", name: "iPhone 16 Pro" }, { ...phone, key: "p2", name: "iPhone 16 Pro" }, { ...phone, key: "p3", name: "iPad Air" }]);
    expect([...host.querySelectorAll("[data-my-device-name]")].map((node) => node.textContent)).toEqual(["Work MacBook", "iPhone 16 Pro", "iPhone 16 Pro (2)", "iPad Air"]);
  });

  it("opens a Remove menu on another computer only, a status line with the kind and presence", async () => {
    await mount([mac, mini]);
    const row = host.querySelectorAll<HTMLElement>("[data-my-device]")[1]!;
    expect(row.querySelector("[data-my-device-line]")?.textContent).toMatch(/^Computer · Last opened /);
    await act(async () => { row.querySelector<HTMLElement>("[data-my-device-more]")!.click(); });
    const items = [...row.querySelectorAll('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual(["Remove"]);
  });

  it("keeps an old name of this machine removable from its row", async () => {
    await mount([mac, { ...mini, key: "k9", name: "Work MacBook.local" }]);
    const row = host.querySelector<HTMLElement>("[data-current]")!;
    expect(row.querySelector("[data-my-device-aliases]")).not.toBeNull();
    await act(async () => { row.querySelector<HTMLElement>("[data-my-device-more]")!.click(); });
    expect([...row.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(["Remove Work MacBook.local"]);
  });

  it("renames in place: the pencil opens the field, Escape cancels", async () => {
    await mount([mac]);
    await act(async () => { host.querySelector<HTMLElement>("[data-my-device-rename]")!.click(); });
    const input = host.querySelector<HTMLInputElement>("form input")!;
    expect(input.value).toBe("Work MacBook");
    expect(host.querySelector("[data-my-device-line]")?.textContent).toBe("Computer · Online now");
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector("[data-my-device-name]")?.textContent).toBe("Work MacBook");
  });

  it("shows nothing without devices", async () => {
    await mount([]);
    expect(host.querySelector("[data-my-devices]")).toBeNull();
  });
});
