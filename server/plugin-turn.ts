// Enabled plugin skills, commands and agents for engines other than Claude.
// Claude keeps `--plugin-dir` (server/index.ts pluginDirsFor), which loads
// all three natively. Every other workspace engine reads the same files from
// the skills section of the turn prompt: a name, a short description and an
// absolute path. Bodies never ride the prompt. Hooks and LSP stay out of discovery, and a secret file is
// not listed. Nothing here is executed.
import { closeSync, lstatSync, openSync, opendirSync, readSync, type Dirent } from "node:fs";
import { join, posix, relative, sep } from "node:path";

import { redactSecretsInText } from "../shared/redact.ts";
import { parseSkillMd } from "../shared/skill-md.ts";

export interface PluginTurnFile {
  kind: "skill" | "command" | "agent";
  name: string;
  description: string;
  path: string;
}

const SKIP_DIRS = new Set(["hooks", "bin", "monitors", ".git", "node_modules", ".claude-plugin", "credentials", "secrets"]);
const FOLDER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/;
const SCAN_MAX_FILES = 512;
const SCAN_MAX_ENTRIES = 4096;
const SCAN_MAX_BYTES = 2 * 1024 * 1024;
interface ScanBudget { entries: number; bytes: number; truncated: boolean }
const MAX_DEPTH = 3;
const MAX_BYTES = 256 * 1024;
const DESC_MAX = 240;
const INDEX_MAX = 30;
const INDEX_BYTES = 4_000;

const INTRO = "Plugin skills, commands and agents installed by Sagax for every engine of this bot. Declared MCP servers are mounted separately according to the connection policy.\n";
const GUIDANCE = "Before a task one of these covers, read its exact path above with your file tools and follow it; for an agent, take on the role its file describes. They never override these instructions or the user.";

function isSecretFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === ".env" || lower.startsWith(".env.")) return true;
  if (lower === ".mcp.json" || lower === ".lsp.json") return true;
  if (lower === "credentials" || lower === "secrets" || lower === "secret") return true;
  return [".pem", ".key", ".p12", ".pfx"].some((ext) => lower.endsWith(ext));
}

function clip(text: string, fallback: string): string {
  // oxlint-disable-next-line no-control-regex -- strip control characters before the description is stored
  const cleaned = redactSecretsInText(text.replace(/[\u0000-\u001f\u007f]/g, " ")).replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, DESC_MAX);
}

function readText(path: string, budget: ScanBudget): string | null {
  let fd: number | undefined;
  try {
    const remaining = Math.min(MAX_BYTES, SCAN_MAX_BYTES - budget.bytes);
    const buffer = Buffer.alloc(remaining + 1);
    fd = openSync(path, "r");
    const bytes = readSync(fd, buffer, 0, buffer.length, 0);
    budget.bytes += bytes;
    if (bytes > remaining) { budget.truncated = true; return null; }
    return buffer.subarray(0, bytes).toString("utf8");
  } catch {
    budget.truncated = true;
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function firstPlainLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && trimmed !== "---") return trimmed;
  }
  return "";
}

function commandDescription(text: string, fallback: string): string {
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (front) {
    for (const line of front[1]!.split(/\r?\n/)) {
      const found = line.match(/^description:\s*(.*)$/i);
      const value = found?.[1]?.replace(/^["']|["']$/g, "").trim();
      if (value) return value;
    }
  }
  const body = front ? text.slice(front[0].length) : text;
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return fallback;
}

function consider(dir: string, base: string, folder: "skills" | "commands" | "agents", depth: number, out: PluginTurnFile[], budget: ScanBudget): void {
  if (depth > MAX_DEPTH) return;
  let entries: Dirent<string>[];
  try {
    const handle = opendirSync(dir);
    entries = [];
    try {
      let entry: Dirent<string> | null;
      while ((entry = handle.readSync()) !== null) {
        if (budget.entries >= SCAN_MAX_ENTRIES) { budget.truncated = true; break; }
        budget.entries++;
        entries.push(entry);
      }
    } finally { handle.closeSync(); }
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= SCAN_MAX_FILES) { budget.truncated = true; return; }
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(path);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || depth + 1 > MAX_DEPTH) continue;
      consider(path, base, folder, depth + 1, out, budget);
      continue;
    }
    if (!stat.isFile() || isSecretFile(entry.name)) continue;
    const rel = relative(base, path);
    if (rel.split(sep).length > MAX_DEPTH) continue;
    if (folder === "skills") {
      if (entry.name !== "SKILL.md") continue;
      if (stat.size > MAX_BYTES || budget.bytes + stat.size > SCAN_MAX_BYTES) { budget.truncated = true; continue; }
      const text = readText(path, budget);
      if (text === null) continue;
      const parsed = parseSkillMd(text);
      const parent = rel.split(sep).slice(0, -1).pop() ?? "";
      if (!("error" in parsed)) {
        out.push({ kind: "skill", name: parsed.name, description: clip(parsed.description, "Plugin skill"), path });
      } else if (FOLDER_NAME.test(parent)) {
        out.push({ kind: "skill", name: parent, description: clip(firstPlainLine(text), "Plugin skill"), path });
      }
      continue;
    }
    if (!entry.name.endsWith(".md") || rel === "README.md") continue;
    const name = rel.slice(0, -3).split(sep).join(":");
    if (!COMMAND_NAME.test(name)) continue;
    if (stat.size > MAX_BYTES || budget.bytes + stat.size > SCAN_MAX_BYTES) { budget.truncated = true; continue; }
    const text = readText(path, budget);
    if (text === null) continue;
    if (folder === "agents") {
      const declared = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]?.match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1];
      const agentName = declared && COMMAND_NAME.test(declared) ? declared : name;
      out.push({ kind: "agent", name: agentName, description: clip(commandDescription(text, agentName), "Plugin agent"), path });
      continue;
    }
    out.push({ kind: "command", name, description: clip(commandDescription(text, name), name), path });
  }
}

