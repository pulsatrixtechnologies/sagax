// The mascot picker's rules (#5369), apart from its drawing (MascotPicker.tsx):
// the two tabs, the colour row (the upstream picker's eleven colours, the
// free colour and the way back), which pills and segments a character gets,
// and what each pick saves. A pick changes only what it names: every other
// key of the look (the settings that left the screen, the other characters'
// skins) stays as it was stored.
import { MAUS_COLORS, type MausColor } from "@/lib/mascot";
import { MASCOT_COLOR_NAMES } from "../../../shared/mascot-colors";
import type { MascotSkinId } from "../../../shared/mascot-skins";
import { engineLookOf, PUMPKIN_COLOR, SHAPE_MATERIALS, SHAPE_SKINS_IN_BOT_COLOR, withEngineLook, type MascotCharacter, type MascotLook, type MascotShape, type ShapeMaterial } from "../../../shared/mascot-look";
import { parseEngineAvatar, type EngineAvatarReason } from "../../../shared/engine-avatar-def";
import type { CompleteLook } from "./mascots";

export const PICKER_TABS = ["shapes", "characters"] as const;
export type PickerTab = (typeof PICKER_TABS)[number];

/** The tab a character sits under: the shapes the engine draws, or the other characters. */
export function tabOf(character: MascotCharacter): PickerTab {
  return character === "shape" ? "shapes" : "characters";
}

/** The colour row: the upstream picker's eleven (white, brown, red, orange, amber, green, teal, blue, purple, pink, gray), as bot colour names. */
export const QUICK_COLORS = ["white", "brown", "red", "orange", "amber", "green", "teal", "blue", "purple", "pink", "grey"] as const satisfies readonly MausColor[];

const HEX = /^#[0-9a-fA-F]{6}$/;
const hexOfName = (name: string): string => ((MAUS_COLORS as Record<string, string>)[name] ?? MAUS_COLORS.green).toLowerCase();

type Coloured = { color: string; mascotLook?: unknown };

/** The colour a bot's mascot is drawn in: its free colour when it has one, else its named colour. */
export function bodyColorOf(bot: Coloured): string {
  return engineLookOf(bot.mascotLook).bodyColor ?? bot.color;
}

/** What the colour row shows: the colour drawn, the quick colour it is (if one), and whether it sits on the free colour ring. */
export function pickerColor(bot: Coloured): { hex: string; quick: MausColor | null; custom: boolean } {
  const free = engineLookOf(bot.mascotLook).bodyColor;
  const quick = !free && (QUICK_COLORS as readonly string[]).includes(bot.color) ? (bot.color as MausColor) : null;
  return { hex: free ?? hexOfName(bot.color), quick, custom: quick === null };
}

/** The bot colour name closest to a hex: what the rest of the app (the banner, the accents) wears beside a free colour. */
export function nearestColorName(hex: string): MausColor {
  const rgb = (value: string) => [1, 3, 5].map((at) => Number.parseInt(value.slice(at, at + 2), 16));
  const [r, g, b] = rgb(hex);
  let best: MausColor = "green";
  let least = Infinity;
  for (const name of MASCOT_COLOR_NAMES) {
    const [nr, ng, nb] = rgb(hexOfName(name));
    const distance = (r! - nr!) ** 2 + (g! - ng!) ** 2 + (b! - nb!) ** 2;
    if (distance < least) { least = distance; best = name; }
  }
  return best;
}

export interface PickerPatch {
  color?: MausColor;
  mascotSkin?: MascotSkinId;
  mascotLook?: MascotLook;
}

/**
 * A colour picked: a bot colour name (a quick colour), any hex (the free
 * colour), or a colour to put back whole (the back arrow). A name removes the
 * free colour; a look without one is not written at all.
 */
