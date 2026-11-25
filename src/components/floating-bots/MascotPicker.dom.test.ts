// A bot's Appearance, clicked through: the mascot picker (MascotPicker) under
// the bot's mascot, its two tabs, its grid, its skins list and its colour
// row, and the page's hero mascot (MascotHero), in a happy-dom window
// installed by hand (src/testing/happy-window.ts).
//
// This file was AppearancePane.test.ts: it described the Appearance window's
// editor (a preview band over seven tabs). The mock-up the owner validated
// replaced that editor with the picker [M-20261125-063] [M-20261125-064]
// [M-20261125-065]: each expectation that described the old screen now says
// what the mock-up asks, with the id beside it; the others are kept as they were.
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installHappyWindow } from "@/testing/happy-window";
import { MAUS_COLORS, MAUS_COLOR_NAMES } from "@/lib/mascot";
import { setLocale } from "@/lib/i18n";
import { resetAchievementsForTests } from "@/lib/achievements";
import type { Bot } from "@/state/store";
import { NOTHING_LOCKED, type AchievementSnapshot } from "../../../shared/achievements";
import { botMascotLook, completeMascotLook, CRAB_SKINS, MASCOT_SHAPES } from "../../../shared/mascot-look";
import { MASCOT_SKIN_IDS } from "../../../shared/mascot-skins";
import MascotHero from "./MascotHero";
import MascotPicker, { type MascotPickerProps } from "./MascotPicker";
import { MascotPickerPopover } from "./MascotPickerPopover";
import { pickerControls, QUICK_COLORS, type PickerPatch, type PickerTab } from "./mascot-picker";
import { MASCOTS } from "./mascots";

const closeWindow = installHappyWindow();
const { createRoot } = await import("react-dom/client");

function makeBot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot-1",
    threadId: "thread-1",
    name: "Maus",
    title: "Maus",
    description: "",
    notifications: false,
    color: "green",
    unread: false,
    modelSelection: { instanceId: "local", model: "test-model" },
    messages: [],
    ...overrides,
  };
}

// the picker's own small panels (skins, gear, "+") go through a portal, which the static renderer cannot draw: they are mounted below
const renderPicker = (bot: Bot, initialTab?: PickerTab) => renderToStaticMarkup(createElement(MascotPicker, { bot, onPatch: vi.fn(), initialTab }));
const enforce = (rewards: string[]) => resetAchievementsForTests({ status: "ready", snapshot: { rewards, items: [] } as unknown as AchievementSnapshot });

beforeEach(() => resetAchievementsForTests({ unlocks: NOTHING_LOCKED }));
afterEach(() => resetAchievementsForTests());
afterAll(() => closeWindow());

