// @vitest-environment happy-dom
// Settings > Appearance > Skin (2026-10-19): a tile per family, the chosen
// family's variants as swatches (its own look, then a colour or, under Hibou
// 98, a Windows edition laid over it as `data-skin-tint`) and its mode as a
// pill (Light, Dark, Auto). A saved skin and tint open on their own family,
// variant and scheme; a retired look-alike opens on its colour.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKIN_MODE_KEY, SKIN_VARIANTS_KEY } from "@/lib/skin-families";
import { applySkin, readSkin, SKIN_TINT_KEY } from "@/lib/skins";
import { SkinPicker } from "./SkinPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let systemDark = true;

beforeEach(() => {
  localStorage.clear();
  systemDark = true;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" ? systemDark : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete document.documentElement.dataset.skin;
  delete document.documentElement.dataset.skinTint;
  delete document.documentElement.dataset.skinDepth;
  delete document.documentElement.dataset.skinTexture;
  vi.unstubAllGlobals();
});

function open(skin: string, tint?: string) {
  localStorage.setItem("omb-skin", skin);
  if (tint) localStorage.setItem(SKIN_TINT_KEY, tint);
  // as main.tsx does before the first paint
  applySkin(readSkin());
  act(() => root.render(createElement(SkinPicker)));
}
const worn = () => [document.documentElement.dataset.skin, document.documentElement.dataset.skinTint ?? null];

