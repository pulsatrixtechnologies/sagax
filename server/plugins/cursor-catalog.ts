// A Cursor plugin marketplace (`.cursor-plugin/marketplace.json`, the
// official one is cursor/plugins) read as a Sagax marketplace (#2759): each
// Cursor plugin is rewritten in the Claude Code layout under
// `sagax-cursor/<name>/` and a `.claude-plugin/marketplace.json` lists them,
// so the workspace and per-bot installs work unchanged.
//
// What converts: skills (same SKILL.md format), agents, commands, rules
// (each `.mdc` becomes a skill whose body is the rule), MCP servers
// (`mcp.json`, inline or a path, into `.mcp.json`) and variables (into
// `userConfig`, a secret marked `sensitive`). What does not convert is listed
// on the plugin's page (`sagaxNotConverted`): Cursor hooks and automations,
// the scope of a rule (globs, alwaysApply), Cursor-only agent settings and the
// `${VAR}` an MCP server expects.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import { isSkillName } from "../../shared/skill-md.ts";
import { withoutMacMetadata } from "../mac-metadata.ts";

/** Where the converted plugins live inside the clone. */
export const CURSOR_SYNTH_ROOT = "sagax-cursor";
const CURSOR_MANIFEST = join(".cursor-plugin", "marketplace.json");
const MAX_PLUGINS = 500;
const MAX_JSON_BYTES = 1_048_576;
const SECRET_NAME = /TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL/i;
const AGENT_KEYS_KEPT = new Set(["name", "description", "tools"]);

/** True when `root` holds a Cursor plugin marketplace. */
export function hasCursorMarketplace(root: string): boolean {
  return existsSync(join(root, CURSOR_MANIFEST));
}

export interface CursorConversion {
  name: string;
  /** What the Sagax plugin got. */
  converted: { skills: number; rules: number; agents: number; commands: number; mcpServers: number; variables: number };
  /** What did not convert, as `code` or `code:detail` (the page words it):
   * rules_scope, rules_always, agent_settings:<keys>, mcp_values:<names>,
   * hooks, automations. */
  notConverted: string[];
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    if (lstatSync(file).isSymbolicLink() || statSync(file).size > MAX_JSON_BYTES) return undefined;
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** A path inside `base`, or nothing (no `..`, no absolute path, no symlink). */
function inside(base: string, path: string): string | undefined {
  if (typeof path !== "string" || !path.trim() || isAbsolute(path)) return undefined;
  const target = resolve(base, path.replace(/\/\*\*?(\/\*[^/]*)?$/, "").replace(/\/\*\.[a-z]+$/i, ""));
  const rel = relative(resolve(base), target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  try {
    if (lstatSync(target).isSymbolicLink()) return undefined;
  } catch {
    return undefined;
  }
  return target;
}

function list(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function str(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim().slice(0, max) : undefined;
}

const noLinks = (src: string) => {
  // #3063: macOS metadata (`._*`, `.DS_Store`) never reaches an engine
  if (!withoutMacMetadata(src)) return false;
  try {
    return !lstatSync(src).isSymbolicLink();
  } catch {
    return false;
  }
};

/** The files of `dirs` (folders or single files) ending in `ext`. */
function filesOf(base: string, dirs: string[], ext: string): string[] {
  const out: string[] = [];
  for (const dir of dirs) {
    const path = inside(base, dir);
    if (!path) continue;
    const stat = statSync(path);
    if (stat.isFile() && path.endsWith(ext)) out.push(path);
    else if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) {
        const full = join(path, entry);
        if (entry.endsWith(ext) && noLinks(full) && statSync(full).isFile()) out.push(full);
      }
    }
  }
  return out;
}

/** Front matter and body of a markdown file (`---` block, simple `key: value` lines). */
export function splitFrontMatter(text: string): { meta: Record<string, string>; order: string[]; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, order: [], body: text };
  const meta: Record<string, string> = {};
  const order: string[] = [];
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    meta[pair[1]] = pair[2].trim();
    order.push(pair[1]);
  }
  return { meta, order, body: text.slice(match[0].length) };
}

