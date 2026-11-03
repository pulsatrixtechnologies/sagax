// The signed-in person's own photo on an organization server (2026-10-16):
//
//   PUT    /api/me/avatar   body: the image bytes (PNG or JPEG, at most
//                          ME_AVATAR_UPLOAD_MAX_BYTES), content-type
//                          image/png or image/jpeg
//   DELETE /api/me/avatar   back to the initials
//
// Both answer 200 `{ ok: true, avatarUrl: string | null }` with the new
// versioned URL this server serves (/api/people/<id>/avatar?v=...). A
// refusal is `{ error, code }`; an expired Perspicax sign-in is 409
// `avatar_sign_in_again`, never 401, so no client takes it for its own
// Sagax session ending.
//
// The photo belongs to Perspicax: Sagax keeps only its version. The route
// writes it there AS THE PERSON: the session's own principal, the live
// sign-in access token of that person (IdpSessionManager.subjectToken), and
// the link token only to say which server calls
// (PerspicaxDirectory.writeOwnAvatar, Perspicax
// PUT/DELETE /api/v1/pulsabot/people/me/avatar). Nothing in the request names
// a person, so nobody can change another person's photo; the link token
// alone opens no person on the Perspicax side either.
//
// The image is made what Perspicax keeps: a 256 px square, PNG or JPEG, at
// most 256 KiB. A client that already cropped to 256 x 256 under the limit
// (the desktop and iPhone apps do) is sent as is; anything else is centre
// cropped and scaled here with resvg (server/data/render.ts loads the same
// native module) into a PNG.
//
// After Perspicax accepts, `applied` stores the new version on the principal,
// drops the cached image, asks the directory again and tells every stream
// (`person.avatar`), so the sidebar, rooms, push frames and the iPhone see
// the new URL at once. A solo server never answers here (PASS): its photo
// stays the local profile.avatarUrl of PUT /api/config.
import type { IncomingMessage } from "node:http";

import type { Resvg as ResvgClass } from "@resvg/resvg-js";

import { nativeRequire } from "../data/engine.ts";
import { AVATAR_MAX_BYTES, avatarContentType, type AvatarImage, type OwnAvatarWrite } from "../perspicax/perspicax-link.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const ME_AVATAR_PATH = "/api/me/avatar";
/** What a client may send before the crop (a phone photo, uncropped). */
export const ME_AVATAR_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
/** The side of the square Perspicax keeps (its console crops to the same). */
export const AVATAR_SIDE = 256;
/** Larger than this on a side is refused before decoding. */
export const AVATAR_INPUT_MAX_SIDE = 12_000;

export interface ImageSize {
  width: number;
  height: number;
}

/** The pixel size a PNG (IHDR) or a JPEG (its first SOFn) declares; null when
 * the header cannot be read. Nothing is decoded. */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  const type = avatarContentType(bytes);
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "image/png") {
    if (bytes.length < 24 || view.toString("latin1", 12, 16) !== "IHDR") return null;
    const width = view.readUInt32BE(16);
    const height = view.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (type === "image/jpeg") {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1]!;
      if (marker === 0xff) { at += 1; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
      const length = view.readUInt16BE(at + 2);
      if (length < 2) return null;
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = view.readUInt16BE(at + 5);
        const width = view.readUInt16BE(at + 7);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      at += 2 + length;
    }
  }
  return null;
}

/** Centre crop and scale to a `side` px square PNG. */
export type SquareRenderer = (image: AvatarImage, side: number) => Buffer;

let resvgModule: { Resvg: typeof ResvgClass } | null = null;
/** resvg (already shipped for chart images) draws the image into a square
 * SVG with `slice`: a centre crop, then a scale, then a PNG. */
export const resvgSquare: SquareRenderer = (image, side) => {
  resvgModule ??= nativeRequire()("@resvg/resvg-js") as { Resvg: typeof ResvgClass };
  const href = `data:${image.contentType};base64,${image.bytes.toString("base64")}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}"><image width="${side}" height="${side}" preserveAspectRatio="xMidYMid slice" href="${href}"/></svg>`;
  return Buffer.from(new resvgModule.Resvg(svg, { fitTo: { mode: "original" } }).render().asPng());
};

export type NormalizedAvatar =
  | { ok: true; image: AvatarImage; resized: boolean }
  | { ok: false; code: "avatar_type" | "avatar_unreadable" | "avatar_too_large" };

/** What Perspicax keeps: a PNG or a JPEG, `AVATAR_SIDE` px square, at most
 * AVATAR_MAX_BYTES. Already so: unchanged. Otherwise cropped and scaled. */
