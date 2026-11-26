// #5349: the engine's settings on a bot (material, mood, the pointer the eyes
// follow, motion). They show only for the mascots the open-bot-avatar engine
// draws (the shapes); each one saves on the bot's look and reads back; a
// default leaves the look as it was stored.
//
// This file was engine-look-editor.test.ts, about the editor's Material, Face
// and States tabs. The mock-up the owner validated put these settings on the
// mascot picker (#5369): two pills of icons and the gear [M-20261125-064],
// the skins joined to the material [D-20261125-029]. The volume, the eye
// colour and the preview of the six states left the screen with it
// [M-20261125-064]: what a bot already stores of them is kept and drawn, and
// the states follow the bot's activity [D-20261125-019]. Each expectation
// about the old tabs now says what the mock-up asks, with the id beside it.
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installHappyWindow } from "@/testing/happy-window";
import { setLocale } from "@/lib/i18n";
import { resetAchievementsForTests } from "@/lib/achievements";
import type { Bot } from "@/state/store";
import { NOTHING_LOCKED } from "../../../shared/achievements";
import { engineLookOf, MASCOT_CHARACTERS, SHAPE_MATERIALS, type MascotLook } from "../../../shared/mascot-look";

// the page of this test has no WebGL2: whether materials can be painted is set per test, and none is ever loaded
const support = vi.hoisted(() => ({ materials: true }));
vi.mock("@/components/shape-material", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/shape-material")>(),
  materialsSupported: () => support.materials,
  useShapeMaterial: () => null,
}));

const closeWindow = installHappyWindow();
const { createRoot } = await import("react-dom/client");
const { default: MascotPicker } = await import("./MascotPicker");
const { pickerControls } = await import("./mascot-picker");
type PickerPatch = import("./mascot-picker").PickerPatch;

const shapeLook = (extra: Partial<MascotLook> = {}): MascotLook => ({ character: "shape", shape: "cup", ...extra }) as MascotLook;
function makeBot(look: MascotLook | undefined, overrides: Partial<Bot> = {}): Bot {
  return { id: "bot-1", threadId: "thread-1", name: "Nimbus", title: "", description: "", notifications: false, color: "blue", unread: false, modelSelection: { instanceId: "local", model: "test-model" }, messages: [], mascotLook: look, ...overrides } as Bot;
}
// the picker's small panels (the gear, the skins) go through a portal the static renderer cannot draw: they are mounted below
const render = (look: MascotLook | undefined) => renderToStaticMarkup(createElement(MascotPicker, { bot: makeBot(look), onPatch: vi.fn() }));
const materialsOf = (html: string) => [...html.matchAll(/data-option="(flat|fluffy|glass)"/g)].map((match) => match[1]);

beforeEach(() => {
  support.materials = true;
  setLocale("en");
  resetAchievementsForTests({ unlocks: NOTHING_LOCKED });
});
afterEach(() => resetAchievementsForTests());
afterAll(() => closeWindow());

describe("which mascots get the engine's settings", () => {
  it("shows the material, the mood and the gear for the shapes only: hidden for every other character, never greyed", () => {
    // [M-20261125-064] the pills and the gear stand where the Material, Face and States tabs stood
    for (const character of MASCOT_CHARACTERS) {
      const controls = pickerControls(character, { materials: true });
      expect(controls.materials.length > 0, `${character} material`).toBe(character === "shape");
      expect(controls.mood, `${character} mood`).toBe(character === "shape");
      expect(controls.gear, `${character} gear`).toBe(character === "shape");
    }
    for (const other of [render(undefined), render({ character: "bunbu" } as MascotLook)]) {
      expect(materialsOf(other)).toEqual([]);
      expect(other).not.toContain("data-mascot-mood");
      expect(other).not.toContain("data-mascot-picker-gear");
      // its skins stay, alone on the pill [D-20261125-029]
      expect(other).toContain("data-mascot-skins-open");
    }
    const shape = render(shapeLook());
    expect(materialsOf(shape)).toEqual([...SHAPE_MATERIALS]);
    expect(shape).toContain("data-mascot-mood");
    expect(shape).toContain("data-mascot-picker-gear");
    expect(shape).not.toMatch(/data-option="[a-z]+"[^>]*disabled/);
    expect(shape).not.toMatch(/<button[^>]*disabled=""[^>]*data-option=/);
    expect(shape).not.toContain("aria-disabled");
  });

  it("offers no material where the device cannot paint one, and keeps the materials under the flat Outline", () => {
    support.materials = false;
    const html = render(shapeLook());
    expect(materialsOf(html)).toEqual([]);
    // the pill then holds the skins alone; the mood and the gear stay
    expect(html).toContain("data-mascot-skins-open");
    expect(html).toContain("data-mascot-mood");
    expect(pickerControls("shape", { materials: false }).materials).toEqual([]);
    // [M-20261125-064] the volume left the screen: no slider, whatever the skin or the device
    expect(html).not.toContain("data-shape-depth");
    expect(html).not.toContain('type="range"');
    support.materials = true;
    const outline = render(shapeLook({ skins: { shape: "outline" } }));
    expect(materialsOf(outline)).toEqual([...SHAPE_MATERIALS]);
    expect(outline).not.toContain("data-shape-depth");
    expect(outline).not.toContain('type="range"');
  });
});

