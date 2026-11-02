// The credential vault's shapes and rules shared by the server and the app
// (server/credential-vault.ts keeps the encrypted store). Pure: no secret
// value ever appears in a type here, only whether one is saved.
//
// A login is filled into a page by reference: the bot names the item's
// handle, the browser runtime resolves the value at fill time and only on a
// page whose top-level origin matches one of the item's domains
// (server/credential-fill.ts). The bot never reads the value back.

/** The fixed target of a vault request card (kind "secret", target
 * vaultLogin). It is not one of the API keys of shared/credential-request.ts:
 * the card grants a bot the use of a saved login instead of asking for a key. */
export const VAULT_LOGIN_TARGET = "vaultLogin" as const;
export type VaultLoginTarget = typeof VAULT_LOGIN_TARGET;

export const VAULT_ITEM_KINDS = ["login", "apiKey", "note", "card", "address", "contact"] as const;
export type VaultItemKind = (typeof VAULT_ITEM_KINDS)[number];

/** A field the browser runtime can fill. Card, address and contact fields
 * are typed only after a purchase approval (shared/payment-vault.ts). */
export const VAULT_FILL_FIELDS = [
  "username", "password", "totp", "apiKey",
  "cardNumber", "cardExpiry", "cardCvc", "cardholder",
  "addressLine1", "addressLine2", "addressCity", "addressRegion", "addressPostal", "addressCountry", "addressRecipient", "addressPhone",
  "contactName", "contactEmail", "contactPhone", "contactCompany",
] as const;
export type VaultFillField = (typeof VAULT_FILL_FIELDS)[number];

/** once: this conversation, for a short while. always: this bot, until revoked. */
export const VAULT_GRANT_MODES = ["once", "always"] as const;
export type VaultGrantMode = (typeof VAULT_GRANT_MODES)[number];

/** How long a "once" grant lasts in the conversation that asked. */
export const VAULT_ONCE_GRANT_MS = 15 * 60_000;
/** 2026-10-21 (review of #954): a 1Password item allowed once is one
 * sign-in: its grant ends this long after its first fill. */
export const VAULT_SINGLE_USE_MS = 60_000;
/** 2026-10-29: a login lent for one turn ("This turn only" on the card) is
 * forgotten when that turn ends; this is the latest it lives if no end is
 * seen (a crash, a turn that never starts). Never written to disk. */
export const VAULT_TURN_LEND_MS = 15 * 60_000;

export const MAX_VAULT_ITEMS = 500;
export const MAX_VAULT_DOMAINS = 10;

export interface VaultGrantListing {
  botId: string;
  mode: VaultGrantMode;
  /** once: the conversation it holds in. */
  threadId?: string;
  grantedAt: number;
  /** once: when it ends. */
  expiresAt?: number;
}

