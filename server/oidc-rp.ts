// OpenID Connect relying party for the organization server (Backend for
// Frontend). The Sagax server is the OIDC client: it starts the
// authorization code flow with PKCE S256, a `state` and a `nonce`, exchanges
// the code at the token endpoint itself, and verifies the ES256 id_token
// against the issuer's JWKS with node:crypto. No token from the identity
// provider ever reaches a browser, the desktop app, a phone or an engine:
// they receive the ordinary Sagax session (server/sessions.ts).
//
// Pending flows live in memory only: ten minutes, single use, at most
// MAX_PENDING_FLOWS (the oldest is dropped). Each flow is also bound to the
// browser that started it by a random value in a short HttpOnly cookie, so a
// callback URL carrying someone else's code cannot sign a victim's browser in
// as the attacker (login CSRF).
//
// Spec: docs/superpowers/specs/2026-09-29-perspicax-multiuser-design.md,
// section 2 ("Flux de connexion", "Vérification de l'id_token") and T10.
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify as verifySignature, type JsonWebKeyInput, type KeyObject } from "node:crypto";

import { recentSignIn } from "./account-reauth.ts";
import type { RevocationSink, RevokeAttempt } from "./idp-revoke-types.ts";

export type { RevokeAttempt };
import { TokenCallPacer, tokenBudget } from "./idp-token-pacer.ts";
import { authorizationServerMetadataUrls, pkcePair, readBounded, safeEndpoint } from "./mcp-oauth.ts";

export const OIDC_PENDING_FLOW_TTL_MS = 10 * 60_000;
export const OIDC_MAX_PENDING_FLOWS = 20;
/** Clock tolerance on `exp` and `iat`, in seconds. */
export const OIDC_CLOCK_SKEW_SECONDS = 60;
const DISCOVERY_TTL_MS = 60 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_SUB_LENGTH = 255;

/** The claims Sagax reads from a verified id_token. Everything else in the
 * token is ignored; `email` is an attribute, never a key (Perspicax does not
 * verify addresses). */
export interface OidcIdentity {
  iss: string;
  sub: string;
  email?: string;
  name?: string;
  preferredUsername?: string;
  /** The version of the person's avatar, from a `picture` claim on the
   * issuer's own origin (`...?v=<version>`); never fetched from the claim. */
  avatar?: string;
  /** Perspicax role claim, verbatim: `admin`, `manager` or `employee`. */
  role?: string;
  /** Slice 4: the Perspicax `teams` claim, malformed entries dropped.
   * Undefined when the token carries no such claim (never "no teams"). */
  teams?: OidcTeamClaim[];
  authTime?: number;
}

export interface OidcTeamClaim {
  id: string;
  name: string;
  manager: boolean;
}

const TEAM_CLAIM_ID = /^[0-9A-Za-z]{1,64}$/;
export const OIDC_MAX_TEAM_CLAIMS = 1000;

/** The `teams` claim: an array of `{ id, name, manager }`; anything else in
 * it is dropped, one entry per id (manager wins), at most 1000 read.
 * Undefined when the claim is absent or not an array. */
export function parseTeamsClaim(value: unknown): OidcTeamClaim[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const byId = new Map<string, OidcTeamClaim>();
  for (const entry of value.slice(0, OIDC_MAX_TEAM_CLAIMS)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const { id, name, manager } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !TEAM_CLAIM_ID.test(id)) continue;
    if (typeof name !== "string" || name.length > 200) continue;
    if (typeof manager !== "boolean") continue;
    const known = byId.get(id);
    byId.set(id, { id, name, manager: manager || (known?.manager ?? false) });
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface OidcDiscovery {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  /** RFC 9207: the authorization response carries `iss`. When advertised, a
   * callback without it is refused. */
  issParameterSupported: boolean;
  revocationEndpoint?: string;
}

export class OidcError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OidcError";
    this.code = code;
  }
}

export interface OidcRelyingPartyOptions {
  issuer: string;
  clientId: string;
  redirectUri: string;
  /** Space-separated. The default asks for the identity and a refresh
   * token (`offline_access`): the session lives as long as the provider
   * keeps refreshing it (server/idp-session.ts). */
  scope?: string;
  /** RFC 8707 resource for the login access token: the Sagax public
   * origin, so that token is worthless on the identity provider's /mcp. */
  resource?: string;
  /** SAGAX_PERSPICAX_INTERNAL_URL (slice 3, D17): an origin this server
   * reaches the provider at from inside the deployment (a compose service
   * name, http allowed). Discovery, JWKS, token and revocation calls go
   * there; the issuer check is unchanged and the authorization endpoint
   * stays the public one, since the browser follows it. */
  internalBase?: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** The budget of token and revocation calls (server/idp-token-pacer.ts);
   * one is made from SAGAX_PERSPICAX_TOKEN_BUDGET when absent. */
  pacer?: TokenCallPacer;
}

/** A configured server-to-server origin: http or https, any host, no path,
 * query, fragment or credentials. Null otherwise. */
