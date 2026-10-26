// "Sign in with Pulsatrix" on a saved organization server, in the desktop app.
//
// The sign-in always runs in the person's own browser (RFC 8252), never in a
// window of this app: their password manager, their single sign-on and
// their passkeys (WebAuthn) live there. The server is the OIDC client
// (server/oidc-login.ts); no provider token is ever seen here.
//
// How the browser comes back to this app, in order of preference:
//
//   1. Loopback (RFC 8252 7.3): main listens once on 127.0.0.1, on an
//      ephemeral port, at a random path (the state), and starts
//      <origin>/auth/oidc/start?client=desktop&return=http://127.0.0.1:<port>/<state>.
//      The server ends on that address with #code=<credential> (or #error=),
//      the fragment no browser sends to a server. The page served there posts
//      the fragment back to the same address and tells the person they can
//      return to the app; the listener then closes. Only the exact state,
//      the exact Host and Origin, once, for ten minutes.
//   2. openmausbot://auth, only when this exact running app owns the scheme
//      and the server returns there (an older server with no loopback
//      return). Another installed copy of the app could own it otherwise.
//   3. Neither: no sign-in, and the app says why. There is no in-app
//      sign-in window any more.
//
// Either return then opens <origin>/pair#code=<credential>&auto=1 in the main
// window, which redeems it without asking only after the main process
// confirms the handoff (createSignInHandoff).
const crypto = require("node:crypto");
const http = require("node:http");

const OIDC_START_PATH = "/auth/oidc/start";
const SYSTEM_SIGN_IN_TTL_MS = 10 * 60_000;
const LOOPBACK_MAX_BODY_BYTES = 2048;
const CREDENTIAL = /^(?:sgx|omb)_pair_[A-Za-z0-9_-]{20,128}$/;
const ERROR_CODE = /^[a-z0-9_]{1,64}$/;

function activeOrigin(state) {
  const active = state?.environments?.find((entry) => entry.id === state.activeId);
  return active?.origin ?? null;
}

/** The sign-in start address when the main window is about to open it on the
 * selected saved server, else null (Local, another origin, another path). */
function oidcLoginStartUrl(url, state) {
  const origin = activeOrigin(state);
  if (!origin) return null;
  try {
    const target = new URL(url);
    return target.origin === origin && target.pathname === OIDC_START_PATH ? target.href : null;
  } catch {
    return null;
  }
}

/** The desktop sign-in's start address for the system browser, with the
 * loopback return when there is one. `fresh` is "Sign in again" (the page's
 * `?fresh=1`, src/lib/sign-in-again.ts): Perspicax asks for the factors
 * again (server/oidc-login.ts). */
function desktopStartUrl(origin, returnTo, fresh = false) {
  const url = new URL(OIDC_START_PATH, origin);
  url.searchParams.set("client", "desktop");
  if (returnTo) url.searchParams.set("return", returnTo);
  if (fresh) url.searchParams.set("fresh", "1");
  return url.href;
}

/** What the server's environment descriptor says about desktop returns. */
function signInSupport(descriptor) {
  const identity = descriptor && typeof descriptor === "object" ? descriptor.identity : null;
  const perspicax = Boolean(identity) && identity.kind === "perspicax";
  return {
    loopbackReturn: perspicax && identity.loopbackReturn === true,
    nativeReturn: perspicax && identity.nativeReturn === true,
    /** The server can end on sagax://auth when the start names it
     * (`return=<sagaxReturnLink>`); older servers end on openmausbot://auth. */
    sagaxReturn: perspicax && identity.nativeReturn === true
      && Array.isArray(identity.nativeReturnSchemes) && identity.nativeReturnSchemes.includes("sagax"),
  };
}

/** The scheme return a desktop start names on a server that offers sagax://
 * (server/oidc-login.ts sagaxReturnLink: the same string, compared exactly). */
function sagaxReturnLink(origin) {
  return `sagax://auth?origin=${encodeURIComponent(origin)}`;
}

/** The app bundle (macOS) or executable (Windows, Linux) of this process,
 * the way the system names a protocol handler. */
function appHandlerPath(execPath, platform) {
  if (typeof execPath !== "string" || !execPath) return null;
  if (platform === "darwin") {
    const at = execPath.indexOf(".app/");
    return at === -1 ? null : execPath.slice(0, at + 4);
  }
  return execPath;
}

/** Whether openmausbot:// links reach this exact running app, not another
 * installed copy (the dev build next to /Applications/Sagax.app, say).
 * `handlerPath` is what the system reports for the scheme, null when it
 * cannot say (then only isDefaultProtocolClient decides, on Linux). */
