// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadAllBakedStills } from "../shape-stills";
import { resetAchievementsForTests } from "@/lib/achievements";
import { botMascotLook } from "../../../shared/mascot-look";
import MascotPicker from "./MascotPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => loadAllBakedStills());

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

/** The picker's skins list on a Shape wearing Circuit (Epic), Neon earned, Chrome and Crystal still locked (#4584). */
function open(patches: unknown[]) {
  resetAchievementsForTests({ unlocks: { enforced: true, keys: new Set(["skin:shape:neon"]) } });
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(MascotPicker, {
        bot: { color: "blue" as never, mascotSkin: "none" as never, mascotLook: botMascotLook({ character: "shape", skins: { shape: "circuit" } }) },
        onPatch: (patch: unknown) => void patches.push(patch),
        initialLayer: "skins",
      }),
    );
  });
  // the list is a small panel of the picker, drawn through a portal
  const card = (skin: string) => document.querySelector<HTMLButtonElement>(`[data-mascot-skins] [data-skin-option="${skin}"]`)!;
  const click = (skin: string) => act(() => card(skin).click());
  const previewed = () => document.querySelector("[data-mascot-skin-preview]");
  return { card, click, previewed };
}

describe("a locked skin in the skins list", () => {
  it("is never worn nor saved, and an unlocked one right after is picked and saves", () => {
    // [M-20261125-063] "faut pas avoir de visualisateur": the editor's stage previewed a locked skin on a click;
    // the picker has no stage, so a locked skin shows what unlocks it and a click on it does nothing
    const patches: unknown[] = [];
    const { card, click, previewed } = open(patches);
    expect(card("chrome").dataset.locked).toBeDefined();
    expect(card("neon").dataset.locked).toBeUndefined();
    expect(card("chrome").querySelector("[data-skin-unlock-hint]")?.textContent).toBeTruthy();
    click("chrome");
    expect(previewed()).toBeNull();
    click("crystal");
    expect(previewed()).toBeNull();
    expect(patches).toEqual([]);
    expect(card("circuit").getAttribute("aria-checked")).toBe("true");
    click("neon");
    // the unlocked one was selected, and nothing wears the locked skin
    expect(previewed()).toBeNull();
    expect(patches).toHaveLength(1);
    expect(JSON.stringify(patches[0])).toContain('"shape":"neon"');
  });
});
