// Appearance > Shape takes a pasted open-bot-avatar definition as the bot's shape (#4160).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadAllBakedStills } from "../shape-stills";
import { NOTHING_LOCKED } from "../../../shared/achievements";
import { resetAchievementsForTests } from "@/lib/achievements";
import { botMascotLook, completeMascotLook } from "../../../shared/mascot-look";
import { setLocale, t } from "@/lib/i18n";
import { ENGINE_AVATAR_REASONS } from "../../../shared/engine-avatar-def";
import MascotLookEditor, { PASTE_REASON_LABEL, pastedShapeLook } from "./MascotLookEditor";

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

const shapeTab = (mascotLook: unknown) =>
  renderToStaticMarkup(
    createElement(MascotLookEditor, {
      bot: { color: "blue" as never, mascotSkin: "none" as never, mascotLook: botMascotLook(mascotLook) },
      onPatch: () => undefined,
      initialTab: "shape",
      hero: false,
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
    expect(t("appearance.shape.pasteInvalid", { reason: t(PASTE_REASON_LABEL.json) })).toBe("Cette définition ne peut pas servir. Ce n'est pas un objet JSON.");
  });
});

describe("the Shape tab", () => {
  it("offers to paste a definition", () => {
    const html = shapeTab({ character: "shape", shape: "star" });
    expect(html).toContain("data-shape-paste=\"\"");
    expect(html).not.toContain("data-own-shape");
    expect(html).toMatch(/data-character-shape="star"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-character-shape="star"/);
  });

  it("shows the pasted shape as the chosen one, by its name, and no catalog shape as chosen", () => {
    const html = shapeTab({ character: "shape", shape: "star", avatarDef: kite });
    expect(html).toContain("data-own-shape=\"\"");
    expect(html).toMatch(/data-own-shape=""[^>]*aria-checked="true"|aria-checked="true"[^>]*data-own-shape=""/);
    expect(html).not.toMatch(/aria-checked="true"[^>]*data-character-shape=/);
    expect(html).toContain(">Kite<");
  });
});
