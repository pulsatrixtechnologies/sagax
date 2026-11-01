// The linked server installs the signed Perspicax Flow pack directly over
// HTTP with its own link token. No member sign-in or Claude CLI is required.
// The guarded directory declaration and archive hashes remain authoritative;
// sanitized folders serve every engine from the same selected installation.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { copySanitizedPlugin } from "./bot-plugins.ts";
import { installationCapabilityBridge } from "./installation-capability-bridge.ts";
import { ZipReader } from "./zip.ts";
import type { FlowPluginsDeclaration } from "./perspicax-link.ts";

export type OrgFlowPluginState = "installed" | "pending" | "failed";

export interface OrgFlowPluginStatus {
  /** `<plugin>@<marketplace>`. */
  id: string;
  tenant: boolean;
  state: OrgFlowPluginState;
  version?: string;
  /** A short reason, never a token. */
  error?: string;
}

export interface OrgFlowPluginsStatus {
  /** unknown: Perspicax sent no declaration (an older Perspicax, or before
   * the first directory); off: the admin turned it off (or no pack). */
  mode: "unknown" | "off" | "on";
  plugins: OrgFlowPluginStatus[];
  /** Why nothing could be installed now, readable (never a token). */
  error?: string;
  /** off only: Perspicax's reason code when it holds the install back
   * (`flow_guard_not_enforced`, `flow_guard_uncovered`, ...). */
  reason?: string;
  syncedAt?: number;
}

const savedSchema = z.object({
  version: z.literal(2),
  /** digest of the declaration last applied in full */
  applied: z.string().optional(),
  pack: z.string().optional(),
  /** plugin name -> the version its load copy holds */
  loaded: z.record(z.string(), z.string()).default({}),
}).strict();
type Saved = z.infer<typeof savedSchema>;

