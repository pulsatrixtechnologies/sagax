// Settings > Organization, General > Advanced and Backups laid out as the reference
// design's (0.5.6, the owner): grey headings over cards of rows, lists folded behind a
// count pill, destructive actions in a red pill, no help paragraphs, nothing
// technical (host names, raw ids), and a search that finds them.
// #2080 L3: Organization is OrgBand (with Manage in Perspicax) + read-only rules for everyone.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { PerspicaxOrg } from "@/lib/perspicax-org";

const fixture = vi.hoisted(() => ({ config: { rooms: { turnTimeoutMinutes: 7 }, mcp: { callTimeoutMinutes: 10 }, viewer: { role: "admin", capabilities: { editConfig: true, manageKeys: true, manageComputers: true, viewUsage: true, manageBackups: true, pairDevices: true } } } as Record<string, unknown> }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(async () => ({ approvals: [{ botId: "b1", botName: "Atlas", threadId: "t1", requestId: "r1", at: 1 }], secrets: [], pages: [] })),
  useStore: () => ({ state: { config: fixture.config, bots: [] }, dispatch: vi.fn() }),
}));

const org = (viewerRole: "admin" | "member", state: "ok" | "missing" = "ok"): PerspicaxOrg => ({
  org: { name: "Acme Corp", identity: { kind: "perspicax", issuer: "https://px.example.test" } },
  link: { state },
  viewerRole,
  settings: { allowFullAccess: true, confidentialThreadsByDefault: true, allowVaultExport: false },
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
  it("draws OrgBand with Manage in Perspicax, then read-only rules", async () => {
    const { PerspicaxOrgSettings } = await import("./PerspicaxOrgSettings");
    const html = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: org("admin"), onChanged: () => {} }));
    expect(html).toContain('data-org-band=""');
    expect(html.indexOf('data-org-band=""')).toBeLessThan(html.indexOf('data-settings-group="organizationRules"'));
    expect(html).toContain("Acme Corp");
    expect(html).toContain("Linked to Pulsatrix · Admin");
    expect(html).toContain("Manage in Perspicax");
    expect(html).toContain("data-external-link-pill");
    expect(html).toContain('href="https://px.example.test/console/"');
    expect(html).toContain('data-settings-group="organizationRules"');
    expect(html).toContain("On by default");
    expect(html).toContain("Blocked");
    expect(html).not.toContain('data-settings-card="organization.fullAccess"');
    // the GitHub OAuth App's client id, a server setting, under advanced for the admin
    expect(html).toContain('data-settings-group="organizationGithub"');
    expect(html).toContain('data-settings-card="organization.githubApp"');
    expect(html).not.toContain('data-settings-card="organization.teamSecrets"');
    // bot rules stay under advanced for who may edit the installation
    expect(html).toContain('data-settings-group="organizationBots"');
    expect(html).toContain('data-settings-card="organization.routinesInConversation"');
  });

  it("shows a member the same rules, Manage in Perspicax, and a broken link in the warning color", async () => {
    const { PerspicaxOrgSettings } = await import("./PerspicaxOrgSettings");
    const html = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: org("member", "missing"), onChanged: () => {} }));
    expect(html).toContain('class="text-warning"');
    expect(html).toContain("· Member");
    expect(html).toContain("Manage in Perspicax");
    expect(html).toContain('href="https://px.example.test/console/"');
    expect(html).toContain('data-settings-group="organizationRules"');
    expect(html).not.toContain('data-settings-card="organization.fullAccess"');
    expect(html).not.toContain('data-settings-card="organization.githubApp"');
  });

  it("speaks French with tutoiement on the new copy", async () => {
    setLocale("fr");
    const { PerspicaxOrgSettings } = await import("./PerspicaxOrgSettings");
    const html = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: org("admin"), onChanged: () => {} }));
    expect(html).toContain("Règles des bots");
    expect(html).toContain("Règles de l&#x27;organisation");
    expect(html).toContain("Gérer dans Perspicax");
  });
});

describe("About", () => {
  it("draws diagnostics as rows under the Help heading", async () => {
    vi.stubGlobal("window", { ogb: { exportDiagnostics: async () => null } });
    const { AboutPage } = await import("./settings/AppPage");
    const html = renderToStaticMarkup(createElement(AboutPage, { remoteActive: false, openAbout: () => {} }));
    expect(html).toContain('data-settings-card="about.help"');
    expect(html).toContain('data-settings-group="appHelp"');
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
    for (const query of ["accès complet", "full access", "invitation"]) expect(sectionMatches(section("organization"), query), query).toBe(true);
    expect(sectionMatches(section("computer"), "cet ordinateur")).toBe(true);
    // #2080 (L0): one word, one page; approvals are found on Security
    expect(sectionMatches(section("security"), "approbations")).toBe(true);
    expect(sectionMatches(section("organization"), "approbations")).toBe(false);
    for (const query of ["sauvegarde", "restaurer"]) expect(sectionMatches(section("backups"), query), query).toBe(true);
    // JC 2026-11-06: Grok Bot / primary-bot preference import left Backup; those words no longer open it
    for (const query of ["grok import", "import grok", "x.ai", "share link", "lien de partage"]) {
      expect(sectionMatches(section("backups"), query), query).toBe(false);
    }
    // #2080 (L0): one word, one page; a password is found on the Vault
    expect(sectionMatches(section("credentials"), "mot de passe")).toBe(true);
    for (const query of ["journaux", "diagnostic"]) expect(sectionMatches(section("about"), query), query).toBe(true);
    // JC 2026-11-06: cleanup is found on Backups and storage, not on About
    expect(sectionMatches(section("backups"), "nettoyage")).toBe(true);
    expect(sectionMatches(section("about"), "nettoyage")).toBe(false);
    // 2026-10-26: no Full access card any more
    expect(cardsMatching("accès complet")).not.toContain("organization.fullAccess");
    // #2090: Grok Bot / preferences import card is gone; restore stays a section keyword.
    expect(cardsMatching("restaurer")).not.toContain("backups.import");
  });
});
