// Settings > Email on a solo server: the mail transport that carries email
// sign-in codes and invitations.
//
//   GET  /api/mail/settings   each field's value and where it comes from;
//                             secrets only as configured-or-not
//   PUT  /api/mail/settings   change fields (a value sets, null reverts to
//                             the server's environment value)
//   POST /api/mail/test       one test message to the caller's own address
//
// Admin scope only: the auth gate already refuses other callers (the routes
// are not in request-auth.ts CLIENT_ALLOW), and every handler checks again.
// An organization server (SAGAX_IDENTITY=perspicax) has no email sign-in or
// invitations, so it answers 403 identity_perspicax: Perspicax sends its mail.
// A test message goes only to the address the caller signed in with (the
// operator's profile address at this computer). No body field is accepted,
// so this route can never be used to mail somebody else, and it is rate
// limited per caller.
import { applyMailSettingsPatch, mailSettingsPatchSchema, mailSettingsView, resolveMailSettings, type MailSettings } from "./mail-config.ts";
import type { Mailer } from "./mailer.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";

export const MAIL_SETTINGS_PATH = "/api/mail/settings";
export const MAIL_TEST_PATH = "/api/mail/test";

/** Test sends per caller: at most `max` in `windowMs`, and one at a time
 * no closer than `minIntervalMs`. */
export const MAIL_TEST_LIMIT = { max: 5, windowMs: 60 * 60_000, minIntervalMs: 30_000 } as const;

const MAX_BODY_BYTES = 32 * 1024;

export interface MailSettingsRouteDeps {
  /** True on an organization server: every route answers 403 identity_perspicax. */
  organization: boolean;
  /** The saved settings (config.json `mail`). */
  saved(): MailSettings | undefined;
  /** Persist the whole saved block (saveConfig) and update the live config. */
  save(next: MailSettings): void;
  env(): NodeJS.ProcessEnv;
  readFile?: (path: string) => string;
  /** The live mailer, built from the saved and environment settings. */
  mailer(): Mailer | null;
  /** The address the caller signed in with, or the operator's profile address. */
  callerEmail(auth: RequestAuth): string | undefined;
  now?: () => number;
}

const refuse = (code: string, error: string) => ({ code, error });

function isAdmin(auth: RequestAuth): boolean {
  if (auth.kind === "loopback" && auth.trust === "service") return false;
  return auth.scopes.includes("admin");
}

/** Every secret the mailer may hold, for scrubbing an error before it is shown or logged. */
function secretsOf(settings: MailSettings): string[] {
  return [settings.smtp?.password, settings.sendgrid?.apiKey, settings.twilio?.apiKeySecret]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function scrub(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  return out.length > 500 ? `${out.slice(0, 500)}...` : out;
}

export function testMailMessage(address: string): { subject: string; text: string } {
  return {
    subject: "Sagax: courriel de test / test email",
    text: [
      "Ce message confirme que Sagax peut envoyer du courriel depuis ce serveur.",
      "This message confirms that Sagax can send email from this server.",
      "",
      `Destinataire / Recipient: ${address}`,
    ].join("\n"),
  };
}

export function createMailSettingsRoutes(deps: MailSettingsRouteDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  const sends = new Map<string, number[]>();
  const resolved = () => resolveMailSettings({ file: deps.saved(), env: deps.env(), ...(deps.readFile ? { readFile: deps.readFile } : {}) });
  const view = (auth: RequestAuth) => {
    const address = deps.callerEmail(auth);
    return { ...mailSettingsView(resolved()), ...(address ? { testAddress: address } : {}) };
  };

  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== MAIL_SETTINGS_PATH && path !== MAIL_TEST_PATH) return PASS;
    res.setHeader("cache-control", "no-store");
    if (deps.organization) {
      return json(res, 403, refuse("identity_perspicax", "This server signs people in with Pulsatrix; Perspicax sends its email."));
    }
    if (!isAdmin(auth)) return json(res, 403, refuse("forbidden", "Only an admin can change how this server sends email."));

    if (path === MAIL_SETTINGS_PATH) {
      if (method === "GET") return json(res, 200, view(auth));
      if (method !== "PUT") return json(res, 405, { error: "method not allowed" });
      let body: unknown;
      try {
        body = await readBody(req, MAX_BODY_BYTES);
      } catch (error) {
        const status = (error as { status?: number }).status === 413 ? 413 : 400;
        return json(res, status, refuse("invalid_mail_settings", "Send the email settings as JSON."));
      }
      const parsed = mailSettingsPatchSchema.safeParse(body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path.join(".") || (issue?.code === "unrecognized_keys" ? (issue.keys ?? []).join(", ") : "");
        return json(res, 400, { ...refuse("invalid_mail_settings", field ? `This email setting is not valid: ${field}.` : "These email settings are not valid."), ...(field ? { field } : {}) });
      }
      deps.save(applyMailSettingsPatch(deps.saved(), parsed.data));
      return json(res, 200, view(auth));
    }

    // POST /api/mail/test
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    let body: unknown;
    try {
      body = await readBody(req, MAX_BODY_BYTES);
    } catch {
      return json(res, 400, refuse("recipient_not_allowed", "A test message takes no fields: it goes to your own address."));
    }
    if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length > 0) {
      return json(res, 400, refuse("recipient_not_allowed", "A test message takes no fields: it goes to your own address."));
    }
    const address = deps.callerEmail(auth)?.trim();
    if (!address) return json(res, 409, refuse("no_address", "Your account has no email address to send the test to."));
    const settings = resolved().settings;
    const mailer = deps.mailer();
    if (!mailer) return json(res, 409, refuse("mail_not_ready", "Finish the email settings before sending a test."));

    const key = address.toLowerCase();
    const at = now();
    const recent = (sends.get(key) ?? []).filter((time) => at - time < MAIL_TEST_LIMIT.windowMs);
    const last = recent[recent.length - 1];
    const wait = recent.length >= MAIL_TEST_LIMIT.max
      ? recent[0]! + MAIL_TEST_LIMIT.windowMs - at
      : last !== undefined && at - last < MAIL_TEST_LIMIT.minIntervalMs ? last + MAIL_TEST_LIMIT.minIntervalMs - at : 0;
    if (wait > 0) {
      res.setHeader("retry-after", String(Math.ceil(wait / 1000)));
      return json(res, 429, { ...refuse("rate_limited", "Too many test messages. Try again later."), retryAfterSeconds: Math.ceil(wait / 1000) });
    }
    recent.push(at);
    sends.set(key, recent);

    try {
      await mailer.send({ to: address, ...testMailMessage(address) });
    } catch (error) {
      const detail = scrub(error instanceof Error ? error.message : String(error), secretsOf(settings));
      console.warn(`mail test could not be sent: ${detail}`);
      return json(res, 502, refuse("send_failed", detail || "The test message could not be sent."));
    }
    return json(res, 200, { sentTo: address });
  };
}
