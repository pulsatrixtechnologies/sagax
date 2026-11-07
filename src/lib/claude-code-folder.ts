// A Claude Code folder picked in the browser (<input webkitdirectory>), read
// for the agent import (shared/claude-code-import.ts). Only the agent files
// are opened; a file that may hold a secret is listed by name and never read;
// everything else (source code, node_modules, ...) is not touched.
import {
  CLAUDE_CODE_FILE_MAX_BYTES, claudeCodeRelativePath, claudeCodeSecretPath, claudeCodeWantedPath, type ClaudeCodeFile,
} from "../../shared/claude-code-import";

export interface PickedFile {
  /** webkitRelativePath: "<picked folder>/<path inside it>". */
  webkitRelativePath: string;
  name: string;
  size: number;
  text(): Promise<string>;
}

export interface ClaudeCodeFolder {
  folderName: string;
  files: ClaudeCodeFile[];
  /** Paths inside the folder that were not opened because they may hold a secret (agent-relevant places only). */
  skippedSecrets: string[];
}

/** Secret-looking files worth naming: at the folder's top, under .claude/, or at the top of a Hermes profile. */
const NAMED_SECRET_PLACE = /^(?:[^/]+|\.claude\/.+|profiles\/[^/]+\/[^/]+)$/;

export async function readClaudeCodeFolder(list: ArrayLike<PickedFile>): Promise<ClaudeCodeFolder> {
  const picked = Array.from(list);
  const folderName = picked[0]?.webkitRelativePath.split("/")[0] ?? "";
  const files: ClaudeCodeFile[] = [];
  const skippedSecrets: string[] = [];
  for (const file of picked) {
    const inside = file.webkitRelativePath.split("/").slice(1).join("/") || file.name;
    const path = claudeCodeRelativePath(inside, folderName);
    if (claudeCodeSecretPath(path)) {
      if (NAMED_SECRET_PLACE.test(path) && skippedSecrets.length < 20) skippedSecrets.push(path);
      continue;
    }
    if (!claudeCodeWantedPath(path) || file.size > CLAUDE_CODE_FILE_MAX_BYTES) continue;
    files.push({ path, text: await file.text() });
  }
  return { folderName, files, skippedSecrets };
}