describe("what the pills show", () => {
  it("Material: the engine's three materials as icons, the current one checked, and no text", () => {
    const html = render(shapeLook({ material: "glass", depth: 9 }));
    expect(materialsOf(html)).toEqual([...SHAPE_MATERIALS]);
    expect(html).toMatch(/aria-checked="true"[^>]*data-option="glass"/);
    expect(html).toMatch(/aria-checked="false"[^>]*data-option="flat"/);
    // [M-20261125-064] "pas de texte": the note under the materials and the volume slider are gone
    expect(html).not.toContain("data-material-note");
    expect(html).not.toContain('type="range"');
    const flat = render(shapeLook());
    expect(flat).toMatch(/aria-checked="true"[^>]*data-option="flat"/);
    expect(flat).not.toContain("data-material-note");
  });

  it("Mood: the two moods as icons, the current one checked; no eye colour", () => {
    const html = render(shapeLook({ mood: "happy", eyeColor: "#ffffff", followPointer: false }));
    expect(html).toMatch(/aria-checked="true"[^>]*data-option="happy"/);
    expect(html).toMatch(/aria-checked="false"[^>]*data-option="neutral"/);
    // [M-20261125-064] the eye colour left the screen (the pointer switch moved to the gear, clicked below)
    expect(html).not.toContain("data-shape-eye-color");
    expect(render(shapeLook())).toMatch(/aria-checked="true"[^>]*data-option="neutral"/);
  });

  it("no state to look at: the six states follow the bot's activity", () => {
    // [D-20261125-019] [M-20261125-064] the States tab and its six previews left the screen; nothing here sets or previews a state
    const html = render(shapeLook({ mood: "happy" }));
    expect(html).not.toContain("data-agent-state-preview");
    // a thumbnail is the mascot at rest, never one of the other states
    expect(new Set([...html.matchAll(/data-agent-state="([a-z]+)"/g)].map((match) => match[1]))).toEqual(new Set(["idle"]));
    expect(html).not.toMatch(/At rest|Thinking|Working|Waiting for you|Blocked/);
  });

  it("reads in French", () => {
    setLocale("fr");
    const html = render(shapeLook({ material: "fluffy" }));
    // [M-20261125-064] the names are on the icons (accessible name and tooltip), no longer tab titles; the state names are gone with the States tab
    for (const word of ['aria-label="Matière"', 'aria-label="Humeur"', 'aria-label="Unie"', 'title="Peluche"', 'aria-label="Verre"', 'aria-label="Neutre"', 'title="Joyeuse"', 'aria-label="Réglages"']) expect(html, word).toContain(word);
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="Peluche"/);
    expect(html).not.toMatch(/[–—]/);
  });
});