function ownsScheme({ isDefault, handlerPath, appPath, platform }) {
  if (!isDefault) return false;
  if (platform !== "darwin" && platform !== "win32") return true;
  if (!handlerPath || !appPath) return false;
  const norm = (value) => String(value).replace(/[\\/]+$/, "");
  return platform === "win32"
    ? norm(handlerPath).toLowerCase() === norm(appPath).toLowerCase()
    : norm(handlerPath) === norm(appPath);
}

/** How this sign-in comes back: "loopback", "scheme" or "unsupported". */
function chooseReturnPath({ loopbackReturn, loopbackReady, nativeReturn, ownsScheme: owns }) {
  if (loopbackReturn && loopbackReady) return "loopback";
  if (nativeReturn && owns) return "scheme";
  return "unsupported";
}

/** The one openmausbot:// sign-in this app is waiting for (fallback 2). */
function createPendingSystemSignIn({ now = Date.now } = {}) {
  let pending = null;
  return {
    begin(origin) {
      pending = { origin, startedAt: now() };
    },
    clear() {
      pending = null;
    },
    /** True once, for a fresh return from the origin that was started. */
    take(origin) {
      const current = pending;
      if (!current || now() - current.startedAt >= SYSTEM_SIGN_IN_TTL_MS) {
        pending = null;
        return false;
      }
      if (current.origin !== origin) return false;
      pending = null;
      return true;
    },
  };
}

/** How long /pair has to claim a credential the app just handed it. */
const SIGN_IN_HANDOFF_TTL_MS = 60_000;

/** The credential this app just loaded into /pair from an honoured return.
 * /pair redeems a credential without asking only when this confirms it
 * (preload takeSignInReturn): the same origin, that exact credential, once,
 * within a minute. A /pair#code=...&auto=1 link opened any other way gets
 * the ordinary code form. */
function createSignInHandoff({ now = Date.now } = {}) {
  let handed = null;
  return {
    accept(parsed) {
      handed = parsed && typeof parsed.code === "string" ? { origin: parsed.origin, code: parsed.code, at: now() } : null;
    },
    redeem(origin, code) {
      const current = handed;
      if (!current || typeof code !== "string") return false;
      if (now() - current.at >= SIGN_IN_HANDOFF_TTL_MS) {
        handed = null;
        return false;
      }
      if (current.origin !== origin || current.code !== code) return false;
      handed = null;
      return true;
    },
  };
}

/** Where the main window goes for a returned credential or error. The
 * window usually already shows <origin>/pair (the server sends a browser
 * without a session there): loading /pair#code=... on it would only be a
 * same-document fragment change, so /pair would never read the credential.
 * A fresh `?signin=<nonce>` makes it a new document every time. */
function authReturnTarget(parsed, nonce = crypto.randomBytes(9).toString("base64url")) {
  const base = `${parsed.origin}/pair?signin=${encodeURIComponent(nonce)}`;
  return "code" in parsed ? `${base}#code=${parsed.code}&auto=1` : `${base}#signin_error=${encodeURIComponent(parsed.error)}`;
}

