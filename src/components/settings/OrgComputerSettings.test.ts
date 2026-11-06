// Settings > Computer on an organization server, laid out as the reference design's
// Computer page (0.5.6, the owner): "Your computer" with its name, rows with one
// short grey line, the other computers behind a count pill, the activity
// still hidden (#555), then "Bots' computer" with Reset as a red pill.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { setLocale } from "@/lib/i18n";
import { otherComputers } from "./BotWorkplaceSettings";
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
  activity: [{ at: Date.UTC(2026, 9, 15, 12), target: "user-desktop", kind: "connect", detail: "darwin JeanMBP", ok: true }],
  desktops: [desktop("d1", "JeanChrophesMBP", true, 3), desktop("d2", "JeanChrphesMini.localdomain", false, Date.UTC(2026, 9, 8, 12))],
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
    expect(html).toContain(">JeanChrophesMBP</span>");
    expect(html).toMatch(/<h3[^>]*text-ink-secondary[^>]*>Your computer<\/h3>/);
    expect(html).toMatch(/<h3[^>]*text-ink-secondary[^>]*>Bots&#x27; computer<\/h3>/);
  });

  it("keeps one short grey line under each label, a network pill and a routines switch", () => {
    const html = render(bridge());
    expect(html).toContain("Routines on this computer");
    expect(html).toContain("Your bots&#x27; routines may use it while it is connected.");
    expect(html).toContain("Connected: bots work here and their traffic goes out through it.");
    expect(html).toMatch(/data-pill-select=""[^>]*>[\s\S]*?Local network only/);
    expect(html).toContain('role="switch"');
    expect(html).not.toContain('type="radio"');
    expect(render(bridge({ connected: false }))).toContain("Not connected: until the Sagax app connects");
  });

  it("summarises the other computers and lists them only on demand", () => {
    const html = render(bridge());
    const row = html.slice(html.indexOf('data-settings-row="others"'));
    expect(row).toContain("JeanChrphesMini.localdomain · Last seen");
    expect(row).toMatch(/aria-expanded="false" aria-label="Show other computers"[^>]*>1</);
    expect(html).not.toContain("data-other-computers");
    expect(render(bridge({ desktops: [desktop("d1", "JeanChrophesMBP", true, 3)] }))).not.toContain('data-settings-row="others"');
    expect(otherComputers(bridge()).map((entry) => entry.id)).toEqual(["d2"]);
  });

  it("still hides the recent activity behind its link (#555), with no host name", () => {
    const html = render(bridge());
    expect(html).toContain('data-bot-activity="closed"');
    expect(html).toContain(">See activity<");
    expect(html).not.toContain("JeanMBP");
  });

  it("puts the server environment and its Reset (a red pill) under Bots' computer", () => {
    const html = render(bridge());
    const bots = html.slice(html.indexOf('data-settings-group="botsComputer"'));
    expect(bots).toContain('data-settings-row="serverEnvironment"');
    expect(bots).toContain("Show the screen");
    expect(bots).toContain('data-settings-row="serverEnvironmentReset"');
    expect(bots).toMatch(/class="ui-button bg-danger/);
    expect(bots).toContain('data-settings-row="localVm"');
  });

  it("reads in French", () => {
    setLocale("fr");
    const html = render(bridge());
    expect(html).toContain(">Votre ordinateur</h3>");
    expect(html).toContain(">Ordinateur des bots</h3>");
    expect(html).toContain("Autres ordinateurs");
    expect(html).toContain("Réinitialiser l&#x27;environnement serveur");
    expect(html).not.toMatch(/[–—]/);
  });
});