export function validInternalBase(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Who started a sign-in: the browser itself, the desktop app through the
 * system browser, or a phone through its authentication sheet. */
export type OidcClientKind = "web" | "desktop" | "phone";

/** Slice 6: the scope marker of a routine delegation. */
export const ROUTINE_DELEGATION_SCOPE = "pulsabot:routines";
/** The scope a routine delegation asks: `profile email` keep the person's
 * name and address on each refresh (principals drop claims a token lacks). */
export const ROUTINE_DELEGATION_SCOPES = `openid profile email offline_access ${ROUTINE_DELEGATION_SCOPE}`;

/** 2026-10-18: Perspicax's account erasure marker: only a sign-in that
 * carried it opens the erasure there (an ordinary sign-in never does), and
 * its authorize page warns the person. No offline_access: it proves one
 * sign-in, it is not kept. */
export const ACCOUNT_ERASURE_SCOPE = "pulsabot:erase";
export const ACCOUNT_ERASURE_SCOPES = `openid ${ACCOUNT_ERASURE_SCOPE}`;

/** What a flow is for: a sign-in, a routine delegation (slice 6), or the
 * person signing in again right before deleting their account (2026-10-18,
 * server/account-reauth.ts: `prompt=login`, `max_age=0`, a recent
 * `auth_time` checked at the callback). */
export type OidcFlowPurpose = "signin" | "routines" | "reauth";

/** Who started a routine delegation flow, checked at the callback (D10). */
export interface RoutineDelegationExpectation {
  principalId: string;
  subject: { iss: string; sub: string };
  sessionId: string;
}

interface PendingFlow {
  client: OidcClientKind;
  /** A desktop sign-in's validated loopback return, or a phone sign-in's
   * `sagax` return (server/oidc-login.ts). */
  returnTo?: string;
  purpose: OidcFlowPurpose;
  expect?: RoutineDelegationExpectation;
  state: string;
  nonce: string;
  verifier: string;
  /** sha256 of the browser binding cookie value. */
  bindingHash: string;
  createdAt: number;
}

export interface StartedFlow {
  /** Where to send the browser. */
  authorizationUrl: string;
  /** Value of the browser binding cookie (never logged). */
  binding: string;
  state: string;
}

export type CallbackOutcome =
  | {
    ok: true;
    identity: OidcIdentity;
    client: OidcClientKind;
    /** A desktop sign-in's loopback return, when it started with one. */
    returnTo?: string;
    grant: { refreshToken?: string; accessToken?: string; accessExpiresAt?: number };
    /** Slice 6: what the flow was for, the scope the token answer granted
     * (absent when the provider sent none), and for a routine delegation who
     * started it. */
    purpose: OidcFlowPurpose;
    grantedScope?: string;
    expect?: RoutineDelegationExpectation;
  }
  /** `client` (and `purpose`, `returnTo`) are known once the pending flow was found. */
  | { ok: false; code: string; error: string; client?: OidcClientKind; purpose?: OidcFlowPurpose; returnTo?: string };

/** OAuth errors that mean this grant is gone for good (RFC 6749 5.2). Only
 * `invalid_grant` names the grant itself; `invalid_client`,
 * `unauthorized_client`, `invalid_target` and `unsupported_grant_type` name
 * this server's client registration, the same for every person, and come
 * from a provider being redeployed or reconfigured: they are transient
 * (2026-10-20: no sign-out for a Perspicax deploy). */
const REJECTED_GRANT_ERRORS = new Set(["invalid_grant"]);
/** Errors about this server's client registration: transient for a deploy's
 * length (IDP_CLIENT_REFUSED_GRACE_MS), a refusal after. */
const CLIENT_REFUSED_ERRORS = new Set(["invalid_client", "unauthorized_client", "invalid_target", "unsupported_grant_type"]);

/** Default and cap of an access token's life when `expires_in` is missing or
 * out of range (seconds). */
export const ACCESS_TOKEN_DEFAULT_SECONDS = 3600;
export const ACCESS_TOKEN_MAX_SECONDS = 86_400;

/** `expires_in` of a token answer as seconds: the default when missing or
 * not a positive number, never above the cap. */
export function accessExpiresIn(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return ACCESS_TOKEN_DEFAULT_SECONDS;
  return Math.min(Math.floor(value), ACCESS_TOKEN_MAX_SECONDS);
}

export type RefreshOutcome =
  /** `accessToken` (memory only, never kept on disk) and its `expiresIn` in
   * seconds: slice 5 exchanges it for per-turn Perspicax MCP tokens. */
  | { ok: true; refreshToken: string; identity?: OidcIdentity; accessToken?: string; expiresIn?: number; note?: string }
  /** `rejected`: the provider ended the grant (or answered something that
   * cannot be trusted); `transient`: try again later. */
  | { ok: false; kind: "rejected" | "transient"; error: string; rateLimited?: true; retryAfterMs?: number; clientRefused?: true };

/** A Retry-After Perspicax did not send, or sent unreadable, counts as this. */
export const RETRY_AFTER_DEFAULT_MS = 60_000;
export const RETRY_AFTER_MIN_MS = 1_000;
export const RETRY_AFTER_MAX_MS = 600_000;

/** A Retry-After header (delta seconds or an HTTP-date) in milliseconds,
 * clamped to 1 s to 10 min; 60 s when missing or unreadable. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number {
  const text = value?.trim() ?? "";
  let ms: number | null = null;
  if (/^\d{1,10}$/.test(text)) ms = Number(text) * 1000;
  else if (text) {
    const at = Date.parse(text);
    if (Number.isFinite(at)) ms = at - now;
  }
  if (ms === null || !Number.isFinite(ms)) return RETRY_AFTER_DEFAULT_MS;
  return Math.min(RETRY_AFTER_MAX_MS, Math.max(RETRY_AFTER_MIN_MS, ms));
}

/** Whether a provider answer is a rate limit: a 429, or a body saying so. */
export function isRateLimitAnswer(got: { status: number; body: Record<string, unknown> | null }): boolean {
  return got.status === 429 || got.body?.error === "rate_limited";
}

/** The sentence of a deferred refresh. */
export function rateLimitedText(retryAfterMs: number): string {
  return `Perspicax is rate limiting this server (retry in ${Math.max(1, Math.ceil(retryAfterMs / 1000))} s)`;
}

/** One revocation call's outcome: `done` (2xx), `drop` (a definitive 400,
 * or nothing to call), `rate_limited` (429), `retry` (anything else). */
export const RATE_LIMITED_SIGN_IN = "Perspicax is rate limiting sign-ins from this server. Wait a minute and try again.";

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function stringClaim(value: unknown, max = 512): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

function decodeSegment(segment: string, what: string, prefix: TokenKind = "id_token"): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new OidcError(`${prefix}_malformed`, `The ${prefix} ${what} is not base64url.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new OidcError(`${prefix}_malformed`, `The ${prefix} ${what} is not JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new OidcError(`${prefix}_malformed`, `The ${prefix} ${what} is not an object.`);
  return parsed as Record<string, unknown>;
}

/** A P-256 signing key from a JWKS entry, or null when the entry is not one. */
function es256Key(jwk: Record<string, unknown>): KeyObject | null {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") return null;
  if (jwk.use !== undefined && jwk.use !== "sig") return null;
  if (jwk.alg !== undefined && jwk.alg !== "ES256") return null;
  if (typeof jwk.x !== "string" || typeof jwk.y !== "string" || jwk.d !== undefined) return null;
  try {
    const input: JsonWebKeyInput = { key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" };
    return createPublicKey(input);
  } catch {
    return null;
  }
}

type TokenKind = "id_token" | "logout_token" | "console_assertion";

/** Slice 7: the header `typ` of a console assertion (Perspicax signs one per
 * proxied console request). Never an id_token nor a logout token. */
export const CONSOLE_ASSERTION_TYP = "pulsabot-console+jwt";
/** The longest life a console assertion may claim (exp - iat), in seconds. */
export const CONSOLE_ASSERTION_MAX_LIFE_SECONDS = 120;
/** Clock tolerance on a console assertion's `exp` and `iat`, in seconds. Far
 * tighter than the id_token's 60 s: the assertion is minted per request and
 * lives 60 s, so a 60 s tolerance would let it work for two minutes. */
export const CONSOLE_ASSERTION_SKEW_SECONDS = 5;

/** The OpenID Connect Back-Channel Logout 1.0 event key. */
export const BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";
/** The RISC "account purged" event (OpenID RISC Profile 1.0) Perspicax adds
 * to a logout token once it erased the person's account: this server then
 * erases their data too (server/oidc-login.ts, OidcGrantKeeper.purgePerson). */
export const ACCOUNT_PURGED_EVENT = "https://schemas.openid.net/secevent/risc/event-type/account-purged";

interface JwsCheck {
  token: string;
  issuer: string;
  audience: string;
  /** Looks a key up by `kid`; may refetch the JWKS once. */
  keyFor: (kid: string) => Promise<KeyObject | null>;
  nowSeconds: number;
  skewSeconds?: number;
}

/** A compact JWS signed ES256 by a key the issuer publishes, whose iss, aud
 * (and azp when there are several audiences), exp and iat hold. Returns the
 * header and the claims; throws OidcError with a `<kind>_...` code. */
async function verifyJws(input: JwsCheck, kind: TokenKind): Promise<{ header: Record<string, unknown>; claims: Record<string, unknown> }> {
  const skew = input.skewSeconds ?? OIDC_CLOCK_SKEW_SECONDS;
  const parts = input.token.split(".");
  if (parts.length !== 3) throw new OidcError(`${kind}_malformed`, `The ${kind} is not a compact JWS.`);
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = decodeSegment(headerPart, "header", kind);
  if (header.alg !== "ES256") throw new OidcError(`${kind}_alg`, `The ${kind} algorithm must be ES256, not ${String(header.alg).slice(0, 20)}.`);
  if (header.crit !== undefined) throw new OidcError(`${kind}_malformed`, `The ${kind} carries critical header parameters.`);
  const kid = stringClaim(header.kid, 256);
  if (!kid) throw new OidcError(`${kind}_kid`, `The ${kind} has no key id.`);
  const key = await input.keyFor(kid);
  if (!key) throw new OidcError(`${kind}_kid`, `The ${kind} was signed with a key the issuer does not publish.`);
  if (!/^[A-Za-z0-9_-]+$/.test(signaturePart)) throw new OidcError(`${kind}_signature`, `The ${kind} signature is not base64url.`);
  const signature = Buffer.from(signaturePart, "base64url");
  if (signature.length !== 64) throw new OidcError(`${kind}_signature`, `The ${kind} signature has the wrong length.`);
  const valid = verifySignature("sha256", Buffer.from(`${headerPart}.${payloadPart}`), { key, dsaEncoding: "ieee-p1363" }, signature);
  if (!valid) throw new OidcError(`${kind}_signature`, `The ${kind} signature does not verify.`);

  const claims = decodeSegment(payloadPart, "payload", kind);
  if (claims.iss !== input.issuer) throw new OidcError(`${kind}_iss`, `The ${kind} was issued by another issuer.`);
  const aud = claims.aud;
  const audiences = typeof aud === "string" ? [aud] : Array.isArray(aud) ? aud.filter((v): v is string => typeof v === "string") : [];
  if (!audiences.includes(input.audience)) throw new OidcError(`${kind}_aud`, `The ${kind} is meant for another client.`);
  if (audiences.length > 1 && claims.azp !== input.audience) throw new OidcError(`${kind}_aud`, `The ${kind} names several audiences without this client as its party.`);
  if (claims.azp !== undefined && claims.azp !== input.audience) throw new OidcError(`${kind}_aud`, `The ${kind} was issued to another client.`);
  const exp = claims.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) throw new OidcError(`${kind}_exp`, `The ${kind} has no expiry.`);
  if (exp + skew <= input.nowSeconds) throw new OidcError(`${kind}_exp`, `The ${kind} has expired.`);
  const iat = claims.iat;
  if (typeof iat !== "number" || !Number.isFinite(iat)) throw new OidcError(`${kind}_iat`, `The ${kind} has no issue time.`);
  if (iat - skew > input.nowSeconds) throw new OidcError(`${kind}_iat`, `The ${kind} was issued in the future.`);
  return { header, claims };
}

export interface VerifyIdTokenInput extends JwsCheck {
  /** The sign-in's nonce, or null for an id_token from a refresh, which must
   * carry none (OpenID Connect Core 12.2). */
  nonce: string | null;
}

/** Verify a compact JWS id_token: alg exactly ES256 (never `none`), a kid the
 * JWKS knows, a valid P-256 signature, then iss, aud (and azp when there are
 * several audiences), exp, iat and nonce. A logout token (typ `logout+jwt`
 * or an `events` claim) is never an id_token. Throws OidcError on any failure. */
/** The avatar version a `picture` claim carries: the claim must be a URL on
 * the issuer's own origin with a `v` query parameter (Perspicax:
 * `<issuer>/api/v1/pulsabot/people/<sub>/avatar?v=<version>`). Anything else
 * (another host, no version) is ignored; Sagax reads the image through the
 * link, never from the claim. */
export function avatarVersionFromPicture(picture: unknown, issuer: string): string | undefined {
  if (typeof picture !== "string" || !picture || picture.length > 2048) return undefined;
  let url: URL;
  let issuerOrigin: string;
  try {
    url = new URL(picture);
    issuerOrigin = new URL(issuer).origin;
  } catch {
    return undefined;
  }
  if (url.origin !== issuerOrigin) return undefined;
  const version = url.searchParams.get("v") ?? "";
  return /^[0-9A-Za-z_-]{1,64}$/.test(version) ? version : undefined;
}

export async function verifyIdToken(input: VerifyIdTokenInput): Promise<OidcIdentity> {
  const { header, claims } = await verifyJws(input, "id_token");
  if (typeof header.typ === "string" && header.typ.toLowerCase().includes("logout")) throw new OidcError("id_token_typ", "A logout token is not an id_token.");
  if (typeof header.typ === "string" && header.typ.toLowerCase() === CONSOLE_ASSERTION_TYP) throw new OidcError("id_token_typ", "A console assertion is not an id_token.");
  if (claims.events !== undefined) throw new OidcError("id_token_typ", "A token carrying events is not an id_token.");
  if (input.nonce === null) {
    if (claims.nonce !== undefined) throw new OidcError("id_token_nonce", "A refreshed id_token must not carry a nonce.");
  } else if (typeof claims.nonce !== "string" || !sameText(claims.nonce, input.nonce)) {
    throw new OidcError("id_token_nonce", "The id_token nonce does not match this sign-in.");
  }
  const sub = stringClaim(claims.sub, MAX_SUB_LENGTH);
  if (!sub) throw new OidcError("id_token_sub", "The id_token has no subject.");

  const identity: OidcIdentity = { iss: input.issuer, sub };
  const email = stringClaim(claims.email, 320);
  if (email) identity.email = email;
  const name = stringClaim(claims.name, 200);
  if (name) identity.name = name;
  const login = stringClaim(claims.preferred_username, 200);
  if (login) identity.preferredUsername = login;
  const avatar = avatarVersionFromPicture(claims.picture, input.issuer);
  if (avatar) identity.avatar = avatar;
  const role = stringClaim(claims.role, 40);
  if (role) identity.role = role;
  const teams = parseTeamsClaim(claims.teams);
  if (teams) identity.teams = teams;
  if (typeof claims.auth_time === "number" && Number.isFinite(claims.auth_time)) identity.authTime = claims.auth_time;
  return identity;
}

/** What a verified logout token names. */
export interface LogoutClaims {
  iss: string;
  sub: string;
  jti: string;
  /** Seconds since the epoch. */
  exp: number;
  /** The token also carries ACCOUNT_PURGED_EVENT: the account was erased at
   * the provider, so the person's data here goes too. */
  purged?: true;
}

/** Verify an OpenID Connect Back-Channel Logout 1.0 logout token: the same
 * signature, iss, aud, exp and iat rules as an id_token (exp is required),
 * header typ absent, `JWT` or `logout+jwt`, a `jti`, the back-channel event,
 * no `nonce` (so an id_token is never a logout token) and a `sub` (sessions
 * are not tracked by `sid`, so a sid-only token is refused). */
export async function verifyLogoutToken(input: JwsCheck): Promise<LogoutClaims> {
  const { header, claims } = await verifyJws(input, "logout_token");
  if (header.typ !== undefined && header.typ !== "JWT" && header.typ !== "logout+jwt") throw new OidcError("logout_token_typ", "The logout token has an unexpected type.");
  if (claims.act !== undefined) throw new OidcError("logout_token_typ", "A console assertion is not a logout token.");
  if (claims.nonce !== undefined) throw new OidcError("logout_token_nonce", "A logout token must not carry a nonce.");
  const events = claims.events;
  if (!events || typeof events !== "object" || Array.isArray(events)) throw new OidcError("logout_token_events", "The logout token carries no events.");
  const event = (events as Record<string, unknown>)[BACKCHANNEL_LOGOUT_EVENT];
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new OidcError("logout_token_events", "The logout token carries no back-channel logout event.");
  const jti = stringClaim(claims.jti, 256);
  if (!jti) throw new OidcError("logout_token_jti", "The logout token has no identifier.");
  const sub = stringClaim(claims.sub, MAX_SUB_LENGTH);
  if (!sub) throw new OidcError("logout_token_sub", "The logout token names no subject.");
  // The account purged event (an object) says the account was erased. Its
  // `subject` (iss_sub), when present, must name this token's person: a
  // token naming one person and purging another is refused whole.
  const purgedEvent = (events as Record<string, unknown>)[ACCOUNT_PURGED_EVENT];
  let purged = false;
  if (purgedEvent !== undefined) {
    if (!purgedEvent || typeof purgedEvent !== "object" || Array.isArray(purgedEvent)) throw new OidcError("logout_token_events", "The account purged event is not an object.");
    const subject = (purgedEvent as Record<string, unknown>).subject;
    if (subject !== undefined) {
      if (!subject || typeof subject !== "object" || Array.isArray(subject)) throw new OidcError("logout_token_events", "The account purged event names no subject.");
      const named = subject as Record<string, unknown>;
      if ((named.iss !== undefined && named.iss !== input.issuer) || (named.sub !== undefined && named.sub !== sub)) {
        throw new OidcError("logout_token_events", "The account purged event names another subject.");
      }
    }
    purged = true;
  }
  return { iss: input.issuer, sub, jti, exp: claims.exp as number, ...(purged ? { purged: true as const } : {}) };
}

/** What a verified console assertion names (slice 7). */
export interface ConsoleAssertion {
  iss: string;
  /** The console person's Perspicax user id. */
  sub: string;
  jti: string;
  /** Seconds since the epoch. */
  iat: number;
  exp: number;
  serverId: string | null;
  role: "admin" | "manager" | "employee";
  teams: OidcTeamClaim[];
  /** The console person's language (`fr`, `en`), when the console sends it:
   * the readable reasons of the admin API follow it. */
  locale?: string;
  /** Who presents it for the person (`act.sub`): `console` (the Perspicax
   * console), `perspicax-mcp` (an AI client attached to Perspicax, the
   * member API of 2026-10-09), `perspicax-mail` (the mail relay delivering
   * a mail to one of the person's bots, 2026-10-21) or `perspicax-voice`
   * (Perspicax Voice delivering an event of the person's phone line,
   * 2026-10-26). */
  actor: ConsoleAssertionActor;
  /** `body_sha256`: lowercase hex SHA-256 of the exact request body, when
   * the signer binds the assertion to it (the mail relay must, contract v2
   * of 2026-10-21, and Perspicax Voice too; the route compares it). Absent
   * otherwise. */
  bodySha256?: string;
  /** `client_name` (2026-10-29): the name of the AI client or connection
   * that made this call (`perspicax-mcp` only), signed by Perspicax. Sagax
   * names the outside agent's conversation with a bot after it
   * (shared/agent-conversation.ts). Absent from an older Perspicax. */
  clientName?: string;
  /** `grant`: a narrow capability bound to one request, for a person below
   * a route's role who reaches something of their own. `own-computer`
   * (2026-10-26): the person's own server environment, on the routes that
   * declare it (server/org-admin-computers.ts), for that method and path
   * below /api/org/admin/ only; the route then answers only what the person
   * owns. `own-bot` (their own bots: the list, a bot, its files, picture,
   * package, copy, archive, restore, model, stop, delete, its usage,
   * incidents, log lines and activity) and `own-routine` (the routines of
   * their own bots: the list, one, its runs, run now, pause) work the same
   * way, so a person never needs a role above their own for their own
   * things. Absent otherwise. */
  grant?: ConsoleGrant;
}

/** The capabilities a console assertion's `grant` may name. */
export const CONSOLE_GRANT_KINDS = ["own-computer", "own-bot", "own-routine"] as const;
export type ConsoleGrantKind = typeof CONSOLE_GRANT_KINDS[number];

/** One request a `grant` covers: its kind, its method and its path below
 * /api/org/admin/ (no query). */
export interface ConsoleGrant {
  kind: ConsoleGrantKind;
  method: "GET" | "POST";
  path: string;
}

/** A `grant` claim as signed, or null when it is not one. Strict: exactly
 * `kind`, `method` and `path`, a known kind, GET or POST, a path of id
 * characters at most 256 long. */
export function parseGrantClaim(value: unknown): ConsoleGrant | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const claim = value as Record<string, unknown>;
  const keys = Object.keys(claim).sort();
  if (keys.length !== 3 || keys[0] !== "kind" || keys[1] !== "method" || keys[2] !== "path") return null;
  const { kind, method, path } = claim;
  if (typeof kind !== "string" || !(CONSOLE_GRANT_KINDS as readonly string[]).includes(kind)) return null;
  if (method !== "GET" && method !== "POST") return null;
  if (typeof path !== "string" || path.length < 1 || path.length > 256 || !/^[A-Za-z0-9_.:@%/-]+$/.test(path) || path.includes("..")) return null;
  return { kind: kind as ConsoleGrantKind, method, path };
}

