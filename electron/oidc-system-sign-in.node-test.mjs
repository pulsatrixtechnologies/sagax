// "Sign in with Pulsatrix" in the desktop app: always the system browser
// (electron/oidc-system-sign-in.cjs). The loopback listener, the fallback
// decision, the openmausbot:// return and the /pair handoff.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  SIGN_IN_HANDOFF_TTL_MS, SYSTEM_SIGN_IN_TTL_MS, appHandlerPath, authReturnTarget, chooseReturnPath, createPendingSystemSignIn,
  createSignInHandoff, desktopStartUrl, oidcLoginStartUrl, ownsScheme, redactedTarget, sagaxReturnLink, signInSupport, startLoopbackReturn,
} = require("./oidc-system-sign-in.cjs");

const ORG = "https://bot.example.test";
const state = { environments: [{ id: "e1", name: "Org", origin: ORG }], activeId: "e1" };

test("only the selected saved server's /auth/oidc/start is a sign-in to take over", () => {
  assert.equal(oidcLoginStartUrl(`${ORG}/auth/oidc/start`, state), `${ORG}/auth/oidc/start`);
  assert.equal(oidcLoginStartUrl("https://evil.example/auth/oidc/start", state), null);
  assert.equal(oidcLoginStartUrl(`${ORG}/pair`, state), null);
  assert.equal(oidcLoginStartUrl(`${ORG}/auth/oidc/start`, { environments: [], activeId: "local" }), null);
  assert.equal(oidcLoginStartUrl("not a url", state), null);
});

test("there is no in-app sign-in window any more", () => {
  const mod = require("./oidc-system-sign-in.cjs");
  assert.equal(mod.openOidcLoginWindow, undefined);
  assert.equal(mod.oidcLoginReturnUrl, undefined);
});

test("the fallback decision: loopback first, the scheme only when this app owns it, else nothing", () => {
  const table = [
    // loopbackReturn, loopbackReady, nativeReturn, owns -> path
    [true, true, true, true, "loopback"],
    [true, true, true, false, "loopback"],
    [true, true, false, false, "loopback"],
    [true, false, true, true, "scheme"],
    [true, false, true, false, "unsupported"],
    [false, false, true, true, "scheme"],
    [false, true, true, true, "scheme"],
    [false, false, true, false, "unsupported"],
    [false, false, false, true, "unsupported"],
    [false, false, false, false, "unsupported"],
  ];
  for (const [loopbackReturn, loopbackReady, nativeReturn, owns, expected] of table) {
    assert.equal(chooseReturnPath({ loopbackReturn, loopbackReady, nativeReturn, ownsScheme: owns }), expected, JSON.stringify({ loopbackReturn, loopbackReady, nativeReturn, owns }));
  }
});

test("what the server says it supports", () => {
  assert.deepEqual(signInSupport({ identity: { kind: "perspicax", nativeReturn: true, loopbackReturn: true } }), { loopbackReturn: true, nativeReturn: true, sagaxReturn: false });
  assert.deepEqual(signInSupport({ identity: { kind: "perspicax", nativeReturn: true } }), { loopbackReturn: false, nativeReturn: true, sagaxReturn: false });
  assert.deepEqual(signInSupport({ identity: { kind: "other", nativeReturn: true, loopbackReturn: true } }), { loopbackReturn: false, nativeReturn: false, sagaxReturn: false });
  assert.deepEqual(signInSupport({ identity: { kind: "perspicax", loopbackReturn: "true" } }), { loopbackReturn: false, nativeReturn: false, sagaxReturn: false });
  assert.deepEqual(signInSupport(null), { loopbackReturn: false, nativeReturn: false, sagaxReturn: false });
});

test("a server that lists sagax among its native returns can end on sagax://auth", () => {
  const identity = { kind: "perspicax", nativeReturn: true, loopbackReturn: true, nativeReturnSchemes: ["sagax", "openmausbot"] };
  assert.equal(signInSupport({ identity }).sagaxReturn, true);
  assert.equal(signInSupport({ identity: { ...identity, nativeReturn: false } }).sagaxReturn, false);
  const back = sagaxReturnLink(ORG);
  assert.equal(back, `sagax://auth?origin=${encodeURIComponent(ORG)}`);
  assert.equal(new URL(desktopStartUrl(ORG, back)).searchParams.get("return"), back);
  assert.deepEqual(parseAuthReturnLink(`${back}#code=${CREDENTIAL}`, state), { origin: ORG, code: CREDENTIAL });
  const next = CREDENTIAL.replace(/^omb_/, "sgx_");
  assert.deepEqual(parseAuthReturnLink(`${back}#code=${next}`, state), { origin: ORG, code: next }, "sgx_pair_ is accepted too");
});