const unquote = (value: string | undefined) => (value ?? "").replace(/^["']|["']$/g, "").trim();
const yamlString = (value: string) => JSON.stringify(value);

/** A Cursor rule (`.mdc`) as a SKILL.md: the rule's body, its scope in the description. */
export function ruleToSkill(file: string, pluginName: string): { name: string; text: string; scoped: boolean } | undefined {
  const base = basename(file, ".mdc").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const name = `rule-${base}`.slice(0, 64);
  if (!isSkillName(name)) return undefined;
  const { meta, body } = splitFrontMatter(readFileSync(file, "utf8"));
  const always = unquote(meta.alwaysApply) === "true";
  const globs = unquote(meta.globs);
  const what = unquote(meta.description) || `Rule ${base} of ${pluginName}`;
  const when = always ? "Apply it always, in every task." : globs ? `Apply it when working on files matching ${globs}.` : "Apply it when it is relevant to the task.";
  const description = `${what}. ${when}`.replace(/\.\./g, ".").slice(0, 1000);
  return {
    name,
    scoped: Boolean(globs) || !always,
    text: `---\nname: ${name}\ndescription: ${yamlString(description)}\n---\n\n${body.trim()}\n`,
  };
}

/** A Cursor agent's markdown with only the keys Claude Code reads. */
function agentText(file: string): { text: string; dropped: string[] } {
  const { meta, order, body } = splitFrontMatter(readFileSync(file, "utf8"));
  if (!order.length) return { text: body, dropped: [] };
  const kept = order.filter((key) => AGENT_KEYS_KEPT.has(key));
  const dropped = order.filter((key) => !AGENT_KEYS_KEPT.has(key));
  return { text: `---\n${kept.map((key) => `${key}: ${meta[key]}`).join("\n")}\n---\n${body}`, dropped };
}

/** The MCP servers a Cursor plugin declares (`mcpServers`: a path, an inline map, or a list of both). */
function mcpServersOf(dir: string, value: unknown): Record<string, Record<string, unknown>> {
  const servers: Record<string, Record<string, unknown>> = {};
  const add = (config: Record<string, unknown> | undefined) => {
    if (!config) return;
    const map = config.mcpServers && typeof config.mcpServers === "object" ? config.mcpServers as Record<string, unknown> : config;
    for (const [name, server] of Object.entries(map)) {
      if (server && typeof server === "object" && !Array.isArray(server)) servers[name] = server as Record<string, unknown>;
    }
  };
  const items = Array.isArray(value) ? value : value === undefined ? [] : [value];
  for (const item of items) {
    if (typeof item === "string") {
      const path = inside(dir, item);
      if (path) add(readJson(path));
    } else if (item && typeof item === "object") add(item as Record<string, unknown>);
  }
  // a plugin with no `mcpServers` key may still ship mcp.json
  if (value === undefined) for (const file of ["mcp.json", ".mcp.json"]) if (existsSync(join(dir, file))) add(readJson(join(dir, file)));
  return servers;
}

/** The `${VAR}` names a server's config expects (CURSOR_PLUGIN_ROOT aside). */
function placeholders(server: unknown): string[] {
  const found = new Set<string>();
  for (const match of JSON.stringify(server).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g)) {
    if (match[1] !== "CURSOR_PLUGIN_ROOT" && match[1] !== "CLAUDE_PLUGIN_ROOT") found.add(match[1]);
  }
  return [...found];
}

/** Variables (a JSON schema) as Claude Code `userConfig` fields. */
function userConfigOf(variables: unknown): Record<string, Record<string, unknown>> {
  const schema = variables && typeof variables === "object" ? variables as Record<string, unknown> : {};
  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties as Record<string, unknown> : {};
  const required = new Set(list(schema.required));
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, raw] of Object.entries(properties)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || !raw || typeof raw !== "object") continue;
    const prop = raw as Record<string, unknown>;
    const type = prop.type === "number" || prop.type === "integer" ? "number" : prop.type === "boolean" ? "boolean" : "string";
    out[key] = {
      type,
      title: str(prop.title, 120) ?? key,
      ...(str(prop.description, 500) ? { description: str(prop.description, 500) } : {}),
      ...(SECRET_NAME.test(key) || prop.format === "password" || prop.writeOnly === true ? { sensitive: true } : {}),
      ...(required.has(key) ? { required: true } : {}),
      ...(prop.default !== undefined && !SECRET_NAME.test(key) ? { default: prop.default } : {}),
    };
  }
  return out;
}

