/**
 * Person engines HTTP routes (#1388): GET /api/me/engines and login status/actions.
 * Pure move out of server/index.ts; behaviour unchanged. Never imports index.ts.
 * Deps are read per request so late-bound index lets stay valid.
 */
import { PASS, type RouteHandler } from "./table.ts";

/** Injected closures from index.ts. Pure move; host locals stay loosely typed. */
export type MeEnginesRouteDeps = Record<string, any>;

export function createMeEnginesRoutes(deps: MeEnginesRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
  if (path !== "/api/me/engines" && !path.startsWith("/api/me/engines/")) return PASS;
  res.setHeader("cache-control", "no-store");
  const principalId = auth.kind === "session" ? auth.session.principalId?.trim() || "" : deps.localPrincipalId();
  if (!principalId || !deps.isPrincipalId(principalId)) return json(res, 403, { error: "sign in as a person first" });
  const person = deps.principals.byId(principalId);
  const sub = person?.subject?.iss === deps.IDENTITY.issuer ? person.subject.sub : undefined;
  if (method === "GET" && path === "/api/me/engines") {
    const owner = deps.providerAccountOwner(principalId);
    if (owner) await deps.syncPersonalProviders(owner).catch(() => undefined);
    const engines = deps.orgOfferedEngines(deps.registry.entries(), principalId)
      .filter((entry: any) => deps.personalProviderInstances.visible(entry.instanceId, principalId))
      .map((entry: any) => {
      const driver = entry.shadow?.driverKind ?? entry.live?.driverKind ?? "";
      // #1098: outside the organization's list only the person's own
      // account or key runs it, never the organization's key
      const orgNotAllowed = !deps.consoleEngineAllowed(entry.instanceId);
      const installed = deps.engineInstalled(entry.instanceId);
      // #1533: an API-key engine has no sign-in of its own; the person's subscription never runs it
      const supported = deps.isLoginDriver(driver) && !deps.keyOnlyInstance(entry.instanceId);
      // #2373: each account's own sign-in, never the first account's
      const signedIn = supported && deps.logins.signedIn(principalId, driver, "primary", entry.instanceId);
      // #1533: the provider refused that sign-in since (the card says Reconnect)
      const expired = signedIn && deps.logins.expired(principalId, driver, "primary", entry.instanceId);
      const held = sub ? deps.perspicaxDirectory?.providerKeys(sub) ?? [] : [];
      const myKey = deps.providersOfInstance(entry.instanceId, driver).some((provider: any) => held.includes(provider));
      // a key sealed for this person on this server serves their turns too (engine-credentials.ts 4b)
      const localKey = deps.fileKeyConfigured(deps.DATA_DIR, { organization: true, principalId }, driver);
      const orgKeySet = !orgNotAllowed && deps.driverKeyBacked(deps.cfg, driver, entry.instanceId);
      // 2026-10-16: the organization's key serves this person only when
      // Perspicax gives them this engine (an admin always).
      const orgKey = orgKeySet && deps.serverEngineAllowedFor(principalId, entry.instanceId);
      // the order of engine-credentials.ts for this person speaking
      // 2026-10-30: an expired sign-in no longer pays (engine-credentials.ts
      // step 3): the key or the organization's serves, else "expired",
      // which is never ready, never Auto's, and counted under Needs setup
      // A personal endpoint may deliberately accept requests without a key.
      // Its owner still has working personal access, never the org key.
      const personalServer = deps.personalProviderInstances.get(entry.instanceId)?.owner === principalId;
      const myTurns = !installed || person?.disabledAt !== undefined ? "none" : signedIn && !expired ? "subscription" : myKey || localKey || personalServer ? "key" : orgKey ? "org-key" : expired ? "expired" : "none";
      const live = deps.registry.get(entry.instanceId);
      // #3085: pi runs only the models of the providers a key pays for this
      // person (theirs, else the organization's when it serves them): names only
      const piProviders = driver === "piAgent" ? deps.piKeyProviders?.forViewer(principalId, { instanceId: entry.instanceId, driverKind: driver }) : null;
      const notAvailable = installed ? undefined : deps.engineNotAvailableReason(entry.instanceId);
      return {
        instanceId: entry.instanceId,
        driver,
        displayName: deps.engineNameForPerson(entry.instanceId, live ? deps.engineDisplayName(live) : entry.instanceId, driver, principalId),
        installed,
        // "Not available on this server" rather than "Not installed": the
        // image deliberately does not carry it (engines.lock.json).
        ...(notAvailable ? { notAvailable } : {}),
        subscription: { supported, signedIn, ...(expired ? { expired: true } : {}) },
        myKey,
        // 2026-10-30 (Providers, lot 1): where the person's own key lives,
        // in the order engine-credentials.ts reads them (Perspicax first)
        ...(myKey ? { keyWhere: "perspicax" } : localKey ? { keyWhere: "server" } : {}),
        orgKey,
        ...(orgKeySet && !orgKey ? { orgKeyNotGiven: true } : {}),
        ...(orgNotAllowed ? { orgNotAllowed: true } : {}),
        myTurns,
        ...(piProviders ? { keyProviders: [...piProviders].sort() } : {}),
        // 2026-10-29: a person's two Grok sign-ins (personal and team), each with what it brings through grok.com
        ...(supported && deps.secondLoginSupported(driver) ? { accounts: deps.grokAccountsFor(principalId, entry.instanceId) } : {})
      };
    });
    return json(res, 200, { engines, ...(deps.perspicaxKeysUrl() ? { keysUrl: deps.perspicaxKeysUrl() } : {}) });
  }
  const status = /^\/api\/me\/engines\/([\w.-]+)\/login\/status$/.exec(path);
  const action = /^\/api\/me\/engines\/([\w.-]+)\/login\/(start|complete|cancel|sign-out)$/.exec(path);
  const instanceId = (status ?? action)?.[1];
  if (!instanceId) return json(res, 404, { error: "not found" });
  const entry = deps.registry.entries().find((candidate: any) => candidate.instanceId === instanceId);
  const driver = entry?.shadow?.driverKind ?? entry?.live?.driverKind ?? "";
  if (!entry || !deps.subscriptionDriver(driver)) return json(res, 404, { error: "This engine has no personal sign-in." });
  // 2026-10-29: `?account=second` is the person's second sign-in on an engine that keeps one (Grok)
  const slot = deps.loginSlotOf(url.searchParams.get("account"));
  if (slot === "second" && !deps.secondLoginSupported(driver)) return json(res, 400, { error: "This engine keeps one sign-in per person." });
  const owner = auth.kind === "session" ? auth.session.id : "loopback";
  try {
    if (status && method === "GET") {
      return json(res, 200, { auth: await deps.logins.status(principalId, instanceId, owner, url.searchParams.get("flowId") ?? "", slot) });
    }
    if (!action || method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    const verb = action[2];
    if (verb === "start") {
      const started = await deps.logins.start(principalId, instanceId, owner, slot);
      if (auth.kind === "session" && !deps.sessions.isLive(auth.session.id)) {
        deps.logins.revokeOwner(owner);
        return json(res, 401, { error: "Your session ended. Start a new sign-in." });
      }
      return json(res, 200, { auth: started });
    }
    if (verb === "sign-out") {
      await deps.logins.signOut(principalId, instanceId, owner, slot);
      return json(res, 200, { ok: true });
    }
    const body = await readBody(req, 4096);
    const flowId = typeof body?.flowId === "string" ? body.flowId : "";
    if (verb === "complete") {
      const pasted = typeof body?.callbackUrl === "string" ? body.callbackUrl : typeof body?.code === "string" ? body.code : "";
      if (!flowId || !pasted) return json(res, 400, { error: "flowId and a code or callbackUrl are required" });
      await deps.logins.complete(principalId, instanceId, owner, flowId, pasted, slot);
      return json(res, 200, { ok: true });
    }
    await deps.logins.cancel(principalId, instanceId, owner, flowId, slot);
    return json(res, 200, { ok: true });
  } catch (error) {
    const requested = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
    const code = typeof requested === "number" && [400, 401, 404, 409, 413, 415].includes(requested) ? requested : 500;
    return json(res, code, { error: error instanceof Error ? error.message : String(error) });
  }
  };
}
