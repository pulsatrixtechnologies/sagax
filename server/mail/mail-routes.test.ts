import { describe, expect, it, vi } from "vitest";

import type { MailSettings } from "./mail-config.ts";
import { createMailSettingsRoutes, MAIL_TEST_LIMIT, type MailSettingsRouteDeps } from "./mail-routes.ts";
import type { Mailer } from "./mailer.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteContext } from "../routes/table.ts";
import type { SessionRecord } from "../auth/sessions.ts";

// Fake values only. Long and distinct so a fragment would be caught too.
const SAVED_SECRET = "zq9Xw7LmPr4tVb2Nk8Yd";
const ENV_SECRET = "Hj3Ks6Wq1Ez5Rt8Uy0Io";

const admin: RequestAuth = {
  kind: "session", via: "cookie", scopes: ["admin", "client"],
  session: { id: "s-admin", label: "web", scopes: ["admin", "client"], createdAt: 1, lastSeenAt: 1, email: "boss@example.com" } as SessionRecord,
};
const member: RequestAuth = {
  kind: "session", via: "cookie", scopes: ["client"],
  session: { id: "s-member", label: "web", scopes: ["client"], createdAt: 1, lastSeenAt: 1, email: "ada@example.com" } as SessionRecord,
};
const operator: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };

function harness(options: Partial<Omit<MailSettingsRouteDeps, "env">> & { initial?: MailSettings; env?: NodeJS.ProcessEnv } = {}) {
  const { initial, env, ...overrides } = options;
  let saved: MailSettings | undefined = initial;
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const saves: Array<MailSettings | undefined> = [];
  let clock = 1_000_000;
  const mailer: Mailer = { send: async (message) => { sent.push(message); } };
  const route = createMailSettingsRoutes({
    organization: false,
    saved: () => saved,
    save: (next) => { saves.push(next); saved = next; },
    env: () => env ?? {},
    mailer: () => mailer,
    callerEmail: (auth) => (auth.kind === "session" ? auth.session.email : "owner@example.com"),
    now: () => clock,
    ...overrides,
  });
  const call = async (input: { method: string; path: string; auth?: RequestAuth; body?: unknown }) => {
    const out: { status?: number; body?: any } = {};
    const ctx = {
      req: { headers: { "content-type": "application/json" } },
      res: { setHeader: () => {}, headersSent: false, writableEnded: false },
      url: new URL(`http://localhost${input.path}`), path: input.path, method: input.method, auth: input.auth ?? admin,
      json: (_res: unknown, status: number, body: unknown) => { out.status = status; out.body = body; },
      readBody: async () => input.body ?? {},
    } as unknown as RouteContext;
    const result = await route(ctx);
    return { ...out, passed: result === PASS };
  };
  return { call, sent, saves, saved: () => saved, advance: (ms: number) => { clock += ms; } };
}

function fragments(secret: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 4 <= secret.length; i++) out.push(secret.slice(i, i + 4));
  return out;
}

const READY: MailSettings = { provider: "twilio", from: "bot@example.com", twilio: { apiKeySid: "SKfakesid", apiKeySecret: SAVED_SECRET } };

describe("GET /api/mail/settings", () => {
  it("never returns a secret, saved or from the environment, not even a fragment", async () => {
    const h = harness({ initial: READY, env: { SAGAX_SENDGRID_API_KEY: ENV_SECRET, SAGAX_SMTP_PASSWORD: ENV_SECRET } });
    const out = await h.call({ method: "GET", path: "/api/mail/settings" });
    expect(out.status).toBe(200);
    const text = JSON.stringify(out.body);
    for (const secret of [SAVED_SECRET, ENV_SECRET]) for (const part of fragments(secret)) expect(text).not.toContain(part);
    expect(out.body.fields["twilio.apiKeySecret"]).toEqual({ source: "saved", serverDefault: false, configured: true });
    expect(out.body.fields["sendgrid.apiKey"]).toEqual({ source: "server", serverDefault: true, configured: true });
    expect(out.body.ready).toBe(true);
    expect(out.body.testAddress).toBe("boss@example.com");
  });

  it("passes on other paths", async () => {
    expect((await harness().call({ method: "GET", path: "/api/mail/other" })).passed).toBe(true);
  });
});

