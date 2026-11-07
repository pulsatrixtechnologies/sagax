// Bringing a Claude Code project's agent setup into Sagax (docs/import-agent.md).
//
// The person picks a project folder (or their ~/.claude folder). The renderer
// reads only the files this module names (claudeCodeWantedPath), never a file
// that looks like a secret (claudeCodeSecretPath: those are listed by name
// under Left out and never opened), and hands their text here. The result is
// an ordinary openmaus.package v2, so the same import rules hold as for any
// file (server/packages/package-import.ts): every bot is new, skills land switched
// off, nothing is scheduled, connections are slots whose values the person
// fills in, and no key, token or sign-in comes over.
//
// What maps, from the public Claude Code layout (code.claude.com/docs):
//   CLAUDE.md, .claude/CLAUDE.md (or AGENTS.md)  the bot's standing instructions;
//                                               whole-line @path imports of a
//                                               file read here are inlined
//   CLAUDE.local.md                             appended, under its own heading
//   .claude/skills/<name>/SKILL.md              skills (off)
//   .claude/commands/<name>.md                  skills (off): commands are skills now
//   .claude/agents/<name>.md                    one more bot each: frontmatter name and
//                                               description, the body as its instructions
//   .mcp.json                                   http/sse servers as connection slots
//                                               (address and header names only); a server
//                                               that runs a command is listed, not imported
//
// A Hermes Agent home (~/.hermes, or one of its profiles; hermes-agent docs,
// MIT) is read by the same picker and becomes the same kind of package
// (hermesToPackage, chosen when the folder looks like one):
//   SOUL.md (+ HERMES.md, .hermes.md, AGENTS.md)  the bot's standing instructions
//   memories/MEMORY.md, memories/USER.md        the bot's starter memory (MEMORY.md),
//                                               one bullet per §-separated entry
//   skills/<category>/<name>/SKILL.md           skills (off)
//   cron/jobs.json                              routines (paused): cron as is, a fixed
//                                               interval as cron; a one-time job is listed
//   config.yaml mcp_servers                     http servers as connection slots, as above
//   profiles/<name>/                            one more bot each, from the same files
//   .env, auth.json, sessions/, state.db         never opened
// Pure text: the renderer and the server both read it.
import { grokExportToPackage, GrokImportError, GROK_EXPORT_FORMAT, nearestBotColor, type GrokExport, type GrokLeftOut } from "./grok-import.ts";
import { BOT_PROFILE_LIMITS } from "./bot-profile.ts";
import {
  AGENT_MAX_SKILLS, PACKAGE_MAX_CONNECTIONS, PACKAGE_MAX_SKILLS, parsePackageDocument, redactPackageSecrets, SEED_FILE_MAX_BYTES, utf8Bytes,
  type PackageAgent, type PackageConnection, type PackageDocument, type PackageRoutine, type PackageSkill,
} from "./package-format.ts";
import { holdsCredential } from "./redact.ts";
import { parse as parseYaml } from "yaml";
import { SKILL_FILE_MAX_BYTES } from "./skill-md.ts";

/** One file of the chosen folder, by its path inside that folder ("/"-separated). */
export interface ClaudeCodeFile {
  path: string;
  text: string;
}

export const CLAUDE_CODE_SOURCE = "Claude Code";
export const HERMES_SOURCE = "Hermes";
/** Files larger than this are not read (a SKILL.md is at most 256 KB). */
export const CLAUDE_CODE_FILE_MAX_BYTES = SKILL_FILE_MAX_BYTES;
const MAX_SUBAGENTS = 30;

const INSTRUCTION_FILES = ["CLAUDE.md", ".claude/CLAUDE.md", "AGENTS.md", "CLAUDE.local.md"];
/** Hermes project context files, read beside CLAUDE.md as well. */
const HERMES_CONTEXT_FILES = ["HERMES.md", ".hermes.md"];
/** The files of a Hermes home (or of one of its profiles). */
const HERMES_FILE = /^(?:profiles\/[^/]+\/)?(?:SOUL\.md|HERMES\.md|\.hermes\.md|config\.yaml|memories\/(?:MEMORY|USER)\.md|cron\/jobs\.json)$/;
/** skills/<category>/<name>/SKILL.md (or skills/<name>/SKILL.md); never the hub's .hub/ cache. */
const HERMES_SKILL = /^(?:profiles\/[^/]+\/)?skills\/(?:[^/.][^/]*\/){1,3}SKILL\.md$/i;
/** Files only a Hermes home has. */
const HERMES_MARKER = /^(?:profiles\/[^/]+\/)?(?:SOUL\.md|memories\/(?:MEMORY|USER)\.md|cron\/jobs\.json)$/;

