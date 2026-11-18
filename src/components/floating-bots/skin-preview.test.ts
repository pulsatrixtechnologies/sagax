// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadAllBakedStills } from "../shape-stills";
import { resetAchievementsForTests } from "@/lib/achievements";
import { botMascotLook } from "../../../shared/mascot-look";
import MascotLookEditor from "./MascotLookEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => loadAllBakedStills());

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

/** The editor on a Shape wearing Circuit (Epic), Neon earned, Chrome and Crystal still locked (#4584). */
function open(patches: unknown[]) {
  resetAchievementsForTests({ unlocks: { enforced: true, keys: new Set(["skin:shape:neon"]) } });
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(MascotLookEditor, {
        bot: { color: "blue" as never, mascotSkin: "none" as never, mascotLook: botMascotLook({ character: "shape", skins: { shape: "circuit" } }) },
        onPatch: (patch: unknown) => void patches.push(patch),
        initialTab: "skin",
      }),
    );
  });
  const card = (skin: string) => host.querySelector<HTMLButtonElement>(`[data-shape-skin-option="${skin}"]`)!;
  const click = (skin: string) => act(() => card(skin).click());
  const previewed = () => host.querySelector("[data-mascot-skin-preview]");
  return { card, click, previewed };
}

describe("skin gallery preview", () => {
  it("previews a locked skin without saving, and an unlocked one right after replaces it and saves", () => {
    const patches: unknown[] = [];
    const { card, click, previewed } = open(patches);
    expect(card("chrome").dataset.locked).toBeDefined();
    expect(card("neon").dataset.locked).toBeUndefined();
    click("chrome");
    expect(previewed()).not.toBeNull();
    click("crystal");
    expect(previewed()).not.toBeNull();
    expect(patches).toEqual([]);
    click("neon");
    // the stage no longer wears the locked skin, and the unlocked one was selected
    expect(previewed()).toBeNull();
    expect(patches).toHaveLength(1);
    expect(JSON.stringify(patches[0])).toContain('"shape":"neon"');
  });
});
