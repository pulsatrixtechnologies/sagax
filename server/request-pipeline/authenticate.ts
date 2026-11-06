// @ts-nocheck
/** authenticate (#1388). Pure move from server/index.ts. */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestAuth } from "../auth/request-auth.ts";

export interface AuthenticateDeps {
  ACT_CONFIRMED_HEADER: any;
  CONTINUATION_HEADER: any;
  HOSTED_WORKSPACE: any;
  IDENTITY: any;
  IDP_REFRESH_WAIT_MS: any;
  ON_BEHALF_HEADER: any;
  ON_BEHALF_SECRET: any;
  PRE_AUTH_AFTER_RESOLVE: any;
  REACTION_ROUTE: any;
  SESSION_COOKIE: any;
  WORKER_RELAY_TOKEN: any;
  LOOPBACK: any;
  achievementRequestEvents: any;
  actConfirmedScope: any;
  actorPrincipalId: any;
  adminAnswersPendingApproval: any;
  authRefusals: any;
  beginAdminAudit: any;
  bodyForThreadViewer: any;
  botFacts: any;
  botThreadReadable: any;
  canOnBot: any;
  cfg: any;
  channelFilterViewerId: any;
  channelViewerId: any;
  clearSessionCookie: any;
  cliOwnerToken: any;
  companionMutationToken: any;
  confidentialFileOf: any;
  confidentialThreadIds: any;
  continuationThreadScope: any;
  cookieMaxAgeSeconds: any;
  delegatedRequestScope: any;
  desktopMutationToken: any;
  dispatchPreAuthRoutes: any;
  groupPostAllowed: any;
  headerText: any;
  idpSessions: any;
  isAccountEmail: any;
  isBotActSession: any;
  isPeopleDmParticipant: any;
  isReportPath: any;
  isWorkspaceBackupRoute: any;
  isWorkspaceBackupSessionControl: any;
  json: any;
  lendingEnabled: any;
  masteryCensus: any;
  masteryRequestFacts: any;
  memberBody: any;
  namesConfidentialThread: any;
  notFoundFor: any;
  onJsonBody: any;
  parseCookies: any;
  pathSubject: any;
  peopleDmRouteRefusal: any;
  permissionRefusal: any;
  principals: any;
  privateThreads: any;
  readBody: any;
  recordAchievements: any;
  recordMastery: any;
  requestOrigin: any;
  requiredScope: any;
  resolveRequestAuth: any;
  roomOfSubject: any;
  roomPeopleCount: any;
  routePermissions: any;
  scrubConfidentialThreads: any;
  secureTokenMatch: any;
  serializeSessionCookie: any;
  serviceThreadViewer: any;
  serviceViewerClosed: any;
  sessionPermits: any;
  sessions: any;
  settledWithin: any;
  sharedComputersEnabled: any;
  sharedLibraryGetAllowed: any;
  store: any;
  subjectSeesChannel: any;
  subjectVisible: any;
  takeActConfirmation: any;
  takeOwnerContinuation: any;
  teamComputers: any;
  threadsReferencing: any;
  threadViewerScope: any;
  viewerFor: any;
  visibleTo: any;
  workspaceAccess: any;
  workspaceMaintenance: any;
  authzViewerFromId: any;
}

/** Request-scoped stores authenticate sets (handleRequest re-enters them after awaits). */
export type RequestScopes = {
  viewer: string | null;
  delegated: boolean;
  continuation: any;
  actConfirmed: any;
  /** The admin whose config saves this request records (beginAdminAudit). */
  adminActor?: any;
};

