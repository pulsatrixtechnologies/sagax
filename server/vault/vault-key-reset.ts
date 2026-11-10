// "Reset saved keys" on the desktop (electron/secure-credentials.mjs) moves an
// unreadable credentials.bin aside as credentials.bin.unreadable-<ms>. The vault
// key of every sealed store below lived in that file, so the next launch makes
// a new key (ensureMcpOAuthKey) and the stores sealed with the old one can no
// longer open: each refuses to overwrite a file it cannot read, so they would
// stay "could not be opened" forever. The desktop names the reset to its server
// child (SAGAX_VAULT_KEY_RESET=<ms>); before the first store reads its key, the
// server moves every file sealed with that key aside with the same suffix (kept,
// never deleted, so it can go back with the old credentials.bin) and the stores
// start empty under the new key. The same key wrapped the content keys of
// messages.db (encryption at rest, provider "local"): those are retired to a kept
// side table, so new conversations are sealed again under fresh keys and what
// the old keys sealed stays locked until the old file comes back. Done once per
// data folder and reset: a marker file names the last reset handled there.
import { existsSync, lstatSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { writeFileAtomic } from "../atomic.ts";
import { retireLocalContentKeys } from "../encryption/content-keys.ts";

/** Files sealed with the vault key (resolveVaultKey), wherever they sit under the data folder: the root (solo, desktop),
 * principals/<pid>/, bots/<id>/ and the like. idp-grants.enc is not here: it has a key of its own. */
export const VAULT_SEALED_FILES: ReadonlySet<string> = new Set([
  "mcp-oauth.enc",
  "credential-vault.enc",
  "provider-keys.enc",
  "engine-api-keys.enc",
  "voice-keys.enc",
  "onboarding-engine-keys.enc",
  "capabilities.enc",
  "connections.enc",
  "installation-capabilities.enc",
  "openapi.enc",
  "github-credentials.enc",
  "org-github-tokens.enc",
  "org-bot-secrets.enc",
  "marketplace-tokens.enc",
  "cloud-agent-credentials.enc",
  "trigger-poller-credentials.enc",
  "web-search.enc",
  "telemetry.enc",
  "memes.enc",
  "bot-tailscale.enc",
  "pi-model-servers.enc",
  "idp-revocations.enc",
  "grok-bridge-secrets.enc",
  "reach-me-secrets.enc",
  "web-bot-auth-key.json",
]);

export const VAULT_KEY_RESET_MARKER = "vault-key-reset.json";
/** Folders under the data folder that hold the person's own files or caches, never a sealed store. */
const SKIPPED_DIRS = new Set(["workspaces", "task-workspaces", "cache", "logs", "node_modules", "skills-library", "artifacts"]);
const MAX_DEPTH = 3;
const RESET_STAMP = /^[1-9][0-9]{0,15}$/;

interface HandledReset {
  resetAt: string;
  moved: number;
  /** false: messages.db could not be written on that launch, so its content keys are retried */
  contentKeys?: boolean;
}

function handledReset(dataDir: string): HandledReset | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, VAULT_KEY_RESET_MARKER), "utf8")) as Partial<HandledReset>;
    return typeof parsed.resetAt === "string" ? { resetAt: parsed.resetAt, moved: Number(parsed.moved) || 0, contentKeys: parsed.contentKeys } : null;
  } catch {
    return null;
  }
}

function markHandled(dataDir: string, handled: HandledReset): void {
  try {
    writeFileAtomic(join(dataDir, VAULT_KEY_RESET_MARKER), `${JSON.stringify(handled)}\n`, { mode: 0o600 });
  } catch {
    // The folder cannot be written: no store can be either, and the next launch tries again.
  }
}

function sealedFiles(dir: string, depth: number, found: string[]): void {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isFile() && VAULT_SEALED_FILES.has(entry.name)) found.push(path);
    else if (entry.isDirectory() && depth < MAX_DEPTH && !SKIPPED_DIRS.has(entry.name)) {
      // A link is never followed: what it points at is not this data folder's.
      try { if (lstatSync(path).isSymbolicLink()) continue; } catch { continue; }
      sealedFiles(path, depth + 1, found);
    }
  }
}

/** Retire the local content keys of messages.db made before the reset. False: the database could not be written. */
function retireContentKeys(dataDir: string, stamp: string): boolean {
  const file = join(dataDir, "messages.db");
  if (!existsSync(file)) return true;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file);
    db.exec("PRAGMA busy_timeout = 5000");
    retireLocalContentKeys(db, stamp, Number(stamp));
    return true;
  } catch {
    return false;
  } finally {
    try { db?.close(); } catch { /* closed */ }
  }
}

/** Move aside, once, every file sealed with the key the desktop's reset dropped, and retire the content keys it
 * wrapped. Returns the files moved (their old paths). Nothing happens without a reset stamp, outside a desktop child,
 * or when this folder already handled it. */
export function setAsideStoresSealedBeforeReset(dataDir: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const stamp = env.SAGAX_VAULT_KEY_RESET?.trim();
  if (env.SAGAX_DESKTOP_PARENT !== "1" || !stamp || !RESET_STAMP.test(stamp)) return [];
  const handled = handledReset(dataDir);
  if (handled?.resetAt === stamp) {
    // The files went aside already; only content keys a locked database kept are retried (those made before the reset).
    if (handled.contentKeys === false && retireContentKeys(dataDir, stamp)) markHandled(dataDir, { ...handled, contentKeys: true });
    return [];
  }
  const found: string[] = [];
  sealedFiles(dataDir, 0, found);
  const moved: string[] = [];
  for (const file of found) {
    try {
      renameSync(file, `${file}.unreadable-${stamp}`);
      moved.push(file);
    } catch {
      // Left in place: that store keeps saying it cannot open, which stays true.
    }
  }
  // Without this, an owner would keep a key that never opens and new messages would be written plain for good.
  markHandled(dataDir, { resetAt: stamp, moved: moved.length, contentKeys: retireContentKeys(dataDir, stamp) });
  return moved;
}
