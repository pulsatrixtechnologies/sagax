// The owner of a personal computer, as their organization knows them.
//
// A personal Sagax (SAGAX_IDENTITY solo) has no Perspicax link of its own.
// When the desktop app on this computer is signed in to an organization
// server, Electron's main process reads who it is signed in as there
// (`GET <org>/api/auth/session` and the avatar that session names, with the
// app's own organization cookie, which never leaves main) and hands it over
// the private utility-parent port (`openmausbot:owner-identity`). Nothing
// here holds a credential: only the person's name, address, the avatar's
// version and its bytes, kept in DATA_DIR/owner-identity.json so a restart
// offline still shows them. `identity: null` (signed out, the server
// forgotten) removes them.
//
// This server then answers like an organization server does for that one
// person: `GET /api/auth/session` names the avatar at
// `/api/people/<operator principal>/avatar?v=<version>`, and that route serves
// the bytes (the phone, through the companion sidecar, reads it there).
import { existsSync, readFileSync, rmSync } from "node:fs";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { avatarContentType, AVATAR_MAX_BYTES } from "./perspicax/perspicax-link.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export const OWNER_IDENTITY_MESSAGE = "openmausbot:owner-identity";
const VERSION = /^[0-9A-Za-z_-]{1,64}$/;

export interface OwnerIdentity {
  /** The organization server the desktop is signed in to. */
  origin: string;
  /** The person's principal there (informational). */
  principalId: string;
  name?: string;
  email?: string;
  avatar?: { version: string; contentType: "image/png" | "image/jpeg"; bytes: Buffer };
}

const text = (max: number) => z.string().trim().min(1).max(max).optional().catch(undefined);
const wireSchema = z.object({
  origin: z.string().max(2048).refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
    } catch {
      return false;
    }
  }),
  principalId: z.string().regex(/^[\w-]{1,80}$/),
  name: text(200),
  email: z.string().trim().email().max(320).optional().catch(undefined),
  avatar: z.object({
    version: z.string().regex(VERSION),
    data: z.string().max(Math.ceil((AVATAR_MAX_BYTES * 4) / 3) + 8),
  }).optional(),
});

/** Read a private parent message. `undefined` when it is another message;
 * throws on a malformed owner identity (nothing is changed then). */
export function parseOwnerIdentityMessage(raw: unknown): { identity: OwnerIdentity | null } | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const message = raw as Record<string, unknown>;
  if (message.type !== OWNER_IDENTITY_MESSAGE) return undefined;
  if (message.identity === null) return { identity: null };
  return { identity: fromWire(message.identity) };
}

function fromWire(value: unknown): OwnerIdentity {
  const parsed = wireSchema.safeParse(value);
  if (!parsed.success) throw new Error("invalid owner identity");
  const { origin, principalId, name, email, avatar } = parsed.data;
  const identity: OwnerIdentity = { origin, principalId, ...(name ? { name } : {}), ...(email ? { email } : {}) };
  if (avatar) {
    const bytes = Buffer.from(avatar.data, "base64");
    const contentType = avatarContentType(bytes);
    if (!contentType || bytes.length > AVATAR_MAX_BYTES) throw new Error("invalid owner avatar");
    identity.avatar = { version: avatar.version, contentType, bytes };
  }
  return identity;
}

function toWire(identity: OwnerIdentity): Record<string, unknown> {
  const { avatar, ...rest } = identity;
  return { ...rest, ...(avatar ? { avatar: { version: avatar.version, data: avatar.bytes.toString("base64") } } : {}) };
}

/** The owner's identity, in memory and in its file. */
export class OwnerIdentityStore {
  private identity: OwnerIdentity | null = null;
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
    try {
      if (existsSync(file)) this.identity = fromWire(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      this.identity = null; // a damaged file reads as signed out
    }
  }

  get(): OwnerIdentity | null {
    return this.identity;
  }

  set(identity: OwnerIdentity | null): void {
    this.identity = identity;
    if (identity) writeFileAtomic(this.file, `${JSON.stringify(toWire(identity))}\n`, { mode: 0o600 });
    else rmSync(this.file, { force: true });
  }

  /** The versioned URL this server serves the owner's avatar at. */
  avatarUrl(localPrincipalId: string): string | undefined {
    const version = this.identity?.avatar?.version;
    return version ? `/api/people/${encodeURIComponent(localPrincipalId)}/avatar?v=${encodeURIComponent(version)}` : undefined;
  }

  /** What GET /api/auth/session adds for the owner: their organization name
   * and address, and the avatar URL. Empty when the desktop is not signed in. */
  sessionFields(localPrincipalId: string): { name?: string; email?: string; avatarUrl?: string } {
    const identity = this.identity;
    if (!identity) return {};
    const avatarUrl = this.avatarUrl(localPrincipalId);
    return {
      ...(identity.name ? { name: identity.name } : {}),
      ...(identity.email ? { email: identity.email } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    };
  }
}

/** GET /api/people/<operator>/avatar on a personal server: the owner's
 * organization avatar, with the same headers an organization server sends.
 * Any other person, or no avatar, is 404. */
export function createOwnerAvatarRoute(deps: { store: OwnerIdentityStore; localPrincipalId: () => string }): RouteHandler {
  return async ({ res, url, path, method, json }) => {
    const match = /^\/api\/people\/([\w-]{1,80})\/avatar$/.exec(path);
    if (!match || method !== "GET") return PASS;
    const avatar = deps.store.get()?.avatar;
    if (match[1] !== deps.localPrincipalId() || !avatar) return json(res, 404, { error: "no avatar" });
    res.writeHead(200, {
      "content-type": avatar.contentType,
      "content-length": String(avatar.bytes.length),
      "x-content-type-options": "nosniff",
      "cache-control": url.searchParams.get("v") === avatar.version ? "private, max-age=86400" : "no-store",
    });
    res.end(avatar.bytes);
  };
}
