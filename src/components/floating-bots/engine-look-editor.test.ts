// #5349: the bot editor's Material, Face and States tabs. The settings show
// only for the mascots the open-bot-avatar engine draws (the shapes); each
// one saves on the bot's look and reads back; a default leaves the look as
// it was stored; a state is previewed, never saved.
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installHappyWindow } from "@/testing/happy-window";
import { AGENT_STATES } from "@/lib/mascot";
import { setLocale, t } from "@/lib/i18n";
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
const { default: MascotLookEditor, AGENT_STATE_LABEL, editorTabsFor, EYE_COLORS } = await import("./MascotLookEditor");
type EditorTab = import("./MascotLookEditor").EditorTab;
type MascotLookPatch = import("./MascotLookEditor").MascotLookPatch;
const { MASCOTS } = await import("./mascots");

const shapeLook = (extra: Partial<MascotLook> = {}): MascotLook => ({ character: "shape", shape: "cup", ...extra }) as MascotLook;
function makeBot(look: MascotLook | undefined, overrides: Partial<Bot> = {}): Bot {
  return { id: "bot-1", threadId: "thread-1", name: "Nimbus", title: "", description: "", notifications: false, color: "blue", unread: false, modelSelection: { instanceId: "local", model: "test-model" }, messages: [], mascotLook: look, ...overrides } as Bot;
}
const render = (look: MascotLook | undefined, tab: EditorTab) => renderToStaticMarkup(createElement(MascotLookEditor, { bot: makeBot(look), onPatch: vi.fn(), initialTab: tab }));
const tabsOf = (html: string) => [...html.matchAll(/data-appearance-tab="([a-z]+)"/g)].map((match) => match[1]);

beforeEach(() => {
  support.materials = true;
  setLocale("en");
  resetAchievementsForTests({ unlocks: NOTHING_LOCKED });
});
afterEach(() => resetAchievementsForTests());
afterAll(() => closeWindow());

describe("which mascots get the engine's settings", () => {
  it("shows Material, Face and States for the shapes only: hidden for every other character, never greyed", () => {
    for (const character of MASCOT_CHARACTERS) {
      const option = MASCOTS.find((entry) => entry.id === character)!;
      const tabs = editorTabsFor(option, { material: "flat", skin: "plain", materials: true });
      for (const tab of ["material", "face", "states"] as const) expect(tabs.includes(tab), `${character} ${tab}`).toBe(character === "shape");
    }
    expect(tabsOf(render(undefined, "mascot"))).toEqual(["mascot", "color", "skin"]);
    expect(tabsOf(render({ character: "bunbu" } as MascotLook, "mascot"))).toEqual(["mascot", "color", "skin"]);
    const shape = render(shapeLook(), "mascot");
    expect(tabsOf(shape)).toEqual(["mascot", "shape", "color", "skin", "material", "face", "states"]);
    expect(shape).not.toMatch(/data-appearance-tab="(material|face|states)"[^>]*disabled/);
  });

  it("hides Skin while the engine paints a material in its place, and brings it back with Flat", () => {
    const shape = MASCOTS.find((entry) => entry.id === "shape")!;
    expect(editorTabsFor(shape, { material: "fluffy", skin: "gold", materials: true })).not.toContain("skin");
    expect(editorTabsFor(shape, { material: "glass", skin: "gold", materials: true })).not.toContain("skin");
    expect(editorTabsFor(shape, { material: "flat", skin: "gold", materials: true })).toContain("skin");
    // a device that cannot paint a material draws the bot flat, with its skin
    expect(editorTabsFor(shape, { material: "fluffy", skin: "gold", materials: false })).toContain("skin");
    expect(tabsOf(render(shapeLook({ material: "fluffy" }), "material"))).toEqual(["mascot", "shape", "color", "material", "face", "states"]);
  });

  it("offers no material where the device cannot paint one, and no Material tab when the flat Outline leaves it nothing", () => {
    const shape = MASCOTS.find((entry) => entry.id === "shape")!;
    support.materials = false;
    const html = render(shapeLook(), "material");
    expect(html).not.toContain("data-shape-material-option");
    expect(html).toContain("data-shape-depth");
    expect(editorTabsFor(shape, { material: "flat", skin: "outline", materials: false })).not.toContain("material");
    expect(editorTabsFor(shape, { material: "flat", skin: "outline", materials: true })).toContain("material");
    // under the Outline skin the body is flat on purpose: no volume to set
    support.materials = true;
    const outline = render(shapeLook({ skins: { shape: "outline" } }), "material");
    expect(outline).toContain("data-shape-material-option");
    expect(outline).not.toContain("data-shape-depth");
  });
});

