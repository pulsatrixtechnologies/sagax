// Settings > Security: a person's security keys and passkeys, the classes of
// approval that need one, and the step-up ceremonies (server/auth/security-keys.ts,
// shared/step-up.ts).
//
//   GET    /api/security-keys                    -> SecurityKeysState
//   PUT    /api/security-keys/classes            { classes, stepUp? }
//   POST   /api/security-keys/register           { name, via?, stepUp? } -> ceremony
//   DELETE /api/security-keys/:id                { stepUp }
//   POST   /api/security-keys/begin              { target, via? } -> ceremony
//   POST   /api/security-keys/approval-mode      { botId, op, thread, mode, stepUp? }
//          a looser approval level the desktop's trusted channel will apply:
//          the step-up is used here and returns a one-time `allowance` id,
//          bound to that operation, which the channel's request carries
//
// Public (`securityKeyCeremonyRoutes`, before the auth gate): the ceremony id
// (32 random bytes, two minutes, one answer) is the authorization, as the
// MCP sign-in callback's state is. The answer itself is verified against the
// person's own key, so holding an id is not enough to sign anything.
//
//   GET    /api/security-keys/ceremony/:id       -> { kind, options, label }
//   GET    /api/security-keys/ceremony/:id/page  -> the page that runs it
//   GET    /api/security-keys/ceremony/:id/status -> { status }: waiting,
//          done, failed or expired (the desktop app runs the page in the
//          system browser and asks here how it ended)
//   POST   /api/security-keys/ceremony/:id       { response }
//
// Every route is the caller's own: their keys and classes. A local service
// or a bot acting for a person is never a person here (`person` is null).
// Loosening needs the key the person already has: removing a key, removing
// a class, or adding another key once one exists.

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

import type { RequestAuth } from "../auth/request-auth.ts";
import { isLoopbackHost, isProxied, requestOrigin } from "../auth/request-auth.ts";
import { grantDigest, type SecurityKeys } from "../auth/security-keys.ts";
import {
  STEP_UP_CLASSES,
  canonicalJson,
  isStepUpClass,
  isStepUpSettingsAction,
  usableRpId,
  type SecurityKeysState,
  type StepUpClass,
  type StepUpRefusal,
  type StepUpSettingsAction,
  type StepUpTarget,
} from "../../shared/step-up.ts";
import { PASS, type RouteHandler } from "./table.ts";

const CEREMONY_ID = /^[A-Za-z0-9_-]{43}$/;

export interface SecurityKeyRouteDeps {
  keys: SecurityKeys;
  /** The person on this request, or null (a local service, a bot). */
  person: (auth: RequestAuth) => string | null;
  /** A name the authenticator shows for this person's keys. */
  userName: (auth: RequestAuth) => string;
  /** The grants and words of a step-up for a waiting card, computed from
   * the live card; or why there is none. */
  approvalGrants: (auth: RequestAuth, person: string, target: Extract<StepUpTarget, { kind: "approval" }>) =>
    { grants: string[]; label: string; summary?: string } | { status: number; error: string };
  /** A looser approval level asked ahead of the desktop's trusted channel:
   * null when it needs no key or the step-up was used (an allowance is
   * left), else the refusal. */
  authorizeApprovalMode: (auth: RequestAuth, person: string, input: { botId: string; op: string; thread: string; mode: string; stepUp: unknown }) =>
    { status: number; body: unknown };
  /** The first key: a sign-in this recent (a session's age), or this
   * computer's own person. */
  recentSignIn: (auth: RequestAuth) => boolean;
  audit: (row: { action: string; personId: string; after?: Record<string, unknown>; before?: Record<string, unknown> }, auth: RequestAuth) => void;
  /** Pinned RP ID and origins (SAGAX_WEBAUTHN_RP_ID, SAGAX_WEBAUTHN_ORIGINS). */
  env?: NodeJS.ProcessEnv;
}

/** The grant a settings change is authorized by: the action and its exact
 * detail. A route computes it from the request it is about to apply. */
export function settingsGrant(action: StepUpSettingsAction, detail: Record<string, unknown>): string {
  return grantDigest(["settings", action, canonicalJson(detail)]);
}

/** The RP ID and origins a ceremony started by this request uses, or null.
 * `desktop-window`: the desktop app on this computer, whose page is on
 * 127.0.0.1 (never an RP ID): its key runs in a small window on localhost. */
