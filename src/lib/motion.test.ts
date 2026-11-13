import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EASE, MOTION_MS, prefersReducedMotion } from "./motion";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("motion tokens", () => {
  it("the JS durations and easings are the CSS tokens", () => {
    for (const [name, ms] of Object.entries(MOTION_MS)) {
      expect(css).toContain(`--transition-duration-${name}: ${ms}ms;`);
    }
    const names: Record<keyof typeof EASE, string> = {
      outQuint: "out-quint",
      standard: "standard",
      emphasized: "emphasized",
      exit: "exit",
      outSoft: "out-soft",
      inOutStrong: "in-out-strong",
    };
    for (const [key, value] of Object.entries(EASE)) {
      expect(css).toContain(`--ease-${names[key as keyof typeof EASE]}: ${value};`);
    }
  });

  it("every token duration collapses under reduced motion, the system setting and the in-app switch alike", () => {
    const system = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/)?.[1] ?? "";
    const inApp = css.match(/:root\[data-reduced-motion="true"\] \{([^}]*)\}/)?.[1] ?? "";
    for (const name of Object.keys(MOTION_MS)) {
      expect(system).toContain(`--transition-duration-${name}: 0.01ms;`);
      expect(inApp).toContain(`--transition-duration-${name}: 0.01ms;`);
    }
  });

  it("the app's own curves are tokens, not ad hoc cubic-beziers", () => {
    const start = css.indexOf("@theme static {");
    const rest = css.slice(0, start) + css.slice(css.indexOf("}", start));
    // None outside the tokens: the one exception, the update pill's ready
    // nudge, went with the pill's ready state (#4093, the account menu offers
    // a downloaded update now; #4131).
    expect(rest.match(/cubic-bezier\([^)]*\)/g) ?? []).toEqual([]);
  });
});

describe("prefersReducedMotion", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("follows the system setting", () => {
    vi.stubGlobal("document", { documentElement: { dataset: {} } });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    expect(prefersReducedMotion()).toBe(true);
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(prefersReducedMotion()).toBe(false);
  });

  it("follows the in-app switch on the root even when the system allows motion", () => {
    vi.stubGlobal("document", { documentElement: { dataset: { reducedMotion: "true" } } });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(prefersReducedMotion()).toBe(true);
  });

  it("is false without a window (server render)", () => {
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("window", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("progressClip", () => {
  it("clips a full-width fill to its share, round ends kept, bounded", async () => {
    const { progressClip } = await import("./motion");
    expect(progressClip(42)).toBe("inset(0 58% 0 0 round 9999px)");
    expect(progressClip(0)).toBe("inset(0 100% 0 0 round 9999px)");
    expect(progressClip(140)).toBe("inset(0 0% 0 0 round 9999px)");
    expect(progressClip(Number.NaN)).toBe("inset(0 100% 0 0 round 9999px)");
  });
});
