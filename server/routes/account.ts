// DELETE /api/me: the phone's Account > Delete Account (iOS parity, 16).
//
// Organization server (SAGAX_IDENTITY=perspicax): the account is the person's
// Perspicax account. With { confirm: true } the server asks Perspicax to
// erase it (PerspicaxDirectory.eraseOwnAccount: POST
// /api/v1/pulsabot/people/me/erase with the link token and the person's live
// sign-in access token, 2026-10-17), then deletes the person's Sagax data
// (deletePersonData in server/index.ts, shared with the account purged push
// of the back-channel logout): the bots they own (with their threads, memory
// and computers), their own threads on other bots, their server environment
// and /workspace, their saved settings, their sign-in grants and routine
// delegation, their name, address and photo on the principal, and every
// session of theirs. Nothing is deleted here unless Perspicax erased the
// account first, so an account is never half removed:
//   - an older Perspicax without the route: 501 `perspicax_deletion_unavailable`
//     (the phone shows the row and explains);
//   - the person's Perspicax sign-in is no longer valid: 409
//     `account_sign_in_again`, never 401 (clients read 401 as their own
//     session ending; same reason as `avatar_sign_in_again`);
//   - the last active admin: 409 `last_admin`;
//   - a product an administrator configured still uses one of the person's
//     keys: 409 `perspicax_key_in_use`;
//   - no answer or an unreadable one: 502 `perspicax_deletion_failed`, worded
//     so the person knows the deletion may have gone through (the account
//     purged push then deletes the data here);
//   - another refusal: its 4xx with `perspicax_deletion_failed`; no link, no
//     answer or a 5xx: 502 `perspicax_deletion_failed`.
//
// 2026-10-18: Perspicax erases only with a sign-in of the last five minutes
// (its `403 reauth_required`), never with a token this server refreshed. So
// the deletion uses the access token of a fresh sign-in the person made for
// it (server/auth/account-reauth.ts), never the session's own token:
//   - POST /api/me/reauth `{ client: "web" | "phone" }` answers
//     `{ url, expiresAt }`: the address the client opens in a browser to sign
//     in again at Perspicax (a two-minute, single-use ticket for this session);
//   - DELETE /api/me without such a sign-in, or when Perspicax finds it too
//     old: 409 `reauth_required` (nothing deleted; the client signs in again
//     and retries), never 401.
//
// Personal server: there is no account here; 400 `personal_server`, and the
// phone forgets its pairing and erases its own data.
import { PASS, type RouteHandler } from "./table.ts";

/** What Perspicax answered the erasure of the person's account. */
export type PerspicaxDeletion =
  | { ok: true }
  | { ok: false; error: "unsupported" | "subject" | "reauth_required" | "last_admin" | "bound" | "refused" | "link" | "unreachable"; status?: number };

export interface AccountRouteDeps {
  organization: () => boolean;
  /** Erases the person's Perspicax account with the fresh sign-in kept for
   * this session (AccountReauth.take) and the link
   * (PerspicaxDirectory.eraseOwnAccount); `reauth_required` without one.
   * Never throws for a refusal. */
  perspicaxDeletion: (principalId: string, sessionId: string) => Promise<PerspicaxDeletion>;
  /** Opens the sign-in again for this session (POST /api/me/reauth): the
   * absolute address to open, or why not. */
  reauthStart?: (input: { principalId: string; sessionId: string; client: "web" | "phone" }) => { url: string; expiresAt: number } | { error: string };
  /** Deletes the person's data on this server (see the header). */
  deletePersonData: (principalId: string) => Promise<{ bots: number; threads: number }>;
}

const FAILED = "Perspicax did not delete the account; nothing was deleted here.";
const UNCONFIRMED = "Perspicax did not confirm the deletion. If it went through, your data here is deleted automatically within a few minutes; otherwise try again.";
const FINISHING = "Your account is deleted in Perspicax. Deleting your data here did not finish; it finishes automatically within a few minutes.";

