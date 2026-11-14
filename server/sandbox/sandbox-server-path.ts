// A Sagax server path given to a tool of the person's server environment
// (2026-11-02, production: a bot called sagax-environment list_files on
// /data/.openmausbot/workspaces/<its id>). That folder is the bot's own
// workspace ON THE SAGAX SERVER (the engine's working folder, its memory and
// docs); the environment is another machine, where the path does not exist.
// The guard then refused it as a platform file with the long policy list,
// which read as an accusation.
//
// The answer is one short line that names the bot's folder in the
// environment. Nothing is mapped: the server folder and /workspace/bots/<slug>
// are two different places, and mapping one onto the other would hand the
// bot a folder whose contents are not what the path held. Nothing runs, so
// no file of the server is read; any other server path (another bot's
// workspace, bots.json) still goes to the misuse guard first, which refuses
// it (#4146: commandForEnvironment's line comes only after that verdict).
import { SANDBOX_PLUGIN_DATA_DIR as SANDBOX_PLUGIN_DATA, SANDBOX_PLUGINS_DIR as SANDBOX_PLUGINS } from "./sandbox-plugins.ts";

/** This bot's own folders on the Sagax server (its workspace and its task
 * workspaces), every spelling of them (a data folder reached through a
 * link). Only absolute folders at least two levels deep count. */
export interface ServerPathRoots {
  roots: readonly string[];
  /** The bot's folder in the environment (/workspace/bots/<slug>), or null. */
  folder: string | null;
}

const trimSlash = (value: string) => value.replace(/\/+$/, "");

