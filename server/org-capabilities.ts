// Capabilities lot 4: Perspicax declares the organization's capabilities,
// this linked server executes them. The declarations come from the
// directory (server/perspicax-link.ts `capabilities`, configuration
// included on that authenticated channel only); this module turns them into
// what a turn mounts, once for the whole installation:
//
// - a plugin is installed whole, once, under DATA_DIR/org-capabilities
//   (never a member's credential: the public HTTPS marketplace is read by the
//   installation itself), sanitized like every plugin (hooks removed), its
//   configuration values applied to its files, its MCP servers kept apart
//   and mounted per policy by the turn (sagax-stdio in the person's
//   environment, never on the host; a remote one under the public-address
//   rule);
// - a skill's files are materialized once as a linked Organization skill
//   (one folder every bot reads, no per-bot copy);
// - an MCP declaration (stdio or http) stays in memory, read from the last
//   directory, and is mounted by the turn per the same policy.
//
// Offered: available, off by default for each person; the person turns it
// on in their own Me state (PersonCapabilities `orgCapabilities`), never a
// global switch. Imposed: on, a member cannot turn it off. A declaration
// switched off in Perspicax is served to nobody. Organization wins over Me,
// then This bot, for the same mount (server/capability-plugin-mounts.ts
// selectPluginScopes, and the personal MCP names it claims). The single Flow
// identity is kept: a declaration whose mount belongs to Pulsatrix Flow or
// names a plugin of `flow_plugins` is never mounted a second time.
//
// Nothing here logs a configuration value, and nothing here is sent to a
// browser: the routes answer the public fields only.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { copySanitizedPlugin, readPluginContents, type PluginContents } from "./bot-plugins.ts";
import type { McpServerSpec } from "./contracts.ts";
import { installationCapabilityBridge } from "./installation-capability-bridge.ts";
import { applyPluginConfig, readPluginConfigFields } from "./plugin-config.ts";
import type { OrgCapabilityDeclaration } from "./perspicax-link.ts";

export const ORG_FLOW_MOUNT_PREFIX = "pulsatrix-flow";
/** The key prefix of an organization declaration's MCP server on a turn
 * (`pluginMcp.key`, re-resolved by the per-frame relay). */
export const ORG_CAPABILITY_KEY_PREFIX = "orgcap:";

export function isFlowMount(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === ORG_FLOW_MOUNT_PREFIX || lower.startsWith(`${ORG_FLOW_MOUNT_PREFIX}-`);
}

/** A skill file path: relative, `/` separated, no empty, `.` or `..`
 * segment, no backslash, no drive (Perspicax's valid_skill_path). */
