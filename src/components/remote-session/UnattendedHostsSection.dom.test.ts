// @vitest-environment happy-dom
// Enrolled hosts as device rows (#2723): one list with the person's devices,
// online first and offline last; the "⋯" menu holds Unattended access,
// Revoke and Copy the id; the access choice is saved on the server.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnattendedHostRow } from "../../../shared/remote-unattended-host";
import type { MyDevice } from "@/lib/desktop-bridge";
import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const saved = vi.hoisted(() => ({ calls: [] as Array<[string, string]>, fail: false }));
vi.mock("./remote-hosts-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./remote-hosts-client")>()),
  setRemoteHostAccess: async (hostId: string, access: string) => {
    saved.calls.push([hostId, access]);
    if (saved.fail) throw new Error("not_found");
    return access;
  },
}));
const { hostLine, sortDeviceEntries, UnattendedHostsSection } = await import("./UnattendedHostsSection");

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const LINUX = `h_${"ab".repeat(16)}`;
const OLD = `h_${"cd".repeat(16)}`;
const host = (over: Partial<UnattendedHostRow> = {}): UnattendedHostRow => ({
  hostId: LINUX, hostname: "srv-linux", org: "Acme", scope: "full-control", installedBy: null,
  enrolledAt: "2026-10-01T10:00:00.000Z", expiresAt: "2027-10-01T10:00:00.000Z", lastSeenAt: iso(NOW - 10_000), revokedAt: null, state: "enrolled",
  os: "linux",
  ...over,
});
const linux = host();
const offline = host({ hostId: OLD, hostname: "old-pc", os: undefined, lastSeenAt: iso(NOW - 3 * 86_400_000) });
const mac: MyDevice = { key: "k1", name: "Work Mac", kind: "computer", platform: "darwin", online: true, lastSeenAt: NOW - 60_000, access: "always", current: true, desktopId: "d1" };
const iphone: MyDevice = { key: "k2", name: "iPhone", kind: "phone", platform: "ios", online: true, lastSeenAt: NOW - 1_000, access: null, current: false, desktopId: null };
const ipad: MyDevice = { key: "k3", name: "iPad", kind: "phone", platform: "ios", online: false, lastSeenAt: NOW - 86_400_000, access: null, current: false, desktopId: null };

let root: Root;
let el: HTMLDivElement;
beforeEach(() => { setLocale("en"); saved.calls.length = 0; saved.fail = false; el = document.createElement("div"); document.body.append(el); root = createRoot(el); });
afterEach(() => { act(() => root.unmount()); el.remove(); });
const mount = async (hosts: UnattendedHostRow[], devices: MyDevice[] = []) => {
  await act(async () => {
    root.render(createElement(UnattendedHostsSection, { state: { hosts, available: true, loading: false, reload: () => {} }, devices }));
  });
};
const click = async (target: Element | null | undefined) => { await act(async () => { (target as HTMLElement).click(); }); };

describe("enrolled hosts as device rows", () => {
  it("sorts this device first, then online by recency, offline last", () => {
    const order = sortDeviceEntries([ipad, iphone, mac], [offline, linux], NOW)
      .map((entry) => entry.kind === "device" ? entry.device.name : entry.host.hostname);
    expect(order).toEqual(["Work Mac", "iPhone", "srv-linux", "iPad", "old-pc"]);
  });

  it("says the OS and the presence on one line", () => {
    expect(hostLine(linux, "linux", NOW)).toBe("Linux · Online now");
    expect(hostLine(offline, undefined, NOW)).toMatch(/^Computer · Last seen /);
  });

  it("renders one list with hosts among the devices", async () => {
    await mount([offline, linux], [mac, iphone, ipad]);
    const list = el.querySelectorAll("[data-my-devices]");
    expect(list).toHaveLength(1);
    const rows = [...list[0]!.children];
    expect(rows.map((row) => row.getAttribute("data-online"))).toEqual(["yes", "yes", "yes", "no", "no"]);
    expect(rows[2]!.hasAttribute("data-unattended-host")).toBe(true);
    expect(rows[4]!.textContent).toContain("old-pc");
    expect(el.textContent).not.toContain(LINUX);
  });

  it("keeps the facts behind Details and the actions behind ⋯", async () => {
    await mount([linux]);
    expect(el.querySelector("[data-unattended-host-facts]")).toBeNull();
    await click(el.querySelector("[data-unattended-host-details]"));
    expect(el.querySelector("[data-unattended-host-facts]")?.textContent).toContain("Acme");
    await click(el.querySelector("[data-unattended-host-more]"));
    expect(el.querySelector("[data-unattended-host-open]")).not.toBeNull();
    expect(el.querySelector("[data-unattended-host-revoke]")).not.toBeNull();
    expect(el.querySelector("[data-unattended-host-copy]")?.getAttribute("title")).toBe(LINUX);
  });

  it("saves the access chosen, and puts it back when the server refuses", async () => {
    await mount([linux]);
    const choose = async (label: string) => {
      await click(el.querySelector("[data-unattended-host-access] [data-pill-select]"));
      await click([...document.querySelectorAll<HTMLElement>("[role=option], [role=menuitemradio]")].find((option) => option.textContent?.includes(label)));
    };
    await choose("Ask every time");
    expect(saved.calls).toEqual([[LINUX, "ask"]]);
    expect(el.querySelector("[data-unattended-host-access]")?.getAttribute("data-unattended-host-access")).toBe("ask");
    saved.fail = true;
    await choose("Never allow");
    expect(el.querySelector("[data-unattended-host-access]")?.getAttribute("data-unattended-host-access")).toBe("ask");
    expect(el.querySelector('[data-unattended-hosts-notice="access"]')).not.toBeNull();
  });
});
