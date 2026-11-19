// The one colour a bot's mascot reads as: the body colour its character and
// skin paint (the catalogue's own palettes), not the bot colour alone, since
// a skin or a coat may differ from it (a white Shiba, a gold shape, a stone
// Ogre). The bot profile header uses it to keep its banner apart from the
// mascot (src/lib/profile-banner.ts). A gradient role falls back to the
// solid colour the palette carries beside it.
import { botMascotLook, completeMascotLook } from "../../shared/mascot-look";
import { botMascotSkin } from "../../shared/mascot-skins";
import { owlPalette } from "./owl/owl-art";
import { owlSkinPalette } from "./owl/owl-skins";
import { MAUS_COLORS } from "./mascot";
import { crabHexOf } from "../components/CrabMascot";
import { frogHexOf } from "../components/FrogMascot";
import { grumpHexOf } from "../components/GrumpMascot";
import { bunbuSkinBase } from "../components/skin-fx/bunbu-skins";
import { crabSkinPaint } from "../components/skin-fx/crab-skins";
import { frogSkinPaint } from "../components/skin-fx/frog-skins";
import { grumpSkinPaint } from "../components/skin-fx/grump-skins";
import { ogreSkinPaint } from "../components/skin-fx/ogre-skins";
import { shapeSkinBase } from "../components/skin-fx/shape-skins";
import { shibaSkinPaint } from "../components/skin-fx/shiba-skins";
import { trombiPaint } from "../components/skin-fx/trombi-skins";

const SOLID = /^#[0-9a-f]{6}$/i;
const UID = "dominant";

/** The first of `paints` that is a plain colour (not a url() into a gradient). */
function solid(fallback: string, ...paints: (string | undefined)[]): string {
  return paints.find((paint): paint is string => typeof paint === "string" && SOLID.test(paint)) ?? fallback;
}

const named = (color: string, fallback = MAUS_COLORS.green): string => (MAUS_COLORS as Record<string, string>)[color] ?? (SOLID.test(color) ? color : fallback);

/** The bot's mascot body colour as #rrggbb. */
export function mascotDominantColor(bot: { color: string; mascotSkin?: string | null; mascotLook?: unknown }): string {
  const look = completeMascotLook(botMascotLook(bot.mascotLook));
  const hex = named(bot.color);
  switch (look.character) {
    case "shape":
      return solid(hex, shapeSkinBase(look.skins.shape, hex).fill);
    case "bunbu":
      return solid(hex, bunbuSkinBase(look.skins.bunbu, named(bot.color, "#98DDB9")).fill);
    case "shiba": {
      const { palette } = shibaSkinPaint(look.skins.shiba, named(bot.color, MAUS_COLORS.orange), UID);
      return solid(hex, palette.coat, palette.lid);
    }
    case "grump": {
      const { palette } = grumpSkinPaint(look.skins.grump, grumpHexOf(bot.color), UID);
      return solid(hex, palette.coat, palette.lid);
    }
    case "ogre": {
      const { palette } = ogreSkinPaint(look.skins.ogre, named(bot.color), UID);
      return solid(hex, palette.skin, palette.lid);
    }
    case "frog": {
      const { palette } = frogSkinPaint(look.skins.frog, frogHexOf(bot.color), UID);
      return solid(hex, palette.skin, palette.lid);
    }
    case "crab": {
      const paint = crabSkinPaint(look.skins.crab, crabHexOf(bot.color));
      return solid(hex, paint.fill, paint.accent);
    }
    case "trombi": {
      // the paperclip is a thin wire: the note it holds is Trombi's body
      return solid("#fdf1a6", trombiPaint(look.skins.trombi, UID).paper[1]);
    }
    default:
      return solid(hex, owlSkinPalette(botMascotSkin(bot.mascotSkin), owlPalette(hex), hex).plumage);
  }
}
