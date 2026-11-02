// Settings > Organization, General > Advanced and Backups laid out as the reference
// design's (0.5.6, the owner): grey headings over cards of rows, lists folded behind a
// count pill, destructive actions in a red pill, no help paragraphs, nothing
// technical (host names, raw ids), and a search that finds them.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { PerspicaxOrg } from "@/lib/perspicax-org";

const fixture = vi.hoisted(() => ({ config: { rooms: { turnTimeoutMinutes: 7 }, mcp: { callTimeoutMinutes: 10 } } as Record<string, unknown> }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(async () => ({ approvals: [] })),
  useStore: () => ({ state: { config: fixture.config, bots: [] }, dispatch: vi.fn() }),
}));

const org = (viewerRole: "admin" | "member", state: "ok" | "missing" = "ok"): PerspicaxOrg => ({
  org: { name: "Acme Corp", identity: { kind: "perspicax", issuer: "https://px.example.test" } },
  link: { state },
  viewerRole,
  settings: { allowFullAccess: true },
});

beforeEach(() => {
  setLocale("en");
  vi.stubGlobal("window", { confirm: () => true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("Settings > Organization (Perspicax)", () => {
  it("draws Organization then Organization's bots, with the link and role on one grey line", async () => {
    const { PerspicaxOrgSettings } = await import("./PerspicaxOrgSettings");
    const { OrganizationBotRows } = await import("./settings/OrganizationBotRules");
    const html = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: org("admin"), onChanged: () => {}, botRows: createElement(OrganizationBotRows) }));
    expect(html.indexOf('data-settings-group="organization"')).toBeLessThan(html.indexOf('data-settings-group="organizationBots"'));
    expect(html).toContain("Acme Corp");
    expect(html).toContain("Linked to Pulsatrix · Admin");
    expect(html).toContain("Manage in Perspicax");
    // rows, not cards: commands waiting, routines, group turns, MCP calls
    // (2026-10-26: no admin switch for members' Full access, Auto or own environment)
    for (const id of ["organization.adminApprovals", "organization.routinesInConversation", "organization.roomTurns", "organization.mcpCalls"]) {
      expect(html, id).toContain(`data-settings-card="${id}"`);
    }
    for (const id of ["organization.fullAccess", "organization.memberEnvironment", "organization.memberAutoApproval"]) {
      expect(html, id).not.toContain(`data-settings-card="${id}"`);
    }
    expect(html).toContain("Nothing is waiting.");
    expect(html).toMatch(/id="room-turn-timeout"[^>]*value="7"/);
    // no help paragraphs, no native select (the admin's Team secrets form, #932, is its own group and has two)
    expect(html).not.toContain("Nothing runs on the Sagax server itself");
    expect(html).not.toContain("Applies to every bot turn in a group");
    expect(html.replace(/<div data-settings-card="organization\.teamSecrets">.*?<\/section><\/div>/s, "")).not.toContain("<select");
  });

  it("shows a member the organization only, and a broken link in the warning color", async () => {
    const { PerspicaxOrgSettings } = await import("./PerspicaxOrgSettings");
    const html = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: org("member", "missing"), onChanged: () => {} }));
    expect(html).toContain('class="text-warning"');
    expect(html).toContain("· Member");
    expect(html).not.toContain('data-settings-card="organization.fullAccess"');
    expect(html).not.toContain('data-settings-card="organization.adminApprovals"');
  });

  it("speaks French with vouvoiement", async () => {
    setLocale("fr");
    const { PerspicaxOrgSettings } = await import("./PerspicaxOrgSettings");
    const html = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: org("admin"), onChanged: () => {} }));
    expect(html).toContain("Bots de l&#x27;organisation");
    expect(html).toContain("Lié à Pulsatrix · Admin");
    expect(html).toContain("Gérer dans Perspicax");
  });
});

describe("General > Advanced", () => {
  it("draws event log cleanup and diagnostics as rows under grey headings", async () => {
    vi.stubGlobal("window", { ogb: { exportDiagnostics: async () => null } });
    const { GeneralAdvancedSettings } = await import("./settings/AdvancedSettings");
    const html = renderToStaticMarkup(createElement(GeneralAdvancedSettings));
    expect(html.indexOf('data-settings-group="threadCleanup"')).toBeLessThan(html.indexOf('data-settings-group="diagnostics"'));
    expect(html.indexOf('data-settings-group="loopGuard"')).toBeLessThan(html.indexOf('data-settings-group="diagnostics"'));
    // cleanup, pre-releases, loop guard, and the person's usage measure (#1361)
    expect(html.match(/role="switch"/g)).toHaveLength(4);
    expect(html).toContain('data-settings-card="general.loopGuard"');
    expect(html).toContain('data-settings-card="general.usage"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("Export Diagnostics…");
  });

  it("hides Diagnostics where the desktop app does not answer", async () => {
    vi.stubGlobal("window", {});
    const { DiagnosticsRow } = await import("./settings/AdvancedSettings");
    expect(renderToStaticMarkup(createElement(DiagnosticsRow))).toBe("");
  });
});

describe("Settings search", () => {
  it("finds the moved rows in French and English", async () => {
    const { SECTIONS, sectionMatches, cardsMatching } = await import("./SettingsModal");
    const section = (id: string) => SECTIONS.find((entry) => entry.id === id)!;
    for (const query of ["accès complet", "full access", "approbations", "invitation", "cet ordinateur"]) expect(sectionMatches(section("organization"), query), query).toBe(true);
    for (const query of ["sauvegarde", "restaurer", "mot de passe"]) expect(sectionMatches(section("backups"), query), query).toBe(true);
    for (const query of ["nettoyage", "journaux", "diagnostic"]) expect(sectionMatches(section("account"), query), query).toBe(true);
    // 2026-10-26: no Full access card any more
    expect(cardsMatching("accès complet")).not.toContain("organization.fullAccess");
    expect(cardsMatching("restaurer")).toContain("backups.import");
  });
});