export function relyingParty(req: IncomingMessage, via: unknown, env: NodeJS.ProcessEnv = process.env): { rpId: string; origins: string[] } | null {
  const pinned = env.SAGAX_WEBAUTHN_RP_ID?.trim().toLowerCase();
  const host = typeof req.headers.host === "string" ? req.headers.host : undefined;
  const local = isLoopbackHost(host) && !isProxied(req);
  if (via === "desktop-window") {
    if (!local || !host) return null;
    const port = /:(\d{1,5})$/.exec(host)?.[1];
    return port ? { rpId: "localhost", origins: [`http://localhost:${port}`] } : null;
  }
  if (pinned) {
    const origins = (env.SAGAX_WEBAUTHN_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    return { rpId: pinned, origins: origins.length ? origins : [`https://${pinned}`] };
  }
  const origin = requestOrigin(req);
  if (!origin) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const rpId = usableRpId(url.hostname, url.protocol);
  if (!rpId) return null;
  if (rpId === "localhost" && !local) return null;
  return { rpId, origins: [url.origin] };
}

function refusal(body: StepUpRefusal): StepUpRefusal {
  return body;
}

/** A settings change that needs the person's key: null when it may go on
 * (and its grant was used), else the refusal to answer. */
export function settingsStepUp(
  keys: SecurityKeys,
  person: string | null,
  action: StepUpSettingsAction,
  detail: Record<string, unknown>,
  stepUp: unknown,
  classes: readonly StepUpClass[],
): { status: number; body: StepUpRefusal } | null {
  const target: StepUpTarget = { kind: "settings", action, detail };
  if (!person) return null;
  if (stepUp === undefined || stepUp === null || stepUp === "") {
    return { status: 403, body: refusal({ error: "Confirm this change with your security key.", code: "step_up_required", classes: [...classes], target }) };
  }
  const used = keys.consume(stepUp, person, settingsGrant(action, detail));
  if (used.ok) return null;
  return { status: 403, body: refusal({ error: "Your security key did not confirm this change. Try again.", code: "step_up_failed", classes: [...classes], reason: used.reason, target }) };
}

function state(deps: SecurityKeyRouteDeps, person: string, req: IncomingMessage, auth: RequestAuth): SecurityKeysState {
  const rp = relyingParty(req, undefined, deps.env);
  return {
    keys: deps.keys.keys(person),
    classes: deps.keys.store.classes(person),
    rpId: rp?.rpId ?? null,
    ...(deps.keys.store.unreadable ? { unreadable: true } : {}),
    // the first key asks for a fresh sign-in: say so before the person tries
    ...(!deps.keys.hasKey(person) && !deps.recentSignIn(auth) ? { needsSignIn: true } : {}),
  };
}

function ceremonyAnswer(start: { ceremonyId: string; options: Record<string, unknown>; expiresAt: number }, kind: "register" | "assert", rpId: string) {
  return {
    ceremonyId: start.ceremonyId,
    kind,
    rpId,
    options: start.options,
    expiresAt: start.expiresAt,
    pageUrl: `/api/security-keys/ceremony/${start.ceremonyId}/page`,
  };
}

export function createSecurityKeyRoutes(deps: SecurityKeyRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/security-keys")) return PASS;
    if (path.startsWith("/api/security-keys/ceremony/")) return PASS;
    res.setHeader("cache-control", "no-store");
    const me = deps.person(auth);
    if (!me) return json(res, 403, { error: "Sign in to manage your security keys." });

    if (path === "/api/security-keys") {
      if (method !== "GET") return json(res, 405, { error: "GET only" });
      return json(res, 200, state(deps, me, req, auth));
    }

    if (path === "/api/security-keys/classes") {
      if (method !== "PUT") return json(res, 405, { error: "PUT only" });
      const body = await readBody(req);
      if (!body || typeof body !== "object" || !Array.isArray(body.classes) || body.classes.some((value: unknown) => !isStepUpClass(value))) {
        return json(res, 400, { error: `classes must be a list of: ${STEP_UP_CLASSES.join(", ")}` });
      }
      const next = STEP_UP_CLASSES.filter((name) => (body.classes as unknown[]).includes(name));
      const before = deps.keys.store.classes(me);
      const hasKey = deps.keys.hasKey(me);
      if (next.some((name) => !before.includes(name)) && !hasKey) {
        return json(res, 409, { error: "Add a security key first.", code: "no_key" });
      }
      // Taking a protection away needs the key that protects it.
      if (hasKey && before.some((name) => !next.includes(name))) {
        const refused = settingsStepUp(deps.keys, me, "security-keys.classes", { classes: next }, body.stepUp, before.filter((name) => !next.includes(name)));
        if (refused) return json(res, refused.status, refused.body);
      }
      deps.keys.setClasses(me, next);
      deps.audit({ action: "security_keys.classes", personId: me, before: { classes: before }, after: { classes: next } }, auth);
      return json(res, 200, state(deps, me, req, auth));
    }

    if (path === "/api/security-keys/register") {
      if (method !== "POST") return json(res, 405, { error: "POST only" });
      const body = (await readBody(req)) ?? {};
      const rp = relyingParty(req, body.via, deps.env);
      if (!rp) return json(res, 400, { error: "Security keys need this page on https or on this computer.", code: "no_rp" });
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
      if (deps.keys.hasKey(me)) {
        // bound to this key's name and address: a step-up for another add
        // does not count
        const refused = settingsStepUp(deps.keys, me, "security-keys.add", { name: name || "Security key", rpId: rp.rpId }, body.stepUp, []);
        if (refused) return json(res, refused.status, refused.body);
      } else if (!deps.recentSignIn(auth)) {
        return json(res, 403, { error: "Sign in again, then add your first key.", code: "reauth_required" });
      }
      deps.audit({ action: "security_keys.add-started", personId: me, after: { rpId: rp.rpId, first: !deps.keys.hasKey(me) } }, auth);
      const start = await deps.keys.beginRegistration(me, { rpId: rp.rpId, origins: rp.origins, name: name || "Security key", userName: deps.userName(auth), label: "register" });
      return json(res, 200, ceremonyAnswer(start, "register", rp.rpId));
    }

    if (path === "/api/security-keys/begin") {
      if (method !== "POST") return json(res, 405, { error: "POST only" });
      const body = (await readBody(req)) ?? {};
      const target = body.target as StepUpTarget | undefined;
      const rp = relyingParty(req, body.via, deps.env);
      if (!rp) return json(res, 400, { error: "Security keys need this page on https or on this computer.", code: "no_rp" });
      let grants: string[];
      let label: string;
      let summary: string | undefined;
      if (target && target.kind === "approval" && typeof target.threadId === "string" && typeof target.requestId === "string") {
        const found = deps.approvalGrants(auth, me, target);
        if ("error" in found) return json(res, found.status, { error: found.error });
        ({ grants, label } = found);
        summary = found.summary;
      } else if (target && target.kind === "settings" && isStepUpSettingsAction(target.action) && target.detail && typeof target.detail === "object" && !Array.isArray(target.detail)) {
        grants = [settingsGrant(target.action, target.detail)];
        label = target.action;
        summary = canonicalJson(target.detail).slice(0, 300);
      } else {
        return json(res, 400, { error: "target must name a waiting approval or a settings change" });
      }
      const start = await deps.keys.beginAssertion(me, { rpId: rp.rpId, origins: rp.origins, grants, label, ...(summary ? { summary } : {}) });
      if ("error" in start) {
        return json(res, 409, { error: "You have no security key for this address. Add one in Settings > Security.", code: "no_key", rpId: rp.rpId });
      }
      return json(res, 200, ceremonyAnswer(start, "assert", rp.rpId));
    }

    if (path === "/api/security-keys/approval-mode") {
      if (method !== "POST") return json(res, 405, { error: "POST only" });
      const body = (await readBody(req)) ?? {};
      if (typeof body.botId !== "string" || !/^[\w-]{1,128}$/.test(body.botId) || typeof body.thread !== "string" || !/^(?:\*|[\w-]{1,128})$/.test(body.thread) || typeof body.mode !== "string") {
        return json(res, 400, { error: "botId, thread and mode are required" });
      }
      const answer = deps.authorizeApprovalMode(auth, me, { botId: body.botId, op: typeof body.op === "string" ? body.op : "", thread: body.thread, mode: body.mode, stepUp: body.stepUp });
      return json(res, answer.status, answer.body);
    }

    const item = /^\/api\/security-keys\/([A-Za-z0-9_-]{1,1400})$/.exec(path);
    if (item) {
      if (method !== "PATCH" && method !== "DELETE") return json(res, 405, { error: "PATCH or DELETE" });
      const id = item[1]!;
      if (!deps.keys.store.credentials(me).some((credential) => credential.id === id)) return json(res, 404, { error: "no such key" });
      // #1545: a new name only, the person's own key (nothing it protects changes)
      if (method === "PATCH") {
        const body = (await readBody(req)) ?? {};
        if (typeof body.name !== "string" || !body.name.trim()) return json(res, 400, { error: "send { name }" });
        deps.keys.store.renameCredential(me, id, body.name);
        deps.audit({ action: "security_keys.rename", personId: me, after: { key: id.slice(0, 16) } }, auth);
        return json(res, 200, state(deps, me, req, auth));
      }
      if (method !== "DELETE") return json(res, 405, { error: "PATCH or DELETE" });
      const body = (await readBody(req)) ?? {};
      const refused = settingsStepUp(deps.keys, me, "security-keys.remove", { id }, body.stepUp, []);
      if (refused) return json(res, refused.status, refused.body);
      deps.keys.store.removeCredential(me, id);
      deps.audit({ action: "security_keys.remove", personId: me, before: { key: id.slice(0, 16) } }, auth);
      return json(res, 200, state(deps, me, req, auth));
    }
    return json(res, 404, { error: "not found" });
  };
}

