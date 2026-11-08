// Sharing in the organization is hidden from the app (owner, 2026-10-15): the
// app shows the person signed in; the list of every bot of the organization
// with its owner belongs to Sagax Business and the Perspicax console. The
// component and its server routes stay, an old link to the card opens the
// Organization page, and a bot's owner still shares it from the bot editor.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { PerspicaxOrg } from "@/lib/perspicax-org";

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(async () => ({ bots: [], approvals: [], secrets: [], pages: [] })),
  useStore: () => ({
    state: {
      bots: [],
      config: { viewer: { role: "member", capabilities: { editConfig: false, manageKeys: false, manageComputers: false, viewUsage: false, manageBackups: false, pairDevices: false } } },
    },
    dispatch: vi.fn(),
  }),
}));

const org = (viewerRole: "admin" | "member"): PerspicaxOrg => ({
  org: { name: "Example", identity: { kind: "perspicax", issuer: "https://px.example.test" } },
  link: { state: "ok" },
  viewerRole,
  settings: {},
});

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

describe("Settings > Organization without Sharing in the organization", () => {
  it("draws Manage in Perspicax for everyone, and the same rules for an admin and a member", async () => {
    const { PerspicaxOrgSettings } = await import("./PerspicaxOrgSettings");
    for (const locale of ["en", "fr"] as const) {
      setLocale(locale);
      const admin = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: org("admin"), onChanged: () => {} }));
      const member = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: org("member"), onChanged: () => {} }));
      for (const [role, html] of [["admin", admin], ["member", member]] as const) {
        expect(html, `${locale} ${role}`).toContain('data-org-band=""');
        expect(html, `${locale} ${role}`).toContain('data-settings-group="organizationRules"');
        expect(html, `${locale} ${role}`).toContain('data-settings-row="vaultExport"');
        // a count not loaded yet draws no row, never its label twice
        expect(html, `${locale} ${role}`).not.toContain('data-settings-row="teamSecrets"');
        expect(html, `${locale} ${role}`).not.toContain('data-settings-row="orgPages"');
        // the owner 2026-11-06: Manage opens the org console in the browser for everyone
        expect(html, `${locale} ${role}`).toContain("data-external-link-pill");
        expect(html, `${locale} ${role}`).toContain('href="https://px.example.test/console/"');
        expect(html, `${locale} ${role}`).toContain('target="_blank"');
        expect(html, `${locale} ${role}`).toContain(locale === "fr" ? "Gérer dans Perspicax" : "Manage in Perspicax");
        expect(html, `${locale} ${role}`).not.toContain('data-settings-card="organization.sharing"');
        expect(html, `${locale} ${role}`).not.toContain("data-org-sharing");
      }
      // #2193: admins keep the Grok bridge kill switch; members stay read-only
      expect(admin, locale).toContain('data-settings-card="organization.grokBridge"');
      expect(admin, locale).toContain('role="switch"');
      expect(member, locale).not.toContain('data-settings-card="organization.grokBridge"');
      expect(member, locale).not.toContain('role="switch"');
      // the GitHub OAuth App's client id, a server setting, is an admin input
      expect(admin, locale).toContain("data-org-github-app");
      expect(member, locale).not.toContain("data-org-github-app");
      expect(member, locale).not.toContain("<input");
      // the read-only rules block is the same for both roles
      const rules = (html: string) => {
        const start = html.indexOf('data-settings-group="organizationRules"');
        const end = html.indexOf("</section>", start) + "</section>".length;
        return html.slice(start, end);
      };
      expect(rules(admin), locale).toBe(rules(member));
    }
  });

  it("opens an old link to the sharing card on the Organization page", async () => {
    const { openSettings } = await import("@/lib/settings-link");
    const dispatch = vi.fn();
    vi.stubGlobal("requestAnimationFrame", undefined);
    openSettings(dispatch, "organization", "organization.sharing");
    vi.unstubAllGlobals();
    expect(dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "organization" });
  });

  it("keeps the component for Sagax Business and the console", async () => {
    const { OrgSharing } = await import("./settings/OrgSharing");
    expect(typeof OrgSharing).toBe("function");
  });
});
