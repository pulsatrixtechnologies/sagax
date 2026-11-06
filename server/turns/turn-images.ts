// Turn-local image admission.
//
// Composer messages persist a standalone <attached-image> transport tag so
// every client can render the attachment later. Providers should not have to
// discover that image through a filesystem tool (and an approval round trip),
// so this module turns only app-owned tags from the CURRENT message into the
// structured image input each native protocol understands.
//
// Composer video attachments use the generic <attached-file> tag (the same one
// documents and audio use); only its path decides whether it resolves to a
// video. Sampled frames add native image input; the video's tag stays in text
// so engines that read files still get its path.
import { lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

import { fromMarkdown } from "mdast-util-from-markdown";

import { ATTACHMENTS_DIR, IMAGE_AGGREGATE_MAX_BYTES, imageMaxBytes, MESSAGE_IMAGE_MAX_COUNT, VIDEO_MAX_BYTES } from "../attachments/attachments.ts";
import { atRestSizeSync } from "../encryption/content-at-rest.ts";
import type { TurnImageInput, TurnVideoInput } from "../contracts.ts";
import { decodeAttachmentAttribute } from "../messages/message-file.ts";
import { videoFrameImages } from "./turn-video.ts";

/** Matches the web and native composer policy: up to 32 pictures sharing
 * 200 MiB of stored bytes on every host. What a provider ingests is the
 * scaled copy that server/models/model-image.ts makes, each within the model's
 * per-image limit. */
export const TURN_IMAGE_MAX_COUNT = MESSAGE_IMAGE_MAX_COUNT;
export const TURN_IMAGE_MAX_BYTES = IMAGE_AGGREGATE_MAX_BYTES;
// A video is sampled into several frames before it reaches a model, so only the first one in a message is sampled.
export const TURN_VIDEO_MAX_COUNT = 1;

type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
};

type TagCandidate = { start: number; end: number; kind: "image" | "file"; path: string };

const OWNED_IMAGE_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;
const OWNED_VIDEO_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(mp4|webm|mov)$/;
const ATTACHMENT_TAG =
  /^<attached-(image|file)[\t ]+path="([^"\r\n]*)"(?:[\t ]+name="([^"\r\n]*)")?[\t ]*\/>$/;

const MIME_BY_EXTENSION: Readonly<Record<string, TurnImageInput["mime"]>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const VIDEO_MIME_BY_EXTENSION: Readonly<Record<string, TurnVideoInput["mime"]>> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

function statusError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop()!;
    visit(current);
    const children = current.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]!);
  }
}

/** Find only exact, standalone HTML transport tags. mdast keeps examples in
 * code fences/code spans out of HTML nodes; the line boundary check keeps
 * prose containing a tag literal from becoming an attachment capability. */
function attachmentTagCandidates(text: string): TagCandidate[] {
  const candidates: TagCandidate[] = [];
  walk(fromMarkdown(text) as MarkdownNode, (node) => {
    if (node.type !== "html" || !node.value || !node.position) return;
    const start = node.position.start.offset;
    const end = node.position.end.offset;
    if (start === undefined || end === undefined) return;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const nextLine = text.indexOf("\n", end);
    const lineEnd = nextLine < 0 ? text.length : nextLine;
    if (text.slice(lineStart, start).trim() || text.slice(end, lineEnd).trim()) return;
    const match = ATTACHMENT_TAG.exec(node.value);
    if (!match) return;
    candidates.push({ start, end, kind: match[1] === "file" ? "file" : "image", path: decodeAttachmentAttribute(match[2]!) });
  });
  return candidates;
}

function ownedAttachment<Mime extends string>(
  path: string,
  attachmentsDir: string,
  nameFormat: RegExp,
  mimeByExtension: Readonly<Record<string, Mime>>,
  maxBytes: number,
): { path: string; mime: Mime; bytes: number } | null {
  if (!path || path.includes("\0")) return null;
  const name = path.split(/[\\/]/).at(-1) ?? "";
  if (!nameFormat.test(name)) return null;

  // The composer receives and returns the exact server-generated path. A
  // basename match alone would let an arbitrary /tmp/<uuid>.ext masquerade
  // as an app attachment, so the lexical path must point into this store too.
  const expected = resolve(attachmentsDir, name);
  if (resolve(path) !== expected) return null;

  try {
    const entry = lstatSync(expected);
    if (!entry.isFile() || entry.isSymbolicLink()) return null;
    // its plaintext size: a stored attachment may be sealed at rest (server/encryption/content-at-rest.ts)
    const bytes = entry.size < 5 ? entry.size : atRestSizeSync(expected);
    if (bytes <= 0 || bytes > maxBytes) return null;
    const canonicalRoot = realpathSync(attachmentsDir);
    const canonicalFile = realpathSync(expected);
    if (dirname(canonicalFile) !== canonicalRoot) return null;
    const finalEntry = statSync(canonicalFile);
    if (!finalEntry.isFile() || finalEntry.size !== entry.size) return null;
    const mime = mimeByExtension[extname(name)];
    return mime ? { path: expected, mime, bytes } : null;
  } catch {
    return null;
  }
}