describe("the mascot picker's panel", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    setLocale("en");
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const mountPicker = async (bot: Bot, extra: Partial<MascotPickerProps> = {}) => {
    await act(async () => root.render(createElement(MascotPicker, { bot, onPatch: vi.fn(), ...extra })));
    expect(host.querySelector("[data-mascot-picker]")).not.toBeNull();
  };
  const inside = (selector: string, container: string) => Boolean(host.querySelector(container)?.querySelector(selector));

  it("regression #4076: no source bar and no strip under the mascot's name", async () => {
    await mountPicker(makeBot());
    // the source bar: no Mascot / Generate / Upload, no search, no Generate or Upload pane
    expect(host.querySelector("[data-appearance-modes], [data-appearance-mode], [data-mascot-search], [data-mascot-tools], [data-avatar-upload]")).toBeNull();
    expect(host.querySelector('[role="tablist"][aria-label="Avatar source"]')).toBeNull();
    expect(host.textContent).not.toMatch(/Generate|Upload|Search \d+ mascots/);
    // the strip: no family line, no In use pill, no moves menu, no Play a move
    expect(host.querySelector("[data-mascot-summary], [data-mascot-action], [data-mascot-moves], [data-mascot-move-list], [data-mascot-play], [data-mascot-controls]")).toBeNull();
    expect(host.textContent).not.toMatch(/In use|\d+ moves|Play a move/);
    // [M-20261125-064] what stays is the mock-up's panel: the two tabs and the grid; the chips over
    // the gallery, Reset and Randomize left the screen with it (they were asserted present here)
    expect(host.querySelectorAll('[data-mascot-picker-tabs] [role="tab"]').length).toBe(2);
    expect(host.querySelector("[data-character-option]")).not.toBeNull();
    expect(host.querySelector("[data-mascot-filter], [data-appearance-reset], [data-mascot-randomize]")).toBeNull();
    // [M-20261125-063] no window and no pane: the panel is its own box, of a fixed width that the window's edge can narrow
    expect(host.querySelector("[data-appearance-pane]")).toBeNull();
    expect(host.querySelector("[data-mascot-picker]")?.className).toContain("max-w-[calc(100vw-16px)]");
  });

  it("says a picture is in use over the panel, with Use the mascot, and no zoom or framing", async () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const onUseMascot = vi.fn();
    await act(async () => root.render(createElement(MascotPickerPopover, { anchorRef: { current: anchor }, onClose: vi.fn(), onUseMascot, bot: makeBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "circle", avatarZoom: 1.5 }), onPatch: vi.fn() })));
    // the picker's lazy chunk
    for (let tick = 0; tick < 50 && !document.querySelector("[data-mascot-picker]"); tick++) await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    const panel = document.querySelector("[data-mascot-picker-popover]")!;
    expect(panel.querySelector("[data-appearance-picture]")?.textContent).toContain("This bot shows a picture instead of its mascot.");
    expect(panel.innerHTML).not.toContain('aria-label="Zoom avatar"');
    await act(async () => panel.querySelector<HTMLButtonElement>("[data-appearance-picture] button")!.click());
    expect(onUseMascot).toHaveBeenCalledTimes(1);
    // [M-20261125-063] the line sits over the panel, no longer in place of the gallery: the grid and the
    // colours stay one glance away under it (they were one click away, behind the Color tab)
    expect(panel.querySelector("[data-character-option]")).not.toBeNull();
    expect(panel.querySelector("[data-mascot-picker-colors]")).not.toBeNull();
    await act(async () => root.render(createElement("div")));
    anchor.remove();
  });

  it("the colours are one row at the foot of the panel, once, whatever the tab (the owner 2026-11-06 asked for one place only)", async () => {
    await mountPicker(makeBot());
    // [D-20261125-028] [M-20261125-064] the Color tab is gone: the one place is now the row under the
    // pills, eleven quick colours, the free colour and the way back; no Reset, no Randomize
    const row = () => host.querySelectorAll("[data-mascot-picker-colors]");
    expect(row().length).toBe(1);
    expect(host.querySelectorAll("[data-mascot-color]").length).toBe(11);
    expect(host.querySelectorAll("[data-mascot-picker-colors] [data-mascot-color]").length).toBe(11);
    expect(inside("[data-mascot-color-custom]", "[data-mascot-picker-colors]")).toBe(true);
    expect(inside("[data-mascot-color-reset]", "[data-mascot-picker-colors]")).toBe(true);
    // the row comes after the grid and the pills, never before the tabs
    const pills = host.querySelector("[data-mascot-picker-pills]")!;
    expect(pills.compareDocumentPosition(row()[0]!) & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.querySelector("[data-mascot-picker-tabs]")!.compareDocumentPosition(row()[0]!) & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the other tab: the same single row, no colour anywhere else
    await act(async () => host.querySelector<HTMLButtonElement>('[data-mascot-picker-tab="shapes"]')!.click());
    expect(row().length).toBe(1);
    expect(host.querySelectorAll("[data-mascot-color]").length).toBe(11);
    expect(host.querySelector("[data-appearance-reset], [data-mascot-randomize]")).toBeNull();
  });

  it("the tabs are single-line pills on ONE row, with the gear at their right (the owner 2026-11-17, save vertical space)", async () => {
    await mountPicker(makeBot({ mascotLook: botMascotLook({ character: "shape", shape: "cup" }) }));
    // [D-20261125-030] two tabs, Shapes and Characters, in place of the seven with their value inline;
    // [M-20261125-064] the gear takes the place Reset and Randomize had at the right of the row
    const tablist = host.querySelector("[data-mascot-picker-tabs]")!;
    const classes = (tablist.getAttribute("class") ?? "").split(/\s+/);
    expect(classes).toContain("flex");
    expect(classes).not.toContain("flex-col");
    const tabs = [...tablist.querySelectorAll("[data-mascot-picker-tab]")];
    expect(tabs.map((tab) => tab.getAttribute("data-mascot-picker-tab"))).toEqual(["shapes", "characters"]);
    for (const button of tabs) {
      expect(button.getAttribute("role")).toBe("tab");
      expect(button.getAttribute("class")).toContain("items-center");
      expect(button.getAttribute("class")).not.toContain("flex-col");
    }
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Shapes", "Characters"]);
    // the gear comes after the tabs, on the same row, an icon with a name and a tooltip
    const gear = host.querySelector("[data-mascot-picker-gear]")!;
    expect(tablist.compareDocumentPosition(gear) & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gear.parentElement).toBe(tablist.parentElement);
    expect(gear.getAttribute("title")).toBeTruthy();
    expect(gear.getAttribute("aria-label")).toBe("Settings");
    // no filters row and no shelf count any more
    expect(host.querySelector("[data-mascot-filter-row], [data-mascot-filters], [data-mascot-first-shelf-heading]")).toBeNull();
  });
});

