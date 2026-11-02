import { useCallback, useEffect, useRef, useState } from "react";
import { attachmentBasename } from "@/lib/composer-attachments";
import { t } from "@/lib/i18n";

// The message-file request and save helpers, split out of AttachmentPreview.tsx
// so the file viewers (table, PDF, JSON, HTML) read them without importing the
// component that renders those viewers back.

export interface MessageAttachmentContext { threadId: string; messageId: string }

const IMAGE_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/tiff": "tiff",
  "image/webp": "webp",
};

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "png",
  "tif",
  "tiff",
  "webp",
]);

/** Keep a suggested download name portable and prevent it from naming a path. */
export function safeDownloadFilename(value: string | null | undefined): string {
  const basename = (value ?? "").split(/[\\/]/).at(-1) ?? "";
  const cleaned = basename
    .normalize("NFC")
    // oxlint-disable-next-line no-control-regex -- strips control and bidi characters from a filename
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .trim()
    .replace(/[. ]+$/g, "");
  const bounded = Array.from(cleaned)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return character.length > 1 || code < 0xd800 || code > 0xdfff;
    })
    .slice(0, 180)
    .join("");
  if (!bounded) return "download";
  const stem = bounded.split(".", 1)[0]!.toUpperCase();
  return /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem) ? `_${bounded}` : bounded;
}

/** Read the server-selected filename, preferring RFC 5987's UTF-8 form. */
export function contentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const encoded = /(?:^|;)\s*filename\*\s*=\s*(?:UTF-8'[^']*')?([^;]*)/i.exec(header)?.[1]?.trim();
  if (encoded) {
    const unquoted = encoded.replace(/^"|"$/g, "");
    try {
      return safeDownloadFilename(decodeURIComponent(unquoted));
    } catch {
      // A malformed extended value may still have a valid ASCII fallback.
    }
  }
  const quoted = /(?:^|;)\s*filename\s*=\s*"((?:\\.|[^"\\])*)"/i.exec(header)?.[1];
  if (quoted !== undefined) return safeDownloadFilename(quoted.replace(/\\(.)/g, "$1"));
  const plain = /(?:^|;)\s*filename\s*=\s*([^;]*)/i.exec(header)?.[1]?.trim();
  return plain ? safeDownloadFilename(plain) : null;
}

function sourceImageExtension(source: string | undefined): string | null {
  if (!source) return null;
  let pathname = source;
  try {
    pathname = decodeURIComponent(new URL(source, "https://openmausbot.invalid").pathname);
  } catch {
    pathname = source.split(/[?#]/, 1)[0] ?? source;
  }
  const extension = /\.([a-z0-9]+)$/i.exec(pathname)?.[1]?.toLowerCase();
  return extension && IMAGE_EXTENSIONS.has(extension) ? extension : null;
}

function replaceExtension(name: string, extension: string): string {
  const suffix = `.${extension}`;
  const stem = name.replace(/\.[^.]*$/, "") || "image";
  const available = Math.max(1, 180 - Array.from(suffix).length);
  return `${Array.from(stem).slice(0, available).join("")}${suffix}`;
}

/** The response chooses the label; image bytes/source choose the extension. */
export function canonicalDownloadFilename({
  contentDisposition,
  fallback,
  source,
  mime,
}: {
  contentDisposition?: string | null;
  fallback?: string;
  source?: string;
  mime?: string | null;
}): string {
  const selected = contentDispositionFilename(contentDisposition ?? null)
    ?? safeDownloadFilename(fallback);
  const mediaType = mime?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const imageExtension = IMAGE_EXTENSION_BY_MIME[mediaType] ?? sourceImageExtension(source);
  return imageExtension ? replaceExtension(selected, imageExtension) : selected;
}

function revokeObjectUrlLater(url: string): void {
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Downloads and explicit media previews share the message-scoped capability.
 * Never request a transcript path directly, even when it looks like a URL. */
export async function requestMessageFile(
  filePath: string,
  message: MessageAttachmentContext,
  signal: AbortSignal,
  folder?: { entry?: string; list?: boolean },
): Promise<Response> {
  const response = await fetch(`/api/threads/${encodeURIComponent(message.threadId)}/messages/${encodeURIComponent(message.messageId)}/file`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // A linked folder answers with its files instead of a 400; an entry is
    // one of those files, fetched by name under the same message grant.
    body: JSON.stringify({
      path: filePath,
      ...(folder?.entry !== undefined ? { entry: folder.entry } : folder?.list ? { listFolder: true } : {}),
    }),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    throw Object.assign(new Error(body?.error ?? t("attach.downloadFailed")), { code: body?.code });
  }
  return response;
}

export interface MessageFileLocation {
  /** Opaque, same-origin URLs. Neither one contains the transcript's path. */
  downloadUrl: string;
  previewUrl: string;
  name: string;
  mime: string;
  bytes: number;
}

/** Resolve an exact-message POST capability into the opaque GET capability
 * a native HTML media element or browser download manager can stream. */
export async function requestMessageFileLocation(
  filePath: string,
  message: MessageAttachmentContext,
  signal: AbortSignal,
): Promise<MessageFileLocation> {
  const response = await fetch(`/api/threads/${encodeURIComponent(message.threadId)}/messages/${encodeURIComponent(message.messageId)}/file`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: filePath, location: true }),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    throw Object.assign(new Error(body?.error ?? t("attach.downloadFailed")), { code: body?.code });
  }
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    await response.body?.cancel().catch(() => undefined);
    throw Object.assign(new Error(t("attach.downloadFailed")), { code: "streaming_location_unavailable" });
  }
  const body = await response.json().catch(() => null) as Partial<MessageFileLocation> | null;
  const prefix = `/api/threads/${encodeURIComponent(message.threadId)}/files/`;
  const validUrl = (value: unknown, preview: boolean): value is string =>
    typeof value === "string" && value.startsWith(prefix) &&
    (preview ? /^[a-f0-9]{24}\?preview=1$/.test(value.slice(prefix.length)) : /^[a-f0-9]{24}$/.test(value.slice(prefix.length)));
  if (!body || !validUrl(body.downloadUrl, false) || !validUrl(body.previewUrl, true) ||
      body.previewUrl !== `${body.downloadUrl}?preview=1` ||
      typeof body.name !== "string" || !body.name || typeof body.mime !== "string" || !body.mime ||
      typeof body.bytes !== "number" || !Number.isSafeInteger(body.bytes) || body.bytes < 0) {
    throw new Error(t("attach.downloadFailed"));
  }
  return body as MessageFileLocation;
}

