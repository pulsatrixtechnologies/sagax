import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/** Approval identity preserves every command byte, including whitespace and
 * newlines. Callers must supply native shell input, never a display preview. */
export function permissionCommand(command: unknown, cwd: unknown): { command: string; cwd: string } | undefined {
  if (typeof command !== "string" || !command.trim() || command.includes("\0")) return undefined;
  if (typeof cwd !== "string" || !isAbsolute(cwd) || cwd.includes("\0")) return undefined;
  return { command, cwd };
}

const PATH_TOOLS = new Set(["read", "write", "edit", "multiedit", "notebookedit", "notebookread", "glob", "grep", "ls"]);
/** Tools whose `path` defaults to the working folder when absent. */
const SEARCH_TOOLS = new Set(["glob", "grep", "ls"]);

/** The paths a Claude file tool's permission request touches, for the admin
 * gate on a member's bot. A relative path is resolved against the turn's
 * working folder; a `~` path is kept as written (not absolute, so the gate
 * treats it as outside). Undefined for any other tool or an unreadable input. */
export function permissionPaths(tool: unknown, input: unknown, cwd: string | undefined): string[] | undefined {
  if (typeof tool !== "string" || !PATH_TOOLS.has(tool.toLowerCase())) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const fields = input as Record<string, unknown>;
  const raw: string[] = [];
  for (const key of ["file_path", "notebook_path", "path"]) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) raw.push(value);
  }
  if (!raw.length && SEARCH_TOOLS.has(tool.toLowerCase()) && cwd) raw.push(cwd);
  if (!raw.length) return undefined;
  // a NUL byte is never a real path: kept relative, so it counts as outside
  return raw.map((path) => (path.includes("\0") ? "invalid" : path.startsWith("~") || !cwd ? path : resolve(cwd, path)));
}

/** The tool input with its file path fields made absolute against the
 * engine's cwd (a Claude tool may name a working-folder file by its
 * relative path, server/workspace.ts): what Sagax shows on a card, scopes
 * an "Always allow" rule with and records as a written file. Anything that
 * is not a relative path field of a file tool is left as it was. */
export function withAbsolutePaths(tool: unknown, input: unknown, cwd: string | undefined): unknown {
  if (!cwd || typeof tool !== "string" || !PATH_TOOLS.has(tool.toLowerCase())) return input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const fields = input as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const key of ["file_path", "notebook_path", "path"]) {
    const value = fields[key];
    if (typeof value !== "string" || !value.trim() || value.includes("\0") || value.startsWith("~") || isAbsolute(value)) continue;
    out ??= { ...fields };
    out[key] = resolve(cwd, value);
  }
  return out ?? input;
}

export function permissionLaunchCwd(cwd: string): string | undefined {
  try { return realpathSync(cwd); } catch { return undefined; }
}

/** ACP's rawInput is provider-specific. Accept a complete command string and
 * unambiguous absolute directory fields. A relative/invalid/conflicting
 * directory is not evidence of where the agent will execute it. */
export function acpPermissionCommand(rawInput: unknown, launchCwd: string | undefined): ReturnType<typeof permissionCommand> {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return undefined;
  const input = rawInput as Record<string, unknown>;
  const directories = ["cwd", "workdir", "working_directory", "directory", "dir"]
    .filter((key) => input[key] !== undefined)
    .map((key) => input[key]);
  if (directories.some((value) => typeof value !== "string" || !isAbsolute(value) || value.includes("\0"))) return undefined;
  if (new Set(directories).size > 1) return undefined;
  return permissionCommand(input.command, directories[0] ?? launchCwd);
}
