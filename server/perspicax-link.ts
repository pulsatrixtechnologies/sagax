// The link between this organization server and its Perspicax (slice 3).
//
// Perspicax writes a small JSON file when it links this server (at boot, or
// when an admin rotates the link in its console): the issuer, the client id,
// this server's id in Perspicax, this server's public origin, and a link
// token (`pxat1.`) that opens only the directory. Pulsa Bot reads it here,
// refuses anything that does not match its own configuration, and never
// logs the token.
//
// The directory (GET /api/v1/pulsabot/directory) lists the organization's
// people and teams. Polling it keeps the principals current: a person can be
// chosen before their first sign-in, a demotion narrows live sessions at
// once, and a disabled or deleted person is logged out even when the
// back-channel push never arrived (T8).
//
// Spec: docs/superpowers/specs/2026-09-29-perspicax-multiuser-design.md,
// sections 5 and 6 (link file, directory), 9 (T5).
import { createHash, timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { z } from "zod";

import { normalizePermissions, type PermissionKey } from "../shared/permissions.ts";
import type { Principal } from "./principals.ts";

export const LINK_FILE_MAX_BYTES = 4 * 1024;
export const DIRECTORY_MAX_BYTES = 4 * 1024 * 1024;
export const DIRECTORY_TIMEOUT_MS = 10_000;
export const DIRECTORY_PATH = "/api/v1/pulsabot/directory";
const LINK_TOKEN = /^pxat1\.[A-Za-z0-9_-]{20,200}$/;
const SERVER_ID = /^[0-9a-z]{1,64}$/;
const LINK_KEYS = ["client_id", "issuer", "link_token", "origin", "server_id", "version"];

export interface LinkExpectation {
  /** SAGAX_PERSPICAX_ISSUER, as configured. */
  issuer: string;
  /** SAGAX_PUBLIC_URL, this server's public origin. */
  publicOrigin: string;
  /** The OIDC client id (SAGAX_OIDC_CLIENT_ID, default pulsa-bot). */
  clientId: string;
}

export interface PerspicaxLink {
  issuer: string;
  clientId: string;
  serverId: string;
  origin: string;
  linkToken: string;
  mtimeMs: number;
}

export type LinkFileRead =
  | { ok: true; link: PerspicaxLink }
  | { ok: false; code: "missing" | "not_a_file" | "mode" | "size" | "json" | "fields" | "mismatch"; reason: string };

const originOf = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};
const trimSlash = (value: string) => value.trim().replace(/\/+$/, "");

/** Read and check the link file. Refused: anything but a regular file, any
 * permission bit for "other" users, more than 4 KiB, keys other than the six
 * of the contract, or fields that do not match this server. */
export function readLinkFile(path: string, expect: LinkExpectation): LinkFileRead {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT"
      ? { ok: false, code: "missing", reason: "the link file does not exist yet" }
      : { ok: false, code: "not_a_file", reason: `the link file cannot be read (${code ?? "error"})` };
  }
  if (!stat.isFile()) return { ok: false, code: "not_a_file", reason: "the link file is not a regular file" };
  // Windows reports no POSIX permission bits (every file reads as 0666): the ACL of the folder guards the file there
  if (process.platform !== "win32" && (stat.mode & 0o007) !== 0) return { ok: false, code: "mode", reason: "the link file is readable by other users; make it 0640 or 0600" };
  if (stat.size > LINK_FILE_MAX_BYTES) return { ok: false, code: "size", reason: "the link file is larger than 4 KiB" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { ok: false, code: "json", reason: "the link file is not JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, code: "json", reason: "the link file is not a JSON object" };
  const doc = parsed as Record<string, unknown>;
  if (Object.keys(doc).sort().join(",") !== LINK_KEYS.join(",")) return { ok: false, code: "fields", reason: "the link file must hold exactly version, issuer, client_id, server_id, origin and link_token" };
  if (doc.version !== 1) return { ok: false, code: "fields", reason: "the link file version is not 1" };
  if (typeof doc.issuer !== "string" || typeof doc.client_id !== "string" || typeof doc.server_id !== "string" || typeof doc.origin !== "string" || typeof doc.link_token !== "string") {
    return { ok: false, code: "fields", reason: "a link file field is not a string" };
  }
  if (!SERVER_ID.test(doc.server_id)) return { ok: false, code: "fields", reason: "the link file server_id is not an id" };
  if (!LINK_TOKEN.test(doc.link_token)) return { ok: false, code: "fields", reason: "the link file token is not a Perspicax link token" };
  if (trimSlash(doc.issuer) !== trimSlash(expect.issuer)) return { ok: false, code: "mismatch", reason: "the link file names another Perspicax (issuer)" };
  if (doc.client_id !== expect.clientId) return { ok: false, code: "mismatch", reason: "the link file names another client id" };
  if (!originOf(doc.origin) || originOf(doc.origin) !== originOf(expect.publicOrigin)) return { ok: false, code: "mismatch", reason: "the link file names another Pulsa Bot origin" };
  return { ok: true, link: { issuer: doc.issuer, clientId: doc.client_id, serverId: doc.server_id, origin: doc.origin, linkToken: doc.link_token, mtimeMs: stat.mtimeMs } };
}

const personSchema = z.object({
  sub: z.string().min(1).max(255),
  login: z.string().max(200),
  name: z.string().max(200),
  email: z.string().max(320).nullable(),
  role: z.enum(["admin", "manager", "employee"]),
  status: z.enum(["active", "disabled"]),
  /** Perspicax's user type (`person` or `service`); absent from an older
   * Perspicax, which lists people only. */
  kind: z.enum(["person", "service"]).optional(),
  type: z.enum(["person", "service"]).optional(),
  locale: z.string().max(40).nullable().optional(),
  /** Slice 4: which model providers this person keeps a key for in
   * Perspicax (names only, never a key). */
  provider_keys: z.array(z.string().max(80)).optional(),
  /** Slice 5: the Perspicax MCP profiles this person holds (directly or
   * through a team), by id. */
  profiles: z.array(z.string().min(1).max(64)).max(1_000).optional(),
  /** Slice 6: this person's routine delegation for this server (null: none,
   * or the person is disabled; absent: an older Perspicax, unknown). */
  /** The version of the person's avatar (opaque, changes with the image),
   * null when they have none; absent from a Perspicax that does not send
   * avatars yet. The image is GET AVATAR_PATH with the link token. */
  avatar: z.string().regex(/^[0-9A-Za-z_-]{1,64}$/).nullable().optional().catch(undefined),
  /** Perspicax 1.8.6: whether an admin lets this person create and manage
   * their own Sagax bots (`manage`, the default) or only use the bots
   * shared with them (`use`). Absent from an older Perspicax: manage. */
  sagax_bots: z.enum(["manage", "use"]).optional().catch(undefined),
  // `sagax_integrations` (Perspicax migration 0046) is no longer read
  // (2026-10-30): an older Perspicax may still send it, and it is dropped
  // here. The Sagax permission `apps.ownIntegrations` is the only rule.
  /** Perspicax migration 0063 (2026-10-16): the engine instance ids this
   * person may run on the accounts the organization provides (the org key
   * of Settings > Connections). [] = none, the default for every member.
   * Absent from an older Perspicax: none too (serverEngines). `*` gives
   * every engine (the admin API may send it; the console does not offer it). */
  sagax_server_engines: z.array(z.string().regex(/^(?:\*|[A-Za-z0-9_-]{1,80})$/)).max(100).optional().catch(undefined),
  /** 2026-10-09: the person's effective Sagax permissions (computed by
   * Perspicax: the union of its default permission set, the sets given to
   * the person and the sets of their teams, since Perspicax 0051; every key
   * for an admin). Perspicax also sends `sagax_permission_sets` (the set
   * names, display only), dropped here.
   * Absent or null from an older Perspicax, or before it read this server's
   * catalogue: the member defaults apply (shared/permissions.ts). Unknown
   * keys are ignored with a log, never fatal. */
  permissions: z.array(z.string().max(64)).max(1_000).nullable().optional().catch(undefined),
  routine_delegation: z.object({
    consented_at: z.string().max(40),
    renewed_at: z.string().max(40),
    expires_at: z.string().max(40),
  }).nullable().optional(),
});
const profileSchema = z.object({
  id: z.string().min(1).max(64),
  slug: z.string().max(128),
  name: z.string().max(200),
  description: z.string().max(2_000),
  /** 2026-10-09: the Sagax permissions this profile grants, for display
   * (null or absent: unknown, an older Perspicax). Null from Perspicax 0051
   * on: permissions come from permission sets, not profiles. */
  sagax_permissions: z.array(z.string().max(64)).max(1_000).nullable().optional().catch(undefined),
});
const teamSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  managers: z.array(z.string().max(255)).max(100_000),
  members: z.array(z.string().max(255)).max(100_000),
});
const FLOW_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FLOW_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/;
/** Perspicax 2026-10-19 (its flow_marketplace.rs): Pulsatrix Flow for every
 * member, from the private marketplace Perspicax serves behind each person's
 * identity (server/org-flow-plugins.ts). Names, versions, the manifest URL
 * and the token audience only, never a secret. */
