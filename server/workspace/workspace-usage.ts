// When each workspace file last reached the bot: injected into a turn's
// system prompt (SOUL.md, RULES.md, MEMORY.md) or read and written through
// the workspace tools (workspace_read, docs_update, rules_update). The
// Files list shows it and marks a file nobody used for 30 days.
//
// A small sidecar per bot at DATA_DIR/workspace-usage/<botId>.json, outside
// the workspace on purpose (like the memory journal): the bot's file tools
// point at the workspace, and usage is the app's record, not the bot's.
// Reads of a file through the bot's own file tools are not seen here; the
// Files list says "on demand" for those files and shows the last use known.
//
// Writes are batched: a turn marks a few paths, and the file is written a
// moment later, off the dispatch path. flushWorkspaceUsage writes at once.
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { DATA_DIR } from "../config.ts";

export const USAGE_DIR = join(DATA_DIR, "workspace-usage");
const BOT_ID = /^[\w-]{1,128}$/;
const MAX_PATHS = 2_000;
const FLUSH_DELAY_MS = 1_500;

const cache = new Map<string, Record<string, number>>();
const dirty = new Set<string>();
let timer: NodeJS.Timeout | null = null;

function usageFile(botId: string): string {
  return join(USAGE_DIR, `${botId}.json`);
}

function load(botId: string): Record<string, number> {
  const known = cache.get(botId);
  if (known) return known;
  let paths: Record<string, number> = {};
  try {
    const parsed = JSON.parse(readFileSync(usageFile(botId), "utf8")) as { paths?: unknown };
    if (parsed && typeof parsed.paths === "object" && parsed.paths !== null) {
      paths = Object.fromEntries(Object.entries(parsed.paths as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
    }
  } catch {
    // missing or unreadable: nothing known yet
  }
  cache.set(botId, paths);
  return paths;
}

/** The last use of each path this bot's workspace has a record of. */
export function workspaceUsage(botId: string): Readonly<Record<string, number>> {
  if (!BOT_ID.test(botId)) return {};
  return { ...load(botId) };
}

/** Record that `paths` reached the bot now. Never throws: usage is a
 * convenience, and a turn must not fail because it could not be noted. */
export function markWorkspaceUse(botId: string, paths: readonly string[], at = Date.now()): void {
  if (!BOT_ID.test(botId) || !paths.length) return;
  try {
    const record = load(botId);
    for (const path of paths) if (path) record[path] = at;
    const keys = Object.keys(record);
    if (keys.length > MAX_PATHS) {
      for (const key of keys.sort((a, b) => record[a]! - record[b]!).slice(0, keys.length - MAX_PATHS)) delete record[key];
    }
    dirty.add(botId);
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        flushWorkspaceUsage();
      }, FLUSH_DELAY_MS);
      timer.unref?.();
    }
  } catch (error) {
    console.warn(`[workspace-usage] could not note use for ${botId}: ${(error as Error).message}`);
  }
}

/** Write every pending record now (tests, shutdown). */
export function flushWorkspaceUsage(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const pending = Array.from(dirty);
  dirty.clear();
  for (const botId of pending) {
    try {
      mkdirSync(USAGE_DIR, { recursive: true, mode: 0o700 });
      writeFileAtomic(usageFile(botId), JSON.stringify({ version: 1, paths: cache.get(botId) ?? {} }), { mode: 0o600 });
    } catch (error) {
      console.warn(`[workspace-usage] could not save usage for ${botId}: ${(error as Error).message}`);
    }
  }
}

/** A deleted bot's record. */
export function forgetWorkspaceUsage(botId: string): void {
  if (!BOT_ID.test(botId)) return;
  cache.delete(botId);
  dirty.delete(botId);
  try {
    rmSync(usageFile(botId), { force: true });
  } catch {}
}

/** Test seam: drop the in-memory cache without writing. */
export function resetWorkspaceUsageCache(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  cache.clear();
  dirty.clear();
}

/** The workspace paths a built system prompt carried, by section id: what
 * the dispatch paths mark after building a turn's prompt. */
export function promptSectionPaths(sections: ReadonlyArray<{ id: string; text: string }>): string[] {
  const paths: string[] = [];
  for (const section of sections) {
    if (!section.text) continue;
    if (section.id === "soul") paths.push("SOUL.md");
    // each rule set's block names its file (server/rule-sets.ts)
    else if (section.id === "rules") {
      const files = [...section.text.matchAll(/^--- BEGIN RULES(?: "(?:[^"\\]|\\.)*")? \(((?:RULES\.md|rules\/[^/,\s]+\.md)), \d+ bytes\) ---$/gm)].map((match) => match[1]!);
      paths.push(...(files.length ? files : ["RULES.md"]));
    }
    // the memory block carries MEMORY.md's text only when it has some
    else if (section.id === "memory" && section.text.includes("Your memory (MEMORY.md):")) paths.push("MEMORY.md");
  }
  return paths;
}