/** Hand an opaque GET to the browser's streaming download implementation.
 * A click means the download started, not that all bytes reached disk. */
export function startMessageFileDownload(url: string, name: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
  }
}

/** Shared save state for transcript file chips and bot-authored file links. */
export interface MessageFolderListing {
  name: string;
  entries: { name: string; bytes: number; mime: string }[];
  truncated: boolean;
}

export function useLocalFileSave(filePath: string, name?: string, message?: MessageAttachmentContext, entry?: string) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [folder, setFolder] = useState<MessageFolderListing | null>(null);
  const [reason, setReason] = useState("");
  const [savedTo, setSavedTo] = useState("");
  // The server refused because the file sits outside the conversation's
  // workspace; the bot link offers Show in folder for that case alone.
  const [outsideWorkspace, setOutsideWorkspace] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  useEffect(() => {
    request.current?.abort();
    request.current = null;
    saving.current = false;
    setReason("");
    setSavedTo("");
    setOutsideWorkspace(false);
    setFolder(null);
    setState("idle");
  }, [filePath, entry, message?.messageId, message?.threadId]);

  const save = useCallback(async () => {
    if (saving.current) return;
    if (!message) {
      setReason(t("attach.unavailableOld"));
      setState("failed");
      return;
    }
    saving.current = true;
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
    setReason("");
    setOutsideWorkspace(false);
    setState("saving");
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      if (entry === undefined) {
        try {
          const location = await requestMessageFileLocation(filePath, message, controller.signal);
          if (!mounted.current || controller.signal.aborted) return;
          const saved = canonicalDownloadFilename({
            fallback: location.name || name || attachmentBasename(filePath),
            source: filePath,
            mime: location.mime,
          });
          startMessageFileDownload(location.downloadUrl, saved);
          if (!mounted.current || controller.signal.aborted) return;
          setSavedTo(saved);
          setState("saved");
          if (resetTimer.current) clearTimeout(resetTimer.current);
          resetTimer.current = setTimeout(() => {
            if (mounted.current) setState("idle");
          }, 4000);
          return;
        } catch (error) {
          // A newer client may still be paired to an older Sagax server.
          // Only that protocol mismatch falls back to its bounded Blob path;
          // current-server authorization and availability failures stay exact.
          const code = (error as { code?: unknown } | null)?.code;
          if (code !== "streaming_location_unavailable" && code !== "directory") throw error;
        }
      }
      const response = await requestMessageFile(filePath, message, controller.signal, entry === undefined ? { list: true } : { entry });
      if (response.headers.get("x-openmausbot-folder") === "1") {
        const listing = await response.json() as MessageFolderListing;
        if (!mounted.current || controller.signal.aborted) return;
        setFolder(listing);
        setState("idle");
        return;
      }
      const blob = await response.blob();
      if (!mounted.current || controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const saved = canonicalDownloadFilename({
        contentDisposition: response.headers.get("content-disposition"),
        fallback: name || entry || attachmentBasename(filePath),
        source: filePath,
        mime: blob.type || response.headers.get("content-type"),
      });
      try {
        startMessageFileDownload(url, saved);
      } finally {
        // Chromium may not consume a blob URL until after the click task ends.
        revokeObjectUrlLater(url);
      }
      if (!mounted.current || controller.signal.aborted) return;
      setSavedTo(saved);
      setState("saved");
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => {
        if (mounted.current) setState("idle");
      }, 4000);
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      setReason(error instanceof Error ? error.message : t("attach.saveFailed"));
      setOutsideWorkspace((error as { code?: unknown } | null)?.code === "outside_workspace");
      setState("failed");
    } finally {
      if (request.current === controller) {
        request.current = null;
        saving.current = false;
      }
    }
  }, [filePath, entry, message?.messageId, message?.threadId, name]);

  return { state, reason, savedTo, outsideWorkspace, folder, save };
}

/** What a failed save says. A file outside the conversation's working folder
 * is refused on every try, so it is explained in the person's language rather
 * than with the server's English, and is not offered as a retry. */
export function saveFailureText(save: { reason: string; outsideWorkspace: boolean }): string {
  return save.outsideWorkspace ? t("attach.outsideWorkspace") : save.reason;
}
