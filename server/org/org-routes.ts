import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { acceptInvite, inviteStatus, roleOf, type OrgInvite, type OrgRole } from "./org-directory.ts";
import { createOrg, issueInvite, memberListsAfterAccept, serverAddressOk, type OrgRecord } from "./org-record.ts";
import { isPrincipalId } from "../auth/principals.ts";
import { requestOrigin, type RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteContext, type RouteHandler } from "../routes/table.ts";

export interface OrgState {
  org: OrgRecord | null;
  invites: OrgInvite[];
  signIn: { admins: string[]; members: string[] };
}

export type OrgPerson = { id: string; role: OrgRole; email?: string };

export interface OrgViewOptions {
  /** The caller's role: owner and admin callers also get each pending
   * invite's token and link. Members never see a token. */
  viewerRole?: OrgRole | null;
  /** Where invite links point (see `inviteLinkBase`). */
  linkBase?: string | null;
  /** A principal's sign-in email, when it has one. */
  emailOf?: (principalId: string) => string | undefined;
}

function orgPeople(state: OrgState, ownerEmail?: string, emailOf?: (id: string) => string | undefined): OrgPerson[] {
  if (!state.org) return [];
  const lists = { ownerUserId: state.org.ownerUserId, admins: state.signIn.admins, members: state.signIn.members };
  const people: OrgPerson[] = [];
  const seen = new Set<string>();
  const owner = ownerEmail?.trim().toLowerCase();
  for (const id of [state.org.ownerUserId, ...state.signIn.admins, ...state.signIn.members]) {
    if (seen.has(id)) continue;
    // The owner is listed once, by principal id, even when their sign-in
    // email is also in admins or members.
    if (id !== state.org.ownerUserId && owner && id.trim().toLowerCase() === owner) continue;
    // The owner is a principal id, matched against itself. Admins and
    // members are emails, so each is matched by its own email.
    const isOwner = id === state.org.ownerUserId;
    const role = isOwner ? roleOf({ ...lists, userId: id }) : roleOf({ ...lists, userId: id, email: id });
    if (!role) continue;
    seen.add(id);
    // A principal id shows its email; a sign-in list entry is its email.
    const email = isPrincipalId(id) ? (emailOf?.(id) ?? (isOwner ? owner : undefined)) : id.trim().toLowerCase();
    people.push(email ? { id, role, email } : { id, role });
  }
  return people;
}

/** An invite link: `<base>/join#token=<token>`. The token rides in the
 * fragment, so it never reaches a server log or a Referer header. */
export function inviteLink(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}/join#token=${encodeURIComponent(token)}`;
}

/** Where an invite link points: the organization's own server address when
 * it is a valid one (that is where everyone signs in), else `fallback` (the
 * server's public URL, then the request's origin). */
export function inviteLinkBase(state: OrgState, fallback: string | null): string | null {
  const host = state.org?.host;
  if (host?.kind === "server" && serverAddressOk(host.url)) return host.url.trim();
  return fallback;
}

/** `zara@example.com` as `z***@example.com`: enough for the invited person to
 * recognize their address, not enough to harvest it. */