// ── the public ceremony routes ─────────────────────────────────────────

function send(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(body));
  return true;
}

async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > limit) throw Object.assign(new Error("too large"), { status: 413 });
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

const PAGE_WORDS = {
  en: {
    title: "Security key",
    register: "Touch your security key, or use your passkey, to add it to Sagax.",
    assert: "Touch your security key, or use your passkey, to confirm.",
    start: "Continue",
    ok: "Done. You can close this window and go back to Sagax.",
    failed: "The security key did not answer. Close this window and try again.",
    expired: "This request has expired. Close this window and start again.",
    unsupported: "This browser cannot use security keys.",
    digest: "Check:",
  },
  fr: {
    title: "Clé de sécurité",
    register: "Touchez votre clé de sécurité, ou utilisez votre clé d'accès, pour l'ajouter à Sagax.",
    assert: "Touchez votre clé de sécurité, ou utilisez votre clé d'accès, pour confirmer.",
    start: "Continuer",
    ok: "C'est fait. Vous pouvez fermer cette fenêtre et revenir à Sagax.",
    failed: "La clé de sécurité n'a pas répondu. Fermez cette fenêtre et réessayez.",
    expired: "Cette demande a expiré. Fermez cette fenêtre et recommencez.",
    unsupported: "Ce navigateur ne peut pas utiliser de clé de sécurité.",
    digest: "Vérification :",
  },
} as const;

