// Loi 25 (2026-10-17, follow-up of #696): deleting a person's account
// erases the files of their own ordinary threads on bots they do not own,
// not only those threads' records. A confidential thread already leaves
// nothing behind (wipeConfidentialThread in server/index.ts); an ordinary
// one kept its task folder (`task-workspaces/<bot>/<thread>`: what the bot
// wrote there, exports included), its oversized tool results and its
// stored uploads and attach_file outputs.
//
// Strictly that person's: the caller passes only the threads whose
// recorded owner is the person (server/thread-privacy.ts). A thread's own
// folder goes, never its working folder when that is elsewhere (the bot's
// workspace, a project), never a folder another thread that stays works in,
// and never a symbolic link's target. A stored file goes only when no
// thread that stays (another person's, a room's) still points at it.
// Memory is not touched here: what a shared bot learnt stays with the bot.
//
// planPersonThreadErasure lists (the dry run); erasePersonThreadFiles
// removes what a plan lists. Pure but for the file system, so the tests
// give their own roots.
import { existsSync, lstatSync, realpathSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import { modelImageCopyPath } from "./model-image.ts";
import { officeKind, officeMediaFolder } from "./office-media.ts";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
/** The attachment store's own names (an opaque id and an extension). */
const STORED_NAME = /^[A-Za-z0-9-]+\.[a-z0-9]{1,8}$/;

export interface PersonThreadErasureInput {
  /** The person's own ordinary threads, already deleted from the store,
   * with the stored files their messages pointed at (read before). */
  threads: ReadonlyArray<{ botId: string; threadId: string; attachments: readonly string[] }>;
  /** `task-workspaces`. */
  tasksRoot: string;
  /** The attachment store. */
  attachmentsDir: string;
  /** Oversized tool results, one folder per thread. */
  toolResultsDir: string;
  /** The working folders of every thread that stays: never removed, nor
   * any folder holding one. */
  keptFolders: readonly string[];
  /** Whether a stored file is still pointed at by a thread that stays. */
  referencedElsewhere(name: string): boolean;
}

export interface PersonThreadErasurePlan {
  folders: string[];
  toolResults: string[];
  attachments: string[];
  /** Thread folders left in place because a thread that stays works there. */
  skipped: string[];
}

const real = (path: string): string => {
  try { return realpathSync(path); } catch { return resolve(path); }
};
const inside = (child: string, parent: string): boolean => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/** The two spellings a thread's tool-results folder has had. */
export function toolResultFolders(toolResultsDir: string, threadId: string): string[] {
  return [...new Set([
    join(toolResultsDir, threadId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80)),
    join(toolResultsDir, threadId.replace(/[^\w.-]/g, "_")),
  ])];
}

/** What erasing these threads' files would remove (the dry run). */
export function planPersonThreadErasure(input: PersonThreadErasureInput): PersonThreadErasurePlan {
  const plan: PersonThreadErasurePlan = { folders: [], toolResults: [], attachments: [], skipped: [] };
  const kept = input.keptFolders.filter(Boolean).map(real);
  const tasksRoot = real(input.tasksRoot);
  const toolRoot = real(input.toolResultsDir);
  const names = new Set<string>();
  for (const { botId, threadId, attachments } of input.threads) {
    if (!ID.test(botId) || !ID.test(threadId)) continue;
    const folder = join(input.tasksRoot, botId, threadId);
    if (existsSync(folder)) {
      const link = lstatSync(folder).isSymbolicLink();
      const resolved = real(folder);
      // its own folder only, under task-workspaces/<bot>, never a link
      if (link || !inside(resolved, join(tasksRoot, botId)) || resolved === join(tasksRoot, botId)) plan.skipped.push(folder);
      else if (kept.some((other) => inside(other, resolved))) plan.skipped.push(folder);
      else plan.folders.push(folder);
    }
    for (const dir of toolResultFolders(input.toolResultsDir, threadId)) {
      if (!existsSync(dir) || lstatSync(dir).isSymbolicLink()) continue;
      const resolved = real(dir);
      if (resolved !== toolRoot && inside(resolved, toolRoot)) plan.toolResults.push(dir);
    }
    for (const name of attachments) if (STORED_NAME.test(name)) names.add(name);
  }
  for (const name of names) {
    const path = join(input.attachmentsDir, name);
    if (!existsSync(path) || lstatSync(path).isSymbolicLink()) continue;
    if (input.referencedElsewhere(name)) continue;
    plan.attachments.push(name);
  }
  return plan;
}

/** Removes what a plan lists. Never throws: each failure is logged without
 * naming anyone, and the next one is still removed. Answers how many went. */
export function erasePersonThreadFiles(plan: PersonThreadErasurePlan, attachmentsDir: string, warn: (line: string) => void = (line) => console.warn(line)): { removed: number } {
  let removed = 0;
  const remove = (path: string, what: string, recursive: boolean) => {
    try {
      rmSync(path, { recursive, force: true, maxRetries: 20, retryDelay: 100 });
      if (!existsSync(path)) removed++;
    } catch (error) {
      warn(`account deletion: ${what} was not removed (${error instanceof Error ? error.message : "unknown"})`);
    }
  };
  for (const folder of plan.folders) remove(folder, "a thread folder", true);
  for (const dir of plan.toolResults) remove(dir, "a thread's tool results", true);
  for (const name of plan.attachments) {
    remove(join(attachmentsDir, name), "a stored file", false);
    // the pictures read out of an Office document (server/office-media.ts)
    if (officeKind(name) && existsSync(officeMediaFolder(attachmentsDir, name))) remove(officeMediaFolder(attachmentsDir, name), "a stored file's pictures", true);
    // the copy of a picture scaled for the model (server/model-image.ts)
    const modelCopy = modelImageCopyPath(attachmentsDir, join(attachmentsDir, name));
    if (existsSync(modelCopy)) remove(modelCopy, "a picture's model copy", false);
  }
  return { removed };
}