/** What the person's own screen (and a request card) sees of an item. */
export interface VaultItemListing {
  id: string;
  kind: VaultItemKind;
  name: string;
  /** login: the user name is shown to the owner only, never to a bot. */
  username?: string;
  domains: string[];
  hasPassword: boolean;
  hasTotp: boolean;
  hasApiKey: boolean;
  hasNotes: boolean;
  /** A card, as the owner sees it: brand and last four, never the number. */
  card?: { brand: string; last4: string; expMonth: number; expYear: number; holder: string };
  /** An address the owner saved. The bot does not receive it; a fill does. */
  address?: { recipient: string; line1: string; line2?: string; city: string; region?: string; postal: string; country: string; phone?: string };
  /** A contact the owner saved. The bot does not receive the fields; a fill does. */
  contact?: { fullName: string; email?: string; phone?: string; company?: string };
  /** "1password": a read-only reference resolved at fill time. */
  source: "local" | "1password";
  /** An API key Sagax sends itself on a bot's request to the item's sites
   * (vault_http_request). Absent: the key is only filled into pages. */
  injection?: VaultApiInjection;
  /** The person exposes the key to their allowed bots' commands under this
   * name: those bots can read it in their shell. */
  commandVariable?: string;
  grants: VaultGrantListing[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  lastUsedBy?: string;
  /** 2026-10-29: lent for one turn from a card, kept in memory only. */
  lent?: true;
}

/** What a vault request card carries (message.secret.vault). */
export interface VaultRequestCardData {
  /** The name the bot asked for (free text it chose; shown, never trusted). */
  name?: string;
  /** The site it needs a login for, normalized. */
  domain?: string;
  /** The item the person chose, once they answered. */
  itemId?: string;
  itemName?: string;
  mode?: VaultGrantMode;
  /** The person whose vault answers (organization server); for a team
   * login, the bot's owner. */
  principalId: string;
  /** The bot's shared vault answers: these are its logins for the site
   * (names and sites only). The owner picks one, once or always. */
  team?: true;
  teamItems?: Array<{ id: string; name: string; domains: string[] }>;
  /** The person signed in themselves in the bot's browser instead. */
  signedInSelf?: boolean;
  /** 2026-10-21 (parité R10, ligne 82): the login chosen is a 1Password
   * item, read from 1Password at fill time. */
  onePassword?: boolean;
  /** 2026-10-29: the login typed on the card was lent for this turn only:
   * never saved, forgotten when the turn ends. */
  turnOnly?: boolean;
}

const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
/** Second levels that registries sell under a country code (co.uk,
 * com.au, gc.ca...): a wildcard under one of them would cover strangers. A
 * heuristic, not the public suffix list; exact hosts are the default. */
const SHARED_SECOND_LEVEL = /^(?:co|com|net|org|gov|edu|ac|or|ne|go|gob|gouv|nic|ltd|plc|sch|mil|gc|qc|on|bc|ab)\.[a-z]{2}$/;

/** A site binding as stored. Exact by default:
 *
 *   example.com             https://example.com only (default port)
 *   example.com:8443        that host on that port, https
 *   *.example.com           any subdomain of example.com, never the apex
 *   http://localhost:3000   the one plain-http binding: localhost, with a port
 *
 * Lower case, punycode for an international name. Null when it is not one of
 * these: an IP literal, a bare TLD, a wildcard on a shared suffix (co.uk), a
 * plain-http binding other than localhost. */
export function normalizeVaultDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim().toLowerCase();
  if (!value || value.length > 253 + 32) return null;
  const http = value.startsWith("http://");
  const wildcard = !http && /^(?:https:\/\/)?\*\./.test(value);
  if (wildcard) value = value.replace(/^(?:https:\/\/)?\*\./, "");
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/^\.+|\.+$/g, "");
  const port = url.port ? `:${url.port}` : "";
  if (url.protocol === "http:") return host === "localhost" && port && !wildcard ? `http://localhost${port}` : null;
  if (host === "localhost") return wildcard ? null : `localhost${port}`;
  if (!host || host.length > 253 || host.includes("[") || /^[0-9.]+$/.test(host)) return null;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => HOST_LABEL.test(label))) return null;
  if (/^[0-9]+$/.test(labels.at(-1)!)) return null;
  if (wildcard && (SHARED_SECOND_LEVEL.test(host) || port)) return null;
  return `${wildcard ? "*." : ""}${host}${port}`;
}

/** Whether a page may receive a value bound to these sites (see
 * normalizeVaultDomain): the same scheme, host and port, or a subdomain for
 * a "*." binding. A look-alike ("example.com.evil.test", "badexample.com")
 * never matches, nor a URL that carries a user name. */
export function vaultDomainMatches(domains: readonly string[], pageUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  const port = url.port ? `:${url.port}` : "";
  return domains.some((domain) => {
    if (domain.startsWith("http://")) return url.protocol === "http:" && `http://${host}${port}` === domain;
    if (url.protocol !== "https:") return false;
    if (domain.startsWith("*.")) return !port && host.endsWith(`.${domain.slice(2)}`);
    return `${host}${port}` === domain;
  });
}

/** A page URL a binding would match, for comparing a request with items. */
export function bindingUrl(domain: string): string {
  if (domain.startsWith("http://")) return `${domain}/`;
  return `https://${domain.replace(/^\*\./, "www.")}/`;
}

export function isVaultFillField(value: unknown): value is VaultFillField {
  return typeof value === "string" && (VAULT_FILL_FIELDS as readonly string[]).includes(value);
}

export function isVaultGrantMode(value: unknown): value is VaultGrantMode {
  return typeof value === "string" && (VAULT_GRANT_MODES as readonly string[]).includes(value);
}

/** The opaque handle a bot uses for an item: never the value, never the
 * item's internal file layout. */
export function vaultHandle(itemId: string): string {
  return `cred_${itemId}`;
}

/** A team bot's own vault principal (shared logins managed by its managers).
 * Bound into the sealed file's AAD so a copy under another bot never opens. */
export const BOT_VAULT_PREFIX = "bot:" as const;
const BOT_VAULT_ID = /^[\w-]{1,128}$/;

export function botVaultPrincipal(botId: string): string {
  if (!BOT_VAULT_ID.test(botId)) throw new Error("invalid bot id for vault");
  return `${BOT_VAULT_PREFIX}${botId}`;
}

