// Bringing a Claude Code project's agent setup into Sagax (docs/import-agent.md).
//
// The person picks a project folder (or their ~/.claude folder). The renderer
// reads only the files this module names (claudeCodeWantedPath), never a file
// that looks like a secret (claudeCodeSecretPath: those are listed by name
// under Left out and never opened), and hands their text here. The result is
// an ordinary openmaus.package v2, so the same import rules hold as for any
// file (server/package-import.ts): every bot is new, skills land switched
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
// Pure text: the renderer and the server both read it.
import { grokExportToPackage, GrokImportError, GROK_EXPORT_FORMAT, nearestBotColor, type GrokExport, type GrokLeftOut } from "./grok-import.ts";
import { BOT_PROFILE_LIMITS } from "./bot-profile.ts";
import {
  AGENT_MAX_SKILLS, PACKAGE_MAX_CONNECTIONS, parsePackageDocument, redactPackageSecrets, utf8Bytes,
  type PackageAgent, type PackageConnection, type PackageDocument,
} from "./package-format.ts";
import { holdsCredential } from "./redact.ts";
import { SKILL_FILE_MAX_BYTES } from "./skill-md.ts";

/** One file of the chosen folder, by its path inside that folder ("/"-separated). */
export interface ClaudeCodeFile {
  path: string;
  text: string;
}

export const CLAUDE_CODE_SOURCE = "Claude Code";
/** Files larger than this are not read (a SKILL.md is at most 256 KB). */
export const CLAUDE_CODE_FILE_MAX_BYTES = SKILL_FILE_MAX_BYTES;
const MAX_SUBAGENTS = 30;

const INSTRUCTION_FILES = ["CLAUDE.md", ".claude/CLAUDE.md", "AGENTS.md", "CLAUDE.local.md"];

/** A path inside the folder, normalised: "/" separators, no leading "./". A
 * folder picked at ~/.claude itself reads as if it were the project's .claude. */
export function claudeCodeRelativePath(path: string, pickedFolderName = ""): string {
  const clean = path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
  if (pickedFolderName === ".claude" && /^(?:skills|agents|commands)\//.test(clean)) return `.claude/${clean}`;
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
  return parts.filter(Boolean).join("\n\n");
}

function skillsFrom(files: ClaudeCodeFile[]): GrokExport["skills"] {
  const skills: GrokExport["skills"] = [];
  for (const file of files) {
    const skill = file.path.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/i);
    const command = file.path.match(/^\.claude\/commands\/((?:[^/]+\/)*[^/]+)\.md$/i);
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
  const taken = new Set<string>();
  const connections: PackageConnection[] = [];
  for (const [name, value] of Object.entries(servers)) {
    if (!isRecord(value)) continue;
    const label = `App “${clip(oneLine(name), 80)}”`;
    const named = { nameKey: "leftOut.name.app", params: { name: clip(oneLine(name), 80), max: PACKAGE_MAX_CONNECTIONS } };
    if (typeof value.command === "string") {
      // A command is never carried by a package: it would run on the person's computer.
      const envNames = isRecord(value.env) ? Object.keys(value.env).filter((key) => HEADER_NAME.test(key)) : [];
      leftOut.push({
        kind: "app", name: label,
        reason: "it runs a program on your computer; add it yourself in Capabilities",
        ...named, reasonKey: "leftOut.reason.runsProgram",
        original: [`Program: ${oneLine(value.command).split(" ")[0]}`, envNames.length ? `Values it needs: ${envNames.join(", ")}` : ""].filter(Boolean).join("\n"),
      });
      continue;
    }
    const url = typeof value.url === "string" ? value.url.trim() : "";
    const type = value.type === "sse" ? "sse" : "http";
    let usable = false;
    try {
      const parsedUrl = new URL(url);
      usable = !/\$\{/.test(url) && !parsedUrl.username && !parsedUrl.password
        && (parsedUrl.protocol === "https:" || (parsedUrl.protocol === "http:" && /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/.test(parsedUrl.hostname)));
    } catch {
      usable = false;
    }
    if (!usable) {
      leftOut.push({ kind: "app", name: label, reason: "its address is not a plain https:// address; add it yourself in Capabilities", ...named, reasonKey: "leftOut.reason.notHttps" });
      continue;
    }
    if (connections.length >= PACKAGE_MAX_CONNECTIONS) {
      leftOut.push({ kind: "app", name: label, reason: `an import brings at most ${PACKAGE_MAX_CONNECTIONS} apps`, ...named, reasonKey: "leftOut.reason.maxConnections" });
      continue;
    }
    // Header names only: their values (tokens, keys) never come over.
    const valueNames = [...new Set((isRecord(value.headers) ? Object.keys(value.headers) : []).filter((key) => HEADER_NAME.test(key)))].slice(0, 32);
    connections.push({
      key: uniqueSlug(/^[a-z]/i.test(slug(name, 28)) ? name : `app ${name}`, `app-${connections.length + 1}`, taken, 28),
      label: clip(oneLine(name), 100),
      reason: clip(`The Claude Code project used ${oneLine(name)}.`, 240),
      mcp: { transport: type, url, valueNames },
    } as PackageConnection);
  }
  return connections;
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
      const skillLike = /^\.claude\/(?:skills|commands|agents)\//i.test(file.path);
      if (!skillLike || !holdsCredential(file.text)) return true;
      leftOut.push({
        kind: "skill",
        name: file.path,
        reason: "it may hold a key or a password, so it was not opened. Add what the bot needs in Capabilities or the vault",
        reasonKey: "leftOut.reason.secretFile",
      });
      return false;
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  const byPath = new Map(files.map((file) => [file.path, file.text]));
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
  for (const secret of options.skippedSecrets ?? []) {
    leftOut.push({ kind: "secrets", name: secret, reason: "it may hold a key or a password, so it was not opened. Add what the bot needs in Capabilities or the vault", reasonKey: "leftOut.reason.secretFile" });
  }
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
