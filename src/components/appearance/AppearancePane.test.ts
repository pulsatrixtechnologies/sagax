// The persona editor's Appearance: the source control (Mascot, Generate,
// Upload) and Reset, the picture sources, and the Mascot view
// (MascotLookEditor): the preview band, then the Mascot, Shape, Color and
// Skin tabs, clicked through in a happy-dom window
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
import { AppearancePane, initialAppearanceMode } from "./AppearancePane";

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

const renderPane = (bot: Bot) => renderToStaticMarkup(createElement(StoreProvider, null, createElement(AppearancePane, { bot, onPatch: vi.fn() })));
const renderEditor = (bot: Bot, initialTab?: EditorTab) => renderToStaticMarkup(createElement(MascotLookEditor, { bot, onPatch: vi.fn(), initialTab }));
const enforce = (rewards: string[]) => resetAchievementsForTests({ status: "ready", snapshot: { rewards, items: [] } as unknown as AchievementSnapshot });

beforeEach(() => resetAchievementsForTests({ unlocks: NOTHING_LOCKED }));
afterEach(() => resetAchievementsForTests());
afterAll(() => closeWindow());

describe("the Appearance pane", () => {
  it("offers Mascot, Generate and Upload as tabs, Reset on the right", () => {
    const html = renderPane(makeBot());
    expect([...html.matchAll(/data-appearance-mode="(\w+)"/g)].map((match) => match[1])).toEqual(["mascot", "generate", "upload"]);
    expect(html).toContain('role="tablist" aria-label="Avatar source"');
    expect(html).toMatch(/aria-selected="true"[^>]*data-appearance-mode="mascot"/);
    expect(html).toMatch(/data-appearance-reset=""[^>]*>Reset</);
    // a size container: the gallery lays itself out on the pane's width, not the window's
    expect(html).toContain('class="@container" data-appearance-pane=""');
  });

  it("opens a custom picture on Upload, with its zoom and framing", () => {
    expect(initialAppearanceMode({ avatarCrop: "circle", avatarUrl: "/api/attachments/cat.webp" })).toBe("upload");
    expect(initialAppearanceMode({ avatarCrop: "mascot", avatarUrl: "/api/attachments/cat.webp" })).toBe("mascot");
    expect(initialAppearanceMode({})).toBe("mascot");
    const markup = renderPane(makeBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "circle", avatarZoom: 1.5 }));
    expect(markup).toMatch(/aria-selected="true"[^>]*data-appearance-mode="upload"/);
    expect(markup).toContain('aria-label="Zoom avatar"');
    expect(markup).toContain("Drag the picture to reposition it");
    expect(markup).toContain("150%");
    expect(markup).toContain("Reset framing");
  });

  it("hides zoom controls for the mascot", () => {
    expect(renderPane(makeBot())).not.toContain('aria-label="Zoom avatar"');
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

  it("searches nine mascots, filters by chip, and shows each tile with its name and family", () => {
    const html = renderEditor(makeBot());
    expect(html).toContain('placeholder="Search 9 mascots"');
    expect([...html.matchAll(/data-mascot-filter="([\w:]+)"/g)].map((match) => match[1])).toEqual(["all", "owned", "family:classics", "family:shapes", "family:animals"]);
    expect(html).toMatch(/aria-pressed="true" data-mascot-filter="all"/);
    expect(html).toContain(">Classics<");
    expect(html).toContain(">Animals<");
    // nothing locked: every character is the bot's to wear, the owl in use and shown
    expect(html).toContain('data-mascot-shelf="yours"');
    expect(html).not.toContain('data-mascot-shelf="locked"');
    expect(html).toContain('>9 of 9<');
    expect(html).toMatch(/data-character-option="owl" data-in-use="" aria-pressed="true" aria-label="Owl, in use"/);
    expect(html).toContain('data-mascot-action="in-use"');
    expect(html).toContain(">In use<");
  });

  it("names the shown character, what it wears and its moves in the preview band", () => {
    const html = renderEditor(makeBot({ mascotLook: botMascotLook({ character: "frog" }) }));
    expect(html).toContain('data-mascot-detail="frog"');
    expect(html).toContain('aria-label="Frog preview"');
    expect(html).toMatch(/data-mascot-summary="">Animals · Vivid · [^<]+</);
    expect(html).toMatch(/data-mascot-moves=""[^>]*>\d+ moves/);
    expect(html).toContain("Play a move<");
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
  const action = () => host.querySelector<HTMLButtonElement>("[data-mascot-action]")!;

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
    expect(action().getAttribute("data-mascot-action")).toBe("locked");
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

  it("narrows the tiles by chip and by search, and says when nothing matches", async () => {
    enforce([]);
    await mount(makeBot());
    const shown = () => [...host.querySelectorAll("[data-character-option]")].map((element) => element.getAttribute("data-character-option"));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-mascot-filter="family:classics"]')!.click());
    expect(shown()).toEqual(["owl"]);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-mascot-filter="owned"]')!.click());
    expect(shown()).toEqual(["owl"]);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-mascot-filter="all"]')!.click());
    const search = host.querySelector<HTMLInputElement>("[data-mascot-search]")!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(search), "value")!.set!;
      setValue.call(search, "zzz");
      search.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
    });
    expect(shown()).toEqual([]);
    expect(host.querySelector("[data-mascot-empty]")?.textContent).toBe("No mascot matches “zzz”.");
  });

  it("plays a wing move on the stage and across the app", async () => {
    const onOwlMove = await mount(makeBot());
    expect(host.querySelector<HTMLElement>("[data-mascot-move-list]")!.hidden).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-mascot-moves]")!.click());
    expect(host.querySelector("[data-mascot-moves]")?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector<HTMLElement>("[data-mascot-move-list]")!.hidden).toBe(false);
    expect(host.querySelector("[data-mascot-move-list]")?.textContent).toContain("Moves");
    for (const [move, label] of [["spread-wings", "Spread wings"], ["flap", "Flap"], ["take-off", "Take off"], ["shake", "Ruffle"], ["hoot", "Hoot"]]) {
      expect(host.querySelector(`[data-character-move="${move}"]`)?.getAttribute("aria-label")).toBe(`Play the ${label} move`);
    }
    await act(async () => host.querySelector<HTMLButtonElement>('[data-character-move="flap"]')!.click());
    expect(onOwlMove).toHaveBeenCalledWith("flap");
    // Play a move plays the next one, saving nothing
    await act(async () => host.querySelector<HTMLButtonElement>("[data-mascot-play]")!.click());
    expect(onOwlMove).toHaveBeenCalledTimes(2);
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
