// The baked stills of the shapes (#4145; scripts/bake-engine-shapes.mjs
// writes src/components/shape-stills/<id>.json): one small file per shape,
// loaded the first time a mascot of that shape shows, then kept. The page
// never infers a body's volume for a still: a sidebar of forty bots loads
// forty small files and draws them.
import { useEffect, useState } from "react";
import type { MascotShape } from "../../shared/mascot-look";
import { readStill, type BakedStill, type StillFile } from "./shape-avatar";

const FILES = import.meta.glob<StillFile>("./shape-stills/*.json", { import: "default" });

const loaded = new Map<string, BakedStill>();
const loading = new Map<string, Promise<BakedStill | null>>();

/** A shape's still when it is already loaded. */
export function bakedStill(shape: MascotShape): BakedStill | undefined {
  return loaded.get(shape);
}

/** Load a shape's still (once; every later call shares it). Null for an id with no file. */
export function loadBakedStill(shape: MascotShape): Promise<BakedStill | null> {
  const hit = loaded.get(shape);
  if (hit) return Promise.resolve(hit);
  let pending = loading.get(shape);
  if (!pending) {
    const file = FILES[`./shape-stills/${shape}.json`];
    pending = file
      ? file().then((data) => {
        const still = readStill(data);
        loaded.set(shape, still);
        return still;
      }, () => null)
      : Promise.resolve(null);
    loading.set(shape, pending);
  }
  return pending;
}

/** A shape's still, drawn as soon as its file is in (null asks for none). */
export function useBakedStill(shape: MascotShape | null): BakedStill | undefined {
  const [, ready] = useState(0);
  const still = shape ? loaded.get(shape) : undefined;
  useEffect(() => {
    if (!shape || loaded.has(shape)) return;
    let alive = true;
    void loadBakedStill(shape).then(() => {
      if (alive) ready((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [shape]);
  return still;
}

/** Every shape's still loaded (the tests' pages draw any shape at once, as a page does once it has loaded them). */
export function loadAllBakedStills(): Promise<unknown> {
  return Promise.all(Object.keys(FILES).map((path) => loadBakedStill(path.replace(/^\.\/shape-stills\/|\.json$/g, "") as MascotShape)));
}
