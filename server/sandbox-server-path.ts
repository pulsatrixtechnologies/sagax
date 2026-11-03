// A Sagax server path given to a tool of the person's server environment
// (2026-11-02, GOX: Melonie called sagax-environment list_files on
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
// workspace, bots.json) still goes to the misuse guard, which refuses it.

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