/** The bot id a team-vault principal names, or null. */
export function botIdFromVaultPrincipal(principalId: string): string | null {
  if (!principalId.startsWith(BOT_VAULT_PREFIX)) return null;
  const botId = principalId.slice(BOT_VAULT_PREFIX.length);
  return BOT_VAULT_ID.test(botId) ? botId : null;
}

export function isBotVaultPrincipal(principalId: string): boolean {
  return botIdFromVaultPrincipal(principalId) !== null;
}

/** 2026-10-29: the handle of a Shop Pay or Link one-time card, bound to its
 * approved purchase (pay_<16 hex>): cred_w<16 hex>. */
export function walletCardHandle(purchaseId: string): string {
  return `cred_w${purchaseId.replace(/^pay_/, "")}`;
}

/** The purchase a one-time card handle names, or null. */
export function purchaseIdFromWalletHandle(handle: unknown): string | null {
  if (typeof handle !== "string") return null;
  const match = /^cred_w([a-f0-9]{16})$/.exec(handle.trim());
  return match ? `pay_${match[1]}` : null;
}

export function itemIdFromHandle(handle: unknown): string | null {
  if (typeof handle !== "string") return null;
  const match = /^cred_([a-z0-9]{8,40})$/.exec(handle.trim());
  return match ? match[1]! : null;
}

/** Hosting names under which every customer gets their own subdomain
 * (alice.github.io and bob.github.io are strangers). A short list, not the
 * public suffix list: it only keeps them out of the card's suggestions. */
const SHARED_HOSTING = new Set([
  "github.io", "gitlab.io", "herokuapp.com", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "web.app", "firebaseapp.com",
  "appspot.com", "azurewebsites.net", "cloudfront.net", "blogspot.com", "wordpress.com", "onrender.com", "fly.dev", "myshopify.com",
  "okta.com", "oktapreview.com", "atlassian.net", "sharepoint.com", "s3.amazonaws.com", "amplifyapp.com", "glitch.me", "repl.co",
]);

/** Whether a host sits under a shared hosting name (alice.github.io), where
 * neighbours are strangers: never added to a login from a bot's request. */
export function onSharedHosting(domain: string): boolean {
  const normalized = normalizeVaultDomain(domain);
  if (!normalized || normalized.startsWith("http://")) return false;
  const labels = normalized.replace(/^\*\./, "").replace(/:\d+$/, "").split(".");
  for (let size = 2; size <= Math.min(3, labels.length); size++) if (SHARED_HOSTING.has(labels.slice(-size).join("."))) return true;
  return false;
}

/** Whether a site a bot asked for may be added to this login from its card
 * ("Also fill it on ..."): an exact host (never a wildcard), not under a
 * shared hosting name, not already covered, and of the same site as one of
 * the login's own bindings. A look-alike (examp1e.com) never is. */
export function siteAddable(domains: readonly string[], site: string | undefined): boolean {
  if (!site || site.startsWith("*.") || site.startsWith("http://") || onSharedHosting(site)) return false;
  if (normalizeVaultDomain(site) !== site || vaultDomainMatches(domains, bindingUrl(site))) return false;
  const own = vaultSiteOf(site);
  return Boolean(own) && domains.some((domain) => !onSharedHosting(domain) && vaultSiteOf(domain) === own);
}

/** The site a binding belongs to, for suggesting a saved login on a
 * request for another address of the same site (accounts.example.com and
 * example.com): its last two labels, three under a country's shared second
 * level (example.co.uk) or a shared hosting name (alice.github.io). Never
 * used to fill: a fill matches the item's own bindings only. */
export function vaultSiteOf(domain: string): string | null {
  const normalized = normalizeVaultDomain(domain);
  if (!normalized) return null;
  if (normalized.startsWith("http://")) return normalized;
  const host = normalized.replace(/^\*\./, "").replace(/:\d+$/, "");
  if (host === "localhost") return host;
  const labels = host.split(".");
  const two = labels.slice(-2).join(".");
  const three = labels.slice(-3).join(".");
  const shared = SHARED_SECOND_LEVEL.test(two) || SHARED_HOSTING.has(two) || SHARED_HOSTING.has(three);
  if (!shared) return two;
  if (SHARED_HOSTING.has(three)) return labels.length >= 4 ? labels.slice(-4).join(".") : null;
  return labels.length >= 3 ? three : null;
}

/** 2026-10-21 (parité R10, ligne 82): the status row a fill writes while it
 * reads 1Password (1Password may ask the person to approve first). The app
 * draws it in the reader's language (src/lib/activity-runs.ts). */
export const ONE_PASSWORD_WAITING = "notice: Waiting for 1Password: approve the request in 1Password on your computer.";

