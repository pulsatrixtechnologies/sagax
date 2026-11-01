// Capabilities lot 5: migrate the eleven config stores into three
// (bot, person, installation). Style of migrateGithubCredentials:
// backup → write new → verify → retire old. Idempotent (rerun is a
// no-op). Crash-safe: an interrupted run leaves backups and never
// deletes an old file before the new store verifies. At-rest sealing
// of person and installation secrets is preserved. Person isolation
// is preserved (each principal stays under principals/<pid>/).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";

import { capabilityPluginStateSchema, capabilityPluginValuesSchema } from "./capability-plugin-state.ts";
import { BotCapabilityStore, emptyBotCapabilityDocument } from "./bot-capability-store.ts";
import { InstallationCapabilityStore, emptyInstallationCapabilityDocument } from "./installation-capability-store.ts";
import { principalDir } from "./person-connections.ts";

const BACKUP_SUFFIX = ".capabilities-l5.bak";
const RETIRED_SUFFIX = ".migrated";
/** One-time repair marker (installation document). See repairPersonSkillsInInstallationIndex. */
export const PERSON_SKILLS_SPLIT_ID = "skills-library-person-split";
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type CapabilitiesStoreMigrationResult = {
  /** Sources newly taken in on this call. */
  imported: string[];
  /** Sources already marked migrated (no-op). */
  skipped: string[];
  /** Bots whose bot store was written or verified. */
  bots: string[];
  /** People whose connections.enc was retired into capabilities.enc. */
  people: string[];
};

export type CapabilitiesStoreMigrationOptions = {
  dataDir: string;
  bots: BotCapabilityStore;
  installation: InstallationCapabilityStore;
  /** Bot ids that still have a legacy bot-plugins tree or assigned skills. */
  botIds: () => string[];
  /** Principal ids under principals/. */
  personIds: () => string[];
  /** Assigned library skills per bot (from the bot record store). */
  assignedSkillsFor?: (botId: string) => string[];
  /** Read config.json mcpServers without mutating the rest of config. */
  readMcpServers?: () => Record<string, unknown>;
  /** Clear mcpServers from config.json after verify (optional). */
  clearMcpServers?: () => void;
  /** Whether github credential migration already absorbed the legacy token files. */
  githubCredentialsMigrated?: () => boolean;
};

function backupFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const backup = `${path}${BACKUP_SUFFIX}`;
  if (!existsSync(backup)) copyFileSync(path, backup);
  return backup;
}

function retireFile(path: string): void {
  if (!existsSync(path)) return;
  const retired = `${path}${RETIRED_SUFFIX}`;
  if (existsSync(retired)) {
    rmSync(path, { force: true });
    return;
  }
  renameSync(path, retired);
}

function readJson(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function listBotPluginIds(dataDir: string): string[] {
  const base = join(dataDir, "bot-plugins");
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[\w-]{1,80}$/.test(entry.name))
    .map((entry) => entry.name);
}

