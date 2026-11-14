// The open-bot-avatar engine as the phone runs it (#4159; MIT, see NOTICE):
// a person's own shape (mascotLook.avatarDef, the older portable format or a
// pasted engine definition) has no baked still, so the desktop infers its
// volume at run time (runtimeStill in src/components/shape-avatar.ts). The
// phone runs that very code: src/components/ios-mascot-export.test.ts bundles
// this file with esbuild into ios/Sources/CompanionCore/Resources/shape-engine.js,
// and ShapeEngineBake.swift calls `lookStill` in JavaScriptCore.
import { bakeStill, lookDefinition } from "../../src/components/shape-avatar.ts";
import type { MascotAvatarDef, MascotShape } from "../../shared/mascot-look.ts";

/**
 * A look's still (`StillFile` JSON) in every mood: the definition the
 * desktop draws for that shape and avatarDef (`lookDefinition`, a refused
 * definition falls back to the shape's), at its depth or flat (depth 0, the
 * Outline skin).
 */
function lookStill(shape: string, avatarDef: string, flat: boolean): string {
  const def = JSON.parse(avatarDef) as MascotAvatarDef;
  return JSON.stringify(bakeStill(lookDefinition(shape as MascotShape, def), flat ? 0 : undefined));
}

(globalThis as { lookStill?: typeof lookStill }).lookStill = lookStill;