test("this app owns openmausbot:// only when the system's handler is this exact copy", () => {
  const dev = "/repo/node_modules/.cache/pulsa-dev/Sagax.app";
  assert.equal(appHandlerPath(`${dev}/Contents/MacOS/Sagax`, "darwin"), dev);
  assert.equal(appHandlerPath("/usr/bin/node", "darwin"), null);
  assert.equal(ownsScheme({ isDefault: true, handlerPath: dev, appPath: dev, platform: "darwin" }), true);
  assert.equal(ownsScheme({ isDefault: true, handlerPath: "/Applications/Sagax.app", appPath: dev, platform: "darwin" }), false);
  assert.equal(ownsScheme({ isDefault: true, handlerPath: null, appPath: dev, platform: "darwin" }), false);
  assert.equal(ownsScheme({ isDefault: false, handlerPath: dev, appPath: dev, platform: "darwin" }), false);
  assert.equal(ownsScheme({ isDefault: true, handlerPath: "C:\\Program Files\\Sagax\\Sagax.exe", appPath: "c:\\program files\\sagax\\sagax.exe", platform: "win32" }), true);
  assert.equal(ownsScheme({ isDefault: true, handlerPath: null, appPath: "/opt/Sagax/sagax", platform: "linux" }), true);
});

// ── the loopback listener ──

const CODE = `omb_pair_${"A1b2_C3d4-".repeat(4)}xyz`;
const post = (url, body, headers = {}) => fetch(url, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", origin: new URL(url).origin, ...headers },
  body,
});

test("the loopback listener binds 127.0.0.1 only, at a random state path", async () => {
  const first = await startLoopbackReturn();
  const second = await startLoopbackReturn();
  try {
    const url = new URL(first.returnTo);
    assert.equal(url.protocol, "http:");
    assert.equal(url.hostname, "127.0.0.1");
    assert.ok(Number(url.port) >= 1024);
    assert.match(url.pathname, /^\/[A-Za-z0-9_-]{43}$/);
    assert.notEqual(first.returnTo, second.returnTo);
    // the server accepts exactly this shape (server/oidc-login.ts validLoopbackReturn)
    assert.match(first.returnTo, /^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}\/[A-Za-z0-9_-]{32,128}$/);
    // nothing on the other interfaces: [::1] on the same port is not this listener
    await assert.rejects(fetch(`http://[::1]:${url.port}${url.pathname}`, { signal: AbortSignal.timeout(2_000) }).then((res) => {
      if (res.status !== 200) throw new Error("not served");
    }));
  } finally {
    first.cancel();
    second.cancel();
  }
});

