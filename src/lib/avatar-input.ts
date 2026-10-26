// A bot's or a group's picture from anywhere a person has one (2026-10-21,
// parity with Grok Bot's "Drag and drop or paste an image"): the file
// button, a drop on the avatar or the upload area, or a paste while it has
// focus. One limit for all of them, 25 MB (attachments take up to 32 MB), and
// an export of the current picture as a file.
import { downloadBlob, exportFileName } from "./diagram-view";

export const AVATAR_INPUT_MAX_BYTES = 25 * 1024 * 1024;
export const AVATAR_INPUT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/** The first picture a drop or a paste carries, or null. Pure. */
export function avatarImageFrom(transfer: Pick<DataTransfer, "files" | "items"> | null | undefined): File | null {
  if (!transfer) return null;
  for (const file of Array.from(transfer.files ?? [])) {
    if ((AVATAR_INPUT_TYPES as readonly string[]).includes(file.type)) return file;
  }
  for (const item of Array.from(transfer.items ?? [])) {
    if (item.kind !== "file" || !(AVATAR_INPUT_TYPES as readonly string[]).includes(item.type)) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

/** Whether a drag carries something that may be a picture (types only:
 * the files themselves are hidden until the drop). Pure. */
export function dragMayCarryImage(transfer: Pick<DataTransfer, "types" | "items"> | null | undefined): boolean {
  if (!transfer) return false;
  if (Array.from(transfer.items ?? []).some((item) => item.kind === "file" && item.type.startsWith("image/"))) return true;
  return Array.from(transfer.types ?? []).includes("Files");
}

/** Why a picture cannot be used, or null. Pure. */
export function avatarFileProblem(file: Pick<File, "type" | "size">): "type" | "size" | null {
  if (!(AVATAR_INPUT_TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size > AVATAR_INPUT_MAX_BYTES) return "size";
  return null;
}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** The picture as a download named after the bot or group. Throws when it
 * cannot be read. */
export async function exportAvatarImage(url: string, name: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`avatar ${response.status}`);
  const blob = await response.blob();
  const type = blob.type.split(";", 1)[0]!.trim().toLowerCase();
  downloadBlob(blob, exportFileName(name || "avatar", EXTENSIONS[type] ?? "png"));
}
