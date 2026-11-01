// Claude Code plugins on a bot (Capabilities, scope "For this bot"). The
// marketplaces are the installation's one list (server/plugin-marketplaces.ts,
// Capabilities > Sources > Marketplaces); Sagax copies the plugins
// the owner picks from there into the bot's own folder. Claude loads each
// enabled folder with `--plugin-dir`. Every other engine gets the same
// enabled skills and commands in the turn prompt (server/plugin-turn.ts).
// Nothing here goes through a bot's shell: on an organization server the
// host Bash is denied (withholdHostTools), so `claude plugin marketplace add`
// typed by a bot could never run there, whatever SAGAX_CLAUDE_ALLOW says.
//
// Rules:
//   - Per bot: DATA_DIR/bot-plugins/<botId>/{state.json, plugins/}. A bot
//     stored by an older build also kept its own marketplaces/ there:
//     `migrateBotMarketplaces` moves them into the one list at start.
//   - Who: the bot's owner or a person with manage on it (the route checks);
//     reads need use. The organization admin may restrict marketplaces
//     (organization.pluginMarketplaces: any by default, or a list of
//     owner/repo, owner/* or exact https URLs). 2026-10-27 (#1098): the
//     list holds what is shared (a marketplace shared with everyone, a
//     plugin for everyone); a person's private marketplace serves their
//     own bots whatever the list says.
//   - A private marketplace is read with, in order: the credential this
//     bot picks for it (the GitHub plugin's page in Capabilities, one list,
//     server/github-credentials.ts), else the one the installation picks
//     (Everyone), then Automatic: the acting person's own GitHub connection
//     (server/github-connect.ts), their other credentials, then the
//     organization's (server/github-access.ts). For github.com, GitHub's API
//     says first which one reads the repository, or why none does (404
//     private, 401 bad token, 403 SAML sign-on, rate limit). The token rides
//     an extra HTTP header through the environment, never the URL, the argv
//     or a file.
//   - What runs on the server host is never taken from a plugin: hooks,
//     MCP and LSP server declarations are removed from the folder Claude loads
//     with --plugin-dir (they would run on the Sagax host). Hook commands
//     are kept beside that folder and run only on the bot's computer when
//     the owner turns lifecycle hooks on (server/lifecycle-hooks.ts). The
//     plugin's skills, commands, agents and output styles stay. The MCP
//     servers it declared mount separately in the person's environment.
import { execFile } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import type { McpServerSpec } from "./contracts.ts";
import { parseStoredMcpServer } from "./mcp-registry.ts";
import { readPluginMcpServers } from "./plugin-mcp.ts";
import { SANDBOX_PLUGINS_DIR } from "./sandbox-plugins.ts";
import { capabilityPluginRecordSchema as pluginRecord, capabilityPluginStateSchema as stateSchema } from "./capability-plugin-state.ts";
import type { CapabilityPluginValues } from "./capability-plugin-state.ts";
import { capturePluginHooks, type LifecycleHook } from "./lifecycle-hooks.ts";
import { pluginUpdateAvailable, type MarketplaceViewer, type MarketplaceVisibility, type PluginMarketplaces } from "./plugin-marketplaces.ts";
import { probeGithubRepo, type GithubCredential, type GithubProbe } from "./github-access.ts";
import { githubGitEnvironment } from "./github-connect.ts";
import { WORKSPACE_SCOPE as WORKSPACE_TOKEN_KEY } from "./github-credentials.ts";
import type { MarketplaceCredentialView } from "../shared/github-credentials.ts";
import { applyPluginConfig, checkPluginConfig, readConfigValues, readPluginConfigFields, writeConfigValues, type PluginConfigField, type PluginConfigValue } from "./plugin-config.ts";
import { invalidatePluginMetaCache, pluginMetadataCacheRoot, rebuildPluginMetaCache } from "./plugin-metadata-cache.ts";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BOT_ID = /^[\w-]{1,80}$/;
const MAX_REPO_BYTES = 64 * 1024 * 1024;
const MAX_REPO_FILES = 8_000;
const MAX_PLUGINS = 50;
const MAX_CONTENT_NAMES = 50;
/** Marketplaces a bot package may bring into the one list. */
const MAX_RESTORED_MARKETPLACES = 10;
/** The https address of a marketplace.json (plugin-marketplaces.ts isManifestUrl). */
const MANIFEST_URL = /^https:\/\/\S+\.json(?:\?\S*)?$/i;
const GIT_TIMEOUT_MS = 120_000;
/** What a plugin may not bring onto the server host. */
const STRIPPED_PATHS = ["hooks", ".mcp.json", ".lsp.json", "monitors"] as const;
const STRIPPED_MANIFEST_KEYS = ["hooks", "mcpServers", "lspServers", "monitors"] as const;

export class BotPluginError extends Error {
  readonly code: string;
  readonly status: number;
  /** What the person can do (server/github-access.ts GithubAccessFix). */
  readonly fix?: string;
  constructor(message: string, code: string, status = 400, fix?: string) {
    super(message);
    this.code = code;
    this.status = status;
    if (fix) this.fix = fix;
  }
}

// ── sources and policy ───────────────────────────────────────────────────

export interface GitSource {
  /** How it is shown and matched: `owner/repo` for GitHub, else the URL. */
  id: string;
  url: string;
  github?: { owner: string; repo: string };
  ref?: string;
}

const GITHUB_PART = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

