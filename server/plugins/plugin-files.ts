// What one installed plugin holds, read only (the Contents tab of its page,
// #4453): the list of its files, or one file read. The folder is the one the
// caller resolved for its own person, bot or the installation; nothing here
// reads outside it (symbolic links, hidden Sagax copies and big files are left
// out, the path is checked by the same reader a skill's files use).
import type { ServerResponse } from "node:http";

import { listFolderFiles, readSkillFolderFile } from "../skills/skill-person-edit.ts";

type Json = (res: ServerResponse, status: number, body: unknown) => void;

export function sendPluginFiles(res: ServerResponse, json: Json, folder: string, filePath: string | null): void {
  if (!filePath) return json(res, 200, { files: listFolderFiles(folder, true) });
  const file = readSkillFolderFile(folder, filePath);
  if ("error" in file) return json(res, file.status, { error: file.error });
  if (file.kind === "text") return json(res, 200, { path: filePath, kind: file.kind, text: file.text, bytes: file.bytes });
  res.statusCode = 200;
  res.setHeader("content-type", file.contentType);
  res.end(file.buffer);
}