function listPersonIds(dataDir: string): string[] {
  const base = join(dataDir, "principals");
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Migrate capability config into the three stores. Safe to call at every
 * boot. Returns what this call imported; a second call reports skipped.
 */
export function migrateCapabilitiesStores(options: CapabilitiesStoreMigrationOptions): CapabilitiesStoreMigrationResult {
  const imported: string[] = [];
  const skipped: string[] = [];
  const botsTouched = new Set<string>();
  const peopleTouched = new Set<string>();
  const { dataDir, bots } = options;

  const botIds = [...new Set([...options.botIds(), ...listBotPluginIds(dataDir), ...bots.listBotIds()])].sort();
  for (const botId of botIds) {
    migrateOneBot(botId, options, imported, skipped, botsTouched);
  }

  const personIds = [...new Set([...options.personIds(), ...listPersonIds(dataDir)])].sort();
  for (const personId of personIds) {
    migrateOnePerson(personId, options, imported, skipped, peopleTouched);
  }

  migrateInstallation(options, imported, skipped);

  return {
    imported,
    skipped,
    bots: [...botsTouched].sort(),
    people: [...peopleTouched].sort(),
  };
}

function migrateOneBot(
  botId: string,
  options: CapabilitiesStoreMigrationOptions,
  imported: string[],
  skipped: string[],
  botsTouched: Set<string>,
): void {
  const { dataDir, bots } = options;
  const statePath = join(dataDir, "bot-plugins", botId, "state.json");
  const configPath = join(dataDir, "bot-plugins", botId, "plugins", "config.json");
  const document = bots.present(botId) ? bots.read(botId) : emptyBotCapabilityDocument();
  let dirty = false;

  if (!document.migrated.includes("bot-plugins-state")) {
    backupFile(statePath);
    const raw = readJson(statePath);
    if (raw !== undefined) {
      const parsed = capabilityPluginStateSchema.safeParse(raw);
      if (parsed.success) {
        document.plugins = parsed.data;
        dirty = true;
      }
    }
    document.migrated = [...document.migrated, "bot-plugins-state"];
    dirty = true;
    imported.push(`bot:${botId}:bot-plugins-state`);
  } else {
    skipped.push(`bot:${botId}:bot-plugins-state`);
  }

  if (!document.migrated.includes("bot-plugins-config")) {
    backupFile(configPath);
    const raw = readJson(configPath);
    if (raw !== undefined && raw && typeof raw === "object" && !Array.isArray(raw)) {
      const parsed = capabilityPluginValuesSchema.safeParse(raw);
      if (parsed.success) {
        document.pluginValues = parsed.data;
        dirty = true;
      }
    }
    document.migrated = [...new Set([...document.migrated, "bot-plugins-config"])];
    dirty = true;
    imported.push(`bot:${botId}:bot-plugins-config`);
  } else {
    skipped.push(`bot:${botId}:bot-plugins-config`);
  }

  const skills = options.assignedSkillsFor?.(botId) ?? [];
  if (skills.length && !deepEqual(document.assignedSkills, skills) && !document.migrated.includes("bot-assigned-skills")) {
    document.assignedSkills = [...skills];
    document.migrated = [...new Set([...document.migrated, "bot-assigned-skills"])];
    dirty = true;
    imported.push(`bot:${botId}:bot-assigned-skills`);
  }

  if (dirty || !bots.present(botId)) {
    bots.write(botId, document);
  }

  // Verify then retire old config files (content trees stay).
  const verified = bots.read(botId);
  if (verified.migrated.includes("bot-plugins-state") && verified.migrated.includes("bot-plugins-config")) {
    if (existsSync(statePath)) {
      const raw = readJson(statePath);
      const parsed = raw === undefined ? undefined : capabilityPluginStateSchema.safeParse(raw);
      if (raw === undefined || (parsed?.success && deepEqual(parsed.data, verified.plugins))) {
        retireFile(statePath);
      }
    } else {
      // nothing to retire
    }
    if (existsSync(configPath)) {
      const raw = readJson(configPath);
      const parsed = raw === undefined ? undefined : capabilityPluginValuesSchema.safeParse(raw);
      if (raw === undefined || (parsed?.success && deepEqual(parsed.data, verified.pluginValues))) {
        retireFile(configPath);
      }
    }
    botsTouched.add(botId);
  }
}

function migrateOnePerson(
  personId: string,
  options: CapabilitiesStoreMigrationOptions,
  imported: string[],
  skipped: string[],
  peopleTouched: Set<string>,
): void {
  const { dataDir } = options;
  let home: string;
  try {
    home = principalDir(dataDir, personId);
  } catch {
    return;
  }
  const capabilities = join(home, "capabilities.enc");
  const connections = join(home, "connections.enc");
  const marker = join(home, ".capabilities-l5-person-migrated");

  if (existsSync(marker)) {
    skipped.push(`person:${personId}:person-connections-legacy`);
    skipped.push(`person:${personId}:person-capabilities`);
    return;
  }

  // Person store already is capabilities.enc (lot 2). Backup both, ensure
  // the new file exists when only the legacy file does, then retire legacy.
  if (existsSync(connections)) backupFile(connections);
  if (existsSync(capabilities)) backupFile(capabilities);

  if (existsSync(connections) && !existsSync(capabilities)) {
    // Lot 2 migrates on first PersonConnections.read. Copy sealed bytes
    // only when the new file is still absent so a crash mid-read cannot
    // leave the person without either file; PersonConnections will rewrite
    // with the v2 AAD on the next successful read.
    copyFileSync(connections, capabilities);
    imported.push(`person:${personId}:person-connections-legacy`);
  } else if (existsSync(capabilities)) {
    skipped.push(`person:${personId}:person-capabilities`);
    if (existsSync(connections)) {
      // New file wins; retire legacy after backup.
      retireFile(connections);
      imported.push(`person:${personId}:person-connections-legacy`);
    } else {
      skipped.push(`person:${personId}:person-connections-legacy`);
    }
  } else {
    skipped.push(`person:${personId}:person-capabilities`);
    skipped.push(`person:${personId}:person-connections-legacy`);
  }

  if (existsSync(capabilities) || !existsSync(connections)) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    writeFileSync(marker, `${new Date().toISOString()}\n`, { mode: 0o600 });
    peopleTouched.add(personId);
  }
}