const ownedImage = (path: string, attachmentsDir: string): TurnImageInput | null =>
  ownedAttachment(path, attachmentsDir, OWNED_IMAGE_NAME, MIME_BY_EXTENSION, imageMaxBytes());
const ownedVideo = (path: string, attachmentsDir: string): TurnVideoInput | null =>
  ownedAttachment(path, attachmentsDir, OWNED_VIDEO_NAME, VIDEO_MIME_BY_EXTENSION, VIDEO_MAX_BYTES);

export interface ExtractTurnImagesOptions {
  /** Injectable only so focused tests never touch the user's data store. */
  attachmentsDir?: string;
  maxCount?: number;
  maxBytes?: number;
  maxVideoCount?: number;
}

/** Resolve and remove trusted image tags from provider-facing text. The
 * caller continues to persist the original string unchanged. Invalid tags
 * stay visible as ordinary text and never turn into native image input.
 * A video's <attached-file> tag always stays in the text, so an engine that
 * reads files still gets its path; sampled frames only add to it. */
export function extractTurnImages(
  text: string,
  options: ExtractTurnImagesOptions = {},
): { text: string; images: TurnImageInput[]; videos: TurnVideoInput[] } {
  // Almost every turn is plain text. Skipping the Markdown tree for those
  // turns keeps image transport work out of the hot send path.
  if (!text.includes("<attached-image") && !text.includes("<attached-file")) {
    return { text, images: [], videos: [] };
  }

  const attachmentsDir = options.attachmentsDir ?? ATTACHMENTS_DIR;
  const maxCount = options.maxCount ?? TURN_IMAGE_MAX_COUNT;
  // Per-picture ceilings stay host-specific (attachments.ts imageMaxBytes);
  // the message aggregate is the same on a shared or solo host.
  const maxBytes = options.maxBytes ?? TURN_IMAGE_MAX_BYTES;
  const maxVideoCount = options.maxVideoCount ?? TURN_VIDEO_MAX_COUNT;
  const candidates = attachmentTagCandidates(text);

  const admittedImages = candidates
    .filter((tag) => tag.kind === "image")
    .map((tag) => ({ tag, image: ownedImage(tag.path, attachmentsDir) }))
    .filter((item): item is { tag: TagCandidate; image: TurnImageInput } => item.image !== null);

  if (admittedImages.length > maxCount) {
    throw statusError(413, `Send no more than ${maxCount} images at a time`);
  }
  const aggregateBytes = admittedImages.reduce((total, item) => total + item.image.bytes, 0);
  if (aggregateBytes > maxBytes) {
    throw statusError(413, `Attached images exceed ${Math.floor(maxBytes / (1024 * 1024))} MB total`);
  }

  const videos = candidates
    .filter((tag) => tag.kind === "file")
    .map((tag) => ownedVideo(tag.path, attachmentsDir))
    .filter((video): video is TurnVideoInput => video !== null)
    .slice(0, maxVideoCount);

  let providerText = text;
  const removedTags = admittedImages.map((item) => item.tag).sort((a, b) => b.start - a.start);
  for (const tag of removedTags) providerText = providerText.slice(0, tag.start) + providerText.slice(tag.end);

  return { text: providerText, images: admittedImages.map((item) => item.image), videos };
}

/** Stills sampled from a message's video, never taking a turn that already carries `earlier` images past its image count. */
export function videoFramesWithin(earlier: number, videos: readonly TurnVideoInput[]): Promise<TurnImageInput[]> {
  return videoFrameImages(videos, TURN_IMAGE_MAX_COUNT - earlier);
}

/** The words of one steer — a queued burst, or a single live send — split
 * into provider-facing texts and the native images they carry. Each text is
 * resolved on its own, exactly as the turn it would have started; the images
 * keep their order. Null when the attachments cannot ride one turn together
 * (too many, too large): those words wait for real turns instead, so a steer
 * is never where an admitted picture gets refused. */
export function extractSteerImages(
  texts: readonly string[],
  options: ExtractTurnImagesOptions = {},
): { texts: string[]; images: TurnImageInput[] } | null {
  const maxCount = options.maxCount ?? TURN_IMAGE_MAX_COUNT;
  const maxBytes = options.maxBytes ?? TURN_IMAGE_MAX_BYTES;
  const resolved: string[] = [];
  const images: TurnImageInput[] = [];
  try {
    for (const text of texts) {
      const item = extractTurnImages(text, options);
      resolved.push(item.text);
      images.push(...item.images);
    }
  } catch {
    return null;
  }
  if (images.length > maxCount) return null;
  if (images.reduce((total, image) => total + image.bytes, 0) > maxBytes) return null;
  return { texts: resolved, images };
}