/** A path inside the folder, normalised: "/" separators, no leading "./". A
 * folder picked at ~/.claude itself reads as if it were the project's .claude. */
export function claudeCodeRelativePath(path: string, pickedFolderName = ""): string {
  const clean = path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
  if (pickedFolderName === ".claude" && /^(?:skills|agents|commands)\//.test(clean)) return `.claude/${clean}`;
  // A folder that holds the Hermes home (the person's own home folder): read it as the home.
  if (clean.startsWith(".hermes/")) return clean.slice(".hermes/".length);
  return clean;
}

/** Key stores and env files by extension or well-known name (port of upstream d2caaef1a). */
const KEY_STORES = /(?:^|\/)(?:\.env(?:\..*)?|\.envrc|\.netrc|\.npmrc|\.pypirc|settings\.local\.json|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|[^/]*\.(?:pem|key|p8|p12|pfx|keystore|jks))$/i;
/** Data files named after a token, session, cookie, password, secret, credential, key, bearer, storage state or service account. */
const SECRET_DATA = /(?:^|\/)[^/]*(?:o?auth|tokens?|sessions?|cookies?|passw\w*|secrets?|credentials?|api[-_]?keys?|keys?|bearer|storage[-_]?state|service[-_]?accounts?|private[-_]?keys?)[^/]*\.(?:json|jsonc|jsonl|yaml|yml|toml|ini|cfg|conf|txt|text|csv|tsv|xml)$/i;
const SECRET_FOLDERS = /(?:^|\/)(?:secrets?|credentials?|sessions?|cookies?|tokens?|keys?|private[-_]?keys?|service[-_]?accounts?)(?:\/|$)/i;
/** Exact credential filenames (not instructions like credentials.md). */
const LEGACY_SECRET_NAME = /(?:^|\/)(?:\.credentials\.json|credentials(?:\.(?:json|jsonc|yml|yaml|toml|txt))?|auth\.json|secrets?(?:\.(?:json|jsonc|yml|yaml|toml|txt))?)$/i;

/** A file this import never opens: it may hold a key, a token or a password. */
export function claudeCodeSecretPath(path: string): boolean {
  return KEY_STORES.test(path) || SECRET_DATA.test(path) || SECRET_FOLDERS.test(path) || LEGACY_SECRET_NAME.test(path);
}

/** The files the import reads; everything else in the folder is ignored. */
export function claudeCodeWantedPath(path: string): boolean {
  if (claudeCodeSecretPath(path)) return false;
  if (INSTRUCTION_FILES.includes(path) || path === ".mcp.json") return true;
  if (HERMES_FILE.test(path) || HERMES_SKILL.test(path)) return true;
  return /^\.claude\/skills\/[^/]+\/SKILL\.md$/i.test(path)
    || /^\.claude\/commands\/(?:[^/]+\/)*[^/]+\.md$/i.test(path)
    || /^\.claude\/agents\/(?:[^/]+\/)*[^/]+\.md$/i.test(path);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
/** One line of plain text: control and separator characters become spaces. */
function oneLine(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim();
}
const clip = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`);
const slug = (value: string, max: number) =>
  value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
function uniqueSlug(value: string, fallback: string, taken: Set<string>, max = 64): string {
  const base = slug(value, max - 3) || fallback;
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}-${n}`;
  taken.add(candidate);
  return candidate;
}
function fitBytes(text: string, max: number): string {
  if (utf8Bytes(text) <= max) return text;
  let end = Math.min(text.length, max);
  while (end > 0 && utf8Bytes(text.slice(0, end)) > max) end = Math.floor(end * 0.95);
  return text.slice(0, end);
}

/** The simple `key: value` lines of a Markdown file's YAML frontmatter, and its body. */
export function frontmatter(raw: string): { fields: Record<string, string>; body: string } {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  const lines = match[1]!.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const kv = lines[index]!.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2]!.trim();
    // A folded or literal block (description: > or |): the indented lines after it.
    if (/^[>|][+-]?$/.test(value)) {
      const block: string[] = [];
      while (index + 1 < lines.length && /^\s+\S|^\s*$/.test(lines[index + 1]!)) block.push(lines[++index]!.trim());
      value = block.join(" ").trim();
    }
    fields[kv[1]!] = value.replace(/^["']|["']$/g, "").trim();
  }
  return { fields, body: match[2] ?? "" };
}

/** CLAUDE.md with each whole-line `@path` import of a file we read inlined once. */
function inlineImports(text: string, files: Map<string, string>, leftOut: GrokLeftOut[], seen = new Set<string>()): string {
  return text.split(/\r?\n/).map((line) => {
    const ref = line.trim().match(/^@(\S+)$/)?.[1];
    if (!ref) return line;
    const path = claudeCodeRelativePath(ref);
    const imported = files.get(path);
    if (imported === undefined || seen.has(path)) {
      if (imported === undefined) leftOut.push({ kind: "instructions", name: `@${ref}`, reason: "CLAUDE.md imports this file, but it is not one the import reads; add what it says by hand if the bot needs it", reasonKey: "leftOut.reason.importNotRead" });
      return line;
    }
    seen.add(path);
    return inlineImports(imported, files, leftOut, seen);
  }).join("\n");
}

function instructionsFrom(files: Map<string, string>, leftOut: GrokLeftOut[]): string {
  const main = files.get("CLAUDE.md") ?? files.get(".claude/CLAUDE.md") ?? files.get("AGENTS.md");
  const parts: string[] = [];
  if (main !== undefined) {
    const seen = new Set<string>();
    parts.push(inlineImports(main, files, leftOut, seen).trim());
    // AGENTS.md beside a CLAUDE.md that does not import it: both are the project's instructions.
    const agents = files.get("AGENTS.md");
    if (agents !== undefined && main !== agents && !seen.has("AGENTS.md") && agents.trim() !== main.trim()) parts.push(`## AGENTS.md\n\n${agents.trim()}`);
  }
  const local = files.get("CLAUDE.local.md");
  if (local?.trim()) parts.push(`## Personal notes (CLAUDE.local.md)\n\n${local.trim()}`);
  for (const name of HERMES_CONTEXT_FILES) {
    const context = files.get(name);
    if (context?.trim()) parts.push(`## ${name}\n\n${context.trim()}`);
  }
  return parts.filter(Boolean).join("\n\n");
}

function skillsFrom(files: ClaudeCodeFile[], hermesPrefix?: string): GrokExport["skills"] {
  const skills: GrokExport["skills"] = [];
  for (const file of files) {
    // A Hermes home: skills/<category>/<name>/SKILL.md of that home or profile only.
    const skill = hermesPrefix === undefined
      ? file.path.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/i)
      : file.path.startsWith(hermesPrefix) && HERMES_SKILL.test(file.path) && !file.path.slice(hermesPrefix.length).startsWith("profiles/")
        ? file.path.match(/([^/]+)\/SKILL\.md$/i)
        : null;
    const command = hermesPrefix === undefined ? file.path.match(/^\.claude\/commands\/((?:[^/]+\/)*[^/]+)\.md$/i) : null;
    if (!skill && !command) continue;
    const { fields, body } = frontmatter(file.text);
    const name = fields.name || (skill ? skill[1]! : command![1]!.replace(/\//g, "-"));
    const description = fields.description || body.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "").trim() || name;
    skills.push({ name, description: oneLine(description), body: body.trim() });
  }
  return skills;
}

const COLORS = ["#3b82f6", "#22c55e", "#a855f7", "#f97316", "#ec4899", "#14b8a6", "#eab308", "#ef4444"];

function subagentsFrom(files: ClaudeCodeFile[], skillNames: Map<string, string>, mainKey: string, leftOut: GrokLeftOut[]): PackageAgent[] {
  const taken = new Set([mainKey]);
  const agents: PackageAgent[] = [];
  for (const file of files) {
    const match = file.path.match(/^\.claude\/agents\/((?:[^/]+\/)*([^/]+))\.md$/i);
    if (!match) continue;
    const { fields, body } = frontmatter(file.text);
    const name = clip(oneLine(fields.name || match[2]!), 100);
    const label = `Subagent “${name}”`;
    const named = { nameKey: "leftOut.name.subagent", params: { name, max: MAX_SUBAGENTS, bytes: BOT_PROFILE_LIMITS.soul } };
    if (agents.length >= MAX_SUBAGENTS) {
      leftOut.push({ kind: "instructions", name: label, reason: `an import brings at most ${MAX_SUBAGENTS} subagents`, original: file.text.slice(0, 4_000), ...named, reasonKey: "leftOut.reason.maxSubagents" });
      continue;
    }
    let soul = body.trim();
    if (!soul) {
      leftOut.push({ kind: "instructions", name: label, reason: "it has no instructions", ...named, reasonKey: "leftOut.reason.noInstructions" });
      continue;
    }
    if (utf8Bytes(soul) > BOT_PROFILE_LIMITS.soul) {
      soul = fitBytes(soul, BOT_PROFILE_LIMITS.soul);
      leftOut.push({ kind: "instructions", name: label, reason: `its instructions were longer than ${BOT_PROFILE_LIMITS.soul.toLocaleString("en-US")} bytes, so the end was cut`, ...named, reasonKey: "leftOut.reason.subagentCut" });
    }
    // Skills the subagent names (frontmatter `skills: a, b` or `[a, b]`) that came over.
    const wanted = (fields.skills ?? "").replace(/^\[|\]$/g, "").split(",").map((value) => value.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    const skills = [...new Set(wanted.map((value) => skillNames.get(value)).filter((value): value is string => Boolean(value)))].slice(0, AGENT_MAX_SKILLS);
    const description = oneLine(fields.description ?? "");
    agents.push({
      key: uniqueSlug(name, `subagent-${agents.length + 1}`, taken),
      name,
      title: "Claude Code subagent",
      ...(description ? { description: clip(description, 4_000) } : {}),
      soul,
      appearance: { color: nearestBotColor(COLORS[(agents.length + 1) % COLORS.length]) },
      ...(skills.length ? { skills } : {}),
    } as PackageAgent);
  }
  return agents;
}

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/;

function connectionsFrom(raw: string | undefined, leftOut: GrokLeftOut[]): PackageConnection[] {
  if (raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    leftOut.push({ kind: "app", name: ".mcp.json", reason: "it is not valid JSON", reasonKey: "leftOut.reason.invalidJson" });
    return [];
  }
  const servers = isRecord(parsed) && isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
  const connections: PackageConnection[] = [];
  connectionsFromServers(servers, "The Claude Code project", connections, new Set(), leftOut);
  return connections;
}

/** MCP servers (Claude's mcpServers, Hermes' mcp_servers) as connection slots,
 * added to `connections` (shared by every bot of the package: the same server
 * twice is one slot). Returns the keys this bot uses. */
function connectionsFromServers(
  servers: Record<string, unknown>, owner: string, connections: PackageConnection[], taken: Set<string>, leftOut: GrokLeftOut[],
): string[] {
  const keys: string[] = [];
  for (const [name, entry] of Object.entries(servers)) {
    if (!isRecord(entry)) continue;
    // Hermes catalog entries keep the address or program under `transport`.
    const value: Record<string, unknown> = isRecord(entry.transport) ? { ...entry, ...entry.transport } : entry;
    const label = `App “${clip(oneLine(name), 80)}”`;
    const named = { nameKey: "leftOut.name.app", params: { name: clip(oneLine(name), 80), max: PACKAGE_MAX_CONNECTIONS } };
    if (typeof value.command === "string") {
      // A command is never carried by a package: it would run on the person's computer.
      const envNames = isRecord(value.env) ? Object.keys(value.env).filter((key) => HEADER_NAME.test(key)) : [];
      leftOut.push({
        kind: "app", name: label,
        reason: "it runs a program on your computer; add it yourself in Plugins",
        ...named, reasonKey: "leftOut.reason.runsProgram",
        original: [`Program: ${oneLine(value.command).split(" ")[0]}`, envNames.length ? `Values it needs: ${envNames.join(", ")}` : ""].filter(Boolean).join("\n"),
      });
      continue;
    }
    const url = typeof value.url === "string" ? value.url.trim() : "";
    const type = value.type === "sse" || value.transport === "sse" ? "sse" : "http";
    let usable = false;
    try {
      const parsedUrl = new URL(url);
      usable = !/\$\{/.test(url) && !parsedUrl.username && !parsedUrl.password
        && (parsedUrl.protocol === "https:" || (parsedUrl.protocol === "http:" && /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/.test(parsedUrl.hostname)));
    } catch {
      usable = false;
    }
    if (!usable) {
      leftOut.push({ kind: "app", name: label, reason: "its address is not a plain https:// address; add it yourself in Plugins", ...named, reasonKey: "leftOut.reason.notHttps" });
      continue;
    }
    const label100 = clip(oneLine(name), 100);
    const same = connections.find((connection) => connection.label === label100 && connection.mcp?.url === url);
    if (same) {
      if (!keys.includes(same.key)) keys.push(same.key);
      continue;
    }
    if (connections.length >= PACKAGE_MAX_CONNECTIONS) {
      leftOut.push({ kind: "app", name: label, reason: `an import brings at most ${PACKAGE_MAX_CONNECTIONS} apps`, ...named, reasonKey: "leftOut.reason.maxConnections" });
      continue;
    }
    // Header names only: their values (tokens, keys) never come over.
    const valueNames = [...new Set((isRecord(value.headers) ? Object.keys(value.headers) : []).filter((key) => HEADER_NAME.test(key)))].slice(0, 32);
    const connection = {
      key: uniqueSlug(/^[a-z]/i.test(slug(name, 28)) ? name : `app ${name}`, `app-${connections.length + 1}`, taken, 28),
      label: label100,
      reason: clip(`${owner} used ${oneLine(name)}.`, 240),
      mcp: { transport: type, url, valueNames },
    } as PackageConnection;
    connections.push(connection);
    keys.push(connection.key);
  }
  return keys;
}

/** A Claude Code folder as an openmaus.package v2, plus what could not come over. */
export function claudeCodeToPackage(
  input: ClaudeCodeFile[],
  options: { folderName?: string; skippedSecrets?: string[]; timeZone?: string } = {},
): { document: PackageDocument; leftOut: GrokLeftOut[] } {
  const leftOut: GrokLeftOut[] = [];
  const files = input
    .map((file) => ({ path: claudeCodeRelativePath(file.path, options.folderName), text: file.text }))
    .filter((file) => claudeCodeWantedPath(file.path))
    .filter((file) => {
      // Skills, commands and subagents only: .mcp.json may name header values that
      // redactPackageSecrets strips, and CLAUDE.md is instructions the person wrote.
      const skillLike = /^\.claude\/(?:skills|commands|agents)\//i.test(file.path) || HERMES_SKILL.test(file.path);
      if (!skillLike || !holdsCredential(file.text)) return true;
      leftOut.push({
        kind: "skill",
        name: file.path,
        reason: "it may hold a key or a password, so it was not opened. Add what the bot needs in Plugins or the vault",
        reasonKey: "leftOut.reason.secretFile",
      });
      return false;
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  const byPath = new Map(files.map((file) => [file.path, file.text]));
  for (const secret of options.skippedSecrets ?? []) {
    leftOut.push({ kind: "secrets", name: secret, reason: "it may hold a key or a password, so it was not opened. Add what the bot needs in Plugins or the vault", reasonKey: "leftOut.reason.secretFile" });
  }
  if (isHermesHome(files.map((file) => file.path), options.folderName)) return hermesToPackage(files, byPath, options, leftOut);
  const instructions = instructionsFrom(byPath, leftOut);
  const skills = skillsFrom(files);
  const hasAgents = files.some((file) => file.path.startsWith(".claude/agents/"));
  if (!instructions && !skills.length && !hasAgents) {
    throw new GrokImportError("No CLAUDE.md, AGENTS.md, .claude/skills, .claude/commands or .claude/agents was found in this folder. Choose the project's own folder (or your .claude folder).");
  }
  const folder = oneLine(options.folderName ?? "").replace(/^\.claude$/, "") || "Claude Code";
  const exported: GrokExport = {
    format: GROK_EXPORT_FORMAT,
    name: folder,
    description: `The agent setup of the Claude Code project “${folder}”.`,
    instructions,
    skills,
    routines: [],
    plugins: [],
    memories: [],
  };
  const base = grokExportToPackage(exported, { timeZone: options.timeZone, sourceName: CLAUDE_CODE_SOURCE });
  leftOut.push(...base.leftOut);
  const main = base.document.package.agents[0]!;
  // The skill names the package kept, by the names a subagent may use for them.
  const skillNames = new Map<string, string>();
  for (const entry of base.document.package.skills?.entries ?? []) skillNames.set(entry.name, entry.name);
  for (const skill of skills) {
    const kept = base.document.package.skills?.entries.find((entry) => entry.name === slug(skill.name, 61));
    if (kept) skillNames.set(skill.name, kept.name);
  }
  const subagents = subagentsFrom(files, skillNames, main.key, leftOut);
  const connections = connectionsFrom(byPath.get(".mcp.json"), leftOut);
  const draft: PackageDocument = {
    ...base.document,
    package: {
      ...base.document.package,
      tagline: clip(`The Claude Code project “${folder}”, brought into Sagax.`, 160),
      agents: [
        { ...main, ...(connections.length ? { connections: connections.map((connection) => connection.key) } : {}) },
        ...subagents,
      ],
      ...(connections.length ? { connections } : {}),
    },
  };
  const { document, redacted } = redactPackageSecrets(draft);
  if (redacted.length) leftOut.push({ kind: "secrets", name: "Keys and passwords", reason: `text that looked like a key or password was replaced in ${redacted.join(", ")}`, nameKey: "leftOut.name.secrets", reasonKey: "leftOut.reason.secretsReplaced", params: { parts: redacted.join(", ") } });
  try {
    return { document: parsePackageDocument(document, { trust: "file" }), leftOut };
  } catch (error) {
    throw new GrokImportError(`This Claude Code folder could not be turned into a bot: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ── Hermes Agent ───────────────────────────────────────────────────────────

const MAX_HERMES_ROUTINES = 50;

/** True when the picked folder is a Hermes home (or one of its profiles), not a Claude Code project. */
export function isHermesHome(paths: string[], folderName = ""): boolean {
  if (paths.some((path) => path === "CLAUDE.md" || path === "CLAUDE.local.md" || path.startsWith(".claude/"))) return false;
  if (folderName === ".hermes") return true;
  if (paths.some((path) => HERMES_MARKER.test(path))) return true;
  return paths.some((path) => /^(?:profiles\/[^/]+\/)?config\.yaml$/.test(path)) && paths.some((path) => HERMES_SKILL.test(path));
}

/** The §-separated entries of a Hermes memory file (an entry may span lines). */
function hermesEntries(text: string | undefined): string[] {
  if (!text) return [];
  return text.split("§").map((entry) => entry.trim()).filter(Boolean);
}

function hermesNotes(memory: string[], user: string[]): string {
  const bullets = (entries: string[]) => entries.map((entry) => `- ${entry.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join("\n  ")}`).join("\n");
  const parts = [`# Notes from ${HERMES_SOURCE}`];
  if (memory.length) parts.push(`## What the agent noted (MEMORY.md)\n\n${bullets(memory)}`);
  if (user.length) parts.push(`## About you (USER.md)\n\n${bullets(user)}`);
  return `${parts.join("\n\n")}\n`;
}

/** A fixed interval as cron, when it divides the hour or the day evenly. */
function intervalCron(minutes: number): string | null {
  if (!Number.isInteger(minutes) || minutes <= 0) return null;
  if (minutes < 60) return 60 % minutes === 0 ? `*/${minutes} * * * *` : null;
  if (minutes % 60 !== 0) return null;
  const hours = minutes / 60;
  if (hours === 1) return "0 * * * *";
  if (hours < 24) return 24 % hours === 0 ? `0 */${hours} * * *` : null;
  return hours === 24 ? "0 0 * * *" : null;
}

/** cron/jobs.json as routines (Hermes' own scheduler format). */
function hermesRoutines(raw: string | undefined, path: string, leftOut: GrokLeftOut[]): GrokExport["routines"] {
  if (raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    leftOut.push({ kind: "routine", name: path, reason: "it is not valid JSON", reasonKey: "leftOut.reason.invalidJson" });
    return [];
  }
  const jobs = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.jobs) ? parsed.jobs : [];
  const routines: GrokExport["routines"] = [];
  for (const [index, job] of jobs.entries()) {
    if (!isRecord(job)) continue;
    const label = clip(oneLine(String(job.name ?? job.id ?? "")) || `Routine ${index + 1}`, 80);
    const named = { name: `Routine “${label}”`, nameKey: "leftOut.name.routine", params: { name: label, max: MAX_HERMES_ROUTINES } };
    const skills = [
      ...(Array.isArray(job.skills) ? job.skills : []),
      ...(typeof job.skill === "string" ? [job.skill] : []),
    ].filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
    const text = typeof job.prompt === "string" ? job.prompt.trim() : "";
    const prompt = skills.length ? `Use the skill${skills.length > 1 ? "s" : ""} ${[...new Set(skills)].join(", ")}.${text ? `\n\n${text}` : ""}` : text;
    const schedule = job.schedule;
    const display = typeof job.schedule_display === "string" ? job.schedule_display
      : isRecord(schedule) && typeof schedule.display === "string" ? schedule.display : "";
    const original = [display && `When: ${display}`, prompt].filter(Boolean).join("\n");
    if (typeof schedule === "string") {
      routines.push({ name: label, schedule, cron: "", timeZone: "", prompt });
      continue;
    }
    if (!isRecord(schedule)) {
      routines.push({ name: label, schedule: display, cron: "", timeZone: "", prompt });
      continue;
    }
    if (schedule.kind === "cron" && typeof schedule.expr === "string") {
      routines.push({ name: label, schedule: display, cron: schedule.expr.trim(), timeZone: "", prompt });
    } else if (schedule.kind === "interval") {
      const cron = intervalCron(Number(schedule.minutes));
      if (cron) routines.push({ name: label, schedule: display, cron, timeZone: "", prompt });
      else leftOut.push({ kind: "routine", ...named, reason: "it repeats on an interval that does not fit a clock schedule; add it again with a time of day", reasonKey: "leftOut.reason.intervalRoutine", ...(original ? { original } : {}) });
    } else if (schedule.kind === "once") {
      leftOut.push({ kind: "routine", ...named, reason: "it runs only once, so it was not scheduled; run it by hand if it is still needed", reasonKey: "leftOut.reason.onceRoutine", ...(original ? { original } : {}) });
    } else {
      routines.push({ name: label, schedule: display, cron: "", timeZone: "", prompt });
    }
  }
  return routines;
}

/** config.yaml `mcp_servers`, or nothing. */
function hermesServers(raw: string | undefined, path: string, leftOut: GrokLeftOut[]): Record<string, unknown> {
  if (raw === undefined) return {};
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    leftOut.push({ kind: "app", name: path, reason: "it is not valid YAML", reasonKey: "leftOut.reason.invalidYaml" });
    return {};
  }
  return isRecord(parsed) && isRecord(parsed.mcp_servers) ? parsed.mcp_servers : {};
}

function hermesInstructions(prefix: string, files: Map<string, string>): string {
  const soul = (files.get(`${prefix}SOUL.md`) ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
  const parts = soul ? [soul] : [];
  for (const name of [...HERMES_CONTEXT_FILES, ...(prefix ? [] : ["AGENTS.md"])]) {
    const context = files.get(`${prefix}${name}`)?.trim();
    if (context) parts.push(`## ${name}\n\n${context}`);
  }
  return parts.join("\n\n");
}

/** A Hermes home: the home (or picked profile) as the main bot, each profiles/<name>/ as one more. */
function hermesToPackage(
  files: ClaudeCodeFile[],
  byPath: Map<string, string>,
  options: { folderName?: string; timeZone?: string },
  leftOut: GrokLeftOut[],
): { document: PackageDocument; leftOut: GrokLeftOut[] } {
  const folder = oneLine(options.folderName ?? "");
  const profiles = [...new Set(files.map((file) => file.path.match(/^profiles\/([^/]+)\//)?.[1]).filter((name): name is string => Boolean(name)))];
  const parts = [
    { prefix: "", name: !folder || folder === ".hermes" ? HERMES_SOURCE : folder },
    ...profiles.map((name) => ({ prefix: `profiles/${name}/`, name })),
  ];

  const agents: PackageAgent[] = [];
  const agentKeys = new Set<string>();
  const skills: PackageSkill[] = [];
  const skillNames = new Set<string>();
  const routines: PackageRoutine[] = [];
  const routineKeys = new Set<string>();
  const connections: PackageConnection[] = [];
  const connectionKeys = new Set<string>();
  let base: PackageDocument | undefined;

  for (const part of parts) {
    const instructions = hermesInstructions(part.prefix, byPath);
    const partSkills = skillsFrom(files, part.prefix);
    const memory = hermesEntries(byPath.get(`${part.prefix}memories/MEMORY.md`));
    const user = hermesEntries(byPath.get(`${part.prefix}memories/USER.md`));
    const partRoutines = hermesRoutines(byPath.get(`${part.prefix}cron/jobs.json`), `${part.prefix}cron/jobs.json`, leftOut);
    const servers = hermesServers(byPath.get(`${part.prefix}config.yaml`), `${part.prefix}config.yaml`, leftOut);
    if (!instructions && !partSkills.length && !memory.length && !user.length && !partRoutines.length && !Object.keys(servers).length) continue;
    const main = !base;
    if (!main && agents.length > MAX_SUBAGENTS) {
      leftOut.push({ kind: "instructions", name: `Profile “${part.name}”`, reason: `an import brings at most ${MAX_SUBAGENTS} profiles`, nameKey: "leftOut.name.profile", params: { name: part.name, max: MAX_SUBAGENTS }, reasonKey: "leftOut.reason.maxProfiles" });
      continue;
    }
    const built = grokExportToPackage({
      format: GROK_EXPORT_FORMAT,
      name: part.name,
      title: main ? "Hermes agent" : "Hermes profile",
      description: main ? `The ${HERMES_SOURCE} agent, brought into Sagax.` : `The ${HERMES_SOURCE} profile “${part.name}”.`,
      instructions,
      color: COLORS[agents.length % COLORS.length],
      skills: partSkills,
      routines: partRoutines,
      plugins: [],
      memories: [],
    }, { timeZone: options.timeZone, sourceName: HERMES_SOURCE });
    leftOut.push(...built.leftOut);
    base ??= built.document;
    const source = built.document.package.agents[0]!;
    const key = uniqueSlug(source.key, `profile-${agents.length + 1}`, agentKeys, 60);

    // Skills: one shared library; the same skill in two profiles is one entry, a clash is renamed.
    const renamed = new Map<string, string>();
    for (const entry of built.document.package.skills?.entries ?? []) {
      const same = skills.find((kept) => kept.name === entry.name);
      if (same?.instructions === entry.instructions) {
        renamed.set(entry.name, entry.name);
        continue;
      }
      if (skills.length >= PACKAGE_MAX_SKILLS) {
        leftOut.push({ kind: "skill", name: `Skill “${entry.name}”`, reason: `a package holds at most ${PACKAGE_MAX_SKILLS} skills`, original: entry.instructions, nameKey: "leftOut.name.skill", params: { name: entry.name, max: PACKAGE_MAX_SKILLS }, reasonKey: "leftOut.reason.maxPackageSkills" });
        continue;
      }
      const name = same ? uniqueSlug(entry.name, `skill-${skills.length + 1}`, skillNames, 64) : entry.name;
      skillNames.add(name);
      skills.push(same ? { ...entry, name, instructions: entry.instructions.replace(/^---\nname: .*$/m, `---\nname: ${name}`) } : entry);
      renamed.set(entry.name, name);
    }
    const agentSkills = (source.skills ?? []).map((name) => renamed.get(name)).filter((name): name is string => Boolean(name));

    for (const routine of built.document.package.routines ?? []) {
      if (routines.length >= MAX_HERMES_ROUTINES) {
        leftOut.push({ kind: "routine", name: `Routine “${routine.name}”`, reason: `a package holds at most ${MAX_HERMES_ROUTINES} routines`, original: routine.prompt, nameKey: "leftOut.name.routine", params: { name: routine.name, max: MAX_HERMES_ROUTINES }, reasonKey: "leftOut.reason.maxRoutines" });
        continue;
      }
      routines.push({ ...routine, key: uniqueSlug(routine.key, `routine-${routines.length + 1}`, routineKeys), agent: key });
    }

    const connectionsUsed = connectionsFromServers(servers, `The ${HERMES_SOURCE} agent “${part.name}”`, connections, connectionKeys, leftOut);
    let seed: PackageAgent["seed"];
    if (memory.length || user.length) {
      const notes = hermesNotes(memory, user);
      if (utf8Bytes(notes) <= SEED_FILE_MAX_BYTES) seed = { memory: { "MEMORY.md": notes } };
      else leftOut.push({ kind: "memories", name: "Memories", reason: "they were larger than 256 KB", nameKey: "leftOut.name.memories", reasonKey: "leftOut.reason.memoriesTooLarge" });
    }
    const { skills: _dropped, seed: _none, ...rest } = source;
    agents.push({
      ...rest,
      key,
      ...(agentSkills.length ? { skills: agentSkills } : {}),
      ...(connectionsUsed.length ? { connections: connectionsUsed } : {}),
      ...(seed ? { seed } : {}),
    } as PackageAgent);
  }

  if (!base || !agents.length) {
    throw new GrokImportError("No SOUL.md, memories, skills, cron jobs or MCP servers were found in this folder. Choose your .hermes folder (or one of its profiles).");
  }
  const { routines: _routines, skills: _skills, connections: _connections, ...packageRest } = base.package;
  const name = agents[0]!.name;
  const draft: PackageDocument = {
    ...base,
    package: {
      ...packageRest,
      tagline: clip(`The ${HERMES_SOURCE} agent “${name}”, brought into Sagax.`, 160),
      agents,
      ...(routines.length ? { routines } : {}),
      ...(skills.length ? { skills: { version: 1 as const, entries: skills } } : {}),
      ...(connections.length ? { connections } : {}),
    },
  };
  const { document, redacted } = redactPackageSecrets(draft);
  if (redacted.length) leftOut.push({ kind: "secrets", name: "Keys and passwords", reason: `text that looked like a key or password was replaced in ${redacted.join(", ")}`, nameKey: "leftOut.name.secrets", reasonKey: "leftOut.reason.secretsReplaced", params: { parts: redacted.join(", ") } });
  try {
    return { document: parsePackageDocument(document, { trust: "file" }), leftOut };
  } catch (error) {
    throw new GrokImportError(`This Hermes folder could not be turned into a bot: ${error instanceof Error ? error.message : String(error)}`);
  }
}
