// Team secrets of a Perspicax organization (decision JC, 2026-10-21): an
// admin assigns a named secret, or a service account, to a team bot. Members
// never receive the list. The value is write-only. The bot's own shell does
// not receive it (server/org-bot-secrets.ts): a connector process may.

export const ORG_BOT_SECRET_KINDS = ["secret", "serviceAccount"] as const;
export type OrgBotSecretKind = (typeof ORG_BOT_SECRET_KINDS)[number];

export const MAX_ORG_BOT_SECRETS = 100;

export type OrgBotSecretInjection =
  | { via: "env"; name: string }
  | { via: "plugin"; plugin: string; key: string };

/** What an organization admin may see. Never the value. */
export interface OrgBotSecretPublic {
  id: string;
  kind: OrgBotSecretKind;
  label: string;
  injection: OrgBotSecretInjection;
  botIds: string[];
  /** A service account's login. Admins only, and never the password. */
  login?: string;
}

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const PLUGIN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PLUGIN_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const BOT = /^[\w-]{1,128}$/;
export const ORG_BOT_SECRET_ID = /^bs_[0-9a-f]{16}$/;

export function parseInjection(value: unknown): OrgBotSecretInjection | string {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!row) return "Say how the bot receives the secret: an env name, or a plugin setting.";
  if (row.via === "env") {
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!ENV_NAME.test(name)) return "An env name is uppercase letters, digits and underscores, such as SHOP_TOKEN.";
    return { via: "env", name };
  }
  if (row.via === "plugin") {
    const plugin = typeof row.plugin === "string" ? row.plugin.trim() : "";
    const key = typeof row.key === "string" ? row.key.trim() : "";
    if (!PLUGIN.test(plugin) || !PLUGIN_KEY.test(key)) return "A plugin setting needs a plugin id and a key.";
    return { via: "plugin", plugin, key };
  }
  return "Say how the bot receives the secret: an env name, or a plugin setting.";
}

export function parseBotIds(value: unknown): string[] | string {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return "Assign the secret to one team bot, or up to 20.";
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string" || !BOT.test(raw) || out.includes(raw)) return "Each bot is named once.";
    out.push(raw);
  }
  return out;
}