export function normalizeOwnAvatar(bytes: Buffer, render: SquareRenderer = resvgSquare): NormalizedAvatar {
  const contentType = avatarContentType(bytes);
  if (!contentType) return { ok: false, code: "avatar_type" };
  const size = imageSize(bytes);
  if (!size || size.width > AVATAR_INPUT_MAX_SIDE || size.height > AVATAR_INPUT_MAX_SIDE) return { ok: false, code: "avatar_unreadable" };
  if (size.width === AVATAR_SIDE && size.height === AVATAR_SIDE && bytes.length <= AVATAR_MAX_BYTES) {
    return { ok: true, image: { bytes, contentType }, resized: false };
  }
  let out: Buffer;
  try {
    out = render({ bytes, contentType }, AVATAR_SIDE);
  } catch {
    return { ok: false, code: "avatar_unreadable" };
  }
  if (avatarContentType(out) !== "image/png") return { ok: false, code: "avatar_unreadable" };
  if (out.length > AVATAR_MAX_BYTES) return { ok: false, code: "avatar_too_large" };
  return { ok: true, image: { bytes: out, contentType: "image/png" }, resized: true };
}

/** The body as bytes, or null past `max` (the rest is drained, not kept). */
export function readImageBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > max) {
        over = true;
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on("error", reject);
  });
}

export type SubjectTokenResult = { ok: true; token: string } | { ok: false; error: string };

export interface MeAvatarRouteDeps {
  /** An organization server linked to Perspicax. False: PASS (solo). */
  organization(): boolean;
  /** The session's own person with their Perspicax subject, or null (the
   * operator at this computer, a device without a person, a service). */
  person(auth: RequestAuth): { principalId: string; sub: string } | null;
  /** The person's live sign-in access token (never logged). */
  subjectToken(principalId: string): Promise<SubjectTokenResult>;
  /** PerspicaxDirectory.writeOwnAvatar. */
  write(subjectToken: string, image: AvatarImage | null): Promise<OwnAvatarWrite>;
  /** Perspicax accepted: store the version, drop the cache, refresh the
   * directory, tell the streams. Returns the new avatar URL (null: none). */
  applied(change: { principalId: string; sub: string; avatar: string | null }): string | null;
  render?: SquareRenderer;
  log?: (line: string) => void;
}

const ERRORS = {
  avatar_session_only: { status: 403, error: "Only a person signed in with Pulsatrix can change their photo here." },
  avatar_sign_in_again: { status: 409, error: "Your Pulsatrix sign-in has expired. Sign in again, then retry." },
  avatar_type: { status: 415, error: "The photo must be a PNG or a JPEG." },
  avatar_unreadable: { status: 400, error: "This image could not be read." },
  avatar_too_large: { status: 413, error: "This image is too large." },
  avatar_rejected: { status: 400, error: "Perspicax refused this image." },
  avatar_perspicax_outdated: { status: 501, error: "Perspicax must be updated before a photo can be changed from Sagax." },
  avatar_unreachable: { status: 502, error: "Perspicax could not be reached. Try again." },
} as const;
export type MeAvatarErrorCode = keyof typeof ERRORS;

function writeError(result: Extract<OwnAvatarWrite, { ok: false }>): MeAvatarErrorCode {
  switch (result.error) {
    case "subject": return "avatar_sign_in_again";
    case "unsupported": return "avatar_perspicax_outdated";
    case "rejected": return "avatar_rejected";
    default: return "avatar_unreachable";
  }
}

export function createMeAvatarRoutes(deps: MeAvatarRouteDeps): RouteHandler {
  const log = deps.log ?? ((line: string) => console.log(line));
  return async ({ req, res, path, method, auth, json }) => {
    if (path !== ME_AVATAR_PATH || (method !== "PUT" && method !== "DELETE")) return PASS;
    if (!deps.organization()) return PASS;
    const fail = (code: MeAvatarErrorCode) => {
      res.setHeader("cache-control", "no-store");
      return json(res, ERRORS[code].status, { error: ERRORS[code].error, code });
    };
    const person = deps.person(auth);
    if (!person) return fail("avatar_session_only");
    let image: AvatarImage | null = null;
    if (method === "PUT") {
      const raw = await readImageBody(req, ME_AVATAR_UPLOAD_MAX_BYTES).catch(() => undefined);
      if (raw === undefined) return fail("avatar_unreadable");
      if (raw === null) return fail("avatar_too_large");
      const normalized = normalizeOwnAvatar(raw, deps.render);
      if (!normalized.ok) return fail(normalized.code);
      image = normalized.image;
    }
    const subject = await deps.subjectToken(person.principalId);
    if (!subject.ok) return fail("avatar_sign_in_again");
    const written = await deps.write(subject.token, image);
    if (!written.ok) {
      const code = writeError(written);
      log(`perspicax: own avatar ${method === "PUT" ? "upload" : "removal"} refused (${written.error}${written.status ? ` ${written.status}` : ""})`);
      return fail(code);
    }
    const avatarUrl = deps.applied({ principalId: person.principalId, sub: person.sub, avatar: written.avatar });
    res.setHeader("cache-control", "no-store");
    return json(res, 200, { ok: true, avatarUrl });
  };
}
