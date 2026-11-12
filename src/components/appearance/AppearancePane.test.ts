// The persona editor's Appearance: Reset, the picture in use, and the Mascot
// view (MascotLookEditor): the preview band, then the Mascot, Shape, Color
// and Skin tabs, clicked through in a happy-dom window
// installed by hand (src/testing/happy-window.ts).
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installHappyWindow } from "@/testing/happy-window";
import { MAUS_COLOR_NAMES } from "@/lib/mascot";
import { setLocale } from "@/lib/i18n";
import { resetAchievementsForTests } from "@/lib/achievements";
import { StoreProvider, type Bot } from "@/state/store";
import { NOTHING_LOCKED, type AchievementSnapshot } from "../../../shared/achievements";
import { botMascotLook, completeMascotLook, CRAB_SKINS } from "../../../shared/mascot-look";
import { MASCOT_SKIN_IDS } from "../../../shared/mascot-skins";
import MascotLookEditor, { editorTabsFor, randomLook, type EditorTab, type MascotLookPatch } from "../floating-bots/MascotLookEditor";
import { MASCOTS } from "../floating-bots/mascots";
import { MascotHeroSlotContext, type MascotHeroSlot } from "../floating-bots/mascot-hero-slot";
import { AppearancePane } from "./AppearancePane";

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

const renderEditor = (bot: Bot, initialTab?: EditorTab) => renderToStaticMarkup(createElement(MascotLookEditor, { bot, onPatch: vi.fn(), initialTab }));
const enforce = (rewards: string[]) => resetAchievementsForTests({ status: "ready", snapshot: { rewards, items: [] } as unknown as AchievementSnapshot });

beforeEach(() => resetAchievementsForTests({ unlocks: NOTHING_LOCKED }));
afterEach(() => resetAchievementsForTests());
afterAll(() => closeWindow());

