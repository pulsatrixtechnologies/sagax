// A local OpenID Connect provider shaped like Perspicax (slices 1 and 2), for
// tests: discovery, a JWKS with one ES256 key (rotatable), an authorize
// endpoint that signs the configured person in at once (no page), a token
// endpoint that checks the code, client, redirect URI and PKCE S256 before
// returning an ES256 id_token, a refresh grant with rotation (the old token
// dies, the id_token carries no nonce), revocation of a whole family, and
// back-channel logout tokens, and the Pulsa Bot directory of slice 3
// (bearer link token, ETag and 304, settable people and teams). Slice 5 adds
// MCP profiles in the directory, the RFC 8693 token exchange authenticated
// by the link (Basic), its revocation, and a small /mcp endpoint that
// records who called with which token, session and clientInfo. `tamper` bends one thing at a time so a test
// can prove the relying party refuses it. In-process only; imported by tests.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeOidcUser {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  role?: string;
  /** Slice 4: the `teams` claim, when set. */
  teams?: Array<{ id: string; name: string; manager: boolean }>;
}

export interface FakeOidcTamper {
  /** Edit the id_token claims before signing. */
  claims?: (claims: Record<string, unknown>) => Record<string, unknown>;
  /** Edit the id_token header before signing. */
  header?: (header: Record<string, unknown>) => Record<string, unknown>;
  /** Sign with a key the JWKS does not publish (same kid). */
  strayKey?: boolean;
  /** Change the claims after signing (the signature no longer matches). */
  afterSigning?: (claims: Record<string, unknown>) => Record<string, unknown>;
  /** Leave `iss` off the authorization response. */
  dropIssParam?: boolean;
  /** Put this `iss` on the authorization response instead. */
  issParam?: string;
  /** Answer the authorize request with this OAuth error. */
  authorizeError?: string;
  /** Return no id_token. */
  noIdToken?: boolean;
  /** Slice 6: drop the `pulsabot:routines` marker from token answers (an
   * older Perspicax), so a delegation code answer lacks it. */
  omitRoutinesMarker?: boolean;
  /** 2026-10-18: answer a sign-in again without the account erasure marker (an older Perspicax). */
  omitEraseMarker?: boolean;
  /** 2026-10-18: answer the code exchange without a refresh token. */
  noRefreshToken?: boolean;
  /** 2026-10-08: refuse to issue a routine delegation by token exchange (a
   * Perspicax up to 1.8.13: only an access token may be requested). */
  noDelegationExchange?: boolean;
}

export interface FakeDirectoryPerson {
  sub: string;
  login: string;
  name: string;
  email: string | null;
  role: "admin" | "manager" | "employee";
  status: "active" | "disabled";
  locale: string | null;
  /** Perspicax's user type; a service account never signs in. */
  kind?: "person" | "service";
  /** Slice 4: provider names this person keeps a key for. */
  provider_keys?: string[];
  /** Slice 5: the MCP profile ids this person holds (else profilesBySub). */
  profiles?: string[];
  /** Perspicax 1.8.6: "use" when an admin made this person read-only in
   * Sagax (shared bots only); absent from an older Perspicax. */
  sagax_bots?: "manage" | "use";
  /** Perspicax migration 0046: "off" when an admin manages this person's
   * plugins, skills and MCP servers; absent from an older Perspicax. */
  sagax_integrations?: "manage" | "off";
  /** Perspicax migration 0063: the engines this person may run on the
   * organization's key. Absent here: `["*"]` (every engine), so fixtures
   * written before keep their organization key; null leaves the field out
   * (an older Perspicax). */
  sagax_server_engines?: string[] | null;
  /** 2026-10-09: the person's effective Sagax permissions, as Perspicax
   * computes them; absent from an older Perspicax. */
  permissions?: string[] | null;
  /** Slice 6: set to leave the field out (an older Perspicax); else the
   * provider reports the live delegation family of this person. */
  omitRoutineDelegation?: boolean;
}

/** Slice 5: one /mcp request as the fake Perspicax saw it. */
export interface FakeMcpRequest {
  method: string;
  sub: string | null;
  profile: string | null;
  sessionId: string | null;
  rpcMethod?: string;
  clientInfo?: unknown;
  status: number;
}

export interface FakeDirectoryTeam { id: string; name: string; managers: string[]; members: string[] }

interface Key { kid: string; privateKey: KeyObject; publicJwk: Record<string, unknown> }