/** The return address of the phone app's sheet: fixed, never a parameter. */
export const PHONE_RETURN = "sagax://security-key-done";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** The page: one button (a user gesture, which Safari needs before a
 * passkey prompt), then the browser's own WebAuthn call. Its end is its
 * title (the desktop window reads it) and, for the phone, the app address. */
export function ceremonyPage(input: { id: string; kind: "register" | "assert"; language?: string; phone: boolean; label?: string; summary?: string; digest?: string }): { html: string; nonce: string } {
  const nonce = randomBytes(16).toString("base64");
  const words = /^fr\b/i.test(input.language ?? "") ? PAGE_WORDS.fr : PAGE_WORDS.en;
  const config = JSON.stringify({ id: input.id, kind: input.kind, phone: input.phone, back: PHONE_RETURN, words }).replace(/</g, "\\u003c");
  const script = `
const C = ${config};
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
const unb64 = (text) => { const s = text.replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(s + "===".slice((s.length + 3) % 4)); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };
const status = document.getElementById("status");
const button = document.getElementById("go");
function finish(ok, code) {
  document.title = ok ? "sagax-security-key:ok" : "sagax-security-key:error:" + (code || "failed");
  status.textContent = ok ? C.words.ok : (code === "expired" ? C.words.expired : C.words.failed);
  button.hidden = true;
  if (C.phone) location.href = C.back + "?status=" + (ok ? "ok" : "error") + "&ceremony=" + encodeURIComponent(C.id);
}
async function run() {
  button.disabled = true;
  try {
    if (!window.PublicKeyCredential || !navigator.credentials) { status.textContent = C.words.unsupported; return finish(false, "unsupported"); }
    const got = await fetch("/api/security-keys/ceremony/" + C.id, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (!got.ok) return finish(false, "expired");
    const { options } = await got.json();
    let credential;
    if (C.kind === "register") {
      const publicKey = { ...options, challenge: unb64(options.challenge), user: { ...options.user, id: unb64(options.user.id) },
        excludeCredentials: (options.excludeCredentials || []).map((c) => ({ ...c, id: unb64(c.id) })) };
      credential = await navigator.credentials.create({ publicKey });
    } else {
      const publicKey = { ...options, challenge: unb64(options.challenge), allowCredentials: (options.allowCredentials || []).map((c) => ({ ...c, id: unb64(c.id) })) };
      credential = await navigator.credentials.get({ publicKey });
    }
    if (!credential) return finish(false, "cancelled");
    const r = credential.response;
    const response = C.kind === "register"
      ? { id: credential.id, rawId: b64(credential.rawId), type: credential.type, clientExtensionResults: credential.getClientExtensionResults(),
          authenticatorAttachment: credential.authenticatorAttachment || undefined,
          response: { clientDataJSON: b64(r.clientDataJSON), attestationObject: b64(r.attestationObject), transports: r.getTransports ? r.getTransports() : [] } }
      : { id: credential.id, rawId: b64(credential.rawId), type: credential.type, clientExtensionResults: credential.getClientExtensionResults(),
          authenticatorAttachment: credential.authenticatorAttachment || undefined,
          response: { clientDataJSON: b64(r.clientDataJSON), authenticatorData: b64(r.authenticatorData), signature: b64(r.signature), userHandle: r.userHandle ? b64(r.userHandle) : undefined } };
    const sent = await fetch("/api/security-keys/ceremony/" + C.id, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ response }), signal: AbortSignal.timeout(30_000) });
    finish(sent.ok, sent.ok ? "" : "failed");
  } catch (error) {
    finish(false, error && error.name === "NotAllowedError" ? "cancelled" : "failed");
  }
}
button.addEventListener("click", run);
`;
  const html = `<!doctype html><html lang="${words === PAGE_WORDS.fr ? "fr" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(words.title)}</title>
<style>body{font:15px -apple-system,system-ui,sans-serif;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#fff;color:#111}@media(prefers-color-scheme:dark){body{background:#1c1c1e;color:#f2f2f7}}main{max-width:360px;padding:24px;text-align:center}button{font:inherit;padding:10px 20px;border-radius:10px;border:0;background:#2563eb;color:#fff;cursor:pointer}button:disabled{opacity:.6}</style></head>
<body><main><h1 style="font-size:18px">${escapeHtml(words.title)}</h1>${input.kind === "assert" && input.label ? `<p id="what" style="font-weight:600">${escapeHtml(input.label)}</p>` : ""}${input.kind === "assert" && input.summary ? `<p id="detail" style="opacity:.75;font-size:13px;word-break:break-word">${escapeHtml(input.summary)}</p>` : ""}${input.digest ? `<p id="digest" style="opacity:.6;font-size:12px;font-family:ui-monospace,monospace">${escapeHtml(words.digest)} ${escapeHtml(input.digest)}</p>` : ""}<p id="status">${escapeHtml(input.kind === "register" ? words.register : words.assert)}</p><button id="go" type="button">${escapeHtml(words.start)}</button></main>
<script nonce="${nonce}">${script}</script></body></html>`;
  return { html, nonce };
}

