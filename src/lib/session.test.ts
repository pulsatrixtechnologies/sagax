import { describe, expect, it, vi } from "vitest";

import {
  BROWSER_SIGN_IN_FAILED, cloudOwnerOf, markSignInCredentialSpent, pairWithCode, previewSignInPerson, signInCredentialSpent, signInPreviewSupported, isConnected, isOwnerOrAdmin, previewBrowserSignIn, pulsatrixLoginPath, readSessionState, reasonWorthShowing, resolveSessionState, signInScreenDue, SERVICE_TRUST_REASON, signInWithBrowserGrant,
  takeBrowserSignInFromLocation, takeInvitedEmailFromLocation, takePairingCodeFromLocation, takeSignInErrorFromLocation, type EnvironmentDescriptor,
} from "./session";
import { UNKNOWN_SESSION_RETRIES } from "../../shared/session-refusal";

describe("what the pair page says about why it was shown", () => {
  it("stays quiet for the ordinary no-session case and repeats anything else", () => {
    expect(reasonWorthShowing("forbidden: this request came through a proxy (pair this device to use the server remotely)")).toBeNull();
    expect(reasonWorthShowing("forbidden: loopback host required (pair this device to use the server remotely)")).toBeNull();
    expect(reasonWorthShowing("403")).toBeNull();
    expect(reasonWorthShowing(undefined)).toBeNull();
    expect(reasonWorthShowing("unauthorized: this session has expired or was revoked; pair this device again")).toMatch(/expired or was revoked/);
  });
});

