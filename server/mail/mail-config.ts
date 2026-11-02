// Mail settings: the values saved in Settings > Email (config.json's
// `mail` block, ~/.sagax/config.json, owner-only like every other
// config secret) merged over the server's environment. A saved field wins;
// SAGAX_MAIL_* (and the *_FILE secret variants) give each field its default,
// so a Docker or headless server can be bootstrapped before anyone reaches
// Settings and an admin can still override it there, or revert a field to
// the server's value. `publicMailStatus` and `mailSettingsView` are what a
// settings UI or a status route may show; neither contains a secret value,
// only whether one is configured.
import { readFileSync } from "node:fs";
import { z } from "zod";

import {
  DEFAULT_MAIL_FROM_NAME,
  MAIL_FIELDS,
  MAIL_SECRET_FIELDS,
  type MailField,
  type MailFieldSource,
  type MailFieldView,
  type MailProvider,
  type MailSettingsView,
} from "../../shared/mail-settings.ts";

export { DEFAULT_MAIL_FROM_NAME, MAIL_FIELDS, MAIL_SECRET_FIELDS };
export type { MailField, MailFieldSource, MailFieldView, MailProvider, MailSettingsView };

export interface MailSettings {
  provider?: MailProvider;
  /** A bare address, or `Name <address>` (an older or env-provided value). */
  from?: string;
  /** The sender's display name; DEFAULT_MAIL_FROM_NAME when none is set. */
  fromName?: string;
  smtp?: {
    host?: string;
    port?: number;
    secure?: "tls" | "starttls" | "none";
    user?: string;
    password?: string;
  };
  sendgrid?: {
    apiKey?: string;
  };
  twilio?: {
    apiKeySid?: string;
    apiKeySecret?: string;
  };
}

export interface ResolvedMailSettings {
  /** What the mailer uses: saved values over the environment's. */
  settings: MailSettings;
  /** Fields the environment gives a value (the server's defaults). */
  envManaged: MailField[];
  /** Fields saved in Settings, which win over the environment. */
  saved: MailField[];
  /** The environment's values alone. */
  server: MailSettings;
}

type MailFieldValue = string | number | undefined;

function getMailField(settings: MailSettings, field: MailField): MailFieldValue {
  const [section, key] = field.split(".") as [string, string | undefined];
  if (key === undefined) return (settings as Record<string, MailFieldValue>)[section];
  const block = (settings as Record<string, Record<string, MailFieldValue> | undefined>)[section];
  return block?.[key];
}

function setMailField(settings: MailSettings, field: MailField, value: MailFieldValue): void {
  const [section, key] = field.split(".") as [string, string | undefined];
  const target = settings as Record<string, unknown>;
  if (key === undefined) {
    if (value === undefined) delete target[section];
    else target[section] = value;
    return;
  }
  const block = { ...(target[section] as Record<string, unknown> | undefined) };
  if (value === undefined) delete block[key];
  else block[key] = value;
  if (Object.keys(block).length) target[section] = block;
  else delete target[section];
}

const present = (value: MailFieldValue): boolean => value !== undefined && value !== "";

export interface PublicMailStatus {
  provider?: MailProvider;
  from?: string;
  smtp: {
    host?: string;
    port?: number;
    secure?: string;
    user?: string;
    passwordConfigured: boolean;
  };
  sendgrid: {
    apiKeyConfigured: boolean;
  };
  twilio: {
    apiKeySid?: string;
    apiKeySecretConfigured: boolean;
  };
  envManaged: MailField[];
  ready: boolean;
}

const MAIL_PROVIDERS = new Set<MailProvider>(["smtp", "sendgrid", "twilio"]);
const SMTP_SECURE_MODES = new Set(["tls", "starttls", "none"]);
// Full match only: "587abc" and "587.9" are not "close enough" to a port,
// they are malformed input to be ignored, not coerced by parseInt.
const SMTP_PORT_PATTERN = /^\d+$/;

const defaultReadFile = (path: string): string => readFileSync(path, "utf8");

/** Reads `${name}` or, failing that, `${name}_FILE` (a Docker secret path).
 * The direct value always wins over the file. An unreadable file is
 * ignored — logged by variable name only, never by path or content. */