describe("the picker's grid and colours", () => {
  it("still shows every bot color a bot may carry: a quick colour pressed, any other kept on the free colour ring", () => {
    // [D-20261125-028] [M-20261125-061] the palettes of 63 colours left the screen; a bot wearing one keeps it and sees it
    for (const color of MAUS_COLOR_NAMES) {
      const html = renderPicker(makeBot({ color }));
      if ((QUICK_COLORS as readonly string[]).includes(color)) {
        expect(html, color).toMatch(new RegExp(`data-mascot-color="${color}"[^>]*aria-pressed="true"`));
        expect(html, color).not.toMatch(/data-on="" data-mascot-color-custom=""/);
      } else {
        expect(html, color).not.toMatch(/data-mascot-color="[a-z]+"[^>]*aria-pressed="true"/);
        expect(html, color).toMatch(/data-on="" data-mascot-color-custom=""/);
        expect(html.toLowerCase(), color).toContain(`--mp-swatch:${MAUS_COLORS[color].toLowerCase()}`);
      }
    }
  });

  it("keeps black, on the ring, and outlines a colour that would not read on the panel", () => {
    // [D-20261125-028] black is not one of the eleven: a black bot stays black, shown on the free colour ring
    const markup = renderPicker(makeBot({ color: "black" }));
    expect(markup).toMatch(/data-on="" data-mascot-color-custom=""/);
    expect(markup.toLowerCase()).toContain(`value="${MAUS_COLORS.black.toLowerCase()}"`);
    // the outline: a quick colour too light or too dark for the panel carries an edge (white, of the eleven)
    expect(markup).toMatch(/data-mascot-color="white"[^>]*data-edge=""/);
    expect(markup).not.toMatch(/data-mascot-color="green"[^>]*data-edge=""/);
  });

  it("lists the eight characters under Characters, each with its name, the worn one pressed", () => {
    // [M-20261125-064] [D-20261125-030] no chips, shelves or count: Shapes has its own tab, the others are one grid
    const html = renderPicker(makeBot());
    expect(html).not.toContain("data-mascot-search");
    expect(html).not.toContain("data-mascot-filter");
    expect(html).not.toContain("data-mascot-shelf");
    // nothing locked: every character is the bot's to wear, the owl in use and shown as pressed
    expect([...html.matchAll(/data-character-option="([a-z]+)"/g)].map((match) => match[1])).toEqual(MASCOTS.map((entry) => entry.id).filter((id) => id !== "shape"));
    expect(html).not.toContain("data-locked");
    expect(html).toMatch(/data-character-option="owl" aria-pressed="true" aria-label="Owl"/);
    expect(html).toMatch(/data-character-option="frog" aria-pressed="false" aria-label="Frog"/);
  });

  it("has no preview band, no name under it and no Randomize: the bot's own mascot above is the preview", () => {
    // [M-20261125-063] "faut pas avoir de visualisateur"; [M-20261125-064] Randomize left the screen
    const html = renderPicker(makeBot({ mascotLook: botMascotLook({ character: "frog" }) }));
    expect(html).toContain('data-mascot-picker-character="frog"');
    expect(html).not.toContain("data-mascot-detail");
    expect(html).not.toContain("data-mascot-stage");
    expect(html).not.toContain("data-mascot-name");
    expect(html).not.toContain("data-mascot-summary");
    expect(html).not.toContain("Play a move");
    expect(html).not.toContain("Randomize");
    expect(html).not.toContain("data-mascot-randomize");
    // the mascot that shows the look is the page's hero, named after its character
    const hero = renderToStaticMarkup(createElement(MascotHero, { bot: makeBot({ mascotLook: botMascotLook({ character: "frog" }) }) }));
    expect(hero).toContain('data-mascot-detail="frog"');
    expect(hero).toContain('aria-label="Frog preview"');
  });

  it("shows the Shapes and Characters tabs, one grid at a time", () => {
    // [D-20261125-030] two tabs in place of Mascot, Shape, Color, Skin, Material, Face and States; a tab carries no value
    const html = renderPicker(makeBot({ mascotLook: botMascotLook({ character: "shape", shape: "pumpkin" }) }));
    expect([...html.matchAll(/data-mascot-picker-tab="(\w+)"/g)].map((match) => match[1])).toEqual(["shapes", "characters"]);
    expect(html).toMatch(/data-mascot-picker-tab="shapes"[^>]*aria-selected="true"/);
    expect(html).not.toContain("data-appearance-tab");
    expect(html).toMatch(/data-character-shape="pumpkin"[^>]*aria-pressed="true"[^>]*aria-label="Pumpkin"/);
    // only the open tab's grid is drawn
    expect(html.match(/data-character-shape=/g)).toHaveLength(MASCOT_SHAPES.length);
    expect(html).not.toContain("data-character-option=");
    const characters = renderPicker(makeBot({ mascotLook: botMascotLook({ character: "shape" }) }), "characters");
    expect(characters).toContain("data-character-option=");
    expect(characters).not.toContain("data-character-shape");
  });

  it("offers the material, the mood and the gear only for Shapes, and colours only for a character that takes them", () => {
    // [M-20261125-064] [D-20261125-029] the pills and the gear in place of the Shape, Material, Face and States tabs
    const controlsOf = (id: string) => pickerControls(id as never, { materials: true });
    expect(controlsOf("shape")).toEqual({ materials: ["flat", "fluffy", "glass"], skins: true, mood: true, gear: true, colors: true });
    expect(controlsOf("owl")).toEqual({ materials: [], skins: true, mood: false, gear: false, colors: true });
    expect(controlsOf("trombi")).toEqual({ materials: [], skins: true, mood: false, gear: false, colors: false });
    // a tab the bot's character does not sit under is still one click away, and opens when asked
    expect(renderPicker(makeBot(), "shapes")).toMatch(/data-mascot-picker-tab="shapes"[^>]*aria-selected="true"/);
    expect(renderPicker(makeBot())).toMatch(/data-mascot-picker-tab="characters"[^>]*aria-selected="true"/);
  });

  // [M-20261125-064] "randomizes to an owned character, skin and color only" is not ported: Randomize
  // left the screen with the validated mock-up, and randomLook is removed with its button. No
  // equivalent exists to assert.
});

