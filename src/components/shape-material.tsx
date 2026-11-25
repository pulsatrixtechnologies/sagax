// The engine's materials (#5349, #5278): Fluffy and Glass are finishes the
// open-bot-avatar engine paints itself, on its own canvas with WebGL2
// (open-bot-avatar/dom, mountAvatar). A shape that wears one is mounted by
// the engine here instead of being written onto the app's SVG; Flat stays the
// app's own drawing (ShapeMascot.tsx), with its skins.
//
// - A material is loaded the first time a mascot wears it (a chunk of its
//   own), never with the page.
// - Without WebGL2 the mascot is drawn flat, by the app's drawing, and the
//   editor does not offer the materials (materialsSupported).
// - Small avatars and reduced motion mount the engine's still: one painted
//   canvas, no animation loop.
import { useEffect, useRef, useState } from "react";
import type { AvatarDefinition, AvatarMood, AvatarState } from "open-bot-avatar";
import { mountAvatar, type AvatarOptions, type CanvasMaterial, type MountedAvatar } from "open-bot-avatar/dom";
import type { ShapeMaterial } from "../../shared/mascot-look";

type CanvasMaterialName = Exclude<ShapeMaterial, "flat">;

const LOADERS: Readonly<Record<CanvasMaterialName, () => Promise<CanvasMaterial>>> = {
  fluffy: () => import("open-bot-avatar/materials/fluffy").then((module) => module.fluffy),
  glass: () => import("open-bot-avatar/materials/glass").then((module) => module.glass),
};

const loaded = new Map<CanvasMaterialName, CanvasMaterial>();
const loading = new Map<CanvasMaterialName, Promise<CanvasMaterial | null>>();

let supported: boolean | null = null;

/** Whether this page can paint a material: a canvas with WebGL2 (asked once; the probe's context is given back). */
export function materialsSupported(): boolean {
  if (supported !== null) return supported;
  supported = false;
  if (typeof document === "undefined" || typeof WebGL2RenderingContext === "undefined") return supported;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    supported = gl !== null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    supported = false;
  }
  return supported;
}

/** For tests: forget what the probe found. */
export function resetMaterialSupport(value: boolean | null = null) {
  supported = value;
}

function loadMaterial(name: CanvasMaterialName): Promise<CanvasMaterial | null> {
  let pending = loading.get(name);
  if (!pending) {
    pending = LOADERS[name]().then((material) => {
      loaded.set(name, material);
      return material;
    }, () => null);
    loading.set(name, pending);
  }
  return pending;
}

/** The engine's material for a name, once loaded; null for Flat, without WebGL2, or until it is in. */
export function useShapeMaterial(name: ShapeMaterial): CanvasMaterial | null {
  const wanted: CanvasMaterialName | null = name !== "flat" && materialsSupported() ? name : null;
  const [, ready] = useState(0);
  useEffect(() => {
    if (!wanted || loaded.has(wanted)) return;
    let alive = true;
    void loadMaterial(wanted).then(() => {
      if (alive) ready((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [wanted]);
  return wanted ? loaded.get(wanted) ?? null : null;
}

export interface ShapeCanvasProps {
  definition: AvatarDefinition;
  material: CanvasMaterial;
  color: string;
  ink: string;
  depth: number | undefined;
  state: AvatarState;
  mood: AvatarMood;
  followPointer: boolean;
  /** Off mounts the engine's still: one painted canvas, no loop. */
  live: boolean;
}

/** A shape painted by the engine in a material, in the same 84% box as the app's drawing. */
export function ShapeCanvas({ definition, material, color, ink, depth, state, mood, followPointer, live }: ShapeCanvasProps) {
  const host = useRef<HTMLSpanElement>(null);
  const avatar = useRef<MountedAvatar | null>(null);
  const options: AvatarOptions = {
    definition,
    material,
    color,
    eyeColor: ink,
    ...(depth === undefined ? {} : { depth }),
    state,
    mood,
    followPointer: live && followPointer,
    still: !live,
    // the host names the mascot
    label: "",
  };
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    if (!host.current) return;
    const mounted = mountAvatar(host.current, latest.current);
    avatar.current = mounted;
    return () => {
      mounted.destroy();
      avatar.current = null;
    };
  }, []);
  useEffect(() => {
    avatar.current?.update(latest.current);
  });
  return <span ref={host} className="block h-[84%] w-[84%]" data-shape-canvas={material.id} />;
}