export function maskEmail(email: string): string {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${value[0]}***${value.slice(at)}`;
}

export function getOrgRoute(state: OrgState, now = Date.now(), ownerEmail?: string, options: OrgViewOptions = {}) {
  if (!state.org) return { status: 404 as const };
  const manages = options.viewerRole === "owner" || options.viewerRole === "admin";
  const pendingInvites = state.invites
    .filter((invite) => inviteStatus(invite, now) === "open")
    .map((invite) => ({
      email: invite.email,
      expiresAt: invite.expiresAt,
      ...(manages ? { token: invite.token } : {}),
      ...(manages && options.linkBase ? { link: inviteLink(options.linkBase, invite.token) } : {}),
    }));
  return {
    status: 200 as const,
    body: {
      org: state.org,
      people: orgPeople(state, ownerEmail, options.emailOf),
      pendingInvites,
      ...(options.viewerRole !== undefined ? { viewerRole: options.viewerRole } : {}),
    },
  };
}

/** `persist` saves the new org before it becomes the state: a failed save
 * throws and leaves no organization behind. */
export function createOrgRoute(
  state: OrgState,
  input: { name: string; ownerUserId: string; host: OrgRecord["host"] },
  persist?: (org: OrgRecord) => void,
) {
  if (state.org) return { status: 409 };
  const org = createOrg(input);
  persist?.(org);
  state.org = org;
  return { status: 200, body: { org } };
}

export function issueInviteRoute(state: OrgState, input: { actorId: string; email: string; now: number; token: string; actorEmail?: string; linkBase?: string | null }) {
  if (!state.org) return { status: 404 };
  const role = roleOf({
    ownerUserId: state.org.ownerUserId,
    admins: state.signIn.admins,
    members: state.signIn.members,
    userId: input.actorId,
    email: input.actorEmail,
  });
  if (role !== "owner" && role !== "admin") return { status: 403 };
  const invite = issueInvite({ email: input.email, now: input.now, token: input.token });
  state.invites.push(invite);
  const link = input.linkBase ? inviteLink(input.linkBase, invite.token) : undefined;
  return { status: 200, body: { invite: { token: invite.token, email: invite.email, expiresAt: invite.expiresAt }, ...(link ? { link } : {}) } };
}

/** The invite email's subject and body. `link` is the invite link
 * (`<base>/join#token=...`); null when no address is known, in which case
 * the link clause is dropped rather than emailing a broken or empty URL.
 * Pure and exported so the wording is unit-testable without booting a
 * mailer. */
export function inviteMailMessage(input: { orgName: string; inviterEmail?: string; link: string | null }): { subject: string; text: string } {
  const greeting = input.inviterEmail ? `${input.inviterEmail} invited you` : "You were invited";
  const link = input.link
    ? `Open ${input.link} within 7 days to join ${input.orgName}.`
    : "Sign in with this address on this server's sign-in page within 7 days.";
  return {
    subject: `You are invited to ${input.orgName} on Sagax`,
    text: `${greeting} to ${input.orgName}. ${link}`,
  };
}

function sameEmail(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function revokeInviteRoute(state: OrgState, input: { actorId: string; token: string; now: number; actorEmail?: string }) {
  if (!state.org) return { status: 404 as const };
  const role = roleOf({
    ownerUserId: state.org.ownerUserId,
    admins: state.signIn.admins,
    members: state.signIn.members,
    userId: input.actorId,
    email: input.actorEmail,
  });
  if (role !== "owner" && role !== "admin") return { status: 403 as const };
  const found = state.invites.find((invite) => invite.token === input.token);
  if (!found) return { status: 404 as const };
  const status = inviteStatus(found, input.now);
  if (status !== "open") return { status: 200 as const, body: { status } };
  found.revokedAt = input.now;
  return { status: 200 as const, body: { status: "revoked" as const } };
}

/** Accept adds the invited address. The caller does not need to already be in signIn.members. The token stays bound to that email. */
export function acceptInviteRoute(state: OrgState, input: { token: string; userId: string; now: number; sessionEmail?: string }) {
  const found = state.invites.find((invite) => invite.token === input.token);
  if (!found) return { status: 200, body: { status: "used" as const } };
  if (!sameEmail(input.userId, found.email)) return { status: 403 };
  if (input.sessionEmail !== undefined && input.sessionEmail !== "" && !sameEmail(input.sessionEmail, found.email)) {
    return { status: 403 };
  }
  const accepted = acceptInvite(found, input.now);
  if (!accepted.ok) return { status: 200, body: { status: accepted.status } };
  const lists = memberListsAfterAccept({ members: state.signIn.members, email: found.email });
  if (lists.alreadyMember) return { status: 200, body: { status: "already-member" as const } };
  state.invites[state.invites.indexOf(found)] = accepted.invite;
  state.signIn.members = lists.members;
  return { status: 200, body: { status: "joined" as const } };
}

export type InviteLinkStatus = "open" | "expired" | "used" | "revoked" | "unknown";

/** An invite token as it may appear in a link: short, URL-safe. Anything
 * else is unknown without a lookup. */
function tokenShapeOk(token: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(token);
}

function findInvite(state: OrgState, token: string): OrgInvite | undefined {
  if (!state.org || !tokenShapeOk(token)) return undefined;
  return state.invites.find((invite) => invite.token === token);
}

/** What the public join page may show before anyone signs in: the status,
 * and for an open invite the organization's name and the masked address.
 * Never the token, the full address or any principal. */
export function invitePreviewRoute(state: OrgState, input: { token: string; now: number }): { status: 200; body: { status: InviteLinkStatus; orgName?: string; email?: string } } {
  const found = findInvite(state, input.token);
  if (!found) return { status: 200, body: { status: "unknown" } };
  const status = inviteStatus(found, input.now);
  if (status !== "open") return { status: 200, body: { status } };
  return { status: 200, body: { status, orgName: state.org!.name, email: maskEmail(found.email) } };
}

/** Whether an address already belongs to the organization: an admin, a
 * member, or the owner's own sign-in email. */
function alreadyInOrg(state: OrgState, email: string, ownerEmail?: string): boolean {
  const key = email.trim().toLowerCase();
  if (ownerEmail && ownerEmail.trim().toLowerCase() === key) return true;
  return [...state.signIn.admins, ...state.signIn.members].some((entry) => entry.trim().toLowerCase() === key);
}

/** Redeems an invite link (the public `POST /api/org/invites/:token/join`).
 *
 * Security model: the link is a bearer secret, like a Slack or Buzz invite
 * link. Whoever holds it joins as the invited address, so it is single use,
 * expires after 7 days (INVITE_TTL_MS) and an owner or admin can revoke it.
 * It grants only member scope ("client"), plus the channels and bots that
 * are explicitly shared with that person; never admin. An address already in
 * the organization gets no session here and must sign in instead, so a
 * leaked link cannot mint a second credential for an existing member.
 *
 * On "joined" the invite is marked used and the address added to the
 * members list; the caller persists, then issues the session. */
export function joinInviteRoute(state: OrgState, input: { token: string; now: number; ownerEmail?: string }):
  | { status: 200; body: { status: "joined"; orgName: string }; email: string }
  | { status: 404; body: { status: "unknown" } }
  | { status: 409; body: { status: "already-member" } }
  | { status: 410; body: { status: "expired" | "used" | "revoked" } } {
  const found = findInvite(state, input.token);
  if (!found) return { status: 404, body: { status: "unknown" } };
  const accepted = acceptInvite(found, input.now);
  if (!accepted.ok) return { status: 410, body: { status: accepted.status } };
  if (alreadyInOrg(state, found.email, input.ownerEmail)) return { status: 409, body: { status: "already-member" } };
  const lists = memberListsAfterAccept({ members: state.signIn.members, email: found.email });
  state.invites[state.invites.indexOf(found)] = accepted.invite;
  state.signIn.members = lists.members;
  return { status: 200, body: { status: "joined", orgName: state.org!.name }, email: found.email };
}

/** After a verified email sign-in: every open invite for that exact address
 * (case-insensitive) is accepted, since verified ownership of the address is
 * the proof the link would have given. Returns whether anything changed;
 * a second call changes nothing. */
export function acceptOpenInvitesForEmail(state: OrgState, input: { email: string; now: number }): boolean {
  if (!state.org) return false;
  const key = input.email.trim().toLowerCase();
  if (!key) return false;
  let changed = false;
  state.invites.forEach((invite, index) => {
    if (!sameEmail(invite.email, key)) return;
    const accepted = acceptInvite(invite, input.now);
    if (!accepted.ok) return;
    state.invites[index] = accepted.invite;
    changed = true;
  });
  if (!changed) return false;
  if (!state.signIn.admins.some((entry) => sameEmail(entry, key))) {
    state.signIn.members = memberListsAfterAccept({ members: state.signIn.members, email: key }).members;
  }
  return true;
}

/** `PATCH /api/org { host }`: owner or admin only, a valid server address. */
export function updateOrgHostRoute(state: OrgState, input: { actorId: string; actorEmail?: string; host: unknown }):
  | { status: 200; body: { org: OrgRecord } }
  | { status: 400; body: { error: string } }
  | { status: 403 | 404; body: Record<string, never> } {
  if (!state.org) return { status: 404, body: {} };
  const role = roleOf({
    ownerUserId: state.org.ownerUserId,
    admins: state.signIn.admins,
    members: state.signIn.members,
    userId: input.actorId,
    email: input.actorEmail,
  });
  if (role !== "owner" && role !== "admin") return { status: 403, body: {} };
  const host = parseHost(input.host);
  if (!host || host.kind !== "server" || !serverAddressOk(host.url.trim())) return { status: 400, body: { error: "a server address is required: https, a Tailscale name, or http://localhost" } };
  state.org = { ...state.org, host: { kind: "server", url: host.url.trim() } };
  return { status: 200, body: { org: state.org } };
}

function parseHost(value: unknown): OrgRecord["host"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { kind?: unknown; url?: unknown };
  if (record.kind === "this-computer") return { kind: "this-computer" };
  if (record.kind === "server" && typeof record.url === "string") return { kind: "server", url: record.url };
  return null;
}

export interface OrgRouteDeps {
  state: OrgState;
  actorId: (auth: RequestAuth) => string;
  actorEmail: (auth: RequestAuth) => string | undefined;
  /** The org owner's email, so the owner is not listed again by that email. */
  ownerEmail?: () => string | undefined;
  /** A principal's sign-in email, shown beside its id in the people list. */
  emailOf?: (principalId: string) => string | undefined;
  /** The server's public URL, when one is configured: the invite link's
   * base after the organization's own address, before the request origin. */
  publicUrl?: () => string | null;
  now?: () => number;
  token?: () => string;
  /** Saves the state; `next.org`, when given, is saved in place of the
   * current one (a new organization before it is assigned). */
  persist?: (next?: { org?: OrgRecord }) => void;
  /** After an organization was created and saved. */
  onOrgCreated?: () => void;
  /** After an invite is issued and saved: mails it when a mailer is
   * configured. Resolves to whether it was sent; that becomes the route's
   * `mailed` flag. A send failure — including a throw — never undoes the
   * invite; the handler treats a throw the same as a `false` resolution. */
  mailInvite?: (input: { email: string; token: string; inviterEmail?: string; origin: string | null; link: string | null }) => Promise<boolean>;
}

export function createOrgRoutes(deps: OrgRouteDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  const token = deps.token ?? (() => randomBytes(16).toString("hex"));
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const linkBase = () => inviteLinkBase(deps.state, deps.publicUrl?.() ?? requestOrigin(req));
    if (method === "GET" && path === "/api/org") {
      const org = deps.state.org;
      const viewerRole = org
        ? roleOf({ ownerUserId: org.ownerUserId, admins: deps.state.signIn.admins, members: deps.state.signIn.members, userId: deps.actorId(auth), email: deps.actorEmail(auth) })
        : null;
      const result = getOrgRoute(deps.state, now(), deps.ownerEmail?.(), { viewerRole, linkBase: linkBase(), emailOf: deps.emailOf });
      return json(res, result.status, result.body ?? {});
    }
    if (method === "PATCH" && path === "/api/org") {
      const body = await readBody(req);
      const before = deps.state.org;
      const result = updateOrgHostRoute(deps.state, { actorId: deps.actorId(auth), actorEmail: deps.actorEmail(auth), host: body?.host });
      if (result.status === 200) {
        try {
          deps.persist?.();
        } catch (error) {
          deps.state.org = before;
          return json(res, 500, { error: `the organization could not be saved: ${error instanceof Error ? error.message : String(error)}` });
        }
      }
      return json(res, result.status, result.body);
    }
    if (method !== "POST") return PASS;
    if (path === "/api/org") {
      const body = await readBody(req);
      const host = parseHost(body?.host);
      if (typeof body?.name !== "string" || !host) return json(res, 400, { error: "name and host are required" });
      let saveFailed: unknown;
      const persist = deps.persist;
      try {
        const result = createOrgRoute(deps.state, { name: body.name, ownerUserId: deps.actorId(auth), host }, persist
          ? (org) => {
            try {
              persist({ org });
            } catch (error) {
              saveFailed = error;
              throw error;
            }
          }
          : undefined);
        if (result.status === 200) deps.onOrgCreated?.();
        return json(res, result.status, result.body ?? {});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (saveFailed !== undefined) return json(res, 500, { error: `the organization could not be saved: ${message}` });
        return json(res, 400, { error: message });
      }
    }
    if (path === "/api/org/invites") {
      const body = await readBody(req);
      if (typeof body?.email !== "string") return json(res, 400, { error: "email is required" });
      const inviterEmail = deps.actorEmail(auth);
      const result = issueInviteRoute(deps.state, {
        actorId: deps.actorId(auth),
        actorEmail: inviterEmail,
        email: body.email,
        now: now(),
        token: token(),
        linkBase: linkBase(),
      });
      if (result.status !== 200) return json(res, result.status, result.body ?? {});
      deps.persist?.();
      let mailed = false;
      if (result.body?.invite) {
        try {
          mailed = (await deps.mailInvite?.({
            email: result.body.invite.email,
            token: result.body.invite.token,
            inviterEmail,
            origin: requestOrigin(req),
            link: result.body.link ?? null,
          })) ?? false;
        } catch {
          // A hook that throws never undoes an already-persisted invite.
          mailed = false;
        }
      }
      return json(res, result.status, { ...result.body, mailed });
    }
    const revoke = /^\/api\/org\/invites\/([^/]+)\/revoke$/.exec(path);
    if (revoke) {
      const result = revokeInviteRoute(deps.state, {
        actorId: deps.actorId(auth),
        actorEmail: deps.actorEmail(auth),
        token: decodeURIComponent(revoke[1]!),
        now: now(),
      });
      if (result.status === 200 && result.body.status === "revoked") deps.persist?.();
      return json(res, result.status, result.status === 200 ? result.body : {});
    }
    const accept = /^\/api\/org\/invites\/([^/]+)\/accept$/.exec(path);
    if (!accept) return PASS;
    const body = await readBody(req);
    if (typeof body?.userId !== "string") return json(res, 400, { error: "userId is required" });
    const sessionEmail = auth.kind === "session" ? auth.session.email : undefined;
    const result = acceptInviteRoute(deps.state, {
      token: decodeURIComponent(accept[1]!),
      userId: deps.actorEmail(auth) ?? body.userId,
      now: now(),
      sessionEmail,
    });
    if (result.body?.status === "joined") deps.persist?.();
    return json(res, result.status, result.body ?? {});
  };
}

export interface PublicInviteRouteDeps {
  state: OrgState;
  now?: () => number;
  ownerEmail?: () => string | undefined;
  /** Per-source lockout shared with pairing (sessions.attemptAllowed and
   * friends): an unknown token counts as a failed attempt. */
  limiter: {
    source: (req: IncomingMessage) => string;
    allowed: (source: string) => { ok: true } | { ok: false; retryAfterMs: number };
    noteFailure: (source: string) => void;
    clearFailures: (source: string) => void;
  };
  /** Saves the state. Runs before the session is issued, so a failed save
   * issues nothing (the state is rolled back by the handler). */
  persist?: () => void;
  /** Issues the member session and sets its cookie on `res`, exactly like
   * the pair route. */
  signIn: (input: { req: IncomingMessage; res: ServerResponse; email: string }) => void;
}

export const PUBLIC_INVITE_PATH = /^\/api\/org\/invites\/([^/]+)\/(preview|join)$/;

/** The two public invite routes, answered before the auth gate (like
 * /api/auth/email/start): `GET .../preview` and `POST .../join`. See
 * `joinInviteRoute` for the security model. */
export function createPublicInviteRoutes(deps: PublicInviteRouteDeps) {
  const now = deps.now ?? Date.now;
  return async (ctx: { req: IncomingMessage; res: ServerResponse; path: string; method: string; json: RouteContext["json"]; readBody: RouteContext["readBody"] }): Promise<boolean> => {
    const { req, res, path, method, json } = ctx;
    const match = PUBLIC_INVITE_PATH.exec(path);
    if (!match) return false;
    const action = match[2];
    res.setHeader("cache-control", "no-store");
    if ((action === "preview" && method !== "GET") || (action === "join" && method !== "POST")) {
      json(res, 405, { error: "method not allowed" });
      return true;
    }
    let token = "";
    try {
      token = decodeURIComponent(match[1]!);
    } catch {
      token = "";
    }
    const source = deps.limiter.source(req);
    const allowed = deps.limiter.allowed(source);
    if (!allowed.ok) {
      json(res, 429, { error: `too many failed attempts from your address; try again in ${Math.ceil(allowed.retryAfterMs / 1000)}s` });
      return true;
    }
    if (action === "preview") {
      const result = invitePreviewRoute(deps.state, { token, now: now() });
      if (result.body.status === "unknown") deps.limiter.noteFailure(source);
      json(res, result.status, result.body);
      return true;
    }
    // JSON only, like /api/auth/pair: a cross-site form cannot send this
    // content type without a preflight, so a link cannot be redeemed into
    // someone else's browser behind their back.
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      json(res, 415, { error: "send the join request as JSON (content-type: application/json)" });
      return true;
    }
    await ctx.readBody(req).catch(() => undefined);
    const snapshot = { invites: deps.state.invites.map((invite) => ({ ...invite })), members: [...deps.state.signIn.members] };
    const result = joinInviteRoute(deps.state, { token, now: now(), ownerEmail: deps.ownerEmail?.() });
    if (result.status === 404) {
      deps.limiter.noteFailure(source);
      json(res, 404, result.body);
      return true;
    }
    if (result.status !== 200) {
      json(res, result.status, result.body);
      return true;
    }
    try {
      deps.persist?.();
    } catch (error) {
      deps.state.invites.splice(0, deps.state.invites.length, ...snapshot.invites);
      deps.state.signIn.members = snapshot.members;
      json(res, 500, { error: `the invitation could not be saved: ${error instanceof Error ? error.message : String(error)}` });
      return true;
    }
    deps.limiter.clearFailures(source);
    try {
      deps.signIn({ req, res, email: result.email });
    } catch (error) {
      // The address is a member now; only this browser's session failed.
      res.removeHeader("set-cookie");
      json(res, 500, { status: "joined", orgName: result.body.orgName, error: `you joined, but this browser could not be signed in: ${error instanceof Error ? error.message : String(error)}. Sign in with your email instead.` });
      return true;
    }
    json(res, 200, result.body);
    return true;
  };
}