function readSecret(env: NodeJS.ProcessEnv, name: string, readFile: (path: string) => string): string | undefined {
  const direct = env[name];
  if (direct !== undefined && direct !== "") return direct;
  const filePath = env[`${name}_FILE`];
  if (filePath === undefined || filePath === "") return undefined;
  try {
    return readFile(filePath).trim();
  } catch {
    console.warn(`mail-config: could not read ${name}_FILE`);
    return undefined;
  }
}

export function resolveMailSettings(input: {
  file: MailSettings | undefined;
  env: NodeJS.ProcessEnv;
  readFile?: (path: string) => string;
}): ResolvedMailSettings {
  const readFile = input.readFile ?? defaultReadFile;
  const env = input.env;
  const settings: MailSettings = {};
  const envManaged: MailField[] = [];

  const setProvider = env.SAGAX_MAIL_PROVIDER;
  if (setProvider !== undefined && setProvider !== "" && MAIL_PROVIDERS.has(setProvider as MailProvider)) {
    settings.provider = setProvider as MailProvider;
    envManaged.push("provider");
  }

  const from = env.SAGAX_MAIL_FROM;
  if (from !== undefined && from !== "") {
    settings.from = from;
    envManaged.push("from");
  }

  const fromName = env.SAGAX_MAIL_FROM_NAME;
  if (fromName !== undefined && fromName.trim() !== "") {
    settings.fromName = fromName.trim();
    envManaged.push("fromName");
  }

  const smtpHost = env.SAGAX_SMTP_HOST;
  if (smtpHost !== undefined && smtpHost !== "") {
    settings.smtp = { ...settings.smtp, host: smtpHost };
    envManaged.push("smtp.host");
  }

  const smtpPortRaw = env.SAGAX_SMTP_PORT;
  if (smtpPortRaw !== undefined && smtpPortRaw !== "") {
    const port = SMTP_PORT_PATTERN.test(smtpPortRaw) ? Number.parseInt(smtpPortRaw, 10) : NaN;
    if (port >= 1 && port <= 65535) {
      settings.smtp = { ...settings.smtp, port };
      envManaged.push("smtp.port");
    } else {
      console.warn("mail-config: ignoring malformed SAGAX_SMTP_PORT");
    }
  }

  const smtpSecure = env.SAGAX_SMTP_SECURE;
  if (smtpSecure !== undefined && smtpSecure !== "" && SMTP_SECURE_MODES.has(smtpSecure)) {
    settings.smtp = { ...settings.smtp, secure: smtpSecure as "tls" | "starttls" | "none" };
    envManaged.push("smtp.secure");
  }

  const smtpUser = env.SAGAX_SMTP_USER;
  if (smtpUser !== undefined && smtpUser !== "") {
    settings.smtp = { ...settings.smtp, user: smtpUser };
    envManaged.push("smtp.user");
  }

  const smtpPassword = readSecret(env, "SAGAX_SMTP_PASSWORD", readFile);
  if (smtpPassword !== undefined) {
    settings.smtp = { ...settings.smtp, password: smtpPassword };
    envManaged.push("smtp.password");
  }

  const sendgridApiKey = readSecret(env, "SAGAX_SENDGRID_API_KEY", readFile);
  if (sendgridApiKey !== undefined) {
    settings.sendgrid = { ...settings.sendgrid, apiKey: sendgridApiKey };
    envManaged.push("sendgrid.apiKey");
  }

  const twilioApiKeySid = env.SAGAX_TWILIO_API_KEY_SID;
  if (twilioApiKeySid !== undefined && twilioApiKeySid !== "") {
    settings.twilio = { ...settings.twilio, apiKeySid: twilioApiKeySid };
    envManaged.push("twilio.apiKeySid");
  }

  const twilioApiKeySecret = readSecret(env, "SAGAX_TWILIO_API_KEY_SECRET", readFile);
  if (twilioApiKeySecret !== undefined) {
    settings.twilio = { ...settings.twilio, apiKeySecret: twilioApiKeySecret };
    envManaged.push("twilio.apiKeySecret");
  }

  const server = structuredClone(settings);
  const saved: MailField[] = [];
  const file = input.file ?? {};
  for (const field of MAIL_FIELDS) {
    const value = getMailField(file, field);
    if (!present(value)) continue;
    setMailField(settings, field, value);
    saved.push(field);
  }
  return { settings, envManaged, saved, server };
}