describe("each setting saves on the bot's look and reads back", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let bot: Bot;
  let patches: PickerPatch[];

  const mount = async (look: MascotLook) => {
    bot = makeBot(look);
    patches = [];
    const draw = () => root.render(createElement(MascotPicker, { bot, onPatch: (patch: PickerPatch) => {
      patches.push(patch);
      // the store applies the patch and the picker reads the bot back
      bot = { ...bot, ...patch } as Bot;
      draw();
    } }));
    await act(async () => draw());
  };
  // the gear's panel and the skins list are drawn through a portal: looked up in the document
  const click = async (selector: string) => {
    const node = document.querySelector<HTMLElement>(selector);
    expect(node, selector).not.toBeNull();
    await act(async () => node!.click());
  };
  const material = (id: string) => `[data-mascot-material] [data-option="${id}"]`;
  const mood = (id: string) => `[data-mascot-mood] [data-option="${id}"]`;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("the material", async () => {
    await mount(shapeLook({ skins: { shape: "gold" } }));
    await click(material("fluffy"));
    expect(patches.at(-1)?.mascotLook).toMatchObject({ character: "shape", shape: "cup", material: "fluffy", skins: { shape: "gold" } });
    expect(engineLookOf(bot.mascotLook).material).toBe("fluffy");
    expect(host.querySelector(material("fluffy"))?.getAttribute("aria-checked")).toBe("true");
    await click(material("glass"));
    expect(engineLookOf(bot.mascotLook).material).toBe("glass");
    // Flat again: the key is gone, the skin was kept all along
    await click(material("flat"));
    expect(bot.mascotLook).not.toHaveProperty("material");
    expect(bot.mascotLook?.skins?.shape).toBe("gold");
  });

  it("the skin stays offered while a material is painted in its place, none worn, and a skin picked brings Flat back", async () => {
    // [D-20261125-029] the Skin tab used to hide under Fluffy and Glass; the skins are now the pill's last segment, always there
    await mount(shapeLook({ material: "fluffy", skins: { shape: "gold" } }));
    expect(host.querySelector("[data-mascot-skins-open]")).not.toBeNull();
    expect(host.querySelector("[data-mascot-skins-open]")?.hasAttribute("data-on")).toBe(false);
    await click("[data-mascot-skins-open]");
    // the engine paints the material in place of the skin: no card reads as worn
    expect(document.querySelectorAll('[data-mascot-skins] [aria-checked="true"]').length).toBe(0);
    await click('[data-mascot-skins] [data-skin-option="plain"]');
    expect(bot.mascotLook).not.toHaveProperty("material");
    expect(host.querySelector(material("flat"))?.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector('[data-mascot-skins] [data-skin-option="plain"]')?.getAttribute("aria-checked")).toBe("true");
    // back on Flat with a skin that is not Clay: the segment reads as chosen beside Flat
    await click('[data-mascot-skins] [data-skin-option="pastel"]');
    expect(host.querySelector("[data-mascot-skins-open]")?.hasAttribute("data-on")).toBe(true);
  });

  it("a device that cannot paint a material draws the bot flat, with its skin worn", async () => {
    support.materials = false;
    await mount(shapeLook({ material: "fluffy", skins: { shape: "gold" } }));
    await click("[data-mascot-skins-open]");
    expect(document.querySelector('[data-mascot-skins] [data-skin-option="gold"]')?.getAttribute("aria-checked")).toBe("true");
  });

  it("the volume and the eye colour a bot already stores are kept through every pick", async () => {
    // [M-20261125-064] neither is set here any more: "leurs valeurs déjà enregistrées continuent d'être dessinées ; aucune donnée n'est effacée"
    await mount(shapeLook({ depth: 11, eyeColor: "#ffffff" }));
    expect(host.querySelector('input[type="range"]')).toBeNull();
    expect(host.querySelector("[data-shape-eye-color]")).toBeNull();
    await click(material("glass"));
    await click(mood("happy"));
    await click('[data-character-shape="star"]');
    await click('[data-mascot-color="red"]');
    await click("[data-mascot-picker-gear]");
    await click('[data-mascot-follow-pointer] [role="switch"]');
    expect(bot.mascotLook).toMatchObject({ character: "shape", shape: "star", material: "glass", mood: "happy", followPointer: false, depth: 11, eyeColor: "#ffffff" });
    expect(engineLookOf(bot.mascotLook)).toMatchObject({ depth: 11, eyeColor: "#ffffff" });
  });

  it("the mood, the pointer and the motion", async () => {
    await mount(shapeLook());
    await click(mood("happy"));
    expect(bot.mascotLook?.mood).toBe("happy");
    expect(host.querySelector(mood("happy"))?.getAttribute("aria-checked")).toBe("true");
    await click(mood("neutral"));
    expect(bot.mascotLook).not.toHaveProperty("mood");
    // [M-20261125-064] the pointer switch lives under the gear, with the motion (System, Reduced, Full)
    await click("[data-mascot-picker-gear]");
    const pointer = '[data-mascot-follow-pointer] [role="switch"]';
    expect(document.querySelector(pointer)?.getAttribute("aria-checked")).toBe("true");
    await click(pointer);
    expect(bot.mascotLook?.followPointer).toBe(false);
    expect(document.querySelector(pointer)?.getAttribute("aria-checked")).toBe("false");
    await click(pointer);
    expect(bot.mascotLook).not.toHaveProperty("followPointer");
    expect([...document.querySelectorAll("[data-mascot-motion-option]")].map((node) => node.getAttribute("data-mascot-motion-option"))).toEqual(["system", "reduced", "full"]);
    await click('[data-mascot-motion-option="reduced"]');
    expect(engineLookOf(bot.mascotLook).motion).toBe("reduced");
    await click('[data-mascot-motion-option="full"]');
    expect(engineLookOf(bot.mascotLook).motion).toBe("full");
    await click('[data-mascot-motion-option="system"]');
    expect(bot.mascotLook).not.toHaveProperty("motion");
    // every setting back to its default: exactly the look it started with
    expect(bot.mascotLook).toEqual({ character: "shape", style: "2d", shape: "cup", skins: expect.any(Object) });
  });

  it("the gear's panel reads in French", async () => {
    setLocale("fr");
    await mount(shapeLook());
    await click("[data-mascot-picker-gear]");
    const panel = document.querySelector('[data-mascot-picker-layer="gear"]')!;
    for (const word of ["Réglages", "Les yeux suivent le pointeur", "Mouvement", "Système", "Réduit", "Complet"]) expect(panel.textContent, word).toContain(word);
    expect(panel.textContent).not.toMatch(/[–—]/);
  });

  // [M-20261125-064] [D-20261125-019] "a state is shown on the preview and never saved" is not ported:
  // the States tab left the screen and the picker has no preview; the states follow the bot's activity
  // (agentStateForBot, covered by src/lib/mascot.test.ts).
});