/** Convert one Cursor plugin folder into `target` (Claude Code layout). */
export function convertCursorPlugin(dir: string, target: string, entry: { name: string; description?: string }): CursorConversion {
  const manifest = readJson(join(dir, ".cursor-plugin", "plugin.json")) ?? {};
  const notConverted: string[] = [];
  const converted = { skills: 0, rules: 0, agents: 0, commands: 0, mcpServers: 0, variables: 0 };
  mkdirSync(join(target, ".claude-plugin"), { recursive: true });

  // skills: the same SKILL.md format, copied as is
  for (const skillsDir of list(manifest.skills ?? (existsSync(join(dir, "skills")) ? "./skills/" : undefined))) {
    const path = inside(dir, skillsDir);
    if (!path || !statSync(path).isDirectory()) continue;
    const roots = existsSync(join(path, "SKILL.md")) ? [path] : readdirSync(path).sort().map((name) => join(path, name));
    for (const skill of roots) {
      if (!noLinks(skill) || !statSync(skill).isDirectory() || !existsSync(join(skill, "SKILL.md"))) continue;
      const name = basename(skill);
      if (existsSync(join(target, "skills", name))) continue;
      cpSync(skill, join(target, "skills", name), { recursive: true, filter: noLinks });
      converted.skills += 1;
    }
  }

  // rules: each one becomes a skill holding the rule
  let scoped = 0;
  for (const file of filesOf(dir, list(manifest.rules ?? (existsSync(join(dir, "rules")) ? "./rules/" : undefined)), ".mdc")) {
    const skill = ruleToSkill(file, entry.name);
    if (!skill || existsSync(join(target, "skills", skill.name))) continue;
    mkdirSync(join(target, "skills", skill.name), { recursive: true });
    writeFileSync(join(target, "skills", skill.name, "SKILL.md"), skill.text);
    converted.rules += 1;
    if (skill.scoped) scoped += 1;
  }
  if (converted.rules) notConverted.push(scoped ? "rules_scope" : "rules_always");

  // agents and commands: markdown, Cursor-only front matter dropped
  const droppedAgentKeys = new Set<string>();
  for (const [kind, key] of [["agents", "agents"], ["commands", "commands"]] as const) {
    for (const file of filesOf(dir, list(manifest[key] ?? (existsSync(join(dir, kind)) ? `./${kind}/` : undefined)), ".md")) {
      mkdirSync(join(target, kind), { recursive: true });
      const { text, dropped } = kind === "agents" ? agentText(file) : { text: readFileSync(file, "utf8"), dropped: [] };
      for (const name of dropped) droppedAgentKeys.add(name);
      writeFileSync(join(target, kind, basename(file)), text);
      converted[kind] += 1;
    }
  }
  if (droppedAgentKeys.size) notConverted.push(`agent_settings:${[...droppedAgentKeys].sort().join(", ")}`);

  // MCP servers
  const servers = mcpServersOf(dir, manifest.mcpServers);
  const wanted = new Set<string>();
  const rooted: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(servers)) {
    rooted[name] = JSON.parse(JSON.stringify(server).replaceAll("${CURSOR_PLUGIN_ROOT}", "${CLAUDE_PLUGIN_ROOT}"));
    for (const variable of placeholders(server)) wanted.add(variable);
  }
  converted.mcpServers = Object.keys(rooted).length;
  if (converted.mcpServers) writeFileSync(join(target, ".mcp.json"), JSON.stringify({ mcpServers: rooted }, null, 2));
  if (wanted.size) notConverted.push(`mcp_values:${[...wanted].sort().join(", ")}`);

  // hooks and automations: Cursor's events have no Sagax equivalent
  if (manifest.hooks !== undefined || existsSync(join(dir, "hooks"))) notConverted.push("hooks");
  if (existsSync(join(dir, "automations"))) notConverted.push("automations");

  // plugin.json in the Claude Code format
  const userConfig = userConfigOf(manifest.variables);
  converted.variables = Object.keys(userConfig).length;
  const author = manifest.author && typeof manifest.author === "object" ? manifest.author : str(manifest.author, 120) ? { name: str(manifest.author, 120) } : undefined;
  writeFileSync(join(target, ".claude-plugin", "plugin.json"), JSON.stringify({
    name: entry.name,
    ...(str(manifest.description, 1000) ?? entry.description ? { description: str(manifest.description, 1000) ?? entry.description } : {}),
    ...(str(manifest.version, 40) ? { version: str(manifest.version, 40) } : {}),
    ...(author ? { author } : {}),
    ...(str(manifest.homepage, 500) ? { homepage: str(manifest.homepage, 500) } : {}),
    ...(str(manifest.repository, 500) ? { repository: str(manifest.repository, 500) } : {}),
    ...(str(manifest.license, 40) ? { license: str(manifest.license, 40) } : {}),
    ...(list(manifest.keywords).length ? { keywords: list(manifest.keywords).slice(0, 20) } : {}),
    ...(converted.variables ? { userConfig } : {}),
  }, null, 2));
  for (const extra of ["LICENSE", "README.md"]) {
    if (existsSync(join(dir, extra)) && noLinks(join(dir, extra))) cpSync(join(dir, extra), join(target, extra));
  }
  return { name: entry.name, converted, notConverted };
}