test("the loopback page says it is done in French and English and keeps the credential out of history", async () => {
  const back = await startLoopbackReturn();
  try {
    const page = await fetch(back.returnTo);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    assert.match(page.headers.get("content-security-policy"), /default-src 'none'; script-src 'nonce-/);
    const html = await page.text();
    assert.match(html, /Connexion réussie, vous pouvez revenir à Sagax/);
    assert.match(html, /Signed in\. You can return to Sagax/);
    assert.match(html, /history\.replaceState/);
    assert.doesNotMatch(html, /[\u2013\u2014]/);
  } finally {
    back.cancel();
  }
});

test("only the exact state, host and origin; the credential once; then the listener is closed", async () => {
  const back = await startLoopbackReturn();
  const url = new URL(back.returnTo);
  // another path, another state
  assert.equal((await fetch(`${url.origin}/`)).status, 404);
  assert.equal((await post(`${url.origin}/${"X".repeat(43)}`, `code=${CODE}`)).status, 404);
  // a page elsewhere posting here (no or another Origin)
  assert.equal((await post(back.returnTo, `code=${CODE}`, { origin: "https://evil.example" })).status, 403);
  // DNS rebinding: another Host header
  const rebound = await new Promise((resolve) => {
    import("node:http").then(({ request }) => {
      const req = request({ host: "127.0.0.1", port: url.port, path: url.pathname, method: "GET", headers: { host: `evil.example:${url.port}` } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.end();
    });
  });
  assert.equal(rebound, 404);
  // malformed bodies
  assert.equal((await post(back.returnTo, "code=not-a-credential")).status, 400);
  assert.equal((await post(back.returnTo, "error=<script>")).status, 400);
  assert.equal((await post(back.returnTo, "")).status, 400);
  assert.equal((await post(back.returnTo, `code=${"A".repeat(4096)}`)).status, 400);
  // the real one
  assert.equal((await post(back.returnTo, `code=${CODE}`)).status, 200);
  assert.deepEqual(await back.result, { code: CODE });
  // one shot: closed
  await assert.rejects(post(back.returnTo, `code=${CODE}`));
});

test("the listener logs each step and never the credential", async () => {
  const lines = [];
  const back = await startLoopbackReturn({ log: (line) => lines.push(line) });
  await fetch(back.returnTo);
  await post(back.returnTo, `code=${CODE}`);
  await back.result;
  assert.match(lines.join("\n"), /listener on 127\.0\.0\.1:\d+/);
  assert.match(lines.join("\n"), /page served/);
  assert.match(lines.join("\n"), /credential received/);
  assert.doesNotMatch(lines.join("\n"), new RegExp(CODE));
  assert.doesNotMatch(lines.join("\n"), new RegExp(new URL(back.returnTo).pathname.slice(1)));
});

test("a provider or server error comes back as an error, not a credential", async () => {
  const back = await startLoopbackReturn();
  assert.equal((await post(back.returnTo, "error=role")).status, 200);
  assert.deepEqual(await back.result, { error: "role" });
});

test("it times out, and it can be cancelled, closing the listener either way", async () => {
  const late = await startLoopbackReturn({ timeoutMs: 50 });
  assert.deepEqual(await late.result, { timeout: true });
  await assert.rejects(fetch(late.returnTo));
  const cancelled = await startLoopbackReturn();
  cancelled.cancel();
  assert.deepEqual(await cancelled.result, { cancelled: true });
  await assert.rejects(fetch(cancelled.returnTo));
  cancelled.cancel(); // twice is harmless
});

// ── the openmausbot:// fallback and the /pair handoff ──

const { parseAuthReturnLink } = require("./environments.cjs");
const CREDENTIAL = `omb_pair_${"A1b2_C3d4-".repeat(4)}xyz`;
const returnLink = (hash, origin = ORG) => `openmausbot://auth?origin=${encodeURIComponent(origin)}#${hash}`;

test("the system browser starts the desktop flow, with the loopback return when there is one", () => {
  assert.equal(desktopStartUrl(ORG), `${ORG}/auth/oidc/start?client=desktop`);
  const back = `http://127.0.0.1:53123/${"S".repeat(43)}`;
  const url = new URL(desktopStartUrl(ORG, back));
  assert.equal(url.origin + url.pathname, `${ORG}/auth/oidc/start`);
  assert.equal(url.searchParams.get("client"), "desktop");
  assert.equal(url.searchParams.get("return"), back);
  assert.equal(url.searchParams.get("fresh"), null);
  // "Sign in again" (2026-10-19): the page's fresh=1 rides to the server.
  assert.equal(oidcLoginStartUrl(`${ORG}/auth/oidc/start?fresh=1`, state), `${ORG}/auth/oidc/start?fresh=1`);
  assert.equal(new URL(desktopStartUrl(ORG, back, true)).searchParams.get("fresh"), "1");
});

test("a return link is honoured only for a saved server, with the credential in the hash", () => {
  assert.deepEqual(parseAuthReturnLink(returnLink(`code=${CREDENTIAL}`), state), { origin: ORG, code: CREDENTIAL });
  assert.deepEqual(parseAuthReturnLink(returnLink("error=role"), state), { origin: ORG, error: "role" });
  // a server this app never saved
  assert.equal(parseAuthReturnLink(returnLink(`code=${CREDENTIAL}`, "https://evil.example"), state), null);
  // the credential in the query
  assert.equal(parseAuthReturnLink(`openmausbot://auth?origin=${encodeURIComponent(ORG)}&code=${CREDENTIAL}`, state), null);
  // bad shapes
  assert.equal(parseAuthReturnLink(returnLink("code=omb_pair_short"), state), null);
  assert.equal(parseAuthReturnLink(returnLink(`code=${CREDENTIAL}&error=role`), state), null);
  assert.equal(parseAuthReturnLink(returnLink("error=<script>"), state), null);
  assert.equal(parseAuthReturnLink(returnLink(`code=${CREDENTIAL}`, `${ORG}/path`), state), null);
  assert.equal(parseAuthReturnLink(`openmausbot://auth?origin=${encodeURIComponent(ORG)}&origin=${encodeURIComponent(ORG)}#code=${CREDENTIAL}`, state), null);
  assert.equal(parseAuthReturnLink(`openmausbot://pair?origin=${encodeURIComponent(ORG)}#code=${CREDENTIAL}`, state), null);
  assert.equal(parseAuthReturnLink(`https://bot.example.test/?origin=${encodeURIComponent(ORG)}#code=${CREDENTIAL}`, state), null);
  assert.equal(parseAuthReturnLink(42, state), null);
});

test("the return lands on /pair to be redeemed once, or shows the error", () => {
  assert.equal(authReturnTarget({ origin: ORG, code: CREDENTIAL }, "n1"), `${ORG}/pair?signin=n1#code=${CREDENTIAL}&auto=1`);
  assert.equal(authReturnTarget({ origin: ORG, error: "role" }, "n1"), `${ORG}/pair?signin=n1#signin_error=role`);
  // The main window already shows <origin>/pair: a target that differed only
  // in its fragment would be a same-document navigation, and /pair would
  // never read the credential. Every target is a new document.
  const first = new URL(authReturnTarget({ origin: ORG, code: CREDENTIAL }));
  const second = new URL(authReturnTarget({ origin: ORG, code: CREDENTIAL }));
  assert.equal(first.pathname, "/pair");
  assert.match(first.search, /^\?signin=[A-Za-z0-9_-]{12}$/);
  assert.notEqual(first.search, second.search);
  assert.equal(redactedTarget(authReturnTarget({ origin: ORG, code: CREDENTIAL }, "n1")), `${ORG}/pair?signin=n1#code=<redacted>&auto=1`);
});

test("only the sign-in this app started, for ten minutes, once", () => {
  let clock = 1_000;
  const pending = createPendingSystemSignIn({ now: () => clock });
  assert.equal(pending.take(ORG), false); // nobody started one
  pending.begin(ORG);
  assert.equal(pending.take("https://other.example.test"), false);
  assert.equal(pending.take(ORG), true);
  assert.equal(pending.take(ORG), false); // once
  pending.begin(ORG);
  clock += SYSTEM_SIGN_IN_TTL_MS;
  assert.equal(pending.take(ORG), false); // expired
});

test("the /pair page may redeem a returned credential without asking only when this app handed it over, once, briefly", () => {
  let clock = 1_000;
  const handoff = createSignInHandoff({ now: () => clock });
  // a plain link somebody posted: nothing was handed over
  assert.equal(handoff.redeem(ORG, CREDENTIAL), false);
  handoff.accept({ origin: ORG, code: CREDENTIAL });
  assert.equal(handoff.redeem("https://other.example.test", CREDENTIAL), false);
  assert.equal(handoff.redeem(ORG, `omb_pair_${"Z".repeat(43)}`), false);
  assert.equal(handoff.redeem(ORG, 42), false);
  assert.equal(handoff.redeem(ORG, CREDENTIAL), true);
  assert.equal(handoff.redeem(ORG, CREDENTIAL), false); // once
  handoff.accept({ origin: ORG, code: CREDENTIAL });
  clock += SIGN_IN_HANDOFF_TTL_MS;
  assert.equal(handoff.redeem(ORG, CREDENTIAL), false); // expired
  // an error return hands nothing over
  handoff.accept({ origin: ORG, error: "role" });
  assert.equal(handoff.redeem(ORG, CREDENTIAL), false);
});
