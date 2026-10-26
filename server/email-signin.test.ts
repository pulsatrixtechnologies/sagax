// End to end: a hosted server with a sign-in allow-list lets a remote browser
// sign in with a code the server emails itself (server/account-signin.ts,
// server/email-otp.ts) and ends up with the same cookie session a pairing
// code would give. SAGAX_MAIL_CAPTURE_FILE (server/index.ts) stands in for a
// real mail provider: the spawned server appends each message it would have
// sent as a JSON line instead, and this file reads the code back from there.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { openSse } from "./testing/sse.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const PORT = await freePortBlock([0, 1]);
const HOST = "agentada.test";

let home: string;
let child: ChildProcess;
let captureFile: string;
let stderr = "";

interface CapturedMail { to: string; subject: string; text: string; at: string }

function capturedMail(): CapturedMail[] {
  try {
    return readFileSync(captureFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as CapturedMail);
  } catch {
    return [];
  }
}

/** The newest code this server emailed to `email`, read back from the
 * capture file (server/mailer.ts createCaptureMailer). */
function latestCode(email: string): string {
  const messages = capturedMail().filter((m) => m.to.toLowerCase() === email.toLowerCase());
  const match = messages.length ? /Your code is (\d{8})/.exec(messages[messages.length - 1]!.text) : null;
  if (!match) throw new Error(`no captured sign-in code for ${email}`);
  return match[1]!;
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

/** A remote browser: a foreign Host and a forwarded address, like a proxy or tunnel hands us. */
function call(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; from?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path,
        method: init.method ?? (payload ? "POST" : "GET"),
        headers: {
          host: HOST,
          "x-forwarded-for": init.from ?? "203.0.113.7",
          "x-forwarded-proto": "https",
          ...(payload ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let body: unknown = raw;
          try {
            body = JSON.parse(raw);
          } catch {
            /* not json */
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const cookieOf = (reply: Reply): string => {
  const raw = reply.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return (first ?? "").split(";")[0];
};

async function signIn(email: string): Promise<string> {
  expect((await call("/api/auth/email/start", { body: { email } })).status).toBe(200);
  const reply = await call("/api/auth/email/verify", { body: { email, code: latestCode(email) } });
  expect(reply.status).toBe(200);
  return cookieOf(reply);
}

async function openEvents(cookie: string) {
  const stream = await openSse(`http://127.0.0.1:${PORT}/api/events`, {
    "x-forwarded-for": "203.0.113.7", "x-forwarded-proto": "https", cookie,
  });
  await stream.until((frame) => frame.kind === "hello");
  return stream;
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-email-signin-"));
  captureFile = join(home, "mail-capture.jsonl");
  const staticDir = join(home, "static");
  mkdirSync(join(home, ".sagax"), { recursive: true });
  mkdirSync(join(staticDir, "assets"), { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Served UI</title>");
  writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({
    instances: { fixture: { driver: "email-signin-test-shadow" } },
    signIn: { admins: ["her@example.test", "@agentada.test"], members: ["staff@example.test"] },
  }));
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USERPROFILE: home,
      SAGAX_PORT: String(PORT),
      SAGAX_WEBHOOK_PORT: String(PORT + 1),
      SAGAX_STATIC_DIR: staticDir,
      SAGAX_PUBLIC_URL: `https://${HOST}`,
      SAGAX_ENVIRONMENT_LABEL: "agentada",
      SAGAX_BROWSER_CONNECTION: join(home, "browser-test-connection.json"),
      SAGAX_MAIL_CAPTURE_FILE: captureFile,
      SAGAX_TEST_SEAMS: "1",
      SAGAX_SSE_HEARTBEAT_MS: "50",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start:\n${stderr}`);
}, 30_000);

afterAll(async () => {
  await waitForExit(child, { signal: "SIGTERM" });
  await removeTempDir(home);
});

describe("sign in with your email on a hosted server", () => {
  it("advertises the option in the public descriptor", async () => {
    const descriptor = await call("/.well-known/openmausbot/environment");
    expect(descriptor.status).toBe(200);
    expect(descriptor.body.capabilities.emailSignIn).toBe(true);
  });

  it("is JSON-only and refuses addresses that are not on the list", async () => {
    const form = await new Promise<Reply>((resolve, reject) => {
      const req = httpRequest({ hostname: "127.0.0.1", port: PORT, path: "/api/auth/email/start", method: "POST", headers: { host: HOST, "x-forwarded-for": "203.0.113.9", "content-type": "application/x-www-form-urlencoded" } }, (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: raw }));
      });
      req.on("error", reject);
      req.end("email=her%40example.test");
    });
    expect(form.status).toBe(415);
    const stranger = await call("/api/auth/email/start", { body: { email: "stranger@example.test" } });
    expect(stranger.status).toBe(403);
    expect(stranger.body.error).toMatch(/not on this server's sign-in list/);
    expect(capturedMail()).toEqual([]);
  });

  it("emails a code to a welcome address, then turns the code into an admin cookie session that shows its email", async () => {
    const started = await call("/api/auth/email/start", { body: { email: "her@example.test" } });
    expect(started.status).toBe(200);
    expect(capturedMail().some((m) => m.to === "her@example.test")).toBe(true);

    const wrong = await call("/api/auth/email/verify", { body: { email: "her@example.test", code: "00000000", label: "Her iPad" } });
    expect(wrong.status).toBe(401);
    expect(cookieOf(wrong)).toBe("");

    const right = await call("/api/auth/email/verify", { body: { email: "her@example.test", code: latestCode("her@example.test"), label: "Her iPad" } });
    expect(right.status).toBe(200);
    expect(right.body.session).toMatchObject({ label: "Her iPad", scopes: ["admin", "client"], email: "her@example.test" });
    expect(right.body.environment.environmentId).toBeTruthy();
    const cookie = cookieOf(right);
    expect(cookie).toMatch(/^omb_session_/);
    expect(String(right.headers["set-cookie"])).toMatch(/HttpOnly/);

    const me = await call("/api/auth/session", { headers: { cookie, origin: `https://${HOST}` } });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ kind: "session", email: "her@example.test", scopes: ["admin", "client"], via: "cookie" });
    // only a hosted team workspace says so; the web UI's first run reads it
    expect(me.body).not.toHaveProperty("hosted");
    // admin scope: settings are hers to change
    const config = await call("/api/config", { method: "PUT", body: { language: "en" }, headers: { cookie, origin: `https://${HOST}` } });
    expect(config.status).toBe(200);
    const listed = await call("/api/auth/sessions", { headers: { cookie, origin: `https://${HOST}` } });
    expect(listed.status).toBe(200);
    expect(listed.body.sessions.some((s: { email?: string }) => s.email === "her@example.test")).toBe(true);
    // 2026-10-19: a valid sign-in, never a recent one (a bot reading her
    // mailbox could type the code): no first key, no vault export in clear.
    const keys = await call("/api/security-keys", { headers: { cookie, origin: `https://${HOST}` } });
    expect(keys.status).toBe(200);
    expect(keys.body.needsSignIn).toBe(true);
    const exported = await call("/api/me/credentials/export", { body: { format: "bitwarden-json", acknowledge: "plaintext" }, headers: { cookie, origin: `https://${HOST}` } });
    expect(exported.status).toBe(403);
    expect(exported.body).toMatchObject({ code: "reauth_required" });
  });

  it("a member address gets a chat-only session; a domain entry welcomes the whole company", async () => {
    await call("/api/auth/email/start", { body: { email: "staff@example.test" } });
    const member = await call("/api/auth/email/verify", { body: { email: "staff@example.test", code: latestCode("staff@example.test"), label: "Staff phone" } });
    expect(member.status).toBe(200);
    expect(member.body.session.scopes).toEqual(["client"]);
    const cookie = cookieOf(member);
    const bots = await call("/api/bots", { headers: { cookie, origin: `https://${HOST}` } });
    expect(bots.status).toBe(200);
    const config = await call("/api/config", { method: "PUT", body: { language: "en" }, headers: { cookie, origin: `https://${HOST}` } });
    expect(config.status).toBe(403);

    // A different local part than "anyone@agentada.test" below: that address
    // is signed in three times in a later test (server/email-otp.ts caps
    // sends per address at OTP_SENDS_PER_ADDRESS within the send window).
    await call("/api/auth/email/start", { body: { email: "someone@agentada.test" } });
    const colleague = await call("/api/auth/email/verify", { body: { email: "someone@agentada.test", code: latestCode("someone@agentada.test") } });
    expect(colleague.status).toBe(200);
    expect(colleague.body.session.scopes).toEqual(["admin", "client"]);
    // no label and no browser user agent in this test client: the generic fallback
    expect(colleague.body.session.label).toBe("Unnamed device");
  });

  it("locks a source out after repeated wrong codes, like pairing does", async () => {
    let last = 0;
    for (let i = 0; i < 12; i += 1) {
      const reply = await call("/api/auth/email/verify", { body: { email: "her@example.test", code: "99999999" }, from: "198.51.100.42" });
      last = reply.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
    // the lockout is per source: someone else still gets in, with a fresh
    // code (the one issued before the lockout loop is long since spent).
    // This is her@example.test's 2nd start in this file; the "revokes
    // demoted…" test below signs her in once more, for exactly 3 — the
    // OTP_SENDS_PER_ADDRESS cap (per 15-minute window). Do not add a 4th
    // start for this address anywhere in this file.
    await call("/api/auth/email/start", { body: { email: "her@example.test" } });
    const other = await call("/api/auth/email/verify", { body: { email: "her@example.test", code: latestCode("her@example.test") }, from: "198.51.100.43" });
    expect(other.status).toBe(200);
  });

  it("revokes demoted email devices and live streams before the next frame, without changing paired devices", async () => {
    const owner = await signIn("her@example.test");
    const first = await signIn("anyone@agentada.test");
    const second = await signIn("anyone@agentada.test");
    const streams = await Promise.all([openEvents(first), openEvents(second)]);
    try {
      const ticket = await call("/api/auth/stream-ticket", { body: {}, headers: { cookie: first } });
      expect(ticket.status).toBe(200);
      const pairing = await call("/api/auth/pairing", { body: {}, headers: { cookie: owner } });
      expect(pairing.status).toBe(200);
      const paired = await call("/api/auth/pair", { body: { code: pairing.body.code, cookie: true, label: "QR device" } });
      expect(paired.status).toBe(200);
      const changed = await call("/api/config", {
        method: "PUT", headers: { cookie: owner },
        body: {
          signIn: { admins: ["her@example.test"], members: ["staff@example.test", "@agentada.test"] },
          profile: { name: "post-demotion-private-marker" },
        },
      });
      expect(changed.status).toBe(200);
      await Promise.all(streams.map((stream) => expect(stream.until(() => false, 2_000)).rejects.toThrow("SSE stream closed")));
      expect(JSON.stringify(streams.map((stream) => stream.frames))).not.toContain("post-demotion-private-marker");
      expect((await call("/api/bots", { headers: { cookie: first } })).status).toBe(401);
      expect((await call("/api/bots", { headers: { cookie: second } })).status).toBe(401);
      expect((await call(`/api/events?ticket=${ticket.body.ticket}`)).status).toBe(401);
      expect((await call("/api/auth/sessions", { headers: { cookie: cookieOf(paired) } })).status).toBe(200);

      const member = await signIn("anyone@agentada.test");
      expect((await call("/api/auth/session", { headers: { cookie: member } })).body.scopes).toEqual(["client"]);
      expect((await call("/api/config", { method: "PUT", headers: { cookie: member }, body: { language: "en" } })).status).toBe(403);
      expect((await call("/api/config", {
        method: "PUT", headers: { cookie: owner },
        body: { signIn: { admins: ["her@example.test", "@agentada.test"], members: ["staff@example.test"] } },
      })).status).toBe(200);
      expect((await call("/api/auth/session", { headers: { cookie: member } })).body.scopes).toEqual(["client"]);
    } finally { for (const stream of streams) stream.close(); }
  });

  it("ends an idle email stream after an external allow-list removal and never revives the old cookie", async () => {
    const cookie = await signIn("staff@example.test");
    const stream = await openEvents(cookie);
    const configPath = join(home, ".sagax", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    try {
      // The fleet agent and CLI update this file outside the running server.
      writeFileSync(configPath, JSON.stringify({ ...config, signIn: { ...config.signIn, members: [] } }));
      await expect(stream.until(() => false, 2_000)).rejects.toThrow("SSE stream closed");
      expect((await call("/api/bots", { headers: { cookie } })).status).toBe(401);
      expect((await call("/api/auth/email/start", { body: { email: "staff@example.test" } })).status).toBe(403);
      writeFileSync(configPath, JSON.stringify(config));
      expect((await call("/api/bots", { headers: { cookie } })).status).toBe(401);
    } finally { stream.close(); writeFileSync(configPath, JSON.stringify(config)); }
  });
});
