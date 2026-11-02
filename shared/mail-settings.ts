// Settings > Email, as the server (server/mail/mail-config.ts, server/mail/mail-routes.ts)
// and the app (src/components/MailSettings.tsx) both read it: the field ids,
// which of them are write-only secrets, and the shape GET /api/mail/settings
// answers with. Nothing here ever holds a secret value.

export type MailProvider = "smtp" | "sendgrid" | "twilio";
export const MAIL_PROVIDERS: readonly MailProvider[] = ["twilio", "sendgrid", "smtp"];

/** The name a sender gets when none is set (Twilio's Email API requires one). */
export const DEFAULT_MAIL_FROM_NAME = "Sagax";

export const MAIL_FIELDS = [
  "provider", "from", "fromName",
  "smtp.host", "smtp.port", "smtp.secure", "smtp.user", "smtp.password",
  "sendgrid.apiKey",
  "twilio.apiKeySid", "twilio.apiKeySecret",
] as const;
export type MailField = (typeof MAIL_FIELDS)[number];

/** Write-only fields: never shown back, only whether one is configured. */
export const MAIL_SECRET_FIELDS: ReadonlySet<MailField> = new Set<MailField>(["smtp.password", "sendgrid.apiKey", "twilio.apiKeySecret"]);

/** Each provider's own fields, in display order. */
export const MAIL_PROVIDER_FIELDS: Record<MailProvider, readonly MailField[]> = {
  smtp: ["smtp.host", "smtp.port", "smtp.secure", "smtp.user", "smtp.password"],
  sendgrid: ["sendgrid.apiKey"],
  twilio: ["twilio.apiKeySid", "twilio.apiKeySecret"],
};

export type MailFieldSource = "saved" | "server" | "unset";

/** One field as Settings shows it. A secret has `configured` and never a
 * value; any other field has its effective value and the server's own. */
export interface MailFieldView {
  source: MailFieldSource;
  /** The environment gives this field a value ("Revert to the server's value"). */
  serverDefault: boolean;
  value?: string | number;
  serverValue?: string | number;
  configured?: boolean;
}

export interface MailSettingsView {
  fields: Record<MailField, MailFieldView>;
  ready: boolean;
  missing: MailField[];
  defaultFromName: string;
  /** Where POST /api/mail/test sends: the caller's own address. */
  testAddress?: string;
}
