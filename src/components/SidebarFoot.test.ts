// The foot is the profile row of the reference design (owner, 2026-10-27): the
// avatar and the full name (normal weight, no background pill), then a
// separate round button with the apps grid that opens Connect apps. No
// overlapping logos, no hover animation, no stacked state. The connected
// apps are a dot and the tooltip.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AppState } from "@/state/store";

const fixture = vi.hoisted(() => ({ state: {} as Partial<AppState> }));
vi.mock("@/lib/routines-badge-preferences", () => ({ useShowRoutinesBadge: () => false }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, ...fixture.state }, dispatch: vi.fn() }) };
});

import { FootConnectApps, SidebarFoot, SidebarRailFoot } from "./SidebarFoot";
import { connectedAppItems } from "@/lib/connected-apps";

const apps = connectedAppItems({
  servers: [
    { name: "Gmail", enabled: true, url: "https://mail.google.com/mcp", auth: "connected" },
    { name: "Notion", enabled: true, url: "https://notion.so/mcp", auth: "connected" },
    { name: "Drive", enabled: true, url: "https://drive.google.com/mcp", auth: "connected" },
    { name: "Off", enabled: false, url: "https://off.example/mcp", auth: "connected" },
    { name: "Signin", enabled: true, url: "https://signin.example/mcp", auth: "required" },
  ],
});

describe("foot connected apps", () => {
  it("lists only the enabled, signed-in apps", () => {
    expect(apps.map((app) => app.name)).toEqual(["Gmail", "Notion", "Drive"]);
  });

  it("is a round grid button, no logos, no words", () => {
    const html = renderToStaticMarkup(createElement(FootConnectApps, { apps, onOpen: () => {} }));
    expect(html).toContain("data-apps-grid-icon");
    expect(html).toContain("rounded-full");
    expect(html).toContain("size-9");
    expect(html).not.toContain("data-connected-app=");
    expect(html).not.toContain("data-connect-apps-label");
    expect(html).toContain("aria-label=");
  });

  it("says which apps are connected in the tooltip and a dot, and nothing when there are none", () => {
    const some = renderToStaticMarkup(createElement(FootConnectApps, { apps, onOpen: () => {} }));
    expect(some).toContain("(Gmail, Notion, Drive)");
    expect(some).toContain("data-connected-dot");
    const none = renderToStaticMarkup(createElement(FootConnectApps, { apps: [], onOpen: () => {} }));
    expect(none).not.toContain("data-connected-dot");
    expect(none).not.toContain("(");
  });
});

describe("foot row", () => {
  const render = () => {
    fixture.state = { config: { profile: { name: "Jean-Baptiste Exemplar" } } as AppState["config"] };
    vi.stubGlobal("window", {});
    const html = renderToStaticMarkup(createElement(SidebarFoot, { onOpenApps: () => {} }));
    vi.unstubAllGlobals();
    return html;
  };

  it("renders the name whole, then the round grid button, at every width", () => {
    const html = render();
    expect(html).toContain(">Jean-Baptiste Exemplar</span>");
    expect(html.indexOf("data-account-pill-name")).toBeLessThan(html.indexOf("data-sidebar-connect-apps"));
    expect(html).not.toContain("data-foot-mode");
    expect(html).not.toContain("data-foot-hot");
  });

  it("the name has no pill: no card, no border, normal weight, avatar and name side by side", () => {
    const html = render();
    const pill = /<span[^>]*data-sidebar-account-pill=""[^>]*>/.exec(html)?.[0] ?? "";
    expect(pill).not.toContain("bg-sidebar-card");
    expect(pill).not.toContain("border");
    expect(html).toMatch(/data-account-pill-name="" class="[^"]*font-normal/);
    expect(html).not.toMatch(/data-account-pill-name="" class="[^"]*font-medium/);
  });

  it("keeps the name uncut while it fits: it takes the room, the buttons never shrink", () => {
    const source = readFileSync(new URL("./SidebarFoot.tsx", import.meta.url), "utf8");
    expect(source).toContain("-mx-1.5 flex items-center gap-1.5");
    expect(source).toContain("size-9 shrink-0");
    const menu = readFileSync(new URL("./SidebarProfileMenu.tsx", import.meta.url), "utf8");
    expect(menu).toContain("min-w-[3.5rem] flex-1");
  });

  it("has no hover animation: the old hover expand rules are gone", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(css).not.toContain("data-foot-hot");
    expect(css).not.toContain("foot-label-in");
  });

  it("Sidebar.tsx lays the foot out with SidebarFoot, not a bare text button", () => {
    const source = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    expect(source).toContain("<SidebarFoot");
  });
});

describe("no feedback button in the sidebar (#3299)", () => {
  it("the wide foot and the rail hold no Send feedback entry: /feedback is the one way in", () => {
    vi.stubGlobal("window", {});
    const wide = renderToStaticMarkup(createElement(SidebarFoot, { onOpenApps: () => {} }));
    const rail = renderToStaticMarkup(createElement(SidebarRailFoot, { onOpenApps: () => {} }));
    vi.unstubAllGlobals();
    for (const html of [wide, rail]) {
      expect(html).toContain("data-sidebar-connect-apps");
      expect(html).not.toContain("data-sidebar-feedback");
      expect(html).not.toMatch(/feedback/i);
    }
  });
});
