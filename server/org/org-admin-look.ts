// What a bot wears and how it presents itself, for the Perspicax console's
// bot gallery (organization admin API, `GET bots`, `GET bots/{id}` and `GET
// bots/{id}/avatar`). The console draws the mascot itself from `look`, so
// this names the character, its family, color, skin and shape exactly as the
// app resolves them (src/components/Avatar.tsx: an uploaded picture shows
// only when its crop is not `mascot`, else the character), never a file path.
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";

import { openIfSealed } from "../encryption/content-at-rest.ts";

import { botAvatarProfile, clampAvatarFocus, clampAvatarZoom } from "../../shared/bot-avatar.ts";
import { MASCOT_FAMILY_OF, type MascotCatalogFamily } from "../../shared/mascot-catalog.ts";
import { MASCOT_COLOR_HEX, type MascotColorName } from "../../shared/mascot-colors.ts";
import { completeMascotLook, mascotLookSchema, type MascotCharacter } from "../../shared/mascot-look.ts";
import { botMascotSkin } from "../../shared/mascot-skins.ts";

/** The largest avatar the console route serves: the image attachment cap. */
export const BOT_AVATAR_MAX_BYTES = 10 * 1024 * 1024;
/** A persona description longer than this is cut (the field takes 4,000). */
export const PERSONA_DESCRIPTION_MAX = 500;

/** What the console draws for a bot. */
export interface AdminBotLook {
  /** `image`: the bot's uploaded picture (`GET bots/{id}/avatar`);
   * `mascot`: a character the owner chose; `default`: the owl in the bot's
   * color, as every bot wore before it picked anything. */
  kind: "image" | "mascot" | "default";
  /** The character (shown for `mascot` and `default`, and where the picture
   * fails to load for `image`). */
  character: MascotCharacter;
  family: MascotCatalogFamily;
  /** The bot's color name and its value. */
  color: string;
  colorHex: string | null;
  /** The character's skin: the owl's `mascotSkin`, else its own skin. */
  skin: string;
  /** The shape character's shape, else null. */
  shape: string | null;
  /** The face the owl rests on, when the owner picked one. */
  expression: string | null;
  image: AdminBotImage | null;
}

export interface AdminBotImage {
  crop: "circle" | "rounded" | "square";
  zoom: number;
  focusX: number;
  focusY: number;
  /** Changes when the picture changes: the avatar route's ETag. */
  version: string;
  type: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
}

/** The persona window's facts, when the bot has them. */
export interface AdminBotPersona {
  displayName: string;
  /** The role or tagline under the name. */
  title: string | null;
  /** The short description, at most 500 characters. */
  description: string | null;
  descriptionTruncated?: true;
}

/** The fields of a stored bot this reads. */
export interface LookSource {
  name: string;
  title?: string;
  description?: string;
  color: string;
  mascotSkin?: unknown;
  mascotLook?: unknown;
  mascotExpression?: string | null;
  avatarUrl?: string | null;
  avatarCrop?: unknown;
  avatarZoom?: unknown;
  avatarFocusX?: unknown;
  avatarFocusY?: unknown;
}

const IMAGE_TYPES: Record<string, AdminBotImage["type"]> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const AVATAR_FILE = /^[A-Za-z0-9-]+\.(png|jpg|gif|webp)$/;

/** The attachment file name behind a stored avatar URL, or null. */
export function avatarFileName(bot: Pick<LookSource, "avatarUrl" | "avatarCrop">): string | null {
  const profile = botAvatarProfile(bot);
  if (!profile.avatarUrl) return null;
  const name = profile.avatarUrl.slice("/api/attachments/".length);
  return AVATAR_FILE.test(name) ? name : null;
}

/** An attachment is never rewritten under its name, so the name is the version. */
export const avatarVersion = (fileName: string) => createHash("sha256").update(fileName).digest("hex").slice(0, 16);

/** The bot's look. `avatarExists` says whether its picture file is there. */
export function botLook(bot: LookSource, avatarExists: (fileName: string) => boolean): AdminBotLook {
  const complete = completeMascotLook(bot.mascotLook);
  const character = complete.character;
  const skin = character === "owl" ? botMascotSkin(bot.mascotSkin) : complete.skins[character];
  const color = typeof bot.color === "string" ? bot.color : "green";
  const chose = mascotLookSchema.safeParse(bot.mascotLook).success || skin !== "none";
  const base = {
    character,
    family: MASCOT_FAMILY_OF[character],
    color,
    colorHex: Object.hasOwn(MASCOT_COLOR_HEX, color) ? MASCOT_COLOR_HEX[color as MascotColorName] : null,
    skin,
    shape: character === "shape" ? complete.shape : null,
    expression: typeof bot.mascotExpression === "string" && bot.mascotExpression ? bot.mascotExpression.slice(0, 40) : null,
  };
  const profile = botAvatarProfile(bot);
  const file = avatarFileName(bot);
  if (file && profile.avatarCrop !== "mascot" && avatarExists(file)) {
    return {
      kind: "image",
      ...base,
      image: {
        crop: profile.avatarCrop,
        zoom: clampAvatarZoom(bot.avatarZoom ?? 1),
        focusX: clampAvatarFocus(bot.avatarFocusX ?? 0.5),
        focusY: clampAvatarFocus(bot.avatarFocusY ?? 0.5),
        version: avatarVersion(file),
        type: IMAGE_TYPES[file.split(".").pop()!]!,
      },
    };
  }
  return { kind: chose ? "mascot" : "default", ...base, image: null };
}

/** The persona: its name, role and short description. */
export function botPersona(bot: Pick<LookSource, "name" | "title" | "description">): AdminBotPersona {
  const title = typeof bot.title === "string" ? bot.title.trim() : "";
  const description = typeof bot.description === "string" ? bot.description.trim() : "";
  const cut = description.length > PERSONA_DESCRIPTION_MAX;
  return {
    displayName: bot.name,
    title: title || null,
    description: description ? (cut ? description.slice(0, PERSONA_DESCRIPTION_MAX).trimEnd() : description) : null,
    ...(cut ? { descriptionTruncated: true as const } : {}),
  };
}

/** The bot's picture as the avatar route serves it: its bytes, type and
 * version, null without one (no picture, a mascot crop, a missing file, a
 * link). `too_large` past the cap. Opened without following a link. */
export function readBotAvatar(bot: LookSource, attachmentsDir: string, maxBytes = BOT_AVATAR_MAX_BYTES): { bytes: Buffer; type: AdminBotImage["type"]; version: string } | "too_large" | null {
  const file = avatarFileName(bot);
  if (!file || botAvatarProfile(bot).avatarCrop === "mascot") return null;
  let fd: number;
  try {
    const path = join(attachmentsDir, file);
    // O_NOFOLLOW refuses a link at open where there is one; Windows has none
    // (and opens what a link points at), so the entry is looked at first too.
    if (process.platform === "win32" && !lstatSync(path).isFile()) return null;
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return null;
    if (stat.size > maxBytes) return "too_large";
    const bytes = Buffer.alloc(stat.size);
    let read = 0;
    while (read < stat.size) {
      const got = readSync(fd, bytes, read, stat.size - read, read);
      if (got <= 0) break;
      read += got;
    }
    // a stored picture sealed at rest opens here (server/encryption/content-at-rest.ts)
    let plain: Buffer;
    try { plain = openIfSealed(bytes.subarray(0, read), join(attachmentsDir, file)); } catch { return null; }
    return { bytes: plain, type: IMAGE_TYPES[file.split(".").pop()!]!, version: avatarVersion(file) };
  } finally {
    closeSync(fd);
  }
}
