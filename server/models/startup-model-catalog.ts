// Saved engine model lists. A later start (bots.json already has bots) serves
// the last list and refreshes it behind listen. The first run still waits, so
// the seeded bot's default model is the one discovery just chose. The file is
// a derived cache under providers/, which backups and Move to Cloud skip.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { DATA_DIR } from "../config.ts";
import type { ModelCatalog } from "../contracts.ts";
import { afterFirstEngineRead } from "../first-engine-read.ts";
import { parseModelEffortFacts } from "../../shared/model-capabilities.ts";
import { isContextSize } from "../../shared/context-size.ts";

const SAFE_INSTANCE_ID = /^[\w.-]+$/;

export function startupModelCachePath(instanceId: string): string | null {
  if (!SAFE_INSTANCE_ID.test(instanceId)) return null;
  return join(DATA_DIR, "providers", "engine-models", `${instanceId}.json`);
}

/** True once this data dir has been through a boot that saved bots. The
 * store does not exist yet at registry.load, and this is the same file it
 * will read. */
export function laterStartup(): boolean {
  try {
    const parsed = JSON.parse(readFileSync(join(DATA_DIR, "bots.json"), "utf8")) as unknown;
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

function variantList(value: unknown): Array<{ id: string; label: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const variants = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const variant = entry as { id?: unknown; label?: unknown };
    return typeof variant.id === "string" && typeof variant.label === "string"
      ? [{ id: variant.id, label: variant.label }]
      : [];
  });
  return variants.length ? variants : undefined;
}

function catalogFrom(value: unknown): ModelCatalog | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { default?: unknown; options?: unknown };
  if (typeof raw.default !== "string" || !Array.isArray(raw.options) || raw.options.length === 0) return null;
  const options: ModelCatalog["options"] = [];
  for (const entry of raw.options) {
    if (!entry || typeof entry !== "object") return null;
    const option = entry as {
      id?: unknown;
      label?: unknown;
      custom?: unknown;
      loaded?: unknown;
      provider?: unknown;
      contextWindow?: unknown;
      contextWindows?: unknown;
      variants?: unknown;
      effortLevels?: unknown;
      defaultEffort?: unknown;
    };
    if (typeof option.id !== "string" || typeof option.label !== "string") return null;
    const variants = variantList(option.variants);
    // A model's own effort levels survive a restart: absent would offer the
    // driver's levels (Haiku 4.5 takes none) until the live refresh lands.
    const effort = Array.isArray(option.effortLevels) ? parseModelEffortFacts(option.effortLevels, option.defaultEffort) : {};
    options.push({
      id: option.id,
      label: option.label,
      ...(option.custom === true ? { custom: true } : {}),
      ...(option.loaded === true ? { loaded: true } : {}),
      ...(typeof option.provider === "string" ? { provider: option.provider } : {}),
      ...(typeof option.contextWindow === "number" && Number.isFinite(option.contextWindow)
        ? { contextWindow: option.contextWindow }
        : {}),
      // #4417: the sizes the person may pick survive a restart too
      ...(Array.isArray(option.contextWindows) && option.contextWindows.length > 1 && option.contextWindows.every(isContextSize)
        ? { contextWindows: [...option.contextWindows as number[]] }
        : {}),
      ...(variants ? { variants } : {}),
      ...(effort.effortLevels ? { effortLevels: [...effort.effortLevels] } : {}),
      ...(effort.defaultEffort ? { defaultEffort: effort.defaultEffort } : {}),
    });
  }
  return { default: raw.default, options };
}

export function readStartupModelCache(instanceId: string): ModelCatalog | null {
  const path = startupModelCachePath(instanceId);
  if (!path) return null;
  try {
    return catalogFrom(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch {
    return null;
  }
}

export function writeStartupModelCache(instanceId: string, catalog: ModelCatalog): void {
  if (!catalog.options.length) return;
  const path = startupModelCachePath(instanceId);
  if (!path) return;
  writeCatalog(path, catalog);
}

function writeCatalog(path: string, catalog: ModelCatalog): void {
  const stored = catalogFrom(catalog);
  if (!stored) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, JSON.stringify(stored), { durable: false });
}

/** M-20261119-015: the last list one account's provider gave (a Claude
 * sign-in folder, an instance's own account), kept so a restart or an
 * expired sign-in still lists what that account offers until the next good
 * read. Named by a one-way fingerprint of the account's key: no path, id
 * or token in the file name. Same derived cache as the instances' lists. */
export function accountModelCachePath(accountKey: string): string {
  const name = createHash("sha256").update(accountKey).digest("hex").slice(0, 32);
  return join(DATA_DIR, "providers", "engine-models", "accounts", `${name}.json`);
}

export function readAccountModelCache(accountKey: string): ModelCatalog | null {
  try {
    return catalogFrom(JSON.parse(readFileSync(accountModelCachePath(accountKey), "utf8")) as unknown);
  } catch {
    return null;
  }
}

export function writeAccountModelCache(accountKey: string, catalog: ModelCatalog): void {
  if (!catalog.options.length) return;
  try {
    writeCatalog(accountModelCachePath(accountKey), catalog);
  } catch {
    // A derived cache: the list in memory is what this process serves.
  }
}

/** A later start returns this object, not a promise, so `await` does not
 * follow the refresh. An async function cannot return a promise without
 * the caller waiting for it. */
export type DeferredStartupModelRefresh = { pending: Promise<void> };

export function openStartupModelCatalog(input: {
  instanceId: string;
  use: (catalog: ModelCatalog) => void;
  current: () => ModelCatalog;
  refresh: () => Promise<void>;
}): Promise<null> | DeferredStartupModelRefresh {
  const cached = readStartupModelCache(input.instanceId);
  if (cached) input.use(cached);
  const persist = () => {
    try {
      writeStartupModelCache(input.instanceId, input.current());
    } catch {
      // A derived cache. The in-memory list is already what this process serves.
    }
  };
  if (!laterStartup()) {
    return input.refresh().then(() => {
      persist();
      return null;
    });
  }
  // A saved list stands in while the refresh waits; with none the engine would offer no model at all until it runs.
  const startAfter = cached ? afterFirstEngineRead() : Promise.resolve();
  return { pending: startAfter.then(() => input.refresh()).then(persist, () => undefined) };
}
