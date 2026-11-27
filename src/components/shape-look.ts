// How a shape mascot's look paints its body: the shape and skin it draws,
// the body's colour and the eyes' ink, the depth, which still it starts from
// and the pose it holds at rest. These are ShapeMascot's own rules
// (ShapeMascot.tsx, the top of the component), written once here for any
// drawing that paints a bot's shape outside ShapeMascot (the Heavy row's
// cell division, HeavyDivision.tsx); shape-look.test.ts holds the two
// together, so they never drift apart.
import { isHexColor, mascotHex } from "@/lib/mascot";
import { DEFAULT_ENGINE_LOOK, MASCOT_SHAPES, SHAPE_DEPTH, SHAPE_SKINS, type EngineLook, type MascotAvatarDef, type MascotShape, type ShapeSkin } from "../../shared/mascot-look";
import { bakedShapeFor, enginePose, type EnginePose, type ShapeMood } from "./shape-avatar";
import { shapeSkinPaint } from "./ShapeMascot";

/** The eyes' ink when neither the person nor the skin gives one (a material's eyes). */
export const FALLBACK_INK = "#151515";

export interface ShapeLookInput {
  shape: MascotShape;
  skin: ShapeSkin;
  /** A bot colour name or any hex. */
  color: string;
  engineLook?: Partial<EngineLook> | undefined;
  avatarDef?: MascotAvatarDef | undefined;
  /** Whether the look's material paints (shape-material.tsx useShapeMaterial): the engine's finish, in place of the skin. */
  material: boolean;
  mood?: ShapeMood;
  agentState?: EnginePose["state"];
}

export interface ShapeLook {
  shape: MascotShape;
  skin: ShapeSkin;
  settings: EngineLook;
  /** The bot's colour as #rrggbb. */
  hex: string;
  paint: ReturnType<typeof shapeSkinPaint>;
  /** The body's fill (lower case): the skin's own fill, or the bot's colour under a material. */
  body: string;
  /** The eyes' ink (lower case): the person's choice, else the skin's. */
  ink: string;
  /** The depth the person chose (none: the engine's natural one). */
  chosenDepth: number | undefined;
  /** The depth the body is drawn at: the Outline skin is flat on purpose. */
  depth: number | undefined;
  /** The catalog shape whose baked still the body is; none when it is inferred at run time. */
  bakedId: MascotShape | null;
  pose: EnginePose;
}

export function shapeLook({ shape, skin, color, engineLook, avatarDef, material, mood = "idle", agentState = "idle" }: ShapeLookInput): ShapeLook {
  const known: MascotShape = MASCOT_SHAPES.includes(shape) ? shape : "circle";
  const knownSkin: ShapeSkin = SHAPE_SKINS.includes(skin) ? skin : "plain";
  const hex = mascotHex(color);
  const paint = shapeSkinPaint(knownSkin, hex);
  const settings: EngineLook = { ...DEFAULT_ENGINE_LOOK, ...engineLook };
  const body = (material ? hex : isHexColor(paint.fill) ? paint.fill : hex).toLowerCase();
  const ink = (isHexColor(settings.eyeColor) ? settings.eyeColor : !material && isHexColor(paint.eyes) ? paint.eyes : FALLBACK_INK).toLowerCase();
  const chosenDepth = settings.depth === null || settings.depth === SHAPE_DEPTH.natural ? undefined : Math.min(SHAPE_DEPTH.max, Math.max(SHAPE_DEPTH.min, settings.depth));
  const depth = knownSkin === "outline" && !material ? 0 : chosenDepth;
  return {
    shape: known,
    skin: knownSkin,
    settings,
    hex,
    paint,
    body,
    ink,
    chosenDepth,
    depth,
    bakedId: depth === undefined ? bakedShapeFor(known, avatarDef) : null,
    pose: enginePose(mood, agentState, settings.mood),
  };
}
