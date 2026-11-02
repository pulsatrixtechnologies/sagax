// Sends mail through whichever provider `MailSettings` names: SMTP via
// nodemailer, or SendGrid or the Twilio Email API over HTTP (no SDK: Node
// 24 has fetch).
// `createMailer` returns null when settings are not `mailReady`, so callers
// just check for a mailer rather than re-validating settings themselves.
import { appendFileSync } from "node:fs";
import nodemailer from "nodemailer";

import { DEFAULT_MAIL_FROM_NAME, mailReady, type MailSettings } from "./mail-config.ts";

export interface Mailer {
  /** `to` is one address or several separated by commas. `cc` and `bcc`
   * are optional (an email draft the person sends from its card). */
  send(message: { to: string; subject: string; text: string; cc?: string[]; bcc?: string[] }): Promise<void>;
}

/** A send that reached some recipients before it failed: `sent` names
 * them, so a retry does not send them the same message again. */
export class MailPartialSendError extends Error {
  readonly sent: string[];
  constructor(message: string, sent: string[]) {
    super(message);
    this.name = "MailPartialSendError";
    this.sent = sent;
  }
}

/** "a@x.ca, b@y.ca" as a list. */
function recipients(to: string): string[] {
  return to.split(",").map((address) => address.trim()).filter(Boolean);
}

interface SmtpTransport {
  sendMail(message: object): Promise<unknown>;
}

export interface MailerDeps {
  fetchImpl?: typeof fetch;
  smtpTransport?: (options: object) => SmtpTransport;
}

const SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send";
const MAIL_HTTP_TIMEOUT_MS = 20_000;

/** The same upper bound as SMTP's socket timeout. A timeout is surfaced
 * without retrying: the provider may already have accepted the message. */
async function fetchMail(provider: string, fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const signal = AbortSignal.timeout(MAIL_HTTP_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal });
  } catch (error) {
    if (signal.aborted) throw new Error(`${provider} did not answer within 20 seconds`);
    throw error;
  }
}

function createSendGridMailer(settings: MailSettings, fetchImpl: typeof fetch): Mailer {
  const apiKey = settings.sendgrid!.apiKey!;
  const sender = senderOf(settings);
  return {
    async send(message) {
      const response = await fetchMail("SendGrid", fetchImpl, SENDGRID_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{
            to: recipients(message.to).map((email) => ({ email })),
            ...(message.cc?.length ? { cc: message.cc.map((email) => ({ email })) } : {}),
            ...(message.bcc?.length ? { bcc: message.bcc.map((email) => ({ email })) } : {}),
          }],
          from: { email: sender.address, name: sender.name },
          subject: message.subject,
          content: [{ type: "text/plain", value: message.text }],
        }),
      });
      if (!response.ok) {
        throw new Error(`SendGrid refused the message (${response.status})`);
      }
    },
  };
}

const TWILIO_EMAIL_URL = "https://comms.twilio.com/v1/Emails";

/** `from` may be a bare address or `Name <address>`. */
function parseFromAddress(from: string): { address: string; name?: string } {
  const match = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/.exec(from);
  if (!match) return { address: from.trim() };
  const name = match[1]!.replace(/^"(.*)"$/, "$1").trim();
  return name ? { address: match[2]!, name } : { address: match[2]! };
}

/** The sender every provider uses: the configured name first, then a name
 * written into `from`, then the product's name. Twilio's Email API refuses
 * a sender without a display name (400 "Invalid value provided for field
 * 'from'"), so a sender always has one. */
