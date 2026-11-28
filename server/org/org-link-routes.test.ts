// Perspicax asks for an immediate directory fetch with the link token
// (2026-10-11, server/org/org-link-routes.ts).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createOrgLinkRoutes, DIRECTORY_REFRESH_MAX_PER_MINUTE, DIRECTORY_REFRESH_PATH, DirectoryRefreshScheduler, GROK_SIGN_IN_PATH, type OrgLinkRoutesOptions } from "./org-link-routes.ts";
import type { GrokLiveAccess } from "../engines/principal-engine-logins.ts";
import { AuthFailureLimiter } from "../triggers/webhook-ingress.ts";
import { resolveVoiceKeys, type VoiceSpeaker } from "../voice/voice-mode.ts";

const TOKEN = `pxat1.${"a".repeat(43)}`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("DirectoryRefreshScheduler", () => {
  it("starts at once, then coalesces every call during a fetch into exactly one more", async () => {
    const gates: Array<ReturnType<typeof deferred>> = [];
    const scheduler = new DirectoryRefreshScheduler(() => {
      const gate = deferred();
      gates.push(gate);
      return gate.promise;
    }, 0);
    expect(scheduler.request()).toBe("started");
    await Promise.resolve();
    expect(scheduler.request()).toBe("queued");
    expect(scheduler.request()).toBe("queued");
    expect(scheduler.request()).toBe("queued");
    expect(gates).toHaveLength(1);
    gates[0]!.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));
    // the change made during the first fetch is read by a second one
    expect(gates).toHaveLength(2);
    gates[1]!.resolve();
    await scheduler.whenIdle();
    expect(gates).toHaveLength(2);
  });

  it("spaces two fetches by the minimum interval, and a failed fetch does not stop the next", async () => {
    const clock = { now: 10_000 };
    let runs = 0;
    const scheduler = new DirectoryRefreshScheduler(async () => {
      runs += 1;
      if (runs === 1) throw new Error("unreachable");
    }, 30, () => clock.now);
    expect(scheduler.request()).toBe("started");
    await scheduler.whenIdle();
    expect(runs).toBe(1);
    clock.now += 10;
    expect(scheduler.request()).toBe("queued");
    expect(scheduler.request()).toBe("queued");
    await scheduler.whenIdle();
    expect(runs).toBe(2);
    clock.now += 1_000;
    expect(scheduler.request()).toBe("started");
    await scheduler.whenIdle();
    expect(runs).toBe(3);
  });
});

