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
// - At rest a material body is a painted still image (shape-material-still.ts,
//   #5414): the canvas mounts only while the mascot is live or moving.
// - The six agent states and the mood reach mountAvatar through mountPose
//   (#5539, #5540): thinking keeps the body (never three dots, #5415).
import { useEffect, useRef, useState } from "react";
import type { AvatarDefinition } from "open-bot-avatar";
import { mountAvatar, type AvatarOptions, type CanvasMaterial, type MountedAvatar } from "open-bot-avatar/dom";
import type { ShapeMaterial } from "../../shared/mascot-look";
import { AT_WORK, mountPose, type EnginePose } from "./shape-avatar";
import { materialStill, type MaterialStill } from "./shape-material-still";

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
  /** The app's engine pose (activity + mood); mountPose maps it for the engine (#5539). */
  pose: EnginePose;
  followPointer: boolean;
  /** Off mounts the engine's still: one painted canvas, no loop. */
  live: boolean;
  /** The motion the person chose for this mascot, resolved (the picker's gear, else the device's). */
  reduced: boolean;
  /** The stage's turn of the body and its held gaze (#5384, shape-stage.ts); none off a stage. */
  view?: { yaw: number; pitch: number } | undefined;
  holdGaze?: boolean | undefined;
}

/** What the engine is asked to mount for a body in a material. */
export function canvasOptions({ definition, material, color, ink, depth, pose, followPointer, live, reduced, view, holdGaze }: ShapeCanvasProps): AvatarOptions {
  const mounted = mountPose(pose);
  const follow = live && followPointer;
  // at work: the app's lean on idle (body stays); a fixed look when the pointer is not followed
  const lean = mounted.atWork
    ? { yaw: AT_WORK.yaw + (view?.yaw ?? 0), pitch: AT_WORK.pitch + (view?.pitch ?? 0) }
    : view;
  return {
    definition,
    material,
    color,
    eyeColor: ink,
    ...(depth === undefined ? {} : { depth }),
    state: mounted.state,
    mood: mounted.mood,
    followPointer: follow,
    holdGaze: Boolean(holdGaze),
    ...(lean ? { view: lean } : {}),
    ...(mounted.atWork && !follow ? { lookAt: { x: AT_WORK.gazeX, y: AT_WORK.gazeY } } : {}),
    // the person's choice, resolved by the app: the engine alone would follow the device even under Full
    reducedMotion: reduced,
    still: !live,
    // the host names the mascot
    label: "",
  };
}

/** A shape painted by the engine in a material, in the same 84% box as the app's drawing. */
export function ShapeCanvas(props: ShapeCanvasProps) {
  const host = useRef<HTMLSpanElement>(null);
  const avatar = useRef<MountedAvatar | null>(null);
  const options = canvasOptions(props);
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
    // a turn by hand: the engine keeps the view it was last given, so a mascot back at the front is told so
    avatar.current?.update(props.view ? latest.current : { ...latest.current, view: { yaw: 0, pitch: 0 } });
  });
  return <span ref={host} className="block h-[84%] w-[84%]" data-shape-canvas={props.material.id} />;
}

export interface ShapeMaterialStillProps {
  definition: AvatarDefinition;
  material: CanvasMaterial;
  color: string;
  ink: string;
  depth: number | undefined;
  pose: EnginePose;
  /** The mascot's laid-out size in CSS pixels (the body's 0..100 box is 84% of it). */
  size: number;
}

/** A material body at rest: one PNG of the engine's painting, no canvas (#5414). */
export function ShapeMaterialStill({ definition, material, color, ink, depth, pose, size }: ShapeMaterialStillProps) {
  const px = Math.ceil(size * 0.84);
  const [still, setStill] = useState<MaterialStill | null>(null);
  useEffect(() => {
    let alive = true;
    void materialStill({ definition, material, color, ink, depth, pose, px }).then((own) => {
      if (alive) setStill(own);
    });
    return () => {
      alive = false;
    };
  }, [definition, material, color, ink, depth, pose, px]);
  return (
    <span className="relative block h-[84%] w-[84%] overflow-visible" data-shape-material-still={material.id} aria-hidden="true">
      {still ? (
        <img
          src={still.href}
          alt=""
          draggable={false}
          decoding="async"
          className="pointer-events-none absolute max-w-none select-none"
          style={{ left: `${still.x}%`, top: `${still.y}%`, width: `${still.size}%`, height: `${still.size}%` }}
        />
      ) : null}
    </span>
  );
}