export const flowPluginsSchema = z.object({
  enabled: z.boolean(),
  /** Perspicax 2026-10-26: `enforce` while its Flow server guard runs the
   * pack's own hook on every write a member can make. Anything else, or
   * absent, and Sagax installs nothing (server/org-flow-plugins.ts). */
  guard: z.string().max(32).optional(),
  /** Why Perspicax holds the install back (`flow_guard_not_enforced`, ...). */
  reason: z.string().max(64).optional(),
  name: z.string().regex(FLOW_NAME),
  url: z.string().url().max(2048),
  resource: z.string().url().max(2048),
  pack: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
  plugins: z.array(z.object({ name: z.string().regex(FLOW_NAME), version: z.string().regex(FLOW_VERSION), tenant: z.boolean() })).max(10),
});
export type FlowPluginsDeclaration = z.infer<typeof flowPluginsSchema>;

/** Capabilities lot 4 (Perspicax `px-sagax/src/capabilities.rs`): the
 * organization's capability declarations, carried with their execution
 * configuration on this authenticated channel only. Perspicax checks every
 * rule; these schemas only keep a malformed element out, one at a time. */
const MOUNT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const stringRecord = (max: number) => z.record(z.string().max(128), z.string().max(max));
export const capabilitySourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }),
  z.object({ kind: z.literal("marketplace"), url: z.string().url().max(2048), plugin: z.string().regex(MOUNT_NAME), version: z.string().max(64).nullable().optional() }),
]);
export const capabilityConfigurationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("plugin"), values: z.record(z.string().max(128), z.union([z.string().max(8192), z.number(), z.boolean()])).optional() }),
  z.object({ type: z.literal("skill"), files: z.record(z.string().max(256), z.string()) }),
  z.object({ type: z.literal("stdio"), command: z.string().min(1).max(4096), args: z.array(z.string().max(4096)).max(256).default([]), env: stringRecord(8192).default({}) }),
  z.object({ type: z.literal("http"), url: z.string().url().max(2048), headers: stringRecord(8192).default({}) }),
]);
export const orgCapabilitySchema = z.object({
  id: z.string().min(1).max(128),
  mount_name: z.string().regex(MOUNT_NAME),
  form: z.enum(["plugin", "skill", "mcp"]),
  name: z.string().max(120),
  description: z.string().max(2000).default(""),
  source: capabilitySourceSchema,
  scope: z.string().max(32).optional(),
  mode: z.enum(["offered", "imposed"]),
  enabled: z.boolean(),
  configured: z.boolean().optional(),
  configuration_kind: z.enum(["plugin", "skill", "stdio", "http"]).optional(),
  created_at: z.string().max(64).optional(),
  updated_at: z.string().max(64).optional(),
  /** Only on the linked server's directory; never logged nor sent to a browser. */
  configuration: capabilityConfigurationSchema.optional(),
});
export type OrgCapabilityDeclaration = z.infer<typeof orgCapabilitySchema>;
export const capabilityMarketplaceSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().max(64),
  source: z.string().min(1).max(2048),
  enabled: z.boolean(),
  created_at: z.string().max(64).optional(),
  updated_at: z.string().max(64).optional(),
});
export type CapabilityMarketplace = z.infer<typeof capabilityMarketplaceSchema>;
export const capabilityMarketplacePolicySchema = z.object({ mode: z.enum(["any", "list"]) });
export type CapabilityMarketplacePolicy = z.infer<typeof capabilityMarketplacePolicySchema>;
/** An array whose malformed elements are dropped one by one (a newer
 * Perspicax may add a form this server does not know). Not an array: absent. */
function tolerantArray<T extends z.ZodTypeAny>(item: T, max: number) {
  return z.array(z.unknown()).max(max).transform((rows) => rows.flatMap((row) => {
    const parsed = item.safeParse(row);
    return parsed.success ? [parsed.data as z.infer<T>] : [];
  })).optional().catch(undefined);
}

export const directorySchema = z.object({
  server_id: z.string().min(1).max(64),
  people: z.array(personSchema).max(100_000),
  teams: z.array(teamSchema).max(100_000),
  /** Slice 5: every MCP profile of the organization (catalog). */
  profiles: z.array(profileSchema).max(10_000).optional(),
  /** Absent from an older Perspicax; malformed is read as absent. */
  flow_plugins: flowPluginsSchema.optional().catch(undefined),
  /** Capabilities lot 4. Absent from an older Perspicax: today's behaviour
   * (no organization declaration, historical marketplace rules). */
  capabilities: tolerantArray(orgCapabilitySchema, 1_000),
  capability_marketplaces: tolerantArray(capabilityMarketplaceSchema, 1_000),
  /** null: never set in Perspicax, the historical rules stay (never `any`).
   * Absent or malformed: an older Perspicax. */
  capability_marketplace_policy: capabilityMarketplacePolicySchema.nullable().optional().catch(undefined),
});
export type DirectoryProfile = z.infer<typeof profileSchema>;
export type DirectoryPerson = z.infer<typeof personSchema>;
export type DirectoryTeam = z.infer<typeof teamSchema>;
export type Directory = z.infer<typeof directorySchema>;

export interface DirectoryState {
  state: "missing" | "ok" | "error";
  /** When the directory last answered (200 or 304), ms since the epoch. */
  syncedAt?: number;
  /** A short code: link_missing, link_invalid, link_refused, unreachable,
   * http_<status>, too_large, malformed, server_mismatch. */
  error?: string;
}

export interface DirectoryPrincipals {
  upsertFromDirectory(input: { iss: string; sub: string; name?: string | null; login?: string | null; email?: string | null; avatar?: string | null; orgRole: "admin" | "member"; teams?: { id: string; manager: boolean }[]; perspicaxRole?: "admin" | "manager" | "employee" }): Principal;
  listBySubjectIssuer(iss: string): Principal[];
  /** Slice 7: the directory lists this person active again: clear a
   * `disabledAt` set before the fetch started (a later back-channel logout
   * wins). Returns the principal, or null when nothing changed. */
  markEnabled?(iss: string, sub: string, disabledBefore: number): Principal | null;
}

/** The team names registry (org-teams.ts). */
export interface DirectoryTeamNames {
  replaceFromDirectory(teams: readonly { id: string; name: string }[]): boolean;
}

export const PROVIDER_KEY_RESOLVE_PATH = "/api/v1/pulsabot/provider-keys/resolve";
/** A person's avatar through the link (the directory's `avatar` names its
 * version): `GET <base>/api/v1/pulsabot/people/<sub>/avatar`, a PNG or a
 * JPEG of at most AVATAR_MAX_BYTES, 404 when there is none. */
export const avatarPath = (sub: string) => `/api/v1/pulsabot/people/${encodeURIComponent(sub)}/avatar`;
export const AVATAR_MAX_BYTES = 256 * 1024;
export const AVATAR_TIMEOUT_MS = 5_000;
const AVATAR_CACHE_MAX = 256;

export interface AvatarImage {
  bytes: Buffer;
  contentType: "image/png" | "image/jpeg";
}

/** 2026-10-16 (Perspicax 1.8.31): where the signed-in person sets or removes
 * their own avatar from Sagax. Bearer link token plus the person's sign-in
 * access token in SUBJECT_TOKEN_HEADER: never the link token alone. */
export const OWN_AVATAR_PATH = "/api/v1/pulsabot/people/me/avatar";
export const SUBJECT_TOKEN_HEADER = "x-perspicax-subject-token";
export const OWN_AVATAR_TIMEOUT_MS = 10_000;
const OWN_AVATAR_ANSWER_MAX_BYTES = 8 * 1024;
/** What a write of the person's own avatar did: `avatar` the directory's new
 * version (null once removed). `subject`: Perspicax refused the person's
 * sign-in token; `unsupported`: an older Perspicax without the route;
 * `rejected`: Perspicax refused the image (its message kept). */
export type OwnAvatarWrite =
  | { ok: true; avatar: string | null }
  | { ok: false; error: "link" | "subject" | "unsupported" | "rejected" | "unreachable"; status?: number; message?: string };

/** 2026-10-17: where the signed-in person erases their own Perspicax account
 * from Sagax (DELETE /api/me, server/routes/account.ts). Same two tokens as
 * OWN_AVATAR_PATH; body `{ "confirm": true }`. Every answer of that route
 * carries ACCOUNT_ERASURE_HEADER: a 404 or 405 without it is an older
 * Perspicax that has no such route. */
export const OWN_ACCOUNT_ERASE_PATH = "/api/v1/pulsabot/people/me/erase";
export const ACCOUNT_ERASURE_HEADER = "x-perspicax-erasure";
export const OWN_ACCOUNT_ERASE_TIMEOUT_MS = 10_000;
const OWN_ACCOUNT_ERASE_ANSWER_MAX_BYTES = 8 * 1024;
/** What the erasure of the person's own account did. `subject`: Perspicax
 * refused the person's sign-in token; `reauth_required` (2026-10-18): the
 * token proves no interactive sign-in of the last five minutes (a refreshed
 * one never does); `last_admin`: the last active admin
 * cannot be erased; `bound`: a product an administrator configured still
 * uses one of the person's keys; `unsupported`: an older Perspicax without the route;
 * `refused`: another 4xx (its status kept); `link`: no link or the link
 * token was refused; `unreachable`: no answer, a 5xx or an unreadable one. */