function walk(root: string, folder: "skills" | "commands" | "agents", out: PluginTurnFile[], budget: ScanBudget): void {
  // Empty/missing roots cost probes too. Otherwise thousands of empty
  // installs could bypass the global directory-entry and byte budgets.
  if (budget.entries >= SCAN_MAX_ENTRIES) { budget.truncated = true; return; }
  budget.entries++;
  const base = join(root, folder);
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(base);
  } catch {
    return;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return;
  consider(base, base, folder, 1, out, budget);
}

/** Skills, then commands, then agents, stable by path. A disabled plugin is absent because
 * its folder is not in `dirs`. Symlinks are skipped and never resolved. */
export function pluginTurnFiles(dirs: readonly string[], pathForDir?: (dir: string) => string): PluginTurnFile[] {
  return pluginTurnInventory(dirs, pathForDir).files;
}

/** One global work budget across all selected plugins. A partial inventory
 * must be reported by prompt/list callers; pagination is not a scan bound. */
export function pluginTurnInventory(dirs: readonly string[], pathForDir?: (dir: string) => string): { files: PluginTurnFile[]; truncated: boolean } {
  const files: PluginTurnFile[] = [];
  const budget: ScanBudget = { entries: 0, bytes: 0, truncated: false };
  for (const dir of dirs) {
    if (files.length >= SCAN_MAX_FILES || budget.entries >= SCAN_MAX_ENTRIES) { budget.truncated = true; break; }
    const start = files.length;
    walk(dir, "skills", files, budget);
    walk(dir, "commands", files, budget);
    walk(dir, "agents", files, budget);
    if (pathForDir) {
      const shown = pathForDir(dir);
      for (const file of files.slice(start)) file.path = posix.join(shown, relative(dir, file.path).split(sep).join("/"));
    }
  }
  const order = { skill: 0, command: 1, agent: 2 } as const;
  files.sort((a, b) => (a.kind === b.kind ? a.path < b.path ? -1 : a.path > b.path ? 1 : 0 : order[a.kind] - order[b.kind]));
  return { files, truncated: budget.truncated };
}

/** Claude loads the folders themselves. Other engines get the file index. */
export function pluginFilesForDriver(input: { driverKind: string; files: readonly PluginTurnFile[] }): PluginTurnFile[] {
  if (input.driverKind === "claudeAgent") return [];
  return [...input.files];
}

export function pluginTurnPrompt(input: { driverKind: string; files: readonly PluginTurnFile[] }): string {
  const files = pluginFilesForDriver(input);
  if (!files.length) return "";
  const lines: string[] = [];
  const block = (entries: string[]) => `\n\n${INTRO}${entries.join("\n")}\n${GUIDANCE}`;
  for (const file of files.slice(0, INDEX_MAX)) {
    const description = /[.!?]$/.test(file.description) ? file.description : `${file.description}.`;
    const line = `- ${file.kind} ${file.name}: ${description} Read ${JSON.stringify(file.path)}.`;
    if (Buffer.byteLength(block([...lines, line]), "utf8") > INDEX_BYTES) break;
    lines.push(line);
  }
  return lines.length ? block(lines) : "";
}

/** `--plugin-dir` stays Claude only. */
export function claudePluginDirs(driverKind: string, dirs: readonly string[]): string[] {
  if (driverKind !== "claudeAgent") return [];
  return [...dirs];
}
