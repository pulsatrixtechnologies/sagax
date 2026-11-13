// #4093: a downloaded update is told once, as the account menu's first row
// ("Update available", Install), the reference's menu. The foot shows no
// second ready button (not beside the name, not on the rail), and the
// avatar wears the reference's update dot so the closed menu points at it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "@/state/store";
import type { UpdaterState } from "@/lib/updater";
import { resetAchievementsForTests } from "@/lib/achievements";

const fixture = vi.hoisted(() => ({ updater: null as UpdaterState | null }));
vi.mock("@/lib/updater", () => ({ useUpdaterState: () => fixture.updater }));
vi.mock("@/lib/brand", () => ({ brand: () => ({ name: "Sagax" }) }));
vi.mock("@/lib/routines-badge-preferences", () => ({ useShowRoutinesBadge: () => false }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, config: { profile: { name: "Alex Martin" } } as AppState["config"] },
      dispatch: vi.fn(),
    }),
  };
});

import { SidebarProfileMenu } from "./SidebarProfileMenu";
import { SidebarUpdatePill } from "./SidebarUpdatePill";

const updateButtons = (html: string) => html.match(/<button[^>]*data-sidebar-update(-pill)?=[^>]*>/g) ?? [];
const dot = (html: string) => /<span[^>]*class="absolute -right-0\.5 -top-0\.5[^"]*"/.exec(html)?.[0] ?? "";

function render(updater: UpdaterState | null, avatarOnly = false, withName = false) {
  fixture.updater = updater;
  vi.stubGlobal("window", { ogb: { updater: { check: vi.fn(), install: vi.fn(), onState: vi.fn() } } });
  return renderToStaticMarkup(createElement(SidebarProfileMenu, { avatarOnly, withName }))
    + renderToStaticMarkup(createElement(SidebarUpdatePill));
}

beforeEach(() => resetAchievementsForTests());
afterEach(() => {
  vi.unstubAllGlobals();
  resetAchievementsForTests();
});

describe("a downloaded update, told once (#4093)", () => {
  it("puts no ready button in the foot: not beside the name, not in the wide foot, not on the rail", () => {
    const ready: UpdaterState = { status: "downloaded", version: "0.4.19" };
    for (const [avatarOnly, withName] of [[false, false], [true, true], [true, false]] as const) {
      const html = render(ready, avatarOnly, withName);
      expect(updateButtons(html), `avatarOnly=${avatarOnly} withName=${withName}`).toEqual([]);
      expect(html).not.toContain("lucide-cloud-download");
    }
  });

  it("dots the avatar for a waiting update and a failed one, the foot's progress button covering the rest", () => {
    expect(dot(render({ status: "downloaded", version: "0.5.21" }, true))).toContain("bg-accent");
    expect(dot(render({ status: "error", message: "offline" }, true))).toContain("bg-danger");
    const downloading = render({ status: "downloading", version: "0.5.21", percent: 40 }, true);
    expect(dot(downloading)).toBe("");
    expect(updateButtons(downloading)).toHaveLength(1);
    expect(downloading).toContain('data-sidebar-update-pill="progress"');
  });

  it("keeps the name beside the avatar in the wide row", () => {
    const html = render({ status: "downloaded", version: "0.4.19" });
    expect(html).toContain(">Alex Martin</span>");
    expect(html).toContain("max-w-[240px]");
  });
});