/** owner/repo, a github.com URL, or another https git URL. */
export function parseGitSource(input: string, ref?: string): GitSource {
  const text = input.trim();
  if (ref !== undefined && (!REF.test(ref) || ref.includes(".."))) throw new BotPluginError("That branch or tag name is not valid.", "invalid_source");
  const short = /^([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/.exec(text);
  if (short && !text.includes("://")) {
    const [, owner, repo] = short;
    if (!GITHUB_PART.test(owner!) || !GITHUB_PART.test(repo!)) throw new BotPluginError("Use owner/repo, like anthropics/claude-plugins.", "invalid_source");
    return { id: `${owner}/${repo}`.toLowerCase(), url: `https://github.com/${owner}/${repo}.git`, github: { owner: owner!, repo: repo! }, ...(ref ? { ref } : {}) };
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new BotPluginError("Use owner/repo or an https:// git address.", "invalid_source");
  }
  if (url.protocol !== "https:") throw new BotPluginError("Only https:// marketplaces can be added.", "invalid_source");
  if (url.username || url.password || url.search || url.hash) throw new BotPluginError("Put no credentials or query in the address: connect GitHub for private repositories.", "invalid_source");
  if (url.hostname.toLowerCase() === "github.com") {
    const parts = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "").split("/");
    if (parts.length !== 2 || !GITHUB_PART.test(parts[0]!) || !GITHUB_PART.test(parts[1]!)) throw new BotPluginError("Use https://github.com/owner/repo.", "invalid_source");
    return parseGitSource(`${parts[0]}/${parts[1]}`, ref);
  }
  const clean = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  return { id: clean.toLowerCase(), url: clean, ...(ref ? { ref } : {}) };
}

export type MarketplacePolicy = { mode: "any" } | { mode: "list"; allow: string[] };

export const marketplacePolicySchema = z.union([
  z.object({ mode: z.literal("any") }).strict(),
  z.object({ mode: z.literal("list"), allow: z.array(z.string().trim().min(1).max(300)).max(100) }).strict(),
]);

/** Normalize an admin's list entry: owner/repo, owner/*, or an https URL. */
export function normalizePolicyEntry(entry: string): string {
  const text = entry.trim();
  const wildcard = /^([^/\s:]+)\/\*$/.exec(text);
  if (wildcard) {
    if (!GITHUB_PART.test(wildcard[1]!)) throw new BotPluginError(`“${entry}” is not owner/* or owner/repo.`, "invalid_policy");
    return `${wildcard[1]!.toLowerCase()}/*`;
  }
  return parseGitSource(text).id;
}

/** Capabilities lot 4: the effective marketplace rule of a linked server.
 * Perspicax's policy, when set, replaces the historical one: `any`, or
 * `list` = the sources of its enabled allowed marketplaces (owner/repo,
 * owner/*, public HTTPS). A null policy (never set in Perspicax) or an
 * absent one (an older Perspicax) keeps the historical rule unchanged:
 * null is never read as `any`. Pure. */
export function effectiveMarketplacePolicy(
  perspicax: { mode: "any" | "list" } | null | undefined,
  marketplaces: ReadonlyArray<{ source: string; enabled: boolean }> | undefined,
  historical: MarketplacePolicy | undefined,
): MarketplacePolicy | undefined {
  if (!perspicax) return historical;
  if (perspicax.mode === "any") return { mode: "any" };
  return { mode: "list", allow: [...new Set((marketplaces ?? []).filter((market) => market.enabled).map((market) => market.source.trim()).filter(Boolean))] };
}

export function marketplaceAllowed(policy: MarketplacePolicy | undefined, source: GitSource): boolean {
  if (!policy || policy.mode === "any") return true;
  return policy.allow.some((raw) => {
    let entry: string;
    try { entry = normalizePolicyEntry(raw); } catch { return false; }
    if (entry.endsWith("/*")) return Boolean(source.github) && source.id.startsWith(entry.slice(0, -1));
    return entry === source.id;
  });
}

// ── state ────────────────────────────────────────────────────────────────

const marketplaceRecord = z.object({
  source: z.string(),
  url: z.string(),
  ref: z.string().optional(),
  description: z.string().optional(),
  addedAt: z.number(),
  addedBy: z.string().optional(),
  updatedAt: z.number(),
}).strict();

/** Before the one marketplace list: each bot kept its own marketplaces. */
const legacyStateSchema = z.object({
  version: z.literal(1),
  marketplaces: z.record(z.string(), marketplaceRecord),
  plugins: z.record(z.string(), pluginRecord),
}).strict();

export type PluginState = z.infer<typeof stateSchema>;
/** A bot's state as an older build kept it, and as a bot package carries
 * it (server/bot-zip.ts): its marketplaces with its installs. */
export type LegacyPluginState = z.infer<typeof legacyStateSchema>;
export type MarketplaceRecord = z.infer<typeof marketplaceRecord>;
/** A plugin's declared fields and this bot's values (server/plugin-config.ts). */
export interface PluginConfigView { fields: PluginConfigField[]; values: Record<string, PluginConfigValue> }
export type InstalledBotPlugin = Omit<z.infer<typeof pluginRecord>, "mcpServers"> & { key: string; config?: PluginConfigView };

function listedPlugin(record: z.infer<typeof pluginRecord>): Omit<z.infer<typeof pluginRecord>, "mcpServers"> {
  const { mcpServers: _execution, ...listed } = record;
  return listed;
}

/** What a plugin brings to a bot, by name (read from its folder). */
export interface PluginContents {
  agents: string[];
  commands: string[];
  skills: string[];
}

export interface MarketplacePluginEntry {
  name: string;
  description?: string;
  version?: string;
  category?: string;
  /** its site (`homepage`, else `author.url`): the plugin's icon is that
   * site's (2026-10-28) */
  homepage?: string;
  /** an https image the entry declares as its icon (`icon` or `logo`) */
  icon?: string;
  /** Where its files are: inside the marketplace, or another repository. */
  source: { kind: "path"; path: string } | { kind: "git"; git: GitSource; path?: string };
}

export interface MarketplaceListing {
  name: string;
  source: string;
  /** This bot picks a credential for this marketplace (never the token). */
  hasToken: boolean;
  /** The credential it picks (absent: Automatic) and the one that read it last. */
  credential?: MarketplaceCredentialView;
  /** "private" (the person who added it) or "org" (shared with everyone) */
  visibility: MarketplaceVisibility;
  /** this viewer added it, so may change its visibility */
  mine: boolean;
  description?: string;
  addedAt: number;
  updatedAt: number;
  plugins: Array<{
    name: string; description?: string; version?: string; category?: string; homepage?: string; icon?: string; installed: boolean; external: boolean;
    /** the version this bot has, when it differs from `version` */
    installedVersion?: string;
    /** the marketplace offers another version or other files (Install updates in place) */
    updateAvailable?: boolean;
    /** absent for a plugin in another repository (read at install) */
    contents?: PluginContents;
  }>;
}

/** The agents, commands and skills in a plugin folder (names only). */
export function readPluginContents(root: string): PluginContents {
  const names = (dir: string, pick: (entry: { name: string; isFile: () => boolean; isDirectory: () => boolean }) => string | null): string[] => {
    try {
      if (!statSync(dir).isDirectory()) return [];
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => !entry.isSymbolicLink())
        .map(pick)
        .filter((name): name is string => Boolean(name))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, MAX_CONTENT_NAMES);
    } catch {
      return [];
    }
  };
  const markdown = (entry: { name: string; isFile: () => boolean }) => (entry.isFile() && entry.name.endsWith(".md") ? entry.name.slice(0, -3) : null);
  return {
    agents: names(join(root, "agents"), markdown),
    commands: names(join(root, "commands"), markdown),
    skills: names(join(root, "skills"), (entry) => (entry.isDirectory() && existsSync(join(root, "skills", entry.name, "SKILL.md")) ? entry.name : null)),
  };
}

// ── marketplace.json ─────────────────────────────────────────────────────

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim().slice(0, max) : undefined;
}

/** An http(s) address from a manifest, or nothing (no other scheme, no
 * credentials in it, bounded). `secure`: https only (an image the app loads). */
export function manifestUrl(value: unknown, secure = false): string | undefined {
  if (typeof value !== "string" || value.length > 500) return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && (secure || url.protocol !== "http:")) return undefined;
    if (url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** Read a marketplace's manifest (`.claude-plugin/marketplace.json`). */
export function readMarketplaceManifest(root: string): { name: string; description?: string; plugins: MarketplacePluginEntry[] } {
  const file = join(root, ".claude-plugin", "marketplace.json");
  let raw: unknown;
  try {
    const stat = statSync(file);
    if (stat.size > 1_048_576) throw new Error("too large");
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new BotPluginError("This repository has no readable .claude-plugin/marketplace.json: it is not a Claude Code plugin marketplace.", "not_a_marketplace", 422);
  }
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const name = text(record.name, 64);
  if (!name || !NAME.test(name)) throw new BotPluginError("The marketplace has no valid name in marketplace.json.", "not_a_marketplace", 422);
  const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata as Record<string, unknown> : {};
  const pluginRoot = typeof metadata.pluginRoot === "string" ? metadata.pluginRoot : "";
  const description = text(metadata.description ?? record.description, 300);
  const plugins: MarketplacePluginEntry[] = [];
  for (const item of Array.isArray(record.plugins) ? record.plugins.slice(0, 500) : []) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const pluginName = text(entry.name, 64);
    if (!pluginName || !NAME.test(pluginName)) continue;
    let source: MarketplacePluginEntry["source"] | null = null;
    const raw = entry.source;
    if (typeof raw === "string") {
      const path = raw.startsWith("./") || raw.startsWith("../") || !pluginRoot ? raw : `${pluginRoot.replace(/\/+$/, "")}/${raw}`;
      source = { kind: "path", path };
    } else if (raw && typeof raw === "object") {
      const spec = raw as Record<string, unknown>;
      const ref = typeof spec.ref === "string" ? spec.ref : undefined;
      try {
        if (spec.source === "github" && typeof spec.repo === "string") source = { kind: "git", git: parseGitSource(spec.repo, ref), ...(typeof spec.path === "string" ? { path: spec.path } : {}) };
        else if ((spec.source === "url" || spec.source === "git") && typeof spec.url === "string") source = { kind: "git", git: parseGitSource(spec.url, ref), ...(typeof spec.path === "string" ? { path: spec.path } : {}) };
        else if (spec.source === "git-subdir" && typeof spec.url === "string" && typeof spec.path === "string") source = { kind: "git", git: parseGitSource(spec.url, ref), path: spec.path };
      } catch {
        source = null;
      }
    }
    if (!source) continue;
    plugins.push({
      name: pluginName,
      ...(text(entry.description, 300) ? { description: text(entry.description, 300) } : {}),
      ...(text(entry.version, 40) ? { version: text(entry.version, 40) } : {}),
      ...(text(entry.category, 40) ? { category: text(entry.category, 40) } : {}),
      ...pluginMarks(entry),
      source,
    });
  }
  return { name, ...(description ? { description } : {}), plugins };
}

/** A manifest entry's site and icon, when it declares them. */
function pluginMarks(entry: Record<string, unknown>): Pick<MarketplacePluginEntry, "homepage" | "icon"> {
  const author = entry.author && typeof entry.author === "object" ? entry.author as Record<string, unknown> : {};
  const homepage = manifestUrl(entry.homepage) ?? manifestUrl(author.url);
  const icon = manifestUrl(entry.icon, true) ?? manifestUrl(entry.logo, true);
  return { ...(homepage ? { homepage } : {}), ...(icon ? { icon } : {}) };
}

