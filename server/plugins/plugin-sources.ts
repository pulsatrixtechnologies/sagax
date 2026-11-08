import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { z } from "zod";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_CONTENT_NAMES = 50;

export class BotPluginError extends Error {
  readonly code: string;
  readonly status: number;
  /** What the person can do (server/github/github-access.ts GithubAccessFix). */
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
  /** #2759: the format Sagax converted it from ("cursor"), and what did not
   * convert (codes, server/plugins/cursor-catalog.ts). */
  convertedFrom?: string;
  notConverted?: string[];
  /** Where its files are: inside the marketplace, or another repository. */
  source: { kind: "path"; path: string } | { kind: "git"; git: GitSource; path?: string };
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
      ...conversionMarks(entry),
      source,
    });
  }
  return { name, ...(description ? { description } : {}), plugins };
}

/** What Sagax wrote about converting the entry (#2759). */
function conversionMarks(entry: Record<string, unknown>): Pick<MarketplacePluginEntry, "convertedFrom" | "notConverted"> {
  const from = text(entry.sagaxConvertedFrom, 20);
  const notes = Array.isArray(entry.sagaxNotConverted)
    ? entry.sagaxNotConverted.map((note) => text(note, 300)).filter((note): note is string => Boolean(note)).slice(0, 12)
    : [];
  return { ...(from ? { convertedFrom: from } : {}), ...(notes.length ? { notConverted: notes } : {}) };
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