describe("the Appearance pane", () => {
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

  // The pane as the bot's profile page shows it: inside the page's hero slot (#2313).
  const mountPane = async (bot: Bot, inPage = false) => {
    const target = document.createElement("div");
    const slot: MascotHeroSlot = { target, claim: () => {}, heading: "Maus" };
    const pane = createElement(StoreProvider, null, createElement(AppearancePane, { bot, onPatch: vi.fn() }));
    await act(async () => root.render(inPage ? createElement(MascotHeroSlotContext.Provider, { value: slot }, pane) : pane));
    // the editor's lazy chunk
    for (let tick = 0; tick < 5 && !host.querySelector("[data-mascot-look-editor]"); tick++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(host.querySelector("[data-mascot-look-editor]")).not.toBeNull();
  };
  const inside = (selector: string, container: string) => Boolean(host.querySelector(container)?.querySelector(selector));

  it("regression #4076: no source bar and no strip under the mascot's name, on the profile page and on the preview card", async () => {
    for (const inPage of [true, false]) {
      await mountPane(makeBot(), inPage);
      // the source bar: no Mascot / Generate / Upload, no search, no Generate or Upload pane
      expect(host.querySelector("[data-appearance-modes], [data-appearance-mode], [data-mascot-search], [data-mascot-tools], [data-avatar-upload]")).toBeNull();
      expect(host.querySelector('[role="tablist"][aria-label="Avatar source"]')).toBeNull();
      expect(host.textContent).not.toMatch(/Generate|Upload|Search \d+ mascots/);
      // the strip: no family line, no In use pill, no moves menu, no Play a move
      expect(host.querySelector("[data-mascot-summary], [data-mascot-action], [data-mascot-moves], [data-mascot-move-list], [data-mascot-play], [data-mascot-controls]")).toBeNull();
      expect(host.textContent).not.toMatch(/In use|\d+ moves|Play a move/);
      // what stays: the tabs, the chips over the gallery, Reset and Randomize
      expect(inside('[data-mascot-filter="all"]', '[data-appearance-tab-panel="mascot"] [data-mascot-browser]')).toBe(true);
      expect(host.querySelector("[data-character-option]")).not.toBeNull();
      expect(inside("[data-appearance-reset]", "[data-appearance-tab-bar] [data-appearance-tab-actions]")).toBe(true);
      expect(host.querySelectorAll("[data-mascot-randomize]").length).toBe(1);
      await act(async () => root.render(createElement("div")));
    }
    // a size container: the gallery lays itself out on the pane's width, not the window's
    await mountPane(makeBot());
    expect(host.querySelector("[data-appearance-pane]")?.className).toBe("@container");
  });

  it("says a picture is in use in place of the gallery, with Use the mascot, and no zoom or framing", async () => {
    await mountPane(makeBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "circle", avatarZoom: 1.5 }));
    expect(host.querySelector("[data-appearance-picture]")?.textContent).toContain("This bot shows a picture instead of its mascot.");
    expect(host.querySelector("[data-character-option]")).toBeNull();
    expect(host.innerHTML).not.toContain('aria-label="Zoom avatar"');
    // Shape, Color and Skin stay one click away
    expect(host.querySelector('[data-appearance-tab="color"]')).not.toBeNull();
  });

  it("regression (the owner 2026-11-06): on the profile page, colours only in the Color tab, Reset and Randomize in the tab row", async () => {
    await mountPane(makeBot(), true);
    // open on Mascot: no colour dot anywhere, Reset and Randomize at the right of the tabs
    expect(host.querySelector('[data-appearance-tab="mascot"]')?.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelectorAll("[data-mascot-color]").length).toBe(0);
    expect(inside("[data-appearance-reset]", "[data-appearance-tab-actions]")).toBe(true);
    expect(inside("[data-mascot-randomize]", "[data-appearance-tab-actions]")).toBe(true);
    expect(host.querySelectorAll("[data-mascot-randomize]").length).toBe(1);
    // nothing of the pane before its tab row
    const bar = host.querySelector("[data-appearance-tab-bar]")!;
    for (const selector of ["[data-appearance-reset]", "[data-mascot-randomize]"]) {
      const element = host.querySelector(selector)!;
      expect(bar.compareDocumentPosition(element) & window.Node.DOCUMENT_POSITION_PRECEDING).toBe(0);
    }
    // Skin (Shape too, for Shapes): still no colour dot
    for (const tab of ["skin"]) {
      await act(async () => host.querySelector<HTMLButtonElement>(`[data-appearance-tab="${tab}"]`)!.click());
      expect(host.querySelectorAll("[data-mascot-color]").length).toBe(0);
    }
    // Color: the dots, inside its panel; Reset and Randomize still in the tab row
    await act(async () => host.querySelector<HTMLButtonElement>('[data-appearance-tab="color"]')!.click());
    expect(host.querySelector("[data-appearance-tab-panel]")?.getAttribute("data-appearance-tab-panel")).toBe("color");
    expect(host.querySelectorAll('[data-appearance-tab-panel="color"] [data-mascot-color]').length).toBeGreaterThan(0);
    expect(host.querySelectorAll("[data-mascot-color]").length).toBe(host.querySelectorAll('[data-appearance-tab-panel="color"] [data-mascot-color]').length);
    expect(inside("[data-appearance-reset]", "[data-appearance-tab-actions]")).toBe(true);
    expect(inside("[data-mascot-randomize]", "[data-appearance-tab-actions]")).toBe(true);
  });

  it("regression #4076: on a narrow pane the tabs wrap at full width, Reset and Randomize on their own row, so no label is cut", async () => {
    await mountPane(makeBot(), true);
    const classes = (selector: string) => (host.querySelector(selector)?.getAttribute("class") ?? "").split(/\s+/);
    // narrow: one column, the tabs wrap instead of scrolling out of sight
    const bar = classes("[data-appearance-tab-bar]");
    expect(bar).toContain("flex-col");
    expect(bar).toContain("@[34rem]:flex-row");
    const tabs = classes("[data-appearance-tabs]");
    expect(tabs).toContain("flex-wrap");
    expect(tabs).not.toContain("overflow-x-auto");
    expect(tabs).toContain("@[34rem]:overflow-x-auto");
    // the actions come after the tabs, on their own row
    const tablist = host.querySelector("[data-appearance-tabs]")!;
    const actions = host.querySelector("[data-appearance-tab-actions]")!;
    expect(tablist.compareDocumentPosition(actions) & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the Mascot gallery", () => {
  it("still offers every bot color for the mascot, on its palette's tab", () => {
    for (const color of MAUS_COLOR_NAMES) {
      expect(renderEditor(makeBot({ color }), "color")).toMatch(new RegExp(`aria-checked="true"[^>]*aria-label="Use ${color} mascot color"`));
    }
  });

  it("offers every skin with a live preview, by rarity, Classic chosen by default", () => {
    const markup = renderEditor(makeBot(), "skin");
    expect(markup).toContain(">Skin<");
    for (const skin of ["none", "snowy", "barn", "carbon"]) expect(markup).toContain(`data-mascot-skin-option="${skin}"`);
    expect(markup).toContain('aria-checked="true" aria-label="Classic, Common"');
    expect(markup).toContain('aria-checked="false" aria-label="Snowy, Common"');
    const epic = renderEditor(makeBot({ mascotSkin: "lightning" }), "skin");
    expect(epic).toContain('aria-checked="true" aria-label="Lightning, Epic"');
    expect(epic).toMatch(/data-owl-skin="lightning" data-owl-fx="live"/);
    // SAFETY: a skin this build does not know can arrive from a newer client.
    expect(renderEditor(makeBot({ mascotSkin: "plasma" as Bot["mascotSkin"] }), "skin")).toContain('aria-checked="true" aria-label="Classic, Common"');
  });

  it("offers black among the colors, outlined so it reads on a dark card", () => {
    const markup = renderEditor(makeBot({ color: "black" }), "color");
    expect(markup).toMatch(/aria-label="Use black mascot color"/);
    expect(markup).toContain("inset 0 0 0 1.5px");
  });

  it("filters nine mascots by chip, and shows each tile with its name and family", () => {
    const html = renderEditor(makeBot());
    expect(html).not.toContain("data-mascot-search");
    expect([...html.matchAll(/data-mascot-filter="([\w:]+)"/g)].map((match) => match[1])).toEqual(["all", "owned", "family:classics", "family:shapes", "family:animals"]);
    expect(html).toMatch(/aria-pressed="true" data-mascot-filter="all"/);
    expect(html).toContain(">Classics<");
    expect(html).toContain(">Animals<");
    // nothing locked: every character is the bot's to wear, the owl in use and shown
    expect(html).toContain('data-mascot-shelf="yours"');
    expect(html).not.toContain('data-mascot-shelf="locked"');
    expect(html).toContain('>9 of 9<');
    expect(html).toMatch(/data-character-option="owl" data-in-use="" aria-pressed="true" aria-label="Owl, in use"/);
  });

  it("names the shown character in the preview band, with Randomize and nothing under the name", () => {
    const html = renderEditor(makeBot({ mascotLook: botMascotLook({ character: "frog" }) }));
    expect(html).toContain('data-mascot-detail="frog"');
    expect(html).toContain('aria-label="Frog preview"');
    expect(html).toMatch(/data-mascot-name="">Frog</);
    expect(html).not.toContain("data-mascot-summary");
    expect(html).not.toContain("Play a move");
    expect(html).toContain("Randomize<");
  });

  it("shows the Mascot, Shape, Color and Skin tabs with their values, one grid at a time", () => {
    const html = renderEditor(makeBot({ mascotLook: botMascotLook({ character: "shape", shape: "pumpkin" }) }));
    expect([...html.matchAll(/data-appearance-tab="(\w+)"/g)].map((match) => match[1])).toEqual(["mascot", "shape", "color", "skin"]);
    expect(html).toMatch(/aria-selected="true"[^>]*data-appearance-tab="mascot"/);
    expect(html.match(/data-appearance-tab-value=""/g)).toHaveLength(4);
    expect(html).toContain(">Pumpkin<");
    // only the open tab's grid is drawn
    expect(html).toContain("data-character-option=");
    expect(html).not.toContain("data-character-shape");
    expect(html).not.toContain("data-mascot-color=");
    const shapes = renderEditor(makeBot({ mascotLook: botMascotLook({ character: "shape" }) }), "shape");
    expect(shapes.match(/data-character-shape=/g)).toHaveLength(40);
    expect(shapes).not.toContain("data-character-option=");
  });

  it("offers Shape only for Shapes and Color only for a character that takes it", () => {
    const tabsOf = (id: string) => editorTabsFor(MASCOTS.find((option) => option.id === id)!);
    expect(tabsOf("shape")).toEqual(["mascot", "shape", "color", "skin"]);
    expect(tabsOf("owl")).toEqual(["mascot", "color", "skin"]);
    expect(tabsOf("trombi")).toEqual(["mascot", "skin"]);
    // a tab the character does not offer opens Mascot
    expect(renderEditor(makeBot(), "shape")).toMatch(/aria-selected="true"[^>]*data-appearance-tab="mascot"/);
  });

  it("randomizes to an owned character, skin and color only", () => {
    const look = completeMascotLook(null);
    let seed = 0;
    const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let index = 0; index < 60; index += 1) {
      const patch = randomLook({
        listed: MASCOTS,
        look,
        color: "green",
        owlSkin: "none",
        characterLocked: (id) => id !== "owl" && id !== "frog",
        skinLocked: (_id, skin) => skin !== "none" && skin !== "plain" && skin !== "leaf",
        random,
      });
      const character = patch.mascotLook!.character;
      expect(["owl", "frog"]).toContain(character);
      if (character === "owl") expect(patch.mascotSkin).toBe("none");
      else expect(["plain", "leaf"]).toContain(patch.mascotLook!.skins!.frog);
      expect(MAUS_COLOR_NAMES).toContain(patch.color);
    }
  });
});

describe("picking in the gallery", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let patches: MascotLookPatch[];

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

  const mount = async (bot: Bot) => {
    const onOwlMove = vi.fn();
    await act(async () => root.render(createElement(MascotLookEditor, { bot, onPatch: (patch) => patches.push(patch), onOwlMove })));
    return onOwlMove;
  };
  const tile = (id: string) => host.querySelector<HTMLButtonElement>(`[data-character-option="${id}"]`)!;

  it("saves an unlocked character at once, as the popover did", async () => {
    await mount(makeBot());
    await act(async () => tile("frog").click());
    expect(patches).toEqual([{ mascotLook: expect.objectContaining({ character: "frog" }) }]);
    expect(host.querySelector("[data-mascot-detail]")?.getAttribute("data-mascot-detail")).toBe("frog");
    expect(tile("frog").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows locked characters greyed on To unlock, previewed but never worn", async () => {
    enforce([]);
    await mount(makeBot());
    expect(tile("ogre").hasAttribute("data-locked")).toBe(true);
    expect(tile("crab").hasAttribute("data-locked")).toBe(true);
    expect(tile("owl").hasAttribute("data-locked")).toBe(false);
    expect(host.querySelector('[data-mascot-shelf="locked"]')).not.toBeNull();
    // Trombi is an easter egg: out until found
    expect(host.querySelector('[data-character-option="trombi"]')).toBeNull();
    await act(async () => tile("crab").click());
    expect(host.querySelector("[data-mascot-detail]")?.getAttribute("data-mascot-detail")).toBe("crab");
    expect(tile("crab").getAttribute("aria-label")).toMatch(/^Crab, locked\. /);
    expect(patches).toEqual([]);
  });

  const openTab = (id: EditorTab) => act(async () => host.querySelector<HTMLButtonElement>(`[data-appearance-tab="${id}"]`)!.click());
  /** Every skin card of the character shown, tab after tab. */
  const allSkinCards = async (attribute: string) => {
    await openTab("skin");
    const cards = new Map<string, HTMLButtonElement>();
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[data-skin-tabs] [role="tab"]')];
    for (const tab of tabs) {
      await act(async () => tab.click());
      for (const card of host.querySelectorAll<HTMLButtonElement>(`[${attribute}]`)) cards.set(card.getAttribute(attribute)!, card);
    }
    return cards;
  };
  /** Opens the tab holding a skin's card, then clicks it. */
  const clickSkin = async (attribute: string, skin: string) => {
    await openTab("skin");
    for (const tab of host.querySelectorAll<HTMLButtonElement>('[data-skin-tabs] [role="tab"]')) {
      await act(async () => tab.click());
      const card = host.querySelector<HTMLButtonElement>(`[${attribute}="${skin}"]`);
      if (card) return act(async () => card.click());
    }
    throw new Error(`no card for ${skin}`);
  };

  it("lists every skin, a locked one with its padlock and how to unlock it, never selectable", async () => {
    enforce([]);
    await mount(makeBot());
    const cards = await allSkinCards("data-mascot-skin-option");
    expect([...cards.keys()].sort()).toEqual([...MASCOT_SKIN_IDS].sort());
    const frost = cards.get("frost")!;
    expect(frost.hasAttribute("data-locked")).toBe(true);
    expect(frost.getAttribute("aria-disabled")).toBe("true");
    expect(frost.querySelector(".unlock-lock svg.lucide-lock")).not.toBeNull();
    expect(frost.getAttribute("title")).toMatch(/Unlock: /);
    expect(frost.getAttribute("aria-label")).toMatch(/^Ice, Rare, locked\. Unlock: /);
    await clickSkin("data-mascot-skin-option", "frost");
    expect(patches).toEqual([]);
    // the Common ones come with the owl
    const snowy = cards.get("snowy")!;
    expect(snowy.hasAttribute("data-locked")).toBe(false);
    expect(snowy.querySelector(".unlock-lock")).toBeNull();
  });

  it("says how to unlock a locked skin in French too", async () => {
    setLocale("fr");
    enforce([]);
    await mount(makeBot());
    const frost = (await allSkinCards("data-mascot-skin-option")).get("frost")!;
    expect(frost.getAttribute("title")).toMatch(/Pour débloquer : /);
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
    await act(async () => root.render(createElement(MascotLookEditor, { bot: makeBot({ mascotLook: botMascotLook(patches[0]!.mascotLook) }), onPatch: (patch) => patches.push(patch) })));
    const cards = await allSkinCards("data-crab-skin-option");
    expect([...cards.keys()].sort()).toEqual([...CRAB_SKINS].sort());
    expect(cards.get("pearl")!.hasAttribute("data-locked")).toBe(false);
    expect(cards.get("gold")!.hasAttribute("data-locked")).toBe(true);
    await clickSkin("data-crab-skin-option", "gold");
    expect(patches).toHaveLength(1);
    await clickSkin("data-crab-skin-option", "pearl");
    const saved = patches[1]!.mascotLook!;
    expect(saved).toMatchObject({ character: "crab", skins: expect.objectContaining({ crab: "pearl" }) });
    // what is saved is what the bot stores and every avatar draws (BotRecord.mascotLook)
    expect(completeMascotLook(botMascotLook(JSON.parse(JSON.stringify(saved)))).skins.crab).toBe("pearl");
  });

  it("narrows the tiles by chip", async () => {
    enforce([]);
    await mount(makeBot());
    const shown = () => [...host.querySelectorAll("[data-character-option]")].map((element) => element.getAttribute("data-character-option"));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-mascot-filter="family:classics"]')!.click());
    expect(shown()).toEqual(["owl"]);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-mascot-filter="owned"]')!.click());
    expect(shown()).toEqual(["owl"]);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-mascot-filter="all"]')!.click());
    expect(shown()).toContain("crab");
  });

  it("plays a wing move on the stage and across the app", async () => {
    const onOwlMove = await mount(makeBot());
    // a click on the stage plays the next move, saving nothing
    await act(async () => host.querySelector<HTMLButtonElement>("[data-mascot-stage]")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>("[data-mascot-stage]")!.click());
    expect(onOwlMove).toHaveBeenCalledTimes(2);
    expect(onOwlMove).toHaveBeenNthCalledWith(1, "spread-wings");
    expect(patches).toEqual([]);
  });

  it("randomizes in one saved patch and shows what it drew", async () => {
    await mount(makeBot());
    await act(async () => host.querySelector<HTMLButtonElement>("[data-mascot-randomize]")!.click());
    expect(patches).toHaveLength(1);
    const character = patches[0]!.mascotLook!.character!;
    expect(host.querySelector("[data-mascot-detail]")?.getAttribute("data-mascot-detail")).toBe(character);
  });

  it("switches tabs with the arrow keys and underlines the open one in the bot's color", async () => {
    await mount(makeBot({ color: "green" }));
    const tab = (id: string) => host.querySelector<HTMLButtonElement>(`[data-appearance-tab="${id}"]`)!;
    await act(async () => tab("mascot").dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }) as unknown as Event));
    expect(tab("color").getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector("[data-appearance-tab-panel]")?.getAttribute("data-appearance-tab-panel")).toBe("color");
    expect(tab("color").style.borderBottomColor).not.toBe("transparent");
    expect(tab("mascot").style.borderBottomColor).toBe("transparent");
  });
});