/** 2026-10-19 (Perspicax #384, lot P1.9): a personal cloud agent run's
 * subscription token, handed over by this server. */
export const SUBSCRIPTION_TOKEN_TIMEOUT_MS = 10_000;

export interface SubscriptionTokenBody {
  provider: "anthropic" | "openai";
  /** The short access token, never a refresh token. */
  access_token: string;
  /** RFC 3339, within 24 h. */
  expires_at: string;
  account_id?: string;
}

export type SubscriptionTokenDeposit =
  | { ok: true }
  /** link: no or refused link token; subject: the person's sign-in token is
   * not valid there; gone: no live personal run of this person (404);
   * forbidden: personal credentials are off for the organization; rejected:
   * Perspicax refused the body (400); unsupported: an older Perspicax (405). */
  | { ok: false; error: "link" | "subject" | "gone" | "forbidden" | "rejected" | "unsupported" | "unreachable"; status?: number; message?: string };

export type OwnAccountErasure =
  | { ok: true; sub: string; auditId?: string }
  | { ok: false; error: "link" | "subject" | "reauth_required" | "last_admin" | "bound" | "unsupported" | "refused" | "unreachable"; status?: number };

/** What an image's first bytes say it is; only a PNG or a JPEG is served. */
export function avatarContentType(bytes: Uint8Array): AvatarImage["contentType"] | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}
export const PROVIDER_KEY_TIMEOUT_MS = 5_000;
export const PROVIDER_KEY_MAX_BYTES = 8 * 1024;
export const PROVIDER_KEY_CACHE_MS = 60_000;
/** A key a person keeps in Perspicax ("Mes clés de modèle"), by provider:
 * anthropic (Claude Code, pi), openai (Codex, pi), xai (Grok Build, pi and
 * voice mode, server/voice-mode.ts), google (Gemini CLI, pi) and moonshot
 * (Kimi Code, pi). Perspicax 1.8 lists the first three; google and moonshot
 * are read as soon as its directory lists them (server/engine-credentials.ts). */
export type ModelProvider = "anthropic" | "openai" | "xai" | "google" | "moonshot" | "openrouter" | "mistral" | "cerebras" | "opencode" | "cursor" | "factory" | "minimax" | "glm" | "zai" | "groq" | `compat:${string}`;
export const MODEL_PROVIDERS: readonly ModelProvider[] = ["anthropic", "openai", "xai", "google", "moonshot", "openrouter", "mistral", "cerebras", "opencode", "cursor", "factory", "minimax", "glm", "zai", "groq"];
export const KEY_PROVIDERS = ["anthropic", "openai", "xai", "google", "moonshot", "elevenlabs", "fish", "openrouter", "mistral", "cerebras", "opencode", "cursor", "factory", "minimax", "glm", "zai", "groq"] as const;
export type KeyProvider = (typeof KEY_PROVIDERS)[number] | `compat:${string}`;
export function isKeyProvider(value: string): value is KeyProvider {
  return (KEY_PROVIDERS as readonly string[]).includes(value) || /^compat:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}
export type ProviderKeyResult =
  | { ok: true; key: string; fingerprint: string }
  | { ok: false; error: "no_key" | "user_inactive" | "unreachable" | "link" };

/** Slice 5 (contract 1): RFC 8693 token exchange for per-turn MCP tokens. */
export const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
export const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
export const LINK_SERVER_CLIENT_ID = "pulsa-bot-server";
export const EXCHANGE_TIMEOUT_MS = 5_000;
export const EXCHANGE_MAX_BYTES = 8 * 1024;
/** A Perspicax profile id as Pulsa Bot stores it on a bot. */
export const PROFILE_ID = /^[0-9A-Za-z_.:-]{1,64}$/;
export type ExchangeResult =
  | { ok: true; token: string; expiresAt: number }
  /** not_held: Perspicax answered invalid_target (profile unknown or not
   * held); subject: invalid_grant (the sign-in token was refused); link: the
   * link token was refused even after re-reading the file.
   * `description` is Perspicax's public error_description when present. */
  | { ok: false; error: "not_held" | "subject" | "link" | "rate_limited" | "unreachable"; description?: string };

/** How long a not_held (invalid_target) answer is remembered so a turn that
 * lists several tools does not keep asking Perspicax for the same profile. */
export const NOT_HELD_CACHE_MS = 60_000;

/** 2026-10-08 : a routine always acts in its owner's name. The linked
 * server turns the person's live sign-in access token into their routine
 * delegation (RFC 8693 asking a refresh token with the marker), with no
 * consent step. */
export const REFRESH_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:refresh_token";
export const ROUTINE_DELEGATION_EXCHANGE_SCOPE = "openid profile email offline_access pulsabot:routines";
export type RoutineDelegationIssue =
  | { ok: true; refreshToken: string; accessToken?: string; accessExpiresAt?: number }
  /** unsupported: this Perspicax cannot issue one without a consent (it
   * refuses a refresh token as the requested type); subject: the sign-in
   * token was refused; link: the link token was refused. */
  | { ok: false; error: "unsupported" | "subject" | "link" | "rate_limited" | "unreachable"; retryAfterMs?: number };

/** What a link-authenticated POST answered (linkPostJson): `link` the link
 * is missing or refused, `unreachable` no answer in time, `too_large` the
 * answer passed its limit, `refused` a non-2xx answer (its JSON body kept). */
export type LinkPostResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; error: "link" | "unreachable" | "too_large" | "refused"; status?: number; body?: unknown };

/** The bounds of a link-authenticated POST (linkPostJson). `subject`: the
 * Perspicax user id of the one person the call acts for; their token then
 * rides along in SUBJECT_TOKEN_HEADER when one is at hand. */
export interface LinkPostLimits {
  timeoutMs: number;
  maxBytes: number;
  subject?: string;
}

/** Whether a refusal is Perspicax's `subject` one: the person's token was
 * missing or named someone else. Only a Perspicax that asks for the token
 * answers it. */
export function isSubjectRefusal(result: LinkPostResult): boolean {
  if (result.ok || result.status !== 403) return false;
  const body = result.body;
  return Boolean(body && typeof body === "object" && (body as { code?: unknown }).code === "subject");
}

export interface PerspicaxDirectoryOptions {
  /** SAGAX_PERSPICAX_ISSUER: the subjects' `iss`. */
  issuer: string;
  /** Where the directory is fetched: SAGAX_PERSPICAX_INTERNAL_URL, else the
   * issuer's origin. */
  serverBase: string;
  linkFile: string;
  expect: LinkExpectation;
  principals: DirectoryPrincipals;
  /** The person is out (disabled in Perspicax, or deleted): same effect as a
   * back-channel logout. */
  onPersonOut: (iss: string, sub: string) => void;
  /** This principal was an admin and no longer is: narrow its sessions now. */
  onRoleNarrowed: (principalId: string) => void;
  /** Slice 6: after each answer (a 304 reports the cached one), whether each subject
   * holds a routine delegation (undefined: unknown), and when the fetch
   * started (RoutineConsents.reconcile). */
  onDelegations?: (present: (sub: string) => boolean | undefined, fetchStartedAt: number) => void;
  /** A new directory body was applied (not called on 304). */
  onDirectory?: (directory: Directory) => void;
  /** The token that says which person a link call acts for: their live
   * sign-in access token, else the access token of their routine delegation
   * on this server; null when there is none. Sent in SUBJECT_TOKEN_HEADER
   * on the link routes that act for a named person, next to the link token
   * (which server). Absent, or null: the call goes with the link token
   * alone, as before (a Perspicax that does not ask for it still answers). */
  subjectToken?: (sub: string) => Promise<string | null>;
  /** Pulsa Bot's version, sent as X-Pulsabot-Version. */
  version: string;
  /** Slice 7: the link file was loaded, changed to another server id, or
   * went away (null), for the organization audit. */
  onLinkChanged?: (previous: { serverId: string } | null, next: { serverId: string } | null) => void;
  /** Slice 4: team names (org-teams.ts), replaced from each directory. */
  teamNames?: DirectoryTeamNames;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
  timeoutMs?: number;
}