export function validSkillPath(path: string): boolean {
  return path.length > 0 && path.length <= 256 && !path.startsWith("/") && !path.includes("\\") && !path.includes(":")
    // eslint-disable-next-line no-control-regex
    && !/[\u0000-\u001f\u007f]/.test(path) && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

export type OrgCapabilityInstallState = "installed" | "pending" | "failed" | "declared" | "off" | "flow";

/** One declaration as the screens and the resolver see it: never its
 * configuration. */
export interface OrgCapabilityView {
  id: string;
  mount: string;
  form: "plugin" | "skill" | "mcp";
  name: string;
  description: string;
  mode: "offered" | "imposed";
  enabled: boolean;
  source: { kind: "manual" } | { kind: "marketplace"; url: string; plugin: string; version?: string };
  /** stdio or http for an MCP declaration */
  transport?: "stdio" | "http";
  state: OrgCapabilityInstallState;
  /** short, readable, never a secret */
  error?: string;
  version?: string;
}

/** What a turn of one person mounts of one declaration. */
export interface OrgCapabilityMount {
  view: OrgCapabilityView;
  /** plugin and skill: the installed folder */
  dir?: string;
  contents?: PluginContents;
  /** plugin: its declared servers; mcp: the declaration itself */
  mcpServers: Record<string, McpServerSpec>;
}

const savedSchema = z.object({
  version: z.literal(1),
  loaded: z.record(z.string(), z.object({
    mount: z.string(),
    form: z.enum(["plugin", "skill"]),
    digest: z.string(),
    version: z.string().optional(),
    mcpServers: z.record(z.string(), z.unknown()).default({}),
  })).default({}),
}).strict();
type Saved = z.infer<typeof savedSchema>;

export interface OrgCapabilitiesOptions {
  dataDir: string;
  /** The last directory's declarations; undefined from an older Perspicax. */
  declarations: () => OrgCapabilityDeclaration[] | undefined;
  /** The plugin names of `flow_plugins` (one Flow identity). */
  flowNames: () => readonly string[];
  /** Whether this principal is an active member of the organization now. */
  isMember: (principalId: string) => boolean;
  /** The offered declarations this person turned on (their Me state). */
  choices: (principalId: string) => Readonly<Record<string, boolean>>;
  /** Fetch a marketplace plugin's files with the installation's own
   * identity (never a member's): the folder to copy from. */
  fetchPlugin: (source: { url: string; plugin: string; version?: string; key: string }) => Promise<string>;
  /** Where the person's environment sees the plugin folders. */
  sandboxRoot: string;
  log?: (line: string) => void;
}

function digestOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

function short(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

export class OrgCapabilities {
  private readonly options: OrgCapabilitiesOptions;
  private readonly log: (line: string) => void;
  private lock: Promise<unknown> = Promise.resolve();
  private errors = new Map<string, string>();
  private pending = new Set<string>();

  constructor(options: OrgCapabilitiesOptions) {
    this.options = options;
    this.log = options.log ?? ((line) => console.log(line));
  }

  get root(): string {
    return join(this.options.dataDir, "org-capabilities");
  }

  private get stateFile(): string {
    return join(this.root, "state.json");
  }

  loadDir(mount: string): string {
    return join(this.root, "load", mount);
  }

  private read(): Saved {
    const bridge = installationCapabilityBridge();
    if (bridge?.hasMigrated("org-capabilities-state")) {
      try {
        return savedSchema.parse(bridge.read().orgCapabilities ?? { version: 1, loaded: {} });
      } catch {
        return { version: 1, loaded: {} };
      }
    }
    try {
      return savedSchema.parse(JSON.parse(readFileSync(this.stateFile, "utf8")));
    } catch {
      return { version: 1, loaded: {} };
    }
  }

  private write(saved: Saved): void {
    const parsed = savedSchema.parse(saved);
    const bridge = installationCapabilityBridge();
    if (bridge?.hasMigrated("org-capabilities-state")) {
      bridge.patch((document) => {
        document.orgCapabilities = parsed;
      });
      return;
    }
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    writeFileAtomic(this.stateFile, JSON.stringify(parsed, null, 2), { mode: 0o600 });
  }

  /** Whether Perspicax sends declarations at all (a newer Perspicax). */
  declared(): boolean {
    return this.options.declarations() !== undefined;
  }

  private flowConflict(decl: OrgCapabilityDeclaration): boolean {
    if (isFlowMount(decl.mount_name)) return true;
    const flow = new Set(this.options.flowNames().map((name) => name.toLowerCase()));
    if (flow.has(decl.mount_name.toLowerCase())) return true;
    return decl.source.kind === "marketplace" && flow.has(decl.source.plugin.toLowerCase());
  }

  private installDigest(decl: OrgCapabilityDeclaration): string {
    const config = decl.configuration;
    if (decl.form === "skill") return digestOf({ mount: decl.mount_name, name: decl.name, description: decl.description, files: config?.type === "skill" ? config.files : null });
    return digestOf({ mount: decl.mount_name, source: decl.source, values: config?.type === "plugin" ? config.values ?? {} : {} });
  }

  /** Every declaration, public fields only, with what this server did of it. */
  views(): OrgCapabilityView[] {
    const saved = this.read();
    return (this.options.declarations() ?? []).map((decl) => this.view(decl, saved));
  }

  private view(decl: OrgCapabilityDeclaration, saved: Saved): OrgCapabilityView {
    const loaded = saved.loaded[decl.id];
    const present = loaded && existsSync(join(this.loadDir(loaded.mount), ".claude-plugin", "plugin.json"));
    const current = present && loaded.digest === this.installDigest(decl);
    let state: OrgCapabilityInstallState;
    if (this.flowConflict(decl)) state = "flow";
    else if (!decl.enabled) state = "off";
    else if (decl.form === "mcp") state = decl.configuration ? "declared" : "pending";
    else if (current) state = "installed";
    else if (this.errors.has(decl.id)) state = "failed";
    else state = "pending";
    const error = this.errors.get(decl.id);
    const version = decl.source.kind === "marketplace" ? decl.source.version ?? loaded?.version : undefined;
    return {
      id: decl.id, mount: decl.mount_name, form: decl.form, name: decl.name || decl.mount_name, description: decl.description ?? "",
      mode: decl.mode, enabled: decl.enabled,
      source: decl.source.kind === "marketplace" ? { kind: "marketplace", url: decl.source.url, plugin: decl.source.plugin, ...(decl.source.version ? { version: decl.source.version } : {}) } : { kind: "manual" },
      ...(decl.form === "mcp" && decl.configuration && (decl.configuration.type === "stdio" || decl.configuration.type === "http") ? { transport: decl.configuration.type } : decl.configuration_kind === "stdio" || decl.configuration_kind === "http" ? { transport: decl.configuration_kind } : {}),
      state,
      ...(state === "failed" && error ? { error } : {}),
      ...(version ? { version } : {}),
    };
  }

  /** Bring the installed copies in line with the declarations. Serialized
   * and idempotent: an unchanged declaration is not fetched again. */
  sync(reason: string): Promise<OrgCapabilityView[]> {
    const next = this.lock.catch(() => undefined).then(() => this.apply(reason));
    this.lock = next.catch(() => undefined);
    return next;
  }

  private async apply(reason: string): Promise<OrgCapabilityView[]> {
    const declarations = this.options.declarations();
    // An older Perspicax, or no directory yet: leave what is there.
    if (declarations === undefined) return [];
    const saved = this.read();
    const wanted = new Map<string, OrgCapabilityDeclaration>();
    for (const decl of declarations) {
      if (decl.form === "mcp" || !decl.enabled || this.flowConflict(decl)) continue;
      wanted.set(decl.id, decl);
    }
    // Taken out: no longer declared, switched off, or another form now.
    for (const [id, loaded] of Object.entries(saved.loaded)) {
      const decl = wanted.get(id);
      if (decl && decl.mount_name === loaded.mount && decl.form === loaded.form) continue;
      rmSync(this.loadDir(loaded.mount), { recursive: true, force: true });
      delete saved.loaded[id];
      this.errors.delete(id);
      this.log(`[org-capabilities] ${loaded.form} ${loaded.mount} taken out (${reason})`);
    }
    this.write(saved);
    for (const decl of wanted.values()) {
      const digest = this.installDigest(decl);
      const loaded = saved.loaded[decl.id];
      if (loaded && loaded.digest === digest && existsSync(join(this.loadDir(decl.mount_name), ".claude-plugin", "plugin.json"))) continue;
      // Another declaration already holds this folder (a mount is unique in
      // Perspicax; a rename in flight keeps the first one).
      const holder = Object.entries(saved.loaded).find(([id, entry]) => id !== decl.id && entry.mount.toLowerCase() === decl.mount_name.toLowerCase());
      if (holder) { this.errors.set(decl.id, "another organization capability holds this mount name"); continue; }
      this.pending.add(decl.id);
      try {
        const installed = decl.form === "skill" ? this.materializeSkill(decl) : await this.installPlugin(decl);
        saved.loaded[decl.id] = { mount: decl.mount_name, form: decl.form as "plugin" | "skill", digest, ...(installed.version ? { version: installed.version } : {}), mcpServers: installed.mcpServers };
        this.write(saved);
        this.errors.delete(decl.id);
        this.log(`[org-capabilities] ${decl.form} ${decl.mount_name} ready (${reason})`);
      } catch (error) {
        const text = short(error instanceof Error ? error.message : String(error));
        this.errors.set(decl.id, text);
        this.log(`[org-capabilities] ${decl.form} ${decl.mount_name}: ${text}`);
      } finally {
        this.pending.delete(decl.id);
      }
    }
    return this.views();
  }

  /** Swap a prepared folder in place of the mount's load folder. */
  private place(mount: string, prepared: string, staging: string): void {
    const target = this.loadDir(mount);
    const before = join(staging, "previous");
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) renameSync(target, before);
    try { renameSync(prepared, target); } catch (error) { if (existsSync(before)) renameSync(before, target); throw error; }
  }

  private materializeSkill(decl: OrgCapabilityDeclaration): { version?: string; mcpServers: Record<string, McpServerSpec> } {
    const config = decl.configuration;
    if (config?.type !== "skill") throw new Error("the skill has no files in this directory");
    const paths = Object.keys(config.files);
    if (!paths.includes("SKILL.md")) throw new Error("the skill has no SKILL.md");
    const bad = paths.find((path) => !validSkillPath(path));
    if (bad) throw new Error(`the skill file path ${JSON.stringify(bad)} is not relative`);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const staging = mkdtempSync(join(this.root, ".skill-"));
    try {
      const prepared = join(staging, "prepared");
      mkdirSync(join(prepared, ".claude-plugin"), { recursive: true });
      writeFileSync(join(prepared, ".claude-plugin", "plugin.json"), JSON.stringify({ name: decl.mount_name, description: decl.description || decl.name }, null, 2));
      for (const [path, text] of Object.entries(config.files)) {
        const file = join(prepared, "skills", decl.mount_name, ...path.split("/"));
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, text, { mode: 0o644 });
      }
      this.place(decl.mount_name, prepared, staging);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    return { mcpServers: {} };
  }

  private async installPlugin(decl: OrgCapabilityDeclaration): Promise<{ version?: string; mcpServers: Record<string, McpServerSpec> }> {
    if (decl.source.kind !== "marketplace") throw new Error("a plugin comes from a marketplace");
    const source = await this.options.fetchPlugin({ url: decl.source.url, plugin: decl.source.plugin, ...(decl.source.version ? { version: decl.source.version } : {}), key: decl.id });
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const staging = mkdtempSync(join(this.root, ".plugin-"));
    try {
      const prepared = join(staging, "prepared");
      // Hooks, LSP and monitors are removed; MCP declarations are kept apart.
      const result = copySanitizedPlugin(source, prepared, undefined, `${this.options.sandboxRoot}/${decl.mount_name}`);
      const config = decl.configuration;
      if (config?.type === "plugin" && config.values && Object.keys(config.values).length) {
        applyPluginConfig(prepared, readPluginConfigFields(prepared), config.values);
      }
      let version: string | undefined;
      try { version = (JSON.parse(readFileSync(join(prepared, ".claude-plugin", "plugin.json"), "utf8")) as { version?: unknown }).version as string | undefined; } catch { version = undefined; }
      this.place(decl.mount_name, prepared, staging);
      return { ...(typeof version === "string" && version ? { version } : {}), mcpServers: result.mcpServers };
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  /** Whether this declaration is on for this person: imposed, or offered
   * and turned on in their own Me state. Off in Perspicax, a Flow mount, or
   * a person who is not an active member: off. */
  activeFor(decl: Pick<OrgCapabilityView, "id" | "mode" | "enabled" | "state">, principalId: string | undefined): boolean {
    if (!principalId || !decl.enabled || decl.state === "flow" || decl.state === "off") return false;
    if (!this.options.isMember(principalId)) return false;
    if (decl.mode === "imposed") return true;
    try { return this.options.choices(principalId)[decl.id] === true; } catch { return false; }
  }

  /** What a turn of this person mounts: the active declarations with their
   * installed folders and MCP servers. Organization mount names first: the
   * caller lets them win over Me and This bot. */
  mountsFor(principalId: string | undefined): OrgCapabilityMount[] {
    const declarations = this.options.declarations() ?? [];
    const saved = this.read();
    const out: OrgCapabilityMount[] = [];
    for (const decl of declarations) {
      const view = this.view(decl, saved);
      if (!this.activeFor(view, principalId)) continue;
      if (decl.form === "mcp") {
        const config = decl.configuration;
        if (config?.type === "stdio") out.push({ view, mcpServers: { [decl.mount_name]: { command: config.command, args: [...config.args], env: { ...config.env } } } });
        else if (config?.type === "http") out.push({ view, mcpServers: { [decl.mount_name]: { type: "http", url: config.url, headers: { ...config.headers } } } });
        continue;
      }
      if (view.state !== "installed") continue;
      const dir = this.loadDir(decl.mount_name);
      let contents: PluginContents = { skills: [], commands: [], agents: [] };
      try { contents = readPluginContents(dir); } catch { /* listed without its contents */ }
      out.push({ view, dir, contents, mcpServers: (saved.loaded[decl.id]?.mcpServers ?? {}) as Record<string, McpServerSpec> });
    }
    return out;
  }

  /** The mount names the organization claims for this person (MCP servers
   * and plugin servers included): a personal server of the same name is
   * left out, the organization's wins. */
  claimedNames(principalId: string | undefined): Set<string> {
    const names = new Set<string>();
    for (const mount of this.mountsFor(principalId)) {
      names.add(mount.view.mount);
      for (const name of Object.keys(mount.mcpServers)) names.add(name);
    }
    return names;
  }
}