// ── a solo server (slice 8) ──────────────────────────────────────────────
// A solo Sagax has no organization: a person joins one by copying their
// bots into a Perspicax server (server/org/org-export.ts). It keeps its own
// people: the email sign-in list, and invitations to it issued in the name
// of this server (OrgState.org is then derived, never stored).
//
//   GET          /api/org                   404 no_organization
//   POST, PATCH  /api/org                   410 interim_org_removed
//   GET          /api/org/invites           this server's people and pending invitations
//   POST         /api/org/invites[/...]     the invitation routes above
//
// An organization server refuses the email and invitation routes with 403
// identity_perspicax before the auth gate (server/auth/oidc-login.ts) and serves
// its own /api/org (server/perspicax/perspicax-org-routes.ts).

export const INTERIM_ORG_REMOVED = {
  error: "Organizations on a personal Sagax were removed. Join a Perspicax server from Settings > Organization.",
  code: "interim_org_removed",
} as const;

export const NO_ORGANIZATION = {
  error: "This Sagax has no organization. Join a Perspicax server from Settings > Organization.",
  code: "no_organization",
} as const;

/** The organization and invitation routes of a solo server (after the auth gate). */
export function createSoloOrgRoutes(deps: OrgRouteDeps): RouteHandler {
  const invites = createOrgRoutes(deps);
  return async (ctx) => {
    const { res, path, method, json } = ctx;
    if (path === "/api/org") {
      if (method === "GET") return json(res, 404, { ...NO_ORGANIZATION });
      if (method === "POST" || method === "PATCH") return json(res, 410, { ...INTERIM_ORG_REMOVED });
      return json(res, 405, { error: "method not allowed" });
    }
    // The invitation directory (admin scope at the gate): this server's
    // name, its people and the pending invitations, as GET /api/org answered
    // while an interim organization existed.
    if (method === "GET" && path === "/api/org/invites") {
      const org = deps.state.org;
      if (!org) return json(res, 404, { ...NO_ORGANIZATION });
      const viewerRole = roleOf({ ownerUserId: org.ownerUserId, admins: deps.state.signIn.admins, members: deps.state.signIn.members, userId: deps.actorId(ctx.auth), email: deps.actorEmail(ctx.auth) });
      const linkBase = inviteLinkBase(deps.state, deps.publicUrl?.() ?? requestOrigin(ctx.req));
      const result = getOrgRoute(deps.state, (deps.now ?? Date.now)(), deps.ownerEmail?.(), { viewerRole, linkBase, emailOf: deps.emailOf });
      return json(res, result.status, result.body ?? {});
    }
    return invites(ctx);
  };
}
