// A shape in its material (Fluffy, Glass: shape-material.tsx) as one still
// image, for a drawing that places the body itself (the Heavy row's cells,
// HeavyDivision.tsx). The engine paints the still once, the way it paints
// every material still: on the one WebGL2 context the material shares
// across the page, copied into a small 2D canvas, which is read back here as
// an image and dropped. No context is added per drawing, and nothing is
// painted again for the same body, colour and size: the image is kept.
import type { AvatarDefinition, AvatarMood, AvatarState } from "open-bot-avatar";
import { mountAvatar, type CanvasMaterial } from "open-bot-avatar/dom";

/** A material still, placed in the body's 0..100 box (the canvas overhangs it by the material's reach). */
export interface MaterialStill {
  href: string;
  x: number;
  y: number;
  size: number;
}

export interface MaterialStillRequest {
  definition: AvatarDefinition;
  material: CanvasMaterial;
  color: string;
  ink: string;
  depth: number | undefined;
  state: AvatarState;
  mood: AvatarMood;
  /** How wide the body's 0..100 box is drawn, in CSS pixels. */
  px: number;
}

/** The frames a still may take before it is given up: the material stills of a page take turns, one a frame. */
const PATIENCE = 120;
const kept = new WeakMap<AvatarDefinition, Map<string, Promise<MaterialStill | null>>>();

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function paint({ definition, material, color, ink, depth, state, mood, px }: MaterialStillRequest): Promise<MaterialStill | null> {
  // laid out (a still paints only once its host has a size), out of sight and out of the way
  const host = document.createElement("span");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:0;top:0;width:${px}px;height:${px}px;opacity:0;pointer-events:none;contain:strict;transform:translateX(-300vw)`;
  document.body.append(host);
  const avatar = mountAvatar(host, { definition, material, color, eyeColor: ink, ...(depth === undefined ? {} : { depth }), state, mood, still: true, reducedMotion: true, label: "" });
  try {
    for (let frame = 0; frame < PATIENCE; frame += 1) {
      await nextFrame();
      const canvas = host.querySelector("canvas");
      // the painter sizes its canvas and paints it in the same step
      if (!canvas || canvas.width === 0) continue;
      const unit = 100 / px;
      return {
        href: canvas.toDataURL("image/png"),
        x: (Number.parseFloat(canvas.style.left) || 0) * unit,
        y: (Number.parseFloat(canvas.style.top) || 0) * unit,
        size: (Number.parseFloat(canvas.style.width) || px) * unit,
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    avatar.destroy();
    host.remove();
  }
}

/** The still of a body in its material, painted once per body, look and size; null where it cannot be painted. */
export function materialStill(request: MaterialStillRequest): Promise<MaterialStill | null> {
  if (typeof document === "undefined" || typeof requestAnimationFrame !== "function") return Promise.resolve(null);
  let byLook = kept.get(request.definition);
  if (!byLook) kept.set(request.definition, (byLook = new Map()));
  const key = [request.material.id, request.color, request.ink, request.depth ?? "", request.state, request.mood, Math.round(request.px), typeof window === "undefined" ? 1 : window.devicePixelRatio || 1].join("|");
  let pending = byLook.get(key);
  if (!pending) {
    pending = paint(request);
    byLook.set(key, pending);
    // one that could not be painted may be asked again later (a context lost, a page still loading)
    void pending.then((still) => {
      if (!still) byLook!.delete(key);
    });
  }
  return pending;
}