export function colorPatch(look: CompleteLook, choice: string | { color: string; bodyColor: string | null }): PickerPatch {
  const had = look.bodyColor !== undefined;
  const named = (name: string): PickerPatch => ({ color: name as MausColor, ...(had ? { mascotLook: withEngineLook(look, { bodyColor: null }) as MascotLook } : {}) });
  if (typeof choice !== "string") {
    return choice.bodyColor ? { color: choice.color as MausColor, mascotLook: withEngineLook(look, { bodyColor: choice.bodyColor }) as MascotLook } : named(choice.color);
  }
  if (!HEX.test(choice)) return named(choice);
  const hex = choice.toLowerCase();
  const exact = MASCOT_COLOR_NAMES.find((name) => hexOfName(name) === hex);
  if (exact) return named(exact);
  return { color: nearestColorName(hex), mascotLook: withEngineLook(look, { bodyColor: hex }) as MascotLook };
}

/** What sits under the grid for the character the bot wears: an option that does not apply is absent, never greyed. */
export function pickerControls(character: MascotCharacter, device: { materials: boolean }): { materials: readonly ShapeMaterial[]; skins: boolean; mood: boolean; gear: boolean; colors: boolean } {
  const engine = character === "shape";
  return {
    // the engine's finishes, for the mascots it draws, where this device paints them
    materials: engine && device.materials ? SHAPE_MATERIALS : [],
    skins: true,
    mood: engine,
    gear: engine,
    colors: character !== "trombi",
  };
}

/** A shape picked in the grid: the bot wears that shape (a person's own drawing gives way to it); a pumpkin takes orange where the skin wears the bot's colour. */
export function shapePatch(look: CompleteLook, shape: MascotShape, color: string): PickerPatch {
  const { avatarDef: _own, ...rest } = look;
  return {
    mascotLook: { ...rest, character: "shape", shape } as MascotLook,
    ...(shape === "pumpkin" && (shape !== look.shape || look.character !== "shape") && color !== PUMPKIN_COLOR && SHAPE_SKINS_IN_BOT_COLOR.has(look.skins.shape) ? { color: PUMPKIN_COLOR as MausColor } : {}),
  };
}

/** A character picked in the grid. */
export function characterPatch(look: CompleteLook, character: MascotCharacter): PickerPatch {
  return { mascotLook: { ...look, character } as MascotLook };
}

/** A material picked on the pill (Flat brings the skin back). */
export function materialPatch(look: CompleteLook, material: ShapeMaterial): PickerPatch {
  return { mascotLook: withEngineLook(look, { material }) as MascotLook };
}

/** A skin picked in the pill's list: the owl's lives on the bot, the others on the look; on a shape it takes the material's place. */
export function skinPatch(look: CompleteLook, character: MascotCharacter, skin: string): PickerPatch {
  if (character === "owl") return { mascotSkin: skin as MascotSkinId };
  const next = { ...look, skins: { ...look.skins, [character]: skin } };
  return { mascotLook: (character === "shape" ? withEngineLook(next, { material: "flat" }) : next) as MascotLook };
}

/**
 * A definition pasted, typed, dropped or answered by a model, as the bot's
 * own shape: stored on the look when the engine accepts it (the catalog shape
 * stays under it, for a platform that cannot draw the definition yet), else
 * the reasons it is refused.
 */
export function pastedShapeLook(look: CompleteLook, text: string): { ok: true; mascotLook: MascotLook } | { ok: false; reasons: EngineAvatarReason[] } {
  const parsed = parseEngineAvatar(definitionJson(text));
  if (!parsed.ok) return { ok: false, reasons: parsed.reasons };
  return { ok: true, mascotLook: { ...look, character: "shape", avatarDef: parsed.def } as MascotLook };
}

/**
 * The JSON of a definition out of what was pasted or what a model answered:
 * the inside of a code fence, or the object between the text around it (as
 * the upstream picker's import reads a reply). Anything else is left as it is.
 */
export function definitionJson(text: string): string {
  const trimmed = text.trim();
  const fence = /```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)```/.exec(trimmed);
  if (fence) return fence[1]!.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  return first > 0 && last > first ? trimmed.slice(first, last + 1) : trimmed;
}