/** The public ceremony routes. Returns true when it answered. */
export function securityKeyCeremonyRoutes(deps: { keys: SecurityKeys }) {
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const match = /^\/api\/security-keys\/ceremony\/([^/]+)(\/page|\/status)?$/.exec(url.pathname);
    if (!match) return false;
    const method = req.method ?? "GET";
    const id = match[1]!;
    if (!CEREMONY_ID.test(id)) return send(res, 404, { error: "This security key request has expired. Start again." });
    if (match[2] === "/status") {
      if (method !== "GET") return send(res, 405, { error: "GET only" });
      return send(res, 200, { status: deps.keys.status(id) });
    }
    const pending = deps.keys.pending(id);
    if (match[2] === "/page") {
      if (method !== "GET") return send(res, 405, { error: "GET only" });
      if (!pending) return send(res, 404, { error: "This security key request has expired. Start again." });
      const page = ceremonyPage({
        id,
        kind: pending.kind,
        language: typeof req.headers["accept-language"] === "string" ? req.headers["accept-language"] : undefined,
        phone: url.searchParams.get("phone") === "1",
        label: pending.label === "register" ? undefined : pending.label,
        ...(pending.summary ? { summary: pending.summary } : {}),
        digest: pending.digest,
      });
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${page.nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
      });
      res.end(page.html);
      return true;
    }
    if (method === "GET") {
      if (!pending) return send(res, 404, { error: "This security key request has expired. Start again." });
      return send(res, 200, { kind: pending.kind, options: pending.options });
    }
    if (method !== "POST") return send(res, 405, { error: "GET or POST only" });
    // JSON only: a plain form post from another site cannot reach it.
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return send(res, 415, { error: "JSON only" });
    }
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return send(res, 400, { error: "The security key's answer could not be read." });
    }
    const response = body && typeof body === "object" && !Array.isArray(body) ? (body as { response?: unknown }).response : undefined;
    const done = await deps.keys.complete(id, response);
    if (!done.ok) return send(res, done.status, { error: done.error });
    return send(res, 200, { ok: true, kind: done.kind });
  };
}
