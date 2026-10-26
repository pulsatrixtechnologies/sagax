// Sharing in the organization is hidden from the app (JC, 2026-10-15): the
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
  api: vi.fn(async () => ({ bots: [], approvals: [] })),
  // an admin sees OrgTeamSecrets (#932), which reads the bots from the store
  useStore: () => ({ state: { bots: [] }, dispatch: vi.fn() }),
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
  it("does not show the organization's bots, for an admin or a member, in English or French", async () => {
    const { PerspicaxOrgSettings } = await import("./PerspicaxOrgSettings");
    for (const locale of ["en", "fr"] as const) {
      setLocale(locale);
      for (const role of ["admin", "member"] as const) {
        const html = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: org(role), onChanged: () => {} }));
        expect(html, `${locale} ${role}`).toContain('data-settings-card="organization.perspicax"');
        expect(html, `${locale} ${role}`).not.toContain('data-settings-card="organization.sharing"');
        expect(html, `${locale} ${role}`).not.toContain("data-org-sharing");
        expect(html, `${locale} ${role}`).not.toContain("Sharing in the organization");
        expect(html, `${locale} ${role}`).not.toContain("Partage dans l&#x27;organisation");
      }
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