/** The actors a console assertion may name. The admin API accepts only the
 * console; the member API (server/org-member-routes.ts) accepts the console
 * and `perspicax-mcp`; `perspicax-mail` (the Perspicax mail relay,
 * 2026-10-21) is accepted by `POST /api/org/inbound-mail` alone
 * (server/bot-inbound-mail.ts); `perspicax-voice` (Perspicax Voice,
 * 2026-10-26) by `POST /api/org/telephony/inbound` alone
 * (server/bot-inbound-telephony.ts). */
export const CONSOLE_ASSERTION_ACTORS = ["console", "perspicax-mcp", "perspicax-mail", "perspicax-voice"] as const;
export type ConsoleAssertionActor = typeof CONSOLE_ASSERTION_ACTORS[number];

export interface VerifyConsoleAssertionInput extends JwsCheck {
  /** The link file's server id when a link is loaded: the assertion's
   * `server_id` must equal it. */
  serverId?: string | null;
  /** The `act.sub` values accepted; the console alone when absent. */
  actors?: readonly ConsoleAssertionActor[];
}

const CONSOLE_ROLES = new Set(["admin", "manager", "employee"]);

/** Verify a console assertion: the same ES256 signature, iss, exp and iat
 * rules as the other two tokens, then `aud` a single string equal to this
 * server's public origin, header `typ` exactly `pulsabot-console+jwt`,
 * `act.sub` "console", no nonce, no events, exp - iat at most 120 s, a `jti`
 * of 16 to 256 characters, a role, the teams, and the server id when known.
 * The replay cache is the caller's (server/org-admin-routes.ts). */