/** The fields still needed before mail can be sent, in display order. */
export function missingMailFields(settings: MailSettings): MailField[] {
  const missing: MailField[] = [];
  if (!settings.provider) missing.push("provider");
  if (!settings.from) missing.push("from");
  if (settings.provider === "smtp" && !settings.smtp?.host) missing.push("smtp.host");
  if (settings.provider === "sendgrid" && !settings.sendgrid?.apiKey) missing.push("sendgrid.apiKey");
  if (settings.provider === "twilio") {
    if (!settings.twilio?.apiKeySid) missing.push("twilio.apiKeySid");
    if (!settings.twilio?.apiKeySecret) missing.push("twilio.apiKeySecret");
  }
  return missing;
}

export function mailReady(settings: MailSettings): boolean {
  return !!settings.provider && missingMailFields(settings).length === 0;
}

export function publicMailStatus(resolved: ResolvedMailSettings): PublicMailStatus {
  const { settings, envManaged } = resolved;
  return {
    provider: settings.provider,
    from: settings.from,
    smtp: {
      host: settings.smtp?.host,
      port: settings.smtp?.port,
      secure: settings.smtp?.secure,
      user: settings.smtp?.user,
      passwordConfigured: !!settings.smtp?.password,
    },
    sendgrid: {
      apiKeyConfigured: !!settings.sendgrid?.apiKey,
    },
    twilio: {
      apiKeySid: settings.twilio?.apiKeySid,
      apiKeySecretConfigured: !!settings.twilio?.apiKeySecret,
    },
    envManaged,
    ready: mailReady(settings),
  };
}

// ── Settings > Email ──────────────────────────────────────────────────────

export function mailSettingsView(resolved: ResolvedMailSettings): MailSettingsView {
  const fields = {} as Record<MailField, MailFieldView>;
  for (const field of MAIL_FIELDS) {
    const value = getMailField(resolved.settings, field);
    const serverValue = getMailField(resolved.server, field);
    const source: MailFieldSource = resolved.saved.includes(field) ? "saved" : present(serverValue) ? "server" : "unset";
    const view: MailFieldView = { source, serverDefault: present(serverValue) };
    if (MAIL_SECRET_FIELDS.has(field)) {
      view.configured = present(value);
    } else {
      if (present(value)) view.value = value;
      if (present(serverValue)) view.serverValue = serverValue;
    }
    fields[field] = view;
  }
  return {
    fields,
    ready: mailReady(resolved.settings),
    missing: missingMailFields(resolved.settings),
    defaultFromName: DEFAULT_MAIL_FROM_NAME,
  };
}

// No control characters anywhere: a CR or LF in a sender name or a
// credential is a header injection, never a real value.
// eslint-disable-next-line no-control-regex
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const text = (max: number) => z.string().trim().min(1).max(max).regex(NO_CONTROL);

/** PUT /api/mail/settings: one key per field. A value sets it, null
 * removes the saved value (back to the server's), and an absent key keeps
 * what is saved, which is how a secret stays write-only. */
export const mailSettingsPatchSchema = z.object({
  provider: z.enum(["smtp", "sendgrid", "twilio"]).nullable().optional(),
  // A bare address: the name has its own field.
  from: z.string().trim().max(254).pipe(z.email()).nullable().optional(),
  fromName: text(100).regex(/^[^<>"]*$/).nullable().optional(),
  "smtp.host": z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9.:[\]-]+$/).nullable().optional(),
  "smtp.port": z.number().int().min(1).max(65535).nullable().optional(),
  "smtp.secure": z.enum(["tls", "starttls", "none"]).nullable().optional(),
  "smtp.user": text(320).nullable().optional(),
  "smtp.password": text(4096).nullable().optional(),
  "sendgrid.apiKey": text(4096).nullable().optional(),
  "twilio.apiKeySid": z.string().trim().regex(/^[A-Za-z0-9]{2,64}$/).nullable().optional(),
  "twilio.apiKeySecret": text(4096).nullable().optional(),
}).strict();
export type MailSettingsPatch = z.output<typeof mailSettingsPatchSchema>;

/** The saved settings after `patch`; `saved` itself is not changed. */
export function applyMailSettingsPatch(saved: MailSettings | undefined, patch: MailSettingsPatch): MailSettings {
  const next: MailSettings = structuredClone(saved ?? {});
  for (const field of MAIL_FIELDS) {
    if (!Object.hasOwn(patch, field)) continue;
    const value = patch[field];
    if (value === undefined) continue;
    setMailField(next, field, value === null ? undefined : value);
  }
  return next;
}
