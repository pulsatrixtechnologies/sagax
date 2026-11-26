// The mascot picker's "+" takes a pasted open-bot-avatar definition as the bot's shape (#4160, #5369).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadAllBakedStills } from "../shape-stills";
import { NOTHING_LOCKED } from "../../../shared/achievements";
import { resetAchievementsForTests } from "@/lib/achievements";
import { botMascotLook, completeMascotLook } from "../../../shared/mascot-look";
import { setLocale, t } from "@/lib/i18n";
import { ENGINE_AVATAR_REASONS } from "../../../shared/engine-avatar-def";
import MascotPicker, { PASTE_REASON_LABEL } from "./MascotPicker";
import { pastedShapeLook } from "./mascot-picker";

beforeAll(() => loadAllBakedStills());
beforeEach(() => resetAchievementsForTests({ unlocks: NOTHING_LOCKED }));
afterEach(() => setLocale("en"));

const kite = {
  version: 1,
  id: "kite",
  name: "Kite",
  body: { path: "M50 10L86 50L50 90L14 50Z" },
  eyes: { x: 50, y: 48, spacing: 14, scale: 1 },
};

const shapeTab = (mascotLook: unknown, initialLayer?: "add") =>
  renderToStaticMarkup(
    createElement(MascotPicker, {
      bot: { color: "blue" as never, mascotSkin: "none" as never, mascotLook: botMascotLook(mascotLook) },
      onPatch: () => undefined,
      initialTab: "shapes",
      initialLayer,
    }),
  );

describe("pastedShapeLook", () => {
  it("stores a valid pasted definition on the bot's look, its shape kept for the platforms that cannot draw it yet", () => {
    const look = completeMascotLook({ character: "shape", shape: "star" });
    const result = pastedShapeLook(look, JSON.stringify(kite));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mascotLook.shape).toBe("star");
    expect(result.mascotLook.avatarDef).toMatchObject({ version: 1, id: "kite", name: "Kite" });
    // what is stored is what the server accepts
    expect(botMascotLook(JSON.parse(JSON.stringify(result.mascotLook))).avatarDef).toMatchObject({ id: "kite" });
  });

  it("refuses a definition the engine refuses and says why, as reasons a person reads", () => {
    const look = completeMascotLook({ character: "shape" });
    const result = pastedShapeLook(look, JSON.stringify({ ...kite, eyes: { ...kite.eyes, scale: 9 } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons).toContain("eyesSize");
  });

  it("says each reason in the person's language, never the engine's English text", () => {
    setLocale("fr");
    for (const reason of ENGINE_AVATAR_REASONS) {
      const fr = t(PASTE_REASON_LABEL[reason]);
      expect(fr).not.toBe(PASTE_REASON_LABEL[reason]);
      expect(fr).not.toMatch(/out of range|\d+\.\.\d+|must be/);
    }
    expect(t(PASTE_REASON_LABEL.eyesSize)).toContain("yeux");
  });
});

describe("the Shapes tab", () => {
  it("has one entry to add a shape, the circled plus at the end of the grid; a definition still arrives as the bot's mascotLook", () => {
    // [M-20261125-065] "Le Generate et Import peuvent être remplacés par le [+]": the owner had the paste button under
    // the grid removed on 2026-11-17 (no data-shape-paste, no field under the grid: both still hold); the "+" is the entry now
    const html = shapeTab({ character: "shape", shape: "star" });
    expect(html).not.toContain("data-shape-paste");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("data-own-shape");
    expect(html.match(/data-mascot-add-open=""/g)).toHaveLength(1);
    expect(html.lastIndexOf("data-mascot-add-open")).toBeGreaterThan(html.lastIndexOf("data-character-shape="));
    expect(html).toMatch(/data-character-shape="star"[^>]*aria-pressed="true"/);
    // its small panel: the import (a field for the definition, a file), and no Generate while no model is wired to it
    const open = shapeTab({ character: "shape", shape: "star" }, "add");
    expect(open).toMatch(/data-mascot-add-import=""[\s\S]*<textarea[\s\S]*data-mascot-import=""/);
    expect(open).toContain('type="file"');
    expect(open).not.toContain("data-mascot-add-generate");
  });

  it("shows the pasted shape as the chosen one, by its name, and no catalog shape as chosen", () => {
    const html = shapeTab({ character: "shape", shape: "star", avatarDef: kite });
    expect(html).toContain("data-own-shape=\"\"");
    expect(html).toMatch(/data-own-shape=""[^>]*aria-pressed="true"/);
    expect(html).not.toMatch(/data-character-shape="[a-z-]+"[^>]*aria-pressed="true"/);
    // [M-20261125-064] no text in the grid: the name is the tile's accessible name and its tooltip (it was a caption)
    expect(html).toMatch(/data-own-shape=""[^>]*aria-label="Kite, your own shape"[^>]*title="Kite"/);
    // it sits after the catalog shapes, before the plus
    expect(html.indexOf("data-own-shape")).toBeGreaterThan(html.lastIndexOf("data-character-shape="));
    expect(html.indexOf("data-own-shape")).toBeLessThan(html.indexOf("data-mascot-add-open"));
  });
});