function senderOf(settings: MailSettings): { address: string; name: string } {
  const parsed = parseFromAddress(settings.from!);
  return { address: parsed.address, name: settings.fromName?.trim() || parsed.name || DEFAULT_MAIL_FROM_NAME };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const TWILIO_ERROR_DETAIL_MAX = 500;

async function twilioErrorDetail(response: Response, secrets: string[]): Promise<string> {
  let messages: string[] = [];
  try {
    const body = (await response.json()) as { errors?: Array<{ code?: unknown; message?: unknown }> };
    messages = (Array.isArray(body?.errors) ? body.errors : [])
      .map((e) => {
        const message = typeof e?.message === "string" ? e.message : "";
        const code = typeof e?.code === "string" || typeof e?.code === "number" ? String(e.code) : "";
        return message && code ? `${message} (${code})` : message;
      })
      .filter((m) => m !== "");
  } catch {
    return "";
  }
  let detail = messages.join("; ");
  for (const secret of secrets) {
    if (secret) detail = detail.split(secret).join("[redacted]");
  }
  return detail.length > TWILIO_ERROR_DETAIL_MAX ? `${detail.slice(0, TWILIO_ERROR_DETAIL_MAX)}...` : detail;
}

function createTwilioMailer(settings: MailSettings, fetchImpl: typeof fetch): Mailer {
  const { apiKeySid, apiKeySecret } = settings.twilio!;
  const authorization = `Basic ${Buffer.from(`${apiKeySid!}:${apiKeySecret!}`).toString("base64")}`;
  const from = senderOf(settings);
  return {
    async send(message) {
      // The Email API is used here with a To list only: each Cc and Bcc
      // address gets its own copy, so a Bcc address is never shown to anyone.
      const sent: string[] = [];
      for (const to of [recipients(message.to), ...[...(message.cc ?? []), ...(message.bcc ?? [])].map((address) => [address])]) {
        try {
          await sendOne(to, message);
        } catch (error) {
          if (!sent.length) throw error;
          throw new MailPartialSendError(error instanceof Error ? error.message : String(error), sent);
        }
        sent.push(...to);
      }
    },
  };

  async function sendOne(to: string[], message: { subject: string; text: string }): Promise<void> {
    const response = await fetchMail("Twilio", fetchImpl, TWILIO_EMAIL_URL, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: to.map((address) => ({ address })),
        content: {
          subject: message.subject,
          html: escapeHtml(message.text).replace(/\r?\n/g, "<br>\n"),
          text: message.text,
        },
      }),
    });
    // The Email API accepts a message with 202 and delivers it later.
    // A refusal reads `{"errors":[{"code","message"}],"status"}`; its
    // messages ("The from.address domain ... is not valid or authorized.")
    // are what an operator needs, so they go into the error, scrubbed of
    // anything that echoes the credential back.
    if (!response.ok) {
      const detail = await twilioErrorDetail(response, [apiKeySecret!, authorization.slice("Basic ".length)]);
      throw new Error(`Twilio refused the message (${response.status})${detail ? `: ${detail}` : ""}`);
    }
  }
}

function createSmtpMailer(settings: MailSettings, smtpTransport: (options: object) => SmtpTransport): Mailer {
  const smtp = settings.smtp!;
  // nodemailer encodes the name itself, so it cannot break the header.
  const from = senderOf(settings);
  const port = smtp.port ?? (smtp.secure === "tls" ? 465 : 587);
  const transport = smtpTransport({
    host: smtp.host,
    port,
    secure: smtp.secure === "tls",
    requireTLS: smtp.secure === "starttls",
    ignoreTLS: smtp.secure === "none",
    auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? "" } : undefined,
    // An unreachable or slow-to-answer host must fail a sign-in request in
    // seconds, not hang the connection indefinitely.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  return {
    async send(message) {
      try {
        await transport.sendMail({
          from, to: message.to, subject: message.subject, text: message.text,
          ...(message.cc?.length ? { cc: message.cc } : {}),
          ...(message.bcc?.length ? { bcc: message.bcc } : {}),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`the mail server refused the message: ${detail}`);
      }
    },
  };
}

export function createMailer(settings: MailSettings, deps: MailerDeps = {}): Mailer | null {
  if (!mailReady(settings)) return null;
  if (settings.provider === "sendgrid") {
    return createSendGridMailer(settings, deps.fetchImpl ?? fetch);
  }
  if (settings.provider === "twilio") {
    return createTwilioMailer(settings, deps.fetchImpl ?? fetch);
  }
  const smtpTransport = deps.smtpTransport ?? ((options: object) => nodemailer.createTransport(options));
  return createSmtpMailer(settings, smtpTransport);
}

/** A test/e2e seam (SAGAX_MAIL_CAPTURE_FILE): sends nothing and instead
 * appends each message as one JSON line `{to,subject,text,at}` to `filePath`.
 * For a harness that spawns this server as a child process and so cannot
 * stub fetch or nodemailer. The caller decides when this seam applies
 * (index.ts ignores it in production); this function only ever appends. */
export function createCaptureMailer(filePath: string): Mailer {
  return {
    async send(message) {
      appendFileSync(filePath, `${JSON.stringify({ ...message, at: new Date().toISOString() })}\n`);
    },
  };
}
