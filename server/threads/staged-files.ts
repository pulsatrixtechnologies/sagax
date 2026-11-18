// The files a person or a bot sent with a message through the agent API
// (send_prompt) or the member API (`POST bots/{id}/messages` with `files`):
// staged under the target bot's workspace, `inbox/<sender>/<name>`
// (server/index-leaves/agentApiStageFiles.ts). The server records on the
// conversation the paths it staged itself (TaskRecord.stagedFiles, written
// only by Store.addStagedFiles, never from a message's text), and those go
// when the conversation goes, or when the person whose conversation it is
// is erased.
//
// A file another conversation that stays still names is kept, the rule the
// stored attachments follow (attachmentStillShown: a conversation that stays
// still refers to it, by threadsReferencing). Only a regular file directly
// in `<workspace>/inbox/<sender>/` is removed: never a folder, never a
// symbolic link (the inbox, the sender folder or the file), never a path
// that resolves outside that inbox.
import { lstatSync, realpathSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const real = (path: string): string => {
  try { return realpathSync(path); } catch { return resolve(path); }
};
const isLink = (path: string): boolean => {
  try { return lstatSync(path).isSymbolicLink(); } catch { return true; }
};

/** Remove these staged files from one bot's workspace, but those a
 * conversation that stays still names (`stillNamed`). Returns how many went. */
export function removeStagedFiles(
  workspaceRoot: string,
  paths: readonly string[],
  stillNamed: (path: string) => boolean,
  warn: (line: string) => void = (line) => console.warn(line),
): number {
  const inboxPath = join(workspaceRoot, "inbox");
  // an inbox that is a link, or that resolves outside the workspace, is never walked
  if (isLink(inboxPath)) return 0;
  const inbox = real(inboxPath);
  if (!inbox.startsWith(real(workspaceRoot) + sep)) return 0;
  let removed = 0;
  for (const rel of paths) {
    const parts = rel.split("/");
    if (parts.length !== 3 || parts[0] !== "inbox" || parts.some((part) => !part || part === "." || part === "..")) continue;
    const folder = join(inboxPath, parts[1]!);
    // a sender folder that is a link is never followed, even into the inbox
    if (isLink(folder) || real(folder) !== join(inbox, parts[1]!)) continue;
    const path = join(folder, parts[2]!);
    let stat;
    try { stat = lstatSync(path); } catch { continue; }
    if (!stat.isFile()) continue;
    if (stillNamed(rel)) continue;
    try {
      rmSync(path, { force: true });
      removed++;
    } catch (error) {
      warn(`conversation deletion: a sent file was not removed (${error instanceof Error ? error.message : "unknown"})`);
    }
  }
  return removed;
}
