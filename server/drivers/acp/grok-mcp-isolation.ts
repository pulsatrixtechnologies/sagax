// #2747: a bot's Grok CLI sees only the MCP servers Sagax mounts for it.
//
// Grok merges MCP servers from many places besides ACP session/new: the
// `[mcp_servers.*]` tables of $GROK_HOME/config.toml, every project
// `.grok/config.toml` and `.mcp.json`, Claude's ~/.claude.json, Cursor's
// ~/.cursor/mcp.json, Codex's config and the `.mcp.json` of installed plugins.
// On a person's Mac those are their own connectors (production Perspicax
// profiles, for one), and a Sagax bot inherited all of them.
//
// GROK_CONFIG overlays cannot remove MCP tables (grok allowlists the keys), so
// each turn runs on an isolated GROK_HOME instead: a Sagax-owned directory
// that links every entry of the real home (login, sessions, caches, skills,
// trusted folders) except the MCP and plugin sources, with a config.toml
// copied without its MCP, plugin and marketplace tables, and a
// requirements.toml that turns project MCP off. The compat sources are off
// through their env switches. The login stays in the real file through
// GROK_AUTH_PATH, so a token refresh never forks it. Verified against grok
// 1.0.77 with `grok inspect`: every user server disabled or absent.

import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/** Entries of the real home never linked: they declare or hold MCP servers
 * and plugins (whose `.mcp.json` grok mounts), or are regenerated here. */
const NOT_LINKED = new Set([
  "config.toml",
  "requirements.toml",
  "installed-plugins",
  "plugins",
  "marketplace-cache",
  "mcp_credentials.json",
  "mcp_credentials.lock",
]);

/** Entries made in the real home first, so the isolated home links them and
 * what grok writes there (sessions Sagax resumes) stays in the real home. */
const SHARED_DIRECTORIES = ["sessions"];

/** The env switches of grok's compat sources (Claude, Cursor, Codex): their
 * MCP servers, and (QA of #2816) their skills and hooks, which are the
 * person's own plugins and scripts, never the bot's. Names read from the
 * grok 1.0.77 binary. */
export const GROK_COMPAT_MCP_OFF: Readonly<Record<string, string>> = {
  GROK_CLAUDE_MCPS_ENABLED: "false",
  GROK_CURSOR_MCPS_ENABLED: "false",
  GROK_CODEX_MCPS_ENABLED: "false",
  GROK_CLAUDE_SKILLS_ENABLED: "false",
  GROK_CURSOR_SKILLS_ENABLED: "false",
  GROK_CODEX_SKILLS_ENABLED: "false",
  GROK_CLAUDE_HOOKS_ENABLED: "false",
  GROK_CURSOR_HOOKS_ENABLED: "false",
  GROK_CODEX_HOOKS_ENABLED: "false",
};

const TABLE = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/;
const DROPPED_ROOT = /^["']?(?:mcp_servers|plugins|marketplace|disabled_mcp_servers)["']?\s*(?:\.|$)/;
const DROPPED_KEY = /^\s*["']?(?:mcp_servers|plugins|marketplace|disabled_mcp_servers)["']?\s*[.=]/;

/** config.toml without any MCP server, plugin or marketplace table or key.
 * Multi-line values of a dropped key at the top level are dropped with it. */
export function grokIsolatedConfigToml(source: string): string {
  const out: string[] = [];
  let skipTable = false;
  let openBrackets = 0;
  for (const line of source.split(/\r?\n/)) {
    if (openBrackets > 0) {
      openBrackets += bracketDelta(line);
      continue;
    }
    const table = TABLE.exec(line);
    if (table) {
      skipTable = DROPPED_ROOT.test(table[1]!.replace(/\s+/g, ""));
      if (skipTable) continue;
    }
    if (skipTable) continue;
    if (DROPPED_KEY.test(line)) {
      openBrackets = Math.max(0, bracketDelta(line));
      continue;
    }
    out.push(line);
  }
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

function bracketDelta(line: string): number {
  const code = line.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, "").replace(/#.*$/, "");
  return (code.match(/[[{]/g)?.length ?? 0) - (code.match(/[\]}]/g)?.length ?? 0);
}

/** The real home's requirements with project MCP off (its other policy kept). */
export function grokIsolatedRequirements(source: string | undefined): string {
  const kept = (source ?? "").split(/\r?\n/).filter((line) => !/^\s*enable_all_project_mcp_servers\s*=/.test(line));
  // a top-level key must come before the first table
  return `enable_all_project_mcp_servers = false\n${kept.join("\n").replace(/\n+$/, "")}\n`.replace(/\n+$/, "\n");
}

function writeIfChanged(path: string, text: string): void {
  try {
    if (readFileSync(path, "utf8") === text) return;
  } catch {
    /* new */
  }
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, text, { mode: 0o600 });
  renameSync(temp, path);
}

function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Builds (or refreshes) the isolated home for `source` under `root` and
 * returns its path. Safe to call on every turn and from parallel turns. */
export function syncGrokIsolatedHome(source: string, root: string): string {
  const target = join(root, createHash("sha256").update(source).digest("hex").slice(0, 16), ".grok");
  mkdirSync(target, { recursive: true, mode: 0o700 });
  mkdirSync(source, { recursive: true, mode: 0o700 });
  for (const name of SHARED_DIRECTORIES) mkdirSync(join(source, name), { recursive: true, mode: 0o700 });
  const wanted = new Set<string>();
  for (const name of readdirSync(source)) {
    if (NOT_LINKED.has(name) || name.startsWith("mcp_auth_")) continue;
    wanted.add(name);
    const link = join(target, name);
    const real = join(source, name);
    let stat;
    try {
      stat = lstatSync(link);
    } catch {
      stat = undefined;
    }
    // a real file grok made here stays (it is the isolated home's own)
    if (stat && !stat.isSymbolicLink()) continue;
    if (stat && readlinkSync(link) === real) continue;
    if (stat) rmSync(link, { force: true });
    try {
      symlinkSync(real, link);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  // links to entries the real home no longer has, or never may link
  for (const name of readdirSync(target)) {
    if (wanted.has(name)) continue;
    const link = join(target, name);
    try {
      if (lstatSync(link).isSymbolicLink()) rmSync(link, { force: true });
    } catch {
      /* gone */
    }
  }
  writeIfChanged(join(target, "config.toml"), grokIsolatedConfigToml(readOptional(join(source, "config.toml")) ?? ""));
  writeIfChanged(join(target, "requirements.toml"), grokIsolatedRequirements(readOptional(join(source, "requirements.toml"))));
  return target;
}

/** Points a turn's env at the isolated home of its current GROK_HOME, keeps
 * the login in the real auth.json and turns the compat MCP sources off. */
export function isolateGrokMcp(env: Record<string, string | undefined>, source: string, root: string): void {
  Object.assign(env, GROK_COMPAT_MCP_OFF);
  // already isolated (a second pass on the same env)
  if (resolve(source).startsWith(`${resolve(root)}${sep}`)) return;
  env.GROK_HOME = syncGrokIsolatedHome(source, root);
  env.GROK_AUTH_PATH = join(source, "auth.json");
}