export async function verifyConsoleAssertion(input: VerifyConsoleAssertionInput): Promise<ConsoleAssertion> {
  const kind = "console_assertion";
  const { header, claims } = await verifyJws({ ...input, skewSeconds: input.skewSeconds ?? CONSOLE_ASSERTION_SKEW_SECONDS }, kind);
  if (header.typ !== CONSOLE_ASSERTION_TYP) throw new OidcError(`${kind}_typ`, "The token is not a console assertion.");
  // One audience string, never an array, and no authorized party.
  if (typeof claims.aud !== "string" || claims.aud !== input.audience || claims.azp !== undefined) throw new OidcError(`${kind}_aud`, "The console assertion must name this server as its one audience.");
  const act = claims.act;
  const actors: readonly string[] = input.actors ?? ["console"];
  const actor = act && typeof act === "object" && !Array.isArray(act) ? (act as Record<string, unknown>).sub : undefined;
  if (typeof actor !== "string" || !actors.includes(actor)) {
    throw new OidcError(`${kind}_act`, actors.length === 1 && actors[0] === "console"
      ? "The console assertion does not name the console as its actor."
      : "The assertion does not name an actor this route accepts.");
  }
  if (claims.nonce !== undefined) throw new OidcError(`${kind}_nonce`, "A console assertion must not carry a nonce.");
  if (claims.events !== undefined) throw new OidcError(`${kind}_events`, "A console assertion must not carry events.");
  const exp = claims.exp as number;
  const iat = claims.iat as number;
  if (exp - iat > CONSOLE_ASSERTION_MAX_LIFE_SECONDS) throw new OidcError(`${kind}_exp`, "The console assertion lives too long.");
  const sub = stringClaim(claims.sub, 256);
  if (!sub) throw new OidcError(`${kind}_sub`, "The console assertion names no person.");
  const jti = typeof claims.jti === "string" && claims.jti.length >= 16 && claims.jti.length <= 256 ? claims.jti : undefined;
  if (!jti) throw new OidcError(`${kind}_jti`, "The console assertion has no usable identifier.");
  const role = claims.role;
  if (typeof role !== "string" || !CONSOLE_ROLES.has(role)) throw new OidcError(`${kind}_role`, "The console assertion carries no known role.");
  const teams = claims.teams === undefined ? [] : parseTeamsClaim(claims.teams);
  if (!teams) throw new OidcError(`${kind}_teams`, "The console assertion teams are not a list.");
  const serverId = stringClaim(claims.server_id, 256) ?? null;
  if (input.serverId && serverId !== input.serverId) throw new OidcError(`${kind}_server`, "The console assertion is meant for another linked server.");
  const locale = typeof claims.locale === "string" && /^[A-Za-z]{2}([-_][A-Za-z0-9]{2,8})?$/.test(claims.locale) ? claims.locale : undefined;
  if (claims.body_sha256 !== undefined && (typeof claims.body_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(claims.body_sha256))) {
    throw new OidcError(`${kind}_body`, "The assertion's body digest is not a SHA-256.");
  }
  const bodySha256 = typeof claims.body_sha256 === "string" ? claims.body_sha256 : undefined;
  // a display name only: a wrong shape is dropped, never a refusal
  const clientName = stringClaim(claims.client_name, 200);
  const grant = claims.grant === undefined ? undefined : parseGrantClaim(claims.grant);
  if (grant === null) throw new OidcError(`${kind}_grant`, "The assertion's grant is not one this server knows.");
  return { iss: input.issuer, sub, jti, iat, exp, serverId, role: role as ConsoleAssertion["role"], teams, ...(locale ? { locale } : {}), actor: actor as ConsoleAssertionActor, ...(bodySha256 ? { bodySha256 } : {}), ...(clientName ? { clientName } : {}), ...(grant ? { grant } : {}) };
}