/** A path inside `root`, or a refusal (no `..`, no absolute path). */
export function insideRoot(root: string, path: string): string {
  const base = resolve(root);
  const target = resolve(base, normalize(path));
  const rel = relative(base, target);
  if (rel === "") return target;
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new BotPluginError("The plugin's path leaves its repository.", "invalid_plugin", 422);
  return target;
}

/** Walk a tree: refuse a repository too large to be a plugin marketplace. */
function measure(dir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) {
        files += 1;
        bytes += lstatSync(path).size;
        if (files > MAX_REPO_FILES || bytes > MAX_REPO_BYTES) throw new BotPluginError("This repository is too large to be a plugin marketplace.", "too_large", 422);
      }
    }
  }
  return { bytes, files };
}

/** Copy one plugin without links, then take out what would run on the
 * server host. Returns what was removed and the MCP servers it declared. */
export function copySanitizedPlugin(from: string, to: string, marketplaceEntry?: Record<string, unknown>, executionRoot = to): { removed: string[]; declaredMcpServers: string[]; mcpServers: Record<string, McpServerSpec>; hooks: LifecycleHook[]; hookFiles: Record<string, string> } {
  if (!existsSync(from) || !statSync(from).isDirectory()) throw new BotPluginError("The plugin's folder is missing from its repository.", "invalid_plugin", 422);
  const captured = capturePluginHooks(from);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(join(to, ".."), { recursive: true });
  cpSync(from, to, {
    recursive: true,
    dereference: false,
    filter: (path) => {
      const stat = lstatSync(path);
      return !stat.isSymbolicLink() && !path.split(sep).includes(".git");
    },
  });
  const removed: string[] = [];
  const declared = new Set<string>();
  const declarations = readPluginMcpServers(to, executionRoot, marketplaceEntry);
  const mcpServers: Record<string, McpServerSpec> = {};
  for (const { name, entry } of declarations.servers) {
    declared.add(name);
    // Validate the execution shape here; the common namespace check at
    // mount decides whether the plugin's declared name is usable.
    const parsed = parseStoredMcpServer("plugin", entry);
    if (!parsed.ok) { removed.push(`MCP server ${name} (${parsed.error})`); continue; }
    const server = parsed.server;
    mcpServers[name] = "url" in server
      ? { type: server.type, url: server.url, headers: server.headers }
      : { command: server.command, args: server.args, env: server.env };
  }
  removed.push(...declarations.skipped);
  const readJson = (file: string): Record<string, unknown> | null => {
    try { const value = JSON.parse(readFileSync(file, "utf8")) as unknown; return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
  };
  const mcpJson = readJson(join(to, ".mcp.json"));
  const mcpBlock = mcpJson && typeof mcpJson.mcpServers === "object" && mcpJson.mcpServers ? mcpJson.mcpServers as Record<string, unknown> : mcpJson;
  for (const name of Object.keys(mcpBlock ?? {})) declared.add(name);
  for (const path of STRIPPED_PATHS) {
    const target = join(to, path);
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
      removed.push(path);
    }
  }
  const manifestPath = join(to, ".claude-plugin", "plugin.json");
  const manifest = readJson(manifestPath) ?? (marketplaceEntry ? { ...marketplaceEntry } : null);
  if (manifest) {
    delete manifest.source;
    for (const key of STRIPPED_MANIFEST_KEYS) {
      if (key in manifest) {
        if (key === "mcpServers" && manifest.mcpServers && typeof manifest.mcpServers === "object") for (const name of Object.keys(manifest.mcpServers)) declared.add(name);
        delete manifest[key];
        removed.push(`plugin.json ${key}`);
      }
    }
    mkdirSync(join(to, ".claude-plugin"), { recursive: true });
    writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2));
  }
  return { removed, declaredMcpServers: [...declared].filter((name) => NAME.test(name)), mcpServers, hooks: captured.hooks, hookFiles: captured.files };
}

// ── git ──────────────────────────────────────────────────────────────────

export type GitRunner = (args: string[], options: { cwd?: string; env: Record<string, string>; timeoutMs: number }) => Promise<void>;

/** What git may read from the server's own environment: its proxy and
 * certificate settings and the operator's git config, nothing else (the
 * server's keys never reach it). */
const GIT_PASSTHROUGH = ["PATH", "HOME", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR", "GIT_SSL_CAINFO", "GIT_CONFIG_GLOBAL"] as const;

export const runGit: GitRunner = (args, options) => new Promise((resolvePromise, reject) => {
  const passthrough = Object.fromEntries(GIT_PASSTHROUGH.flatMap((key) => (process.env[key] ? [[key, process.env[key]!]] : [])));
  execFile("git", args, {
    cwd: options.cwd,
    env: { PATH: "/usr/bin:/bin", HOME: "/tmp", ...passthrough, ...options.env },
    timeout: options.timeoutMs,
    maxBuffer: 1024 * 1024,
  }, (error, _stdout, stderr) => {
    if (!error) return resolvePromise();
    const detail = String(stderr ?? "");
    if (/Authentication failed|could not read Username|terminal prompts disabled|Repository not found|403/i.test(detail)) {
      reject(new BotPluginError("The git host did not let Sagax read this repository. If it is private, connect GitHub on the GitHub plugin's page (Capabilities > Sources > GitHub connection), or add a credential there and pick it for this marketplace.", "repository_unreadable", 422, "connect_or_token"));
      return;
    }
    if (/Could not resolve host|unable to access|timed out|Connection refused/i.test(detail) || (error as { killed?: boolean }).killed) {
      reject(new BotPluginError("The repository could not be reached from the server.", "repository_unreachable", 502));
      return;
    }
    if (/Remote branch .* not found|couldn't find remote ref/i.test(detail)) {
      reject(new BotPluginError("That branch or tag does not exist in the repository.", "invalid_source", 422));
      return;
    }
    reject(new BotPluginError("The repository could not be fetched.", "repository_unreadable", 422));
  });
});

// ── the store ────────────────────────────────────────────────────────────

export interface BotPluginsOptions {
  dataDir: string;
  /** Lot 5: per-bot capability config store. When present and migrated,
   * plugin state and config values read/write here; plugin file trees stay
   * under bot-plugins/<bot>/plugins/. A write through the store also marks
   * the source migrated so a bot created after boot is readable at once. */
  capabilityStore?: {
    present(id: string): boolean;
    hasMigrated(id: string, sourceId: string): boolean;
    markMigrated(id: string, sourceId: string): void;
    plugins(id: string): PluginState;
    setPlugins(id: string, state: PluginState): void;
    pluginValues(id: string): CapabilityPluginValues;
    setPluginValues(id: string, values: CapabilityPluginValues): void;
  };
  /** Another capability scope uses the same installs and update logic,
   * with its own validated ids, folder and state store (personal state is
   * encrypted in capabilities.enc). Nothing writes state.json there. */
  storage?: {
    root(id: string): string;
    ids(): string[];
    read(id: string): PluginState;
    write(id: string, state: PluginState): void;
    values(id: string): CapabilityPluginValues;
    writeValues(id: string, values: CapabilityPluginValues): void;
    /** Prevent a person id from sharing a bot's credential selection. */
    credentialScope(id: string): string;
  };
  /** The installation's one marketplace list. */
  marketplaces: PluginMarketplaces;
  git?: GitRunner;
  /** git environment for a clone without a credential of its own (and the
   * whole environment when `credentials` is absent): the acting person's
   * GitHub token for github.com (githubGitEnvironment), or none. */
  gitEnvironment: (actor: string | undefined) => Record<string, string>;
  /** GitHub credentials to try after the marketplace's own token: the
   * acting person's connection, then the organization's tokens. */
  credentials?: (input: { botId: string; source: GitSource; actor: string | undefined }) => GithubCredential[];
  /** Each marketplace's credential, per bot and source (the one list,
   * server/github-credentials.ts). */
  tokens?: {
    get(botId: string, source: string): string | undefined;
    /** the picked credential with its id and label (for `used`) */
    chosen?(botId: string, source: string): { id: string; label: string; token: string } | undefined;
    /** pick a credential of the list (null: Automatic) */
    choose?(botId: string, source: string, credential: string | null): void;
    /** a credential's token, when `actor` may use it (their own or the organization's) */
    usable?(credential: string, actor: string | undefined): { id: string; label: string; token: string } | undefined;
    /** what read a marketplace last */
    noteUsed?(botId: string, source: string, used: { via: "person" | "credential" | "none"; credential?: string; login?: string }): void;
    describe?(botId: string, source: string, viewer: string | undefined): MarketplaceCredentialView;
    /** back to Automatic (the marketplace left); a credential kept for it alone goes too */
    remove(botId: string, source: string): boolean;
    sourcesFor(botId: string): Set<string>;
    forgetBot(botId: string): void;
  };
  /** GitHub's answer for a repository (tests stand in for api.github.com). */
  probe?: (repo: { owner: string; repo: string }, credentials: readonly GithubCredential[]) => Promise<GithubProbe>;
  policy: () => MarketplacePolicy | undefined;
  now?: () => number;
}

function readStateFile(file: string): PluginState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const current = stateSchema.safeParse(raw);
  if (current.success) return current.data;
  // Not migrated yet (or the migration failed for this bot): its installs
  // still count; its own marketplaces are the migration's to take in.
  const legacy = legacyStateSchema.safeParse(raw);
  return legacy.success ? { version: 2, plugins: legacy.data.plugins } : null;
}