describe("the invited address on a pair link", () => {
  it("prefills a valid address, drops it from the address bar, and ignores junk", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("location", { search: "?email=Ada%40Example.test&x=1", pathname: "/pair", hash: "#code=ABCD" });
    vi.stubGlobal("history", { replaceState });
    expect(takeInvitedEmailFromLocation()).toBe("ada@example.test");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/pair?x=1#code=ABCD");
    vi.stubGlobal("location", { search: "?email=not-an-address", pathname: "/pair", hash: "" });
    expect(takeInvitedEmailFromLocation()).toBeNull();
    vi.stubGlobal("location", { search: "", pathname: "/pair", hash: "" });
    expect(takeInvitedEmailFromLocation()).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("the OMB Cloud page's \"Use in your browser\" link", () => {
  const credential = `omb_pair_${"b".repeat(43)}`;
  it("is taken off the address bar and out of history before anything renders, whatever it carries", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("history", { replaceState });
    vi.stubGlobal("location", { pathname: "/pair", search: "", hash: `#signin=${credential}` });
    expect(takeBrowserSignInFromLocation()).toBe(credential);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/pair");
    // A malformed one is still removed, and is not a code for the pair form either.
    replaceState.mockClear();
    vi.stubGlobal("location", { pathname: "/pair", search: "", hash: "#signin=ABCD-EFGH-JKLM" });
    expect(takeBrowserSignInFromLocation()).toBeNull();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/pair");
    // An ordinary pairing link is left to the pair form.
    replaceState.mockClear();
    vi.stubGlobal("location", { pathname: "/pair", search: "", hash: "#code=ABCD-EFGH-JKLM" });
    expect(takeBrowserSignInFromLocation()).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
    expect(takePairingCodeFromLocation()).toBe("ABCD-EFGH-JKLM");
    vi.unstubAllGlobals();
  });

  it("shows whose Cloud it is first, asking only to look, and treats anything else as spent", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const server = (status: number, body: unknown) => (async (path: string, init?: RequestInit) => {
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    expect(await previewBrowserSignIn(credential, server(200, { owner: "ada@example.test", expiresAt: 1 }))).toEqual({ owner: "ada@example.test" });
    expect(requests).toEqual([{ path: "/api/auth/pair", body: { code: credential, browser: true, preview: true } }]);
    expect(await previewBrowserSignIn(credential, server(401, { error: "expired" }))).toBeNull();
    expect(await previewBrowserSignIn(credential, server(200, { owner: "" }))).toBeNull();
    expect(await previewBrowserSignIn(credential, server(200, { owner: 7 }))).toBeNull();
    expect(await previewBrowserSignIn(credential, (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
  });

  it("on Continue is always redeemed into this browser's cookie, connected or not, with the page's one attempt id", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const server = (async (path: string, init?: RequestInit) => {
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      // Whatever this browser already has here, the grant is redeemed (and its old session replaced).
      if (path === "/api/auth/session") return new Response(JSON.stringify({ kind: "session", id: "s", label: "Chrome on Mac", scopes: ["client"], expiresAt: 1 }), { status: 200 });
      return new Response(JSON.stringify({ session: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await signInWithBrowserGrant(credential, "attempt-page-0001", server)).toEqual({ ok: true });
    expect(await signInWithBrowserGrant(credential, "attempt-page-0001", server)).toEqual({ ok: true });
    expect(requests.map((r) => r.path)).toEqual(["/api/auth/pair", "/api/auth/pair"]);
    for (const request of requests) expect(request.body).toMatchObject({ code: credential, cookie: true, browser: true, attemptId: "attempt-page-0001" });
    // A spent or expired one says so.
    const spent = (async () => new Response(JSON.stringify({ error: "pairing code is wrong or has expired" }), { status: 401 })) as unknown as typeof fetch;
    expect(await signInWithBrowserGrant(credential, "attempt-page-0002", spent)).toEqual({ ok: false, error: "pairing code is wrong or has expired", status: 401 });
    expect(reasonWorthShowing(BROWSER_SIGN_IN_FAILED)).toBe(BROWSER_SIGN_IN_FAILED);
  });

  it("names the Cloud's owner afterwards only for a browser sign-in's session on a Cloud home", () => {
    expect(cloudOwnerOf({ kind: "session", cloudHome: true, owner: "ada@example.test" })).toBe("ada@example.test");
    for (const session of [{ kind: "session", owner: "ada@example.test" }, { kind: "session", cloudHome: true }, { kind: "loopback" },
      { cloudHome: true, owner: 7 }, { cloudHome: "yes", owner: "ada@example.test" }, null, undefined]) expect(cloudOwnerOf(session)).toBeNull();
  });
});

describe("who the served UI is on its own machine", () => {
  const answer = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  it("is the owner on loopback unless the server says local requests are only a service", async () => {
    const owner = await readSessionState(answer({ kind: "loopback", scopes: ["admin", "client"] }));
    expect(owner).toEqual({ kind: "loopback" });
    expect(isOwnerOrAdmin(owner)).toBe(true);
    const service = await readSessionState(answer({ kind: "loopback", scopes: ["client"], trust: "service" }));
    expect(service).toEqual({ kind: "loopback", trust: "service" });
    expect(isOwnerOrAdmin(service)).toBe(false);
    expect(isOwnerOrAdmin({ kind: "session", id: "s", label: "l", scopes: ["client"], expiresAt: 1 })).toBe(false);
    expect(isOwnerOrAdmin({ kind: "session", id: "s", label: "l", scopes: ["admin", "client"], expiresAt: 1 })).toBe(true);
    expect(isOwnerOrAdmin(null)).toBe(false);
  });
});

describe("an SSH tunnel to a server that treats local requests as a service", () => {
  it("is not connected, so the app sends it to sign in, and says why", () => {
    expect(isConnected({ kind: "loopback" })).toBe(true);
    expect(isConnected({ kind: "loopback", trust: "service" })).toBe(false);
    expect(isConnected({ kind: "session", id: "s", label: "l", scopes: ["client"], expiresAt: 1 })).toBe(true);
    expect(isConnected({ kind: "unauthenticated", error: "pair" })).toBe(false);
    expect(isConnected(null)).toBe(false);
    expect(reasonWorthShowing(SERVICE_TRUST_REASON)).toBe(SERVICE_TRUST_REASON);
  });
});

describe("Sign in with Pulsatrix on an organization server", () => {
  const base: EnvironmentDescriptor = { environmentId: "e", label: "Org", platform: "linux", version: "1", capabilities: { remoteSessions: true, selfUpdate: "operator" } };
  it("offers the button only when the descriptor advertises a same-origin Perspicax login path", () => {
    expect(pulsatrixLoginPath(null)).toBeNull();
    expect(pulsatrixLoginPath(base)).toBeNull();
    const org = { ...base, identity: { kind: "perspicax" as const, protocol: "oidc" as const, issuer: "https://px.example.test", loginPath: "/auth/oidc/start" } };
    expect(pulsatrixLoginPath(org)).toBe("/auth/oidc/start");
    expect(pulsatrixLoginPath({ ...org, identity: { ...org.identity, loginPath: "https://evil.example/start" } })).toBeNull();
    expect(pulsatrixLoginPath({ ...org, identity: { ...org.identity, loginPath: "//evil.example/start" } })).toBeNull();
  });
  it("reads a returned sign-in error once and clears it from the address bar", () => {
    const replaceState = vi.fn();
    expect(takeSignInErrorFromLocation({ hash: "#signin_error=role", pathname: "/pair", search: "" }, { replaceState })).toBe("role");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/pair");
    expect(takeSignInErrorFromLocation({ hash: "#code=ABCD", pathname: "/pair", search: "" }, { replaceState })).toBeNull();
    expect(takeSignInErrorFromLocation({ hash: "#signin_error=<script>", pathname: "/pair", search: "" }, { replaceState })).toBeNull();
  });
});

describe("previewing a Sagax Business return credential (2026-10-13, desktop 0.5.0 vs server 167d8e13)", () => {
  const credential = `omb_pair_${"Q".repeat(43)}`;
  const env = (capabilities: Partial<EnvironmentDescriptor["capabilities"]>): EnvironmentDescriptor => ({
    environmentId: "e", label: "Example", platform: "linux", version: "0.4.22",
    capabilities: { remoteSessions: true, selfUpdate: "operator", ...capabilities },
  });

  it("never asks a server that does not advertise a non-redeeming preview: it would spend the credential", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ token: "t", session: {} }), { status: 200 }));
    expect(signInPreviewSupported(null)).toBe(false);
    expect(signInPreviewSupported(env({}))).toBe(false);
    expect(await previewSignInPerson(credential, null, fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(await previewSignInPerson(credential, env({ emailSignIn: false }), fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks a server that advertises it, marked ?preview=1 so the desktop redeem watcher skips it", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const fetchImpl = (async (path: string, init?: RequestInit) => {
      requests.push({ path, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ expiresAt: 1, name: "Ada", avatarUrl: "/api/people/a/avatar" }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await previewSignInPerson(credential, env({ signInPreview: true }), fetchImpl)).toEqual({ name: "Ada", avatarUrl: "/api/people/a/avatar" });
    expect(requests).toEqual([{ path: "/api/auth/pair?preview=1", body: { code: credential, preview: true } }]);
  });

  it("reports the status of a refused redeem, and remembers a spent credential by fingerprint only", async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) });
    const refused = (async () => new Response(JSON.stringify({ error: "pairing code is wrong or has expired; create a new one on the server" }), { status: 401 })) as unknown as typeof fetch;
    expect(await pairWithCode({ code: credential, label: "Mac" }, refused)).toEqual({ ok: false, error: "pairing code is wrong or has expired; create a new one on the server", status: 401 });
    expect(signInCredentialSpent(credential)).toBe(false);
    const restartedServer = (async () => new Response(JSON.stringify({ error: "pairing code is wrong or has expired, or this server restarted", code: "server_restarted" }), { status: 401 })) as unknown as typeof fetch;
    expect(await pairWithCode({ code: credential, label: "Mac" }, restartedServer)).toMatchObject({ ok: false, status: 401, restarted: true });
    markSignInCredentialSpent(credential);
    expect(signInCredentialSpent(credential)).toBe(true);
    expect(signInCredentialSpent(`omb_pair_${"R".repeat(43)}`)).toBe(false);
    expect([...stored.values()].join("")).not.toContain(credential);
    // a typed pairing code is never remembered: it may be typed again legitimately
    markSignInCredentialSpent("ABCD-EFGH-JKLM");
    expect(signInCredentialSpent("ABCD-EFGH-JKLM")).toBe(false);
    vi.unstubAllGlobals();
  });
});

// 2026-10-20 (JC: signed out only when the session is revoked, the account
// disabled or after 30 days without use): the web app and the desktop's
// server window decide at boot from /api/auth/session.
describe("whether the sign-in screen shows: silent retries, definitive codes only", () => {
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const scripted = (answers: Array<Response | Error>) => {
    let calls = 0;
    const fetchImpl = (async () => {
      const next = answers[Math.min(calls, answers.length - 1)]!;
      calls += 1;
      if (next instanceof Error) throw next;
      return next.clone();
    }) as unknown as typeof fetch;
    return { fetchImpl, calls: () => calls };
  };
  const instant = { sleep: async () => {}, random: () => 0.5 };
  const session = { kind: "session", id: "s1", label: "web", scopes: ["client"], expiresAt: 1 };

  it("redéploiement Sagax : 503 et réseau coupé sont réessayés en silence, puis la session revient", async () => {
    const server = scripted([new TypeError("fetch failed"), reply(503, { code: "idp_recheck_pending" }), reply(502, {}), reply(200, session)]);
    const state = await resolveSessionState({ fetchImpl: server.fetchImpl, ...instant });
    expect(state).toMatchObject({ kind: "session", id: "s1" });
    expect(server.calls()).toBe(4);
  });

  it("a session this server does not know is retried; the sign-in screen only if it persists", async () => {
    const back = scripted([reply(401, { code: "session_unknown" }), reply(200, session)]);
    expect(await resolveSessionState({ fetchImpl: back.fetchImpl, ...instant })).toMatchObject({ kind: "session" });
    const gone = scripted([reply(401, { code: "session_unknown" })]);
    expect(await resolveSessionState({ fetchImpl: gone.fetchImpl, ...instant })).toMatchObject({ kind: "unauthenticated", code: "session_unknown" });
    expect(gone.calls()).toBe(UNKNOWN_SESSION_RETRIES);
    // an older server's 401 without a code: the same
    const older = scripted([reply(401, { error: "unauthorized" })]);
    expect(await resolveSessionState({ fetchImpl: older.fetchImpl, ...instant })).toMatchObject({ kind: "unauthenticated" });
    expect(older.calls()).toBe(UNKNOWN_SESSION_RETRIES);
  });

  it("révocation -> déconnexion : a definitive code shows the sign-in screen at once", async () => {
    for (const code of ["session_revoked", "session_expired", "idp_session_ended", "principal_disabled", "sign_in_required"]) {
      const server = scripted([reply(401, { code, error: "x" })]);
      expect(await resolveSessionState({ fetchImpl: server.fetchImpl, ...instant })).toMatchObject({ kind: "unauthenticated", code });
      expect(server.calls()).toBe(1);
    }
  });

  it("a server that stays down opens the app after the budget (it keeps reconnecting), never the sign-in screen", async () => {
    const down = scripted([new TypeError("fetch failed")]);
    const state = await resolveSessionState({ fetchImpl: down.fetchImpl, unreachableBudgetMs: 10_000, ...instant });
    expect(state.kind).toBe("unreachable");
    expect(signInScreenDue(state, 99)).toBe(false);
    expect(down.calls()).toBeGreaterThan(2);
  });
});
