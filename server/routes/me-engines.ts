/**
 * Person engines HTTP routes (#1388): GET /api/me/engines and login status/actions.
 * Pure move out of server/index.ts; behaviour unchanged. Never imports index.ts.
 * Deps are read per request so late-bound index lets stay valid.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";

import { PASS, type RouteHandler } from "./table.ts";
import { cleanAccountName } from "../engines/account-names.ts";
import type { AccountMovesHost } from "../engines/account-moves.ts";
import { ONLY_ACCOUNT_ERROR, addedAccount, removableAccount, separateAccountInstance } from "../../shared/added-account.ts";

/** The person's sign-in folder of an engine, or null when it keeps none
 * (#4415: engines reading the same folder are one account). */
function signInFolder(deps: MeEnginesRouteDeps, principalId: string, driver: string, instanceId: string): string | null {
  try {
    return deps.logins?.loginDir ? String(deps.logins.loginDir(principalId, driver, "primary", instanceId)) : null;
  } catch {
    return null;
  }
}

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
    // #4415: two engines that read the person's same sign-in folder (Codex
    // and the ChatGPT plan, say) are one account: the later one names the first
    const signInLeads = new Map<string, string>();
    const engines = deps.orgOfferedEngines(deps.registry.entries(), principalId)
      .filter((entry: any) => deps.personalProviderInstances.visible(entry.instanceId, principalId))
      // #4415: an account the person took off their own list
      .filter((entry: any) => !deps.accountNames?.removed?.(principalId, entry.instanceId))
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
      const folder = supported ? signInFolder(deps, principalId, driver, entry.instanceId) : null;
      const lead = folder ? signInLeads.get(folder) : undefined;
      if (folder && !lead) signInLeads.set(folder, entry.instanceId);
      return {
        instanceId: entry.instanceId,
        driver,
        displayName: deps.engineNameForPerson(entry.instanceId, live ? deps.engineDisplayName(live) : entry.instanceId, driver, principalId),
        installed,
        // "Not available on this server" rather than "Not installed": the
        // image deliberately does not carry it (engines.lock.json).
        ...(notAvailable ? { notAvailable } : {}),
        subscription: { supported, signedIn, ...(expired ? { expired: true } : {}) },
        ...(lead ? { sharesSignInWith: lead } : {}),
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
  // #4376: PUT /api/me/engines/:id/name {name} the person's own name for one
  // of their accounts ("" gives back the engine's), kept for them alone
  const named = /^\/api\/me\/engines\/([\w.-]+)\/name$/.exec(path);
  if (named) {
    if (method !== "PUT") return json(res, 405, { error: "method not allowed" });
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    const instanceId = named[1];
    const reachable = deps.orgOfferedEngines(deps.registry.entries(), principalId)
      .some((entry: any) => entry.instanceId === instanceId && deps.personalProviderInstances.visible(entry.instanceId, principalId));
    if (!reachable) return json(res, 404, { error: "unknown account" });
    const body = await readBody(req, 4096);
    const name = cleanAccountName(body?.name);
    if (name === null) return json(res, 400, { error: "Give a name of 80 characters at most." });
    deps.accountNames.set(principalId, instanceId, name);
    return json(res, 200, { ok: true, ...(name ? { displayName: name } : {}) });
  }
  const driverOf = (candidate: any): string => candidate.shadow?.driverKind ?? candidate.live?.driverKind ?? "";
  /** One of the person's accounts: its engines (one sign-in may stand for
   * two, Codex and the ChatGPT plan), and their other accounts of the same
   * tool. Null: not on their list. */
  const accountOf = (instanceId: string) => {
    const listed = deps.orgOfferedEngines(deps.registry.entries(), principalId)
      .filter((candidate: any) => deps.personalProviderInstances.visible(candidate.instanceId, principalId) && !deps.accountNames?.removed?.(principalId, candidate.instanceId));
    const entry = listed.find((candidate: any) => candidate.instanceId === instanceId);
    if (!entry) return null;
    const driver = driverOf(entry);
    const signsIn = Boolean(deps.isLoginDriver(driver) && !deps.keyOnlyInstance?.(instanceId));
    const folder = signsIn ? signInFolder(deps, principalId, driver, instanceId) : null;
    // a key engine of the same tool is a key, not an account
    const same = listed.filter((candidate: any) => driverOf(candidate) === driver && !deps.keyOnlyInstance?.(candidate.instanceId));
    const account: any[] = folder ? same.filter((candidate: any) => signInFolder(deps, principalId, driver, candidate.instanceId) === folder) : [entry];
    const others: string[] = same.filter((candidate: any) => !account.includes(candidate)).map((candidate: any): string => candidate.instanceId);
    return { entry, driver, signsIn, account, ids: account.map((candidate: any): string => candidate.instanceId), others };
  };
  const moves: AccountMovesHost | undefined = deps.accountMoves;
  // 2026-11-18: GET /api/me/engines/:id/moves, where each of the person's
  // bots on the account goes if they remove it or sign out of it
  const movesOf = method === "GET" ? /^\/api\/me\/engines\/([\w.-]+)\/moves$/.exec(path) : null;
  if (movesOf) {
    const found = accountOf(movesOf[1]);
    if (!found) return json(res, 404, { error: "unknown account" });
    const own = deps.personalProviderInstances.ownerOf?.(movesOf[1]) === principalId.toLowerCase();
    const plan = moves ? await moves.plan({ person: principalId, leaving: found.ids, sameProvider: found.others, moveDefault: own }) : { moves: [], noEngine: false };
    return json(res, 200, plan);
  }
  // #4415, #4426: DELETE /api/me/engines/:id takes one of the person's
  // accounts off their own list, the first one too while the provider keeps
  // another, and signs them out of it in the same gesture. The organization's
  // engine stays for everyone else. A person's own account (#4435) leaves
  // the fleet too. 2026-11-18 (owner rule): its bots move first, as the one
  // confirmation showed (server/engines/account-moves.ts), never a refusal.
  const removing = method === "DELETE" ? /^\/api\/me\/engines\/([\w.-]+)$/.exec(path) : null;
  if (removing) {
    const instanceId = removing[1];
    const found = accountOf(instanceId);
    if (!found) return json(res, 404, { error: "unknown account" });
    // one sign-in is one account: the engines reading the same folder (Codex
    // and the ChatGPT plan) go together, as the page lists them in one row.
    const { driver, signsIn, account, others } = found;
    // a key engine is removed with its key, never as an account
    if (deps.keyOnlyInstance?.(instanceId) || !(addedAccount(instanceId, driver) || removableAccount(instanceId, others))) return json(res, 400, { error: ONLY_ACCOUNT_ERROR });
    // #4435: the person's own account goes for good (its entry, its sign-in
    // folder); the organization's stays for everyone else, off this list only
    const own = deps.personalProviderInstances.ownerOf?.(instanceId) === principalId.toLowerCase();
    const plan = moves ? await moves.plan({ person: principalId, leaving: found.ids, sameProvider: others, moveDefault: own }) : null;
    const move = () => { if (plan) moves!.apply(plan, found.ids, { forget: true, moveDefault: own }); };
    const owner = auth.kind === "session" ? auth.session.id : "loopback";
    // its sign-in goes with it, connected or not, in this one gesture
    const signOut = async () => {
      if (signsIn && deps.logins.signedIn(principalId, driver, "primary", instanceId)) {
        await deps.logins.signOut(principalId, instanceId, owner);
      }
      if (signsIn && deps.secondLoginSupported?.(driver) && deps.logins.signedIn(principalId, driver, "second", instanceId)) {
        await deps.logins.signOut(principalId, instanceId, owner, "second");
      }
    };
    if (own) {
      // the removal of the instance routes (server/routes/instances.ts
      // removeAddedAccount): its bots move, the person signs out and the
      // entry goes, a turn in flight on it included (it ends on its engine)
      const removed = await deps.removeAccountEntry(instanceId, async () => { move(); await signOut(); });
      if (!removed.ok) return json(res, removed.status, removed.body);
      if (separateAccountInstance(instanceId)) rmSync(join(deps.DATA_DIR, "principals", principalId, "accounts", instanceId), { recursive: true, force: true });
      deps.accountNames.set(principalId, instanceId, "");
      return json(res, 200, { ok: true, ...(plan ? { moved: plan.moves, noEngine: plan.noEngine } : {}) });
    }
    move();
    await signOut();
    for (const candidate of account) deps.accountNames.remove(principalId, candidate.instanceId);
    return json(res, 200, { ok: true, ...(plan ? { moved: plan.moves, noEngine: plan.noEngine } : {}) });
  }
  const status = /^\/api\/me\/engines\/([\w.-]+)\/login\/status$/.exec(path);
  const action = /^\/api\/me\/engines\/([\w.-]+)\/login\/(start|complete|cancel|sign-out)$/.exec(path);
  const instanceId = (status ?? action)?.[1];
  if (!instanceId) return json(res, 404, { error: "not found" });
  // #4435: another person's account is not there for this person to sign in to
  const entry = deps.registry.entries().find((candidate: any) => candidate.instanceId === instanceId && deps.personalProviderInstances.visible(candidate.instanceId, principalId));
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
      // 2026-11-18, 2026-11-19: a sign-out always moves the bots on the
      // account first, from every app (no flag; a second sign-in is never
      // what a bot names); GET .../moves shows the same plan beforehand
      await readBody(req, 4096).catch(() => null);
      const found = moves && slot !== "second" ? accountOf(instanceId) : null;
      let plan: Awaited<ReturnType<AccountMovesHost["plan"]>> | null = null;
      if (found) {
        const own = deps.personalProviderInstances.ownerOf?.(instanceId) === principalId.toLowerCase();
        plan = await moves!.plan({ person: principalId, leaving: found.ids, sameProvider: found.others, moveDefault: own });
        moves!.apply(plan, found.ids, { forget: false, moveDefault: own });
      }
      await deps.logins.signOut(principalId, instanceId, owner, slot);
      return json(res, 200, { ok: true, ...(plan ? { moved: plan.moves, noEngine: plan.noEngine } : {}) });
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