function newKey(): Key {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const kid = randomBytes(8).toString("hex");
  const jwk = publicKey.export({ format: "jwk" });
  return { kid, privateKey, publicJwk: { ...jwk, kid, use: "sig", alg: "ES256" } };
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export interface FakeOidcProvider {
  issuer: string;
  clientId: string;
  user: FakeOidcUser;
  tamper: FakeOidcTamper;
  /** Every JWKS fetch, for the cache and refetch tests. */
  jwksFetches: number;
  /** The last token request's form fields. */
  lastTokenRequest: Record<string, string> | null;
  /** Every revocation request's form fields. */
  revoked: Array<Record<string, string>>;
  /** The last authorize request's query. */
  lastAuthorize: Record<string, string> | null;
  /** Refresh grants answered 200. */
  refreshCount: number;
  /** Slice 6: every refresh answered 200, with whether its family is a
   * routine delegation. */
  refreshes: Array<{ sub: string; delegation: boolean; at: number }>;
  /** Slice 6: the console revoke stand-in: end this person's routine
   * delegation family; returns how many ended. */
  revokeDelegation(sub: string): number;
  /** Slice 6: the live delegation of this person, if any. */
  delegationOf(sub: string): { consentedAt: number; renewedAt: number } | null;
  /** 2026-10-08: every routine delegation the linked server asked by token
   * exchange (requested_token_type refresh_token), with its answer. */
  delegationIssues: Array<{ sub: string | null; ok: boolean; error?: string }>;
  /** Refresh tokens that are live right now. */
  liveRefreshTokens(): string[];
  /** Refresh -> 400 invalid_grant for this subject from now on (disabled user). */
  disable(sub: string): void;
  enable(sub: string): void;
  /** The role the next refreshed id_token carries for this subject. */
  setRole(sub: string, role: string | undefined): void;
  /** The next token request answers this status (429 `rate_limited`, else
   * `temporarily_unavailable`), whatever the grant. */
  failNextToken(status: number): void;
  /** 2026-10-20, Perspicax's refresh reuse grace (local-oauth
   * REFRESH_REUSE_GRACE, 30 s): a rotated refresh token presented again
   * within this many ms gets the pair already issued for it; later, the
   * whole family is revoked. 0 (the default): a rotated token is just
   * invalid_grant. */
  reuseGraceMs: number;
  /** The next refresh rotates as usual, then its answer is lost (the
   * connection is cut), as when a deploy stops Perspicax mid-answer. */
  dropNextRefreshAnswer(): void;
  /** The next refresh rotates at once and answers only after `ms` (a crash
   * of the client in between loses the answer). */
  delayNextRefreshAnswer(ms: number): void;
  /** Perspicax down (connections refused) and up again on the same address,
   * its grants kept (a redeploy). */
  stop(): Promise<void>;
  start(): Promise<void>;
  /** A back-channel logout token for this subject, signed by the provider's
   * key unless `strayKey`; `claims` and `header` bend one thing at a time. */
  logoutToken(input: { sub: string; claims?: (claims: Record<string, unknown>) => Record<string, unknown>; header?: (header: Record<string, unknown>) => Record<string, unknown>; strayKey?: boolean }): string;
  /** Slice 7: a console assertion (typ `pulsabot-console+jwt`) for this
   * subject and audience origin, as Perspicax signs one per proxied request;
   * `claims` and `header` bend one thing at a time. */
  consoleAssertion(input: { sub: string; aud: string; role?: string; teams?: Array<{ id: string; name: string; manager: boolean }>; serverId?: string; claims?: (claims: Record<string, unknown>) => Record<string, unknown>; header?: (header: Record<string, unknown>) => Record<string, unknown>; strayKey?: boolean }): string;
  /** Replace the signing key (the old one leaves the JWKS). */
  rotateKey(): void;
  /** Avatars (the Perspicax change Sagax consumes): off, the provider is a
   * Perspicax without them (no `avatar` field, no `picture` claim, no
   * route). On, each person's image by subject; the version is the first 16
   * hex of its SHA-256. */
  avatarsEnabled: boolean;
  avatars: Map<string, Buffer>;
  avatarVersion(sub: string): string | null;
  /** Every avatar request: the subject and whether the link token matched. */
  avatarRequests: Array<{ sub: string; authorized: boolean }>;
  /** Slice 3 directory: the link token it accepts (Bearer), this server's
   * id, and the people and teams it lists. */
  linkToken: string;
  serverId: string;
  directoryPeople: FakeDirectoryPerson[];
  directoryTeams: FakeDirectoryTeam[];
  /** Every directory request's headers (lowercase names). */
  directoryRequests: Array<Record<string, string>>;
  /** Slice 4: the `teams` claim the next id_token (sign-in or refresh)
   * carries for this subject; undefined drops the claim. */
  setTeams(sub: string, teams: Array<{ id: string; name: string; manager: boolean }> | undefined): void;
  /** Slice 4: owner keys the resolve endpoint answers, by `${sub}/${provider}`. */
  providerKeys: Map<string, string>;
  /** Every resolve request's body (never the answer). */
  resolveRequests: Array<{ sub: string; provider: string }>;
  /** Slice 5: the profile catalog, who holds what (by sub), every exchange
   * (sub, profile, outcome), revocations of exchanged tokens, and /mcp. */
  profiles: Array<{ id: string; slug: string; name: string; description: string }>;
  profilesBySub: Map<string, string[]>;
  exchanges: Array<{ sub: string | null; profile: string | null; ok: boolean; error?: string; token?: string }>;
  exchangeRevoked: string[];
  mcpRequests: FakeMcpRequest[];
  /** Every access token this provider issued to the sign-in client. */
  issuedAccessTokens(): string[];
  /** Mark one listed person active or disabled. */
  setDirectoryStatus(sub: string, status: "active" | "disabled"): void;
  /** A directory person from a user, active unless said otherwise. */
  personOf(user: FakeOidcUser, status?: "active" | "disabled"): FakeDirectoryPerson;
  close(): Promise<void>;
}

export async function startFakeOidcProvider(options: { clientId?: string; user?: FakeOidcUser } = {}): Promise<FakeOidcProvider> {
  const clientId = options.clientId ?? "pulsa-bot";
  let key = newKey();
  const stray = newKey();
  const codes = new Map<string, { clientId: string; redirectUri: string; challenge: string; nonce: string; user: FakeOidcUser; resource?: string; scope: string }>();
  /** Live refresh tokens: token -> family, the person and the resource. */
  const refreshTokens = new Map<string, { family: string; user: FakeOidcUser; resource?: string }>();
  const deadFamilies = new Set<string>();
  /** Slice 6: routine delegation families (one live per sub). */
  const delegations = new Map<string, { sub: string; consentedAt: number; renewedAt: number }>();
  const endFamily = (family: string) => {
    deadFamilies.add(family);
    delegations.delete(family);
    for (const [token, entry] of refreshTokens) if (entry.family === family) refreshTokens.delete(token);
  };
  const endDelegationsOf = (sub: string): number => {
    let ended = 0;
    // entries are deleted while iterating: walk a copy
    for (const [family, entry] of Array.from(delegations)) {
      if (entry.sub !== sub) continue;
      endFamily(family);
      ended += 1;
    }
    return ended;
  };
  const MARKER = "pulsabot:routines";
  /** 2026-10-18: Perspicax's account erasure marker (ACCOUNT_ERASURE_SCOPE). */
  const ERASE_MARKER = "pulsabot:erase";
  const disabled = new Set<string>();
  const roles = new Map<string, string | undefined>();
  const teamsBySub = new Map<string, FakeOidcUser["teams"]>();
  const withTeams = (user: FakeOidcUser): FakeOidcUser => {
    if (!teamsBySub.has(user.sub)) return user;
    const teams = teamsBySub.get(user.sub);
    const next = { ...user };
    if (teams === undefined) delete next.teams;
    else next.teams = teams;
    return next;
  };
  let failNext: number | null = null;
  let dropNextAnswer = false;
  let delayNextAnswerMs = 0;
  /** Rotated refresh tokens and the answer issued for them (reuse grace). */
  const rotatedAnswers = new Map<string, { at: number; family: string; body: Record<string, unknown> }>();
  let server: Server | null = null;
  let listenPort = 0;
  /** Slice 5: sign-in access tokens (the exchange subjects) and exchanged MCP tokens. */
  const accessTokens = new Map<string, { sub: string; exp: number }>();
  /** Access tokens of a routine delegation family: never a subject to issue one. */
  const delegationFamilies = new Set<string>();
  /** The person each sign-in code was issued to, by sub. */
  const signedInUsers = new Map<string, FakeOidcUser>();
  const exchanged = new Map<string, { sub: string; profile: string; exp: number; revoked: boolean }>();
  const newAccess = (sub: string) => {
    const token = `pxlo1.${randomBytes(16).toString("hex")}`;
    accessTokens.set(token, { sub, exp: Date.now() + 3_600_000 });
    return token;
  };
  const linkBasicOk = (header: string | undefined) => header === `Basic ${Buffer.from(`pulsa-bot-server:${provider.linkToken}`).toString("base64")}`;
  const held = (sub: string) => provider.directoryPeople.find((person) => person.sub === sub)?.profiles ?? provider.profilesBySub.get(sub) ?? [];

  const provider: FakeOidcProvider = {
    issuer: "",
    clientId,
    user: options.user ?? { sub: "01J0000000000000000000ADMN", email: "ada@example.test", name: "Ada Admin", preferred_username: "ada", role: "admin" },
    tamper: {},
    jwksFetches: 0,
    lastTokenRequest: null,
    lastAuthorize: null,
    revoked: [],
    refreshCount: 0,
    refreshes: [],
    revokeDelegation: (sub) => endDelegationsOf(sub),
    delegationOf(sub) {
      for (const entry of delegations.values()) if (entry.sub === sub) return { consentedAt: entry.consentedAt, renewedAt: entry.renewedAt };
      return null;
    },
    liveRefreshTokens: () => [...refreshTokens.keys()],
    disable(sub) {
      disabled.add(sub);
      // Slice 6: a disable ends the routine delegation for good.
      endDelegationsOf(sub);
    },
    enable(sub) {
      disabled.delete(sub);
    },
    setRole(sub, role) {
      roles.set(sub, role);
    },
    failNextToken(status) {
      failNext = status;
    },
    reuseGraceMs: 0,
    dropNextRefreshAnswer() {
      dropNextAnswer = true;
    },
    delayNextRefreshAnswer(ms) {
      delayNextAnswerMs = ms;
    },
    stop: () => new Promise<void>((resolve) => {
      if (!server?.listening) return resolve();
      server.close(() => resolve());
      server.closeAllConnections();
    }),
    start: () => new Promise<void>((resolve, reject) => {
      if (!server || server.listening) return resolve();
      server.once("error", reject);
      server.listen(listenPort, "127.0.0.1", () => { server!.off("error", reject); resolve(); });
    }),
    logoutToken(input) {
      const now = Math.floor(Date.now() / 1000);
      let claims: Record<string, unknown> = {
        iss: provider.issuer, aud: clientId, iat: now, exp: now + 120, jti: randomBytes(16).toString("hex"), sub: input.sub,
        events: { "http://schemas.openid.net/event/backchannel-logout": {} },
      };
      if (input.claims) claims = input.claims(claims);
      let header: Record<string, unknown> = { alg: "ES256", typ: "logout+jwt", kid: key.kid };
      if (input.header) header = input.header(header);
      const signed = `${b64(header)}.${b64(claims)}`;
      const signature = sign("sha256", Buffer.from(signed), { key: input.strayKey ? stray.privateKey : key.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
      return `${signed}.${signature}`;
    },
    consoleAssertion(input) {
      const now = Math.floor(Date.now() / 1000);
      let claims: Record<string, unknown> = {
        iss: provider.issuer, aud: input.aud, sub: input.sub, act: { sub: "console" }, jti: randomBytes(16).toString("hex"),
        iat: now, exp: now + 60, server_id: input.serverId ?? provider.serverId, role: input.role ?? "admin", teams: input.teams ?? [],
      };
      if (input.claims) claims = input.claims(claims);
      let header: Record<string, unknown> = { alg: "ES256", typ: "pulsabot-console+jwt", kid: key.kid };
      if (input.header) header = input.header(header);
      const signed = `${b64(header)}.${b64(claims)}`;
      const signature = sign("sha256", Buffer.from(signed), { key: input.strayKey ? stray.privateKey : key.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
      return `${signed}.${signature}`;
    },
    rotateKey() {
      key = newKey();
    },
    linkToken: `pxat1.${randomBytes(32).toString("base64url")}`,
    serverId: "01j9s3fake0000000000server",
    directoryPeople: [],
    directoryTeams: [],
    directoryRequests: [],
    setTeams(sub, teams) {
      teamsBySub.set(sub, teams);
    },
    providerKeys: new Map(),
    resolveRequests: [],
    profiles: [],
    profilesBySub: new Map(),
    exchanges: [],
    delegationIssues: [],
    exchangeRevoked: [],
    mcpRequests: [],
    issuedAccessTokens: () => [...accessTokens.keys()],
    setDirectoryStatus(sub, status) {
      provider.directoryPeople = provider.directoryPeople.map((person) => (person.sub === sub ? { ...person, status } : person));
    },
    avatarsEnabled: false,
    avatars: new Map(),
    avatarVersion(sub) {
      const bytes = provider.avatars.get(sub);
      return bytes ? createHash("sha256").update(bytes).digest("hex").slice(0, 16) : null;
    },
    avatarRequests: [],
    personOf(user, status = "active") {
      const role = user.role === "admin" || user.role === "manager" ? user.role : "employee";
      return { sub: user.sub, login: user.preferred_username ?? user.sub, name: user.name ?? user.preferred_username ?? user.sub, email: user.email ?? null, role, status, locale: null };
    },
    close: () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
  };

  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const routineDelegationOf = (person: FakeDirectoryPerson) => {
    const live = person.status === "disabled" || disabled.has(person.sub) ? null : provider.delegationOf(person.sub);
    return live ? { consented_at: iso(live.consentedAt), renewed_at: iso(live.renewedAt), expires_at: iso(live.renewedAt + 30 * 86_400_000) } : null;
  };

  const send = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  const idToken = (user: FakeOidcUser, nonce: string | null): string => {
    const now = Math.floor(Date.now() / 1000);
    let claims: Record<string, unknown> = {
      iss: provider.issuer, sub: user.sub, aud: clientId, azp: clientId, exp: now + 600, iat: now, auth_time: now, ...(nonce !== null ? { nonce } : {}),
      amr: ["pwd", "otp"], email_verified: false,
      ...(user.email ? { email: user.email } : {}),
      ...(user.name ? { name: user.name } : {}),
      ...(user.preferred_username ? { preferred_username: user.preferred_username } : {}),
      ...(user.role ? { role: user.role } : {}),
      ...(user.teams ? { teams: user.teams } : {}),
      ...(provider.avatarsEnabled && provider.avatarVersion(user.sub)
        ? { picture: `${provider.issuer}/api/v1/pulsabot/people/${encodeURIComponent(user.sub)}/avatar?v=${provider.avatarVersion(user.sub)}` }
        : {}),
    };
    if (provider.tamper.claims) claims = provider.tamper.claims(claims);
    let header: Record<string, unknown> = { alg: "ES256", typ: "JWT", kid: key.kid };
    if (provider.tamper.header) header = provider.tamper.header(header);
    const input = `${b64(header)}.${b64(claims)}`;
    const signer = provider.tamper.strayKey ? stray.privateKey : key.privateKey;
    const signature = sign("sha256", Buffer.from(input), { key: signer, dsaEncoding: "ieee-p1363" }).toString("base64url");
    const payload = provider.tamper.afterSigning ? b64(provider.tamper.afterSigning(claims)) : b64(claims);
    return `${b64(header)}.${payload}.${signature}`;
  };

  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", provider.issuer || "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      return send(res, 200, {
        issuer: provider.issuer,
        authorization_endpoint: `${provider.issuer}/oauth/authorize`,
        token_endpoint: `${provider.issuer}/oauth/token`,
        jwks_uri: `${provider.issuer}/oauth/jwks`,
        revocation_endpoint: `${provider.issuer}/oauth/revoke`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        id_token_signing_alg_values_supported: ["ES256"],
        subject_types_supported: ["public"],
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (req.method === "GET" && url.pathname === "/api/v1/pulsabot/directory") {
      const headers = Object.fromEntries(Object.entries(req.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(",") : value ?? ""]));
      provider.directoryRequests.push(headers);
      if (headers.authorization !== `Bearer ${provider.linkToken}`) return send(res, 401, { error: "unauthorized" });
      const body = JSON.stringify({
        server_id: provider.serverId,
        people: [...provider.directoryPeople].sort((a, b) => a.sub.localeCompare(b.sub)).map(({ omitRoutineDelegation, sagax_server_engines, ...person }) => ({
          ...person,
          ...(sagax_server_engines === null ? {} : { sagax_server_engines: sagax_server_engines ?? ["*"] }),
          ...(omitRoutineDelegation ? {} : { routine_delegation: routineDelegationOf(person) }),
          ...(provider.avatarsEnabled ? { avatar: provider.avatarVersion(person.sub) } : {}),
          provider_keys: person.provider_keys ?? ["anthropic", "openai"].filter((name) => provider.providerKeys.has(`${person.sub}/${name}`)),
          ...(provider.profiles.length ? { profiles: [...held(person.sub)].sort() } : {}),
        })),
        ...(provider.profiles.length ? { profiles: [...provider.profiles].sort((a, b) => a.id.localeCompare(b.id)) } : {}),
        teams: [...provider.directoryTeams].sort((a, b) => a.id.localeCompare(b.id)).map((team) => ({ ...team, managers: [...team.managers].sort(), members: [...team.members].sort() })),
      });
      const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
      if (headers["if-none-match"] === etag) {
        res.writeHead(304, { etag, "cache-control": "no-store" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", etag });
      res.end(body);
      return;
    }
    const avatarRoute = /^\/api\/v1\/pulsabot\/people\/([^/]+)\/avatar$/.exec(url.pathname);
    if (req.method === "GET" && avatarRoute && provider.avatarsEnabled) {
      const sub = decodeURIComponent(avatarRoute[1]!);
      const authorized = req.headers.authorization === `Bearer ${provider.linkToken}`;
      provider.avatarRequests.push({ sub, authorized });
      if (!authorized) return send(res, 401, { error: "unauthorized" });
      const bytes = provider.avatars.get(sub);
      if (!bytes) return send(res, 404, { error: "no avatar" });
      const type = bytes[0] === 0x89 ? "image/png" : "image/jpeg";
      res.writeHead(200, { "content-type": type, "cache-control": "no-store", etag: `"${provider.avatarVersion(sub)}"` });
      res.end(bytes);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/v1/pulsabot/provider-keys/resolve") {
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (raw += chunk));
      req.on("end", () => {
        if (req.headers.authorization !== `Bearer ${provider.linkToken}`) return send(res, 401, { error: "unauthorized" });
        let asked: { sub?: unknown; provider?: unknown } = {};
        try { asked = JSON.parse(raw) as typeof asked; } catch { return send(res, 400, { error: "bad_request" }); }
        if (typeof asked.sub !== "string" || (asked.provider !== "anthropic" && asked.provider !== "openai")) return send(res, 400, { error: "bad_request" });
        provider.resolveRequests.push({ sub: asked.sub, provider: asked.provider });
        const person = provider.directoryPeople.find((entry) => entry.sub === asked.sub);
        const key = provider.providerKeys.get(`${asked.sub}/${asked.provider}`);
        if (!person || !key) return send(res, 404, { error: "no_key" });
        if (person.status === "disabled") return send(res, 409, { error: "user_inactive" });
        return send(res, 200, { provider: asked.provider, key, fingerprint: createHash("sha256").update(key).digest("hex").slice(0, 16) });
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/oauth/jwks") {
      provider.jwksFetches += 1;
      return send(res, 200, { keys: [key.publicJwk] });
    }
    if (req.method === "GET" && url.pathname === "/oauth/authorize") {
      const q = Object.fromEntries(url.searchParams);
      provider.lastAuthorize = q;
      if (q.client_id !== clientId || !q.redirect_uri || q.response_type !== "code" || q.code_challenge_method !== "S256" || !q.code_challenge) {
        return send(res, 400, { error: "invalid_request" });
      }
      const back = new URL(q.redirect_uri);
      if (q.state) back.searchParams.set("state", q.state);
      if (!provider.tamper.dropIssParam) back.searchParams.set("iss", provider.tamper.issParam ?? provider.issuer);
      if (provider.tamper.authorizeError) {
        back.searchParams.set("error", provider.tamper.authorizeError);
      } else {
        const code = randomBytes(24).toString("base64url");
        // Slice 6 (as Perspicax, local-oauth scope_for_signed_in): a
        // delegation request names its person in login_hint; another account
        // signing in gets no marker, so its own delegation is never replaced.
        const hint = (q.login_hint ?? "").trim();
        // The erasure marker needs the hint, and the hint's person.
        const asksErase = (q.scope ?? "").split(" ").includes(ERASE_MARKER);
        const scope = (hint && hint !== provider.user.sub) || (asksErase && !hint)
          ? (q.scope ?? "").split(" ").filter((name) => name && name !== MARKER && name !== ERASE_MARKER).join(" ")
          : q.scope ?? "";
        codes.set(code, { clientId: q.client_id, redirectUri: q.redirect_uri, challenge: q.code_challenge, nonce: q.nonce ?? "", user: { ...provider.user }, ...(q.resource ? { resource: q.resource } : {}), scope });
        back.searchParams.set("code", code);
      }
      res.writeHead(302, { location: back.toString() });
      res.end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/oauth/token") {
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (raw += chunk));
      req.on("end", () => {
        const form = Object.fromEntries(new URLSearchParams(raw));
        if (form.grant_type === "urn:ietf:params:oauth:grant-type:token-exchange") {
          const fail = (status: number, error: string, sub: string | null = null, profile: string | null = null) => {
            provider.exchanges.push({ sub, profile, ok: false, error });
            if (status === 401) {
              res.writeHead(401, { "content-type": "application/json", "cache-control": "no-store", "www-authenticate": 'Basic realm="perspicax"' });
              res.end(JSON.stringify({ error }));
              return;
            }
            send(res, status, { error });
          };
          if (!linkBasicOk(req.headers.authorization)) return fail(401, "invalid_client");
          if (form.subject_token_type !== "urn:ietf:params:oauth:token-type:access_token" || !form.subject_token || form.actor_token) return fail(400, "invalid_request");
          if (form.requested_token_type === "urn:ietf:params:oauth:token-type:refresh_token") {
            // 2026-10-08 (the Perspicax change Sagax needs): the linked
            // server turns a person's live sign-in access token into their
            // routine delegation family, no consent; it replaces the older one.
            const refuse = (error: string, sub: string | null = null) => {
              provider.delegationIssues.push({ sub, ok: false, error });
              return send(res, 400, { error });
            };
            const subject = accessTokens.get(form.subject_token);
            if (provider.tamper.noDelegationExchange) return refuse("invalid_request", subject?.sub ?? null);
            if (!subject || subject.exp - Date.now() < 60_000 || disabled.has(subject.sub)) return refuse("invalid_grant", subject?.sub ?? null);
            if (delegationFamilies.has(form.subject_token)) return refuse("invalid_grant", subject.sub);
            if (!(form.scope ?? "").split(" ").includes(MARKER) || !form.resource) return refuse("invalid_scope", subject.sub);
            const signedInAs = signedInUsers.get(subject.sub);
            if (!signedInAs) return refuse("invalid_grant", subject.sub);
            endDelegationsOf(subject.sub);
            const family = randomBytes(8).toString("hex");
            delegations.set(family, { sub: subject.sub, consentedAt: Date.now(), renewedAt: Date.now() });
            const refresh = `pxlr1.${randomBytes(16).toString("hex")}`;
            refreshTokens.set(refresh, { family, user: signedInAs, resource: form.resource });
            const access = newAccess(subject.sub);
            delegationFamilies.add(access);
            provider.delegationIssues.push({ sub: subject.sub, ok: true });
            return send(res, 200, {
              access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: 3600,
              issued_token_type: "urn:ietf:params:oauth:token-type:refresh_token",
              scope: provider.tamper.omitRoutinesMarker ? "openid profile email offline_access" : `openid profile email offline_access ${MARKER}`,
            });
          }
          const subject = accessTokens.get(form.subject_token);
          if (!subject || subject.exp - Date.now() < 60_000 || disabled.has(subject.sub)) return fail(400, "invalid_grant", subject?.sub ?? null);
          let profile: string | null = null;
          try {
            const target = new URL(form.resource ?? "");
            if (`${target.origin}${target.pathname}` === `${provider.issuer}/mcp`) profile = target.searchParams.get("profile");
          } catch { /* not a URL */ }
          if (!profile || !provider.profiles.some((entry) => entry.id === profile) || !held(subject.sub).includes(profile)) return fail(400, "invalid_target", subject.sub, profile);
          const token = `pxlo1.${subject.sub}.${randomBytes(16).toString("hex")}`;
          const expiresIn = Math.min(900, Math.floor((subject.exp - Date.now()) / 1000));
          exchanged.set(token, { sub: subject.sub, profile, exp: Date.now() + expiresIn * 1000, revoked: false });
          provider.exchanges.push({ sub: subject.sub, profile, ok: true, token });
          return send(res, 200, { access_token: token, issued_token_type: "urn:ietf:params:oauth:token-type:access_token", token_type: "Bearer", expires_in: expiresIn, scope: `profile:${profile}` });
        }
        provider.lastTokenRequest = form;
        if (failNext !== null) {
          const status = failNext;
          failNext = null;
          return send(res, status, { error: status === 429 ? "rate_limited" : "temporarily_unavailable" });
        }
        const issueRefresh = (family: string, user: FakeOidcUser, resource?: string) => {
          const token = `pxlr1.${randomBytes(16).toString("hex")}`;
          refreshTokens.set(token, { family, user, ...(resource ? { resource } : {}) });
          return token;
        };
        if (form.grant_type === "refresh_token") {
          const held = form.refresh_token ? refreshTokens.get(form.refresh_token) : undefined;
          const reused = !held && form.refresh_token ? rotatedAnswers.get(form.refresh_token) : undefined;
          if (reused && provider.reuseGraceMs > 0 && !deadFamilies.has(reused.family) && form.client_id === clientId) {
            // Perspicax: within the grace, the pair already issued; after it, the family ends.
            if (Date.now() - reused.at <= provider.reuseGraceMs) return send(res, 200, reused.body);
            endFamily(reused.family);
            return send(res, 400, { error: "invalid_grant" });
          }
          if (!held || deadFamilies.has(held.family) || form.client_id !== clientId) return send(res, 400, { error: "invalid_grant" });
          if (held.resource && form.resource !== held.resource) return send(res, 400, { error: "invalid_target" });
          if (disabled.has(held.user.sub)) return send(res, 400, { error: "invalid_grant" });
          refreshTokens.delete(form.refresh_token!); // rotation: the old token is dead
          const delegation = delegations.get(held.family);
          if (delegation) delegation.renewedAt = Date.now();
          provider.refreshes.push({ sub: held.user.sub, delegation: Boolean(delegation), at: Date.now() });
          const user: FakeOidcUser = withTeams({ ...held.user });
          if (roles.has(user.sub)) {
            const role = roles.get(user.sub);
            if (role === undefined) delete user.role;
            else user.role = role;
          }
          provider.refreshCount += 1;
          const answer = {
            access_token: newAccess(held.user.sub),
            refresh_token: issueRefresh(held.family, held.user, held.resource),
            token_type: "Bearer",
            expires_in: 3600,
            scope: delegation && !provider.tamper.omitRoutinesMarker ? `openid profile email offline_access ${MARKER}` : "openid profile email offline_access",
            ...(provider.tamper.noIdToken ? {} : { id_token: idToken(user, null) }),
          };
          rotatedAnswers.set(form.refresh_token!, { at: Date.now(), family: held.family, body: answer });
          if (dropNextAnswer) {
            dropNextAnswer = false;
            res.socket?.destroy();
            return;
          }
          if (delayNextAnswerMs > 0) {
            const wait = delayNextAnswerMs;
            delayNextAnswerMs = 0;
            setTimeout(() => { if (!res.destroyed && !res.writableEnded) send(res, 200, answer); }, wait).unref();
            return;
          }
          return send(res, 200, answer);
        }
        const grant = form.code ? codes.get(form.code) : undefined;
        if (form.code) codes.delete(form.code); // single use
        if (form.grant_type !== "authorization_code" || !grant) return send(res, 400, { error: "invalid_grant" });
        if (form.client_id !== grant.clientId || form.redirect_uri !== grant.redirectUri) return send(res, 400, { error: "invalid_grant" });
        const challenge = createHash("sha256").update(form.code_verifier ?? "").digest("base64url");
        if (challenge !== grant.challenge) return send(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed" });
        // Slice 6: the marker is kept for this client, a bound audience, and
        // openid plus offline_access; a new delegation ends the older one.
        const asked = grant.scope.split(" ");
        const marked = !provider.tamper.omitRoutinesMarker && asked.includes(MARKER) && asked.includes("openid") && asked.includes("offline_access") && Boolean(grant.resource);
        const family = randomBytes(8).toString("hex");
        signedInUsers.set(grant.user.sub, { ...grant.user });
        if (marked) {
          endDelegationsOf(grant.user.sub);
          delegations.set(family, { sub: grant.user.sub, consentedAt: Date.now(), renewedAt: Date.now() });
        }
        return send(res, 200, {
          access_token: newAccess(grant.user.sub),
          ...(provider.tamper.noRefreshToken ? {} : { refresh_token: issueRefresh(family, grant.user, grant.resource) }),
          token_type: "Bearer",
          expires_in: 3600,
          scope: !provider.tamper.omitEraseMarker && asked.includes(ERASE_MARKER) && asked.includes("openid") && Boolean(grant.resource)
            ? `openid ${ERASE_MARKER}`
            : marked ? `openid profile email offline_access ${MARKER}` : "openid profile email offline_access",
          ...(provider.tamper.noIdToken ? {} : { id_token: idToken(withTeams(grant.user), grant.nonce) }),
        });
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/oauth/revoke") {
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (raw += chunk));
      req.on("end", () => {
        const form = Object.fromEntries(new URLSearchParams(raw));
        if (req.headers.authorization?.startsWith("Basic ")) {
          // Slice 5: an exchanged token, revoked by the linked server.
          if (!linkBasicOk(req.headers.authorization)) return send(res, 401, { error: "invalid_client" });
          const entry = form.token ? exchanged.get(form.token) : undefined;
          if (entry && !entry.revoked) {
            entry.revoked = true;
            provider.exchangeRevoked.push(form.token!);
          }
          return send(res, 200, {});
        }
        provider.revoked.push(form);
        const held = form.token ? refreshTokens.get(form.token) : undefined;
        if (held) endFamily(held.family);
        send(res, 200, {});
      });
      return;
    }
    if (url.pathname === "/mcp" && (req.method === "POST" || req.method === "DELETE")) {
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (raw += chunk));
      req.on("end", () => {
        const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
        const entry = exchanged.get(bearer);
        const live = entry && !entry.revoked && entry.exp > Date.now() && !disabled.has(entry.sub) &&
          provider.directoryPeople.find((person) => person.sub === entry.sub)?.status !== "disabled";
        const sessionHeader = req.headers["mcp-session-id"];
        const sessionId = typeof sessionHeader === "string" ? sessionHeader : null;
        let frame: Record<string, any> = {};
        try { frame = raw ? JSON.parse(raw) as Record<string, any> : {}; } catch { /* not JSON */ }
        const record: FakeMcpRequest = {
          method: req.method!, sub: live ? entry.sub : null, profile: live ? entry.profile : null, sessionId,
          ...(typeof frame.method === "string" ? { rpcMethod: frame.method } : {}),
          ...(frame.method === "initialize" ? { clientInfo: frame.params?.clientInfo } : {}),
          status: live ? 200 : 401,
        };
        if (!live) {
          provider.mcpRequests.push(record);
          res.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" });
          res.end(JSON.stringify({ error: "invalid_token" }));
          return;
        }
        if (req.method === "DELETE") {
          record.status = 204;
          provider.mcpRequests.push(record);
          res.writeHead(204);
          res.end();
          return;
        }
        if (frame.id === undefined) {
          record.status = 202;
          provider.mcpRequests.push(record);
          res.writeHead(202);
          res.end();
          return;
        }
        provider.mcpRequests.push(record);
        const headers: Record<string, string> = { "content-type": "text/event-stream", "cache-control": "no-store" };
        if (frame.method === "initialize") headers["mcp-session-id"] = `sess-${randomBytes(6).toString("hex")}`;
        const result = frame.method === "initialize"
          ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-perspicax", version: "1" } }
          : frame.method === "tools/list"
            ? { tools: [{ name: "api_list", description: "List the APIs of this profile", inputSchema: { type: "object" } }] }
            : frame.method === "tools/call"
              ? { content: [{ type: "text", text: `profile ${entry.profile} for ${entry.sub}` }] }
              : {};
        res.writeHead(200, headers);
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: frame.id, result })}\n\n`);
      });
      return;
    }
    send(res, 404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
  listenPort = (server.address() as AddressInfo).port;
  provider.issuer = `http://127.0.0.1:${listenPort}`;
  return provider;
}
