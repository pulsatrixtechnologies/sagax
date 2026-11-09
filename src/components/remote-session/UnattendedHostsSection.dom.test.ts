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

const saved = vi.hoisted(() => ({ calls: [] as Array<[string, string]>, fail: false, bots: [] as unknown[], shares: [] as unknown[] }));
vi.mock("./remote-hosts-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./remote-hosts-client")>()),
  setRemoteHostAccess: async (hostId: string, access: string) => {
    saved.calls.push([hostId, access]);
    if (saved.fail) throw new Error("not_found");
    return access;
  },
  setRemoteHostBots: async (hostId: string, botIds: string[] | null) => { saved.bots.push([hostId, botIds]); return { bots: botIds }; },
  shareRemoteHost: async (hostId: string, target: { kind: string; id: string }) => {
    saved.shares.push([hostId, target]);
    return { shares: [{ ...target, name: target.kind === "team" ? "Support" : "Marie Tremblay" }] };
  },
}));
// #2957: the person's bots for the row label, the organization for Share….
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStoreOptional: () => ({ state: { bots: [{ id: "bot-atlas", name: "Atlas", hidden: false }, { id: "bot-nova", name: "Nova", hidden: false }, { id: "bot-tmp", name: "Tmp", hidden: true }], config: {} } }),
}));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/perspicax-org")>()),
  usePerspicaxOrg: () => ({ connected: true }),
}));
vi.mock("@/components/GroupPeoplePicker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/GroupPeoplePicker")>()),
  useOrgDirectory: () => ({
    people: [{ principalId: "marie@acme", name: "Marie Tremblay", login: "marie", email: "marie@acme.example", role: "member", disabled: false }],
    teams: [{ id: "team-support", name: "Support", managers: [], members: ["marie@acme"] }],
  }),
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
beforeEach(() => { setLocale("en"); saved.calls.length = 0; saved.bots.length = 0; saved.shares.length = 0; saved.fail = false; el = document.createElement("div"); document.body.append(el); root = createRoot(el); });
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

  it("puts the unattended computers apart from the other devices (#3134)", async () => {
    await mount([offline, linux], [mac, iphone, ipad]);
    const hostsSection = el.querySelector("[data-unattended-hosts]")!;
    expect(hostsSection.querySelector("h2")?.textContent).toBe("Unattended computers2");
    const hostRows = [...hostsSection.querySelector("[data-unattended-hosts-list]")!.children];
    expect(hostRows.map((row) => row.textContent?.includes("srv-linux") ? "srv-linux" : row.textContent?.includes("old-pc") ? "old-pc" : "?")).toEqual(["srv-linux", "old-pc"]);
    expect(hostRows.every((row) => row.hasAttribute("data-unattended-host"))).toBe(true);
    expect(hostsSection.querySelector("[data-my-device]")).toBeNull();
    const devicesSection = el.querySelector("[data-my-devices-section]")!;
    expect(devicesSection.querySelector("h2")?.textContent).toBe("My devices3");
    const deviceRows = [...devicesSection.querySelector("[data-my-devices]")!.children];
    expect(deviceRows.map((row) => row.getAttribute("data-online"))).toEqual(["yes", "yes", "no"]);
    expect(devicesSection.querySelector("[data-unattended-host]")).toBeNull();
    expect(el.textContent).not.toContain(LINUX);
  });

  it("hides My devices when there is none, keeps the hosts' empty state apart", async () => {
    await mount([linux]);
    expect(el.querySelector("[data-my-devices-section]")).toBeNull();
    await mount([], [iphone]);
    expect(el.querySelector("[data-unattended-hosts-empty]")).not.toBeNull();
    expect(el.querySelector("[data-my-devices-section] [data-my-device]")).not.toBeNull();
  });

  it("keeps the facts behind Details and the actions behind ⋯", async () => {
    await mount([linux]);
    expect(el.querySelector("[data-unattended-host-facts]")).toBeNull();
    await click(el.querySelector("[data-unattended-host-details]"));
    expect(el.querySelector("[data-unattended-host-facts]")?.textContent).toContain("Acme");
    // #3134: the chips of the line, in full under Details.
    expect(el.querySelector("[data-unattended-host-facts]")?.textContent).toContain("All bots");
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

describe("bot scope and sharing on a host row (#2957)", () => {
  const SHARED = `h_${"ef".repeat(16)}`;
  const scoped = host({ bots: ["bot-nova"], shares: [{ kind: "team", id: "team-support", name: "Support" }] });
  const shared = host({ hostId: SHARED, hostname: "srv-marie", sharedBy: "Marie Tremblay" });
  const rowOf = (hostname: string) => [...el.querySelectorAll("[data-unattended-host]")].find((row) => row.textContent?.includes(hostname)) ?? null;
  const menuOf = async (hostname: string) => { await click(rowOf(hostname)?.querySelector("[data-unattended-host-more]")); };

  it("says which bots may use it, or who shared it", async () => {
    await mount([linux, scoped, shared].map((row, index) => ({ ...row, hostId: index === 0 ? `h_${"11".repeat(16)}` : row.hostId })));
    const labels = [...el.querySelectorAll("[data-unattended-host-bots]")].map((span) => span.textContent);
    expect(labels).toEqual(["All bots", "Nova"]);
    // #3134: on the card's own line, not on a row of their own below it.
    expect(el.querySelectorAll("[data-unattended-host-line] [data-unattended-host-bots]")).toHaveLength(2);
    expect(rowOf("srv-marie")?.querySelector("[data-unattended-host-line] [data-unattended-host-shared-by]")).not.toBeNull();
    expect(el.querySelector("[data-unattended-host-shares]")?.textContent).toContain("1");
    expect(rowOf("srv-marie")?.querySelector("[data-unattended-host-shared-by]")?.textContent).toContain("Marie Tremblay");
    expect(rowOf("srv-marie")?.querySelector("[data-unattended-host-bots]")).toBeNull();
    expect(el.textContent).not.toContain("Tmp");
  });

  it("keeps Bots… and Share… for the owner only", async () => {
    await mount([shared]);
    await menuOf("srv-marie");
    expect(document.querySelector("[data-unattended-host-bots-edit]")).toBeNull();
    expect(document.querySelector("[data-unattended-host-share]")).toBeNull();
    expect(document.querySelector("[data-unattended-host-revoke]")).toBeNull();
    await mount([linux]);
    await menuOf("srv-linux");
    expect(document.querySelector("[data-unattended-host-bots-edit]")).not.toBeNull();
    expect(document.querySelector("[data-unattended-host-share]")).not.toBeNull();
  });

  it("limits a host to chosen bots from Bots…", async () => {
    await mount([linux]);
    await menuOf("srv-linux");
    await click(document.querySelector("[data-unattended-host-bots-edit]"));
    const dialog = document.querySelector("[data-host-bots-dialog]")!;
    expect(dialog).not.toBeNull();
    expect((dialog.querySelector("[data-host-bots-all]") as HTMLInputElement).checked).toBe(true);
    // #3134: "All bots" hides the list; unchecking it opens the list with every bot picked.
    expect(dialog.querySelector("[data-host-bot]")).toBeNull();
    await click(dialog.querySelector("[data-host-bots-all]"));
    expect((dialog.querySelector("[data-host-bots-all]") as HTMLInputElement).checked).toBe(false);
    expect([...dialog.querySelectorAll<HTMLInputElement>("[data-host-bot]")].map((box) => [box.dataset.hostBot, box.checked])).toEqual([["bot-atlas", true], ["bot-nova", true]]);
    await click(dialog.querySelector('[data-host-bot="bot-nova"]'));
    await click(dialog.querySelector("[data-host-bots-save]"));
    expect(saved.bots).toEqual([[LINUX, ["bot-atlas"]]]);
    expect(document.querySelector("[data-host-bots-dialog]")).toBeNull();
    expect(el.querySelector("[data-unattended-host-bots]")?.textContent).toBe("Atlas");
  });

  it("shares a host with a person of the organization from Share…", async () => {
    await mount([linux]);
    await menuOf("srv-linux");
    await click(document.querySelector("[data-unattended-host-share]"));
    const dialog = document.querySelector("[data-host-share-dialog]")!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector("[data-host-share-empty]")).not.toBeNull();
    await act(async () => {
      const input = dialog.querySelector<HTMLInputElement>("[data-host-share-search]")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "mar");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(dialog.querySelector('[data-host-share-add="person:marie@acme"]')).not.toBeNull();
    expect(dialog.querySelector('[data-host-share-add="team:team-support"]')).toBeNull();
    await click(dialog.querySelector('[data-host-share-add="person:marie@acme"]'));
    expect(saved.shares).toEqual([[LINUX, { kind: "person", id: "marie@acme" }]]);
    expect(dialog.querySelector('[data-host-share="person:marie@acme"]')?.textContent).toContain("Marie Tremblay");
    await click(dialog.querySelector("[data-host-share-done]"));
    expect(el.querySelector("[data-unattended-host-shares]")?.textContent).toContain("1");
  });
});