export function createAuthenticate(getHost: () => AuthenticateDeps) {
async function authenticate(req: IncomingMessage, res: ServerResponse, url: URL, path: string, method: string, state: { m?: RegExpMatchArray | null; releaseWorkspaceRequest?: () => void; scopes?: RequestScopes }): Promise<RequestAuth | null> {
  const {
    ACT_CONFIRMED_HEADER,
    CONTINUATION_HEADER,
    HOSTED_WORKSPACE,
    IDENTITY,
    IDP_REFRESH_WAIT_MS,
    ON_BEHALF_HEADER,
    ON_BEHALF_SECRET,
    PRE_AUTH_AFTER_RESOLVE,
    REACTION_ROUTE,
    SESSION_COOKIE,
    WORKER_RELAY_TOKEN,
    LOOPBACK,
    achievementRequestEvents,
    actConfirmedScope,
    actorPrincipalId,
    adminAnswersPendingApproval,
    authRefusals,
    beginAdminAudit,
    bodyForThreadViewer,
    botFacts,
    botThreadReadable,
    canOnBot,
    cfg,
    channelFilterViewerId,
    channelViewerId,
    clearSessionCookie,
    cliOwnerToken,
    companionMutationToken,
    confidentialFileOf,
    confidentialThreadIds,
    continuationThreadScope,
    cookieMaxAgeSeconds,
    delegatedRequestScope,
    desktopMutationToken,
    dispatchPreAuthRoutes,
    groupPostAllowed,
    headerText,
    idpSessions,
    isAccountEmail,
    isBotActSession,
    isPeopleDmParticipant,
    isReportPath,
    isWorkspaceBackupRoute,
    isWorkspaceBackupSessionControl,
    json,
    lendingEnabled,
    masteryCensus,
    masteryRequestFacts,
    memberBody,
    namesConfidentialThread,
    notFoundFor,
    onJsonBody,
    parseCookies,
    pathSubject,
    peopleDmRouteRefusal,
    permissionRefusal,
    principals,
    privateThreads,
    readBody,
    recordAchievements,
    recordMastery,
    requestOrigin,
    requiredScope,
    resolveRequestAuth,
    roomOfSubject,
    roomPeopleCount,
    routePermissions,
    scrubConfidentialThreads,
    secureTokenMatch,
    serializeSessionCookie,
    serviceThreadViewer,
    serviceViewerClosed,
    sessionPermits,
    sessions,
    settledWithin,
    sharedComputersEnabled,
    sharedLibraryGetAllowed,
    store,
    subjectSeesChannel,
    subjectVisible,
    takeActConfirmation,
    takeOwnerContinuation,
    teamComputers,
    threadsReferencing,
    threadViewerScope,
    viewerFor,
    visibleTo,
    workspaceAccess,
    workspaceMaintenance,
    authzViewerFromId
  } = getHost();

  const gate = resolveRequestAuth(req, {
    sessions,
    cookieName: SESSION_COOKIE,
    streamPath: "/api/events",
    url,
    loopbackMutationToken: desktopMutationToken,
    companionMutationToken,
    features: { sharedComputers: lendingEnabled(), orgPairing: IDENTITY.kind === "perspicax", orgDirectory: IDENTITY.kind === "perspicax", serverCatalogue: IDENTITY.kind !== "perspicax" },
    loopbackTrust: LOOPBACK.trust,
    cliOwnerToken,
    trustLocalBrowser: LOOPBACK.localBrowsers,
    workerRelayToken: WORKER_RELAY_TOKEN,
    permits: sessionPermits
  });
  // The browser's cookie carries the term it was set with, and the
  // session's term slides on use (sessions.ts `renew`), so re-issue the
  // cookie on every cookie-authenticated request. One small header; and
  // unlike "send once per renewal" it survives a lost response and a
  // restart. Later handlers that clear the cookie (logout, self-revoke)
  // overwrite this header, which is the order we want.
  if (gate.auth?.kind === "session" && gate.auth.via === "cookie") {
    const presented = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
    if (presented) {
      const secure = HOSTED_WORKSPACE || requestOrigin(req)?.startsWith("https://") === true;
      res.setHeader("set-cookie", serializeSessionCookie(SESSION_COOKIE, presented, { secure, maxAgeSeconds: cookieMaxAgeSeconds(gate.auth.session) }));
    }
  }
  // Unauthenticated /api/health and /api/brand (signed-in callers PASS to
  // the post-gate handlers in ROUTES).
  if (await dispatchPreAuthRoutes(PRE_AUTH_AFTER_RESOLVE, {
    req, res, url, path, method, auth: gate.auth, json, readBody,
  })) return null;
  // Slice 8: an organization copy is always someone's. Loopback (a bot's
  // shell here) and anyone without a session are told to sign in.
  if (IDENTITY.kind === "perspicax" && path === "/api/org/import" && gate.auth?.kind !== "session") {
    json(res, 401, { error: "Sign in with Pulsatrix to copy bots into this organization.", code: "session_required" });
    return null;
  }
  if (!gate.auth) {
    if (gate.status === 401 && gate.code === "sign_in_required") {
      json(res, 401, { error: gate.error, code: gate.code });
      return null;
    }
    if (gate.status === 401 && gate.code) {
      authRefusals.record({ event: "refused", status: 401, code: gate.code, method, path, via: gate.via, userAgent: headerText(req.headers["user-agent"]), sessionId: gate.sessionId });
      // A cookie that names no session any more is cleared, so the browser
      // stops presenting it; only for a definitive reason (an unknown one
      // may be a request that raced a deploy).
      if (gate.via === "cookie" && gate.code !== "session_unknown") res.setHeader("set-cookie", clearSessionCookie(SESSION_COOKIE));
      json(res, 401, { error: gate.error, code: gate.code });
      return null;
    }
    json(res, gate.status, gate.permission ? permissionRefusal(gate.permission) : { error: gate.error });
    return null;
  }
  const auth = gate.auth;
  // Organization server: a person the provider signalled out is not
  // served, and a session whose grant the provider stopped refreshing ends
  // (server/auth/idp-session.ts). A grant due for its refresh is refreshed
  // before the request is served (bounded wait), so the very request that
  // found it due already carries the provider's answer: a demotion, a
  // disabled person.
  if (idpSessions && auth.kind === "session") {
    const endSession = (status: number, code: "idp_session_ended" | "principal_disabled", error: string, detail: string) => {
      sessions.revoke(auth.session.id, code);
      authRefusals.record({ event: "ended", status, code, method, path, via: auth.via, userAgent: headerText(req.headers["user-agent"]), sessionId: auth.session.id, detail });
      if (auth.via === "cookie") res.setHeader("set-cookie", clearSessionCookie(SESSION_COOKIE));
      json(res, status, { error, code });
      return null;
    };
    const disabled = () => {
      const person = auth.session.principalId ? principals.byId(auth.session.principalId) : null;
      return person?.disabledAt !== undefined || Boolean(person?.consoleDisabled);
    };
    if (disabled()) return endSession(401, "principal_disabled", "Your account is disabled in Pulsatrix or on this Sagax server. Ask an administrator.", "the person is disabled or marked out");
    // What the gate checked the route against, before any refresh.
    const gated = [...auth.scopes];
    // 2026-10-19: a session kept across an unclean restart waits for the
    // provider to confirm it. Refused there, it ends below like any other;
    // provider not answering yet, a 503 the client retries, never a sign-out.
    if (sessions.needsRecheck(auth.session.id)) {
      await settledWithin(idpSessions.recheck(auth.session), IDP_REFRESH_WAIT_MS);
      const waiting = sessions.byId(auth.session.id);
      if (waiting && sessions.needsRecheck(waiting.id)) {
        // No grant left to confirm it (a logout whose write was lost, a
        // device whose person has no live sign-in): ended, not "retry".
        if (idpSessions.mustRefuse(waiting) === "idp_session_ended") return endSession(401, "idp_session_ended", "Your Pulsatrix sign-in has ended. Sign in again.", "no sign-in grant left to confirm it after an unclean restart");
        res.setHeader("retry-after", "5");
        json(res, 503, { error: "Sagax restarted and is confirming your Pulsatrix sign-in. Try again in a moment.", code: "idp_recheck_pending" });
        return null;
      }
    }
    await settledWithin(idpSessions.touch(auth.session), IDP_REFRESH_WAIT_MS);
    const current = sessions.byId(auth.session.id);
    if (!current || disabled()) {
      // The refresh that ran for this request ended the session (it logged why).
      const code = current ? "principal_disabled" : "idp_session_ended";
      if (current) sessions.revoke(current.id, code);
      authRefusals.record({ event: "refused", status: 401, code, method, path, via: auth.via, userAgent: headerText(req.headers["user-agent"]), sessionId: auth.session.id });
      if (auth.via === "cookie") res.setHeader("set-cookie", clearSessionCookie(SESSION_COOKIE));
      json(res, 401, { error: code === "principal_disabled" ? "Your account is disabled in Pulsatrix or on this Sagax server. Ask an administrator." : "Your Pulsatrix sign-in has ended. Sign in again.", code });
      return null;
    }
    const refusal = idpSessions.mustRefuse(current);
    if (refusal === "idp_session_ended") return endSession(401, refusal, "Your Pulsatrix sign-in has ended. Sign in again.", "no live sign-in grant for this session");
    if (refusal === "idp_unreachable") {
      // 2026-10-20: Perspicax has not answered a refresh for a long time.
      // The session is not served until it does, but it is never ended for
      // that: a 503 the client retries, never a sign-out.
      authRefusals.record({ event: "refused", status: 503, code: refusal, method, path, via: auth.via, userAgent: headerText(req.headers["user-agent"]), sessionId: current.id });
      res.setHeader("retry-after", "30");
      json(res, 503, { error: "Sagax cannot reach Pulsatrix to confirm your sign-in. Try again in a moment.", code: "idp_unreachable" });
      return null;
    }
    // A device with no grant of its own never holds more than its person's
    // organization role now, even when no grant of theirs was refreshed.
    const person = current.principalId ? principals.byId(current.principalId) : null;
    const clamped = idpSessions.clampScopes(current, person?.orgRole);
    if (clamped) {
      if (!clamped.length) return endSession(401, "idp_session_ended", "Your Pulsatrix sign-in has ended. Sign in again.", "the person's organization role leaves this device no scope");
      sessions.setScopes(current.id, clamped);
    }
    const scopes = clamped ?? current.scopes;
    const narrowed = gated.some((scope) => !scopes.includes(scope));
    auth.session.scopes = scopes;
    auth.scopes = scopes;
    if (current.idp) auth.session.idp = current.idp;
    if (narrowed) {
      const features = { sharedComputers: sharedComputersEnabled(cfg), orgPairing: IDENTITY.kind === "perspicax", orgDirectory: IDENTITY.kind === "perspicax", serverCatalogue: IDENTITY.kind !== "perspicax" };
      const needed = requiredScope(method, path, features);
      if (!scopes.includes(needed)) {
        // 2026-10-09: a route a permission opens (PERMISSION_ROUTES).
        const grants = needed === "admin" && scopes.includes("client") ? routePermissions(method, path, features) : null;
        if (!grants) {
          json(res, 403, { error: `forbidden: this session lacks the ${needed} scope` });
          return null;
        }
        if (!grants.some((key) => sessionPermits(auth.session, key))) {
          json(res, 403, permissionRefusal(grants[0]));
          return null;
        }
      }
    }
  }
  if (HOSTED_WORKSPACE && auth.kind === "session") {
    const failure = workspaceAccess
      ? await workspaceAccess.authorize(req, auth)
      : { status: 503, error: "Workspace sign-in is unavailable." };
    if (failure) {
      json(res, failure.status, { error: failure.error });
      return null;
    }
  }
  // A portal-issued or older account session never went through email
  // sign-in: give it its person now, so it owns what it owned by email.
  // An address that is not an account email stays nobody.
  if (auth.kind === "session" && !auth.session.principalId && auth.session.email && isAccountEmail(auth.session.email)) {
    const userId = auth.session.userId;
    const principal = principals.forAccount({
      email: auth.session.email,
      controlPlaneUserId: userId && !userId.startsWith("portal:") ? userId : undefined
    });
    sessions.setPrincipal(auth.session.id, principal.id);
    auth.session.principalId = principal.id;
  }
  // Bot visibility: a member reaches a restricted bot, its threads, rooms,
  // routines and files exactly as they reach an id that does not exist.
  // Lists and live frames are narrowed where they are built, below.
  const visible = visibleTo(viewerFor(auth, path));
  const viewerId = channelFilterViewerId(auth);
  if (!visible.everything) {
    const subject = pathSubject(path);
    if (subject && !subjectVisible(subject, visible)) {
      json(res, 404, { error: notFoundFor(subject) });
      return null;
    }
    // Every bot a member is sent (a read receipt, a profile or display
    // edit, a new or switched task) comes without its audience list or
    // the teammates they cannot see, whichever route answers.
    onJsonBody(res, (body) => memberBody(body, visible));
  }
  // Perspicax #321: an archived temporary agent takes no more work. Its
  // conversations stay readable to whoever could read them until the purge.
  if (method !== "GET" && method !== "HEAD" && method !== "DELETE") {
    const subject = pathSubject(path);
    const subjectBot = subject?.kind === "bot" ? store.bot(subject.id) : subject?.kind === "thread" ? store.botByThread(subject.id) : undefined;
    if (subjectBot?.temporary?.archived) {
      json(res, 410, { error: "This agent was archived.", code: "agent_archived" });
      return null;
    }
  }
  // A bot's grants are judged by server/bots/bot-grants.ts (slice 4): an admin
  // or a team manager administers them without seeing the bot.
  const grantRoute = IDENTITY.kind === "perspicax" && /^\/api\/bots\/[\w-]+\/grants(?:\/[^/]+)?$/.test(path);
  // Private threads (server/threads/thread-privacy.ts): the helpers routes call
  // without the request read who is asking from here. Set for every
  // request, so a kept-alive connection never inherits one.
  const scopedViewerId = serviceThreadViewer(serviceViewerClosed(auth, path, privateThreads()), viewerId);
  const scopes: RequestScopes = { viewer: scopedViewerId ?? null, delegated: false, continuation: null, actConfirmed: null };
  state.scopes = scopes;
  threadViewerScope.enterWith(scopes.viewer);
  // On someone's behalf (act, an AI client): a confidential thread is not
  // there. Named in the path or query: 404; in an answer: cut out, and an
  // answer that still names one is withheld.
  // An on-behalf request: a delegated session (a bot act copy, an AI
  // client), or this server's own act request for the operator (its
  // header carries a process secret). The follow-up of a card its owner
  // allowed in person carries a one-shot token for exactly that thread.
  const onBehalfHeader = req.headers[ON_BEHALF_HEADER];
  const continuationHeader = req.headers[CONTINUATION_HEADER];
  const continuation = takeOwnerContinuation(typeof continuationHeader === "string" ? continuationHeader : undefined, method, path);
  const delegated = !continuation && ((auth.kind === "session" && auth.session.ephemeral === true)
    || secureTokenMatch(typeof onBehalfHeader === "string" ? onBehalfHeader : undefined, ON_BEHALF_SECRET));
  scopes.delegated = delegated;
  scopes.continuation = continuation;
  delegatedRequestScope.enterWith(delegated);
  continuationThreadScope.enterWith(continuation);
  const confirmedHeader = req.headers[ACT_CONFIRMED_HEADER];
  // only this server's own replay carries it: a bot act copy of the
  // person's session, or the operator through the desktop owner header
  scopes.actConfirmed = (auth.kind === "session" && isBotActSession(auth.session)) || (auth.kind === "loopback" && auth.trust !== "service")
    ? takeActConfirmation(typeof confirmedHeader === "string" ? confirmedHeader : undefined, method, path)
    : null;
  actConfirmedScope.enterWith(scopes.actConfirmed);
  if (delegated) {
    const confidentialIds = confidentialThreadIds();
    if (confidentialIds.size) {
      if (namesConfidentialThread(`${path}?${url.search}`, confidentialIds)) {
        json(res, 404, { error: "no such conversation" });
        return null;
      }
      // a stored file only confidential threads point at is not there either
      const file = confidentialFileOf(path);
      if (file) {
        // read now, not from the minute-long cache: a message may have just named it
        const using = threadsReferencing(file);
        if (using.length && using.every((threadId) => confidentialIds.has(threadId))) {
          json(res, 404, { error: "no such file" });
          return null;
        }
      }
      onJsonBody(res, (body) => {
        const cleaned = scrubConfidentialThreads(body, confidentialIds);
        return namesConfidentialThread(JSON.stringify(cleaned), confidentialIds) ? { error: "This answer names a confidential thread." } : cleaned;
      });
    }
  }
  if (scopedViewerId && privateThreads()) {
    // A bot thread named in the path or the query is its owner's only;
    // every bot a response carries shows this viewer their threads only.
    const named = path.match(/^\/api\/threads\/([\w-]+)(?:\/|$)/)?.[1]
      // A task and its sub-routes (Regenerate title: .../tasks/<id>/title).
      ?? path.match(/^\/api\/bots\/[\w-]+\/tasks\/([\w-]+)(?:\/|$)/)?.[1]
      ?? (/^\/api\/bots\/[\w-]+\//.test(path) ? url.searchParams.get("threadId") ?? undefined : undefined);
    const owner = named ? store.botByThread(named) : null;
    // The one exception the spec writes down (slice 3, D15): an
    // organization admin answers a card that waits for an admin, without
    // reading the thread (POST .../respond only).
    // Shared bot library (#2019): a person with bot.use may GET one file
    // (download / preview / thumb) from a non-confidential thread of that
    // bot, so Links / Media / Files URLs open for a shared viewer.
    if (named && owner && !adminAnswersPendingApproval(method, path, auth) &&
      !botThreadReadable(owner, named, scopedViewerId, method === "GET" ? "thread.read" : "thread.post")) {
      // The bot's main thread (bot.threadId) is in the library too (not a task).
      const task = named === owner.threadId ? null : store.taskByThread(owner.id, named);
      const libraryFile = sharedLibraryGetAllowed({
        method, path, task,
        mainThread: named === owner.threadId,
        mayUseBot: Boolean(canOnBot(authzViewerFromId(scopedViewerId), "bot.use", botFacts(owner))),
      });
      if (!libraryFile) {
        json(res, 404, { error: "no such conversation" });
        return null;
      }
    }
    onJsonBody(res, (body) => bodyForThreadViewer(body, scopedViewerId));
  }
  if (scopedViewerId && !grantRoute && !adminAnswersPendingApproval(method, path, auth)) {
    const subject = pathSubject(path);
    if (subject && !subjectSeesChannel(subject, scopedViewerId)) {
      json(res, 404, { error: notFoundFor(subject) });
      return null;
    }
    // Slice 4: a read-only member of a shared section reads its rooms and
    // changes nothing in them (settings, tasks, queue, interrupt, cards). A reaction and a report
    // (App Store 1.2) are a reader's, like a read receipt.
    const room = IDENTITY.kind === "perspicax" && method !== "GET" && method !== "HEAD" && !/^\/api\/(?:groups|threads)\/[\w-]+\/read$/.test(path) && !REACTION_ROUTE.test(path) && !isReportPath(path) ? roomOfSubject(subject) : null;
    if (room && !groupPostAllowed(room, scopedViewerId)) {
      json(res, 403, { error: "you may read this channel, not change it", code: "read_only" });
      return null;
    }
  }
  {
    // A conversation between two people (server/people/people-dms.ts): only they
    // reach it, loopback included, and it only takes messages.
    const subject = pathSubject(path);
    const dmRoom = roomOfSubject(subject);
    if (subject && dmRoom?.peopleDm) {
      if (!isPeopleDmParticipant(dmRoom, channelViewerId(auth))) {
        json(res, 404, { error: notFoundFor(subject) });
        return null;
      }
      const refusal = peopleDmRouteRefusal(method, path);
      if (refusal) {
        json(res, 400, { error: refusal, code: "people_dm" });
        return null;
      }
    }
  }
  scopes.adminActor = beginAdminAudit(req, res, method, path, auth);

  if (method === "POST" && path === "/api/workspace-backup/restore" && teamComputers.list().some(computer => computer.section !== null)) {
    json(res, 409, { error: "Unassign team computers before restoring a workspace; restored team names must not gain access to existing desktops" });
    return null;
  }
  // Count ordinary requests until their asynchronous handler returns, not
  // merely until the browser disconnects. A cancelled upload can still write.
  // The backup routes are not counted: they take the workspace themselves
  // (workspaceMaintenance.run), and an export counted as an open request
  // would always find one and answer 409 (they ran before this count until
  // the route-table split).
  if (path.startsWith("/api/") && path !== "/api/events" && path !== "/api/health" && !path.startsWith("/api/shared-computers/") && !isWorkspaceBackupRoute(path) && !isWorkspaceBackupSessionControl(method, path)) {
    state.releaseWorkspaceRequest = workspaceMaintenance.request();
  }

  // New routes live in modules registered in server/routes/table.ts and
  // are tried here, behind the gate above; do not add route `if`s below.
  // What a successful request earns its person (server/achievements.ts).
  if (method !== "GET" && method !== "HEAD") {
    const achiever = actorPrincipalId(auth);
    if (achiever) {
      res.once("finish", () => {
        recordAchievements(achiever, achievementRequestEvents({ method, path, status: res.statusCode }, {
          group: (id) => {
            const group = store.group(id);
            return group ? { peopleDm: group.peopleDm === true, humans: roomPeopleCount(group.humanIds), bots: group.memberIds?.length ?? 0 } : null;
          }
        }));
        try {
          recordMastery(masteryRequestFacts({ method, path, status: res.statusCode }, achiever, {
            catalogPublisher: (botId) => {
              const catalog = store.bot(botId)?.catalog;
              return catalog?.published ? catalog.publishedBy ?? null : null;
            },
            census: masteryCensus
          }));
        } catch {
          /* a bonus: never fail the request */
        }
      });
    }
  }
  return auth;
}

  return authenticate;
}