describe("picking in the grid", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let patches: PickerPatch[];
  let bot: Bot;

  beforeEach(() => {
    setLocale("en");
    patches = [];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  /** The picker on a bot, the store applying each patch and the picker reading the bot back. */
  const mount = async (start: Bot, extra: Partial<MascotPickerProps> = {}) => {
    bot = start;
    const draw = () => root.render(createElement(MascotPicker, { bot, ...extra, onPatch: (patch: PickerPatch) => {
      patches.push(patch);
      bot = { ...bot, ...patch } as Bot;
      draw();
    } }));
    await act(async () => draw());
  };
  const tile = (id: string) => host.querySelector<HTMLButtonElement>(`[data-character-option="${id}"]`)!;
  /** The skins list, opened from the pill's last segment (a small panel of the picker, drawn through a portal). */
  const openSkins = async () => {
    if (!document.querySelector("[data-mascot-skins]")) await act(async () => host.querySelector<HTMLButtonElement>("[data-mascot-skins-open]")!.click());
    return new Map([...document.querySelectorAll<HTMLButtonElement>("[data-mascot-skins] [data-skin-option]")].map((card) => [card.getAttribute("data-skin-option")!, card]));
  };
  const clickSkin = async (skin: string) => {
    const card = (await openSkins()).get(skin);
    if (!card) throw new Error(`no card for ${skin}`);
    await act(async () => card.click());
  };

  it("saves an unlocked character at once, as the popover did", async () => {
    await mount(makeBot());
    await act(async () => tile("frog").click());
    expect(patches).toEqual([{ mascotLook: expect.objectContaining({ character: "frog" }) }]);
    // [M-20261125-063] no preview band to follow: the panel itself now reads the bot back
    expect(host.querySelector("[data-mascot-picker]")?.getAttribute("data-mascot-picker-character")).toBe("frog");
    expect(tile("frog").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows locked characters greyed with their padlock, never worn", async () => {
    enforce([]);
    await mount(makeBot());
    expect(tile("ogre").hasAttribute("data-locked")).toBe(true);
    expect(tile("crab").hasAttribute("data-locked")).toBe(true);
    expect(tile("owl").hasAttribute("data-locked")).toBe(false);
    // [M-20261125-064] no To unlock shelf: a locked tile carries its own padlock in the one grid
    expect(tile("crab").querySelector(".unlock-lock svg.lucide-lock")).not.toBeNull();
    expect(tile("crab").getAttribute("aria-disabled")).toBe("true");
    // Trombi is an easter egg: out until found
    expect(host.querySelector('[data-character-option="trombi"]')).toBeNull();
    await act(async () => tile("crab").click());
    // [M-20261125-063] no preview: a click on a locked tile shows nothing and saves nothing
    expect(host.querySelector("[data-mascot-picker]")?.getAttribute("data-mascot-picker-character")).toBe("owl");
    expect(tile("crab").getAttribute("aria-label")).toMatch(/^Crab, locked\. /);
    expect(tile("crab").getAttribute("title")).toMatch(/^Crab\. Unlock: /);
    expect(patches).toEqual([]);
  });

  it("keeps Shapes locked until its achievement: every shape with its padlock, none worn, no shape added", async () => {
    // the lock the gallery put on the Shapes tile, carried to the Shapes tab (the mock-up removes no lock)
    enforce([]);
    await mount(makeBot(), { initialTab: "shapes" });
    const shape = (id: string) => host.querySelector<HTMLButtonElement>(`[data-character-shape="${id}"]`)!;
    expect(host.querySelectorAll("[data-character-shape][data-locked]").length).toBe(MASCOT_SHAPES.length);
    expect(shape("cup").getAttribute("aria-label")).toMatch(/^Cup, locked\. /);
    expect(shape("cup").querySelector(".unlock-lock svg.lucide-lock")).not.toBeNull();
    expect(host.querySelector("[data-mascot-add-open]")).toBeNull();
    await act(async () => shape("cup").click());
    expect(patches).toEqual([]);
    // earned: the shapes open, and the "+" with them
    enforce(["character:shape"]);
    await mount(makeBot(), { initialTab: "shapes" });
    expect(host.querySelectorAll("[data-character-shape][data-locked]").length).toBe(0);
    expect(host.querySelector("[data-mascot-add-open]")).not.toBeNull();
    await act(async () => shape("cup").click());
    expect(patches).toEqual([{ mascotLook: expect.objectContaining({ character: "shape", shape: "cup" }) }]);
  });

  it("the plus opens the import: a definition the engine accepts becomes the bot's own shape, one it refuses says why and saves nothing", async () => {
    // [M-20261125-065] the "+" is the one entry to add a shape
    const kite = { version: 1, id: "kite", name: "Kite", body: { path: "M50 10L86 50L50 90L14 50Z" }, eyes: { x: 50, y: 48, spacing: 14, scale: 1 } };
    await mount(makeBot({ mascotLook: botMascotLook({ character: "shape", shape: "star" }) }));
    const type = async (value: string) => {
      const field = document.querySelector<HTMLTextAreaElement>("[data-mascot-add-import] textarea")!;
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
      await act(async () => field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event));
      await act(async () => document.querySelector<HTMLButtonElement>("[data-mascot-import]")!.click());
    };
    await act(async () => host.querySelector<HTMLButtonElement>("[data-mascot-add-open]")!.click());
    expect(document.querySelector('[data-mascot-picker-layer="add"]')).not.toBeNull();
    expect(document.querySelector("[data-mascot-add-generate]")).toBeNull();
    await type(JSON.stringify({ ...kite, eyes: { ...kite.eyes, scale: 9 } }));
    expect(patches).toEqual([]);
    expect(document.querySelector('[data-mascot-import-reasons] [data-reason="eyesSize"]')?.textContent).toContain("eyes");
    await type("Here it is:\n```json\n" + JSON.stringify(kite) + "\n```");
    expect(patches).toHaveLength(1);
    expect(patches[0]!.mascotLook).toMatchObject({ character: "shape", shape: "star", avatarDef: { id: "kite", name: "Kite" } });
    // added: the small panel closes, and the shape is the bot's own tile, worn
    expect(document.querySelector('[data-mascot-picker-layer="add"]')).toBeNull();
    expect(host.querySelector("[data-own-shape]")?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-character-shape="star"]')?.getAttribute("aria-pressed")).toBe("false");
  });

  it("lists every skin, a locked one with its padlock and how to unlock it, never selectable", async () => {
    enforce([]);
    await mount(makeBot());
    // [D-20261125-029] the skins open from the pill's last segment, all rarities in one list (no rarity tabs to click through)
    const cards = await openSkins();
    expect([...cards.keys()].sort()).toEqual([...MASCOT_SKIN_IDS].sort());
    const frost = cards.get("frost")!;
    expect(frost.hasAttribute("data-locked")).toBe(true);
    expect(frost.getAttribute("aria-disabled")).toBe("true");
    expect(frost.querySelector("svg.lucide-lock")).not.toBeNull();
    // the line that names the achievement is written on the card (it was a tooltip)
    expect(frost.querySelector("[data-skin-unlock-hint]")?.textContent).toMatch(/Unlock: /);
    expect(frost.getAttribute("aria-label")).toMatch(/^Ice, Rare, locked\. Unlock: /);
    await clickSkin("frost");
    expect(patches).toEqual([]);
    // the Common ones come with the owl
    const snowy = (await openSkins()).get("snowy")!;
    expect(snowy.hasAttribute("data-locked")).toBe(false);
    expect(snowy.querySelector("svg.lucide-lock")).toBeNull();
    expect(snowy.querySelector("[data-skin-unlock-hint]")).toBeNull();
  });

  it("offers every skin with a live preview, by rarity, Classic chosen by default", async () => {
    await mount(makeBot());
    let list = document.querySelector("[data-mascot-skins]") ?? (await openSkins(), document.querySelector("[data-mascot-skins]")!);
    expect(list.getAttribute("aria-label")).toBe("Skin");
    expect([...list.querySelectorAll("[data-skin-tier-group]")].map((group) => group.getAttribute("data-skin-tier-group"))).toEqual(["common", "rare", "epic", "legendary"]);
    for (const skin of ["none", "snowy", "barn", "carbon"]) expect(list.querySelector(`[data-skin-tier-group="common"] [data-skin-option="${skin}"]`)).not.toBeNull();
    expect(list.querySelector('[data-skin-option="none"]')?.getAttribute("aria-checked")).toBe("true");
    expect(list.querySelector('[data-skin-option="none"]')?.getAttribute("aria-label")).toBe("Classic, Common");
    expect(list.querySelector('[data-skin-option="snowy"]')?.getAttribute("aria-checked")).toBe("false");
    expect(list.querySelector('[data-skin-option="snowy"]')?.getAttribute("aria-label")).toBe("Snowy, Common");
    await mount(makeBot({ mascotSkin: "lightning" }));
    list = document.querySelector("[data-mascot-skins]")!;
    expect(list.querySelector('[data-skin-option="lightning"]')?.getAttribute("aria-checked")).toBe("true");
    expect(list.querySelector('[data-skin-option="lightning"]')?.getAttribute("aria-label")).toBe("Lightning, Epic");
    expect(list.querySelector('[data-skin-option="lightning"]')?.innerHTML).toMatch(/data-owl-skin="lightning" data-owl-fx="live"/);
    // SAFETY: a skin this build does not know can arrive from a newer client.
    await mount(makeBot({ mascotSkin: "plasma" as Bot["mascotSkin"] }));
    expect(document.querySelector('[data-mascot-skins] [data-skin-option="none"]')?.getAttribute("aria-checked")).toBe("true");
  });

  it("says how to unlock a locked skin in French too", async () => {
    setLocale("fr");
    enforce([]);
    await mount(makeBot());
    const frost = (await openSkins()).get("frost")!;
    expect(frost.querySelector("[data-skin-unlock-hint]")?.textContent).toMatch(/Pour débloquer : /);
    expect(frost.getAttribute("aria-label")).toMatch(/verrouillé\. Pour débloquer : /);
    setLocale("en");
  });

  it("wears an earned skin: its character unlocks, the skin is picked and saved with the bot", async () => {
    // Pearl (Crab) earned, Claude never linked: the crab was hidden, its skin unusable
    enforce(["skin:crab:pearl"]);
    await mount(makeBot());
    expect(tile("crab").hasAttribute("data-locked")).toBe(false);
    await act(async () => tile("crab").click());
    expect(patches).toEqual([{ mascotLook: expect.objectContaining({ character: "crab" }) }]);
    const cards = await openSkins();
    expect([...cards.keys()].sort()).toEqual([...CRAB_SKINS].sort());
    expect(cards.get("pearl")!.hasAttribute("data-locked")).toBe(false);
    expect(cards.get("gold")!.hasAttribute("data-locked")).toBe(true);
    await clickSkin("gold");
    expect(patches).toHaveLength(1);
    await clickSkin("pearl");
    const saved = patches[1]!.mascotLook!;
    expect(saved).toMatchObject({ character: "crab", skins: expect.objectContaining({ crab: "pearl" }) });
    // what is saved is what the bot stores and every avatar draws (BotRecord.mascotLook)
    expect(completeMascotLook(botMascotLook(JSON.parse(JSON.stringify(saved)))).skins.crab).toBe("pearl");
  });

  it("narrows the grid by tab", async () => {
    // [D-20261125-030] [M-20261125-064] the chips (All, Owned, families) are gone: the two tabs are what narrows
    enforce([]);
    await mount(makeBot());
    const shown = () => [...host.querySelectorAll("[data-character-option]")].map((element) => element.getAttribute("data-character-option"));
    expect(shown()).toContain("owl");
    expect(shown()).toContain("crab");
    await act(async () => host.querySelector<HTMLButtonElement>('[data-mascot-picker-tab="shapes"]')!.click());
    expect(shown()).toEqual([]);
    expect(host.querySelectorAll("[data-character-shape]").length).toBe(MASCOT_SHAPES.length);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-mascot-picker-tab="characters"]')!.click());
    expect(shown()).toContain("crab");
    expect(host.querySelector("[data-character-shape]")).toBeNull();
  });

  it("plays a wing move on the stage and across the app", async () => {
    // [M-20261125-063] the stage is the page's hero mascot now (MascotHero), no longer a band inside the editor
    const onOwlMove = vi.fn();
    await act(async () => root.render(createElement(MascotHero, { bot: makeBot(), onOwlMove })));
    // a click on the stage plays the next move, saving nothing
    await act(async () => host.querySelector<HTMLButtonElement>("[data-mascot-stage]")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>("[data-mascot-stage]")!.click());
    expect(onOwlMove).toHaveBeenCalledTimes(2);
    expect(onOwlMove).toHaveBeenNthCalledWith(1, "spread-wings");
    expect(patches).toEqual([]);
  });

  // [M-20261125-064] "randomizes in one saved patch and shows what it drew" is not ported: Randomize left the screen.

  it("switches tabs with the arrow keys and marks the open pill", async () => {
    await mount(makeBot({ color: "green" }));
    const tab = (id: string) => host.querySelector<HTMLButtonElement>(`[data-mascot-picker-tab="${id}"]`)!;
    // [D-20261125-030] the bot wears the owl: the panel opens on Characters, and the arrow goes to Shapes
    expect(tab("characters").getAttribute("aria-selected")).toBe("true");
    await act(async () => tab("characters").dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }) as unknown as Event));
    expect(tab("shapes").getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector("[data-mascot-picker-grid]")?.getAttribute("data-mascot-picker-grid")).toBe("shapes");
    expect(tab("shapes").querySelector("[data-tab-indicator]")).not.toBeNull();
    expect(tab("characters").querySelector("[data-tab-indicator]")).toBeNull();
  });
});
