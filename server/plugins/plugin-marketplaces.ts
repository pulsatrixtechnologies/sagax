// Marketplaces of the whole installation (Plugins > Manage > Marketplaces).
//
// A marketplace is a Claude Code plugin marketplace: a git repository with
// `.claude-plugin/marketplace.json` ({ name, owner, plugins: [{ name, source,
// description, version }] }, source a path in the repository or
// { source: "github", repo } / { source: "git" | "url", url }), or the https
// address of such a manifest. Each plugin folder may carry
// `.claude-plugin/plugin.json`, `.mcp.json`, `skills/<name>/SKILL.md`,
// `agents/` and `commands/`.
//
// "Add" on a plugin maps it onto what Sagax already has, for every bot:
//   - its MCP servers (`.mcp.json`, or `mcpServers` in plugin.json) become
//     MCP servers of this installation, with the marketplace as their source;
//   - its skills become skills of the library, switched off until read.
// Agents, commands and hooks are not installed here: the same plugin
// installed "For this bot" (server/bots/bot-plugins.ts) loads whole, from this
// same list. There is one marketplace list for both scopes.
//
// Files: DATA_DIR/marketplaces/{state.json, repos/<name>/, plugins/<name>/<plugin>/}.
// The clone is shallow and uses this computer's git credentials, or the
// acting person's GitHub connection for github.com: no token is stored here.
// The organization's allowed-marketplaces policy applies to what is shared:
// a marketplace shared with everyone ("org"), and every plugin installed for
// everyone. 2026-10-27 (#1098): a private marketplace (its author's only)
// for the person's own bots is theirs, and the policy does not limit it; it
// applies again the moment it is shared or a plugin of it is installed for
// everyone.
// A marketplace a bot still has plugins from is not removed (`inUse`).
// Added or fetched again from a bot ("For this bot"), the clone uses the
// environment the bot's store worked out (server/bots/bot-plugins.ts: that bot's
// token for the marketplace first, then the person's GitHub connection,
// then the organization's tokens); the token itself stays per bot
// (server/plugins/marketplace-tokens.ts), never here.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import { guardedFetch } from "../public-fetch.ts";
import { personalMcpHostRefusal } from "../people/person-connections.ts";
import { readPluginMcpServers } from "./plugin-mcp.ts";
import { notePluginFolderChanged, pluginFolderDigests } from "../sandbox/sandbox-plugin-digests.ts";
import {
  BotPluginError,
  insideRoot,
  marketplaceAllowed,
  parseGitSource,
  readMarketplaceManifest,
  runGit,
  type GitRunner,
  type GitSource,
  type MarketplacePolicy,
  type MarketplacePluginEntry,
} from "./plugin-sources.ts";
import type { StoredMcpServer } from "../mcp/mcp-registry.ts";
import { parseSkillMd } from "../../shared/skill-md.ts";
import { officialCatalogFor } from "../../shared/skill-catalogs.ts";
import { catalogNameFor, DEFAULT_SKILL_DIRS, synthesizeSkillsCatalog } from "./skills-catalog.ts";
import { hasCursorMarketplace, synthesizeCursorCatalog } from "./cursor-catalog.ts";
import { withoutMacMetadata } from "../mac-metadata.ts";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_MARKETPLACES = 40;
const GIT_TIMEOUT_MS = 120_000;
const MAX_MANIFEST_BYTES = 1_048_576;
const MAX_SKILL_BYTES = 256 * 1024;
const MAX_AGENT_FILES = 40;

export { BotPluginError as MarketplaceError };

const marketplaceRecord = z.object({
  source: z.string(),
  url: z.string(),
  ref: z.string().optional(),
  /** set when the marketplace is a manifest address, not a repository */
  manifestUrl: z.string().optional(),
  description: z.string().optional(),
  addedAt: z.number(),
  addedBy: z.string().optional(),
  updatedAt: z.number(),
  /** when its clone was last pulled; `updatedAt` also moves on a visibility
   * change. Absent on a record written before (#3636): the clone folder's date. */
  pulledAt: z.number().optional(),
  /** who may see and use it: "private" to the person who added it (the safe
   * default, so a private repo reached through this computer's git
   * credentials never leaks), or "org" (shared with everyone). Absent on a
   * record written before this field existed: read as "private" (fail
   * closed), so the old shared leak is closed at migration. */
  visibility: z.enum(["private", "org"]).optional(),
}).strict();

export type MarketplaceVisibility = "private" | "org";

/** Who is asking. On a solo server, or at the organization server's own
 * console, the operator sees every marketplace (`seesAll`). Each signed-in
 * person sees org-wide marketplaces and their own private ones only, so one
 * person's private GitHub repo is never listed to, or reachable by, another.
 * An absent viewer means an unfiltered, internal call. */
export interface MarketplaceViewer {
  /** the signed-in person (a principal id); absent at the console */
  principal?: string;
  /** the host operator / solo owner, who manages every marketplace */
  seesAll?: boolean;
}

/** The source a stored marketplace was added from, as the policy reads it. */
function marketSource(market: { source: string; url: string; ref?: string; manifestUrl?: string }): GitSource {
  if (market.manifestUrl) return { id: market.manifestUrl.toLowerCase(), url: market.manifestUrl };
  return parseGitSource(market.source.includes("://") ? market.url : market.source, market.ref);
}

/** A marketplace's visibility, failing closed to "private". */
export function marketplaceVisibility(record: { visibility?: MarketplaceVisibility }): MarketplaceVisibility {
  return record.visibility === "org" ? "org" : "private";
}

/** May this viewer see and use this marketplace? Org-wide: everyone. Private:
 * only the person who added it (and the operator / an unfiltered call). */
export function marketplaceVisibleTo(record: { visibility?: MarketplaceVisibility; addedBy?: string }, viewer?: MarketplaceViewer): boolean {
  if (marketplaceVisibility(record) === "org") return true;
  if (!viewer) return true;
  if (viewer.seesAll) return true;
  return viewer.principal !== undefined && record.addedBy !== undefined && viewer.principal === record.addedBy;
}

/** Whether this viewer owns the marketplace (so may change its visibility,
 * refresh or remove it as its author): its author, or the operator. */