export interface OrgFlowPluginsOptions {
  dataDir: string;
  /** Perspicax's issuer: the marketplace must be served from its origin. */
  issuer: string;
  /** The last directory's declaration; undefined when it sent none. */
  declaration: () => FlowPluginsDeclaration | undefined;
  /** This installation's link token, never a member's exchanged identity. */
  token: () => Promise<string | undefined>;
  /** Whether this principal is an active member of the organization now. */
  isMember: (principalId: string) => boolean;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

function digest(declaration: FlowPluginsDeclaration): string {
  const { enabled, guard, name, url, resource, pack, plugins } = declaration;
  return createHash("sha256").update(JSON.stringify({ enabled, guard, name, url, resource, pack, plugins })).digest("hex").slice(0, 32);
}

/** Whether Perspicax declares Flow on with its server guard enforcing every
 * write a member can make (the copy loaded here carries no hooks). */
export function guarded(declaration: FlowPluginsDeclaration | undefined): boolean {
  return Boolean(declaration && declaration.enabled && declaration.guard === "enforce" && declaration.plugins.length > 0);
}

function short(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

const MAX_PLUGIN_BYTES = 128 * 1024 * 1024;
const manifestSchema = z.object({
  name: z.string(),
  plugins: z.array(z.object({
    name: z.string(), version: z.string(),
    source: z.object({ source: z.literal("archive"), url: z.string().url(), sha256: z.string().regex(/^[a-f0-9]{64}$/i) }),
  })),
});

export class OrgFlowPlugins {
  private readonly options: OrgFlowPluginsOptions;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly fetch: typeof fetch;
  private lock: Promise<unknown> = Promise.resolve();
  private current: OrgFlowPluginsStatus = { mode: "unknown", plugins: [] };

  constructor(options: OrgFlowPluginsOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.log(line));
    this.fetch = options.fetch ?? fetch;
  }

  /** `<data>/org-flow-plugins`. */
  get root(): string {
    return join(this.options.dataDir, "org-flow-plugins");
  }

  private get stateFile(): string {
    return join(this.root, "state.json");
  }

  private loadDir(name: string): string {
    return join(this.root, "load", name);
  }

  private read(): Saved {
    const bridge = installationCapabilityBridge();
    if (bridge?.hasMigrated("org-flow-state")) {
      try {
        return savedSchema.parse(bridge.read().orgFlow ?? { version: 2, loaded: {} });
      } catch {
        return { version: 2, loaded: {} };
      }
    }
    try {
      return savedSchema.parse(JSON.parse(readFileSync(this.stateFile, "utf8")));
    } catch {
      return { version: 2, loaded: {} };
    }
  }

  private write(saved: Saved): void {
    const parsed = savedSchema.parse(saved);
    const bridge = installationCapabilityBridge();
    if (bridge?.hasMigrated("org-flow-state")) {
      bridge.patch((document) => {
        document.orgFlow = parsed;
      });
      return;
    }
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    writeFileAtomic(this.stateFile, JSON.stringify(parsed, null, 2));
  }

  status(): OrgFlowPluginsStatus {
    return structuredClone(this.current);
  }

  /** Bring the copy in line with the declaration. Idempotent and
   * serialized. Installation uses the server link regardless of who triggered it. */
  sync(reason: string): Promise<OrgFlowPluginsStatus> {
    const next = this.lock.catch(() => undefined).then(() => this.apply(reason));
    this.lock = next.catch(() => undefined);
    return next;
  }

  /** The marketplace must be Perspicax's own, its token for this audience. */
  private refusal(declaration: FlowPluginsDeclaration): string | undefined {
    let issuer: URL;
    let url: URL;
    try {
      issuer = new URL(this.options.issuer);
      url = new URL(declaration.url);
    } catch {
      return "the declared marketplace URL is not valid";
    }
    if (url.origin !== issuer.origin) return `the declared marketplace is not served by Perspicax (${url.origin})`;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && issuer.protocol === "http:")) return "the declared marketplace is not https";
    if (declaration.resource !== `${issuer.origin}${issuer.pathname.replace(/\/+$/, "")}/flow/marketplace`) return "the declared token audience is not the Flow marketplace's";
    return undefined;
  }

  private takeOut(why: string): void {
    if (existsSync(this.root)) {
      rmSync(this.root, { recursive: true, force: true });
      this.log(`[org-flow-plugins] Pulsatrix Flow taken out (${why})`);
    }
  }

  private async apply(reason: string): Promise<OrgFlowPluginsStatus> {
    const declaration = this.options.declaration();
    const now = this.now();
    if (!declaration) {
      // An older Perspicax, or no directory yet: leave what is there.
      this.current = { mode: "unknown", plugins: [], syncedAt: now };
      return this.status();
    }
    if (!guarded(declaration)) {
      const why = !declaration.enabled
        ? (declaration.reason ? `held back by Perspicax (${declaration.reason})` : "turned off in Perspicax")
        : declaration.guard !== "enforce"
          ? "Perspicax does not enforce the Flow guard"
          : "no Flow pack is active in Perspicax";
      this.takeOut(why);
      this.current = { mode: "off", plugins: [], syncedAt: now, ...(declaration.reason ? { reason: declaration.reason } : {}) };
      return this.status();
    }
    const market = declaration.name;
    const ids = declaration.plugins.map((plugin) => ({ ...plugin, id: `${plugin.name}@${market}` }));
    const pending = (error: string): OrgFlowPluginsStatus => {
      const saved = this.read();
      this.current = {
        mode: "on",
        error,
        syncedAt: now,
        plugins: ids.map((p) => {
          const have = saved.loaded[p.name];
          return have && existsSync(this.loadDir(p.name))
            ? { id: p.id, tenant: p.tenant, state: "installed" as const, version: have }
            : { id: p.id, tenant: p.tenant, state: "pending" as const };
        }),
      };
      return this.status();
    };
    const refused = this.refusal(declaration);
    if (refused) {
      this.log(`[org-flow-plugins] refused: ${refused}`);
      return pending(refused);
    }
    const saved = this.read();
    const wanted = digest(declaration);
    const current = ids.every((p) => saved.loaded[p.name] === p.version && existsSync(join(this.loadDir(p.name), ".claude-plugin", "plugin.json")));
    if (saved.applied === wanted && current) {
      // Already up to date: nothing to fetch, nothing to say.
      if (saved.pack !== declaration.pack) this.write({ ...saved, pack: declaration.pack });
      this.current = { mode: "on", syncedAt: now, plugins: ids.map((p) => ({ id: p.id, tenant: p.tenant, state: "installed", version: p.version })) };
      return this.status();
    }
    const token = await this.options.token();
    if (!token) return pending("the server link is unavailable: Pulsatrix Flow installs when it is restored");
    const statuses: OrgFlowPluginStatus[] = [];
    const next = this.read();
    let complete = true;
    try {
      const manifest = manifestSchema.parse(JSON.parse((await this.bytes(declaration.url, token, 1024 * 1024)).toString("utf8")));
      if (manifest.name !== market) throw new Error("the marketplace name does not match its declaration");
      for (const plugin of ids) {
        if (next.loaded[plugin.name] === plugin.version && existsSync(join(this.loadDir(plugin.name), ".claude-plugin", "plugin.json"))) {
          statuses.push({ id: plugin.id, tenant: plugin.tenant, state: "installed", version: plugin.version });
          continue;
        }
        try {
          const matches = manifest.plugins.filter((entry) => entry.name === plugin.name && entry.version === plugin.version);
          if (matches.length !== 1) throw new Error("the declared plugin version is missing or ambiguous in the marketplace");
          const source = matches[0]!.source;
          const url = new URL(source.url);
          const resource = new URL(declaration.resource);
          if (url.origin !== resource.origin || !url.pathname.startsWith(`${resource.pathname}/plugins/`) || url.username || url.password) throw new Error("the archive is not served by this Flow marketplace");
          const archive = await this.bytes(url.toString(), token, MAX_PLUGIN_BYTES);
          if (createHash("sha256").update(archive).digest("hex") !== source.sha256.toLowerCase()) throw new Error("archive integrity check failed");
          this.installArchive(plugin, archive);
          next.loaded[plugin.name] = plugin.version;
          statuses.push({ id: plugin.id, tenant: plugin.tenant, state: "installed", version: plugin.version });
          this.log(`[org-flow-plugins] ${plugin.id} ${plugin.version} ready (${reason})`);
        } catch (error) {
          complete = false;
          statuses.push({ id: plugin.id, tenant: plugin.tenant, state: "failed", error: short(`install: ${error instanceof Error ? error.message : String(error)}`.split(token).join("[token]")) });
        }
      }
      for (const name of Object.keys(next.loaded)) {
        if (!ids.some((p) => p.name === name)) {
          rmSync(this.loadDir(name), { recursive: true, force: true });
          delete next.loaded[name];
        }
      }
      if (!complete) { delete next.applied; delete next.pack; }
      this.write({ ...next, ...(complete ? { applied: wanted, pack: declaration.pack } : {}) });
    } catch (error) {
      return pending(short(`the Perspicax marketplace could not be read: ${error instanceof Error ? error.message : String(error)}`.split(token).join("[token]")));
    }
    const failed = statuses.find((s) => s.state === "failed");
    this.current = { mode: "on", plugins: statuses, syncedAt: now, ...(failed ? { error: failed.error } : {}) };
    if (failed) this.log(`[org-flow-plugins] ${failed.id}: ${failed.error}`);
    return this.status();
  }

  private async bytes(url: string, token: string, limit: number): Promise<Buffer> {
    const response = await this.fetch(url, { headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(120_000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("empty marketplace response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return Buffer.concat(chunks);
        size += value.byteLength;
        if (size > limit) throw new Error("the marketplace response exceeds its size limit");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
  }

  private installArchive(plugin: { name: string; version: string }, archive: Buffer): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const staging = mkdtempSync(join(this.root, ".install-"));
    try {
      const file = join(staging, "plugin.zip");
      writeFileSync(file, archive, { mode: 0o600 });
      const zip = ZipReader.open(file, { maxEntries: 20_000, maxTotalBytes: MAX_PLUGIN_BYTES, maxEntryBytes: MAX_PLUGIN_BYTES });
      const source = join(staging, "source");
      try {
        const prefix = `${plugin.name}/`;
        const manifest = zip.json(`${prefix}.claude-plugin/plugin.json`) as { name?: unknown; version?: unknown };
        if (manifest?.name !== plugin.name || manifest.version !== plugin.version) throw new Error("the archive plugin identity does not match its declaration");
        for (const [name, entry] of zip.entries) {
          if (!name.startsWith(prefix)) throw new Error("a file in the archive is outside the declared plugin");
          const target = join(source, name.slice(prefix.length));
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, zip.read(name), { mode: entry.executable ? 0o755 : 0o644 });
        }
      } finally { zip.close(); }
      const prepared = join(staging, "prepared");
      copySanitizedPlugin(source, prepared);
      const target = this.loadDir(plugin.name);
      const before = join(staging, "previous");
      mkdirSync(dirname(target), { recursive: true });
      if (existsSync(target)) renameSync(target, before);
      try { renameSync(prepared, target); }
      catch (error) { if (existsSync(before)) renameSync(before, target); throw error; }
    } finally { rmSync(staging, { recursive: true, force: true }); }
  }

  loadedPack(): string | undefined { return this.read().pack; }
  loadedVersion(name: string): string | undefined { return this.loadedDir(name) ? this.read().loaded[name] : undefined; }

  /** The installed copy of one declared plugin (the folder dirsFor hands a
   * turn), or undefined: the capabilities list reads it. */
  loadedDir(name: string): string | undefined {
    if (!this.read().loaded[name]) return undefined;
    const dir = this.loadDir(name);
    return existsSync(join(dir, ".claude-plugin", "plugin.json")) ? dir : undefined;
  }

  /** The organization's plugin folders for a turn of a bot owned by
   * `owner`, after the bot's own (`own`, loaded first): none for a person
   * who is not an active member, none when it is off or Perspicax does not
   * enforce the Flow guard, and none whose plugin the bot already has. */
  dirsFor(owner: string | undefined, own: readonly string[]): string[] {
    if (!owner || !this.options.isMember(owner)) return [];
    const declaration = this.options.declaration();
    if (!declaration || !guarded(declaration)) return [];
    const ownNames = new Set(own.map((dir) => basename(dir)));
    const saved = this.read();
    const dirs: string[] = [];
    for (const plugin of declaration.plugins) {
      if (ownNames.has(plugin.name) || !saved.loaded[plugin.name]) continue;
      const dir = this.loadDir(plugin.name);
      if (existsSync(join(dir, ".claude-plugin", "plugin.json"))) dirs.push(dir);
    }
    return dirs;
  }
}
