// Settings > Computer on an organization server, laid out as the reference design's
// Computer page (0.5.6, the owner): "Your computer" with its name, rows with one
// short grey line, the person's devices, the activity
// still hidden (#555), then "Bots' computer" with Reset as a red pill.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { setLocale } from "@/lib/i18n";
import { OrgComputerSettings } from "./OrgComputerSettings";

// the Computer page's rows (server-mode access, Mac control) read the store
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: { config: null }, dispatch: () => {} }),
}));

const desktop = (id: string, name: string, online: boolean, lastSeenAt: number) => ({ id, name, platform: "darwin", online, busy: false, lastSeenAt, capabilities: { localVm: true } });
const bridge = (patch: Partial<DesktopBridgeStatus> = {}): DesktopBridgeStatus => ({
  connected: true,
  tunnel: false,
  workplace: { place: "computer", routines: false, network: "lan" },
  activity: [{ at: Date.UTC(2026, 9, 15, 12), target: "user-desktop", kind: "connect", detail: "darwin Archived desktop", ok: true }],
  desktops: [desktop("d1", "Office desktop", true, 3), desktop("d2", "Travel laptop", false, Date.UTC(2026, 9, 8, 12))],
  ...patch,
});
const render = (status: DesktopBridgeStatus) => renderToStaticMarkup(createElement(OrgComputerSettings, {
  bridge: status,
  initialLocal: null,
  initialServer: { configured: true, state: "running", limits: { memoryMb: 1024, cpus: 1, pids: 256, diskMb: 2048, tmpMb: 256 }, pendingDeletionAt: null },
}));

afterEach(() => setLocale("en"));

describe("Settings > Computer, the reference design's layout", () => {
  it("groups Your computer (with its name) then Bots' computer, local models folded between them", () => {
    const html = render(bridge());
    const at = ['data-settings-group="yourComputer"', "data-computer-name", 'data-settings-group="botsComputer"'].map((text) => html.indexOf(text));
    expect(at.every((value) => value >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(html).toContain(">Office desktop</span>");
    expect(html).toMatch(/<h3[^>]*text-ink-secondary[^>]*>Your computer<\/h3>/);
    expect(html).toMatch(/<h3[^>]*text-ink-secondary[^>]*>Bots&#x27; computer<\/h3>/);
  });

  it("keeps one short grey line under each label, switches for network routing and routines", () => {
    const html = render(bridge());
    expect(html).toContain("Routines on this computer");
    expect(html).toContain("Your bots&#x27; routines may use it while it is connected.");
    expect(html).toContain("Route traffic through this computer");
    expect(html).toContain("Local network only");
    const off = render(bridge({ workplace: { place: "computer", routines: false, network: "off" } }));
    expect(off.slice(off.indexOf('data-settings-row="network"')).split("</button>")[0]).toContain('aria-checked="false"');
  });

  it("shows both registered computers with presence and an access control", () => {
    const html = render(bridge());
    expect(html).toContain("Manage devices");
    expect(html.match(/data-my-device="computer"/g)).toHaveLength(2);
    expect(html).toContain("Travel laptop");
    expect(html).toContain("Online now");
    expect(html).toContain("Always allow");
  });

  it("still hides the recent activity behind its link (#555), with no host name", () => {
    const html = render(bridge());
    expect(html).toContain('data-bot-activity="closed"');
    expect(html).toContain(">See activity<");
    expect(html).not.toContain("Archived desktop");
  });

  it("keeps the server environment under Bots' computer; its Reset moved to Developer", () => {
    const html = render(bridge());
    const bots = html.slice(html.indexOf('data-settings-group="botsComputer"'));
    expect(bots).toContain('data-settings-row="serverEnvironment"');
    expect(bots).toContain("Show the screen");
    expect(bots).not.toContain('data-settings-row="serverEnvironmentReset"');
    expect(bots).toContain('data-settings-row="localVm"');
  });

  it("reads in French", () => {
    setLocale("fr");
    const html = render(bridge());
    expect(html).toContain(">Ton ordinateur</h3>");
    expect(html).toContain(">Ordinateur des bots</h3>");
    expect(html).toContain("Gérer les appareils");
    expect(html).not.toMatch(/[–—]/);
  });
});
