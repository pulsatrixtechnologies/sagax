// The main window never shows a bare error page of its own app.
//
// 2026-10-19 (Windows, after an update): Sagax came back on a black window
// with only "Not Found" at the top left. The page asked for was answered
// with an error while the app's files were not all in place yet: the
// person (or Windows) opened Sagax while the silent installer was still
// copying them, and the window showed whatever the first answer was.
//
// Two guards, both pure here so node:test covers them:
//
// - At start (packaged app), `uiBundleState` checks that the UI bundle is
//   whole (Resources/ui/index.html and every /assets/ file it names, the
//   server's entry). While it is not, the loading screen says an update is
//   being installed and waits (`waitForUiBundle`), then fails readably with
//   Retry instead of opening a window on missing files.
// - Afterwards, a main-frame load of this app's page that answers an HTTP
//   error or fails to connect is retried with a growing delay
//   (`createLoadRecovery`) behind a branded loading page, then replaced by a
//   branded error page with "Try again". Never the raw answer.
import fs from "node:fs";
import path from "node:path";

/** The waits between attempts; after the last one, the error page. */
export const RETRY_DELAYS_MS = Object.freeze([1_000, 2_000, 4_000, 8_000, 15_000]);

/** Chromium's net errors that mean "nobody answered yet / the file is not
 * there yet": worth a retry. -3 (aborted by a newer navigation) never is. */
const RETRYABLE_NET_ERRORS = new Set([
  -2, // FAILED
  -6, // FILE_NOT_FOUND
  -7, // TIMED_OUT
  -15, // SOCKET_NOT_CONNECTED
  -21, // NETWORK_CHANGED
  -100, // CONNECTION_CLOSED
  -101, // CONNECTION_RESET
  -102, // CONNECTION_REFUSED
  -104, // CONNECTION_FAILED
  -105, // NAME_NOT_RESOLVED (localhost on a broken resolver)
  -106, // INTERNET_DISCONNECTED
  -118, // CONNECTION_TIMED_OUT
  -324, // EMPTY_RESPONSE
  -379, // HTTP_RESPONSE_CODE_FAILURE: an HTTP error with an empty body
]);

/** Whether a main-frame load of `url` is this app's page (not the API, not
 * a file): the only loads this guard takes over. */
export function isAppPage(url, origins) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (!origins.includes(target.origin)) return false;
  const pathname = target.pathname;
  if (pathname.startsWith("/api/") || pathname.startsWith("/auth/") || pathname.startsWith("/.well-known/")) return false;
  return !path.posix.extname(pathname);
}

/** "ok", "retry" or "ignore" for one main-frame load result. */
export function loadOutcome({ httpStatus, errorCode } = {}) {
  if (typeof errorCode === "number" && errorCode !== 0) return RETRYABLE_NET_ERRORS.has(errorCode) ? "retry" : "ignore";
  if (typeof httpStatus === "number" && httpStatus >= 400) {
    // 401/403: a sign-in or a refusal the page itself explains.
    return httpStatus === 401 || httpStatus === 403 ? "ignore" : "retry";
  }
  return "ok";
}

/**
 * One window's recovery. `next()` after a failed load: { kind: "retry",
 * delayMs } while attempts remain, then { kind: "give-up" } (and from then
 * on until `reset()`, which a successful load or the person's "Try again"
 * calls).
 */
export function createLoadRecovery({ delays = RETRY_DELAYS_MS } = {}) {
  let attempt = 0;
  return {
    next() {
      if (attempt >= delays.length) return { kind: "give-up", attempts: attempt };
      const delayMs = delays[attempt];
      attempt += 1;
      return { kind: "retry", delayMs, attempt };
    },
    reset() {
      attempt = 0;
    },
    get attempts() {
      return attempt;
    },
  };
}

const STRINGS = {
  fr: {
    loading: "Ouverture de Sagax…",
    installing: "Installation de la mise à jour en cours…",
    errorTitle: "Sagax n'a pas pu s'ouvrir",
    errorBody: "La page de Sagax ne répond pas encore. Si une mise à jour vient de s'installer, attendez qu'elle se termine, puis réessayez.",
    retry: "Réessayer",
    bundleTitle: "La mise à jour n'est pas terminée",
    bundleBody: "Des fichiers de Sagax manquent encore. Si l'installateur est ouvert, laissez-le finir. Sinon, réinstallez Sagax depuis la dernière version.",
  },
  en: {
    loading: "Opening Sagax…",
    installing: "Installing the update…",
    errorTitle: "Sagax could not open",
    errorBody: "Sagax's page is not answering yet. If an update was just installed, let it finish, then try again.",
    retry: "Try again",
    bundleTitle: "The update has not finished",
    bundleBody: "Some of Sagax's files are still missing. If the installer is open, let it finish. Otherwise, reinstall Sagax from the latest version.",
  },
};

