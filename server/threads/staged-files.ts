// The files a person or a bot sent with a message through the agent API
// (send_prompt) or the member API (`POST bots/{id}/messages` with `files`):
// staged under the target bot's workspace, `inbox/<sender>/<name>`
// (server/index-leaves/agentApiStageFiles.ts), and named in the line by
// agentPromptWithFiles (server/agent-api.ts). They belong to the
// conversation that line is in: deleting the conversation, or erasing the
// person whose conversation it is, removes them.
//
// Only a regular file directly in `<workspace>/inbox/<sender>/` is removed:
// never a folder, never a symbolic link nor what it points at, never a path
// that resolves outside that inbox.
import { lstatSync, realpathSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import { stagedPathsIn } from "../agent-api.ts";

/** The staged paths named by these lines (and queued texts), once each. */
export function stagedFilesOf(texts: Iterable<string | undefined>): string[] {
  const paths = new Set<string>();
  for (const text of texts) for (const path of stagedPathsIn(text)) paths.add(path);
  return [...paths];
}

const real = (path: string): string => {
  try { return realpathSync(path); } catch { return resolve(path); }
};

/** Remove these staged files from one bot's workspace. Returns how many went. */
export function removeStagedFiles(workspaceRoot: string, paths: readonly string[], warn: (line: string) => void = (line) => console.warn(line)): number {
  const inbox = real(join(workspaceRoot, "inbox"));
  // an inbox that is a link, or that resolves outside the workspace, is never walked
  if (!inbox.startsWith(real(workspaceRoot) + sep)) return 0;
  try { if (lstatSync(join(workspaceRoot, "inbox")).isSymbolicLink()) return 0; } catch { return 0; }
  let removed = 0;
  for (const rel of paths) {
    const parts = rel.split("/");
    if (parts.length !== 3 || parts[0] !== "inbox" || parts.some((part) => !part || part === "." || part === "..")) continue;
    const path = join(workspaceRoot, ...parts);
    let stat;
    try { stat = lstatSync(path); } catch { continue; }
    if (!stat.isFile()) continue;
    const folder = real(join(workspaceRoot, parts[0], parts[1]!));
    if (!(folder.startsWith(inbox + sep))) continue;
    try {
      rmSync(path, { force: true });
      removed++;
    } catch (error) {
      warn(`conversation deletion: a sent file was not removed (${error instanceof Error ? error.message : "unknown"})`);
    }
  }
  return removed;
}