const tile = (id: string) => host.querySelector<HTMLButtonElement>(`[data-skin-family="${id}"]`);
const swatch = (id: string) => host.querySelector<HTMLButtonElement>(`[data-skin-variant="${id}"]`);
const modePill = () => host.querySelector<HTMLElement>('[data-settings-row="skinMode"]');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("SkinPicker", () => {
  it("shows the families, not the twelve skins, and Hibou 98 only once unlocked", () => {
    open("pulsatrix");
    const families = [...host.querySelectorAll("[data-skin-family]")].map((el) => el.getAttribute("data-skin-family"));
    expect(families).toEqual(["pulsatrix", "studio", "atelier"]);
    expect(tile("pulsatrix")!.getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).not.toMatch(/[–—]/);
  });

  it.each([
    ["midnight", undefined, "studio", "basic", "Dark", ["midnight", null]],
    ["daylight", "red", "studio", "red", "Light", ["daylight", "red"]],
    ["foundry", "green", "atelier", "green", "Dark", ["foundry", "green"]],
    ["pulsatrix-light", "pink", "pulsatrix", "pink", "Light", ["pulsatrix-light", "pink"]],
    // the retired look-alikes: their base and closest colour
    ["graphite", undefined, "studio", "blue", "Dark", ["midnight", "blue"]],
    ["dusk", undefined, "studio", "pink", "Dark", ["midnight", "pink"]],
    ["meadow", undefined, "studio", "green", "Light", ["daylight", "green"]],
    ["lagoon", undefined, "atelier", "blue", "Light", ["atelier", "blue"]],
  ])("opens a saved %s (tint %s) on its family %s, variant %s, mode %s", (skin, tint, family, variant, mode, expected) => {
    open(skin, tint);
    expect(worn()).toEqual(expected);
    expect(tile(family)!.getAttribute("aria-pressed")).toBe("true");
    // the selected tile's miniature wears the worn skin and tint
    const mini = tile(family)!.querySelector("[data-skin]")!;
    expect([mini.getAttribute("data-skin"), mini.getAttribute("data-skin-tint")]).toEqual(expected);
    expect(swatch(variant)!.getAttribute("aria-pressed")).toBe("true");
    expect(modePill()!.textContent).toContain(mode);
  });

  it("shows the colours, the duo-tones and the moods as rows of swatches, each in its own skin context", () => {
    open("midnight");
    const row = (group: string) =>
      [...host.querySelectorAll(`[data-settings-row="skinVariant-${group}"] [data-skin-variant]`)].map((el) => el.getAttribute("data-skin-variant"));
    expect(row("color")).toEqual(["basic", "red", "pink", "blue", "green", "yellow"]);
    expect(row("duo")).toEqual(["aurore", "ocean", "neon", "foret"]);
    // dark mode: no light mood (Candy), JC 2026-10-22
    expect(row("ambiance")).toEqual(["cyberpunk", "sunset", "nordic"]);
    expect(swatch("candy")).toBeNull();
    const dot = swatch("yellow")!.querySelector("[data-skin]")!;
    expect([dot.getAttribute("data-skin"), dot.getAttribute("data-skin-tint")]).toEqual(["midnight", "yellow"]);
    expect(swatch("basic")!.querySelector("[data-skin]")!.hasAttribute("data-skin-tint")).toBe(false);
  });

  it("lists only the light moods in a light skin", () => {
    open("daylight");
    const row = (group: string) =>
      [...host.querySelectorAll(`[data-settings-row="skinVariant-${group}"] [data-skin-variant]`)].map((el) => el.getAttribute("data-skin-variant"));
    expect(row("ambiance")).toEqual(["sunset", "nordic", "candy"]);
    expect(swatch("candy")!.querySelector("[data-skin]")!.getAttribute("data-skin")).toBe("daylight");
  });

  it("picks a colour: the skin stays, the tint changes and is remembered", async () => {
    open("midnight");
    await act(async () => { swatch("red")!.click(); await flush(); });
    expect(worn()).toEqual(["midnight", "red"]);
    expect(localStorage.getItem("omb-skin")).toBe("midnight");
    expect(localStorage.getItem(SKIN_TINT_KEY)).toBe("red");
    await act(async () => { swatch("basic")!.click(); await flush(); });
    expect(worn()).toEqual(["midnight", null]);
    expect(localStorage.getItem(SKIN_TINT_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(SKIN_VARIANTS_KEY)!)).toEqual({ studio: "basic" });
  });

  it("picks a family on its remembered colour", async () => {
    localStorage.setItem(SKIN_VARIANTS_KEY, JSON.stringify({ atelier: "pink" }));
    open("pulsatrix");
    const mini = tile("atelier")!.querySelector("[data-skin]")!;
    expect([mini.getAttribute("data-skin"), mini.getAttribute("data-skin-tint")]).toEqual(["foundry", "pink"]);
    await act(async () => { tile("atelier")!.click(); await flush(); });
    expect(worn()).toEqual(["foundry", "pink"]);
  });

  it("Auto follows the system with the colour kept", async () => {
    open("midnight", "green");
    systemDark = false;
    const trigger = modePill()!.querySelector<HTMLButtonElement>("[aria-haspopup='listbox']")!;
    await act(async () => { trigger.click(); await flush(); });
    const auto = [...document.body.querySelectorAll<HTMLElement>("[role='option']")].find((el) => el.textContent?.includes("Auto"))!;
    await act(async () => { auto.click(); await flush(); });
    expect(localStorage.getItem(SKIN_MODE_KEY)).toBe("auto");
    expect(worn()).toEqual(["daylight", "green"]);
    await act(async () => { swatch("yellow")!.click(); await flush(); });
    expect(worn()).toEqual(["daylight", "yellow"]);
    expect(localStorage.getItem(SKIN_MODE_KEY)).toBe("auto");
  });

  it("shows Intensity on a colour only, and stamps it and the texture", async () => {
    open("midnight");
    expect(host.querySelector('[data-settings-row="skinDepth"]')).toBeNull();
    await act(async () => { swatch("red")!.click(); await flush(); });
    const depth = host.querySelector<HTMLElement>('[data-settings-row="skinDepth"]')!;
    await act(async () => { depth.querySelector<HTMLButtonElement>("[aria-haspopup='listbox']")!.click(); await flush(); });
    const full = [...document.body.querySelectorAll<HTMLElement>("[role='option']")].find((el) => el.textContent?.includes("Full"))!;
    await act(async () => { full.click(); await flush(); });
    expect(document.documentElement.dataset.skinDepth).toBe("full");
    expect(localStorage.getItem("omb-skin-depth")).toBe("full");
    await act(async () => { swatch("aurore")!.click(); await flush(); });
    expect(host.querySelector('[data-settings-row="skinDepth"]')).toBeNull();
    const textureRow = host.querySelector<HTMLElement>('[data-settings-row="skinTexture"]')!;
    await act(async () => { textureRow.querySelector<HTMLButtonElement>("[aria-haspopup='listbox']")!.click(); await flush(); });
    const dots = [...document.body.querySelectorAll<HTMLElement>("[role='option']")].find((el) => el.textContent?.includes("Dots"))!;
    await act(async () => { dots.click(); await flush(); });
    expect(document.documentElement.dataset.skinTexture).toBe("dots");
    expect(localStorage.getItem("omb-skin-texture")).toBe("dots");
  });

  it("gives Hibou 98 its Windows editions as variants, with no mode row", async () => {
    localStorage.setItem("omb.retro98.unlocked", "1");
    open("retro98");
    expect(tile("retro98")!.getAttribute("aria-pressed")).toBe("true");
    const ids = [...host.querySelectorAll("[data-skin-variant]")].map((el) => el.getAttribute("data-skin-variant"));
    expect(ids).toEqual(["classic", "xp", "vista", "win7", "win8", "win81", "win10", "win11"]);
    expect(swatch("classic")!.getAttribute("aria-pressed")).toBe("true");
    expect(modePill()).toBeNull();
    expect(host.querySelector('[data-settings-row="skinTexture"]')).toBeNull();
    await act(async () => { swatch("xp")!.click(); await flush(); });
    expect(worn()).toEqual(["retro98", "xp"]);
    expect(swatch("xp")!.getAttribute("aria-pressed")).toBe("true");
  });
});