export function createAccountRoutes(deps: AccountRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path === "/api/me/reauth") {
      if (method !== "POST") return json(res, 405, { error: "POST only" });
      res.setHeader("cache-control", "no-store");
      if (!deps.organization()) {
        return json(res, 400, { error: "This is a personal computer: there is no account on it to delete.", code: "personal_server" });
      }
      const principalId = auth.kind === "session" ? auth.session.principalId?.trim() : undefined;
      const sessionId = auth.kind === "session" ? auth.session.id : undefined;
      if (!principalId || !sessionId) return json(res, 403, { error: "Sign in with Pulsatrix to delete your account.", code: "identity_perspicax" });
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const body = await readBody(req) as Record<string, unknown> | null;
      const client = body?.client === "phone" ? "phone" : body?.client === undefined || body?.client === "web" ? "web" : null;
      if (!client) return json(res, 400, { error: "client is web or phone", code: "client" });
      const started = deps.reauthStart?.({ principalId, sessionId, client }) ?? { error: "unavailable" };
      if ("error" in started) {
        return json(res, 503, { error: "Signing in again is not available on this server right now.", code: "reauth_unavailable" });
      }
      return json(res, 200, { url: started.url, expiresAt: started.expiresAt });
    }
    if (path !== "/api/me") return PASS;
    if (method !== "DELETE") return json(res, 405, { error: "DELETE only" });
    res.setHeader("cache-control", "no-store");
    if (!deps.organization()) {
      return json(res, 400, { error: "This is a personal computer: there is no account on it to delete. Forget this computer on the phone instead.", code: "personal_server" });
    }
    const principalId = auth.kind === "session" ? auth.session.principalId?.trim() : undefined;
    const sessionId = auth.kind === "session" ? auth.session.id : undefined;
    if (!principalId || !sessionId) return json(res, 403, { error: "Sign in with Pulsatrix to delete your account.", code: "identity_perspicax" });
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    const body = await readBody(req) as Record<string, unknown> | null;
    if (body?.confirm !== true) return json(res, 400, { error: "Confirm the deletion ({ confirm: true }): it cannot be undone.", code: "confirm" });
    let erased: PerspicaxDeletion;
    try {
      erased = await deps.perspicaxDeletion(principalId, sessionId);
    } catch {
      erased = { ok: false, error: "unreachable" };
    }
    if (!erased.ok) {
      switch (erased.error) {
        case "unsupported":
          return json(res, 501, {
            error: "Your organization's Pulsatrix Perspicax does not offer account deletion from Sagax yet. Ask your administrator to delete your account.",
            code: "perspicax_deletion_unavailable",
          });
        case "subject":
          return json(res, 409, { error: "Your Pulsatrix sign-in has expired. Sign in again, then retry.", code: "account_sign_in_again" });
        case "reauth_required":
          return json(res, 409, {
            error: "To delete your account, sign in again with Pulsatrix first (less than five minutes before). Nothing was deleted.",
            code: "reauth_required",
            reauthPath: "/api/me/reauth",
          });
        case "last_admin":
          return json(res, 409, {
            error: "You are your organization's last active administrator in Pulsatrix Perspicax: make someone else an administrator first, then delete your account.",
            code: "last_admin",
          });
        case "bound":
          return json(res, 409, {
            error: "A product your administrator configured still uses one of your keys in Pulsatrix Perspicax: ask your administrator to remove it, then delete your account.",
            code: "perspicax_key_in_use",
          });
        case "unreachable":
          return json(res, 502, { error: UNCONFIRMED, code: "perspicax_deletion_failed" });
        case "refused": {
          const status = erased.status;
          return json(res, typeof status === "number" && status >= 400 && status < 500 ? status : 502, { error: FAILED, code: "perspicax_deletion_failed" });
        }
        default:
          return json(res, 502, { error: FAILED, code: "perspicax_deletion_failed" });
      }
    }
    let removed: { bots: number; threads: number };
    try {
      removed = await deps.deletePersonData(principalId);
    } catch {
      // The account purged push of Perspicax runs the same deletion again.
      return json(res, 500, { error: FINISHING, code: "account_deletion_pending" });
    }
    return json(res, 200, { deleted: true, ...removed });
  };
}
