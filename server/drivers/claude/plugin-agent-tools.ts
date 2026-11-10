// #3384: a plugin's agent role started from a bot turn (the Agent tool,
// `subagent_type: "<plugin>:<role>"`) names the tools it wants in its
// frontmatter, Claude Code's own (`tools: Read, Glob, Grep, Bash`). A turn
// that names its built-ins (`--tools`: an organization server, an owner's
// selection) or denies some (`--disallowedTools`) does not offer those names,
// so the CLI resolved the role's list to nothing and refused to start it
// ("would be spawned with zero tools"). On a bot the same work goes through
// other tools (the person's environment: run_command, read_file, ...).
//
// So such a turn loads a copy of the plugin whose roles that name a tool the
// turn does not offer have no `tools` field: the role starts with the bot's
// own tools for this turn, the deny rules of the turn still hold (they hold
// for subagents), and a line in the role tells it where the work goes. A
// role whose list the turn offers whole, and every turn that keeps all the
// built-ins, load the plugin folder as installed.
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

import { parse as parseYaml } from "yaml";

/** What a turn offers of Claude Code's built-ins: `offered` is the `--tools`
 * allowlist (null: every built-in), `denied` the `--disallowedTools` names. */
export interface ClaudeTurnBuiltins {
  offered: readonly string[] | null;
  denied: readonly string[];
}

/** `Task` is the older name of `Agent`: the CLI takes either. */
const ALIASES: Readonly<Record<string, string>> = { Task: "Agent" };

function canonical(name: string): string {
  const base = name.trim().replace(/\(.*$/s, "").trim();
  return ALIASES[base] ?? base;
}

/** The names of a role's `tools` value (a comma list or a YAML list). */
export function declaredAgentTools(value: unknown): string[] {
  if (typeof value === "string") return value.split(",").map((part) => part.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  return [];
}

/** The declared names the turn does not offer. An MCP tool (`mcp__...`) and
 * `*` are the CLI's to resolve against the turn's servers: never counted. */
export function unofferedAgentTools(declared: readonly string[], builtins: ClaudeTurnBuiltins): string[] {
  const offered = builtins.offered === null ? null : new Set(builtins.offered.map(canonical));
  const denied = new Set(builtins.denied.map(canonical));
  return declared.filter((name) => {
    if (name === "*" || name.startsWith("mcp__")) return false;
    const tool = canonical(name);
    return denied.has(tool) || (offered !== null && !offered.has(tool));
  });
}

/** Whether the turn hides any built-in a role may name. */
function narrowsBuiltins(builtins: ClaudeTurnBuiltins): boolean {
  return builtins.offered !== null || builtins.denied.length > 0;
}

const STALE_COPY_MS = 24 * 60 * 60 * 1000;

const FRONTMATTER = /^(---\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/;

export function roleNote(missing: readonly string[]): string {
  return `Tools on this bot: ${missing.join(", ")} are not offered in this session, so this role uses the bot's own tools of this turn for the same work (its environment's commands and files when it has one).`;
}

/** One role file rewritten for the turn, or null when it starts as written. */
export function rewriteAgentForTurn(text: string, builtins: ClaudeTurnBuiltins): string | null {
  const match = FRONTMATTER.exec(text);
  if (!match) return null;
  const front = match[2]!;
  let parsed: unknown;
  try { parsed = parseYaml(front); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Object.hasOwn(parsed, "tools")) return null;
  const missing = unofferedAgentTools(declaredAgentTools((parsed as Record<string, unknown>).tools), builtins);
  if (!missing.length) return null;
  // Drop the `tools` key and its continuation lines (a YAML list below it).
  const lines = front.split(/\r?\n/);
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^tools\s*:/.test(lines[index]!)) { kept.push(lines[index]!); continue; }
    while (index + 1 < lines.length && /^(?:[ \t]+\S|-\s)/.test(lines[index + 1]!)) index += 1;
  }
  const body = text.slice(match[0].length);
  return `${match[1]}${kept.join("\n")}${match[3]}\n${roleNote(missing)}\n\n${body.replace(/^\r?\n/, "")}`;
}

/** The plugin's role files: `agents/` and the `agents` paths of its manifest,
 * inside the plugin's folder only. */
function agentFiles(dir: string): string[] {
  const roots = [join(dir, "agents")];
  try {
    const manifest = JSON.parse(readFileSync(join(dir, ".claude-plugin", "plugin.json"), "utf8")) as { agents?: unknown };
    for (const entry of declaredAgentTools(manifest.agents)) {
      const path = resolve(dir, entry);
      if (path === dir || path.startsWith(dir + sep)) roots.push(path);
    }
  } catch { /* no manifest, or none readable: agents/ only */ }
  const out = new Set<string>();
  const walk = (path: string, depth: number) => {
    let stat;
    try { stat = lstatSync(path); } catch { return; }
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) { if (path.endsWith(".md")) out.add(path); return; }
    if (!stat.isDirectory() || depth > 4) return;
    for (const name of readdirSync(path)) walk(join(path, name), depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return [...out].sort();
}

/** Size and change time of every file of the plugin: a copy is rebuilt when
 * the installed folder changes (an update, configuration values). */
function fingerprint(dir: string): string {
  const hash = createHash("sha256");
  const walk = (path: string) => {
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name);
      let stat;
      try { stat = lstatSync(child); } catch { continue; }
      hash.update(`${relative(dir, child)}\0${stat.size}\0${stat.mtimeMs}\0`);
      if (stat.isDirectory()) walk(child);
    }
  };
  walk(dir);
  return hash.digest("hex").slice(0, 16);
}