/** An issuer URL the server may talk to: https, or http on this machine
 * (tests and a local compose). */
export function validIssuer(value: string): string | null {
  const trimmed = value.trim();
  if (!safeEndpoint(trimmed)) return null;
  const url = new URL(trimmed);
  if (url.search || url.hash) return null;
  // The issuer is compared byte for byte with `iss`: keep it as configured,
  // minus a lone trailing slash on a bare origin.
  return url.pathname === "/" ? trimmed.replace(/\/$/, "") : trimmed;
}

export class OidcRelyingParty {
  readonly issuer: string;
  readonly clientId: string;
  readonly redirectUri: string;
  private readonly scope: string;
  private readonly resource: string | undefined;
  private readonly internalBase: string | null;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  /** The one budget of this server's /oauth/token and /oauth/revoke calls. */
  readonly pacer: TokenCallPacer;
  private revocations: RevocationSink | null = null;
  private readonly pending = new Map<string, PendingFlow>();
  private discovery: { value: OidcDiscovery; at: number } | null = null;
  private discovering: Promise<OidcDiscovery> | null = null;
  private keys = new Map<string, KeyObject>();
  private keysFetched = false;
  private refetching: Promise<void> | null = null;

  constructor(options: OidcRelyingPartyOptions) {
    const issuer = validIssuer(options.issuer);
    if (!issuer) throw new OidcError("config", "The OIDC issuer must be an https URL (http only on this machine).");
    const redirect = safeEndpoint(options.redirectUri);
    if (!redirect) throw new OidcError("config", "The OIDC redirect URI must be an https URL (http only on this machine).");
    if (!options.clientId.trim()) throw new OidcError("config", "The OIDC client id is required.");
    this.issuer = issuer;
    this.clientId = options.clientId.trim();
    this.redirectUri = options.redirectUri.trim();
    this.scope = options.scope?.trim() || "openid profile email offline_access";
    this.resource = options.resource;
    this.internalBase = options.internalBase === undefined ? null : validInternalBase(options.internalBase);
    if (options.internalBase !== undefined && !this.internalBase) throw new OidcError("config", "The internal provider URL must be an http or https origin with no path.");
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.pacer = options.pacer ?? new TokenCallPacer({ budget: tokenBudget(process.env.SAGAX_PERSPICAX_TOKEN_BUDGET), now: this.now });
  }

  /** Revocations this party starts go through `sink` (the durable queue,
   * server/idp-revocations.ts) once set. */
  setRevocations(sink: RevocationSink | null): void {
    this.revocations = sink;
  }

  /** Where server-to-server calls reach the provider: the internal base
   * when configured, else the issuer's origin. */
  serverOrigin(): string {
    return this.internalBase ?? new URL(this.issuer).origin;
  }

  /** Pending flows, for tests and diagnostics (never the secrets). */
  pendingCount(): number {
    this.prune();
    return this.pending.size;
  }

  private prune(): void {
    const now = this.now();
    for (const [state, flow] of this.pending) if (now - flow.createdAt >= OIDC_PENDING_FLOW_TTL_MS) this.pending.delete(state);
  }

