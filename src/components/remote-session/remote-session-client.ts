// Browser calls for one Tailcat session. The address never travels here.
import type { RemoteListing } from "../../../shared/remote-files";
import { api, ApiError } from "@/state/store";

const sessionPath = (botId: string, id: string, action: string) =>
  `/api/bots/${encodeURIComponent(botId)}/remote-sessions/${encodeURIComponent(id)}/${action}`;

function failure(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function closeRemoteSession(botId: string, id: string): Promise<string | null> {
  try {
    await api(sessionPath(botId, id, "close"), { method: "POST" });
    return null;
  } catch (error) {
    return failure(error, "The session could not be closed.");
  }
}

export async function focusRemoteSession(botId: string, id: string): Promise<string | null> {
  try {
    await api(sessionPath(botId, id, "focus"), { method: "POST" });
    return null;
  } catch (error) {
    return failure(error, "That remote session is not open.");
  }
}

export async function openRemoteShell(botId: string, id: string): Promise<string | null> {
  try {
    await api(sessionPath(botId, id, "shell"), { method: "POST" });
    return null;
  } catch (error) {
    return failure(error, "This remote computer did not open a shell.");
  }
}

export function uploadFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^\.+/, "").slice(0, 120);
  return /^[A-Za-z0-9]/.test(cleaned) ? cleaned : `file_${cleaned || "bin"}`;
}

/** One folder of the remote computer ("" = the user's profile). */
export async function listRemoteDir(botId: string, id: string, path: string): Promise<RemoteListing | { error: string }> {
  try {
    return await api<RemoteListing>(sessionPath(botId, id, "ls"), { method: "POST", body: JSON.stringify({ path }) });
  } catch (error) {
    return { error: failure(error, "That folder could not be listed.") };
  }
}

export const REMOTE_UPLOAD_MAX = 8 * 1024 * 1024;

export interface UploadRefusal {
  error: string;
  /** exists: a file of that name is there (resend with overwrite once the
   * person confirms); sensitive: a system folder Sagax refuses */
  code?: "exists" | "sensitive";
}

/** `dir`: the folder chosen in the remote file browser; without it the file
 * lands in the transfer folder. `overwrite` only after the person confirmed
 * replacing the file. */
export async function uploadRemoteFile(botId: string, id: string, file: File, options: { dir?: string; overwrite?: boolean } = {}): Promise<UploadRefusal | null> {
  if (file.size <= 0 || file.size > REMOTE_UPLOAD_MAX) return { error: "The file must be under 8 MB." };
  let dataBase64: string;
  try {
    dataBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? "");
        const comma = text.indexOf(",");
        resolve(comma >= 0 ? text.slice(comma + 1) : text);
      };
      reader.onerror = () => reject(new Error("The file could not be read."));
      reader.readAsDataURL(file);
    });
  } catch (error) {
    return { error: failure(error, "The file could not be read.") };
  }
  try {
    await api(sessionPath(botId, id, "upload"), {
      method: "POST",
      body: JSON.stringify({
        name: uploadFileName(file.name),
        dataBase64,
        ...(options.dir ? { dir: options.dir } : {}),
        ...(options.overwrite ? { overwrite: true } : {}),
      }),
    });
    return null;
  } catch (error) {
    const code = error instanceof ApiError ? error.body?.code : undefined;
    return {
      error: failure(error, "The file did not arrive on the remote computer."),
      ...(code === "exists" || code === "sensitive" ? { code } : {}),
    };
  }
}

export async function downloadRemoteFile(botId: string, id: string, remotePath: string): Promise<string | null> {
  const res = await fetch(sessionPath(botId, id, "download"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: remotePath }),
  });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("json")) {
    const body = await res.json().catch(() => ({})) as { error?: unknown };
    return typeof body.error === "string" ? body.error : "That file could not be downloaded.";
  }
  const blob = await res.blob();
  const match = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "");
  const name = match?.[1] || "download";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  return null;
}