/** One plugin folder for this turn: the installed one, or a copy under
 * `root` whose roles start (see the top of this file). */
export function pluginDirForTurn(installed: string, builtins: ClaudeTurnBuiltins, root: string): string {
  if (!narrowsBuiltins(builtins)) return installed;
  const dir = resolve(installed);
  try {
    if (!statSync(dir).isDirectory()) return installed;
  } catch { return installed; }
  const rewrites = new Map<string, string>();
  for (const file of agentFiles(dir)) {
    let text: string;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    const next = rewriteAgentForTurn(text, builtins);
    if (next !== null) rewrites.set(relative(dir, file), next);
  }
  if (!rewrites.size) return installed;
  const signature = JSON.stringify([resolve(dir), builtins.offered === null ? null : [...builtins.offered].map(canonical).sort(), [...builtins.denied].map(canonical).sort()]);
  const slot = join(root, createHash("sha256").update(signature).digest("hex").slice(0, 16));
  const stamp = fingerprint(dir);
  const target = join(slot, stamp, basename(dir));
  if (existsSync(target)) return target;
  mkdirSync(slot, { recursive: true, mode: 0o700 });
  const building = join(slot, `${stamp}.${process.pid}.${Date.now()}.tmp`);
  try {
    cpSync(dir, join(building, basename(dir)), { recursive: true, dereference: false });
    for (const [path, text] of rewrites) writeFileSync(join(building, basename(dir), path), text);
    try {
      renameSync(building, join(slot, stamp));
    } catch {
      // another turn built the same copy first
      rmSync(building, { recursive: true, force: true });
    }
  } catch {
    rmSync(building, { recursive: true, force: true });
    return installed;
  }
  if (!existsSync(target)) return installed;
  // Older copies of this plugin for the same tools, once no live session
  // can still read a skill from them.
  for (const name of readdirSync(slot)) {
    if (name === stamp) continue;
    try {
      if (Date.now() - lstatSync(join(slot, name)).mtimeMs > STALE_COPY_MS) rmSync(join(slot, name), { recursive: true, force: true });
    } catch { /* already gone */ }
  }
  return target;
}

/** Every plugin folder of a turn (`--plugin-dir`), for its built-ins. */
export function pluginDirsForTurn(dirs: readonly string[], builtins: ClaudeTurnBuiltins, root: string): string[] {
  return dirs.map((dir) => pluginDirForTurn(dir, builtins, root));
}