describe("POST /api/org/link/directory-refresh", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  async function start(patch: Partial<OrgLinkRoutesOptions> = {}) {
    const asked: string[] = [];
    const routes = createOrgLinkRoutes({
      linked: () => true,
      linkTokenMatches: (token) => token === TOKEN,
      scheduler: { request: () => { asked.push("refresh"); return asked.length === 1 ? "started" : "queued"; } },
      log: () => {},
      ...patch,
    });
    const server = createServer((req, res) => {
      void routes(req, res, new URL(req.url ?? "/", "http://localhost")).then((answered) => {
        if (!answered) { res.writeHead(418); res.end(); }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (init: RequestInit & { path?: string } = {}) => {
      const response = await fetch(`${base}${init.path ?? DIRECTORY_REFRESH_PATH}`, { method: "POST", ...init });
      return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
    };
    return { asked, call };
  }

  it("asks for a fetch with the link token and answers 202, never reading the body", async () => {
    const h = await start();
    const first = await h.call({ headers: { authorization: `Bearer ${TOKEN}` }, body: "ignored" });
    expect(first).toMatchObject({ status: 202, body: { ok: true, refresh: "started" } });
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await h.call({ headers: { authorization: `Bearer ${TOKEN}` } })).toMatchObject({ status: 202, body: { ok: true, refresh: "queued" } });
    expect(h.asked).toHaveLength(2);
  });

  it("refuses a missing, wrong or misplaced token the same way, and opens nothing else", async () => {
    const h = await start();
    for (const init of [
      {},
      { headers: { authorization: `Bearer ${TOKEN}x` } },
      { headers: { authorization: `Basic ${Buffer.from(`pulsa-bot-server:${TOKEN}`).toString("base64")}` } },
      { headers: { "x-link-token": TOKEN } },
      { path: `${DIRECTORY_REFRESH_PATH}?token=${TOKEN}` },
      { headers: { cookie: `omb_session=${TOKEN}` } },
    ]) {
      expect(await h.call(init), JSON.stringify(init)).toMatchObject({ status: 401, body: { error: "unauthorized" } });
    }
    expect(await h.call({ method: "GET", headers: { authorization: `Bearer ${TOKEN}` } })).toMatchObject({ status: 405 });
    expect(await h.call({ path: "/api/org/link/other", headers: { authorization: `Bearer ${TOKEN}` } })).toMatchObject({ status: 404 });
    expect(await h.call({ path: "/api/other" })).toMatchObject({ status: 418 });
    expect(h.asked).toHaveLength(0);
  });

  it("answers 404 on a server with no link", async () => {
    const h = await start({ linked: () => false });
    expect(await h.call({ headers: { authorization: `Bearer ${TOKEN}` } })).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(h.asked).toHaveLength(0);
  });

  it("blocks a source after 10 failures, even with the good token, and caps accepted calls", async () => {
    const h = await start({ limiter: new AuthFailureLimiter(10, 60_000) });
    for (let i = 0; i < 10; i++) expect((await h.call({ headers: { authorization: "Bearer nope" } })).status).toBe(401);
    const blocked = await h.call({ headers: { authorization: `Bearer ${TOKEN}` } });
    expect(blocked).toMatchObject({ status: 429, body: { error: "rate_limited" } });
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(h.asked).toHaveLength(0);

    const fresh = await start({ limiter: new AuthFailureLimiter(10, 60_000) });
    for (let i = 0; i < DIRECTORY_REFRESH_MAX_PER_MINUTE; i++) expect((await fresh.call({ headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(202);
    expect(await fresh.call({ headers: { authorization: `Bearer ${TOKEN}` } })).toMatchObject({ status: 429 });
    expect(fresh.asked).toHaveLength(DIRECTORY_REFRESH_MAX_PER_MINUTE);
  });
});

describe("POST /api/org/link/grok-sign-in (#4192)", () => {
  // made-up values, never a real credential
  const ACCESS_A = `fake-grok-access-a-${"7".repeat(24)}`;
  const ACCESS_B = `fake-grok-access-b-${"8".repeat(24)}`;
  const EXPIRES = Date.parse("2026-11-13T20:00:00.000Z");
  const people: Record<string, { principalId: string; active: boolean }> = {
    "sub-a": { principalId: "pr_a", active: true },
    "sub-b": { principalId: "pr_b", active: true },
    "sub-off": { principalId: "pr_off", active: false },
    "sub-none": { principalId: "pr_none", active: true },
    "sub-refused": { principalId: "pr_refused", active: true },
  };
  const access: Record<string, GrokLiveAccess> = {
    pr_a: { ok: true, accessToken: ACCESS_A, expiresAt: EXPIRES },
    pr_b: { ok: true, accessToken: ACCESS_B, expiresAt: null },
    pr_none: { ok: false, error: "no_sign_in" },
    pr_refused: { ok: false, error: "sign_in_refused" },
  };
  const servers: Server[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  async function start(patch: Partial<OrgLinkRoutesOptions> = {}) {
    const asked: string[] = [];
    const lines: string[] = [];
    const routes = createOrgLinkRoutes({
      linked: () => true,
      linkTokenMatches: (token) => token === TOKEN,
      scheduler: { request: () => "started" },
      person: (sub) => people[sub] ?? null,
      grokSignIn: async (principalId) => {
        asked.push(principalId);
        return access[principalId] ?? { ok: false, error: "no_sign_in" };
      },
      log: (line) => lines.push(line),
      ...patch,
    });
    const server = createServer((req, res) => {
      void routes(req, res, new URL(req.url ?? "/", "http://localhost")).then((answered) => {
        if (!answered) { res.writeHead(418); res.end(); }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (body: unknown, init: RequestInit = {}) => {
      const response = await fetch(`${base}${GROK_SIGN_IN_PATH}`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
        ...init,
      });
      return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
    };
    return { asked, lines, call };
  }

  it("answers the named person's fresh Grok credential with its expiry, never cached", async () => {
    const h = await start();
    const answer = await h.call({ sub: "sub-a" });
    expect(answer).toMatchObject({ status: 200, body: { provider: "xai", access_token: ACCESS_A, expires_at: "2026-11-13T20:00:00.000Z" } });
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(await h.call({ sub: "sub-b" })).toMatchObject({ status: 200, body: { provider: "xai", access_token: ACCESS_B, expires_at: null } });
    expect(h.asked).toEqual(["pr_a", "pr_b"]);
  });

  it("only ever reads the sign-in of the person the call names", async () => {
    const h = await start();
    const answer = await h.call({ sub: "sub-a", principalId: "pr_b", person: "pr_b" });
    expect(answer.body).toMatchObject({ access_token: ACCESS_A });
    expect(JSON.stringify(answer.body)).not.toContain(ACCESS_B);
    expect(h.asked).toEqual(["pr_a"]);
  });

  it("answers a stable code without a sign-in, when it is refused, or for an unknown or inactive person", async () => {
    const h = await start();
    expect(await h.call({ sub: "sub-none" })).toMatchObject({ status: 404, body: { error: "no_sign_in" } });
    expect(await h.call({ sub: "sub-refused" })).toMatchObject({ status: 409, body: { error: "sign_in_refused" } });
    expect(await h.call({ sub: "sub-unknown" })).toMatchObject({ status: 404, body: { error: "unknown_person" } });
    expect(await h.call({ sub: "sub-off" })).toMatchObject({ status: 409, body: { error: "user_inactive" } });
    for (const body of ["not json", {}, { sub: "" }, { sub: 7 }, ["sub-a"], { sub: "x".repeat(4_000) }]) {
      expect(await h.call(body), JSON.stringify(body).slice(0, 40)).toMatchObject({ status: 400, body: { error: "invalid_request" } });
    }
    // an inactive or unknown person's sign-in is never read
    expect(h.asked).toEqual(["pr_none", "pr_refused"]);
  });

  it("takes the link token only, and is absent on a server with no link", async () => {
    const h = await start();
    for (const headers of [{}, { authorization: `Bearer ${TOKEN}x` }, { cookie: `omb_session=${TOKEN}` }]) {
      expect(await h.call({ sub: "sub-a" }, { headers: { "content-type": "application/json", ...headers } })).toMatchObject({ status: 401, body: { error: "unauthorized" } });
    }
    expect(await h.call({ sub: "sub-a" }, { method: "PUT" })).toMatchObject({ status: 405 });
    expect(h.asked).toEqual([]);
    const unlinked = await start({ linked: () => false });
    expect(await unlinked.call({ sub: "sub-a" })).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(unlinked.asked).toEqual([]);
  });

  it("never writes the credential in a log line", async () => {
    const consoleLines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { consoleLines.push(args.map(String).join(" ")); });
    }
    const h = await start();
    expect((await h.call({ sub: "sub-a" })).status).toBe(200);
    expect((await h.call({ sub: "sub-b" })).status).toBe(200);
    expect(h.lines.length).toBeGreaterThan(0);
    for (const line of [...h.lines, ...consoleLines]) {
      expect(line).not.toContain(ACCESS_A);
      expect(line).not.toContain(ACCESS_B);
      expect(line).not.toContain("fake-grok-access");
    }
  });
});

// The owner's decision of 2026-11-19: a phone line speaks on the keys the
// app's own voice would use for the person who owns it. The route answers
// what `resolveVoiceKeys` gives for that person: the function every voice
// route of the app calls, here with fake keys of two people.
describe("POST /api/org/link/grok-sign-in with org_account: the organization's own Grok account (#5200)", () => {
  const ORG_ACCESS = `fake-org-grok-access-${"6".repeat(24)}`;
  const EXPIRES = Date.parse("2026-11-23T20:00:00.000Z");
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  async function start(patch: Partial<OrgLinkRoutesOptions> = {}) {
    const lines: string[] = [];
    const routes = createOrgLinkRoutes({
      linked: () => true,
      linkTokenMatches: (token) => token === TOKEN,
      scheduler: { request: () => "started" },
      person: () => null,
      grokSignIn: async () => ({ ok: false, error: "no_sign_in" }),
      orgAccount: async () => ({ ok: true, accessToken: ORG_ACCESS, expiresAt: EXPIRES, principalId: "pr_ada", kind: "team" }),
      log: (line) => lines.push(line),
      ...patch,
    });
    const server = createServer((req, res) => {
      void routes(req, res, new URL(req.url ?? "/", "http://localhost")).then((answered) => {
        if (!answered) { res.writeHead(418); res.end(); }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (body: unknown, token = TOKEN) => {
      const response = await fetch(`${base}${GROK_SIGN_IN_PATH}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json().catch(() => null) as Record<string, unknown> | null, headers: response.headers };
    };
    return { lines, call };
  }

  it("answers the organization's account for the voice service's own use, with no person named", async () => {
    const h = await start();
    const answer = await h.call({ org_account: true });
    expect(answer.status).toBe(200);
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(answer.body).toEqual({ provider: "xai", access_token: ORG_ACCESS, expires_at: "2026-11-23T20:00:00.000Z" });
    expect(h.lines).toEqual(["org link: the organization's Grok account (ok)"]);
  });

  it("tests it without ever answering the value: the state and the expiry only", async () => {
    const h = await start();
    const answer = await h.call({ org_account: "test" });
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ provider: "xai", state: "ok", account_kind: "team", expires_at: "2026-11-23T20:00:00.000Z" });
    expect(JSON.stringify(answer.body)).not.toContain(ORG_ACCESS);
    // a personal account serves like a team's: its kind is told beside the state, never a refusal
    const personal = await start({ orgAccount: async () => ({ ok: true, accessToken: ORG_ACCESS, expiresAt: EXPIRES, principalId: "pr_ada", kind: "personal" }) });
    expect((await personal.call({ org_account: "test" })).body).toEqual({ provider: "xai", state: "ok", account_kind: "personal", expires_at: "2026-11-23T20:00:00.000Z" });
    expect((await personal.call({ org_account: true })).body).toEqual({ provider: "xai", access_token: ORG_ACCESS, expires_at: "2026-11-23T20:00:00.000Z" });
    for (const error of ["no_org_account", "unknown_person", "user_inactive", "no_sign_in", "sign_in_refused"] as const) {
      const failing = await start({ orgAccount: async () => ({ ok: false, error }) });
      expect((await failing.call({ org_account: "test" })).body).toEqual({ provider: "xai", state: error });
    }
  });

  it("tests a person about to be named, and still never answers a value for a named person", async () => {
    const asked: Array<string | undefined> = [];
    const h = await start({ orgAccount: async (candidate) => { asked.push(candidate); return { ok: true, accessToken: ORG_ACCESS, expiresAt: null, principalId: "pr_ada", kind: "team" }; } });
    expect((await h.call({ org_account: "test", sub: "sub-ada" })).body).toEqual({ provider: "xai", state: "ok", account_kind: "team" });
    expect(asked).toEqual(["sub-ada"]);
    // `true` with a person is the person's own sign-in route, as before: the account is not read
    const person = await h.call({ org_account: true, sub: "sub-ada" });
    expect([person.status, person.body]).toEqual([404, { error: "unknown_person" }]);
    expect(asked).toEqual(["sub-ada"]);
    expect((await h.call({ org_account: "test", sub: 7 })).status).toBe(400);
  });

  it("answers a stable code when there is none, or it cannot serve", async () => {
    const codes = { no_org_account: 404, unknown_person: 404, no_sign_in: 404, user_inactive: 409, sign_in_refused: 409 } as const;
    for (const [error, status] of Object.entries(codes)) {
      const h = await start({ orgAccount: async () => ({ ok: false, error: error as keyof typeof codes }) });
      const answer = await h.call({ org_account: true });
      expect([error, answer.status, answer.body]).toEqual([error, status, { error }]);
    }
    const thrown = await start({ orgAccount: async () => { throw new Error(`boom ${ORG_ACCESS}`); } });
    const answer = await thrown.call({ org_account: true });
    expect([answer.status, answer.body]).toEqual([409, { error: "sign_in_refused" }]);
    expect(thrown.lines.join("\n")).not.toContain(ORG_ACCESS);
  });

  it("takes the link token only, and an older server without the account keeps asking for a person", async () => {
    const h = await start();
    expect((await h.call({ org_account: true }, "wrong")).status).toBe(401);
    const older = await start({ orgAccount: undefined });
    expect([(await older.call({ org_account: true })).status, (await older.call({ org_account: true })).body]).toEqual([400, { error: "invalid_request" }]);
  });
});

describe("POST /api/org/link/grok-sign-in with voice_keys: the app's own order for a phone line", () => {
  const ORG_KEY = "xai-ORGfake7Lm2Pq9Wz4Rt6Yb";
  const ADA_PERSPICAX = "xai-ADAfake3Kd8Hs1Vn5Xc0Je";
  const ADA_VOICE = "xai-ADAvoice9Qa2Ws4Ed6Rf8";
  const ADA_GROK = "fake-grok-access-ada-11112222";
  const BEN_PERSPICAX = "xai-BENfake5Tg7Yh9Uj1Ik3Ol";
  const servers: Server[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  interface World {
    people: Record<string, { principalId: string; active: boolean }>;
    perspicaxKeys: Record<string, string>;
    voiceKeys: Record<string, string>;
    grok: Record<string, string>;
    /** the people the organization's xAI voice was given to */
    orgVoice: Set<string>;
    orgKey: string | undefined;
    /** the organization's Grok account, when it has one */
    orgAccount?: string;
    perspicaxDown?: boolean;
    disabled?: Set<string>;
  }

  function world(patch: Partial<World> = {}): World {
    return {
      people: { "sub-ada": { principalId: "pr_ada", active: true }, "sub-ben": { principalId: "pr_ben", active: true }, "sub-off": { principalId: "pr_off", active: false } },
      perspicaxKeys: { "sub-ada": ADA_PERSPICAX, "sub-ben": BEN_PERSPICAX },
      voiceKeys: {},
      grok: {},
      orgVoice: new Set(["pr_ada", "pr_ben"]),
      orgKey: ORG_KEY,
      ...patch,
    };
  }

  async function start(w: World) {
    const lines: string[] = [];
    const resolved: string[] = [];
    const speakerOf = (principalId: string): VoiceSpeaker => {
      const sub = Object.keys(w.people).find((key) => w.people[key]!.principalId === principalId);
      return { principalId, ...(sub ? { sub } : {}), ...(w.disabled?.has(principalId) ? { disabled: true } : {}) };
    };
    const routes = createOrgLinkRoutes({
      linked: () => true,
      linkTokenMatches: (token) => token === TOKEN,
      scheduler: { request: () => "started" },
      person: (sub) => w.people[sub] ?? null,
      grokSignIn: async () => ({ ok: false, error: "no_sign_in" }),
      // the wiring of server/index.ts: the app's own function, for that person,
      // with the same policy the server passes, and phoneLine so the list
      // stays the full order (D-20261127-029)
      voiceKeys: (principalId) => {
        resolved.push(principalId);
        return resolveVoiceKeys({
          organization: true,
          serverKey: () => w.orgKey,
          hasOwnKey: () => true,
          resolveOwnKey: async (sub) => (w.perspicaxDown ? { ok: false, error: "unreachable" } : w.perspicaxKeys[sub] ? { ok: true, key: w.perspicaxKeys[sub]!, fingerprint: "fp" } : { ok: false, error: "no_key" }),
          serverKeyAllowed: (speaker) => w.orgVoice.has(speaker.principalId),
          personalKey: (speaker) => w.voiceKeys[speaker.principalId],
          grokAccount: (speaker) => w.grok[speaker.principalId],
          orgAccount: () => w.orgAccount,
          credentialPolicy: () => ({ aspect: "voice", personalKeysEnabled: true, allowPersonalWhenActingAs: false, paidKeyConfirmed: false }),
        }, speakerOf(principalId), undefined, { phoneLine: true });
      },
      log: (line) => lines.push(line),
    });
    const server = createServer((req, res) => {
      void routes(req, res, new URL(req.url ?? "/", "http://localhost")).then((answered) => {
        if (!answered) { res.writeHead(418); res.end(); }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (body: unknown, init: RequestInit = {}) => {
      const response = await fetch(`${base}${GROK_SIGN_IN_PATH}`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        ...init,
      });
      return { status: response.status, body: await response.json().catch(() => null) as Record<string, any> | null, headers: response.headers };
    };
    return { lines, resolved, call };
  }

  it("a person with no Grok sign-in gets their own Perspicax key, then the organization's key: the order the app tries", async () => {
    const h = await start(world());
    const answer = await h.call({ sub: "sub-ada", voice_keys: true });
    expect(answer.status).toBe(200);
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(answer.body).toEqual({
      provider: "xai",
      voice_keys: [
        { source: "perspicax-key", auth: "api-key", key: ADA_PERSPICAX },
        { source: "org-key", auth: "api-key", key: ORG_KEY },
      ],
    });
  });

  it("lists every source in the app's order: Grok account, voice key, Perspicax key, organization", async () => {
    const h = await start(world({ grok: { pr_ada: ADA_GROK }, voiceKeys: { pr_ada: ADA_VOICE } }));
    const answer = await h.call({ sub: "sub-ada", voice_keys: true });
    expect(answer.body!.voice_keys).toEqual([
      { source: "grok-account", auth: "grok-account", key: ADA_GROK },
      { source: "voice-key", auth: "api-key", key: ADA_VOICE },
      { source: "perspicax-key", auth: "api-key", key: ADA_PERSPICAX },
      { source: "org-key", auth: "api-key", key: ORG_KEY },
    ]);
  });

  it("hands a phone line the organization's Grok account as an account, before the organization's key (#5200)", async () => {
    const ORG_GROK = "fake-org-grok-access-55556666";
    const h = await start(world({ orgAccount: ORG_GROK, perspicaxKeys: {} }));
    const answer = await h.call({ sub: "sub-ada", voice_keys: true });
    expect(answer.body).toEqual({
      provider: "xai",
      voice_keys: [
        { source: "org-account", auth: "grok-account", key: ORG_GROK },
        { source: "org-key", auth: "api-key", key: ORG_KEY },
      ],
    });
    expect(h.lines.join("\n")).toContain("org-account, org-key");
    expect(h.lines.join("\n")).not.toContain(ORG_GROK);
    // the same grant as the organization's key
    const refused = await start(world({ orgAccount: ORG_GROK, perspicaxKeys: {}, orgVoice: new Set() }));
    expect((await refused.call({ sub: "sub-ada", voice_keys: true })).body).toEqual({ provider: "xai", voice_keys: [], cause: "server_engine_not_allowed" });
  });

  it("keeps the app's rights: the organization's key only for a person it was given to", async () => {
    const h = await start(world({ orgVoice: new Set(["pr_ada"]) }));
    // Ben has a key of his own: it serves him, the organization's is not his
    const ben = await h.call({ sub: "sub-ben", voice_keys: true });
    expect(ben.body!.voice_keys).toEqual([{ source: "perspicax-key", auth: "api-key", key: BEN_PERSPICAX }]);
    expect(JSON.stringify(ben.body)).not.toContain(ORG_KEY);
    // without a key of his own he gets none, and the app's own cause
    const none = await start(world({ orgVoice: new Set(["pr_ada"]), perspicaxKeys: { "sub-ada": ADA_PERSPICAX } }));
    expect(await none.call({ sub: "sub-ben", voice_keys: true })).toMatchObject({ status: 200, body: { provider: "xai", voice_keys: [], cause: "server_engine_not_allowed" } });
  });

  it("says the app's cause when nothing serves the person", async () => {
    const bare = await start(world({ orgKey: undefined, perspicaxKeys: {} }));
    expect((await bare.call({ sub: "sub-ada", voice_keys: true })).body).toEqual({ provider: "xai", voice_keys: [], cause: "no_credentials" });
    const off = await start(world({ disabled: new Set(["pr_ada"]) }));
    expect((await off.call({ sub: "sub-ada", voice_keys: true })).body).toEqual({ provider: "xai", voice_keys: [], cause: "payer_disabled" });
    const down = await start(world({ perspicaxDown: true, orgKey: undefined }));
    expect((await down.call({ sub: "sub-ada", voice_keys: true })).body).toEqual({ provider: "xai", voice_keys: [], cause: "perspicax_unreachable" });
  });

  it("only ever answers the keys of the person the call names", async () => {
    const h = await start(world({ grok: { pr_ben: "fake-grok-access-ben-33334444" }, voiceKeys: { pr_ben: "xai-BENvoice2Zx4Cv6Bn8Mq0" } }));
    // a body that names another person beside `sub` changes nothing
    const ada = await h.call({ sub: "sub-ada", voice_keys: true, principalId: "pr_ben", person: "pr_ben" });
    const text = JSON.stringify(ada.body);
    expect(text).toContain(ADA_PERSPICAX);
    for (const other of [BEN_PERSPICAX, "fake-grok-access-ben-33334444", "xai-BENvoice2Zx4Cv6Bn8Mq0"]) expect(text).not.toContain(other);
    const ben = await h.call({ sub: "sub-ben", voice_keys: true });
    expect(JSON.stringify(ben.body)).not.toContain(ADA_PERSPICAX);
    expect(h.resolved).toEqual(["pr_ada", "pr_ben"]);
  });

  it("resolves nothing for an unknown or inactive person, a bad token or a server with no link", async () => {
    const h = await start(world());
    expect(await h.call({ sub: "sub-unknown", voice_keys: true })).toMatchObject({ status: 404, body: { error: "unknown_person" } });
    expect(await h.call({ sub: "sub-off", voice_keys: true })).toMatchObject({ status: 409, body: { error: "user_inactive" } });
    for (const headers of [{}, { authorization: `Bearer ${TOKEN}x` }, { cookie: `omb_session=${TOKEN}` }]) {
      expect(await h.call({ sub: "sub-ada", voice_keys: true }, { headers: { "content-type": "application/json", ...headers } })).toMatchObject({ status: 401, body: { error: "unauthorized" } });
    }
    expect(h.resolved).toEqual([]);
  });

  it("answers the sign-in alone, as before, when the field is absent or not true (an older Perspicax)", async () => {
    const h = await start(world());
    for (const body of [{ sub: "sub-ada" }, { sub: "sub-ada", voice_keys: false }, { sub: "sub-ada", voice_keys: "true" }]) {
      expect(await h.call(body)).toMatchObject({ status: 404, body: { error: "no_sign_in" } });
    }
    expect(h.resolved).toEqual([]);
  });

  it("answers 503 when the keys cannot be resolved, so the caller falls back on its own", async () => {
    const lines: string[] = [];
    const routes = createOrgLinkRoutes({
      linked: () => true,
      linkTokenMatches: (token) => token === TOKEN,
      scheduler: { request: () => "started" },
      person: () => ({ principalId: "pr_ada", active: true }),
      grokSignIn: async () => ({ ok: false, error: "no_sign_in" }),
      voiceKeys: async () => { throw new Error(`boom ${ORG_KEY}`); },
      log: (line) => lines.push(line),
    });
    const server = createServer((req, res) => void routes(req, res, new URL(req.url ?? "/", "http://localhost")));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${GROK_SIGN_IN_PATH}`, {
      method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ sub: "sub-ada", voice_keys: true }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "voice_keys_unavailable" });
    expect(lines.join("\n")).not.toContain(ORG_KEY);
  });

  it("never writes a key in a log line: the sources only", async () => {
    const consoleLines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { consoleLines.push(args.map(String).join(" ")); });
    }
    const h = await start(world({ grok: { pr_ada: ADA_GROK }, voiceKeys: { pr_ada: ADA_VOICE } }));
    expect((await h.call({ sub: "sub-ada", voice_keys: true })).status).toBe(200);
    expect(h.lines).toEqual(["org link: voice keys for a phone line (grok-account, voice-key, perspicax-key, org-key)"]);
    for (const line of [...h.lines, ...consoleLines]) {
      for (const key of [ORG_KEY, ADA_PERSPICAX, ADA_VOICE, ADA_GROK]) {
        expect(line).not.toContain(key);
        expect(line).not.toContain(key.slice(-4));
      }
    }
  });
});
