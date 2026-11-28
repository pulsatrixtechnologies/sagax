import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FAMILIES,
  manifestSchema,
  rubricFileSchema,
  type BlindPairManifest,
  type BlindPairTask,
  type Family,
  type RubricFile,
} from "./types.ts";

/** Freeze-and-verify the blind-pair grid before any assistant is called.
 * The sha256 manifest is the only gate: a mismatched or missing rubric file
 * refuses the run, so the grid cannot drift mid-sitting (#5533 / #2644). */

const HERE = dirname(fileURLToPath(import.meta.url));
export const RUBRIC_DIR = join(HERE, "rubric");

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function loadManifest(dir: string = RUBRIC_DIR): BlindPairManifest {
  return manifestSchema.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
}

export function manifestDigest(manifest: BlindPairManifest): string {
  return sha256Text(JSON.stringify(manifest));
}

/** Verifies every pinned rubric file against its sha256 and returns the
 * frozen task list. Call this before any pair send. */
export function loadFrozenTasks(
  dir: string = RUBRIC_DIR,
  families?: readonly Family[],
): { manifest: BlindPairManifest; tasks: BlindPairTask[]; rubrics: RubricFile[] } {
  const manifest = loadManifest(dir);
  const wanted = new Set(families ?? FAMILIES);
  const rubrics: RubricFile[] = [];
  const tasks: BlindPairTask[] = [];

  for (const entry of manifest.files) {
    if (!wanted.has(entry.family)) continue;
    const raw = readFileSync(join(dir, entry.file), "utf8");
    const digest = sha256Text(raw);
    if (digest !== entry.sha256) {
      throw new Error(
        "blind-pair rubric " + entry.file + " does not match its manifest checksum; "
        + "freeze a new grid (bump the manifest) instead of editing in place",
      );
    }
    const rubric = rubricFileSchema.parse(JSON.parse(raw));
    if (rubric.family !== entry.family) {
      throw new Error("rubric " + entry.file + " family " + rubric.family + " disagrees with the manifest");
    }
    if (rubric.tasks.length < 5) {
      throw new Error("family " + rubric.family + " needs at least 5 pairs; found " + rubric.tasks.length);
    }
    for (const task of rubric.tasks) {
      if (task.family !== rubric.family) {
        throw new Error("task " + task.id + " family " + task.family + " disagrees with file family " + rubric.family);
      }
    }
    rubrics.push(rubric);
    tasks.push(...rubric.tasks);
  }

  if (tasks.length === 0) {
    throw new Error("no frozen tasks matched the requested families");
  }
  return { manifest, tasks, rubrics };
}

/** Lists rubric JSON files on disk that are not pinned in the manifest.
 * Used by the integrity test so a stray file cannot sneak into a sitting. */
export function unpinnedRubricFiles(dir: string = RUBRIC_DIR): string[] {
  const manifest = loadManifest(dir);
  const pinned = new Set(manifest.files.map((entry) => entry.file));
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") && name !== "manifest.json")
    .filter((name) => !pinned.has(name))
    .sort();
}
