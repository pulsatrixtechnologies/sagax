#!/usr/bin/env node
/**
 * Developer tool (not in the app UX): turn a description into a portable Shape
 * definition, validate it, and write JSON + SVG for review. See
 * docs/design/shape-generator.md.
 *
 * Usage:
 *   node scripts/generate-shape.mjs "a friendly coffee mug" [--out DIR] [--name slug]
 *   node scripts/generate-shape.mjs --def path/to/def.json [--out DIR]   (validate + render a hand-made or model-made definition)
 *   --color #3b82f6   fill of the SVG (default blue)
 * Default output: artifacts/shape-gen/<slug>.json and <slug>.svg (untracked).
 * Without a model the description maps to the nearest object preset; a model
 * result can be passed through --def. No provider is called from here.
 * Needs Node 22+ (runs the shared .ts modules directly).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const direction = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && !String(all[i - 1] ?? "").startsWith("--"));
const defPath = arg("--def");
if (!direction && !defPath) {
  console.error('usage: node scripts/generate-shape.mjs "<description>" | --def file.json  [--out DIR] [--name slug] [--color #hex]');
  process.exit(2);
}

const { generateShapeAvatarDef } = await import("../shared/shape-avatar-generate.ts");
const { validateShapeAvatarDef } = await import("../shared/shape-avatar-def.ts");
const { shapeAvatarStillSvg } = await import("../shared/shape-avatar-presets.ts");

let def;
if (defPath) {
  const checked = validateShapeAvatarDef(JSON.parse(await readFile(resolve(defPath), "utf8")));
  if (!checked.ok) {
    console.error(`invalid definition: ${checked.error}`);
    process.exit(1);
  }
  def = checked.def;
} else {
  def = generateShapeAvatarDef(direction);
}

const slug = (arg("--name") ?? def.id ?? "shape").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "shape";
const outDir = resolve(arg("--out") ?? join(root, "artifacts", "shape-gen"));
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, `${slug}.json`), `${JSON.stringify(def, null, 2)}\n`);
await writeFile(join(outDir, `${slug}.svg`), shapeAvatarStillSvg(def, arg("--color") ?? "#3b82f6"));
console.log(`wrote ${join(outDir, slug)}.json and .svg (${def.name ?? def.id ?? slug})`);
console.log("next: docs/design/shape-generator.md, section Ajouter la forme au jeu");