/** The texts for a language ("fr" or "en"). */
export function recoveryStrings(language) {
  return STRINGS[language] ?? STRINGS.en;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

// The loading screen's look (electron/startup-screen.mjs): night ground,
// the mark, one line. No script; the retry is a plain link to the page.
function page({ language, iconDataUrl, body }) {
  const icon = iconDataUrl ? `<img src="${escapeHtml(iconDataUrl)}" alt="" width="64" height="64" style="margin-bottom:16px">` : "";
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="${language === "fr" ? "fr" : "en"}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>Sagax</title><style>
html,body{margin:0;height:100%;background:#111214;color:#f5f5f5;font:14px "Segoe UI",system-ui,-apple-system,sans-serif}
main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 24px;background:radial-gradient(ellipse at 50% 22%,#242529 0,#161719 54%,#111214 100%)}
h1{font-size:20px;font-weight:600;margin:0 0 8px}p{margin:0 0 18px;max-width:380px;color:#c9ccd2;line-height:1.5}
.status{display:flex;align-items:center;gap:9px;color:#999da5;font-size:13px}
.spinner{width:13px;height:13px;border-radius:50%;border:1.5px solid #ffffff21;border-top-color:#a6c9ff;animation:spin .9s linear infinite}
a{display:inline-block;padding:7px 14px;border-radius:999px;color:#111214;background:#a6c9ff;text-decoration:none;font-weight:600}a:focus-visible{outline:2px solid #1686ff;outline-offset:2px}
@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation:none}}
</style></head><body><main>${icon}${body}</main></body></html>`)}`;
}

/** The page shown between two attempts. */
export function loadingPage({ language = "en", iconDataUrl = null } = {}) {
  const strings = recoveryStrings(language);
  return page({ language, iconDataUrl, body: `<div class="status" role="status"><span class="spinner" aria-hidden="true"></span><span>${escapeHtml(strings.loading)}</span></div>` });
}

/** The page shown once the attempts are spent; "Try again" reloads `retryUrl`. */
export function loadErrorPage({ language = "en", iconDataUrl = null, retryUrl } = {}) {
  const strings = recoveryStrings(language);
  return page({
    language,
    iconDataUrl,
    body: `<h1>${escapeHtml(strings.errorTitle)}</h1><p>${escapeHtml(strings.errorBody)}</p><a href="${escapeHtml(retryUrl)}" autofocus>${escapeHtml(strings.retry)}</a>`,
  });
}

/** The files `index.html` names under /assets/ (scripts, styles, preloads). */
export function referencedAssets(html) {
  const assets = new Set();
  for (const match of String(html).matchAll(/(?:src|href)="\/(assets\/[^"?#]+)"/g)) assets.add(match[1]);
  return [...assets];
}

/**
 * Whether the packaged app's files are all there: the UI page, every asset it
 * names, and the server's entry. `exists` and `readFile` are injected.
 */
export function uiBundleState({ resourcesPath, exists = fs.existsSync, readFile = (file) => fs.readFileSync(file, "utf8"), serverEntry = path.join("server", "desktop-entry.mjs") }) {
  const ui = path.join(resourcesPath, "ui");
  const missing = [];
  let html = null;
  try {
    html = readFile(path.join(ui, "index.html"));
  } catch {
    missing.push("ui/index.html");
  }
  if (html !== null) {
    for (const asset of referencedAssets(html)) {
      if (!exists(path.join(ui, ...asset.split("/")))) missing.push(`ui/${asset}`);
    }
  }
  if (serverEntry && !exists(path.join(resourcesPath, serverEntry))) missing.push(serverEntry.split(path.sep).join("/"));
  return { complete: missing.length === 0, missing };
}

/**
 * Waits for a whole bundle: checks now, then every `intervalMs` until
 * `timeoutMs`. `onWaiting(state)` fires once, when the first check finds a
 * hole (the loading screen then says an update is being installed).
 */
export async function waitForUiBundle({ check, intervalMs = 2_000, timeoutMs = 180_000, onWaiting, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now }) {
  const started = now();
  let state = check();
  if (state.complete) return { ...state, waited: false };
  onWaiting?.(state);
  while (now() - started < timeoutMs) {
    await sleep(intervalMs);
    state = check();
    if (state.complete) return { ...state, waited: true };
  }
  return { ...state, waited: true };
}