describe("what each tab shows", () => {
  it("Material: the engine's three materials, the current one checked, and the volume", () => {
    const html = render(shapeLook({ material: "glass", depth: 9 }), "material");
    expect([...html.matchAll(/data-shape-material-option="([a-z]+)"/g)].map((match) => match[1])).toEqual([...SHAPE_MATERIALS]);
    expect(html).toMatch(/aria-checked="true"[^>]*data-shape-material-option="glass"/);
    expect(html).toContain("data-material-note");
    expect(html).toMatch(/type="range"[^>]*min="0"[^>]*max="14"[^>]*value="9"/);
    const flat = render(shapeLook(), "material");
    expect(flat).toMatch(/aria-checked="true"[^>]*data-shape-material-option="flat"/);
    expect(flat).not.toContain("data-material-note");
    expect(flat).toMatch(/type="range"[^>]*value="6"/);
  });

  it("Face: the two moods, the eye colours with Default first, and the pointer switch", () => {
    const html = render(shapeLook({ mood: "happy", eyeColor: "#ffffff", followPointer: false }), "face");
    expect(html).toMatch(/aria-checked="true"[^>]*data-shape-mood-option="happy"/);
    expect(html).toMatch(/aria-checked="false"[^>]*data-shape-mood-option="neutral"/);
    expect([...html.matchAll(/data-shape-eye-color="([^"]+)"/g)].map((match) => match[1])).toEqual(["default", ...EYE_COLORS]);
    expect(html).toMatch(/aria-checked="true"[^>]*data-shape-eye-color="#ffffff"/);
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"/);
    const plain = render(shapeLook(), "face");
    expect(plain).toMatch(/aria-checked="true"[^>]*data-shape-eye-color="default"/);
    expect(plain).toMatch(/role="switch"[^>]*aria-checked="true"/);
  });

  it("States: the six states to look at, each named, each on the bot's own mascot, with the line that says they follow the bot", () => {
    const html = render(shapeLook({ mood: "happy" }), "states");
    expect([...html.matchAll(/data-agent-state-preview="([a-z]+)"/g)].map((match) => match[1])).toEqual([...AGENT_STATES]);
    for (const state of AGENT_STATES) {
      expect(html).toContain(`>${t(AGENT_STATE_LABEL[state])}<`);
      expect(html).toMatch(new RegExp(`data-agent-state-preview="${state}"[\\s\\S]*?data-agent-state="${state}"`));
    }
    expect(html).toContain(t("appearance.states.note"));
    // a preview is a pressed button, never a radio that would read as a saved choice
    expect(html).not.toMatch(/role="radio"[^>]*data-agent-state-preview/);
    expect(html).toMatch(/aria-pressed="false"[^>]*data-agent-state-preview="idle"/);
  });

  it("reads in French", () => {
    setLocale("fr");
    const html = render(shapeLook(), "states");
    for (const word of ["Matière", "Visage", "États", "Au repos", "Réfléchit", "Travaille", "T&#x27;attend", "Bloqué", "Terminé", "Automatique"]) expect(html, word).toContain(word);
    expect(render(shapeLook({ material: "fluffy" }), "material")).toContain("Peluche");
    expect(html).not.toMatch(/[–—]/);
  });
});

describe("each setting saves on the bot's look and reads back", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let bot: Bot;
  let patches: MascotLookPatch[];

  const mount = async (look: MascotLook, tab: EditorTab) => {
    bot = makeBot(look);
    patches = [];
    const draw = () => root.render(createElement(MascotLookEditor, { key: tab, bot, initialTab: tab, onPatch: (patch: MascotLookPatch) => {
      patches.push(patch);
      // the store applies the patch and the editor reads the bot back
      bot = { ...bot, ...patch } as Bot;
      draw();
    } }));
    await act(async () => draw());
  };
  const click = async (selector: string) => {
    const node = host.querySelector<HTMLElement>(selector);
    expect(node, selector).not.toBeNull();
    await act(async () => node!.click());
  };

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
    await mount(shapeLook({ skins: { shape: "gold" } }), "material");
    await click('[data-shape-material-option="fluffy"]');
    expect(patches.at(-1)?.mascotLook).toMatchObject({ character: "shape", shape: "cup", material: "fluffy", skins: { shape: "gold" } });
    expect(engineLookOf(bot.mascotLook).material).toBe("fluffy");
    expect(host.querySelector('[data-shape-material-option="fluffy"]')?.getAttribute("aria-checked")).toBe("true");
    await click('[data-shape-material-option="glass"]');
    expect(engineLookOf(bot.mascotLook).material).toBe("glass");
    // Flat again: the key is gone, the skin was kept all along
    await click('[data-shape-material-option="flat"]');
    expect(bot.mascotLook).not.toHaveProperty("material");
    expect(bot.mascotLook?.skins?.shape).toBe("gold");
  });

  it("the volume", async () => {
    await mount(shapeLook(), "material");
    const slider = host.querySelector<HTMLInputElement>('[data-shape-depth] input[type="range"]')!;
    const set = async (value: string) => {
      // React reads the native value setter
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(host.querySelector('[data-shape-depth] input[type="range"]'), value);
      await act(async () => host.querySelector('[data-shape-depth] input[type="range"]')!.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event));
    };
    expect(slider.value).toBe("6");
    await set("11");
    expect(bot.mascotLook?.depth).toBe(11);
    await set("0");
    expect(bot.mascotLook?.depth).toBe(0);
    // back on the engine's natural depth: the look is as it was stored before
    await set("6");
    expect(bot.mascotLook).not.toHaveProperty("depth");
  });

  it("the mood, the eye colour and the pointer", async () => {
    await mount(shapeLook(), "face");
    await click('[data-shape-mood-option="happy"]');
    expect(bot.mascotLook?.mood).toBe("happy");
    await click('[data-shape-mood-option="neutral"]');
    expect(bot.mascotLook).not.toHaveProperty("mood");
    await click(`[data-shape-eye-color="${EYE_COLORS[1]}"]`);
    expect(bot.mascotLook?.eyeColor).toBe(EYE_COLORS[1]);
    expect(host.querySelector(`[data-shape-eye-color="${EYE_COLORS[1]}"]`)?.getAttribute("aria-checked")).toBe("true");
    await click('[data-shape-eye-color="default"]');
    expect(bot.mascotLook).not.toHaveProperty("eyeColor");
    await click('[data-shape-follow-pointer] [role="switch"]');
    expect(bot.mascotLook?.followPointer).toBe(false);
    await click('[data-shape-follow-pointer] [role="switch"]');
    expect(bot.mascotLook).not.toHaveProperty("followPointer");
    // every setting back to its default: exactly the look it started with
    expect(bot.mascotLook).toEqual({ character: "shape", style: "2d", shape: "cup", skins: expect.any(Object) });
  });

  it("a state is shown on the preview and never saved", async () => {
    await mount(shapeLook(), "states");
    const stage = () => host.querySelector("[data-mascot-stage] [data-agent-state]")?.getAttribute("data-agent-state");
    expect(stage()).toBe("idle");
    for (const state of AGENT_STATES) {
      await click(`[data-agent-state-preview="${state}"]`);
      expect(stage(), state).toBe(state);
      expect(host.querySelector(`[data-agent-state-preview="${state}"]`)?.getAttribute("aria-pressed")).toBe("true");
    }
    // a second click lets go of it
    await click('[data-agent-state-preview="done"]');
    expect(stage()).toBe("idle");
    expect(patches).toEqual([]);
    expect(bot.mascotLook).toEqual({ character: "shape", shape: "cup" });
  });
});