/** A token for a git host other than GitHub, as an extra header for that
 * origin only (basic auth, the token as the password). */
export function hostGitEnvironment(url: string, token: string | undefined): Record<string, string> {
  const base = githubGitEnvironment(undefined);
  if (!token) return base;
  const origin = new URL(url).origin;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return { ...base, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `http.${origin}/.extraheader`, GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}` };
}

export class BotPlugins {
  private readonly options: BotPluginsOptions;
  private readonly git: GitRunner;
  private readonly now: () => number;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(options: BotPluginsOptions) {
    this.options = options.storage && options.tokens
      ? { ...options, tokens: scopedPluginTokens(options.tokens, (id) => id === WORKSPACE_TOKEN_KEY ? id : options.storage!.credentialScope(id)) }
      : options;
    this.git = options.git ?? runGit;
    this.now = options.now ?? Date.now;
  }

  private root(botId: string): string {
    if (this.options.storage) return this.options.storage.root(botId);
    if (!BOT_ID.test(botId)) throw new BotPluginError("invalid bot", "invalid_bot");
    return join(this.options.dataDir, "bot-plugins", botId);
  }

  private read(botId: string): PluginState {
    if (this.options.storage) return stateSchema.parse(this.options.storage.read(botId));
    const store = this.options.capabilityStore;
    if (store?.present(botId) && store.hasMigrated(botId, "bot-plugins-state")) {
      return stateSchema.parse(store.plugins(botId));
    }
    return readStateFile(join(this.root(botId), "state.json")) ?? { version: 2, plugins: {} };
  }

  private write(botId: string, state: PluginState): void {
    if (this.options.storage) {
      this.options.storage.write(botId, stateSchema.parse(state));
      return;
    }
    const parsed = stateSchema.parse(state);
    const store = this.options.capabilityStore;
    if (store) {
      store.setPlugins(botId, parsed);
      if (!store.hasMigrated(botId, "bot-plugins-state")) store.markMigrated(botId, "bot-plugins-state");
      return;
    }
    mkdirSync(this.root(botId), { recursive: true, mode: 0o700 });
    writeFileAtomic(join(this.root(botId), "state.json"), JSON.stringify(parsed, null, 2));
  }

  private validId(id: string): boolean {
    if (!this.options.storage) return BOT_ID.test(id);
    try { this.root(id); return true; } catch { return false; }
  }

  private values(id: string): CapabilityPluginValues {
    if (this.options.storage) return this.options.storage.values(id);
    const store = this.options.capabilityStore;
    if (store?.present(id) && store.hasMigrated(id, "bot-plugins-config")) {
      return store.pluginValues(id);
    }
    return readConfigValues(this.configFile(id));
  }

  private writeValues(id: string, values: CapabilityPluginValues): void {
    if (this.options.storage) {
      this.options.storage.writeValues(id, values);
      return;
    }
    const store = this.options.capabilityStore;
    if (store) {
      store.setPluginValues(id, values);
      if (!store.hasMigrated(id, "bot-plugins-config")) store.markMigrated(id, "bot-plugins-config");
      return;
    }
    writeConfigValues(this.configFile(id), values);
  }

  private withLock<T>(botId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(botId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.locks.set(botId, next.catch(() => undefined));
    return next;
  }

  /** The git environment that reads `source` for this bot, or the reason
   * nothing can. `marketplaceSource` names whose saved token applies (a
   * plugin in another repository uses its marketplace's token). */
  private async cloneEnvironment(botId: string, source: GitSource, actor: string | undefined, options: { credential?: { id: string; label: string; token: string }; marketplaceSource?: string }): Promise<Record<string, string>> {
    const key = options.marketplaceSource ?? source.id;
    // the credential this bot picks first, then the installation's (Everyone scope)
    const tokens = this.options.tokens;
    const pick = (scope: string) => tokens?.chosen?.(scope, key) ?? (() => {
      const token = tokens?.get(scope, key);
      return token ? { id: "", label: "", token } : undefined;
    })();
    const picked = options.credential ?? pick(botId) ?? (botId === WORKSPACE_TOKEN_KEY ? undefined : pick(WORKSPACE_TOKEN_KEY));
    const saved = picked?.token;
    const note = (credential: GithubCredential | null) => {
      if (!tokens?.noteUsed) return;
      const via = !credential ? "none" as const : credential.via === "person" ? "person" as const : "credential" as const;
      const id = credential?.id || (credential?.token === picked?.token ? picked?.id : undefined);
      tokens.noteUsed(botId, key, { via, ...(id ? { credential: id } : {}), ...(credential?.login ? { login: credential.login } : {}) });
    };
    if (!source.github) {
      if (saved) note({ token: saved, via: "marketplace", ...(picked?.id ? { id: picked.id } : {}) });
      return saved ? hostGitEnvironment(source.url, saved) : this.options.gitEnvironment(undefined);
    }
    if (!this.options.credentials && !saved) return this.options.gitEnvironment(actor);
    const credentials: GithubCredential[] = [
      ...(saved ? [{ token: saved, via: "marketplace" as const, ...(picked?.label ? { label: picked.label } : {}), ...(picked?.id ? { id: picked.id } : {}) }] : []),
      ...(this.options.credentials?.({ botId, source, actor }) ?? []),
    ];
    const probe = await (this.options.probe ?? ((repo, list) => probeGithubRepo(repo, list)))(source.github, credentials);
    if (probe.ok === false) throw new BotPluginError(probe.failure.message, probe.failure.code, probe.failure.status, probe.failure.fix);
    if (probe.ok === true) note(probe.credential);
    return githubGitEnvironment(probe.credential?.token);
  }

  private async clone(source: GitSource, into: string, env: Record<string, string>): Promise<void> {
    const staging = `${into}.tmp-${process.pid}-${this.now()}`;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(join(staging, ".."), { recursive: true });
    try {
      await this.git(["clone", "--depth", "1", "--single-branch", "--no-tags", ...(source.ref ? ["--branch", source.ref] : []), "--", source.url, staging], {
        env, timeoutMs: GIT_TIMEOUT_MS,
      });
      measure(staging);
      rmSync(into, { recursive: true, force: true });
      renameSync(staging, into);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  private checkPolicy(source: GitSource): void {
    if (!marketplaceAllowed(this.options.policy(), source)) {
      throw new BotPluginError(`Your organization does not allow plugins from ${source.id}. An administrator can add it in Capabilities > Sources (allowed marketplaces).`, "marketplace_not_allowed", 403);
    }
  }

  /** Whether this viewer may see and use a marketplace of the one list. */
  canAccessMarketplace(name: string, viewer?: MarketplaceViewer): boolean {
    return this.options.marketplaces.canAccess(name, viewer);
  }

  /** The installation's marketplaces this `viewer` may see, with what this
   * bot has from each. A private marketplace is listed to its author only. */
  listMarketplaces(botId: string, viewer?: MarketplaceViewer): MarketplaceListing[] {
    const describe = (source: string): MarketplaceCredentialView | undefined => {
      try { return this.options.tokens?.describe?.(botId, source, viewer?.principal); } catch { return undefined; }
    };
    const state = this.read(botId);
    let tokenSources = new Set<string>();
    try { tokenSources = this.options.tokens?.sourcesFor(botId) ?? new Set(); } catch { /* listed without the flag */ }
    return this.options.marketplaces.list(viewer).map((market) => {
      let plugins: MarketplaceListing["plugins"] = [];
      try {
        const repo = this.options.marketplaces.repoPath(market.name);
        const manifestOnly = Boolean(this.options.marketplaces.record(market.name)?.manifestUrl);
        plugins = readMarketplaceManifest(repo).plugins.map((entry) => {
          const installed = state.plugins[`${entry.name}@${market.name}`];
          // the same rule as the workspace scope (pluginUpdateAvailable):
          // another declared version, or the same version with other files
          const offered = installed ? this.options.marketplaces.revisionOf(market.name, entry) : undefined;
          const update = Boolean(installed && pluginUpdateAvailable(installed, { version: entry.version, revision: offered }));
          let contents: PluginContents | undefined;
          if (entry.source.kind === "path" && !manifestOnly) {
            try { contents = readPluginContents(insideRoot(repo, entry.source.path)); } catch { contents = undefined; }
          }
          return {
            name: entry.name,
            ...(entry.description ? { description: entry.description } : {}),
            ...(entry.version ? { version: entry.version } : {}),
            ...(entry.category ? { category: entry.category } : {}),
            ...(entry.homepage ? { homepage: entry.homepage } : {}),
            ...(entry.icon ? { icon: entry.icon } : {}),
            installed: Boolean(installed),
            ...(installed?.version && installed.version !== entry.version ? { installedVersion: installed.version } : {}),
            ...(update ? { updateAvailable: true } : {}),
            external: entry.source.kind === "git",
            ...(contents ? { contents } : {}),
          };
        });
      } catch {
        plugins = [];
      }
      return {
        name: market.name, source: market.source, hasToken: tokenSources.has(market.source),
        ...((): { credential?: MarketplaceCredentialView } => {
          const credential = describe(market.source);
          return credential && (credential.chosen || credential.used) ? { credential } : {};
        })(),
        visibility: market.visibility, mine: market.mine,
        ...(market.description ? { description: market.description } : {}), addedAt: market.addedAt, updatedAt: market.updatedAt, plugins,
      };
    });
  }

  listPlugins(botId: string): InstalledBotPlugin[] {
    const values = this.values(botId);
    return Object.entries(this.read(botId).plugins).map(([key, record]) => {
      const fields = readPluginConfigFields(this.pluginDir(botId, record.marketplace, record.name));
      return { key, ...listedPlugin(record), ...(fields.length ? { config: { fields, values: values[key] ?? {} } } : {}) };
    }).sort((a, b) => a.key.localeCompare(b.key));
  }

  private configFile(botId: string): string {
    return join(this.root(botId), "plugins", "config.json");
  }

  /** Save a plugin's configuration values for this bot and write them into
   * its skills, agents and commands (server/plugin-config.ts). */
  setPluginConfig(botId: string, key: string, input: unknown): Promise<InstalledBotPlugin> {
    return this.withLock(botId, async () => {
      const record = this.read(botId).plugins[key];
      if (!record) throw new BotPluginError("No plugin with that name on this bot.", "not_found", 404);
      const dir = this.pluginDir(botId, record.marketplace, record.name);
      const fields = readPluginConfigFields(dir);
      if (!fields.length) throw new BotPluginError("This plugin declares no configuration.", "no_config", 400);
      const checked = checkPluginConfig(fields, input);
      if (!checked.ok) throw new BotPluginError(checked.error, checked.code, 400);
      const all = this.values(botId);
      all[key] = checked.values;
      this.writeValues(botId, all);
      applyPluginConfig(dir, fields, checked.values);
      // The values are written into the plugin's files: refresh discovery
      // metadata now rather than leaving every turn on the bounded scan.
      try { rebuildPluginMetaCache(pluginMetadataCacheRoot(this.options.dataDir), dir); } catch { /* turn reports partial on miss */ }
      return { key, ...listedPlugin(record), config: { fields, values: checked.values } };
    });
  }

  /** Add (or fetch again) a marketplace of the one list, from a bot. The
   * clone reads with the credential this bot picks for it (a `credential`
   * sent here is tried first and picked once the clone works), then the
   * person's GitHub connection, then their other credentials and the
   * organization's (`cloneEnvironment`). */
  async addMarketplace(botId: string, input: { source: string; ref?: string; credential?: string; visibility?: MarketplaceVisibility }, actor: string | undefined): Promise<MarketplaceListing> {
    this.root(botId);
    const credential = input.credential ? this.usableCredential(input.credential, actor) : undefined;
    let cloned: GitSource | undefined;
    const added = await this.options.marketplaces.add({ source: input.source, ...(input.ref ? { ref: input.ref } : {}) }, actor, {
      ...(input.visibility ? { visibility: input.visibility } : {}),
      ...(actor ? { viewer: { principal: actor } } : {}),
      environment: async (source) => {
        const env = await this.cloneEnvironment(botId, source, actor, credential ? { credential } : {});
        cloned = source;
        return env;
      },
    });
    // A manifest address is read over https without a credential: none is picked.
    if (credential && cloned) this.options.tokens!.choose!(botId, added.source, credential.id);
    return this.listMarketplaces(botId).find((listing) => listing.name === added.name)!;
  }

  /** A credential of the list `actor` may pick: their own or the organization's. */
  private usableCredential(id: string, actor: string | undefined): { id: string; label: string; token: string } {
    if (!this.options.tokens?.usable || !this.options.tokens.choose) throw new BotPluginError("This server cannot keep credentials.", "tokens_unavailable", 503);
    const credential = this.options.tokens.usable(id, actor);
    if (!credential) throw new BotPluginError("No credential with that id.", "credential_not_found", 404);
    return credential;
  }

  /** Pick a credential of the one list for a marketplace on this bot, or
   * (null) Automatic. The owner or a manager of the bot, no admin; the
   * credential is the actor's own or the organization's. */
  chooseMarketplaceCredential(botId: string, name: string, credential: string | null, actor: string | undefined): MarketplaceListing {
    this.root(botId);
    const record = this.options.marketplaces.record(name);
    if (!record) throw new BotPluginError("No marketplace with that name.", "not_found", 404);
    if (record.manifestUrl) throw new BotPluginError("A marketplace added by the address of its marketplace.json is read without a token.", "manifest_only", 422);
    if (credential !== null) this.usableCredential(credential, actor);
    if (!this.options.tokens?.choose) throw new BotPluginError("This server cannot keep credentials.", "tokens_unavailable", 503);
    this.options.tokens.choose(botId, record.source, credential);
    return this.listMarketplaces(botId).find((listing) => listing.name === name)!;
  }

  /** Pull a marketplace again (its plugins' new versions are offered; the
   * installed ones change only on their own update). */
  async updateMarketplace(botId: string, name: string, actor: string | undefined): Promise<MarketplaceListing> {
    this.root(botId);
    if (!this.options.marketplaces.record(name)) throw new BotPluginError("No marketplace with that name.", "not_found", 404);
    // read with this bot's token for it first, as Add does
    await this.options.marketplaces.refresh(name, actor, { environment: (source) => this.cloneEnvironment(botId, source, actor, {}) });
    return this.listMarketplaces(botId).find((listing) => listing.name === name)!;
  }

  /** Take this bot's plugins of a marketplace off it. The marketplace itself
   * leaves the one list only when `removeShared` says the person may remove
   * it (an admin, or the person who added it) and nothing else uses it. */
  removeMarketplace(botId: string, name: string, options: { actor?: string; mayManage?: boolean } = {}): Promise<{ sharedRemoved: boolean }> {
    return this.withLock(botId, async () => {
      const state = this.read(botId);
      const record = this.options.marketplaces.record(name);
      const mine = Object.entries(state.plugins).filter(([, plugin]) => plugin.marketplace === name);
      if (!record && !mine.length) throw new BotPluginError("No marketplace with that name.", "not_found", 404);
      for (const [key, plugin] of mine) {
        const dir = this.pluginDir(botId, plugin.marketplace, plugin.name);
        invalidatePluginMetaCache(pluginMetadataCacheRoot(this.options.dataDir), dir);
        rmSync(dir, { recursive: true, force: true });
        delete state.plugins[key];
      }
      if (mine.length) this.write(botId, state);
      // This bot's token for it goes with Remove, as it did per bot.
      if (record) {
        try { this.options.tokens?.remove(botId, record.source); } catch { /* the plugins are gone either way */ }
      }
      const mayRemove = Boolean(record) && (options.mayManage === true || (Boolean(options.actor) && record?.addedBy === options.actor));
      if (!mayRemove) return { sharedRemoved: false };
      try {
        await this.options.marketplaces.remove(name);
        return { sharedRemoved: true };
      } catch (error) {
        if (error instanceof BotPluginError && (error.code === "has_plugins" || error.code === "in_use")) return { sharedRemoved: false };
        throw error;
      }
    });
  }

  private pluginDir(botId: string, marketplace: string, plugin: string): string {
    if (!NAME.test(marketplace) || !NAME.test(plugin)) throw new BotPluginError("invalid plugin", "invalid_plugin");
    return join(this.root(botId), "plugins", marketplace, plugin);
  }

  /** Install (or update) one plugin of a marketplace of the one list. */
  install(botId: string, input: { marketplace: string; plugin: string }, actor: string | undefined): Promise<InstalledBotPlugin> {
    return this.withLock(botId, async () => {
      const state = this.read(botId);
      const market = this.options.marketplaces.record(input.marketplace);
      if (!market) throw new BotPluginError("Add the marketplace in Capabilities first.", "not_found", 404);
      const key = `${input.plugin}@${input.marketplace}`;
      if (!state.plugins[key] && Object.keys(state.plugins).length >= MAX_PLUGINS) throw new BotPluginError(`A bot can have at most ${MAX_PLUGINS} plugins.`, "too_many", 400);
      const marketRoot = this.options.marketplaces.repoPath(input.marketplace);
      const manifest = readMarketplaceManifest(marketRoot);
      const entry = manifest.plugins.find((candidate) => candidate.name === input.plugin);
      if (!entry) throw new BotPluginError("That plugin is not in this marketplace.", "not_found", 404);
      if (entry.source.kind === "path" && market.manifestUrl) {
        throw new BotPluginError("This marketplace was added by the address of its marketplace.json: its plugins' folders cannot be read. Add its repository instead to install a plugin for one bot.", "manifest_only", 422);
      }
      const rawEntry = (() => {
        try {
          const all = JSON.parse(readFileSync(join(marketRoot, ".claude-plugin", "marketplace.json"), "utf8")) as { plugins?: Array<Record<string, unknown>> };
          return all.plugins?.find((candidate) => candidate.name === input.plugin);
        } catch { return undefined; }
      })();
      const target = this.pluginDir(botId, input.marketplace, input.plugin);
      let result: ReturnType<typeof copySanitizedPlugin>;
      const executionRoot = `${SANDBOX_PLUGINS_DIR}/${input.plugin}`;
      if (entry.source.kind === "path") {
        result = copySanitizedPlugin(insideRoot(marketRoot, entry.source.path), target, rawEntry, executionRoot);
      } else {
        // #1098: a private marketplace (its author's own) for a bot is not
        // held to the organization's list; a shared one is
        if (market.visibility === "org") this.checkPolicy(entry.source.git);
        const checkout = join(this.root(botId), "plugins", ".checkout");
        await this.clone(entry.source.git, checkout, await this.cloneEnvironment(botId, entry.source.git, actor, { marketplaceSource: market.source }));
        try {
          result = copySanitizedPlugin(entry.source.path ? insideRoot(checkout, entry.source.path) : checkout, target, rawEntry, executionRoot);
        } finally {
          rmSync(checkout, { recursive: true, force: true });
        }
      }
      // the copy is fresh: this bot's values (or the defaults) go in again
      const fields = readPluginConfigFields(target);
      if (fields.length) applyPluginConfig(target, fields, this.values(botId)[key] ?? {});
      const now = this.now();
      const previous = state.plugins[key];
      const revision = this.options.marketplaces.revisionOf(input.marketplace, entry);
      state.plugins[key] = {
        name: input.plugin, marketplace: input.marketplace,
        ...(entry.description ? { description: entry.description } : {}),
        ...(entry.version ? { version: entry.version } : {}),
        ...(revision ? { revision } : {}),
        enabled: previous?.enabled ?? true,
        installedAt: previous?.installedAt ?? now,
        ...(previous?.installedBy ?? actor ? { installedBy: previous?.installedBy ?? actor } : {}),
        updatedAt: now,
        removed: result.removed,
        declaredMcpServers: result.declaredMcpServers,
        mcpServers: result.mcpServers,
        ...(result.hooks.length ? { lifecycleHooks: result.hooks.length } : {}),
      };
      this.writeHookBundle(botId, key, result.hooks, result.hookFiles);
      this.write(botId, state);
      // Exhaustive discovery metadata for API and file engines. Built only on
      // install/update; the turn hot path never rewalks the tree.
      try { rebuildPluginMetaCache(pluginMetadataCacheRoot(this.options.dataDir), target); } catch { /* turn reports partial on miss */ }
      return { key, ...listedPlugin(state.plugins[key]!) };
    });
  }

  private hookDir(botId: string, key: string): string {
    const safe = key.replace(/[^A-Za-z0-9._-]/g, "_");
    return join(this.root(botId), "computer-hooks", safe);
  }

  /** Hook files sit beside the plugin folder Claude loads, never inside it. */
  private writeHookBundle(botId: string, key: string, hooks: LifecycleHook[], files: Record<string, string>): void {
    const dir = this.hookDir(botId, key);
    rmSync(dir, { recursive: true, force: true });
    if (!hooks.length) return;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileAtomic(join(dir, "manifest.json"), `${JSON.stringify({ hooks })}\n`, { mode: 0o600 });
    for (const [name, body] of Object.entries(files)) {
      if (name.includes("..") || name.startsWith("/")) continue;
      const file = join(dir, "files", name);
      mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
      writeFileAtomic(file, body, { mode: 0o600 });
    }
  }

  lifecycleHookView(botId: string): { enabled: boolean; events: string[] } {
    const state = this.read(botId);
    const events = new Set<string>();
    for (const hook of this.hooksOf(botId)) events.add(hook.event);
    return { enabled: state.lifecycleHooksEnabled === true, events: [...events].sort() };
  }

  setLifecycleHooksEnabled(botId: string, enabled: boolean): { enabled: boolean; events: string[] } {
    const state = this.read(botId);
    state.lifecycleHooksEnabled = enabled;
    this.write(botId, state);
    return this.lifecycleHookView(botId);
  }

  /** Enabled plugins' hook commands, and the files that belong with them.
   * Empty when the owner has not turned hooks on. */
  hooksOf(botId: string): LifecycleHook[] {
    if (!this.validId(botId)) return [];
    const state = this.read(botId);
    const out: LifecycleHook[] = [];
    for (const [key, record] of Object.entries(state.plugins)) {
      if (!record.enabled) continue;
      try {
        const raw = JSON.parse(readFileSync(join(this.hookDir(botId, key), "manifest.json"), "utf8")) as { hooks?: LifecycleHook[] };
        if (Array.isArray(raw.hooks)) out.push(...raw.hooks);
      } catch { /* no hooks kept */ }
    }
    return out;
  }

  /** Script files kept beside the plugins, for the computer to stage. */
  hookFiles(botId: string): Record<string, string> {
    if (!this.validId(botId)) return {};
    const root = join(this.root(botId), "computer-hooks");
    const out: Record<string, string> = {};
    const walk = (dir: string, prefix: string) => {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.isSymbolicLink() || Object.keys(out).length >= 20) continue;
        const path = join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path, rel);
        else if (entry.isFile() && entry.name !== "manifest.json") {
          try {
            const info = statSync(path);
            if (info.isFile() && info.size <= 64 * 1024) out[rel] = readFileSync(path, "utf8");
          } catch { /* skip */ }
        }
      }
    };
    walk(root, "");
    return out;
  }

  lifecycleHooksEnabled(botId: string): boolean {
    if (!this.validId(botId)) return false;
    return this.read(botId).lifecycleHooksEnabled === true;
  }

  hookRoot(botId: string, key: string): string {
    return join(this.hookDir(botId, key), "files");
  }

  setEnabled(botId: string, key: string, enabled: boolean): InstalledBotPlugin {
    const state = this.read(botId);
    const record = state.plugins[key];
    if (!record) throw new BotPluginError("No plugin with that name on this bot.", "not_found", 404);
    state.plugins[key] = { ...record, enabled };
    this.write(botId, state);
    return { key, ...listedPlugin(state.plugins[key]!) };
  }

  uninstall(botId: string, key: string): Promise<void> {
    return this.withLock(botId, async () => {
      const state = this.read(botId);
      const record = state.plugins[key];
      if (!record) throw new BotPluginError("No plugin with that name on this bot.", "not_found", 404);
      const dir = this.pluginDir(botId, record.marketplace, record.name);
      invalidatePluginMetaCache(pluginMetadataCacheRoot(this.options.dataDir), dir);
      rmSync(dir, { recursive: true, force: true });
      rmSync(this.hookDir(botId, key), { recursive: true, force: true });
      delete state.plugins[key];
      this.write(botId, state);
      const values = this.values(botId);
      if (values[key]) {
        delete values[key];
        this.writeValues(botId, values);
      }
    });
  }

  /** One installed plugin's folder (what a turn loads) and whether it is
   * there: the capabilities list (server/capabilities.ts) reads it. */
  installedFolder(botId: string, plugin: { marketplace: string; name: string }): { dir: string; present: boolean } {
    const dir = this.pluginDir(botId, plugin.marketplace, plugin.name);
    return { dir, present: existsSync(dir) };
  }

  /** Enabled plugin folders. Claude loads them with `--plugin-dir`. */
  pluginDirs(botId: string): string[] {
    if (!this.validId(botId)) return [];
    return this.listPlugins(botId)
      .filter((plugin) => plugin.enabled)
      .map((plugin) => this.pluginDir(botId, plugin.marketplace, plugin.name))
      .filter((dir) => existsSync(dir));
  }

  /** Enabled plugins by name and folder: what the bot may read as
   * `plugins/<name>/...` (workspace_read) and what is copied into its
   * owner's cloud computer. A name two marketplaces share is listed once. */
  enabledPlugins(botId: string): Array<{ name: string; dir: string }> {
    if (!this.validId(botId)) return [];
    const out: Array<{ name: string; dir: string }> = [];
    for (const plugin of this.listPlugins(botId)) {
      if (!plugin.enabled || out.some((row) => row.name === plugin.name)) continue;
      const dir = this.pluginDir(botId, plugin.marketplace, plugin.name);
      if (existsSync(dir)) out.push({ name: plugin.name, dir });
    }
    return out;
  }

  /** Internal only: execution specs never enter a listing or a route
   * response. Each caller mounts them in the turn person's environment. */
  mcpServers(botId: string): Array<{ key: string; plugin: string; name: string; spec: McpServerSpec }> {
    const state = this.read(botId);
    return Object.entries(state.plugins).flatMap(([key, plugin]) => {
      if (!plugin.enabled || !existsSync(this.pluginDir(botId, plugin.marketplace, plugin.name))) return [];
      return Object.entries(plugin.mcpServers ?? {}).flatMap(([name, spec]) => {
        // A restored package is untrusted too. Apply the same environment
        // and header checks as an install before exposing an execution spec.
        const parsed = parseStoredMcpServer("plugin", spec);
        if (!parsed.ok) return [];
        return [{ key, plugin: plugin.name, name, spec }];
      });
    });
  }

  /** The bots with at least one plugin from this marketplace. */
  botsUsing(marketplace: string): string[] {
    const base = join(this.options.dataDir, "bot-plugins");
    let bots: string[];
    try { bots = this.options.storage?.ids() ?? readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory() && BOT_ID.test(entry.name)).map((entry) => entry.name); } catch { return []; }
    return bots.filter((botId) => Object.values(this.read(botId).plugins).some((plugin) => plugin.marketplace === marketplace)).sort();
  }

  /** The bot's own plugin folder (state.json, plugins/; marketplaces/ only
   * while a bot package is restored). */
  folder(botId: string): string {
    return this.root(botId);
  }

  /** A marketplace's files in the one list (its .claude-plugin/marketplace.json). */
  marketplaceFolder(name: string): string {
    return this.options.marketplaces.repoPath(name);
  }

  /** The state a bot package carries (server/bot-zip.ts): its installs and
   * the marketplaces of the one list they come from, or this bot has a
   * token for, in the per-bot format an older build reads too. */
  stateFor(botId: string): LegacyPluginState {
    const state = this.read(botId);
    let tokenSources = new Set<string>();
    try { tokenSources = this.options.tokens?.sourcesFor(botId) ?? new Set(); } catch { /* without the token-only ones */ }
    const used = new Set(Object.values(state.plugins).map((plugin) => plugin.marketplace));
    const marketplaces: LegacyPluginState["marketplaces"] = {};
    for (const market of this.options.marketplaces.list()) {
      if (!used.has(market.name) && !tokenSources.has(market.source)) continue;
      const record = this.options.marketplaces.record(market.name);
      if (!record) continue;
      marketplaces[market.name] = {
        source: record.source, url: record.manifestUrl ?? record.url, ...(record.ref ? { ref: record.ref } : {}),
        ...(record.description ? { description: record.description } : {}),
        addedAt: record.addedAt, ...(record.addedBy ? { addedBy: record.addedBy } : {}), updatedAt: record.updatedAt,
      };
    }
    const plugins = Object.fromEntries(Object.entries(state.plugins).map(([key, plugin]) => [key, {
      ...plugin,
      ...(plugin.mcpServers ? { mcpServers: Object.fromEntries(Object.entries(plugin.mcpServers).map(([name, spec]) => [name,
        "url" in spec ? { ...spec, headers: {} } : { ...spec, env: {} },
      ])) } : {}),
    }]));
    return structuredClone({ version: 1 as const, marketplaces, plugins });
  }

  /** Restore a bot package's state on a new bot whose plugin files (and the
   * marketplace.json of each marketplace, under marketplaces/<name>/) are
   * already in place. Each marketplace joins the one list as the boot
   * migration takes one in (the same source is reused, a clash is renamed);
   * one the organization does not allow is dropped with its plugins. A
   * plugin whose folder is missing is dropped; a marketplace keeps its
   * record (Update fetches it again). */
  restoreState(botId: string, value: unknown): { marketplaces: string[]; plugins: string[] } {
    const root = this.root(botId);
    const parsed = legacyStateSchema.safeParse(value);
    const current = parsed.success ? null : stateSchema.safeParse(value);
    if (!parsed.success && !current?.success) return { marketplaces: [], plugins: [] };
    const incoming: LegacyPluginState = parsed.success ? parsed.data : { version: 1, marketplaces: {}, plugins: current!.data!.plugins };
    const state: LegacyPluginState = { version: 1, marketplaces: {}, plugins: {} };
    for (const [name, record] of Object.entries(incoming.marketplaces).slice(0, MAX_RESTORED_MARKETPLACES)) {
      if (!NAME.test(name)) continue;
      try {
        const git = MANIFEST_URL.test(record.url) ? undefined : parseGitSource(record.source.includes("://") ? record.url : record.source, record.ref);
        if (git && !marketplaceAllowed(this.options.policy(), git)) continue;
      } catch {
        continue;
      }
      state.marketplaces[name] = record;
    }
    for (const [key, record] of Object.entries(incoming.plugins).slice(0, MAX_PLUGINS)) {
      if (!NAME.test(record.name) || !NAME.test(record.marketplace) || key !== `${record.name}@${record.marketplace}`) continue;
      const known = Boolean(state.marketplaces[record.marketplace]) || Boolean(this.options.marketplaces.record(record.marketplace));
      if (!known || !existsSync(this.pluginDir(botId, record.marketplace, record.name))) continue;
      state.plugins[key] = record;
    }
    const moved = moveBotIntoOneList(root, state, this.options.marketplaces, this.options.storage ? (next) => this.write(botId, next) : undefined);
    return { marketplaces: [...new Set(moved.names.values())].sort(), plugins: Object.keys(moved.plugins).sort() };
  }

  // The "Everyone" scope of Capabilities (server/routes/marketplaces.ts):
  // the installation's own token per marketplace, kept under the
  // `workspace` key. The same order as a bot: this token, then the acting
  // person's GitHub connection, then the organization's tokens.

  /** Sources the installation keeps a token for (names only). */
  workspaceTokenSources(): Set<string> {
    try {
      return this.options.tokens?.sourcesFor(WORKSPACE_TOKEN_KEY) ?? new Set();
    } catch {
      return new Set();
    }
  }

  /** The git environment reading `source` for the Everyone scope. */
  workspaceEnvironment(source: GitSource, actor: string | undefined): Promise<Record<string, string>> {
    return this.cloneEnvironment(WORKSPACE_TOKEN_KEY, source, actor, {});
  }

  /** Add (or fetch again) a marketplace for everyone; a `credential` sent
   * here is tried first and picked for the installation once the clone works. */
  async addWorkspaceMarketplace(input: { source: string; ref?: string; credential?: string; visibility?: MarketplaceVisibility }, actor: string | undefined) {
    const credential = input.credential ? this.usableCredential(input.credential, actor) : undefined;
    let cloned = false;
    const added = await this.options.marketplaces.add({ source: input.source, ...(input.ref ? { ref: input.ref } : {}) }, actor, {
      ...(input.visibility ? { visibility: input.visibility } : {}),
      environment: async (source) => {
        const env = credential
          ? await this.cloneEnvironment(WORKSPACE_TOKEN_KEY, source, actor, { credential })
          : await this.workspaceEnvironment(source, actor);
        cloned = true;
        return env;
      },
    });
    // A manifest address is read over https without a credential: none is picked.
    if (credential && cloned) this.options.tokens!.choose!(WORKSPACE_TOKEN_KEY, added.source, credential.id);
    return added;
  }

  /** Fetch a marketplace again for everyone, with the installation's pick first. */
  refreshWorkspaceMarketplace(name: string, actor: string | undefined) {
    if (!this.options.marketplaces.record(name)) throw new BotPluginError("No marketplace with that name.", "not_found", 404);
    return this.options.marketplaces.refresh(name, actor, { environment: (source) => this.workspaceEnvironment(source, actor) });
  }

  /** Pick a credential of the one list for a marketplace for everyone, or
   * (null) Automatic. The workspace's managers (the route checks). */
  chooseWorkspaceMarketplaceCredential(name: string, credential: string | null, actor: string | undefined): void {
    const record = this.options.marketplaces.record(name);
    if (!record) throw new BotPluginError("No marketplace with that name.", "not_found", 404);
    if (record.manifestUrl) throw new BotPluginError("A marketplace added by the address of its marketplace.json is read without a token.", "manifest_only", 422);
    if (credential !== null) this.usableCredential(credential, actor);
    if (!this.options.tokens?.choose) throw new BotPluginError("This server cannot keep credentials.", "tokens_unavailable", 503);
    this.options.tokens.choose(WORKSPACE_TOKEN_KEY, record.source, credential);
  }

  /** The Everyone scope's credential view of a marketplace. */
  workspaceCredential(source: string, viewer: string | undefined): MarketplaceCredentialView | undefined {
    try {
      const view = this.options.tokens?.describe?.(WORKSPACE_TOKEN_KEY, source, viewer);
      return view && (view.chosen || view.used) ? view : undefined;
    } catch {
      return undefined;
    }
  }

  /** Remove a marketplace from the one list, and the installation's token for it. */
  async removeWorkspaceMarketplace(name: string): Promise<void> {
    const source = this.options.marketplaces.record(name)?.source;
    await this.options.marketplaces.remove(name);
    if (source) {
      try { this.options.tokens?.remove(WORKSPACE_TOKEN_KEY, source); } catch { /* the marketplace is gone either way */ }
    }
  }

  /** Forget everything of a deleted bot. */
  forgetBot(botId: string): void {
    if (!this.validId(botId)) return;
    try { this.options.tokens?.forgetBot(botId); } catch { /* the folder still goes */ }
    // Read before the reset below so their discovery metadata goes too.
    let installed: Array<{ marketplace: string; name: string }> = [];
    try { installed = Object.values(this.read(botId).plugins); } catch { /* nothing readable to forget */ }
    for (const plugin of installed) {
      try { invalidatePluginMetaCache(pluginMetadataCacheRoot(this.options.dataDir), this.pluginDir(botId, plugin.marketplace, plugin.name)); } catch { /* invalid name: no cache */ }
    }
    if (this.options.storage) {
      this.write(botId, { version: 2, plugins: {} });
      this.writeValues(botId, {});
    }
    rmSync(this.root(botId), { recursive: true, force: true });
  }
}

/** Credential picks follow the capability scope too; a person's id and a
 * bot id are allowed to have the same spelling without sharing a pick. */
function scopedPluginTokens(tokens: NonNullable<BotPluginsOptions["tokens"]>, scope: (id: string) => string): NonNullable<BotPluginsOptions["tokens"]> {
  return {
    ...tokens,
    get: (id, source) => tokens.get(scope(id), source),
    ...(tokens.chosen ? { chosen: (id: string, source: string) => tokens.chosen!(scope(id), source) } : {}),
    ...(tokens.choose ? { choose: (id: string, source: string, credential: string | null) => tokens.choose!(scope(id), source, credential) } : {}),
    ...(tokens.noteUsed ? { noteUsed: (id: string, source: string, used: Parameters<NonNullable<typeof tokens.noteUsed>>[2]) => tokens.noteUsed!(scope(id), source, used) } : {}),
    ...(tokens.describe ? { describe: (id: string, source: string, viewer: string | undefined) => tokens.describe!(scope(id), source, viewer) } : {}),
    remove: (id, source) => tokens.remove(scope(id), source),
    sourcesFor: (id) => tokens.sourcesFor(scope(id)),
    forgetBot: (id) => tokens.forgetBot(scope(id)),
  };
}

// ── migration: one marketplace list ──────────────────────────────────────

export interface BotMarketplaceMigration {
  bots: number;
  marketplaces: number;
  plugins: number;
  /** `old@market -> new@market` for a marketplace stored under another name */
  renamed: string[];
  failed: string[];
}

/** One bot's own marketplaces into the one list (the boot migration, and a
 * bot package restored on a new bot): each is adopted (the same source is
 * reused, a clash gets a suffix), every install moves with its marketplace's
 * name, and the state is written in the current format. */
function moveBotIntoOneList(root: string, legacy: LegacyPluginState, shared: PluginMarketplaces, save?: (state: PluginState) => void): { names: Map<string, string>; plugins: PluginState["plugins"]; renamed: string[] } {
  const names = new Map<string, string>();
  const renamed: string[] = [];
  for (const [name, record] of Object.entries(legacy.marketplaces).sort(([a], [b]) => a.localeCompare(b))) {
    const manifestUrl = MANIFEST_URL.test(record.url) ? record.url : undefined;
    names.set(name, shared.adopt({ name, record: { ...record, ...(manifestUrl ? { manifestUrl } : {}) }, from: join(root, "marketplaces", name) }));
  }
  const plugins: PluginState["plugins"] = {};
  for (const [key, plugin] of Object.entries(legacy.plugins)) {
    const market = names.get(plugin.marketplace) ?? plugin.marketplace;
    if (market !== plugin.marketplace && NAME.test(market) && NAME.test(plugin.name)) {
      const from = join(root, "plugins", plugin.marketplace, plugin.name);
      const to = join(root, "plugins", market, plugin.name);
      if (existsSync(from)) {
        rmSync(to, { recursive: true, force: true });
        mkdirSync(join(to, ".."), { recursive: true });
        renameSync(from, to);
      }
      renamed.push(`${key} -> ${plugin.name}@${market}`);
    }
    plugins[`${plugin.name}@${market}`] = { ...plugin, marketplace: market };
  }
  mkdirSync(root, { recursive: true });
  const current = stateSchema.parse({ version: 2, plugins });
  if (save) save(current);
  else writeFileAtomic(join(root, "state.json"), JSON.stringify(current, null, 2));
  rmSync(join(root, "marketplaces"), { recursive: true, force: true });
  for (const [old, now] of names) {
    if (old === now) continue;
    const dir = join(root, "plugins", old);
    try { if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true }); } catch { /* already gone */ }
  }
  return { names, plugins, renamed };
}

/** Move every bot's own marketplaces into the installation's one list, once
 * per bot (a bot already on version 2 is skipped). Every install stays: a
 * plugin whose marketplace had to take another name moves with it. */
export function migrateBotMarketplaces(dataDir: string, shared: PluginMarketplaces): BotMarketplaceMigration {
  const summary: BotMarketplaceMigration = { bots: 0, marketplaces: 0, plugins: 0, renamed: [], failed: [] };
  const base = join(dataDir, "bot-plugins");
  let bots: string[];
  try { bots = readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory() && BOT_ID.test(entry.name)).map((entry) => entry.name).sort(); } catch { return summary; }
  for (const botId of bots) {
    const root = join(base, botId);
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(join(root, "state.json"), "utf8")); } catch { continue; }
    const legacy = legacyStateSchema.safeParse(raw);
    if (!legacy.success) continue;
    try {
      const moved = moveBotIntoOneList(root, legacy.data, shared);
      summary.marketplaces += moved.names.size;
      summary.plugins += Object.keys(moved.plugins).length;
      summary.renamed.push(...moved.renamed);
      summary.bots += 1;
    } catch {
      summary.failed.push(botId);
    }
  }
  return summary;
}
