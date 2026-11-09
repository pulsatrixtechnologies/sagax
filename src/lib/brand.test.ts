import { describe, expect, it } from "vitest";

import { brandBubbleVars } from "./bubble-colors";
import { brandSwitchVars } from "./switch-colors";
import { contrastRatio } from "./color-contrast";
import { accentInk, applyBrand, brandAccentText, bootstrapBrand, brand, brandVars, DEFAULT_BRAND, iconType, luminance } from "./brand";

describe("brand", () => {
  it("derives readable ink for light and dark accents", () => {
    expect(accentInk("#1D4ED8")).toBe("#ffffff");
    expect(accentInk("#C2510A")).toBe("#ffffff");
    // a bright blue: white text only reaches 3.7:1 on it, dark ink reaches 5.8:1
    expect(accentInk("#1084fe")).toBe("#111111");
    expect(accentInk("#ffd400")).toBe("#111111");
    expect(accentInk("#ffffff")).toBe("#111111");
    expect(accentInk("#000000")).toBe("#ffffff");
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
    expect(luminance("#000000")).toBe(0);
  });

  it("overrides every accent variable, or none when there is no accent", () => {
    expect(brandVars({ name: "X" })).toEqual({});
    expect(brandVars({ name: "X", accent: "not-a-colour" })).toEqual({});
    expect(brandVars({ name: "X", accent: "#1D4ED8" })).toEqual({
      "--color-accent": "#1D4ED8",
      "--color-accent-border": "#1D4ED8",
      "--color-focus": "#1D4ED8",
      "--color-accent-text": "light-dark(#1d4ed8, #7191ec)",
      "--color-accent-ink": "#ffffff",
      ...brandSwitchVars("#1D4ED8"),
      ...brandBubbleVars("#1D4ED8"),
    });
    // the switch keeps its one on colour whatever the brand
    expect(brandVars({ name: "X", accent: "#1D4ED8" })["--brand-switch-on-light"]).toBeUndefined();
  });

  it("derives a link colour that reads at 4.5:1 in light and dark (#3035)", () => {
    // an orange brand measured 2.16:1 as a link on a light skin's grey bubble
    expect(contrastRatio("#f97316", "#e2e2e2")).toBeLessThan(2.2);
    for (const accent of ["#f97316", "#1D4ED8", "#ffd400", "#22c55e", "#8b5cf6", "#e11d48", "#000000", "#ffffff", "#777777"]) {
      const { light, dark } = brandAccentText(accent);
      for (const ground of ["#ffffff", "#e2e2e2", "#dcdcdc", "#dfe6f2"]) expect(contrastRatio(light, ground)).toBeGreaterThanOrEqual(4.5);
      for (const ground of ["#000000", "#121212", "#252525", "#2e2e2e"]) expect(contrastRatio(dark, ground)).toBeGreaterThanOrEqual(4.5);
    }
    // an accent that already reads stays itself
    expect(brandAccentText("#f97316").dark).toBe("#f97316");
    expect(brandVars({ name: "X", accent: "#f97316" })["--color-accent-text"]).toBe("light-dark(#a24504, #f97316)");
  });

  it("keeps the default brand when the server is old, slow, or refuses", async () => {
    applyBrand({ brand: DEFAULT_BRAND, source: "default", file: "" });
    const notFound = async () => new Response("nope", { status: 404 });
    expect((await bootstrapBrand(notFound)).brand).toEqual(DEFAULT_BRAND);
    const garbage = async () => new Response(JSON.stringify({ hello: 1 }), { status: 200 });
    expect((await bootstrapBrand(garbage)).brand).toEqual(DEFAULT_BRAND);
    const hangs = (_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    expect((await bootstrapBrand(hangs, 20)).brand).toEqual(DEFAULT_BRAND);
    expect(brand()).toEqual(DEFAULT_BRAND);
  });

  it("applies a served brand without a DOM", async () => {
    const served = async () =>
      new Response(JSON.stringify({ brand: { name: "Reliable Platform", accent: "#1D4ED8" }, source: "file", file: "/data/brand.json" }), { status: 200 });
    const status = await bootstrapBrand(served);
    expect(status.source).toBe("file");
    expect(brand().name).toBe("Reliable Platform");
    applyBrand({ brand: DEFAULT_BRAND, source: "default", file: "" });
  });
});

describe("the tab icon", () => {
  it("declares the type a data URI carries and nothing for a URL", () => {
    expect(iconType("data:image/png;base64,AAAA")).toBe("image/png");
    expect(iconType("data:image/svg+xml;base64,AAAA")).toBe("image/svg+xml");
    expect(iconType("https://agentada.cc/icon.png")).toBe("");
  });
});