function marketplaceOwnedBy(record: { addedBy?: string }, viewer?: MarketplaceViewer): boolean {
  if (!viewer) return true;
  if (viewer.seesAll) return true;
  return viewer.principal !== undefined && record.addedBy !== undefined && viewer.principal === record.addedBy;
}

const installedRecord = z.object({
  name: z.string(),
  marketplace: z.string(),
  version: z.string().optional(),
  /** what was installed, to tell an update without a version change
   * (`pluginRevision`) */
  revision: z.string().optional(),
  installedAt: z.number(),
  updatedAt: z.number().optional(),
  /** MCP server names this plugin added */
  servers: z.array(z.string()),
  /** the plugin's own server name to the name it was added under */
  serverNames: z.record(z.string(), z.string()).optional(),
  /** library skills this plugin added */
  skills: z.array(z.string()),
}).strict();

const stateSchema = z.object({
  version: z.literal(1),
  marketplaces: z.record(z.string(), marketplaceRecord),
  installed: z.record(z.string(), installedRecord),
}).strict();

type State = z.infer<typeof stateSchema>;
export type InstalledMarketplacePlugin = z.infer<typeof installedRecord> & { key: string };
export type SharedMarketplaceRecord = z.infer<typeof marketplaceRecord>;

export interface MarketplaceView {
  name: string;
  source: string;
  ref?: string;
  description?: string;
  addedAt: number;
  updatedAt: number;
  /** "private" (this person's) or "org" (shared with everyone) */
  visibility: MarketplaceVisibility;
  /** this viewer added it (so may change its visibility), or is the operator */
  mine: boolean;
  /** bots with at least one plugin installed from it ("For this bot") */
  bots: number;
  plugins: Array<{
    name: string;
    description?: string;
    version?: string;
    category?: string;
    /** the plugin's site and declared icon (bot-plugins.ts pluginMarks) */
    homepage?: string;
    icon?: string;
    /** #2759: converted from another format (Cursor), and what did not convert */
    convertedFrom?: string;
    notConverted?: string[];
    installed: boolean;
    /** the version installed, when it differs from `version` */
    installedVersion?: string;
    /** the marketplace offers a newer version than the one installed */
    updateAvailable?: boolean;
    servers: string[];
    skills: string[];
  }>;
}

// ── the install mapping (pure) ───────────────────────────────────────────

/** What "Add" on a plugin brings: MCP server entries in the stored shape
 * (still to be checked by the registry) and SKILL.md files. */
export interface PluginInstallPlan {
  servers: Array<{ name: string; entry: Record<string, unknown> }>;
  skills: Array<{ name: string; text: string }>;
  /** I1 (2026-11-07): the plugin's `agents/*.md` (Claude Code subagents),
   * read for "Import as a team"; "Add" does not install them. */
  agents: Array<{ file: string; text: string }>;
  /** what was left out and why, for the person */
  skipped: string[];
}

type Json = Record<string, unknown>;
const record = (value: unknown): Json | null => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : null);

/** Read one plugin folder into an install plan. */
export function pluginInstallPlan(root: string): PluginInstallPlan {
  const plan: PluginInstallPlan = { ...readPluginMcpServers(root), skills: [], agents: [] };
  const skillsDir = join(root, "skills");
  if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) {
    for (const folder of readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!folder.isDirectory()) continue;
      const file = join(skillsDir, folder.name, "SKILL.md");
      if (!existsSync(file) || lstatSync(file).isSymbolicLink()) continue;
      if (statSync(file).size > MAX_SKILL_BYTES) {
        plan.skipped.push(`skill ${folder.name} (too large)`);
        continue;
      }
      const text = readFileSync(file, "utf8");
      const parsed = parseSkillMd(text);
      if ("error" in parsed) {
        plan.skipped.push(`skill ${folder.name} (${parsed.error})`);
        continue;
      }
      plan.skills.push({ name: parsed.name, text });
    }
  }
  const agentsDir = join(root, "agents");
  if (existsSync(agentsDir) && lstatSync(agentsDir).isDirectory()) {
    for (const entry of readdirSync(agentsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
      const file = join(agentsDir, entry.name);
      if (statSync(file).size > MAX_SKILL_BYTES) {
        plan.skipped.push(`agent ${entry.name} (too large)`);
        continue;
      }
      if (plan.agents.length >= MAX_AGENT_FILES) {
        plan.skipped.push(`agent ${entry.name} (more than ${MAX_AGENT_FILES} agents)`);
        continue;
      }
      plan.agents.push({ file: entry.name, text: readFileSync(file, "utf8") });
    }
  }
  return plan;
}

/** The plugin's own manifest (`.claude-plugin/plugin.json`): its name, shown
 * name, description and version, or nothing when it is absent or unreadable. */
export function readPluginManifestInfo(root: string): { name?: string; displayName?: string; description?: string; version?: string } {
  const file = join(root, ".claude-plugin", "plugin.json");
  if (!existsSync(file) || lstatSync(file).isSymbolicLink() || statSync(file).size > MAX_MANIFEST_BYTES) return {};
  try {
    const value = record(JSON.parse(readFileSync(file, "utf8")));
    if (!value) return {};
    const text = (key: string) => (typeof value[key] === "string" && (value[key] as string).trim() ? (value[key] as string).trim() : undefined);
    return Object.fromEntries(Object.entries({ name: text("name"), displayName: text("displayName"), description: text("description"), version: text("version") }).filter(([, v]) => v !== undefined));
  } catch {
    return {};
  }
}

/** The MCP server name a plugin's server is added under: its own name made
 * safe, then the plugin's name in front of it if that is taken. */