describe("who may use the mail settings", () => {
  it("refuses a session without admin scope", async () => {
    const h = harness({ initial: READY });
    for (const [method, path] of [["GET", "/api/mail/settings"], ["PUT", "/api/mail/settings"], ["POST", "/api/mail/test"]] as const) {
      const out = await h.call({ method, path, auth: member, body: { from: "x@example.com" } });
      expect(out.status, `${method} ${path}`).toBe(403);
      expect(out.body.code).toBe("forbidden");
    }
    expect(h.saves).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it("answers 403 identity_perspicax on an organization server, to an admin too", async () => {
    const h = harness({ initial: READY, organization: true });
    for (const [method, path] of [["GET", "/api/mail/settings"], ["PUT", "/api/mail/settings"], ["POST", "/api/mail/test"]] as const) {
      const out = await h.call({ method, path, auth: admin, body: { from: "x@example.com" } });
      expect(out.status, `${method} ${path}`).toBe(403);
      expect(out.body.code).toBe("identity_perspicax");
      expect(JSON.stringify(out.body)).not.toContain(SAVED_SECRET);
    }
    expect(h.saves).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it("lets the operator at this computer in", async () => {
    const out = await harness({ initial: READY }).call({ method: "GET", path: "/api/mail/settings", auth: operator });
    expect(out.status).toBe(200);
    expect(out.body.testAddress).toBe("owner@example.com");
  });

  it("refuses a service-trust loopback caller", async () => {
    const out = await harness({ initial: READY }).call({ method: "GET", path: "/api/mail/settings", auth: { kind: "loopback", scopes: ["client"], trust: "service" } });
    expect(out.status).toBe(403);
  });
});

describe("PUT /api/mail/settings", () => {
  it("saves the change into the config mail block and answers without the secret", async () => {
    const h = harness({ initial: { provider: "smtp", smtp: { host: "old" } } });
    const out = await h.call({ method: "PUT", path: "/api/mail/settings", body: { provider: "twilio", from: "bot@example.com", "twilio.apiKeySid": "SKfakesid", "twilio.apiKeySecret": SAVED_SECRET } });
    expect(out.status).toBe(200);
    expect(h.saved()).toEqual({ provider: "twilio", from: "bot@example.com", smtp: { host: "old" }, twilio: { apiKeySid: "SKfakesid", apiKeySecret: SAVED_SECRET } });
    for (const part of fragments(SAVED_SECRET)) expect(JSON.stringify(out.body)).not.toContain(part);
    expect(out.body.fields["twilio.apiKeySecret"].configured).toBe(true);
    expect(out.body.ready).toBe(true);
  });

  it("reverts a field to the server's value with null", async () => {
    const h = harness({ initial: { provider: "smtp", from: "ui@example.com" }, env: { SAGAX_MAIL_FROM: "env@example.com" } });
    const out = await h.call({ method: "PUT", path: "/api/mail/settings", body: { from: null } });
    expect(out.status).toBe(200);
    expect(h.saved()).toEqual({ provider: "smtp" });
    expect(out.body.fields.from).toEqual({ source: "server", serverDefault: true, value: "env@example.com", serverValue: "env@example.com" });
  });

  it("refuses an invalid change without saving", async () => {
    const h = harness({ initial: READY });
    for (const body of [{ to: "x@y.z" }, { from: "nope" }, { fromName: "a\r\nBcc: x@y.z" }, [], "text"]) {
      const out = await h.call({ method: "PUT", path: "/api/mail/settings", body });
      expect(out.status, JSON.stringify(body)).toBe(400);
      expect(out.body.code).toBe("invalid_mail_settings");
    }
    expect(h.saves).toEqual([]);
  });

  it("refuses other methods", async () => {
    expect((await harness().call({ method: "DELETE", path: "/api/mail/settings" })).status).toBe(405);
    expect((await harness().call({ method: "GET", path: "/api/mail/test" })).status).toBe(405);
  });
});

describe("POST /api/mail/test", () => {
  it("sends one message to the calling admin's own address", async () => {
    const h = harness({ initial: READY });
    const out = await h.call({ method: "POST", path: "/api/mail/test" });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ sentTo: "boss@example.com" });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.to).toBe("boss@example.com");
  });

  it("accepts no recipient or any other field", async () => {
    const h = harness({ initial: READY });
    for (const body of [{ to: "victim@example.com" }, { recipient: "victim@example.com" }, { cc: "x@y.z" }]) {
      const out = await h.call({ method: "POST", path: "/api/mail/test", body });
      expect(out.status, JSON.stringify(body)).toBe(400);
      expect(out.body.code).toBe("recipient_not_allowed");
    }
    expect(h.sent).toEqual([]);
  });

  it("is rate limited per caller", async () => {
    const h = harness({ initial: READY });
    for (let i = 0; i < MAIL_TEST_LIMIT.max; i++) {
      expect((await h.call({ method: "POST", path: "/api/mail/test" })).status).toBe(200);
      h.advance(MAIL_TEST_LIMIT.minIntervalMs);
    }
    const limited = await h.call({ method: "POST", path: "/api/mail/test" });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("rate_limited");
    expect(limited.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(h.sent).toHaveLength(MAIL_TEST_LIMIT.max);
    h.advance(MAIL_TEST_LIMIT.windowMs);
    expect((await h.call({ method: "POST", path: "/api/mail/test" })).status).toBe(200);
  });

  it("refuses a second send too soon after the first", async () => {
    const h = harness({ initial: READY });
    expect((await h.call({ method: "POST", path: "/api/mail/test" })).status).toBe(200);
    expect((await h.call({ method: "POST", path: "/api/mail/test" })).status).toBe(429);
  });

  it("needs an address for the caller and a ready transport", async () => {
    const noAddress = harness({ initial: READY, callerEmail: () => undefined });
    const out = await noAddress.call({ method: "POST", path: "/api/mail/test" });
    expect(out.status).toBe(409);
    expect(out.body.code).toBe("no_address");
    const notReady = harness({ initial: { provider: "twilio" }, mailer: () => null });
    const out2 = await notReady.call({ method: "POST", path: "/api/mail/test" });
    expect(out2.status).toBe(409);
    expect(out2.body.code).toBe("mail_not_ready");
  });

  it("reports a refusal without the credential in it", async () => {
    const h = harness({ initial: READY, mailer: () => ({ send: async () => { throw new Error(`Twilio refused the message (401): bad ${SAVED_SECRET}`); } }) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = await h.call({ method: "POST", path: "/api/mail/test" });
      expect(out.status).toBe(502);
      expect(out.body.code).toBe("send_failed");
      expect(out.body.error).toContain("Twilio refused the message (401)");
      expect(JSON.stringify(out.body)).not.toContain(SAVED_SECRET);
      for (const call of warn.mock.calls) expect(JSON.stringify(call)).not.toContain(SAVED_SECRET);
    } finally {
      warn.mockRestore();
    }
  });
});