async function readLimitedBytes(response: Response, max: number): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function readLimited(response: Response, max: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const VERSION_HEADER = /^[0-9A-Za-z.+-]{1,64}$/;

/** Constant-time comparison of two secrets of any length (their SHA-256
 * digests, so the length of neither leaks). */
export function sameSecret(presented: string, expected: string): boolean {
  if (!presented || !expected) return false;
  return timingSafeEqual(createHash("sha256").update(presented).digest(), createHash("sha256").update(expected).digest());
}

/** A public OAuth error_description safe to show the person: trimmed, short,
 * no newlines or control characters. */
export function publicOAuthDescription(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Strips control characters on purpose (a server-supplied description).
  // oxlint-disable-next-line no-control-regex
  const text = value.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return text || undefined;
}

/** The organization's people, read from Perspicax with the link token. One
 * refresh at a time; a failed call keeps the last good data. */
/** A person missing from two directory answers this far apart is out. */
export const DIRECTORY_ABSENT_CONFIRM_MS = 60_000;

export class PerspicaxDirectory {
  private readonly options: PerspicaxDirectoryOptions;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private link: PerspicaxLink | null = null;
  private etag: string | null = null;
  private data: Directory | null = null;
  private current: DirectoryState = { state: "missing", error: "link_missing" };
  private inflight: Promise<DirectoryState> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Slice 4: provider names per subject, from the last directory. */
  private keysBySub = new Map<string, string[]>();
  private providerUpdates = new Map<string, { names: string[]; at: number }>();
  /** 2026-10-20: a known subject missing from the directory, since when
   * (memory only). Out only once it is still missing on a later answer at
   * least DIRECTORY_ABSENT_CONFIRM_MS after: a partial answer from a
   * Perspicax being redeployed must not sign anyone out. An explicit
   * `disabled` is acted on at once. */
  private absentSince = new Map<string, number>();
  /** Slice 4: owner keys read through the link, in memory only. */
  private readonly keyCache = new Map<string, { key: string; fingerprint: string; until: number }>();
  /** Avatars read through the link, by subject and version, in memory only. */
  private readonly avatarCache = new Map<string, AvatarImage>();
  /** Unknown permission keys already logged (one line each). */
  private readonly loggedUnknownPermissions = new Set<string>();
  /** Short negative cache for profiles a person does not hold (invalid_target),
   * keyed by subject token fingerprint and profile (or marketplace) resource. */
  private readonly notHeldUntil = new Map<string, { until: number; description?: string }>();

  constructor(options: PerspicaxDirectoryOptions) {
    this.options = options;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.log(line));
  }

  state(): DirectoryState {
    return { ...this.current };
  }

  /** The person's subject header for a link call, or none. Never throws,
   * never logs the token. */
  private async subjectHeader(sub: string | undefined): Promise<Record<string, string>> {
    if (!sub || !this.options.subjectToken) return {};
    let token: string | null = null;
    try {
      token = await this.options.subjectToken(sub);
    } catch {
      token = null;
    }
    return token ? { [SUBJECT_TOKEN_HEADER]: token } : {};
  }

  /** The server id Perspicax gave this server, once a link file was read. */
  serverId(): string | undefined {
    return this.link?.serverId;
  }

  /** Whether `token` is this server's link token (2026-10-11, the
   * directory refresh route). Compared in constant time against the token
   * last read; a mismatch re-reads the link file once, so a token Perspicax
   * just rotated is accepted. Never logs either token. */
  linkTokenMatches(token: string): boolean {
    if (!token) return false;
    if (this.link && sameSecret(token, this.link.linkToken)) return true;
    const reread = this.readLink();
    return reread !== null && sameSecret(token, reread.linkToken);
  }

  /** The last directory Perspicax sent, or null before the first answer. */
  directory(): Directory | null {
    return this.data;
  }

  /** Pulsatrix Flow's default plugins from the last directory; undefined
   * when it sent none (an older Perspicax, or before the first answer). */
  flowPlugins(): FlowPluginsDeclaration | undefined {
    return this.data?.flow_plugins ?? undefined;
  }

  /** Capabilities lot 4: the organization's declarations from the last
   * directory, configuration included (never log or forward it); undefined
   * when Perspicax sent none (an older Perspicax, or before the first
   * answer). */
  orgCapabilities(): OrgCapabilityDeclaration[] | undefined {
    return this.data?.capabilities ?? undefined;
  }

  /** The organization's allowed marketplaces; undefined from an older Perspicax. */
  capabilityMarketplaces(): CapabilityMarketplace[] | undefined {
    return this.data?.capability_marketplaces ?? undefined;
  }

  /** The canonical marketplace policy: undefined from an older Perspicax
   * (or before the first answer), null while Perspicax has none set. */
  capabilityMarketplacePolicy(): CapabilityMarketplacePolicy | null | undefined {
    if (!this.data || this.data.capability_marketplace_policy === undefined) return undefined;
    return this.data.capability_marketplace_policy;
  }

  people(): DirectoryPerson[] {
    return this.data ? [...this.data.people] : [];
  }

  /** The providers this subject keeps a key for in Perspicax (slice 4),
   * from the last directory; [] when unknown. */
  providerKeys(sub: string): string[] {
    return [...(this.keysBySub.get(sub) ?? [])];
  }

  /** A successful personal write is visible at once. A directory fetch
   * started before that write must not put the old list back. */
  rememberProviderKeys(sub: string, names: readonly string[]): void {
    const next = [...new Set(names.filter(isKeyProvider))].sort();
    this.keysBySub.set(sub, next);
    this.providerUpdates.set(sub, { names: next, at: this.now() });
  }

  /** What this subject may do with bots (Perspicax `sagax_bots`): `use`
   * only when the last directory says so, else `manage` (the default, an
   * older Perspicax, or before the first directory). */
  botRights(sub: string): "manage" | "use" {
    const person = this.data?.people.find((entry) => entry.sub === sub);
    return person?.sagax_bots === "use" ? "use" : "manage";
  }

  /** 2026-10-16: the engine instance ids this subject may run on the
   * organization's provided accounts, from the last directory. null when
   * the directory did not send the field (an older Perspicax, a subject it
   * does not list, before the first directory): the caller treats that as
   * none for a member, logged once. An admin is never narrowed (caller). */
  serverEngines(sub: string): string[] | null {
    const person = this.data?.people.find((entry) => entry.sub === sub);
    if (!person || !Array.isArray(person.sagax_server_engines)) return null;
    return [...person.sagax_server_engines];
  }

  /** 2026-10-09: the permissions Perspicax computed for this subject, or
   * null when it sent none (an older Perspicax, a subject it does not list,
   * before the first directory): the caller then uses the member defaults.
   * Unknown and admin-only keys are dropped here; each unknown key is
   * logged once per directory. */
  permissionsOf(sub: string): PermissionKey[] | null {
    const person = this.data?.people.find((entry) => entry.sub === sub);
    if (!person || !Array.isArray(person.permissions)) return null;
    const normalized = normalizePermissions(person.permissions);
    for (const key of normalized.unknown) {
      if (this.loggedUnknownPermissions.has(key)) continue;
      this.loggedUnknownPermissions.add(key);
      this.log(`[perspicax] directory: unknown permission "${key}" ignored (a newer Perspicax or catalogue?)`);
    }
    return normalized.granted;
  }

  /** 2026-10-09: what a profile grants, as Perspicax sent it (display only). */
  profilePermissions(profileId: string): PermissionKey[] | null {
    const profile = this.data?.profiles?.find((entry) => entry.id === profileId);
    if (!profile || !Array.isArray(profile.sagax_permissions)) return null;
    return normalizePermissions(profile.sagax_permissions).granted;
  }

  /** Slice 5: every MCP profile Perspicax lists, sorted by id ([] before the
   * first directory, or from a Perspicax without profiles). */
  profileCatalog(): DirectoryProfile[] {
    return [...(this.data?.profiles ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Slice 5: the profile ids this subject holds, from the last directory. */
  profilesOf(sub: string): string[] {
    const person = this.data?.people.find((entry) => entry.sub === sub);
    if (!person || person.status !== "active") return [];
    return [...new Set(person.profiles ?? [])].sort();
  }

  /** Slice 5: Perspicax's MCP endpoint as this server reaches it. */
  mcpEndpoint(): string {
    return `${this.options.serverBase.replace(/\/+$/, "")}/mcp`;
  }

  private basic(link: PerspicaxLink): string {
    return `Basic ${Buffer.from(`${LINK_SERVER_CLIENT_ID}:${link.linkToken}`).toString("base64")}`;
  }

  /** Slice 5 (contract 1): exchange the speaker's sign-in access token for a
   * short MCP token holding one profile. Authenticated by the link; a 401
   * re-reads the link file once. Never logs a token or puts one in a result
   * other than the ok one. */
  async exchangeToken(subjectToken: string, profileId: string): Promise<ExchangeResult> {
    if (!PROFILE_ID.test(profileId)) return { ok: false, error: "not_held" };
    return this.exchange(subjectToken, `${trimSlash(this.options.issuer)}/mcp?profile=${profileId}`);
  }

  /** The audience of the Flow marketplace token (Perspicax 2026-10-19). */
  flowMarketplaceResource(): string {
    return `${trimSlash(this.options.issuer)}/flow/marketplace`;
  }

  /** 2026-10-19: exchange a person's sign-in access token for a short token
   * of the Flow marketplace Perspicax serves (no profile, no scope; it opens
   * `/flow/marketplace/*` only). Same rules as exchangeToken: never logged,
   * only in the ok result. */
  async exchangeMarketplaceToken(subjectToken: string): Promise<ExchangeResult> {
    return this.exchange(subjectToken, this.flowMarketplaceResource());
  }

  private async exchange(subjectToken: string, resource: string): Promise<ExchangeResult> {
    const cacheKey = `${createHash("sha256").update(subjectToken).digest("hex")}\0${resource}`;
    const cached = this.notHeldUntil.get(cacheKey);
    if (cached && cached.until > this.now()) {
      return { ok: false, error: "not_held", ...(cached.description ? { description: cached.description } : {}) };
    }
    let link = this.link ?? this.readLink();
    if (!link) return { ok: false, error: "link" };
    const body = new URLSearchParams({
      grant_type: TOKEN_EXCHANGE_GRANT,
      subject_token: subjectToken,
      subject_token_type: ACCESS_TOKEN_TYPE,
      resource,
    }).toString();
    const call = (current: PerspicaxLink) => this.fetcher(`${this.options.serverBase.replace(/\/+$/, "")}/oauth/token`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", authorization: this.basic(current) },
      body,
    });
    let response: Response;
    try {
      response = await call(link);
      if (response.status === 401) {
        void response.body?.cancel().catch(() => {});
        const again = this.readLink();
        if (!again) return { ok: false, error: "link" };
        link = again;
        response = await call(link);
        if (response.status === 401) {
          void response.body?.cancel().catch(() => {});
          return { ok: false, error: "link" };
        }
      }
    } catch {
      return { ok: false, error: "unreachable" };
    }
    if (response.status === 429) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, error: "rate_limited" };
    }
    let text: string | null;
    try {
      text = await readLimited(response, EXCHANGE_MAX_BYTES);
    } catch {
      return { ok: false, error: "unreachable" };
    }
    let parsed: Record<string, unknown> = {};
    try {
      const value: unknown = text === null ? null : JSON.parse(text);
      if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    if (response.status === 400) {
      if (parsed.error === "invalid_target") {
        const description = publicOAuthDescription(parsed.error_description);
        this.notHeldUntil.set(cacheKey, { until: this.now() + NOT_HELD_CACHE_MS, ...(description ? { description } : {}) });
        return { ok: false, error: "not_held", ...(description ? { description } : {}) };
      }
      if (parsed.error === "invalid_grant") return { ok: false, error: "subject" };
      return { ok: false, error: "unreachable" };
    }
    if (response.status !== 200) return { ok: false, error: "unreachable" };
    this.notHeldUntil.delete(cacheKey);
    const token = parsed.access_token;
    const expiresIn = parsed.expires_in;
    if (typeof token !== "string" || !token || token.length > 4096 || /\s/.test(token)) return { ok: false, error: "unreachable" };
    if (typeof parsed.token_type === "string" && parsed.token_type.toLowerCase() !== "bearer") return { ok: false, error: "unreachable" };
    const seconds = typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0 ? Math.min(expiresIn, 900) : 0;
    if (!seconds) return { ok: false, error: "unreachable" };
    return { ok: true, token, expiresAt: this.now() + seconds * 1000 };
  }

  /** The person's routine delegation, issued from their live sign-in
   * access token (REFRESH_TOKEN_TYPE, the marker scope, the server's own
   * origin as the resource). Authenticated by the link; a 401 re-reads the
   * link file once. Never logs a token. */
  async issueRoutineDelegation(subjectToken: string): Promise<RoutineDelegationIssue> {
    let link = this.link ?? this.readLink();
    if (!link) return { ok: false, error: "link" };
    const bodyFor = (current: PerspicaxLink) => new URLSearchParams({
      grant_type: TOKEN_EXCHANGE_GRANT,
      subject_token: subjectToken,
      subject_token_type: ACCESS_TOKEN_TYPE,
      requested_token_type: REFRESH_TOKEN_TYPE,
      scope: ROUTINE_DELEGATION_EXCHANGE_SCOPE,
      resource: current.origin,
    }).toString();
    const call = (current: PerspicaxLink) => this.fetcher(`${this.options.serverBase.replace(/\/+$/, "")}/oauth/token`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", authorization: this.basic(current) },
      body: bodyFor(current),
    });
    let response: Response;
    try {
      response = await call(link);
      if (response.status === 401) {
        void response.body?.cancel().catch(() => {});
        const again = this.readLink();
        if (!again) return { ok: false, error: "link" };
        link = again;
        response = await call(link);
        if (response.status === 401) {
          void response.body?.cancel().catch(() => {});
          return { ok: false, error: "link" };
        }
      }
    } catch {
      return { ok: false, error: "unreachable" };
    }
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      void response.body?.cancel().catch(() => {});
      return { ok: false, error: "rate_limited", ...(Number.isFinite(seconds) && seconds > 0 ? { retryAfterMs: Math.min(seconds, 600) * 1000 } : {}) };
    }
    let text: string | null;
    try {
      text = await readLimited(response, EXCHANGE_MAX_BYTES);
    } catch {
      return { ok: false, error: "unreachable" };
    }
    let parsed: Record<string, unknown> = {};
    try {
      const value: unknown = text === null ? null : JSON.parse(text);
      if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    if (response.status === 400) {
      if (parsed.error === "invalid_grant") return { ok: false, error: "subject" };
      // An older Perspicax: only an access token may be requested.
      if (parsed.error === "invalid_request" || parsed.error === "invalid_scope" || parsed.error === "invalid_target" || parsed.error === "unsupported_grant_type") return { ok: false, error: "unsupported" };
      return { ok: false, error: "unreachable" };
    }
    if (response.status !== 200) return { ok: false, error: "unreachable" };
    const refreshToken = parsed.refresh_token;
    const accessToken = parsed.access_token;
    const valid = (token: unknown): token is string => typeof token === "string" && token.length > 0 && token.length <= 4096 && !/\s/.test(token);
    if (!valid(refreshToken)) return { ok: false, error: "unsupported" };
    const scope = typeof parsed.scope === "string" ? parsed.scope.split(" ") : [];
    if (!scope.includes("pulsabot:routines")) {
      // A refresh token without the marker is not a delegation: it must not live on.
      void this.revokeRefresh(refreshToken, link);
      return { ok: false, error: "unsupported" };
    }
    const seconds = typeof parsed.expires_in === "number" && Number.isFinite(parsed.expires_in) && parsed.expires_in > 0 ? parsed.expires_in : 0;
    return {
      ok: true,
      refreshToken,
      ...(valid(accessToken) && seconds ? { accessToken, accessExpiresAt: this.now() + seconds * 1000 } : {}),
    };
  }

  /** Best effort RFC 7009 of a refresh token this server will not keep. */
  private async revokeRefresh(token: string, link: PerspicaxLink): Promise<void> {
    try {
      const response = await this.fetcher(`${this.options.serverBase.replace(/\/+$/, "")}/oauth/revoke`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
        headers: { "content-type": "application/x-www-form-urlencoded", authorization: this.basic(link) },
        body: new URLSearchParams({ token, token_type_hint: "refresh_token" }).toString(),
      });
      void response.body?.cancel().catch(() => {});
    } catch {
      /* best effort */
    }
  }

  /** Slice 5 (contract 2): revoke an exchanged token (RFC 7009) with the
   * link's Basic header. Best effort; a failure is logged without the token. */
  async revokeExchanged(token: string): Promise<boolean> {
    const link = this.link ?? this.readLink();
    if (!link) return false;
    try {
      const response = await this.fetcher(`${this.options.serverBase.replace(/\/+$/, "")}/oauth/revoke`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", authorization: this.basic(link) },
        body: new URLSearchParams({ token, token_type_hint: "access_token" }).toString(),
      });
      void response.body?.cancel().catch(() => {});
      if (!response.ok) this.log(`perspicax: revoking an exchanged MCP token answered ${response.status}; it expires on its own`);
      return response.ok;
    } catch (error) {
      this.log(`perspicax: revoking an exchanged MCP token failed (${error instanceof Error ? error.name : "error"}); it expires on its own`);
      return false;
    }
  }

  /** Drop a cached owner key (a provider refused it, or the owner lost it). */
  invalidate(sub: string, provider: string): void {
    this.keyCache.delete(`${sub}\u0000${provider}`);
  }

  /** Drop every cached owner key of a subject (a back-channel logout, a
   * disabled or vanished person). */
  forgetSubject(sub: string): void {
    const prefix = `${sub}\u0000`;
    for (const cacheKey of this.keyCache.keys()) if (cacheKey.startsWith(prefix)) this.keyCache.delete(cacheKey);
  }

  /** An owner's model key, read through the link (slice 4, contract 3):
   * cached in memory for 60 s at most, never logged, never written. The
   * owner's own token goes with the call when there is one (2026-10-28). */
  async resolveProviderKey(sub: string, provider: KeyProvider): Promise<ProviderKeyResult> {
    const cacheKey = `${sub}\u0000${provider}`;
    const cached = this.keyCache.get(cacheKey);
    if (cached && cached.until > this.now()) return { ok: true, key: cached.key, fingerprint: cached.fingerprint };
    this.keyCache.delete(cacheKey);
    let link = this.link ?? this.readLink();
    if (!link) return { ok: false, error: "link" };
    const subject = await this.subjectHeader(sub);
    const call = (token: string) => this.fetcher(`${this.options.serverBase.replace(/\/+$/, "")}${PROVIDER_KEY_RESOLVE_PATH}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(PROVIDER_KEY_TIMEOUT_MS),
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}`, ...subject },
      body: JSON.stringify({ sub, provider }),
    });
    let response: Response;
    try {
      response = await call(link.linkToken);
      if (response.status === 401) {
        void response.body?.cancel().catch(() => {});
        const again = this.readLink();
        if (!again) return { ok: false, error: "link" };
        link = again;
        response = await call(link.linkToken);
      }
    } catch {
      return { ok: false, error: "unreachable" };
    }
    if (response.status === 401 || response.status === 403) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, error: "link" };
    }
    if (response.status === 404 || response.status === 409) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, error: response.status === 404 ? "no_key" : "user_inactive" };
    }
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, error: "unreachable" };
    }
    let text: string | null;
    try {
      text = await readLimited(response, PROVIDER_KEY_MAX_BYTES);
    } catch {
      return { ok: false, error: "unreachable" };
    }
    if (text === null) return { ok: false, error: "unreachable" };
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, error: "unreachable" };
    }
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const key = record.key;
    const fingerprint = typeof record.fingerprint === "string" ? record.fingerprint.slice(0, 128) : "";
    if (record.provider !== provider || typeof key !== "string" || key.length < 8 || key.length > 512 || [...key].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) || /\s/.test(key)) {
      return { ok: false, error: "unreachable" };
    }
    this.keyCache.set(cacheKey, { key, fingerprint, until: this.now() + PROVIDER_KEY_CACHE_MS });
    return { ok: true, key, fingerprint };
  }

  /** 2026-10-11: POST a JSON body to a Perspicax route that takes the link
   * token (the memory signals, server/perspicax-memory.ts). A 401 re-reads
   * the link file once. Bounded by `timeoutMs` and `maxBytes`; never throws,
   * never logs the token or the body. With `subject`, the person's token
   * (options.subjectToken) rides along in SUBJECT_TOKEN_HEADER when there is
   * one (2026-10-28). */
  async linkPostJson(path: string, body: unknown, limits: LinkPostLimits): Promise<LinkPostResult> {
    let link = this.link ?? this.readLink();
    if (!link) return { ok: false, error: "link" };
    const payload = JSON.stringify(body);
    const subject = await this.subjectHeader(limits.subject);
    const call = (token: string) => this.fetcher(`${this.options.serverBase.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(limits.timeoutMs),
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}`, ...subject },
      body: payload,
    });
    let response: Response;
    try {
      response = await call(link.linkToken);
      if (response.status === 401) {
        void response.body?.cancel().catch(() => {});
        const again = this.readLink();
        if (!again) return { ok: false, error: "link" };
        link = again;
        response = await call(link.linkToken);
      }
    } catch {
      return { ok: false, error: "unreachable" };
    }
    if (response.status === 401) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, error: "link", status: response.status };
    }
    if (response.status === 403) {
      // 2026-10-21: a route may refuse the person rather than the link
      // (inbound mail: `{"error":"not_owner"}`); its small JSON body is kept.
      let refusal: unknown;
      try {
        const text = await readLimited(response, 4_096);
        refusal = text ? JSON.parse(text) : undefined;
      } catch {
        refusal = undefined;
      }
      return { ok: false, error: "link", status: 403, ...(refusal !== undefined ? { body: refusal } : {}) };
    }
    let text: string | null;
    try {
      text = await readLimited(response, limits.maxBytes);
    } catch {
      return { ok: false, error: "unreachable" };
    }
    if (text === null) return { ok: false, error: "too_large", status: response.status };
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (response.status < 200 || response.status >= 300) return { ok: false, error: "refused", status: response.status, body: parsed };
    return { ok: true, status: response.status, body: parsed };
  }

  /** Capabilities lot 4: a JSON call (GET, POST, PUT, DELETE) to a route
   * that takes the link token AND the live sign-in token of the person who
   * acts (`subjectToken`, SUBJECT_TOKEN_HEADER), such as the organization's
   * capability routes. The caller hands the token it holds; nothing falls
   * back to the link alone or to a routine delegation. A 401 re-reads the
   * link file once. Never throws, never logs a token or a body. A 403
   * keeps its small JSON body (`code: "subject"` names a refused sign-in). */
  async linkJson(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body: unknown, limits: { timeoutMs: number; maxBytes: number; subjectToken: string }): Promise<LinkPostResult> {
    let link = this.link ?? this.readLink();
    if (!link) return { ok: false, error: "link" };
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const call = (token: string) => this.fetcher(`${this.options.serverBase.replace(/\/+$/, "")}${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(limits.timeoutMs),
      headers: {
        accept: "application/json", authorization: `Bearer ${token}`, [SUBJECT_TOKEN_HEADER]: limits.subjectToken,
        ...(payload !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(payload !== undefined ? { body: payload } : {}),
    });
    let response: Response;
    try {
      response = await call(link.linkToken);
      if (response.status === 401) {
        void response.body?.cancel().catch(() => {});
        const again = this.readLink();
        if (!again) return { ok: false, error: "link" };
        link = again;
        response = await call(link.linkToken);
      }
    } catch {
      return { ok: false, error: "unreachable" };
    }
    if (response.status === 401) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, error: "link", status: 401 };
    }
    let text: string | null;
    try {
      text = await readLimited(response, response.ok ? limits.maxBytes : 8_192);
    } catch {
      return { ok: false, error: "unreachable" };
    }
    if (text === null) return { ok: false, error: "too_large", status: response.status };
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (response.status === 403) return { ok: false, error: "link", status: 403, ...(parsed !== null ? { body: parsed } : {}) };
    if (!response.ok) return { ok: false, error: "refused", status: response.status, body: parsed };
    return { ok: true, status: response.status, body: parsed };
  }

  linkPutJson(path: string, body: unknown, limits: { timeoutMs: number; maxBytes: number; subjectToken: string }): Promise<LinkPostResult> {
    return this.linkJson("PUT", path, body, limits);
  }

  linkDeleteJson(path: string, limits: { timeoutMs: number; maxBytes: number; subjectToken: string }): Promise<LinkPostResult> {
    return this.linkJson("DELETE", path, undefined, limits);
  }

  /** A person's avatar at a given version, read through the link and kept
   * in memory (a new version is a new key, so a changed image is read
   * again). Null when there is none, the link is missing, Perspicax does not
   * serve avatars yet, or the answer is not a PNG or a JPEG. Never throws. */
  async avatar(sub: string, version: string): Promise<AvatarImage | null> {
    const cacheKey = `${sub}\u0000${version}`;
    const cached = this.avatarCache.get(cacheKey);
    if (cached) return cached;
    let link = this.link ?? this.readLink();
    if (!link) return null;
    const call = (token: string) => this.fetcher(`${this.options.serverBase.replace(/\/+$/, "")}${avatarPath(sub)}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS),
      headers: { accept: "image/png, image/jpeg", authorization: `Bearer ${token}` },
    });
    let response: Response;
    try {
      response = await call(link.linkToken);
      if (response.status === 401) {
        void response.body?.cancel().catch(() => {});
        const again = this.readLink();
        if (!again) return null;
        link = again;
        response = await call(link.linkToken);
      }
    } catch {
      return null;
    }
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    let bytes: Buffer | null;
    try {
      bytes = await readLimitedBytes(response, AVATAR_MAX_BYTES);
    } catch {
      return null;
    }
    const contentType = bytes ? avatarContentType(bytes) : null;
    if (!bytes || !contentType) return null;
    const image: AvatarImage = { bytes, contentType };
    // drop older versions of this person, then the oldest entries overall
    for (const key of this.avatarCache.keys()) if (key.startsWith(`${sub}\u0000`)) this.avatarCache.delete(key);
    while (this.avatarCache.size >= AVATAR_CACHE_MAX) {
      const oldest = this.avatarCache.keys().next().value;
      if (oldest === undefined) break;
      this.avatarCache.delete(oldest);
    }
    this.avatarCache.set(cacheKey, image);
    return image;
  }

  /** Drop every cached avatar of a subject (their photo changed). */
  forgetAvatar(sub: string): void {
    for (const key of this.avatarCache.keys()) if (key.startsWith(`${sub}\u0000`)) this.avatarCache.delete(key);
  }

  /** 2026-10-16: the signed-in person sets (an image) or removes (null)
   * their own Perspicax avatar: `PUT`/`DELETE` OWN_AVATAR_PATH with both the
   * link token (`Authorization: Bearer`, which server calls) and the
   * person's live sign-in access token (SUBJECT_TOKEN_HEADER, who). The link
   * token alone opens no person on that route, so this server can only
   * change the photo of the person whose token it holds. A 401 re-reads the
   * link file once. Never logs a token or the image; never throws. */
  async writeOwnAvatar(subjectToken: string, image: AvatarImage | null): Promise<OwnAvatarWrite> {
    let link = this.link ?? this.readLink();
    if (!link) return { ok: false, error: "link" };
    const call = (token: string) => {
      const headers: Record<string, string> = { accept: "application/json", authorization: `Bearer ${token}`, [SUBJECT_TOKEN_HEADER]: subjectToken };
      let body: FormData | undefined;
      if (image) {
        body = new FormData();
        body.append("file", new Blob([new Uint8Array(image.bytes)], { type: image.contentType }), image.contentType === "image/png" ? "avatar.png" : "avatar.jpg");
      }
      return this.fetcher(`${this.options.serverBase.replace(/\/+$/, "")}${OWN_AVATAR_PATH}`, {
        method: image ? "PUT" : "DELETE",
        redirect: "error",
        signal: AbortSignal.timeout(OWN_AVATAR_TIMEOUT_MS),
        headers,
        ...(body ? { body } : {}),
      });
    };
    let response: Response;
    try {
      response = await call(link.linkToken);
      if (response.status === 401) {
        void response.body?.cancel().catch(() => {});
        const again = this.readLink();
        if (!again) return { ok: false, error: "link" };
        link = again;
        response = await call(link.linkToken);
      }
    } catch {
      return { ok: false, error: "unreachable" };
    }
    let text: string | null;
    try {
      text = await readLimited(response, OWN_AVATAR_ANSWER_MAX_BYTES);
    } catch {
      return { ok: false, error: "unreachable" };
    }
    let parsed: Record<string, unknown> = {};
    try {
      const value: unknown = text ? JSON.parse(text) : null;
      if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    const status = response.status;
    if (status === 401) return { ok: false, error: "link", status };
    if (status === 403) return { ok: false, error: parsed.code === "subject" ? "subject" : "link", status };
    // An older Perspicax has no such route (the GET-only `{sub}/avatar` answers 405).
    if (status === 404 || status === 405) return { ok: false, error: "unsupported", status };
    if (status === 400 || status === 413 || status === 422) {
      const message = typeof parsed.message === "string" ? parsed.message.slice(0, 200) : undefined;
      return { ok: false, error: "rejected", status, ...(message ? { message } : {}) };
    }
    if (status !== 200) return { ok: false, error: "unreachable", status };
    const value = parsed.value && typeof parsed.value === "object" ? (parsed.value as Record<string, unknown>) : {};
    const avatar = value.avatar;
    if (image) {
      if (typeof avatar !== "string" || !/^[0-9A-Za-z_-]{1,64}$/.test(avatar)) return { ok: false, error: "unreachable", status };
      return { ok: true, avatar };
    }
    return { ok: true, avatar: null };
  }

  /** 2026-10-17: the signed-in person erases their own Perspicax account
   * (2026-10-18: `subjectToken` is the access token of the sign-in they made
   * again for it, server/account-reauth.ts, never a refreshed one):
   * `POST` OWN_ACCOUNT_ERASE_PATH `{ "confirm": true }` with the link token
   * (`Authorization: Bearer`, which server calls) and the person's live
   * sign-in access token (SUBJECT_TOKEN_HEADER, who), as writeOwnAvatar
   * does: the request names nobody, so this server can only erase the person
   * whose token it holds. A 401 re-reads the link file once. Never logs a
   * token; never throws. */
  async eraseOwnAccount(subjectToken: string): Promise<OwnAccountErasure> {
    let link = this.link ?? this.readLink();
    if (!link) return { ok: false, error: "link" };
    const version = VERSION_HEADER.test(this.options.version) ? this.options.version : "unknown";
    const call = (token: string) => this.fetcher(`${this.options.serverBase.replace(/\/+$/, "")}${OWN_ACCOUNT_ERASE_PATH}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(OWN_ACCOUNT_ERASE_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        [SUBJECT_TOKEN_HEADER]: subjectToken,
        "x-pulsabot-version": version,
      },
      body: JSON.stringify({ confirm: true }),
    });
    let response: Response;
    try {
      response = await call(link.linkToken);
      if (response.status === 401) {
        void response.body?.cancel().catch(() => {});
        const again = this.readLink();
        if (!again) return { ok: false, error: "link" };
        link = again;
        response = await call(link.linkToken);
      }
    } catch {
      return { ok: false, error: "unreachable" };
    }
    const status = response.status;
    const marked = response.headers.get(ACCOUNT_ERASURE_HEADER) === "1";
    if (status === 401) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, error: "link", status };
    }
    if (!marked && (status === 404 || status === 405)) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, error: "unsupported", status };
    }
    let text: string | null;
    try {
      text = await readLimited(response, OWN_ACCOUNT_ERASE_ANSWER_MAX_BYTES);
    } catch {
      return { ok: false, error: "unreachable", status };
    }
    let parsed: Record<string, unknown> = {};
    try {
      const value: unknown = text ? JSON.parse(text) : null;
      if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    if (status === 200) {
      const sub = typeof parsed.sub === "string" ? parsed.sub : "";
      if (parsed.erased !== true || !sub) return { ok: false, error: "unreachable", status };
      return { ok: true, sub, ...(typeof parsed.audit_id === "string" ? { auditId: parsed.audit_id.slice(0, 128) } : {}) };
    }
    if (status === 403 && parsed.code === "subject") return { ok: false, error: "subject", status };
    if (status === 403 && parsed.code === "reauth_required") return { ok: false, error: "reauth_required", status };
    if (status === 409 && parsed.code === "last_admin") return { ok: false, error: "last_admin", status };
    if (status === 409 && parsed.code === "bound") return { ok: false, error: "bound", status };
    if (status >= 400 && status < 500) return { ok: false, error: "refused", status };
    return { ok: false, error: "unreachable", status };
  }

  /** The link token for a link route this server calls with its own client
   * (the cloud agents client, server/cloud-agents/perspicax-client.ts), or
   * null when the server is not linked. `reread` reads the file again (after
   * a 401: the token may have rotated). Never logged. */
  linkBearer(reread = false): string | null {
    const link = reread ? this.readLink() : this.link ?? this.readLink();
    return link?.linkToken ?? null;
  }

  /** Hand Perspicax the short access token of a personal run's engine
   * subscription: `PUT /api/v1/agents/runs/{id}/subscription-token` with the
   * link token (which server) and the person's live sign-in access token
   * (SUBJECT_TOKEN_HEADER, who; Perspicax checks they asked for the run). A
   * 401 re-reads the link file once. Never logs a token; never throws. */
  async depositSubscriptionToken(subjectToken: string, runId: string, body: SubscriptionTokenBody): Promise<SubscriptionTokenDeposit> {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(runId)) return { ok: false, error: "rejected" };
    let link = this.link ?? this.readLink();
    if (!link) return { ok: false, error: "link" };
    const call = (token: string) => this.fetcher(`${this.options.serverBase.replace(/\/+$/, "")}/api/v1/agents/runs/${encodeURIComponent(runId)}/subscription-token`, {
      method: "PUT",
      redirect: "error",
      signal: AbortSignal.timeout(SUBSCRIPTION_TOKEN_TIMEOUT_MS),
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}`, [SUBJECT_TOKEN_HEADER]: subjectToken },
      body: JSON.stringify(body),
    });
    let response: Response;
    try {
      response = await call(link.linkToken);
      if (response.status === 401) {
        void response.body?.cancel().catch(() => {});
        const again = this.readLink();
        if (!again) return { ok: false, error: "link" };
        link = again;
        response = await call(link.linkToken);
      }
    } catch {
      return { ok: false, error: "unreachable" };
    }
    const status = response.status;
    if (status === 204 || status === 200) {
      void response.body?.cancel().catch(() => {});
      return { ok: true };
    }
    let parsed: Record<string, unknown> = {};
    try {
      const text = await readLimited(response, 16_384);
      const value: unknown = text ? JSON.parse(text) : null;
      if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    const message = typeof parsed.message === "string" ? parsed.message.slice(0, 300) : undefined;
    const said = message ? { message } : {};
    if (status === 401) return { ok: false, error: "link", status };
    if (status === 403) return { ok: false, error: parsed.code === "subject" ? "subject" : "forbidden", status, ...said };
    if (status === 404) return { ok: false, error: "gone", status, ...said };
    if (status === 405) return { ok: false, error: "unsupported", status };
    if (status === 400 || status === 409 || status === 422) return { ok: false, error: "rejected", status, ...said };
    return { ok: false, error: "unreachable", status };
  }

  start(intervalMs: number): void {
    this.stop();
    void this.refresh("boot");
    this.timer = setInterval(() => void this.refresh("poll"), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Fetch the directory now (single flight: a call while one is running
   * joins it). Never throws. */
  refresh(_reason = "manual"): Promise<DirectoryState> {
    this.inflight ??= this.run().catch((error: unknown) => {
      this.fail("unreachable", error instanceof Error ? error.message : String(error));
      return this.state();
    }).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private readLink(): PerspicaxLink | null {
    const read = readLinkFile(this.options.linkFile, this.options.expect);
    if (!read.ok) {
      if (read.code === "missing") {
        this.current = { state: this.data ? "error" : "missing", error: "link_missing", ...(this.current.syncedAt ? { syncedAt: this.current.syncedAt } : {}) };
      } else {
        this.fail("link_invalid", read.reason);
      }
      const previous = this.link;
      this.link = null;
      if (previous) this.linkChanged(previous, null);
      return null;
    }
    const previous = this.link;
    if (this.link && this.link.serverId !== read.link.serverId) {
      // Relinked to a new server id: start over with no cached answer.
      this.etag = null;
    }
    this.link = read.link;
    if (!previous || previous.serverId !== read.link.serverId) this.linkChanged(previous, read.link);
    return read.link;
  }

  private linkChanged(previous: PerspicaxLink | null, next: PerspicaxLink | null): void {
    try {
      this.options.onLinkChanged?.(previous ? { serverId: previous.serverId } : null, next ? { serverId: next.serverId } : null);
    } catch {
      /* an audit listener never breaks the directory */
    }
  }

  private fail(code: string, detail: string): void {
    this.current = { state: "error", error: code, ...(this.current.syncedAt ? { syncedAt: this.current.syncedAt } : {}) };
    this.log(`perspicax directory: ${code} (${detail.slice(0, 200)})`);
  }

  private async call(link: PerspicaxLink): Promise<Response> {
    const version = VERSION_HEADER.test(this.options.version) ? this.options.version : "unknown";
    return this.fetcher(`${this.options.serverBase.replace(/\/+$/, "")}${DIRECTORY_PATH}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(this.options.timeoutMs ?? DIRECTORY_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${link.linkToken}`,
        "x-pulsabot-version": version,
        ...(this.etag ? { "if-none-match": this.etag } : {}),
      },
    });
  }

  private async run(): Promise<DirectoryState> {
    let link = this.readLink();
    if (!link) return this.state();
    const fetchStartedAt = this.now();
    let response: Response;
    try {
      response = await this.call(link);
      if (response.status === 401 || response.status === 403) {
        void response.body?.cancel().catch(() => {});
        // The token was rotated (or the file rewritten): read it again and
        // try once more with what it holds now.
        const before = link.linkToken;
        const again = this.readLink();
        if (!again) return this.state();
        if (again.linkToken === before && response.status === 403) {
          this.fail("link_refused", `the directory answered ${response.status}`);
          return this.state();
        }
        link = again;
        response = await this.call(link);
        if (response.status === 401 || response.status === 403) {
          void response.body?.cancel().catch(() => {});
          this.fail("link_refused", `the directory answered ${response.status} after re-reading the link file`);
          return this.state();
        }
      }
    } catch (error) {
      this.fail("unreachable", error instanceof Error ? error.message : String(error));
      return this.state();
    }
    if (response.status === 304) {
      void response.body?.cancel().catch(() => {});
      if (!this.data) {
        // A 304 with nothing cached cannot be applied: ask again in full.
        this.etag = null;
        this.fail("malformed", "not modified, but nothing is cached");
        return this.state();
      }
      this.current = { state: "ok", syncedAt: this.now() };
      // Unchanged is still the current truth: a delegation created and
      // ended between two polls leaves the same body, and must still end.
      this.reportDelegations(this.data, fetchStartedAt);
      return this.state();
    }
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      this.fail(`http_${response.status}`, `the directory answered ${response.status}`);
      return this.state();
    }
    const text = await readLimited(response, DIRECTORY_MAX_BYTES);
    if (text === null) {
      this.fail("too_large", "the directory is larger than 4 MiB");
      return this.state();
    }
    let parsed: Directory;
    try {
      const checked = directorySchema.safeParse(JSON.parse(text));
      if (!checked.success) throw new Error(checked.error.issues[0]?.message ?? "invalid");
      parsed = checked.data;
    } catch (error) {
      this.fail("malformed", error instanceof Error ? error.message : String(error));
      return this.state();
    }
    if (parsed.server_id !== link.serverId) {
      this.fail("server_mismatch", "the directory names another server id than the link file");
      return this.state();
    }
    this.apply(parsed, fetchStartedAt);
    this.data = parsed;
    try {
      this.options.onDirectory?.(parsed);
    } catch (error) {
      this.log(`perspicax directory: a listener failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.loggedUnknownPermissions.clear();
    this.reportDelegations(parsed, fetchStartedAt);
    const etag = response.headers.get("etag");
    this.etag = etag && etag.length <= 128 ? etag : null;
    this.current = { state: "ok", syncedAt: this.now() };
    return this.state();
  }

  /** Slice 6: each person's routine delegation, to RoutineConsents. */
  private reportDelegations(directory: Directory, fetchStartedAt: number): void {
    if (!this.options.onDelegations) return;
    const bySub = new Map(directory.people.map((person) => [person.sub, person] as const));
    try {
      this.options.onDelegations((sub) => {
        const person = bySub.get(sub);
        if (!person || person.routine_delegation === undefined) return undefined;
        return person.status === "disabled" ? false : person.routine_delegation !== null;
      }, fetchStartedAt);
    } catch (error) {
      this.log(`perspicax directory: routine delegations could not be reconciled: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** D10: people upsert their principal; the ones who are out (disabled, or
   * a known subject now absent) get the back-channel logout effect; a person
   * who stopped being an admin is narrowed at once. */
  private apply(directory: Directory, fetchStartedAt: number): void {
    const iss = this.options.issuer;
    const known = new Map(this.options.principals.listBySubjectIssuer(iss).map((p) => [p.subject!.sub, p] as const));
    const listed = new Set<string>();
    // Slice 4: each person's teams from the members and managers lists
    // (manager wins), and the team names.
    const teamsBySub = new Map<string, Map<string, boolean>>();
    const addTeam = (sub: string, id: string, manager: boolean) => {
      const teams = teamsBySub.get(sub) ?? new Map<string, boolean>();
      teams.set(id, (teams.get(id) ?? false) || manager);
      teamsBySub.set(sub, teams);
    };
    for (const team of directory.teams) {
      for (const sub of team.members) addTeam(sub, team.id, false);
      for (const sub of team.managers) addTeam(sub, team.id, true);
    }
    this.options.teamNames?.replaceFromDirectory(directory.teams.map((team) => ({ id: team.id, name: team.name })));
    const keys = new Map<string, string[]>();
    for (const person of directory.people) {
      // A disabled person's keys serve nobody (S4-14): resolve would answer
      // 409, and the cache must not outlive the disable.
      let names: string[] = person.status === "disabled" ? [] : [...new Set((person.provider_keys ?? []).filter(isKeyProvider))].sort();
      const update = this.providerUpdates.get(person.sub);
      if (person.status !== "disabled" && update && update.at >= fetchStartedAt) names = update.names;
      else this.providerUpdates.delete(person.sub);
      keys.set(person.sub, names);
      if (person.status === "disabled") this.forgetSubject(person.sub);
      // A provider the directory no longer lists for this person: drop its key.
      for (const name of this.keysBySub.get(person.sub) ?? []) if (!names.includes(name)) this.invalidate(person.sub, name);
    }
    for (const sub of this.keysBySub.keys()) {
      if (!keys.has(sub)) this.forgetSubject(sub);
    }
    this.keysBySub = keys;
    for (const person of directory.people) {
      listed.add(person.sub);
      const before = known.get(person.sub);
      const orgRole = person.role === "admin" ? "admin" as const : "member" as const;
      const teams = [...(teamsBySub.get(person.sub) ?? new Map<string, boolean>())].map(([id, manager]) => ({ id, manager }));
      let after: Principal;
      try {
        after = this.options.principals.upsertFromDirectory({ iss, sub: person.sub, name: person.name && person.name !== person.login ? person.name : null, login: person.login, email: person.email, ...(person.avatar !== undefined ? { avatar: person.avatar } : {}), orgRole, teams, perspicaxRole: person.role });
      } catch (error) {
        this.log(`perspicax directory: skipped a person (${error instanceof Error ? error.message : String(error)})`);
        continue;
      }
      if (person.status === "disabled") {
        if (after.disabledAt === undefined) this.options.onPersonOut(iss, person.sub);
        continue;
      }
      // Re-enabled in Perspicax: back in now, not only at the next sign-in
      // (the audit gains person.enabled). A disable that landed after this
      // fetch started is newer than this answer and stays.
      if (after.disabledAt !== undefined) this.options.principals.markEnabled?.(iss, person.sub, fetchStartedAt);
      if (before?.orgRole === "admin" && orgRole !== "admin") this.options.onRoleNarrowed(after.id);
    }
    for (const sub of this.absentSince.keys()) if (listed.has(sub)) this.absentSince.delete(sub);
    for (const [sub, principal] of known) {
      if (listed.has(sub) || principal.disabledAt !== undefined) continue;
      const since = this.absentSince.get(sub);
      if (since === undefined) {
        this.absentSince.set(sub, fetchStartedAt);
        this.log("perspicax directory: a known person is missing from the directory; signed out if still missing on a later answer");
        continue;
      }
      if (fetchStartedAt - since < DIRECTORY_ABSENT_CONFIRM_MS) continue;
      this.absentSince.delete(sub);
      this.options.onPersonOut(iss, sub);
    }
  }

}

/** SAGAX_PERSPICAX_DIRECTORY_SECONDS: an integer from 5 to 3600, default 300. */
export function directoryIntervalMs(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 300_000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 3600) {
    throw new Error("SAGAX_PERSPICAX_DIRECTORY_SECONDS must be a whole number of seconds from 5 to 3600.");
  }
  return parsed * 1000;
}
