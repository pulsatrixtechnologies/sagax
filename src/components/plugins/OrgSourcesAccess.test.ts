// Organization sources and access: since 2026-10-27 in Plugins (Capabilities before #2104) >
// Sources, its admin part; Settings > Organization keeps one link there. An
// organization admin only, as before. Since 2026-10-28 the organization's
// GitHub tokens are in the one list of the GitHub plugin's page, and the GitHub
// OAuth App's client id in Settings > Organization.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { PerspicaxOrg } from "@/lib/perspicax-org";
import { openSettings } from "@/lib/settings-link";
import { PerspicaxOrgSettings } from "../PerspicaxOrgSettings";
import { marketplacePolicyBody, OrgSourcesAccess } from "./OrgSourcesAccess";

// an admin sees OrgTeamSecrets (#932), which reads the bots from the store
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: { bots: [] }, dispatch: vi.fn() }),
}));

afterEach(() => setLocale("en"));

type Settings = PerspicaxOrg["settings"];
const base: Settings = { pluginMarketplaces: { mode: "any" }, github: { clientId: null, fromEnvironment: false } };

function page(settings: Partial<Settings> = {}) {
  return renderToStaticMarkup(createElement(OrgSourcesAccess, { initial: { ...base, ...settings } }));
}

const org = (viewerRole: "admin" | "member"): PerspicaxOrg => ({
  org: { name: "Acme", identity: { kind: "perspicax", issuer: "https://px.example.test" } },
  link: { state: "ok" },
  viewerRole,
  settings: base,
});

describe("Organization sources and access", () => {
  it("Settings > Organization: an admin finds one link to Plugins > Sources and the GitHub OAuth App's client id, a member nothing", () => {
    const admin = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: org("admin"), onChanged: () => {} }));
    expect(admin).toContain('data-settings-card="organization.plugins"');
    expect(admin).toContain("data-org-sources-moved");
    expect(admin).toContain("managed in Plugins &gt; Sources");
    expect(admin).toContain("Open Sources");
    expect(admin).not.toContain("data-org-plugin-policy");
    expect(admin).not.toContain("data-github-token-add");
    // the client id is a server setting: here, for admins (2026-10-28)
    expect(admin).toContain('data-settings-card="organization.githubApp"');
    expect(admin).toContain("GitHub OAuth App (Connect GitHub)");
    const member = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: org("member"), onChanged: () => {} }));
    expect(member).not.toContain("Allowed marketplaces");
    expect(member).not.toContain('data-settings-card="organization.plugins"');
    expect(member).not.toContain("organization.githubApp");
  });

  it("keeps the allowed marketplaces only: the tokens are on the GitHub plugin's page, the OAuth App in Settings", () => {
    const html = page();
    expect(html).toContain("data-plugins-org-access");
    expect(html).toContain("Allowed marketplaces");
    expect(html).not.toContain("GitHub OAuth App (Connect GitHub)");
    expect(html).not.toContain("data-github-token");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Group 1");
  });

  it("says it in French", () => {
    setLocale("fr");
    const html = page();
    expect(html).toContain("Marketplaces autorisés");
    expect(html).toContain("sur la page du plugin GitHub");
  });

  it("sends the marketplace list the route accepts", () => {
    expect(marketplacePolicyBody("any", "ignored")).toEqual({ mode: "any" });
    expect(marketplacePolicyBody("list", " acme/tools \n\nexample-org/*, https://git.example.test/m.git ")).toEqual({
      mode: "list", allow: ["acme/tools", "example-org/*", "https://git.example.test/m.git"],
    });
  });

  it("an old link to the card opens Plugins on Sources", () => {
    const actions: unknown[] = [];
    openSettings((action) => actions.push(action), "organization", "organization.plugins");
    expect(actions).toEqual([{ type: "togglePlugins", open: true, page: "sources" }]);
  });
});
