// Real-Electron check of a nudge between two people of an organization
// server, as the desktop runs it in server mode: bob's window draws this
// app's bundled UI on the server's origin with his session; alice nudges him
// from another client. Bob's window must hear the nudge frame, play the
// nudge sound with no click in the page first, ask the shell to shake and
// come to the front; when bob sends a nudge, his own window shakes and
// rings too (the server's echo). Then a direct message from alice while
// bob's window is in the background raises a notification that stays, and
// the dock badge counts it. Isolated: temporary home, Electron profile and
// free ports.
//
//   pnpm exec vite build
//   node --experimental-strip-types scripts/verify/dev/verify-nudge.ts
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startFakeOidcProvider, type FakeOidcUser } from "../../../server/testing/fake-oidc-provider.ts";
import { freePortBlock } from "../../../server/testing/ports.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const electron = createRequire(import.meta.url)("electron") as unknown as string;
const RESERVED = [18790, 5199, 8799];
const ALICE: FakeOidcUser = { sub: "01J9VERIFYNUDGEALICE00000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const CAROL: FakeOidcUser = { sub: "01J9VERIFYNUDGECAROL00000C", email: "carol@example.test", name: "Carol", preferred_username: "carol", role: "employee" };
const BOB: FakeOidcUser = { sub: "01J9VERIFYNUDGEBOB0000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };

const idp = await startFakeOidcProvider({ user: ALICE });
idp.directoryPeople = [ALICE, BOB, CAROL].map((user) => idp.personOf(user));
const port = await freePortBlock([0, 1]);
if (RESERVED.includes(port) || RESERVED.includes(port + 1)) throw new Error("reserved port, run again");
const origin = `http://127.0.0.1:${port}`;
const home = mkdtempSync(join(tmpdir(), "omb-verify-nudge-"));
mkdirSync(join(home, ".sagax"), { recursive: true });
writeFileSync(join(home, ".sagax", "config.json"), "{}");
mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
  version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin, link_token: idp.linkToken,
}), { mode: 0o640 });
let serverLog = "";
const server: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], {
  cwd: ROOT,
  env: {
    PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
    SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: idp.issuer, SAGAX_PUBLIC_URL: origin,
    SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"), SAGAX_PERSPICAX_DIRECTORY_SECONDS: "5", SAGAX_ORG_NAME: "Acme",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout!.on("data", (c) => (serverLog += c));
server.stderr!.on("data", (c) => (serverLog += c));
const deadline = Date.now() + 30_000;
for (;;) {
  try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch { /* not yet */ }
  if (Date.now() > deadline) throw new Error(`server never came up:\n${serverLog}`);
  await new Promise((r) => setTimeout(r, 200));
}

const pair = (setCookie: string) => setCookie.split(";")[0]!;
async function signIn(user: FakeOidcUser): Promise<string> {
  idp.user = { ...user };
  const start = await fetch(`${origin}/auth/oidc/start`, { redirect: "manual" });
  const binding = pair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  if (!session) throw new Error(`no session for ${user.preferred_username}:\n${serverLog.slice(-2000)}`);
  return pair(session);
}
const alice = await signIn(ALICE);
const bob = await signIn(BOB);
const carol = await signIn(CAROL);
let people: Array<{ principalId: string; login: string }> = [];
for (let i = 0; i < 100 && people.length < 3; i++) {
  const got = await (await fetch(`${origin}/api/org/directory`, { headers: { cookie: alice } })).json() as { people?: typeof people };
  people = got.people ?? [];
  if (people.length < 3) await new Promise((r) => setTimeout(r, 200));
}
const idOf = (login: string) => people.find((person) => person.login === login)?.principalId ?? "";
console.log(`[verify] organization server ${origin}`);

const userData = mkdtempSync(join(tmpdir(), "omb-verify-nudge-ud-"));
const code = await new Promise<number>((resolve) => {
  const child = spawn(electron, [join(ROOT, "scripts", "verify", "dev", "verify-nudge.electron.mjs"), `--user-data-dir=${userData}`], {
    env: {
      ...process.env, VERIFY_ORIGIN: origin, VERIFY_BUNDLE: join(ROOT, "dist"),
      VERIFY_ALICE_COOKIE: alice, VERIFY_BOB_COOKIE: bob, VERIFY_CAROL_COOKIE: carol, VERIFY_BOB_ID: idOf("bob"), VERIFY_CAROL_ID: idOf("carol"),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (status) => resolve(status ?? 1));
});
server.kill("SIGTERM");
await idp.close();
if (/omb_session_[A-Za-z0-9_-]{20,}=/.test(serverLog)) {
  console.log("[verify] FAIL: a session cookie reached the server log");
  process.exit(1);
}
process.exit(code);
