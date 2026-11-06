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
  it("draws the same page for an admin and a member: OrgBand, read-only rules, no admin inputs", async () => {
    const { PerspicaxOrgSettings } = await import("./PerspicaxOrgSettings");
    for (const locale of ["en", "fr"] as const) {
      setLocale(locale);
      const admin = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: org("admin"), onChanged: () => {} }));
      const member = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: org("member"), onChanged: () => {} }));
      for (const [role, html] of [["admin", admin], ["member", member]] as const) {
        expect(html, `${locale} ${role}`).toContain('data-org-band=""');
        expect(html, `${locale} ${role}`).toContain('data-settings-card="organization.perspicax"');
        expect(html, `${locale} ${role}`).toContain('data-settings-group="organizationRules"');
        expect(html, `${locale} ${role}`).toContain('data-external-link-pill=""');
        expect(html, `${locale} ${role}`).not.toContain("<input");
        expect(html, `${locale} ${role}`).not.toContain('role="switch"');
        expect(html, `${locale} ${role}`).not.toContain('data-settings-card="organization.sharing"');
        expect(html, `${locale} ${role}`).not.toContain("data-org-sharing");
        expect(html, `${locale} ${role}`).not.toContain("{admin &&");
      }
      // same cards for both roles (only the role word changes)
      const normalize = (html: string) => html
        .replace(/\bAdministrateur\b/g, "ROLE")
        .replace(/\bAdmin\b/g, "ROLE")
        .replace(/\bMember\b/g, "ROLE")
        .replace(/\bMembre\b/g, "ROLE");
      expect(normalize(admin), locale).toBe(normalize(member));
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