  private async getJson(url: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> | null; retryAfterMs: number }> {
    let response: Response;
    try {
      response = await this.fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "application/json", ...init?.headers } });
    } catch (error) {
      throw new OidcError("unreachable", `The identity provider could not be reached: ${error instanceof Error ? error.message : String(error)}`);
    }
    let body: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(await readBounded(response));
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      body = null;
    }
    return { status: response.status, body, retryAfterMs: parseRetryAfter(response.headers.get("retry-after"), this.now()) };
  }

  /** The issuer's metadata, cached for an hour. The document's `issuer` must
   * equal the configured one exactly, and every endpoint must be https (or
   * http on this machine). */
  async discover(force = false): Promise<OidcDiscovery> {
    if (!force && this.discovery && this.now() - this.discovery.at < DISCOVERY_TTL_MS) return this.discovery.value;
    this.discovering ??= (async () => {
      try {
        let lastError = "no discovery document";
        // OpenID Connect Discovery first: this is an OIDC client.
        const urls = authorizationServerMetadataUrls(this.issuer).map((u) => this.internalUrl(u));
        const ordered = [...urls.filter((u) => u.includes("openid-configuration")), ...urls.filter((u) => !u.includes("openid-configuration"))];
        for (const url of ordered) {
          let got: { status: number; body: Record<string, unknown> | null; retryAfterMs: number };
          try {
            got = await this.getJson(url);
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            continue;
          }
          if (got.status !== 200 || !got.body) {
            lastError = `${url} answered ${got.status}`;
            continue;
          }
          const doc = got.body;
          if (doc.issuer !== this.issuer) throw new OidcError("discovery", "The identity provider's metadata names another issuer.");
          // The browser follows the authorization endpoint: never rewritten.
          const authorizationEndpoint = safeEndpoint(doc.authorization_endpoint);
          const tokenEndpoint = this.serverEndpoint(doc.token_endpoint);
          const jwksUri = this.serverEndpoint(doc.jwks_uri);
          if (!authorizationEndpoint || !tokenEndpoint || !jwksUri) {
            throw new OidcError("discovery", "The identity provider's metadata lacks an https authorization, token or JWKS endpoint.");
          }
          const algs = doc.id_token_signing_alg_values_supported;
          if (Array.isArray(algs) && !algs.includes("ES256")) throw new OidcError("discovery", "The identity provider does not sign id_tokens with ES256.");
          const value: OidcDiscovery = {
            issuer: this.issuer,
            authorizationEndpoint,
            tokenEndpoint,
            jwksUri,
            issParameterSupported: doc.authorization_response_iss_parameter_supported === true,
            ...(this.serverEndpoint(doc.revocation_endpoint) ? { revocationEndpoint: this.serverEndpoint(doc.revocation_endpoint) } : {}),
          };
          if (this.discovery?.value.jwksUri !== value.jwksUri) {
            this.keys = new Map();
            this.keysFetched = false;
          }
          this.discovery = { value, at: this.now() };
          return value;
        }
        throw new OidcError("discovery", `The identity provider's metadata could not be read (${lastError}).`);
      } finally {
        this.discovering = null;
      }
    })();
    return this.discovering;
  }

  /** A URL on the issuer's origin, moved to the internal origin when one is
   * configured. Anything else is returned unchanged. */
  private internalUrl(value: string): string {
    if (!this.internalBase) return value;
    try {
      const url = new URL(value);
      if (url.origin !== new URL(this.issuer).origin) return value;
      return `${this.internalBase}${url.pathname}${url.search}`;
    } catch {
      return value;
    }
  }

  /** A server-to-server endpoint from the metadata: on the issuer's origin
   * with an internal base configured, it moves there (http allowed, since
   * that origin comes from configuration); otherwise https (or loopback
   * http) as before. */
  private serverEndpoint(value: unknown): string | undefined {
    if (this.internalBase && typeof value === "string" && value) {
      try {
        const url = new URL(value);
        if (!url.username && !url.password && !url.hash && url.origin === new URL(this.issuer).origin) return this.internalUrl(url.toString());
      } catch {
        return undefined;
      }
    }
    return safeEndpoint(value);
  }

  private async fetchKeys(): Promise<void> {
    const { jwksUri } = await this.discover();
    const got = await this.getJson(jwksUri);
    if (got.status !== 200 || !got.body || !Array.isArray(got.body.keys)) throw new OidcError("jwks", "The identity provider's JWKS could not be read.");
    const next = new Map<string, KeyObject>();
    for (const entry of got.body.keys) {
      if (!entry || typeof entry !== "object") continue;
      const jwk = entry as Record<string, unknown>;
      const kid = stringClaim(jwk.kid, 256);
      const key = kid ? es256Key(jwk) : null;
      if (kid && key) next.set(kid, key);
    }
    this.keys = next;
    this.keysFetched = true;
  }

  /** A signing key by kid: from the cache, else after one JWKS refetch
   * (single flight), so a rotated key is picked up without a restart. */
  private async keyFor(kid: string): Promise<KeyObject | null> {
    const cached = this.keysFetched ? this.keys.get(kid) : undefined;
    if (cached) return cached;
    this.refetching ??= this.fetchKeys().finally(() => { this.refetching = null; });
    await this.refetching;
    return this.keys.get(kid) ?? null;
  }

  /** Begin a sign-in: remember state, nonce and PKCE verifier, and return
   * the authorization URL and the browser binding. */
  async start(options: { client?: OidcClientKind; returnTo?: string; purpose?: OidcFlowPurpose; principalId?: string; subject?: { iss: string; sub: string }; sessionId?: string; fresh?: boolean } = {}): Promise<StartedFlow> {
    const purpose = options.purpose ?? "signin";
    let expect: RoutineDelegationExpectation | undefined;
    if (purpose === "routines" || purpose === "reauth") {
      if (!options.principalId || !options.subject || !options.sessionId) {
        throw new OidcError(purpose === "routines" ? "routines_session" : "reauth_session", purpose === "routines" ? "A routine delegation starts from a signed-in session." : "Signing in again starts from a signed-in session.");
      }
      expect = { principalId: options.principalId, subject: { ...options.subject }, sessionId: options.sessionId };
    }
    const discovery = await this.discover();
    this.prune();
    while (this.pending.size >= OIDC_MAX_PENDING_FLOWS) {
      const oldest = this.pending.keys().next().value;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
    const state = randomToken();
    const nonce = randomToken();
    const binding = randomToken();
    const { verifier, challenge } = pkcePair();
    const client = purpose === "routines" ? "web" : options.client ?? "web";
    this.pending.set(state, {
      client,
      // Only a desktop sign-in comes back to a loopback listener, only a
      // phone sign-in to its app's scheme (PHONE_SAGAX_RETURN), and a web
      // sign-in only to a published page's reading link on this server
      // (2026-10-28, #1486; checked by server/oidc-login.ts webPageReturn).
      ...(options.returnTo && (client === "desktop" || client === "phone" || purpose === "signin") ? { returnTo: options.returnTo } : {}),
      purpose,
      ...(expect ? { expect } : {}),
      state,
      nonce,
      verifier,
      bindingHash: sha256Hex(binding),
      createdAt: this.now(),
    });
    const url = new URL(discovery.authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("scope", purpose === "routines" ? ROUTINE_DELEGATION_SCOPES : purpose === "reauth" ? ACCOUNT_ERASURE_SCOPES : this.scope);
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (this.resource) url.searchParams.set("resource", this.resource);
    // Slice 6: the delegation names who started it, so Perspicax never mints
    // one for another account that signs in there (it would replace that
    // account's own delegation).
    if (expect) url.searchParams.set("login_hint", expect.subject.sub);
    // 2026-10-18: a sign-in again, never an existing session at the
    // provider (OIDC Core 3.1.2.1); the callback checks auth_time. The same
    // for "Sign in again" (`fresh`, 2026-10-19), whose session counts as a
    // recent sign-in only from a recent auth_time (server/recent-sign-in.ts).
    if (purpose === "reauth" || (purpose === "signin" && options.fresh)) {
      url.searchParams.set("prompt", "login");
      url.searchParams.set("max_age", "0");
    }
    return { authorizationUrl: url.toString(), binding, state };
  }

  /** Finish a sign-in from the callback's query and the browser binding
   * cookie. The pending flow is consumed whatever the outcome. */
  async callback(params: URLSearchParams, binding: string | undefined): Promise<CallbackOutcome> {
    const seen: { client?: OidcClientKind; purpose?: OidcFlowPurpose; returnTo?: string } = {};
    try {
      const done = await this.finish(params, binding, seen);
      return {
        ok: true,
        identity: done.identity,
        client: done.client,
        ...(seen.returnTo ? { returnTo: seen.returnTo } : {}),
        grant: {
          ...(done.refreshToken ? { refreshToken: done.refreshToken } : {}),
          ...(done.accessToken ? { accessToken: done.accessToken, accessExpiresAt: done.accessExpiresAt } : {}),
        },
        purpose: done.purpose,
        ...(done.grantedScope !== undefined ? { grantedScope: done.grantedScope } : {}),
        ...(done.expect ? { expect: done.expect } : {}),
      };
    } catch (error) {
      const client = {
        ...(seen.client ? { client: seen.client } : {}),
        ...(seen.purpose ? { purpose: seen.purpose } : {}),
        ...(seen.returnTo ? { returnTo: seen.returnTo } : {}),
      };
      if (error instanceof OidcError) return { ok: false, code: error.code, error: error.message, ...client };
      return { ok: false, code: "internal", error: error instanceof Error ? error.message : String(error), ...client };
    }
  }

  private async finish(params: URLSearchParams, binding: string | undefined, seen: { client?: OidcClientKind; purpose?: OidcFlowPurpose; returnTo?: string }): Promise<{ identity: OidcIdentity; client: OidcClientKind; purpose: OidcFlowPurpose; grantedScope?: string; expect?: RoutineDelegationExpectation; refreshToken?: string; accessToken?: string; accessExpiresAt?: number }> {
    this.prune();
    const state = params.get("state") ?? "";
    const flow = state ? this.pending.get(state) : undefined;
    if (!flow) throw new OidcError("state", "This sign-in link is unknown, already used or expired. Start again.");
    this.pending.delete(state); // single use, whatever happens next
    seen.client = flow.client;
    seen.purpose = flow.purpose;
    if (flow.returnTo) seen.returnTo = flow.returnTo;
    if (!binding || !sameText(sha256Hex(binding), flow.bindingHash)) {
      throw new OidcError("binding", "This sign-in was started in another browser. Start again here.");
    }
    const discovery = await this.discover();
    const iss = params.get("iss");
    if (iss !== null ? iss !== this.issuer : discovery.issParameterSupported) {
      throw new OidcError("iss", "The sign-in response came from another issuer.");
    }
    const providerError = params.get("error");
    if (providerError) {
      const description = params.get("error_description");
      throw new OidcError("provider", `The identity provider refused the sign-in (${providerError.slice(0, 64)}${description ? `: ${description.slice(0, 200)}` : ""}).`);
    }
    const code = params.get("code");
    if (!code) throw new OidcError("code", "The sign-in response carries no code.");

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      code_verifier: flow.verifier,
    });
    if (this.resource) form.set("resource", this.resource);
    await this.pacer.acquire("exchange");
    const got = await this.getJson(discovery.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (isRateLimitAnswer(got)) {
      this.pacer.noteRateLimited(got.retryAfterMs);
      throw new OidcError("rate_limited", RATE_LIMITED_SIGN_IN);
    }
    if (got.status !== 200 || !got.body) {
      const reason = typeof got.body?.error === "string" ? got.body.error.slice(0, 64) : `HTTP ${got.status}`;
      throw new OidcError("token", `The identity provider refused the code exchange (${reason}).`);
    }
    const idToken = got.body.id_token;
    if (typeof idToken !== "string" || !idToken) throw new OidcError("id_token_missing", "The identity provider returned no id_token; is `openid` allowed for this client?");
    const refresh = typeof got.body.refresh_token === "string" && got.body.refresh_token ? got.body.refresh_token : undefined;
    const access = typeof got.body.access_token === "string" && got.body.access_token ? got.body.access_token : undefined;
    try {
      const identity = await verifyIdToken({
        token: idToken,
        issuer: this.issuer,
        audience: this.clientId,
        nonce: flow.nonce,
        keyFor: (kid) => this.keyFor(kid),
        nowSeconds: Math.floor(this.now() / 1000),
      });
      // max_age was asked: the sign-in must be recent (OIDC Core 3.1.2.1).
      if (flow.purpose === "reauth" && !recentSignIn(identity.authTime, this.now())) {
        throw new OidcError("reauth_stale", "Perspicax did not sign you in again just now. Start again.");
      }
      const grantedScope = typeof got.body.scope === "string" ? got.body.scope.slice(0, 1024) : undefined;
      return {
        identity,
        client: flow.client,
        purpose: flow.purpose,
        ...(grantedScope !== undefined ? { grantedScope } : {}),
        ...(flow.expect ? { expect: flow.expect } : {}),
        ...(refresh ? { refreshToken: refresh } : {}),
        ...(access ? { accessToken: access, accessExpiresAt: this.now() + accessExpiresIn(got.body.expires_in) * 1000 } : {}),
      };
    } catch (error) {
      // A sign-in that does not verify keeps nothing: end the grant it
      // produced rather than leave a live refresh family at the provider
      // (RFC 7009; revoking the refresh token also ends its access tokens).
      if (discovery.revocationEndpoint && (refresh || access)) {
        this.revoke(refresh ?? access!, refresh ? "refresh_token" : "access_token", "a sign-in that did not verify");
      }
      throw error;
    }
  }

  /** Refresh a grant (RFC 6749 section 6) with the Sagax origin as its
   * resource. The provider rotates the refresh token; the new one comes back.
   * An id_token on a refresh is optional; when present it must verify with no
   * nonce and name the same subject. Never throws. */
  async refresh(refreshToken: string, expect: { sub: string }): Promise<RefreshOutcome> {
    let discovery: OidcDiscovery;
    try {
      discovery = await this.discover();
    } catch (error) {
      return { ok: false, kind: "transient", error: error instanceof Error ? error.message : String(error) };
    }
    const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: this.clientId });
    if (this.resource) form.set("resource", this.resource);
    const slot = await this.pacer.acquire("refresh");
    if (!slot.ok) return { ok: false, kind: "transient", rateLimited: true, retryAfterMs: slot.retryAfterMs, error: rateLimitedText(slot.retryAfterMs) };
    let got: { status: number; body: Record<string, unknown> | null; retryAfterMs: number };
    try {
      got = await this.getJson(discovery.tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
    } catch (error) {
      return { ok: false, kind: "transient", error: error instanceof Error ? error.message : String(error) };
    }
    if (isRateLimitAnswer(got)) {
      this.pacer.noteRateLimited(got.retryAfterMs);
      return { ok: false, kind: "transient", rateLimited: true, retryAfterMs: got.retryAfterMs, error: rateLimitedText(got.retryAfterMs) };
    }
    const oauthError = typeof got.body?.error === "string" ? got.body.error.slice(0, 64) : undefined;
    if (got.status !== 200) {
      if ((got.status === 400 || got.status === 401) && oauthError && REJECTED_GRANT_ERRORS.has(oauthError)) {
        return { ok: false, kind: "rejected", error: `the identity provider refused the refresh (${oauthError})` };
      }
      return { ok: false, kind: "transient", error: `the identity provider answered HTTP ${got.status}${oauthError ? ` (${oauthError})` : ""}`, ...(oauthError && CLIENT_REFUSED_ERRORS.has(oauthError) ? { clientRefused: true as const } : {}) };
    }
    const rotated = typeof got.body?.refresh_token === "string" && got.body.refresh_token ? got.body.refresh_token : undefined;
    const accessToken = typeof got.body?.access_token === "string" && got.body.access_token ? got.body.access_token : undefined;
    // A 200 that is not a token answer (a proxy's page while the provider is
    // redeployed) is no refusal: try again later. A token answer without a
    // new refresh token keeps the one sent (RFC 6749 6: rotation is optional).
    if (!rotated && !accessToken) return { ok: false, kind: "transient", error: "the identity provider answered without a token" };
    const next = rotated ?? refreshToken;
    const access = accessToken ? { accessToken, expiresIn: accessExpiresIn(got.body?.expires_in) } : {};
    const idToken = got.body?.id_token;
    if (idToken === undefined) return { ok: true, refreshToken: next, ...access };
    try {
      if (typeof idToken !== "string") throw new OidcError("id_token_malformed", "The refreshed id_token is not a string.");
      const identity = await verifyIdToken({
        token: idToken,
        issuer: this.issuer,
        audience: this.clientId,
        nonce: null,
        keyFor: (kid) => this.keyFor(kid),
        nowSeconds: Math.floor(this.now() / 1000),
      });
      if (identity.sub !== expect.sub) throw new OidcError("id_token_sub", "The refreshed id_token names another subject.");
      return { ok: true, refreshToken: next, identity, ...access };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof OidcError && error.code === "id_token_sub") {
        // Another person's identity on this grant: never kept.
        if (rotated && discovery.revocationEndpoint) this.revoke(rotated, "refresh_token", "a refreshed id_token that named another subject");
        return { ok: false, kind: "rejected", error: message };
      }
      // 2026-10-20: the id_token on a refresh is optional; the refresh token
      // came from the token endpoint itself. One that does not verify (a
      // signing key Perspicax rotated during a deploy, its keys unreachable
      // for a moment) costs this refresh its claims, never the session.
      return { ok: true, refreshToken: next, ...access, note: `the refreshed id_token was ignored (${message})` };
    }
  }

  /** One revocation call at the provider (RFC 7009), unpaced: the durable
   * queue (server/idp-revocations.ts) paces it. Never throws and never puts
   * the token in a log line or a result. */
  async revokeAttempt(token: string, hint: "refresh_token" | "access_token" = "refresh_token"): Promise<RevokeAttempt> {
    let revocationEndpoint: string | undefined;
    try {
      ({ revocationEndpoint } = await this.discover());
    } catch (error) {
      return { kind: "retry", why: error instanceof Error ? error.message : String(error) };
    }
    if (!revocationEndpoint) return { kind: "drop", why: "the provider publishes no revocation endpoint" };
    let response: Response;
    try {
      response = await this.fetcher(revocationEndpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ token, token_type_hint: hint, client_id: this.clientId }).toString(),
      });
    } catch (error) {
      return { kind: "retry", why: `the provider could not be reached: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (response.ok) {
      void response.body?.cancel().catch(() => {});
      return { kind: "done" };
    }
    let error: string | undefined;
    try {
      const parsed: unknown = JSON.parse(await readBounded(response));
      if (parsed && typeof parsed === "object" && typeof (parsed as { error?: unknown }).error === "string") error = (parsed as { error: string }).error.slice(0, 64);
    } catch {
      /* no JSON body */
    }
    if (response.status === 429 || error === "rate_limited") {
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), this.now());
      this.pacer.noteRateLimited(retryAfterMs);
      return { kind: "rate_limited", retryAfterMs };
    }
    if (response.status === 400 && (error === "invalid_request" || error === "unsupported_token_type")) {
      return { kind: "drop", why: `the provider answered 400 (${error})` };
    }
    return { kind: "retry", why: `the provider answered ${response.status}${error ? ` (${error})` : ""}` };
  }

  /** Revoke a token at the provider (RFC 7009), once and now. Resolves to
   * whether the provider answered 2xx; never throws and never logs the
   * token. Production revocations go through the durable queue. */
  async revokeToken(token: string, hint: "refresh_token" | "access_token" = "refresh_token"): Promise<boolean> {
    const attempt = await this.revokeAttempt(token, hint);
    if (attempt.kind === "done") return true;
    console.warn(`oidc: token revocation did not succeed: ${attempt.kind === "rate_limited" ? "rate limited" : attempt.why}`);
    return false;
  }

  /** Verify a back-channel logout token from this issuer for this client. */
  async verifyLogoutToken(token: string): Promise<LogoutClaims> {
    await this.discover();
    return verifyLogoutToken({
      token,
      issuer: this.issuer,
      audience: this.clientId,
      keyFor: (kid) => this.keyFor(kid),
      nowSeconds: Math.floor(this.now() / 1000),
    });
  }

  /** Slice 7: verify a console assertion for this server's public origin
   * (one trailing slash ignored) and, when a link is loaded, its server id. */
  async verifyConsoleAssertion(token: string, audienceOrigin: string, serverId?: string | null, actors?: readonly ConsoleAssertionActor[]): Promise<ConsoleAssertion> {
    await this.discover();
    return verifyConsoleAssertion({
      token,
      issuer: this.issuer,
      audience: audienceOrigin.replace(/\/$/, ""),
      keyFor: (kid) => this.keyFor(kid),
      nowSeconds: Math.floor(this.now() / 1000),
      ...(serverId ? { serverId } : {}),
      ...(actors ? { actors } : {}),
    });
  }

  /** Through the durable queue when one is set; otherwise fire and forget
   * (a revocation that fails leaves a token that expires on its own: access
   * 1 h, refresh 30 days idle). Logged, never thrown. */
  private revoke(token: string, hint: "refresh_token" | "access_token", why: string): void {
    if (this.revocations) {
      this.revocations.enqueue(token, hint, why);
      return;
    }
    void this.revokeToken(token, hint);
  }
}