/** Write the marketplace of a Cursor plugin catalog into `root` (a fresh
 * clone), over any `.claude-plugin/marketplace.json` it already has. Returns
 * the count of plugins; 0 writes nothing. `rawBase`: the https address the
 * repository's files are served from, for the plugins' logos. */
export function synthesizeCursorCatalog(root: string, info: { name: string; description?: string; rawBase?: string }): number {
  const manifest = readJson(join(root, CURSOR_MANIFEST));
  if (!manifest) return 0;
  const plugins: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(manifest.plugins) ? manifest.plugins.slice(0, MAX_PLUGINS) : []) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const name = str(entry.name, 64)?.toLowerCase();
    if (!name || !/^[a-z0-9][a-z0-9._-]*$/.test(name) || seen.has(name) || typeof entry.source !== "string") continue;
    const dir = inside(root, entry.source);
    if (!dir || !statSync(dir).isDirectory()) continue;
    seen.add(name);
    const target = join(root, CURSOR_SYNTH_ROOT, name);
    const result = convertCursorPlugin(dir, target, { name, ...(str(entry.description, 300) ? { description: str(entry.description, 300) } : {}) });
    const pluginJson = readJson(join(dir, ".cursor-plugin", "plugin.json")) ?? {};
    const logo = str(pluginJson.logo, 200);
    const sourcePath = relative(root, dir).split(sep).join("/");
    const icon = logo && info.rawBase && !logo.includes("..") && !/^[a-z]+:/i.test(logo) ? `${info.rawBase.replace(/\/+$/, "")}/${sourcePath}/${logo.replace(/^\.\//, "")}` : str(pluginJson.logo, 500)?.startsWith("https://") ? str(pluginJson.logo, 500) : undefined;
    plugins.push({
      name,
      ...(str(pluginJson.displayName, 80) ? { displayName: str(pluginJson.displayName, 80) } : {}),
      ...(str(entry.description, 300) ?? str(pluginJson.description, 300) ? { description: str(entry.description, 300) ?? str(pluginJson.description, 300) } : {}),
      ...(str(pluginJson.version, 40) ? { version: str(pluginJson.version, 40) } : {}),
      ...(str(pluginJson.category, 40) ? { category: str(pluginJson.category, 40) } : {}),
      ...(str(pluginJson.homepage, 500) ? { homepage: str(pluginJson.homepage, 500) } : {}),
      ...(icon ? { icon } : {}),
      source: `./${CURSOR_SYNTH_ROOT}/${name}`,
      sagaxConvertedFrom: "cursor",
      ...(result.notConverted.length ? { sagaxNotConverted: result.notConverted } : {}),
    });
  }
  if (!plugins.length) return 0;
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin", "marketplace.json"), JSON.stringify({
    name: info.name,
    ...(info.description ? { metadata: { description: info.description } } : {}),
    plugins,
  }, null, 2));
  return plugins.length;
}