function migrateInstallation(
  options: CapabilitiesStoreMigrationOptions,
  imported: string[],
  skipped: string[],
): void {
  const { dataDir, installation } = options;
  let document = emptyInstallationCapabilityDocument();
  try {
    document = installation.read();
  } catch {
    // Vault key not ready: leave installation migration for the next call
    // (same deferral pattern as migrateGithubCredentials).
    return;
  }
  let dirty = false;

  const take = (id: string, apply: () => boolean): void => {
    if (document.migrated.includes(id)) {
      skipped.push(`installation:${id}`);
      return;
    }
    const changed = apply();
    document.migrated = [...document.migrated, id];
    dirty = true;
    if (changed) imported.push(`installation:${id}`);
    else imported.push(`installation:${id}`);
  };

  take("marketplaces-state", () => {
    const path = join(dataDir, "marketplaces", "state.json");
    backupFile(path);
    const raw = readJson(path);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const row = raw as { version?: unknown; marketplaces?: unknown; installed?: unknown };
      document.marketplaces = {
        version: 1,
        marketplaces: (row.marketplaces && typeof row.marketplaces === "object" && !Array.isArray(row.marketplaces))
          ? row.marketplaces as Record<string, unknown>
          : {},
        installed: (row.installed && typeof row.installed === "object" && !Array.isArray(row.installed))
          ? row.installed as Record<string, unknown>
          : {},
      };
      return true;
    }
    return false;
  });

  take("skills-library-index", () => {
    const path = join(dataDir, "skills-library", "index.json");
    backupFile(path);
    const raw = readJson(path);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      document.skillsLibrary = raw as Record<string, unknown>;
      return true;
    }
    return false;
  });

  take("org-flow-state", () => {
    const path = join(dataDir, "org-flow-plugins", "state.json");
    backupFile(path);
    const raw = readJson(path);
    if (raw !== undefined) {
      document.orgFlow = raw;
      return true;
    }
    return false;
  });

  take("org-capabilities-state", () => {
    const path = join(dataDir, "org-capabilities", "state.json");
    backupFile(path);
    const raw = readJson(path);
    if (raw !== undefined) {
      document.orgCapabilities = raw;
      return true;
    }
    return false;
  });

  take("config-mcp-servers", () => {
    const path = join(dataDir, "config.json");
    if (existsSync(path)) backupFile(path);
    const servers = options.readMcpServers?.() ?? (() => {
      const raw = readJson(path);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const mcp = (raw as { mcpServers?: unknown }).mcpServers;
        if (mcp && typeof mcp === "object" && !Array.isArray(mcp)) return mcp as Record<string, unknown>;
      }
      return {};
    })();
    document.mcpServers = servers;
    return Object.keys(servers).length > 0;
  });

  // Legacy token files: already folded by migrateGithubCredentials. Mark
  // them migrated here once that migration reports done, then retire.
  const githubDone = options.githubCredentialsMigrated?.() ?? (
    !existsSync(join(dataDir, "org-github-tokens.enc")) && !existsSync(join(dataDir, "marketplace-tokens.enc"))
  );
  for (const id of ["org-github-tokens", "marketplace-tokens"] as const) {
    const path = join(dataDir, id === "org-github-tokens" ? "org-github-tokens.enc" : "marketplace-tokens.enc");
    if (document.migrated.includes(id)) {
      skipped.push(`installation:${id}`);
      continue;
    }
    if (existsSync(path)) backupFile(path);
    if (githubDone || !existsSync(path)) {
      document.migrated = [...document.migrated, id];
      dirty = true;
      imported.push(`installation:${id}`);
      if (existsSync(path) && githubDone) retireFile(path);
    }
  }

  if (dirty) installation.write(document);

  // Verify sealed round-trip, then retire plaintext JSON sources.
  let verified: ReturnType<InstallationCapabilityStore["read"]>;
  try {
    installation.clearCache();
    verified = installation.read();
  } catch {
    return;
  }

  if (verified.migrated.includes("marketplaces-state")) {
    const path = join(dataDir, "marketplaces", "state.json");
    if (existsSync(path) && deepEqual(
      { version: 1, marketplaces: verified.marketplaces.marketplaces, installed: verified.marketplaces.installed },
      (() => {
        const raw = readJson(path);
        if (!raw || typeof raw !== "object") return null;
        const row = raw as { marketplaces?: unknown; installed?: unknown };
        return {
          version: 1,
          marketplaces: row.marketplaces ?? {},
          installed: row.installed ?? {},
        };
      })(),
    )) {
      retireFile(path);
    } else if (!existsSync(path)) {
      // already gone
    } else if (verified.migrated.includes("marketplaces-state") && !readJson(path)) {
      retireFile(path);
    } else if (existsSync(path)) {
      // Keep when verify cannot prove equality (hand-edited drift): backup stays.
      const raw = readJson(path);
      if (raw && typeof raw === "object") {
        const row = raw as { marketplaces?: unknown; installed?: unknown };
        if (deepEqual(row.marketplaces ?? {}, verified.marketplaces.marketplaces)
          && deepEqual(row.installed ?? {}, verified.marketplaces.installed)) {
          retireFile(path);
        }
      }
    }
  }

  if (verified.migrated.includes("skills-library-index")) {
    const path = join(dataDir, "skills-library", "index.json");
    if (!existsSync(path) || deepEqual(readJson(path), verified.skillsLibrary)) retireFile(path);
    repairPersonSkillsInInstallationIndex(options, verified, imported, skipped);
  }
  if (verified.migrated.includes("org-flow-state")) {
    const path = join(dataDir, "org-flow-plugins", "state.json");
    if (!existsSync(path) || deepEqual(readJson(path), verified.orgFlow)) retireFile(path);
  }
  if (verified.migrated.includes("org-capabilities-state")) {
    const path = join(dataDir, "org-capabilities", "state.json");
    if (!existsSync(path) || deepEqual(readJson(path), verified.orgCapabilities)) retireFile(path);
  }
  if (verified.migrated.includes("config-mcp-servers")) {
    // Do not retire whole config.json. Clear only mcpServers after verify
    // when the caller provided a clearer and there was something to move;
    // otherwise leave config alone and keep reading from the sealed store.
    const fromDisk = options.readMcpServers?.() ?? {};
    if (Object.keys(verified.mcpServers).length > 0 && deepEqual(fromDisk, verified.mcpServers)) {
      options.clearMcpServers?.();
    }
  }
}

