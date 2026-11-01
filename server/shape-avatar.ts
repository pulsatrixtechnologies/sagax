/**
 * Bot tool surface for Shape avatar definitions. Pure generation lives in
 * shared/shape-avatar-generate.ts (desktop and server share it). This module
 * exports the agents-catalog tool and re-exports the shared runners.
 *
 * Note: server/mcp-shape.ts is the JMESPath "shape a tool result" helper; it
 * is unrelated. Shape mascot generation is this file.
 */
export {
  describeShapeAvatarDef,
  generateShapeAvatarDef,
  generateShapeAvatarDefWithModel,
  lookWithShapeAvatarDef,
  matchObjectShapePreset,
  parseShapeAvatarModelText,
  runGenerateShapeAvatar,
  runGenerateShapeAvatarAsync,
  shapeAvatarGenerationPrompt,
  SHAPE_AVATAR_DIRECTION_MAX,
  SHAPE_AVATAR_PROMPT_MARKER,
  type GenerateShapeAvatarArgs,
  type GenerateShapeAvatarResult,
  type ShapeTextEngine,
} from "../shared/shape-avatar-generate.ts";

import { SHAPE_AVATAR_DIRECTION_MAX } from "../shared/shape-avatar-generate.ts";

export const GENERATE_SHAPE_AVATAR_TOOL = {
  name: "generate_shape_avatar",
  description:
    "Build a portable Shape mascot definition (geometry JSON) from a short description and optionally apply it to this bot's look. "
    + "Use when the person asks to make a mascot that looks like an object (mug, pad, bulb, speech bubble, plant, can, book, rocket, …). "
    + "Colour stays the bot's colour. The definition is validated (no scripts, closed paths, size limits) before it is stored.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      direction: {
        type: "string",
        maxLength: SHAPE_AVATAR_DIRECTION_MAX,
        description: "What the silhouette should look like, for example \"a friendly coffee mug\".",
      },
      apply: {
        type: "boolean",
        description: "When true (default), save the definition on this bot's mascotLook. When false, only return the JSON.",
      },
      definition: {
        type: "object",
        description: "Optional ready-made definition JSON to validate and apply instead of generating from direction.",
        additionalProperties: true,
      },
    },
  },
  annotations: {
    title: "Generate a Shape mascot",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
} as const;
