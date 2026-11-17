// #4525: one ArtifactData write agreement per bot, on disk so the next
// process (a routine included) can allow the write without asking again.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../../atomic.ts";
import { DATA_DIR } from "../../config.ts";

type GrantFile = { version: 1; bots: Record<string, { at: string }> };

const cache = new Map<string, GrantFile>();

function pathFor(dataDir = DATA_DIR): string {
  return join(dataDir, "artifact-data-consent.json");
}

function empty(): GrantFile {
  return { version: 1, bots: {} };
}

function load(file = pathFor()): GrantFile {
  const hit = cache.get(file);
  if (hit) return hit;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as GrantFile;
    if (parsed?.version === 1 && parsed.bots && typeof parsed.bots === "object" && !Array.isArray(parsed.bots)) {
      cache.set(file, parsed);
      return parsed;
    }
  } catch { /* missing or unreadable: no agreements yet */ }
  const fresh = empty();
  cache.set(file, fresh);
  return fresh;
}

export function hasArtifactDataWriteConsent(botId: string | undefined, dataDir = DATA_DIR): boolean {
  if (!botId) return false;
  const at = load(pathFor(dataDir)).bots[botId]?.at;
  return typeof at === "string" && at.length > 0;
}

export function rememberArtifactDataWriteConsent(botId: string | undefined, at = new Date().toISOString(), dataDir = DATA_DIR): void {
  if (!botId) return;
  const file = pathFor(dataDir);
  const state = load(file);
  if (typeof state.bots[botId]?.at === "string") return;
  state.bots[botId] = { at };
  cache.set(file, state);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileAtomic(file, `${JSON.stringify(state)}\n`, { mode: 0o600 });
}