export function marketplaceServerName(server: string, plugin: string, taken: ReadonlySet<string>): string {
  const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z]+/, "").replace(/-+$/, "");
  const base = slug(server).slice(0, 32) || "plugin";
  if (!taken.has(base)) return base;
  const prefixed = `${slug(plugin).slice(0, 12)}-${base}`.slice(0, 32).replace(/-+$/, "");
  if (prefixed && /^[a-z]/.test(prefixed) && !taken.has(prefixed)) return prefixed;
  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${base.slice(0, 28)}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 20)}-${Date.now().toString(36).slice(-6)}`;
}

/** What a marketplace offers for one plugin now: its folder's digest in a
 * repository marketplace, the repository and ref it points at for a plugin
 * kept elsewhere; nothing for a manifest address (only the version tells).
 * #3643: the folder's digest (its files' paths and bytes, without links or
 * git metadata, the files `copyPlain` would copy) is read in slices and
 * remembered until a writer changes the clone (sandbox-plugin-digests.ts). */
export async function pluginRevision(repo: string, entry: MarketplacePluginEntry, manifestUrl?: string): Promise<string | undefined> {
  if (entry.source.kind === "git") return `git:${entry.source.git.id}#${entry.source.git.ref ?? ""}:${entry.source.path ?? ""}`;
  if (manifestUrl) return undefined;
  try {
    const folder = insideRoot(repo, entry.source.path);
    return existsSync(folder) && statSync(folder).isDirectory() ? `sha256:${await pluginFolderDigests.revision(folder)}` : undefined;
  } catch {
    return undefined;
  }
}

/** A newer version than the one installed: another declared version, or
 * the same version with other files. Unknown on either side says nothing. */
export function pluginUpdateAvailable(installed: { version?: string; revision?: string }, offered: { version?: string; revision?: string }): boolean {
  if (installed.version && offered.version && installed.version !== offered.version) return true;
  return Boolean(installed.revision && offered.revision && installed.revision !== offered.revision);
}

/** How an update changes the MCP servers an installed plugin added: each
 * server it still brings keeps the name it was added under (bots choose
 * servers by name, so their selection and the server's switch stay), new
 * ones are added, the ones it dropped are removed. */
export interface PluginServerUpdate {
  keep: Array<{ name: string; stored: string; entry: Record<string, unknown> }>;
  add: Array<{ name: string; entry: Record<string, unknown> }>;
  remove: string[];
}

export function planServerUpdate(plan: PluginInstallPlan, installed: Pick<InstalledMarketplacePlugin, "name" | "servers" | "serverNames">): PluginServerUpdate {
  const result: PluginServerUpdate = { keep: [], add: [], remove: [] };
  const unclaimed = new Set(installed.servers);
  // An install from before `serverNames` was kept: the names it would have
  // been given (plain, plugin in front, or a number after).
  const guess = (name: string): string | undefined => {
    const base = marketplaceServerName(name, installed.name, new Set());
    const prefixed = marketplaceServerName(name, installed.name, new Set([base]));
    // a server name is [a-z0-9_-] only: nothing to escape
    const numbered = new RegExp(`^${base.slice(0, 28)}-\\d{1,2}$`);
    return [base, prefixed].find((candidate) => unclaimed.has(candidate)) ?? [...unclaimed].find((candidate) => numbered.test(candidate));
  };
  for (const server of plan.servers) {
    const known = installed.serverNames?.[server.name];
    const stored = known !== undefined ? (unclaimed.has(known) ? known : undefined) : guess(server.name);
    if (stored) {
      unclaimed.delete(stored);
      result.keep.push({ name: server.name, stored, entry: server.entry });
    } else {
      result.add.push(server);
    }
  }
  result.remove = [...unclaimed];
  return result;
}

/** The entry an update writes over a server it keeps: the plugin's new
 * address or command, with the person's own values on top (a header or
 * variable they filled in, their sign-in app, the switch and the tools
 * they turned off). */
export function updatedServerEntry(existing: StoredMcpServer, entry: Record<string, unknown>, marketplace: string): Record<string, unknown> {
  const own = (value: unknown) => (record(value) ?? {}) as Record<string, string>;
  const kept = {
    enabled: existing.enabled,
    ...(existing.disabledTools?.length ? { disabledTools: existing.disabledTools } : {}),
    // the result size limit the person set (port of OpenMausBot #2727)
    ...(existing.resultBudget !== undefined ? { resultBudget: existing.resultBudget } : {}),
    source: marketplace,
  };
  if ("url" in entry && "url" in existing) {
    return {
      ...entry,
      headers: { ...own(entry.headers), ...existing.headers },
      ...(existing.oauth && !entry.oauth ? { oauth: existing.oauth } : {}),
      ...kept,
    };
  }
  if ("command" in entry && "command" in existing) return { ...entry, env: { ...own(entry.env), ...existing.env }, ...kept };
  // Another kind of server under the same name: a command waits for a test.
  return { ...entry, ...kept, enabled: "url" in entry ? existing.enabled : false };
}

/** Is this the address of a manifest rather than a repository? */
export function isManifestUrl(source: string): boolean {
  return /^https:\/\/\S+\.json(?:\?\S*)?$/i.test(source.trim());
}

// ── the store ────────────────────────────────────────────────────────────

export interface PluginMarketplacesOptions {
  dataDir: string;
  git?: GitRunner;
  gitEnvironment: (actor: string | undefined) => Record<string, string>;
  policy: () => MarketplacePolicy | undefined;
  /** reads a manifest address (https only) */
  fetchText?: (url: string) => Promise<string>;
  /** the bots with plugins installed from a marketplace (server/bots/bot-plugins.ts) */
  inUse?: (name: string) => string[];
  now?: () => number;
  /** Lot 5: when the installation store has absorbed marketplaces-state,
   * read/write the record there. Checkout trees stay under marketplaces/. */
  installationStore?: {
    hasMigrated(sourceId: string): boolean;
    readMarketplaces(): unknown;
    writeMarketplaces(state: State): void;
  };
}

async function defaultFetchText(url: string): Promise<string> {
  const response = await guardedFetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new BotPluginError(`The manifest address answered ${response.status}.`, "repository_unreadable", 422);
  const text = await response.text();
  if (text.length > MAX_MANIFEST_BYTES) throw new BotPluginError("The manifest is too large.", "too_large", 422);
  return text;
}

export class PluginMarketplaces {
  private readonly options: PluginMarketplacesOptions;
  private readonly git: GitRunner;
  private readonly now: () => number;
  private readonly fetchText: (url: string) => Promise<string>;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(options: PluginMarketplacesOptions) {
    this.options = options;
    this.git = options.git ?? runGit;
    this.now = options.now ?? Date.now;
    this.fetchText = options.fetchText ?? defaultFetchText;
  }

  private get root(): string {
    return join(this.options.dataDir, "marketplaces");
  }

  private repoDir(name: string): string {
    if (!NAME.test(name)) throw new BotPluginError("invalid marketplace", "invalid_source");
    return join(this.root, "repos", name);
  }