/**
 * Repair for development builds of 0.8.24 before the fix of 2026-11-01:
 * the skills library reader applied the installation store to every root,
 * so a person's Me skill (principals/<pid>/capability-skills, whose
 * SKILL.md bytes were written under the person) had its index entry
 * written into the installation index instead of the person's index.json.
 * Each such entry (no file under skills-library/skills/<name>/, a file
 * with the same sha256 under exactly one person) goes back to that
 * person's index, then leaves the installation document. The person's
 * index is written first, so a crash in between repeats harmlessly. Runs
 * once per installation (marker in `migrated`); nothing in production
 * carried this layout.
 */
function repairPersonSkillsInInstallationIndex(
  options: CapabilitiesStoreMigrationOptions,
  document: ReturnType<InstallationCapabilityStore["read"]>,
  imported: string[],
  skipped: string[],
): void {
  const { dataDir, installation } = options;
  if (document.migrated.includes(PERSON_SKILLS_SPLIT_ID)) {
    skipped.push(`installation:${PERSON_SKILLS_SPLIT_ID}`);
    return;
  }
  const people = [...new Set([...options.personIds(), ...listPersonIds(dataDir)])].sort();
  const homes = new Map<string, string>();
  for (const personId of people) {
    try {
      homes.set(personId, principalDir(dataDir, personId));
    } catch {
      // not a principal directory
    }
  }
  const additions = new Map<string, Record<string, unknown>>();
  for (const [name, entry] of Object.entries(document.skillsLibrary)) {
    if (!SKILL_NAME.test(name) || !entry || typeof entry !== "object") continue;
    const sha256 = (entry as { sha256?: unknown }).sha256;
    if (typeof sha256 !== "string") continue;
    if (existsSync(join(dataDir, "skills-library", "skills", name, "SKILL.md"))) continue;
    for (const [personId, home] of homes) {
      const file = join(home, "capability-skills", "skills", name, "SKILL.md");
      let bytes: Buffer;
      try {
        bytes = readFileSync(file);
      } catch {
        continue;
      }
      if (createHash("sha256").update(bytes).digest("hex") !== sha256) continue;
      const mine = additions.get(personId) ?? {};
      mine[name] = entry;
      additions.set(personId, mine);
      break;
    }
  }
  const moved: string[] = [];
  for (const [personId, entries] of additions) {
    const root = join(homes.get(personId)!, "capability-skills");
    const indexPath = join(root, "index.json");
    const current = existsSync(indexPath) ? readJson(indexPath) : {};
    if (!current || typeof current !== "object" || Array.isArray(current)) continue; // unreadable person index: leave both as they are
    const next = { ...(current as Record<string, unknown>) };
    for (const [name, entry] of Object.entries(entries)) {
      if (!(name in next)) next[name] = entry;
      moved.push(name);
      imported.push(`person:${personId}:me-skill:${name}`);
    }
    mkdirSync(root, { recursive: true, mode: 0o700 });
    writeFileAtomic(indexPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  }
  for (const name of moved) delete document.skillsLibrary[name];
  document.migrated = [...document.migrated, PERSON_SKILLS_SPLIT_ID];
  installation.write(document);
  imported.push(`installation:${PERSON_SKILLS_SPLIT_ID}`);
}

/** List every bot-plugins directory id (for boot wiring). */
export function discoverBotPluginIds(dataDir: string): string[] {
  return listBotPluginIds(dataDir);
}

/** List every principals/ id (for boot wiring). */
export function discoverPersonIds(dataDir: string): string[] {
  return listPersonIds(dataDir);
}