// ── API keys the server injects (2026-10-26) ─────────────────────────────
// An API key item can be sent by Sagax itself on a bot's HTTP request to
// the item's own sites (server/credential-http.ts, agents tool
// vault_http_request): the bot names the handle, the server adds the key to
// the request and the bot never reads it back. Optionally the person also
// exposes it as a variable of their bots' commands
// (server/credential-command-env.ts): that one the bot can read.

/** How the key rides the request: `Authorization: Bearer <key>`, a header
 * the person names, `Authorization: Basic base64(user:key)`, or a query
 * parameter the person names. */
export const VAULT_INJECTION_MODES = ["bearer", "header", "basic", "query"] as const;
export type VaultInjectionMode = (typeof VAULT_INJECTION_MODES)[number];

export interface VaultApiInjection {
  mode: VaultInjectionMode;
  /** header: the header's name (X-Api-Key). */
  header?: string;
  /** query: the parameter's name (api_key). */
  param?: string;
  /** Optional path the requests must start with (/v1), the base URL's path. */
  basePath?: string;
}

const HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const QUERY_PARAM = /^[A-Za-z0-9_.-]{1,64}$/;
const BASE_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,199}$/;
/** Headers a key never replaces: the transport's own and the cookies. */
const RESERVED_HEADERS = new Set([
  "host", "content-length", "transfer-encoding", "connection", "keep-alive", "upgrade", "te", "trailer",
  "proxy-authorization", "proxy-connection", "cookie", "set-cookie",
]);

/** The injection the person chose, checked; a string when it is not one. */
export function parseVaultInjection(raw: unknown): VaultApiInjection | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "Choose how the key is sent.";
  const row = raw as Record<string, unknown>;
  if (!(VAULT_INJECTION_MODES as readonly unknown[]).includes(row.mode)) return "The key is sent as Bearer, a named header, Basic or a query parameter.";
  const mode = row.mode as VaultInjectionMode;
  const out: VaultApiInjection = { mode };
  if (mode === "header") {
    const header = typeof row.header === "string" ? row.header.trim() : "";
    if (!HEADER_NAME.test(header) || RESERVED_HEADERS.has(header.toLowerCase())) return "The header name must be letters, digits and dashes, such as X-Api-Key.";
    out.header = header;
  }
  if (mode === "query") {
    const param = typeof row.param === "string" ? row.param.trim() : "";
    if (!QUERY_PARAM.test(param)) return "The parameter name must be letters, digits, dots, dashes or underscores, such as api_key.";
    out.param = param;
  }
  const basePath = typeof row.basePath === "string" ? row.basePath.trim().replace(/\/+$/, "") : "";
  if (basePath) {
    if (!BASE_PATH.test(basePath) || basePath.split("/").some((segment) => segment === "." || segment === "..")) return "The base path must start with / and hold no dot segment, such as /v1.";
    out.basePath = basePath;
  }
  return out;
}

/** The header a key lands in, lower case (null for a query parameter). */
export function injectionHeader(injection: VaultApiInjection): string | null {
  if (injection.mode === "query") return null;
  return injection.mode === "header" ? injection.header!.toLowerCase() : "authorization";
}

/** A command variable's name: upper case, digits and underscores. */
const COMMAND_VARIABLE = /^[A-Z_][A-Z0-9_]{0,63}$/;
/** Names a shell, the engine or Sagax itself needs: a key never replaces
 * them (the engine would sign in with it, or the shell break). */
const RESERVED_VARIABLES = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "PWD", "OLDPWD", "TERM", "LANG", "TZ", "IFS", "ENV", "BASH_ENV",
  "NODE_OPTIONS", "NODE_PATH", "PYTHONPATH", "PYTHONHOME", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
]);
const RESERVED_VARIABLE_PREFIXES = ["LD_", "DYLD_", "SAGAX_", "ANTHROPIC_", "CLAUDE_", "CODEX_", "ELECTRON_", "GIT_", "NPM_CONFIG_", "BASH_FUNC_"];

/** The variable name the person typed, checked; a string when refused. */
export function parseCommandVariable(raw: unknown): string | null | { error: string } {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return { error: "The variable name must be text." };
  const name = raw.trim();
  if (!name) return null;
  if (!COMMAND_VARIABLE.test(name)) return { error: "The variable name must be upper case letters, digits and underscores, such as EXAMPLE_API_KEY." };
  if (RESERVED_VARIABLES.has(name) || RESERVED_VARIABLE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return { error: `${name} is a name the shell or the engine already uses. Choose another one.` };
  }
  return name;
}
