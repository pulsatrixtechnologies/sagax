// What one installed plugin holds, read only (the Contents tab of its page,
// #4453): the list of its files, or one file read. The folder is the one the
// caller resolved for its own person, bot or the installation; nothing here
// reads outside it (symbolic links, hidden Sagax copies and big files are left
// out, the path is checked by the same reader a skill's files use).
import type { ServerResponse } from "node:http";

import { listFolderFiles, readSkillFolderFile } from "../skills/skill-person-edit.ts";

/** What a plugin file read may weigh: text for reading, never a dump of something big. */
export const PLUGIN_FILE_MAX_BYTES = 512 * 1024;

type Json = (res: ServerResponse, status: number, body: unknown) => void;

export function sendPluginFiles(res: ServerResponse, json: Json, folder: string, filePath: string | null): void {
  if (!filePath) return json(res, 200, { files: listFolderFiles(folder, true) });
  const file = readSkillFolderFile(folder, filePath, { whole: true, maxBytes: PLUGIN_FILE_MAX_BYTES });
  if ("error" in file) return json(res, file.status, { error: file.error });
  // text only: an image, a PDF or any other binary is listed (its name and size) and never sent
  if (file.kind !== "text") return json(res, 415, { error: "this file is not shown here", kind: file.kind, bytes: file.bytes });
  json(res, 200, { path: filePath, kind: file.kind, text: file.text, bytes: file.bytes });
}
