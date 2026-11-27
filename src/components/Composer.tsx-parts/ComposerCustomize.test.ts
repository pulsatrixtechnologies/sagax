import { afterEach, describe, expect, it } from "vitest";
import {
  getComposerBarLayout,
  nudgeComposerBarItem,
  resetComposerBarLayout,
  resetComposerBarLayoutStoreForTests,
  setComposerBarLayout,
} from "@/lib/composer-bar-layout";
import { usagePillPlacement } from "@/lib/usage-pill-preferences";

describe("composer customize behaviours (D-20261126-014, D-20261127-001)", () => {
  afterEach(() => {
    resetComposerBarLayoutStoreForTests();
    usagePillPlacement.set("inBar");
  });

  it("keeps a reordered layout the person set (sync key)", () => {
    setComposerBarLayout({ order: ["plus", "usage", "model", "voice"], left: 1 });
    expect(getComposerBarLayout().order).toEqual(["plus", "usage", "model", "voice"]);
  });

  it("restores the default order and in-bar placement", () => {
    setComposerBarLayout({ order: ["voice", "usage", "model", "plus"], left: 0 });
    usagePillPlacement.set("below");
    setComposerBarLayout(resetComposerBarLayout());
    usagePillPlacement.set("inBar");
    expect(getComposerBarLayout()).toEqual({ order: ["plus", "model", "usage", "voice"], left: 1 });
    expect(usagePillPlacement.get()).toBe("inBar");
  });

  it("nudges with arrow-equivalent moves", () => {
    const start = resetComposerBarLayout();
    expect(nudgeComposerBarItem(start, "model", 1).order).toEqual(["plus", "usage", "model", "voice"]);
    expect(nudgeComposerBarItem(start, "model", -1).order).toEqual(["model", "plus", "usage", "voice"]);
  });

  it("placement cycles independently and stays the same pref as settings", () => {
    usagePillPlacement.set("above");
    expect(usagePillPlacement.get()).toBe("above");
    usagePillPlacement.set("below");
    expect(usagePillPlacement.get()).toBe("below");
    usagePillPlacement.set("inBar");
    expect(usagePillPlacement.get()).toBe("inBar");
  });

  it("Escape leaves customize mode (handler is registered while customizing)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dirname, "ComposerCustomize.tsx"), "utf8");
    expect(src).toMatch(/key !== "Escape"/);
    expect(src).toMatch(/setCustomizing\(false\)/);
    expect(src).toMatch(/addEventListener\("keydown"/);
  });

  it("places the Customize context menu with useMenuInWindow so it stays in the window (D-20261127-005)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dirname, "ComposerCustomize.tsx"), "utf8");
    expect(src).toMatch(/useMenuInWindow\(menuRef,\s*at\)/);
    expect(src).toMatch(/from "\.\.\/menu-look"/);
  });
});