  /** The marketplace's own files (its marketplace.json and plugin folders). */
  repoPath(name: string): string {
    return this.repoDir(name);
  }

  record(name: string): SharedMarketplaceRecord | undefined {
    return this.read().marketplaces[name];
  }

  /** When this marketplace's clone in hand was last pulled: the record's
   * `pulledAt`, else the clone folder's date on disk (a record from before
   * that field). Undefined: no clone. */
  clonedAt(name: string): number | undefined {
    const pulled = this.read().marketplaces[name]?.pulledAt;
    if (pulled !== undefined) return pulled;
    try { return Math.floor(statSync(this.repoDir(name)).mtimeMs); } catch { return undefined; }
  }

  /** Every marketplace's name, in the order of a listing. */
  names(): string[] {
    return Object.keys(this.read().marketplaces).sort((a, b) => a.localeCompare(b));
  }

  /** Where an installed plugin's files live (its stdio servers run there). */
  pluginDir(marketplace: string, plugin: string): string {
    if (!NAME.test(marketplace) || !NAME.test(plugin)) throw new BotPluginError("invalid plugin", "invalid_plugin");
    return join(this.root, "plugins", marketplace, plugin);
  }

  private read(): State {
    const bridge = this.options.installationStore;
    if (bridge?.hasMigrated("marketplaces-state")) {
      try {
        return stateSchema.parse(bridge.readMarketplaces());
      } catch {
        return { version: 1, marketplaces: {}, installed: {} };
      }
    }
    try {
      return stateSchema.parse(JSON.parse(readFileSync(join(this.root, "state.json"), "utf8")));
    } catch {
      return { version: 1, marketplaces: {}, installed: {} };
    }
  }

  private write(state: State): void {
    const parsed = stateSchema.parse(state);
    const bridge = this.options.installationStore;
    if (bridge?.hasMigrated("marketplaces-state")) {
      bridge.writeMarketplaces(parsed);
      return;
    }
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    writeFileAtomic(join(this.root, "state.json"), JSON.stringify(parsed, null, 2));
  }

  /** One change at a time: two Adds never clone into the same folder. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.lock.catch(() => undefined).then(work);
    this.lock = next.catch(() => undefined);
    return next;
  }

  private checkPolicy(source: GitSource): void {
    if (!marketplaceAllowed(this.options.policy(), source)) {
      throw new BotPluginError(`Your organization does not allow plugins from ${source.id}.`, "marketplace_not_allowed", 403);
    }
  }

  private async clone(source: GitSource, into: string, actor: string | undefined, env?: Record<string, string>): Promise<void> {
    if (/^https?:/i.test(source.url)) {
      const refusal = await personalMcpHostRefusal(source.url);
      if (refusal) throw new BotPluginError(refusal, "repository_unreadable", 422);
    }
    const staging = `${into}.tmp-${process.pid}-${this.now()}`;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(join(staging, ".."), { recursive: true });
    try {
      const gitEnv = env ?? this.options.gitEnvironment(source.github ? actor : undefined);
      // #2613: an official skill catalog is a big repository: only its skill folders are fetched
      const sparse = officialCatalogFor(source.id)?.skillDirs;
      await this.git(["clone", "--depth", "1", "--single-branch", "--no-tags", ...(sparse ? ["--filter=blob:none", "--sparse"] : []), ...(source.ref ? ["--branch", source.ref] : []), "--", source.url, staging], {
        env: gitEnv, timeoutMs: GIT_TIMEOUT_MS,
      });
      if (sparse) await this.git(["-C", staging, "sparse-checkout", "set", ...sparse], { env: gitEnv, timeoutMs: GIT_TIMEOUT_MS });
      rmSync(join(staging, ".git"), { recursive: true, force: true });
      rmSync(into, { recursive: true, force: true });
      renameSync(staging, into);
      notePluginFolderChanged(into);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  /** What this marketplace offers now for one plugin (`pluginRevision`),
   * for a bot's install of it (server/bots/bot-plugins.ts). */
  revisionOf(name: string, entry: MarketplacePluginEntry): Promise<string | undefined> {
    return pluginRevision(this.repoDir(name), entry, this.read().marketplaces[name]?.manifestUrl);
  }

  /** #3643: every plugin's offered revision worked out ahead of a listing,
   * one folder at a time and in slices: after the server listens, and after
   * a clone is replaced (`only`). A listing asked meanwhile waits for the
   * same reads. */
  async warmRevisions(only?: string): Promise<void> {
    for (const [name, market] of Object.entries(this.read().marketplaces)) {
      if ((only !== undefined && name !== only) || market.manifestUrl) continue;
      let entries: MarketplacePluginEntry[];
      try {
        entries = readMarketplaceManifest(this.repoDir(name)).plugins;
      } catch {
        continue;
      }
      for (const entry of entries) await pluginRevision(this.repoDir(name), entry);
    }
  }

  /** The marketplaces this `viewer` may see: org-wide ones, and their own
   * private ones. An absent viewer lists every marketplace (internal call). */
  async list(viewer?: MarketplaceViewer): Promise<MarketplaceView[]> {
    const state = this.read();
    const views = await Promise.all(Object.entries(state.marketplaces).filter(([, market]) => marketplaceVisibleTo(market, viewer)).map(async ([name, market]): Promise<MarketplaceView> => {
      let entries: MarketplacePluginEntry[] = [];
      try {
        entries = readMarketplaceManifest(this.repoDir(name)).plugins;
      } catch {
        entries = [];
      }
      return {
        name,
        source: market.manifestUrl ?? market.source,
        ...(market.ref ? { ref: market.ref } : {}),
        ...(market.description ? { description: market.description } : {}),
        addedAt: market.addedAt,
        updatedAt: market.updatedAt,
        visibility: marketplaceVisibility(market),
        mine: marketplaceOwnedBy(market, viewer),
        bots: this.options.inUse?.(name).length ?? 0,
        plugins: await Promise.all(entries.map(async (entry) => {
          const installed = state.installed[`${entry.name}@${name}`];
          const update = installed
            ? pluginUpdateAvailable(installed, { version: entry.version, revision: await pluginRevision(this.repoDir(name), entry, market.manifestUrl) })
            : false;
          return {
            name: entry.name,
            ...(entry.description ? { description: entry.description } : {}),
            ...(entry.version ? { version: entry.version } : {}),
            ...(entry.category ? { category: entry.category } : {}),
            ...(entry.homepage ? { homepage: entry.homepage } : {}),
            ...(entry.icon ? { icon: entry.icon } : {}),
            ...(entry.convertedFrom ? { convertedFrom: entry.convertedFrom } : {}),
            ...(entry.notConverted?.length ? { notConverted: entry.notConverted } : {}),
            installed: Boolean(installed),
            ...(installed?.version && installed.version !== entry.version ? { installedVersion: installed.version } : {}),
            ...(update ? { updateAvailable: true } : {}),
            servers: installed?.servers ?? [],
            skills: installed?.skills ?? [],
          };
        })),
      };
    }));
    return views.sort((a, b) => a.name.localeCompare(b.name));
  }

