// A personal computer whose desktop app is signed in to an organization: the
// real server, booted on the owner identity the desktop left it
// (owner-identity.json, what the private `openmausbot:owner-identity`
// message writes), answers the phone like an organization server does for
// that one person. Directly (loopback and a paired phone) and through the
// companion sidecar, the way an iPhone reaches a personal computer.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createConnectedDeviceTracker } from "../../companion/src/connected-devices.ts";
import { createProxyHandler } from "../../companion/src/proxy.ts";
import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const posixOnly = describe.skipIf(process.platform === "win32");
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("the owner's perspicax avatar")]);
const VERSION = "0123456789abcdef";
const DEVICE_TOKEN = "omb_device_owner_identity_test";

let PORT = 0;
let BASE = "";
let SIDECAR = "";
let child: ChildProcess | undefined;
let sidecar: Server | undefined;
let home = "";
let log = "";

const get = async (base: string, path: string, bearer?: string) => {
  const res = await fetch(`${base}${path}`, { headers: bearer ? { authorization: `Bearer ${bearer}` } : {}, signal: AbortSignal.timeout(15_000) });
  const bytes = Buffer.from(await res.arrayBuffer());
  let body: any = {};
  try { body = JSON.parse(bytes.toString("utf8")); } catch { /* bytes */ }
  return { status: res.status, headers: res.headers, bytes, body };
};

posixOnly("a personal computer signed in to an organization", () => {
  beforeAll(async () => {
    PORT = await freePortBlock([0, 1, 2]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-owner-identity-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({ profile: { name: "Local Name", email: "local@example.test" } }));
    writeFileSync(join(data, "owner-identity.json"), JSON.stringify({
      origin: "https://sagax.example.test", principalId: "pr_org_person", name: "Alex Martin", email: "owner@example.test",
      avatar: { version: VERSION, data: PNG.toString("base64") },
    }), { mode: 0o600 });
    child = spawn(process.execPath, [join(SERVER_DIR, "..", "index.ts")], {
      cwd: join(SERVER_DIR, "..", ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "",
        SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        if ((await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2_000) })).ok) break;
      } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
      await new Promise((r) => setTimeout(r, 150));
    }
    sidecar = createServer(createProxyHandler({
      harnessPort: PORT,
      authenticate: (token) => (token === DEVICE_TOKEN ? { id: "phone", cloudDesktopAccess: false, browserControlAccess: false } : null),
      redeem: () => ({ error: "no pairing here" }),
      serverName: () => "Studio",
      connected: createConnectedDeviceTracker().open,
    }));
    await new Promise<void>((resolve, reject) => {
      sidecar!.once("error", reject);
      sidecar!.listen(PORT + 2, "127.0.0.1", () => resolve());
    });
    SIDECAR = `http://127.0.0.1:${PORT + 2}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((r) => (sidecar ? sidecar.close(() => r()) : r()));
    if (child) await waitForExit(child, { signal: "SIGTERM" });
    if (home) await removeTempDir(home);
  });

  const expectAvatar = async (base: string, url: string, bearer?: string, cache = "private, max-age=86400") => {
    const res = await get(base, url, bearer);
    expect(res.status, log.slice(-2000)).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(cache);
    expect(res.bytes.equals(PNG)).toBe(true);
  };

  it("names the owner's organization identity and avatar in the session, and serves it", async () => {
    const session = await get(BASE, "/api/auth/session");
    expect(session.body).toMatchObject({ kind: "loopback", name: "Alex Martin", email: "owner@example.test", computerName: expect.any(String) });
    expect(session.body.avatarUrl).toMatch(new RegExp(`^/api/people/[\\w-]+/avatar\\?v=${VERSION}$`));
    // the operator's own principal here, never the organization's id
    expect(session.body.avatarUrl).not.toContain("pr_org_person");
    await expectAvatar(BASE, session.body.avatarUrl);
    expect((await get(BASE, "/api/people/pr_someone_else/avatar?v=x")).status).toBe(404);
  });

  it("gives a chat-only phone paired to this computer the same photo", async () => {
    const pairing = await fetch(`${BASE}/api/auth/pairing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: "Phone", scopes: ["client"] }) }).then((r) => r.json()) as { code: string };
    const paired = await fetch(`${BASE}/api/auth/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pairing.code }) }).then((r) => r.json()) as { token: string };
    const url = (await get(BASE, "/api/auth/session")).body.avatarUrl as string;
    await expectAvatar(BASE, url, paired.token);
    expect([401, 403]).toContain((await get(BASE, url, "omb_sess_not-a-real-token-000000000000000000000")).status);
  });

  it("does the same through the companion sidecar, as the iPhone reaches this computer", async () => {
    const session = await get(SIDECAR, "/api/auth/session", DEVICE_TOKEN);
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({ kind: "loopback", name: "Alex Martin", email: "owner@example.test" });
    // the sidecar marks everything it relays private, no-store; the phone
    // keeps the image itself, keyed by the versioned URL
    await expectAvatar(SIDECAR, session.body.avatarUrl, DEVICE_TOKEN, "private, no-store");
    expect((await get(SIDECAR, session.body.avatarUrl)).status).toBe(401);
  });
});