function normalizeAbsolute(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function usableRoots(roots: readonly string[]): string[] {
  return roots.map((root) => trimSlash(root.trim())).filter((root) => root.startsWith("/") && root.split("/").length >= 3);
}

/** The line the bot reads instead of a refusal. English, like every tool
 * result a bot reads; the bot tells the person in their language. */
export function serverPathLine(folder: string | null): string {
  const where = folder ? `Your folder is ${folder}/.` : "Your files are in /workspace.";
  return `That path is on the Sagax server, not in your environment. ${where}`;
}

/** The line for a file tool's path inside one of this bot's server folders,
 * or null for any other path (relative paths start in the environment). */
export function serverPathAnswer(path: string, where: ServerPathRoots): string | null {
  const raw = path.trim();
  if (!raw.startsWith("/") || raw.includes("\u0000")) return null;
  const resolved = normalizeAbsolute(raw);
  const hit = usableRoots(where.roots).some((root) => resolved === root || resolved.startsWith(`${root}/`));
  return hit ? serverPathLine(where.folder) : null;
}

/** The same line for a shell command that names one of these folders, as a
 * whole path segment (`/data/x/workspaces/b1` or below, not `.../b10`). */
export function serverPathInCommand(command: string, where: ServerPathRoots): string | null {
  for (const root of usableRoots(where.roots)) {
    let from = 0;
    for (;;) {
      const at = command.indexOf(root, from);
      if (at < 0) break;
      const next = command[at + root.length];
      // what follows the folder up to the end of the word: a `..` that climbs
      // out of it leaves the decision to the misuse guard
      const rest = /^[^\s"'`;)|&]*/.exec(command.slice(at + root.length))?.[0] ?? "";
      if ((next === undefined || /[/\s"'`;)|&]/.test(next)) && !/(?:^|\/)\.\.(?:\/|$)/.test(rest)) return serverPathLine(where.folder);
      from = at + root.length;
    }
  }
  return null;
}

// #4146 (2026-11-13, production): a command sent to the environment named a
// path of the server's own data folder (a plugin's data folder that the
// engine filled in on the server). That path does not exist in the
// environment, so the script failed. A command now reaches the environment
// with the environment's paths: a plugin folder of the server (installed, or
// the turn copy the engine reads) becomes its copy in /workspace/sagax-plugins,
// and the plugin's data folder under the server's data folder becomes
// /workspace/sagax-plugin-data. Any other path under the server's data folder
// (the principals folder, an engine's own folders) cannot work there: the
// command stops before it runs, with a line that names the path.

/** The server's data folder (every spelling) and the plugins of this turn,
 * by name and folder on the server. */
export interface ServerCommandPaths {
  dataRoots: readonly string[];
  plugins: readonly { name: string; dir: string }[];
  /** The bot's folder in the environment (/workspace/bots/<slug>), or null. */
  folder: string | null;
}

/** Folders the environment owns itself: a server data folder spelled like
 * one of them is never taken for the server's. */
const ENVIRONMENT_FOLDERS = ["/workspace", "/tmp", "/home", "/root"];

/** The end of a path written in a command. */
const PATH_END = /[\s"'`;)|&<>,]/;
/** A character that continues a longer path before the match. */
const PATH_BEFORE = /[A-Za-z0-9._~/$-]/;

function serverRoots(roots: readonly string[]): string[] {
  return [...new Set(usableRoots(roots).filter((root) => !ENVIRONMENT_FOLDERS.some((own) => root === own || root.startsWith(`${own}/`))))]
    // the longest spelling first, so a linked data folder is not read as a shorter one
    .sort((a, b) => b.length - a.length);
}

/** Each place `root` starts a whole path in `command`, with the path. */
function pathsAt(command: string, root: string): Array<{ at: number; path: string }> {
  const found: Array<{ at: number; path: string }> = [];
  let from = 0;
  for (;;) {
    const at = command.indexOf(root, from);
    if (at < 0) break;
    from = at + root.length;
    const next = command[at + root.length];
    if (at > 0 && PATH_BEFORE.test(command[at - 1]!)) continue;
    if (next !== undefined && next !== "/" && !PATH_END.test(next)) continue;
    let end = at + root.length;
    while (end < command.length && !PATH_END.test(command[end]!)) end += 1;
    found.push({ at, path: command.slice(at, end) });
  }
  return found;
}

/** A plugin's name for a folder name the engine made for it on the server:
 * the plugin's own name, or Claude Code's data folder `<name>-<marketplace>`
 * (the longest name that fits wins). */
function pluginFor(folderName: string, names: readonly string[]): string | undefined {
  return [...names].sort((a, b) => b.length - a.length).find((name) => folderName === name || folderName.startsWith(`${name}-`));
}

function replaceAll(command: string, root: string, place: (rest: string) => string | null): string {
  let out = command;
  for (const { at, path } of pathsAt(command, root).reverse()) {
    const replaced = place(path.slice(root.length));
    if (replaced !== null) out = `${out.slice(0, at)}${replaced}${out.slice(at + path.length)}`;
  }
  return out;
}

/** The line for a path of the server that the environment does not have. */
export function serverOnlyPathLine(path: string, folder: string | null): string {
  const where = folder ? `Your folder is ${folder}/; ` : "Your files are in /workspace; ";
  return `Not run: ${path} is a path on the Sagax server, not in your environment, so the command cannot use it there. ${where}installed plugins are in /workspace/sagax-plugins/<plugin> and their data in /workspace/sagax-plugin-data/<plugin>.`;
}

/** A command with the environment's paths in place of the server's plugin
 * folders, or the line that stops it when it still names a path under the
 * server's data folder. Nothing is changed in a command that names none. */
export function commandForEnvironment(command: string, where: ServerCommandPaths): { command: string } | { refusal: string; command: string } {
  const names = where.plugins.map((plugin) => plugin.name).filter((name) => /^[A-Za-z0-9._-]+$/.test(name));
  let out = command;
  // an installed plugin folder, wherever it is on the server
  const installed = where.plugins
    .filter((plugin) => /^[A-Za-z0-9._-]+$/.test(plugin.name))
    .flatMap((plugin) => serverRoots([plugin.dir]).map((dir) => ({ dir, name: plugin.name })))
    .sort((a, b) => b.dir.length - a.dir.length);
  for (const { dir, name } of installed) out = replaceAll(out, dir, (rest) => `${SANDBOX_PLUGINS}/${name}${rest}`);
  const bases = new Map(where.plugins.map((plugin) => [plugin.dir.replace(/\/+$/, "").split("/").pop() ?? "", plugin.name]));
  for (const root of serverRoots(where.dataRoots)) {
    out = replaceAll(out, root, (rest) => {
      // the turn copy of a plugin the engine reads (plugin-agent-tools.ts)
      const copy = /^\/engine-policies\/plugin-agents\/[^/]+\/[^/]+\/([^/]+)(\/.*)?$/.exec(rest);
      if (copy) {
        const name = bases.get(copy[1]!);
        return name ? `${SANDBOX_PLUGINS}/${name}${copy[2] ?? ""}` : null;
      }
      // a plugin's data folder of an engine on the server (CLAUDE_PLUGIN_DATA)
      const data = /\/plugins\/data\/([^/]+)(\/.*)?$/.exec(rest);
      if (data) {
        const name = pluginFor(data[1]!, names);
        return name ? `${SANDBOX_PLUGIN_DATA}/${name}${data[2] ?? ""}` : null;
      }
      return null;
    });
  }
  for (const root of serverRoots(where.dataRoots)) {
    const left = pathsAt(out, root)[0];
    // the rewritten command rides along, so the misuse guard can judge it too
    if (left) return { refusal: serverOnlyPathLine(left.path, where.folder), command: out };
  }
  return { command: out };
}