  installed(): InstalledMarketplacePlugin[] {
    return Object.entries(this.read().installed).map(([key, value]) => ({ key, ...value }));
  }

  /** Add (or fetch again) a marketplace: owner/repo, an https git address,
   * or the https address of a marketplace.json. `name` keeps the name it is
   * stored under (a refresh of a marketplace renamed at migration).
   * `environment` gives the git environment of the clone (a bot's store:
   * its token for this marketplace first); without it, `gitEnvironment`. */
  add(
    input: { source: string; ref?: string },
    actor: string | undefined,
    options: { name?: string; visibility?: MarketplaceVisibility; viewer?: MarketplaceViewer; environment?: (source: GitSource) => Promise<Record<string, string>> } = {},
  ): Promise<MarketplaceView> {
    return this.fetchInto(input, actor, options).then(async (name) => (await this.list()).find((view) => view.name === name)!);
  }

  /** The clone and the record of `add`, without the listing it answers
   * with (that listing reads the installed plugins' digests): the name the
   * marketplace is stored under. */
  private fetchInto(
    input: { source: string; ref?: string },
    actor: string | undefined,
    options: { name?: string; visibility?: MarketplaceVisibility; viewer?: MarketplaceViewer; environment?: (source: GitSource) => Promise<Record<string, string>> },
  ): Promise<string> {
    return this.serial(async () => {
      const staging = join(this.root, "repos", `.incoming-${this.now()}`);
      const manifestUrl = isManifestUrl(input.source) ? input.source.trim() : undefined;
      // #1098: only a marketplace shared with everyone is held to the
      // organization's list here (a refresh of a shared one is checked below).
      const shared = options.visibility === "org";
      let source: GitSource;
      try {
        if (manifestUrl) {
          const url = new URL(manifestUrl);
          if (url.username || url.password) throw new BotPluginError("Put no credentials in the address.", "invalid_source");
          source = { id: manifestUrl.toLowerCase(), url: manifestUrl };
          if (shared) this.checkPolicy(source);
          const text = await this.fetchText(manifestUrl);
          mkdirSync(join(staging, ".claude-plugin"), { recursive: true });
          writeFileSync(join(staging, ".claude-plugin", "marketplace.json"), text);
        } else {
          source = parseGitSource(input.source, input.ref?.trim() || undefined);
          if (shared) this.checkPolicy(source);
          await this.clone(source, staging, actor, options.environment ? await options.environment(source) : undefined);
        }
        const official = manifestUrl ? undefined : officialCatalogFor(source.id);
        if (!manifestUrl && (official?.format === "cursor" || (hasCursorMarketplace(staging) && !existsSync(join(staging, ".claude-plugin", "marketplace.json"))))) {
          // #2759: a Cursor plugin marketplace (cursor/plugins) converted to the Claude Code layout
          synthesizeCursorCatalog(staging, {
            name: official?.id ?? catalogNameFor(source.id),
            ...(official ? { description: official.description } : {}),
            ...(source.github ? { rawBase: `https://raw.githubusercontent.com/${source.github.owner}/${source.github.repo}/${source.ref ?? "HEAD"}` } : {}),
          });
        }
        if (!manifestUrl && !existsSync(join(staging, ".claude-plugin", "marketplace.json"))) {
          // #2613: a skill catalog (Hermes Agent, OpenClaw, a skills/ folder) is read as a marketplace
          synthesizeSkillsCatalog(staging, {
            name: official?.id ?? catalogNameFor(source.id),
            ...(official ? { description: official.description, dirs: official.skillDirs ?? DEFAULT_SKILL_DIRS } : {}),
          });
        }
        const manifest = readMarketplaceManifest(staging);
        // #3636: the state is read after the clone, just before the write,
        // with no await between: a record written while the clone ran stays
        const state = this.read();
        const sourceId = manifestUrl ?? source.id;
        const sameSource = Object.entries(state.marketplaces)
          .find(([, market]) => (market.manifestUrl ?? market.source) === sourceId && (market.ref ?? "") === (source.ref ?? ""))?.[0];
        const name = options.name ?? sameSource ?? manifest.name;
        const taken = state.marketplaces[name];
        // Never let a re-add reveal or reuse another person's private
        // marketplace: to the person who cannot see it, it is simply taken.
        if (taken && options.viewer && !marketplaceVisibleTo(taken, options.viewer)) {
          throw new BotPluginError(`A marketplace named ${name} is already added.`, "name_taken", 409);
        }
        if (taken && (taken.manifestUrl ?? taken.source) !== sourceId) {
          throw new BotPluginError(`A marketplace named ${name} is already added from ${taken.manifestUrl ?? taken.source}.`, "name_taken", 409);
        }
        if (taken && marketplaceVisibility(taken) === "org") this.checkPolicy(source);
        if (!taken && Object.keys(state.marketplaces).length >= MAX_MARKETPLACES) {
          throw new BotPluginError(`Add at most ${MAX_MARKETPLACES} marketplaces.`, "too_many", 400);
        }
        const target = this.repoDir(name);
        rmSync(target, { recursive: true, force: true });
        mkdirSync(join(target, ".."), { recursive: true });
        renameSync(staging, target);
        // #3619: a marketplace refresh replaced the clone (and any plugin
        // folder read from it)
        notePluginFolderChanged(target);
        const now = this.now();
        state.marketplaces[name] = {
          source: source.id,
          url: source.url,
          ...(source.ref ? { ref: source.ref } : {}),
          ...(manifestUrl ? { manifestUrl } : {}),
          ...(manifest.description ? { description: manifest.description } : {}),
          addedAt: taken?.addedAt ?? now,
          ...((taken?.addedBy ?? actor) ? { addedBy: taken?.addedBy ?? actor } : {}),
          updatedAt: now,
          // #3636: when the clone was last pulled (only a pull sets it)
          pulledAt: now,
          // A refresh keeps the visibility it had; a new add defaults to
          // private unless org-wide was explicitly chosen.
          visibility: taken ? marketplaceVisibility(taken) : (options.visibility === "org" ? "org" : "private"),
        };
        this.write(state);
        void this.warmRevisions(name);
        return name;
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
    });
  }

  refresh(name: string, actor: string | undefined, options: { viewer?: MarketplaceViewer; environment?: (source: GitSource) => Promise<Record<string, string>> } = {}): Promise<MarketplaceView> {
    return this.pull(name, actor, options).then(async () => (await this.list()).find((view) => view.name === name)!);
  }

  /** `refresh` without the listing it answers with: the one pull of a
   * marketplace, for a bot's install and the background pull (#3612), which
   * read no digest of the installed plugins. */
  pull(name: string, actor: string | undefined, options: { viewer?: MarketplaceViewer; environment?: (source: GitSource) => Promise<Record<string, string>> } = {}): Promise<void> {
    const market = this.read().marketplaces[name];
    if (!market || !marketplaceVisibleTo(market, options.viewer)) return Promise.reject(new BotPluginError("No marketplace with that name.", "not_found", 404));
    return this.fetchInto({ source: market.manifestUrl ?? (market.source.includes("://") ? market.url : market.source), ...(market.ref ? { ref: market.ref } : {}) }, actor, { name, ...options }).then(() => undefined);
  }

  /** Whether this viewer may see and use the marketplace (a private one is
   * its author's only). Unknown marketplace: false. */
  canAccess(name: string, viewer?: MarketplaceViewer): boolean {
    const market = this.read().marketplaces[name];
    return Boolean(market) && marketplaceVisibleTo(market!, viewer);
  }

  /** Change a marketplace's visibility. Only its author (or the operator)
   * may; to anyone else a private marketplace does not exist. */
  setVisibility(name: string, visibility: MarketplaceVisibility, viewer?: MarketplaceViewer): Promise<MarketplaceView> {
    return this.serial(async () => {
      const state = this.read();
      const market = state.marketplaces[name];
      if (!market || !marketplaceVisibleTo(market, viewer)) throw new BotPluginError("No marketplace with that name.", "not_found", 404);
      if (!marketplaceOwnedBy(market, viewer)) throw new BotPluginError("Only the person who added this marketplace can change who can see it.", "marketplace_not_owner", 403);
      // #1098: shared with everyone, it is held to the organization's list
      if (visibility === "org") this.checkPolicy(marketSource(market));
      state.marketplaces[name] = { ...market, visibility, updatedAt: this.now() };
      this.write(state);
      return (await this.list(viewer)).find((view) => view.name === name)!;
    });
  }

  /** Forget a marketplace. Its installed plugins must be uninstalled first,
   * for everyone and on every bot, so nothing is left without a source. */
  remove(name: string, viewer?: MarketplaceViewer): Promise<void> {
    return this.serial(async () => {
      const state = this.read();
      if (!state.marketplaces[name] || !marketplaceVisibleTo(state.marketplaces[name]!, viewer)) throw new BotPluginError("No marketplace with that name.", "not_found", 404);
      const left = Object.values(state.installed).filter((plugin) => plugin.marketplace === name).map((plugin) => plugin.name);
      if (left.length) throw new BotPluginError(`Uninstall its plugins first: ${left.join(", ")}.`, "has_plugins", 409);
      const bots = this.options.inUse?.(name) ?? [];
      if (bots.length) throw new BotPluginError(`${bots.length === 1 ? "A bot still uses" : `${bots.length} bots still use`} plugins from this marketplace. Uninstall them for each bot first.`, "in_use", 409);
      delete state.marketplaces[name];
      rmSync(this.repoDir(name), { recursive: true, force: true });
      notePluginFolderChanged(this.repoDir(name));
      this.write(state);
    });
  }

  /** Take in a marketplace a bot had on its own before the two lists were
   * one (migration). The same source (and ref) already here is reused; a
   * name taken by another source gets a suffix. Its files are copied from
   * `from` when this list has none. Returns the name it is stored under. */
  adopt(input: { name: string; record: SharedMarketplaceRecord; from?: string }): string {
    const state = this.read();
    const sourceId = input.record.manifestUrl ?? input.record.source;
    const same = Object.entries(state.marketplaces)
      .find(([, market]) => (market.manifestUrl ?? market.source) === sourceId && (market.ref ?? "") === (input.record.ref ?? ""))?.[0];
    let name = same ?? input.name;
    for (let suffix = 2; !same && state.marketplaces[name]; suffix++) name = `${input.name.slice(0, 60)}-${suffix}`;
    if (!NAME.test(name)) throw new BotPluginError("invalid marketplace", "invalid_source");
    const target = this.repoDir(name);
    if (input.from && existsSync(join(input.from, ".claude-plugin", "marketplace.json")) && !existsSync(join(target, ".claude-plugin", "marketplace.json"))) {
      copyPlain(input.from, target);
    }
    if (!same) {
      state.marketplaces[name] = { ...input.record };
      this.write(state);
    }
    return name;
  }

  /** Put a plugin's files in place and read what it brings. The caller
   * adds the servers and skills, then records them with `recordInstall`. */
  prepare(marketplace: string, plugin: string, actor: string | undefined, viewer?: MarketplaceViewer): Promise<{ dir: string; plan: PluginInstallPlan; version?: string; revision?: string }> {
    return this.serial(() => this.materialize(marketplace, plugin, actor, viewer, this.pluginDir(marketplace, plugin)));
  }

  /** I1: a plugin's files read into a scratch folder, nothing installed:
   * its plan (agents included) and manifest, for "Import as a team". */
  readPlugin(marketplace: string, plugin: string, actor: string | undefined, viewer?: MarketplaceViewer): Promise<{ plan: PluginInstallPlan; manifest: ReturnType<typeof readPluginManifestInfo>; version?: string }> {
    return this.serial(async () => {
      const scratch = join(this.root, "plugins", `.read-${this.now()}-${Math.random().toString(36).slice(2, 8)}`);
      try {
        const { plan, version } = await this.materialize(marketplace, plugin, actor, viewer, scratch);
        return { plan, manifest: readPluginManifestInfo(scratch), ...(version ? { version } : {}) };
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    });
  }

  private materialize(marketplace: string, plugin: string, actor: string | undefined, viewer: MarketplaceViewer | undefined, target: string): Promise<{ dir: string; plan: PluginInstallPlan; version?: string; revision?: string }> {
    return (async () => {
      const state = this.read();
      const market = state.marketplaces[marketplace];
      if (!market || !marketplaceVisibleTo(market, viewer)) throw new BotPluginError("No marketplace with that name.", "not_found", 404);
      // #1098: a plugin installed for everyone comes from a marketplace the
      // organization allows, even when its author kept it private (a shared
      // one was checked when it was shared)
      if (marketplaceVisibility(market) === "private") this.checkPolicy(marketSource(market));
      const repo = this.repoDir(marketplace);
      const entry = readMarketplaceManifest(repo).plugins.find((candidate) => candidate.name === plugin);
      if (!entry) throw new BotPluginError("That plugin is not in this marketplace.", "not_found", 404);
      const revision = await pluginRevision(repo, entry, market.manifestUrl);
      if (entry.source.kind === "git") {
        this.checkPolicy(entry.source.git);
        const checkout = join(this.root, "plugins", `.checkout-${this.now()}`);
        try {
          await this.clone(entry.source.git, checkout, actor);
          copyPlain(entry.source.path ? insideRoot(checkout, entry.source.path) : checkout, target);
        } finally {
          rmSync(checkout, { recursive: true, force: true });
        }
      } else if (market.manifestUrl) {
        // A manifest address has no repository beside it: read the plugin's
        // MCP servers over https; skills need a repository (git) marketplace.
        await this.fetchPluginFiles(market.manifestUrl, entry.source.path, target);
      } else {
        copyPlain(insideRoot(repo, entry.source.path), target);
      }
      return { dir: target, plan: pluginInstallPlan(target), ...(entry.version ? { version: entry.version } : {}), ...(revision ? { revision } : {}) };
    })();
  }

  private async fetchPluginFiles(manifestUrl: string, path: string, target: string): Promise<void> {
    const base = new URL(manifestUrl.replace(/\.claude-plugin\/marketplace\.json(?:\?.*)?$/i, ""));
    const folder = new URL(path.replace(/^\.\//, "").replace(/\/?$/, "/"), base);
    if (!folder.href.startsWith(base.href)) throw new BotPluginError("The plugin's path leaves its marketplace.", "invalid_plugin", 422);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(join(target, ".claude-plugin"), { recursive: true });
    try {
      for (const file of [".mcp.json", ".claude-plugin/plugin.json"]) {
        try {
          writeFileSync(join(target, file), await this.fetchText(new URL(file, folder).href));
        } catch {
          // absent is normal: a plugin need not have either file
        }
      }
    } finally {
      notePluginFolderChanged(target);
    }
  }

  recordInstall(marketplace: string, plugin: string, result: { version?: string; revision?: string; servers: string[]; serverNames?: Record<string, string>; skills: string[] }): Promise<InstalledMarketplacePlugin> {
    // #3636: in the one queue with a pull, so no two writers interleave
    return this.serial(async () => {
      const state = this.read();
      const key = `${plugin}@${marketplace}`;
      const previous = state.installed[key];
      const serverNames = { ...previous?.serverNames, ...result.serverNames };
      state.installed[key] = {
        name: plugin,
        marketplace,
        ...(result.version ? { version: result.version } : {}),
        ...(result.revision ? { revision: result.revision } : {}),
        installedAt: previous?.installedAt ?? this.now(),
        servers: [...new Set([...(previous?.servers ?? []), ...result.servers])],
        ...(Object.keys(serverNames).length ? { serverNames } : {}),
        skills: [...new Set([...(previous?.skills ?? []), ...result.skills])],
      };
      this.write(state);
      return { key, ...state.installed[key]! };
    });
  }

  /** Record an update in place: what the plugin brings now replaces what
   * it brought, and the install date stays. */
  recordUpdate(marketplace: string, plugin: string, result: { version?: string; revision?: string; servers: string[]; serverNames: Record<string, string>; skills: string[] }): Promise<InstalledMarketplacePlugin> {
    return this.serial(async () => {
      const state = this.read();
      const key = `${plugin}@${marketplace}`;
      const previous = state.installed[key];
      if (!previous) throw new BotPluginError("That plugin is not installed.", "not_found", 404);
      state.installed[key] = {
        name: plugin,
        marketplace,
        ...(result.version ? { version: result.version } : {}),
        ...(result.revision ? { revision: result.revision } : {}),
        installedAt: previous.installedAt,
        updatedAt: this.now(),
        servers: [...new Set(result.servers)],
        ...(Object.keys(result.serverNames).length ? { serverNames: result.serverNames } : {}),
        skills: [...new Set(result.skills)],
      };
      this.write(state);
      return { key, ...state.installed[key]! };
    });
  }

  /** Forget an installed plugin and remove its files; the caller removes
   * the servers and skills it returns. */
  recordUninstall(marketplace: string, plugin: string): Promise<InstalledMarketplacePlugin> {
    return this.serial(async () => {
      const state = this.read();
      const key = `${plugin}@${marketplace}`;
      const installed = state.installed[key];
      if (!installed) throw new BotPluginError("That plugin is not installed.", "not_found", 404);
      delete state.installed[key];
      this.write(state);
      rmSync(this.pluginDir(marketplace, plugin), { recursive: true, force: true });
      notePluginFolderChanged(this.pluginDir(marketplace, plugin));
      return { key, ...installed };
    });
  }
}

// ── background pull (#3612) ──────────────────────────────────────────────
// A marketplace was pulled only when a person pressed Update, so a copy
// stayed versions behind with nothing saying so. The marketplaces with at
// least one installed plugin are now pulled in the background with the same
// `refresh` (through the same scope's path the Update button takes), so the
// existing `updateAvailable` is true without a click. It never updates an
// installed copy: that stays the act of the person or of the bot.

/** The first run, never sooner after start (start-up stalls the event loop
 * and the first minutes resume cut turns). */
export const MARKETPLACE_REFRESH_FIRST_DELAY_MS = 5 * 60_000;
/** Once a day after that. */
export const MARKETPLACE_REFRESH_INTERVAL_MS = 24 * 60 * 60_000;
/** A random share of this is added to every wait, so servers started
 * together do not all pull at the same instant. */
export const MARKETPLACE_REFRESH_SPREAD_MS = 30 * 60_000;
/** One pull given up past this (the clone itself has its own git timeout). */
export const MARKETPLACE_REFRESH_PULL_TIMEOUT_MS = 3 * 60_000;
/** The pause between two marketplaces, so a run yields to the server. */
export const MARKETPLACE_REFRESH_GAP_MS = 5_000;

/** Who holds an installed plugin from a marketplace, and so whose Update
 * path (and credentials) a background pull takes. */
export interface MarketplacePullScope {
  kind: "installation" | "bot" | "person";
  /** the bot id, the person id, or "installation" */
  id: string;
  /** the person this scope belongs to: the actor of the pull */
  owner?: string;
}

/** The scope a background pull goes through, or none. A private marketplace
 * is pulled only through a scope of its author (never with another person's
 * credentials); an org-wide one through the installation's scope first,
 * then any holder. On a server of one person, any holder. */
export function pickMarketplacePullScope(
  record: { visibility?: MarketplaceVisibility; addedBy?: string },
  scopes: readonly MarketplacePullScope[],
  singlePerson: boolean,
): MarketplacePullScope | undefined {
  if (!scopes.length) return undefined;
  if (singlePerson) return scopes.find((scope) => scope.kind === "installation") ?? scopes[0];
  if (marketplaceVisibility(record) === "private") {
    const author = record.addedBy?.trim().toLowerCase();
    if (!author) return undefined;
    return scopes.find((scope) => scope.owner?.trim().toLowerCase() === author);
  }
  return scopes.find((scope) => scope.kind === "installation") ?? scopes[0];
}

export interface MarketplaceBackgroundRefreshOptions {
  /** the names of the installation's one list */
  marketplaces: () => string[];
  record: (name: string) => { visibility?: MarketplaceVisibility; addedBy?: string } | undefined;
  /** who has at least one plugin installed from it (empty: not pulled) */
  scopes: (name: string) => MarketplacePullScope[];
  /** the existing Update path of that scope (it calls `refresh`) */
  pull: (name: string, scope: MarketplacePullScope) => Promise<unknown>;
  singlePerson?: boolean;
  log?: (line: string) => void;
  random?: () => number;
}

export interface MarketplaceBackgroundRefresh {
  stop(): void;
}

/** Pull, in the background, the marketplaces with an installed plugin:
 * first past `MARKETPLACE_REFRESH_FIRST_DELAY_MS`, then daily, each wait
 * spread at random; one marketplace at a time with a pause between two; a
 * pull past its timeout or failing is logged in one line and the run goes
 * on. `stop` (shutdown) clears the timer and ends a run between two pulls. */
export function startMarketplaceBackgroundRefresh(options: MarketplaceBackgroundRefreshOptions): MarketplaceBackgroundRefresh {
  const random = options.random ?? Math.random;
  const log = options.log ?? ((line: string) => console.warn(line));
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let wake: (() => void) | null = null;

  const wait = (ms: number) => new Promise<void>((resolve) => {
    wake = resolve;
    timer = setTimeout(() => { timer = null; wake = null; resolve(); }, ms);
    timer.unref?.();
  });
  const spread = () => Math.floor(random() * MARKETPLACE_REFRESH_SPREAD_MS);
  const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 300);

  const pullOne = async (name: string): Promise<void> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const record = options.record(name);
      if (!record) return;
      const scope = pickMarketplacePullScope(record, options.scopes(name), options.singlePerson === true);
      if (!scope) return;
      await Promise.race([
        options.pull(name, scope),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`no answer within ${MARKETPLACE_REFRESH_PULL_TIMEOUT_MS / 1000} s`)), MARKETPLACE_REFRESH_PULL_TIMEOUT_MS);
          timeout.unref?.();
        }),
      ]);
    } catch (error) {
      log(`[plugins] background pull of marketplace ${name} failed, installed copies untouched: ${reason(error)}`);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };

  const run = async (): Promise<void> => {
    let names: string[] = [];
    try { names = options.marketplaces(); } catch (error) { log(`[plugins] background pull could not list the marketplaces: ${reason(error)}`); }
    let pulledOne = false;
    for (const name of names) {
      if (stopped) return;
      let held = false;
      try { held = options.scopes(name).length > 0; } catch { held = false; }
      if (!held) continue;
      // one clone at a time, with a pause that yields between two
      if (pulledOne) {
        await wait(MARKETPLACE_REFRESH_GAP_MS);
        if (stopped) return;
      }
      pulledOne = true;
      await pullOne(name);
    }
  };

  const loop = async (delay: number): Promise<void> => {
    await wait(delay);
    if (stopped) return;
    try { await run(); } catch (error) { log(`[plugins] background pull stopped: ${reason(error)}`); }
    if (stopped) return;
    void loop(MARKETPLACE_REFRESH_INTERVAL_MS + spread());
  };
  void loop(MARKETPLACE_REFRESH_FIRST_DELAY_MS + spread());

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      const resume = wake;
      wake = null;
      resume?.();
    },
  };
}

/** Copy a plugin folder without links or git metadata. */
function copyPlain(from: string, to: string): void {
  if (!existsSync(from) || !statSync(from).isDirectory()) throw new BotPluginError("The plugin's folder is missing from its repository.", "invalid_plugin", 422);
  rmSync(to, { recursive: true, force: true });
  notePluginFolderChanged(to);
  mkdirSync(join(to, ".."), { recursive: true });
  cpSync(from, to, {
    recursive: true,
    dereference: false,
    // #3063: macOS metadata (`._*`, `.DS_Store`) never reaches an engine
    filter: (path) => withoutMacMetadata(path) && !lstatSync(path).isSymbolicLink() && !path.split(/[\\/]/).includes(".git"),
  });
}