/** The return target with the credential masked, for logs. */
function redactedTarget(target) {
  return String(target).replace(/#code=[^&]*/, "#code=<redacted>");
}

/** The page the browser shows on the loopback address. Its script posts the
 * fragment back to the same address, then says how it went, in French and
 * English. Nothing else loads (CSP with a per-page nonce). */
function loopbackPage(nonce) {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Sagax</title>
<style nonce="${nonce}">
:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:Canvas;color:CanvasText}
main{max-width:420px;padding:24px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:4px 0;font-size:14px;opacity:.8}
[hidden]{display:none}
</style></head><body><main>
<section id="wait"><h1>Connexion en cours...</h1><p lang="en">Finishing sign-in...</p></section>
<section id="ok" hidden><h1>Connexion réussie, vous pouvez revenir à Sagax.</h1><p lang="en">Signed in. You can return to Sagax.</p></section>
<section id="fail" hidden><h1>La connexion n'a pas abouti.</h1><p>Revenez à Sagax pour voir pourquoi ou réessayer.</p><p lang="en">Sign-in did not finish. Return to Sagax to see why or try again.</p></section>
<noscript><p>JavaScript est requis pour terminer la connexion. / JavaScript is required to finish signing in.</p></noscript>
</main><script nonce="${nonce}">
(function () {
  var hash = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  var params = new URLSearchParams(hash);
  var body = new URLSearchParams();
  if (params.get("code")) body.set("code", params.get("code"));
  else if (params.get("error")) body.set("error", params.get("error"));
  function show(id) {
    document.getElementById("wait").hidden = true;
    document.getElementById(id).hidden = false;
  }
  if (!body.toString()) { show("fail"); return; }
  fetch(location.pathname, { method: "POST", body: body, credentials: "omit", cache: "no-store" })
    .then(function (res) { show(res.ok && body.has("code") ? "ok" : "fail"); })
    .catch(function () { show("fail"); });
})();
</script></body></html>`;
}

function readBody(req, max) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk) => {
      if (over) return;
      size += chunk.length;
      if (size > max) {
        over = true;
        resolve(null);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!over) resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", () => resolve(null));
  });
}

/** Listen once on 127.0.0.1 for a sign-in's return. Resolves, once listening,
 * to `{ returnTo, result, cancel }`: `result` settles once with `{ code }`,
 * `{ error }`, `{ timeout: true }` or `{ cancelled: true }`, and the listener
 * is closed by then. */
function startLoopbackReturn({ timeoutMs = SYSTEM_SIGN_IN_TTL_MS, log = () => {}, createServer = http.createServer, randomBytes = crypto.randomBytes } = {}) {
  const state = randomBytes(32).toString("base64url");
  let settle;
  const result = new Promise((resolve) => { settle = resolve; });
  let done = false;
  let timer = null;
  const server = createServer();
  const close = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    server.close();
    server.closeAllConnections?.();
  };
  const finish = (outcome) => {
    if (done) return;
    done = true;
    close();
    settle(outcome);
  };
  return new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (!server.listening) reject(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const self = `127.0.0.1:${port}`;
      const path = `/${state}`;
      server.on("request", (req, res) => {
        const answer = (status, type, body, extra = {}) => {
          res.writeHead(status, {
            "content-type": type,
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
            "x-content-type-options": "nosniff",
            "x-frame-options": "DENY",
            ...extra,
          });
          res.end(body);
        };
        // DNS rebinding and stray requests: this exact host and path only.
        if (done || req.headers.host !== self || req.url !== path) {
          log(`sign-in listener refused a ${req.method} (${done ? "already done" : req.headers.host !== self ? "another host" : "another path"})`);
          req.resume();
          answer(404, "text/plain; charset=utf-8", "Not found");
          return;
        }
        if (req.method === "GET") {
          const nonce = crypto.randomBytes(16).toString("base64");
          log("sign-in listener: the browser came back, page served");
          answer(200, "text/html; charset=utf-8", loopbackPage(nonce), {
            "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
          });
          return;
        }
        if (req.method !== "POST" || req.headers.origin !== `http://${self}`) {
          log(`sign-in listener refused a ${req.method} (${req.method === "POST" ? "another origin" : "method"})`);
          req.resume();
          answer(req.method === "POST" ? 403 : 405, "text/plain; charset=utf-8", "Refused");
          return;
        }
        void readBody(req, LOOPBACK_MAX_BODY_BYTES).then((raw) => {
          const form = new URLSearchParams(raw ?? "");
          const code = form.get("code");
          const error = form.get("error");
          let outcome = null;
          if (code && CREDENTIAL.test(code)) outcome = { code };
          else if (!code && error && ERROR_CODE.test(error)) outcome = { error };
          if (!outcome || done) {
            log("sign-in listener refused a malformed return");
            answer(400, "text/plain; charset=utf-8", "Refused");
            return;
          }
          log(outcome.code ? "sign-in listener: credential received" : `sign-in listener: error received (${outcome.error})`);
          res.once("finish", () => finish(outcome));
          answer(200, "application/json", "{}");
        });
      });
      log(`sign-in listener on 127.0.0.1:${port}`);
      timer = setTimeout(() => {
        log("the browser sign-in timed out");
        finish({ timeout: true });
      }, timeoutMs);
      timer.unref?.();
      resolve({
        returnTo: `http://${self}${path}`,
        result,
        cancel: () => {
          if (!done) log("sign-in listener cancelled");
          finish({ cancelled: true });
        },
      });
    });
  });
}

module.exports = {
  OIDC_START_PATH,
  SIGN_IN_HANDOFF_TTL_MS,
  SYSTEM_SIGN_IN_TTL_MS,
  appHandlerPath,
  authReturnTarget,
  chooseReturnPath,
  createPendingSystemSignIn,
  createSignInHandoff,
  desktopStartUrl,
  loopbackPage,
  oidcLoginStartUrl,
  ownsScheme,
  redactedTarget,
  sagaxReturnLink,
  signInSupport,
  startLoopbackReturn,
};
