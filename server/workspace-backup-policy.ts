import { isMap, isScalar, isSeq, parseAllDocuments, visit as visitYaml } from "yaml";
import { parseStoredConfig } from "./config.ts";
import { WORKSPACE_BACKUP_RECONNECT, type WorkspaceBackupReconnect, type WorkspaceBackupReconnectCategory } from "../shared/workspace-backup.ts";

// Connection sections deliberately stay on the destination as a whole: a
// restored URL must never redirect an API key retained from that device.
// Allowlisting ordinary settings also keeps future/unknown auth fields out.
const PORTABLE_CONFIG_KEYS = [
  "profile", "language", "budgets", "billing", "rooms", "threads",
  "localVm", "features", "browserProfiles",
] as const;

export function portableWorkspaceConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid workspace configuration in backup.");
  const config = parseStoredConfig(value as Parameters<typeof parseStoredConfig>[0]);
  return Object.fromEntries(PORTABLE_CONFIG_KEYS.filter((key) => config[key] !== undefined).map((key) => [key, config[key]]));
}

// Switches that belong to the machine even inside a portable section.
// Computer sharing (lending a computer to this server) opens routes and a
// desktop connector here, so a restored workspace never turns it on or off.
const DESTINATION_FEATURES = ["sharedComputers"] as const;

export function restoredWorkspaceConfig(portable: unknown, destination: unknown): Record<string, unknown> {
  if (!destination || typeof destination !== "object" || Array.isArray(destination)) throw new Error("Invalid destination workspace configuration; connections were not changed.");
  const merged = { ...destination } as Record<string, unknown>;
  for (const key of PORTABLE_CONFIG_KEYS) delete merged[key];
  const restored = { ...merged, ...portableWorkspaceConfig(portable) };
  const own = (destination as { features?: Record<string, unknown> }).features ?? {};
  const features: Record<string, unknown> = { ...(restored.features as Record<string, unknown> | undefined) };
  for (const key of DESTINATION_FEATURES) {
    delete features[key];
    if (own[key] !== undefined) features[key] = own[key];
  }
  if (Object.keys(features).length) restored.features = features;
  else delete restored.features;
  return restored;
}

/** Exact app-owned authentication paths, not a scan of user document text. */
export function excludedWorkspaceAuthPath(path: string): boolean {
  // Machine/provider-specific execution grants are not portable template data.
  if (/^command-allowlist\.json(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  // MCP sign-in tokens belong to this machine's browser sign-ins.
  if (/^mcp-oauth\.json(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  // Sagax keeps them encrypted in mcp-oauth.enc, under the key in
  // mcp-oauth.key on a headless server (server/mcp-oauth.ts).
  if (/^mcp-oauth\.(?:enc|key)(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  // Organization GitHub access tokens (server/org-github-tokens.ts).
  if (/^org-github-tokens\.enc(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  // Team secrets of the organization (server/org-bot-secrets.ts).
  if (/^org-bot-secrets\.enc(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  // File-backed provider keys (server/engine-api-keys.ts), solo and per person.
  if (/^engine-api-keys\.(?:enc|json)(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  if (/^principals\/[^/]+\/engine-api-keys\.enc(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  // Hermes reads `.env` itself. A verification server's home is the data
  // directory, and a turn's private home lives under engine-policies.
  if (/(?:^|\/)\.hermes\/\.env$/.test(path)) return true;
  if (/^engine-policies\/hermes-(?:solo|org)\/\.env$/.test(path)) return true;
  return /^(?:(?:providers|caddy|chrome-profile|\.agent-browser)(?:\/|$)|workspace-credentials\.json$|external-runtimes\.json$|browser-engine-key$)/.test(path) ||
    /^(?:config\.json|webhooks\.json|workspace-credentials\.json|external-runtimes\.json|browser-engine-key|sessions\.json|tunnel-account\.json|idp-grants\.enc|idp-grants\.key)\.\d+(?:\.[0-9a-f-]+)?\.tmp$/.test(path) ||
    /^(?:vm-home|vm-homes\/[^/]+)\/\.browser-profiles(?:\/|$)/.test(path);
}

/** The Organization library files Electron main downloads and verifies
 * (docs/desktop-library.md): the catalog, a catalog write in progress, and the
 * cached release files. Main fetches them again from Admin, and sign-out
 * deletes them, so a backup never keeps an Organization's package bytes. The
 * runtime's own `org-library/state.json` and `presets.json` are backed up. Like
 * the hook tokens below, an archive that holds them still restores. */
export function redownloadedOrgLibraryPath(path: string): boolean {
  return /^org-library\/(?:catalog\.json(?:\.[0-9a-f-]{36}\.tmp)?$|blobs(?:\/|$))/.test(path);
}

/** Per-turn engine hook bearers (`hook-tokens/<digest>.token`, written by the
 * Claude driver). They are dead once their turn settles, so they are never
 * exported. Unlike the saved auth paths above they are not refused on import:
 * v0.1.85 did export them, and such a backup must still restore, without them.
 * The same holds for the session registry's markers (open, unsynced): they describe the
 * process that wrote them, so they are never exported or installed, and a restore
 * leaves the destination's own markers where they are (workspace-backup.ts). */
export function ephemeralWorkspaceTokenPath(path: string): boolean {
  // The server log window (server/server-log-ring.ts) belongs to the machine
  // and the process that wrote it, like the marker.
  // The internal bearers handed to a turn (`comms-tokens/<digest>.token`,
  // server/drivers/spawn-contract.ts) die with it like the hook tokens.
  return /^(?:hook-tokens(?:\/|$)|comms-tokens(?:\/|$)|server-log(?:\/|$)|sessions\.json\.(?:open|unsynced)$)/.test(path);
}

/** A bot's DuckDB database (`bots/<id>/data.duckdb`, its WAL, its spill
 * directory; server/data/engine.ts), and the same for each derived Data
 * scope (`data-scopes/<id>/<scope>/`, server/data/scope.ts) plus the
 * transient folder a confined https load downloads into. Copying the file
 * while the engine holds it open is not a consistent snapshot (an unflushed
 * WAL), it can run to gigabytes, and every table in it came from a source
 * the bot can load again. The sheet beside it (sheet.json) is backed up,
 * except a confidential thread's (confidentialDataScopePath below). */
export function liveDataEnginePath(path: string): boolean {
  return /^(?:bots\/[^/]+|data-scopes\/[^/]+\/[^/]+)\/(?:data\.duckdb(?:\.wal)?$|data-tmp(?:\/|$)|data-downloads(?:\/|$))/.test(path);
}

/** A confidential thread's own Data scope (`data-scopes/<botId>/t-<hash>/`,
 * server/data/scope.ts): its sheet, its database, its downloads and anything
 * else that lands in that folder. A confidential thread leaves no trace in a
 * workspace backup (docs/confidential-threads.md), and only a confidential
 * thread ever gets a thread scope, so the whole folder is left out whether
 * or not the roster still names the thread (a deleted thread not yet wiped,
 * a thread made confidential later). The match ignores case, so a
 * differently cased archive path cannot slip through on a case-insensitive
 * disk. Like the hook tokens above, an archive from a release that did
 * export it still restores, without it: the folder is never installed, so a
 * restored thread id never hands its sheet to another person. */
export function confidentialDataScopePath(path: string): boolean {
  return /^data-scopes\/[^/]+\/t-[^/]*(?:\/|$)/i.test(path);
}

/** The engine homes inside the data folder (server/engine-transcripts.ts
 * dataEngineHomes): a person's engine folders (`principals/<id>/<engine>`,
 * `principals/<id>/<driver>-key`), the organization's key homes
 * (`org/<driver>-key`) and the homes Sagax owns for withheld turns
 * (`engine-policies/<name>`). `providers/` never leaves at all. */
const ENGINE_HOME = /^(?:principals\/[^/]+\/[^/]+|org\/[^/]+|engine-policies\/[^/]+)\/(.+)$/i;

/** File names an engine CLI keeps a sign-in in, anywhere in its home (the
 * CLI's own folder may sit under a HOME Sagax set: `grok/.grok/auth.json`):
 * - `.credentials.json`: Claude Code's OAuth tokens and MCP sign-ins off
 *   macOS's keychain; Codex's MCP sign-ins (file store).
 * - `auth.json`: Codex (ChatGPT tokens or API key), Grok Build, pi, OpenCode,
 *   Hermes (a link to the source home's), Droid, Cursor Agent off macOS.
 * - `mcp_credentials.json` (Grok), `mcp-auth.json` and `account.json`
 *   (OpenCode), `oauth_creds.json`, `google_accounts.json` and
 *   `mcp-oauth-tokens*.json` (Gemini, Qwen), `secrets.json` (Cline),
 *   `auth.encrypted` (Droid).
 * - `.env`: Hermes, Gemini and Qwen read provider keys from it.
 * - `.pulsabot-login.json`: Sagax's own « signed in » marker
 *   (server/principal-engine-logins.ts). It goes with the sign-in it vouches
 *   for, so a restored person shows « Sign in » rather than a dead login.
 * - `.claude.json.backup*`: Claude Code's copies of `.claude.json`, which
 *   hold the account and any API key (`.claude.json` itself is copied
 *   without them: withoutEngineAuthFields).
 * - the tools' own sign-ins a CLI or the person may leave in that HOME
 *   (credentialFileName below): `.netrc`, `.git-credentials`, `.pypirc`
 *   and the like, `credentials` (AWS), SSH private keys, and any
 *   `.pem`, `.p12`, `.pfx`, `.enc` or `.key` file.
 * Each also with any suffix a copy, an atomic write or a lock leaves beside
 * it (`.bak`, `.lock`, `.tmp`, `.1.tmp`, `~`). */
const ENGINE_CREDENTIAL_FILE = /^(?:\.credentials\.json|auth\.json|auth\.encrypted|mcp_credentials\.json|mcp-auth\.json|account\.json|oauth_creds\.json|google_accounts\.json|mcp-oauth-tokens(?:-v\d+)?\.json|secrets\.json|\.env|\.pulsabot-login\.json|credentials(?:\.json)?|[^/]*\.(?:pem|p12|pfx|enc|keys?))(?:~|[.-](?:bak|backup|old|orig|prev|previous|save|swp|lock|tmp)(?:[.~-][\w.~-]*)?|\.\d+(?:\.[0-9a-f-]+)?\.tmp)?$|^\.claude\.json\.(?:backup|bak)(?:[.-][\w.-]*)?$/i;

/** Files that are a sign-in and nothing else, wherever they sit (an engine
 * home, a conversation's work folder, a project): `.netrc` (`_netrc` on
 * Windows), `.git-credentials`, `.pypirc`, `.pgpass`, and SSH private keys
 * (`id_rsa`, `id_ed25519`..., not their `.pub`), with any copy or lock
 * suffix. A project's `.npmrc` and `.yarnrc.yml` are kept without their
 * registry tokens (registrySettingsPath). */
const CREDENTIAL_FILE = /^(?:[._]netrc|\.git-credentials|\.pypirc|\.pgpass|id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?)(?:~|[.-](?:bak|backup|old|orig|prev|previous|save|swp|lock|tmp)(?:[.~-][\w.~-]*)?|\.\d+(?:\.[0-9a-f-]+)?\.tmp)?$/i;

export function credentialFileName(name: string): boolean {
  return CREDENTIAL_FILE.test(name);
}

/** Folders that are a sign-in as a whole: Kimi Code's `credentials/`
 * (`credentials/kimi-code.json`), a desktop keyring a CLI may fall back to
 * (`.local/share/keyrings`, `python_keyring`). */
const ENGINE_CREDENTIAL_FOLDER = /^(?:keyrings|python_keyring|\.ssh|\.aws|\.azure|\.docker|\.kube|\.gnupg)$/i;
/** A folder that is a sign-in at its usual place only: Kimi's
 * `credentials/` at the home's root or in the CLI's own folder, GitHub CLI's
 * `.config/gh/` (a skill named `gh` stays). */
const engineCredentialFolderAt = (parts: string[], i: number): boolean =>
  ENGINE_CREDENTIAL_FOLDER.test(parts[i]!) ||
  (/^credentials$/i.test(parts[i]!) && (i === 0 || (i === 1 && parts[0]!.startsWith(".")))) ||
  (/^gh$/i.test(parts[i]!) && i > 0 && /^\.config$/i.test(parts[i - 1]!));

/** An engine's saved sign-in in an engine home of the data folder (JC,
 * 2026-10-18: « Exclure les jetons »). A workspace backup keeps each
 * engine's settings, skills and sessions, never its tokens or keys: after a
 * restore each person signs in to their engines again. Like the hook tokens
 * above, an archive from a release that did export them still restores,
 * without them (a restore never installs them). The match ignores case, so
 * a differently cased archive path cannot slip through on a
 * case-insensitive disk. */
export function engineCredentialPath(path: string): boolean {
  const rest = ENGINE_HOME.exec(path)?.[1];
  if (!rest) return false;
  const parts = rest.split("/");
  if (parts.slice(0, -1).some((_, i) => engineCredentialFolderAt(parts, i))) return true;
  const name = parts[parts.length - 1]!;
  // a `.env` template names variables and holds no value of them
  if (/^\.env\.(?:example|sample|template|dist)$/i.test(name)) return false;
  return ENGINE_CREDENTIAL_FILE.test(name) || CREDENTIAL_FILE.test(name) || engineCredentialFolderAt(parts, parts.length - 1);
}

/** An engine's settings file in an engine home, by name: Claude Code's
 * `.claude.json`, `settings.json` and `settings.local.json`, Codex, Grok and
 * Kimi `config.toml`, Hermes `config.yaml`, pi `models.json`, OpenCode
 * `opencode.json`, Droid and Qwen `settings.json`, the MCP files (`mcp.json`,
 * `.mcp.json`, `mcp_config.json`, Cline's `cline_mcp_settings.json`). They
 * are copied, without their secrets (withoutEngineSecrets). */
const ENGINE_SETTINGS_FILE = /^(?:\.claude\.json|settings(?:\.local)?\.json|config\.(?:json|toml|ya?ml)|models\.json|opencode\.jsonc?|\.?mcp\.json|mcp_config\.json|cline_mcp_settings\.json)$/i;

export function engineSettingsPath(path: string): boolean {
  const rest = ENGINE_HOME.exec(path)?.[1];
  return !!rest && ENGINE_SETTINGS_FILE.test(rest.split("/").pop()!);
}

/** Words that make a field name a secret wherever they sit in it
 * (`openai_api_key`, `github_token`, `apiToken`, `GITHUB_PAT`,
 * `db_password`, `credentials`): the name is cut into words (snake, kebab,
 * dotted, camel case) and searched, never matched whole. */
const SECRET_WORDS = new Set([
  "secret", "secrets", "password", "passwords", "passwd", "passphrase", "credential", "credentials",
  "authorization", "cookie", "cookies", "bearer", "pat", "apikey", "apikeys", "apitoken", "authtoken",
  "accesstoken", "refreshtoken", "idtoken", "privatekey", "sessionkey", "clientsecret",
]);
/** `<word> key` is a secret for these words anywhere in the name
 * (`primaryApiKey`, `customApiKeyResponses`); a name that ends with `key`
 * or `keys` is one too (`key`, `OPENAI_KEY`, `groqKey`), except after these
 * words, which name a lookup or a keyboard key. */
const KEY_QUALIFIERS = new Set(["api", "private", "secret", "access", "signing", "encryption", "client", "license", "master", "session", "auth"]);
const NOT_SECRET_KEY = new Set(["tool", "model", "provider", "sort", "cache", "partition", "primary", "foreign", "hot", "short", "shortcut", "keyboard", "group", "dedupe", "idempotency", "lookup", "public", "map", "object", "storage", "routing", "row", "column", "index", "unique", "composite", "join", "hash"]);
/** `token` and `tokens` also count text (`max_tokens`,
 * `model_auto_compact_token_limit`): with one of these words the name is a
 * number, not a secret. */
const TOKEN_COUNT_WORDS = new Set([
  "max", "min", "limit", "limits", "budget", "count", "threshold", "window", "context", "output", "input", "reasoning",
  "thinking", "total", "per", "usage", "compact", "cache", "cached", "prompt", "completion", "estimate", "ratio",
  "rate", "length", "size", "num", "tokenizer",
]);
/** A name that ends with one of these words points at a secret kept
 * elsewhere or describes it (`api_key_env`, `bearer_token_env_var`,
 * `envKey`, `apiKeyHelper`, `token_url`, `token_type`); any word `env`
 * does too. */
const SECRET_REFERENCE_WORDS = new Set([
  "env", "var", "vars", "file", "files", "path", "paths", "helper", "command", "cmd", "url", "uri", "endpoint",
  "type", "name", "names", "ref", "header", "source", "provider", "mode", "kind", "format", "at", "expiry",
  "expires", "expiration", "ttl", "lifetime", "scope", "scopes", "audience", "issuer", "required", "enabled",
]);

/** A field that holds a secret by its name: an API key, a token, a client
 * secret, a password, an authorization header, Claude Code's account and
 * key approvals, anywhere in the name. Names that point at a secret
 * elsewhere (`api_key_env`, `bearer_token_env_var`, `envKey`) or count
 * tokens (`max_tokens`) do not match. */
export function secretFieldName(name: string): boolean {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length || words.includes("env") || SECRET_REFERENCE_WORDS.has(words[words.length - 1]!)) return false;
  return words.some((word, i) =>
    SECRET_WORDS.has(word) ||
    ((word === "token" || word === "tokens") && !words.some((other) => TOKEN_COUNT_WORDS.has(other))) ||
    ((word === "key" || word === "keys") && ((i > 0 && KEY_QUALIFIERS.has(words[i - 1]!)) || (i === words.length - 1 && !(i > 0 && NOT_SECRET_KEY.has(words[i - 1]!))))) ||
    (word === "account" && words[i - 1] === "oauth"));
}

/** A value that is a secret by its shape, whatever its field is called (an
 * MCP server's `args`, a URL): OpenAI, Anthropic, Stripe, GitHub, GitLab,
 * Slack, AWS, Google, xAI, Groq, Hugging Face, Fireworks, Replicate, NVIDIA,
 * Tavily, Perplexity, Cerebras, npm and PyPI keys, a JWT, an `Authorization` value, a PEM
 * private key, a URL with a password in it. */
const SECRET_VALUE = /(?:\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bglpat-[A-Za-z0-9_-]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{30,}|\bxai-[A-Za-z0-9]{20,}|\b(?:gsk|hf|fw|r8|nvapi|tvly|pplx|csk|whsec|xapp|shpat|dop_v1|npm|glc|sq0atp)[_-][A-Za-z0-9]{20,}|\bpypi-[A-Za-z0-9_-]{50,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@)/;

export function secretValue(value: string): boolean {
  return SECRET_VALUE.test(value);
}

/** Maps whose every value is left out: an MCP server's or an engine's
 * environment and request headers. Their names stay readable in the
 * reconnect list (the engine settings line), their values never travel. */
const SECRET_MAP = /^(?:env|environment|headers|http[_-]?headers|env[_-]?vars?|docker[_-]?env|container[_-]?env)$/i;

const secretKey = (key: string, item: unknown): boolean =>
  secretFieldName(key) && item !== null && item !== "" && item !== undefined && typeof item !== "number" && typeof item !== "boolean";

/** A command-line flag that names a secret (`--api-key`, `--token`,
 * `-p`assword forms aside): the argument after it is its value, and
 * `--api-key=<value>` holds it. */
const secretFlag = (arg: string): "next" | "inline" | null => {
  const flag = /^--?([A-Za-z][\w.-]*)(=.*)?$/.exec(arg);
  if (!flag || !secretFieldName(flag[1]!)) return null;
  return flag[2] ? "inline" : "next";
};

/** The positions of an argument list that hold a secret: a value shaped like
 * one, a `--secret=value`, and the argument after a `--secret` flag. */
function secretArgs(items: readonly unknown[]): Set<number> {
  const drop = new Set<number>();
  items.forEach((item, i) => {
    if (typeof item !== "string") return;
    if (SECRET_VALUE.test(item)) drop.add(i);
    // `NAME=value` (docker run -e) and `Name: value` (a --header) of a secret name
    const pair = /^([A-Za-z_][\w.-]*)\s*(?:=|:\s)\s*\S/.exec(item);
    if (pair && !item.startsWith("-") && secretFieldName(pair[1]!)) drop.add(i);
    const flag = secretFlag(item);
    if (flag === "inline") drop.add(i);
    else if (flag === "next" && typeof items[i + 1] === "string" && !(items[i + 1] as string).startsWith("-")) drop.add(i + 1);
  });
  return drop;
}

function scrubJson(value: unknown): number {
  let removed = 0;
  if (Array.isArray(value)) {
    const drop = secretArgs(value);
    for (let i = value.length - 1; i >= 0; i--) {
      if (drop.has(i)) { value.splice(i, 1); removed++; }
      else removed += scrubJson(value[i]);
    }
    return removed;
  }
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const item = record[key];
    if (secretKey(key, item) || (typeof item === "string" && SECRET_VALUE.test(item))) {
      delete record[key];
      removed++;
    } else if (SECRET_MAP.test(key) && Array.isArray(item)) {
      removed += item.length;
      item.length = 0;
    } else if (SECRET_MAP.test(key) && item && typeof item === "object") {
      const map = item as Record<string, unknown>;
      for (const name of Object.keys(map)) { delete map[name]; removed++; }
    } else if (SECRET_MAP.test(key) && typeof item === "string" && item) {
      delete record[key];
      removed++;
    } else removed += scrubJson(item);
  }
  return removed;
}

// A small TOML reader: enough to find where a key's value ends (strings of
// the four kinds, arrays and inline tables over several lines, comments)
// and to rewrite an array or inline table without its secrets.
const TOML_TABLE = /^\s*\[\[?\s*((?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\]"'])+?)\s*\]\]?\s*(?:#.*)?$/;

function tomlStringEnd(s: string, i: number): number {
  if (s.startsWith('"""', i) || s.startsWith("'''", i)) {
    const quote = s.slice(i, i + 3);
    for (let j = i + 3; j < s.length; j++) {
      if (quote === '"""' && s[j] === "\\") { j++; continue; }
      if (s.startsWith(quote, j)) { let end = j + 3; while (s[end] === quote[0] && end < j + 5) end++; return end; }
    }
    return -1;
  }
  const quote = s[i]!;
  for (let j = i + 1; j < s.length; j++) {
    if (quote === '"' && s[j] === "\\") { j++; continue; }
    if (s[j] === "\n") return -1;
    if (s[j] === quote) return j + 1;
  }
  return -1;
}

function tomlSkip(s: string, i: number, lines: boolean): number {
  for (;;) {
    while (i < s.length && (s[i] === " " || s[i] === "\t" || s[i] === "\r" || (lines && (s[i] === "\n" || s[i] === ",")))) i++;
    if (lines && s[i] === "#") { while (i < s.length && s[i] !== "\n") i++; continue; }
    return i;
  }
}

/** The index just past the TOML value at i, or -1 when it is not complete. */
function tomlValueEnd(s: string, i: number): number {
  const c = s[i];
  if (c === '"' || c === "'") return tomlStringEnd(s, i);
  if (c === "[" || c === "{") {
    const close = c === "[" ? "]" : "}";
    let j = i + 1;
    for (;;) {
      j = tomlSkip(s, j, true);
      if (j >= s.length) return -1;
      if (s[j] === close) return j + 1;
      if (c === "{") {
        const eq = tomlKeyEnd(s, j);
        if (eq < 0) return -1;
        j = tomlSkip(s, eq + 1, false);
      }
      const end = tomlValueEnd(s, j);
      if (end < 0) return -1;
      j = end;
    }
  }
  let j = i;
  while (j < s.length && !/[,\]}\n#]/.test(s[j]!)) j++;
  return j > i ? j : -1;
}

/** The index of the `=` after the key at i, or -1. */
function tomlKeyEnd(s: string, i: number): number {
  for (let j = i; j < s.length; j++) {
    if (s[j] === '"' || s[j] === "'") { const end = tomlStringEnd(s, j); if (end < 0) return -1; j = end - 1; continue; }
    if (s[j] === "=") return j;
    if (s[j] === "\n" || s[j] === "#") return -1;
  }
  return -1;
}

function tomlKeyParts(key: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let j = 0; j < key.length; j++) {
    if (key[j] === '"' || key[j] === "'") { const end = tomlStringEnd(key, j); if (end < 0) break; current += key.slice(j + 1, end - 1); j = end - 1; }
    else if (key[j] === ".") { parts.push(current.trim()); current = ""; }
    else current += key[j];
  }
  parts.push(current.trim());
  return parts;
}

const secretTomlKey = (parts: string[]) => parts.some((part) => secretFieldName(part) || SECRET_MAP.test(part));

/** A TOML value without its secrets, rewritten on one line when it changes;
 * null when the value itself is one. */
function scrubTomlValue(text: string, count: { removed: number }): string | null {
  const c = text[0];
  if (c === '"' || c === "'") return SECRET_VALUE.test(text) ? null : text;
  if (c !== "[" && c !== "{") return text;
  const items: string[] = [];
  let changed = false;
  let j = 1;
  for (;;) {
    j = tomlSkip(text, j, true);
    if (j >= text.length || text[j] === "]" || text[j] === "}") break;
    if (c === "{") {
      const eq = tomlKeyEnd(text, j);
      const start = tomlSkip(text, eq + 1, false);
      const end = tomlValueEnd(text, start);
      const key = text.slice(j, eq).trim();
      j = end;
      if (secretTomlKey(tomlKeyParts(key))) { count.removed++; changed = true; continue; }
      const value = scrubTomlValue(text.slice(start, end).trim(), count);
      if (value === null) { count.removed++; changed = true; continue; }
      if (value !== text.slice(start, end).trim()) changed = true;
      items.push(`${key} = ${value}`);
    } else {
      const end = tomlValueEnd(text, j);
      const raw = text.slice(j, end).trim();
      j = end;
      const value = scrubTomlValue(raw, count);
      if (value === null) { count.removed++; changed = true; continue; }
      if (value !== raw) changed = true;
      items.push(value);
    }
  }
  if (c === "[") {
    // an argument list: the value after a `--token` flag goes with it
    const drop = secretArgs(items.map((item) => /^(?:"(?:[^"\\]|\\.)*"|'[^']*')$/.test(item) ? item.slice(1, -1) : null));
    if (drop.size) {
      count.removed += drop.size;
      return `[${items.filter((_, i) => !drop.has(i)).join(", ")}]`;
    }
  }
  if (!changed) return text;
  return c === "{" ? (items.length ? `{ ${items.join(", ")} }` : "{}") : `[${items.join(", ")}]`;
}

/** A TOML settings file without its secret fields, whatever their form: a
 * plain or dotted key (`api_key`, `providers.x.api_key`), a field of an
 * inline table (`{ api_key = "..." }`), every key of an env or header table
 * (`[mcp_servers.x.env]`, `mcp_servers.x.env = { ... }`,
 * `http_headers = { ... }`), a value shaped like a key in an array
 * (`args = ["--token", "ghp_..."]`), and a multi-line value with its key.
 * A value it cannot read to its end throws: the file is left out whole. */
function scrubToml(text: string): { text: string; removed: number } {
  const lines = text.split("\n");
  const out: string[] = [];
  const count = { removed: 0 };
  let secretTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) { out.push(line); continue; }
    if (trimmed.startsWith("[")) {
      const table = TOML_TABLE.exec(line);
      if (!table) throw new Error("Unreadable TOML table header.");
      secretTable = secretTomlKey(tomlKeyParts(table[1]!));
      out.push(line);
      continue;
    }
    const eq = tomlKeyEnd(line, 0);
    if (eq < 0) throw new Error("Unreadable TOML line.");
    let chunk = line;
    const start = tomlSkip(line, eq + 1, false);
    let end = tomlValueEnd(chunk, start);
    while (end < 0 && i + 1 < lines.length) { chunk += `\n${lines[++i]}`; end = tomlValueEnd(chunk, start); }
    if (end < 0) throw new Error("Unterminated TOML value.");
    if (secretTable || secretTomlKey(tomlKeyParts(line.slice(0, eq)))) { count.removed++; continue; }
    const raw = chunk.slice(start, end).trim();
    const value = scrubTomlValue(raw, count);
    if (value === null) { count.removed++; continue; }
    out.push(value === raw ? chunk : `${line.slice(0, eq).trimEnd()} = ${value}`);
  }
  return { text: out.join("\n"), removed: count.removed };
}

/** A YAML settings file (Hermes `config.yaml`) without its secrets, read
 * with a YAML parser so that every form counts (block and flow mappings,
 * quoted keys, multi-line and folded values, sequences under an env or
 * header key) and written back in place, its comments kept. A file the
 * parser refuses, or one whose alias pointed at a removed secret, throws:
 * it is left out whole. */
function scrubYaml(text: string): { text: string; removed: number } {
  const docs = parseAllDocuments(text);
  if (!Array.isArray(docs)) return { text, removed: 0 };
  if (docs.some((doc) => doc.errors.length)) throw new Error("Unreadable YAML.");
  let removed = 0;
  for (const doc of docs) {
    if (isScalar(doc.contents) && typeof doc.contents.value === "string" && SECRET_VALUE.test(doc.contents.value)) throw new Error("A YAML document that is a secret.");
    visitYaml(doc, {
      Pair(_, pair) {
        const key = isScalar(pair.key) ? String(pair.key.value) : null;
        if (key === null) return undefined;
        const value = pair.value;
        const plain = isScalar(value) ? value.value : undefined;
        if (SECRET_MAP.test(key)) {
          if ((isMap(value) || isSeq(value)) && value.items.length) { removed += value.items.length; value.items = []; return visitYaml.SKIP; }
          if (isScalar(value) && plain !== null && plain !== "") { removed++; return visitYaml.REMOVE; }
          return undefined;
        }
        if (secretFieldName(key) && !(isScalar(value) && (plain === null || plain === "" || typeof plain === "number" || typeof plain === "boolean")) && value !== null) {
          removed++;
          return visitYaml.REMOVE;
        }
        if (typeof plain === "string" && SECRET_VALUE.test(plain)) { removed++; return visitYaml.REMOVE; }
        return undefined;
      },
      Seq(_, seq) {
        const drop = secretArgs(seq.items.map((item) => isScalar(item) ? item.value : undefined));
        if (!drop.size) return undefined;
        removed += drop.size;
        seq.items = seq.items.filter((_, i) => !drop.has(i));
        return undefined;
      },
    });
  }
  return { text: removed ? docs.map((doc) => doc.toString()).join("") : text, removed };
}

/** An engine settings file (engineSettingsPath) without its secrets: API
 * keys, tokens, passwords, Claude Code's account and key approvals, values
 * shaped like a key, and the values of every env and header map (an MCP
 * server's included). Null when it holds none. Throws on a file that does
 * not parse: such a file is left out whole. */
export function withoutEngineSecrets(path: string, text: string): string | null {
  const name = path.split("/").pop()!.toLowerCase();
  if (name.endsWith(".toml")) {
    const result = scrubToml(text);
    return result.removed ? result.text : null;
  }
  if (/\.ya?ml$/.test(name)) {
    const result = scrubYaml(text);
    return result.removed ? result.text : null;
  }
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object") throw new Error("Not a settings object.");
  return scrubJson(value) ? JSON.stringify(value, null, 2) : null;
}

/** A project's or a home's npm and Yarn settings (`.npmrc`, `.yarnrc.yml`),
 * anywhere: copied without their registry tokens and passwords
 * (withoutRegistrySecrets), so a project keeps its registry settings. */
export function registrySettingsPath(path: string): boolean {
  return /(?:^|\/)(?:\.npmrc|\.yarnrc\.yml)$/i.test(path);
}

const NPMRC_SECRET = /^(?:_auth|_authToken|_password|username|email|certfile|keyfile|npmAuthToken|npmAuthIdent|npmPassword)$/i;

/** `.npmrc` or `.yarnrc.yml` without its tokens, passwords and logins
 * (`//registry/:_authToken=...`, `_auth`, `npmAuthToken`); null when it
 * holds none. */
export function withoutRegistrySecrets(path: string, text: string): string | null {
  if (/\.ya?ml$/i.test(path)) {
    const docs = parseAllDocuments(text);
    if (!Array.isArray(docs)) return null;
    if (docs.some((doc) => doc.errors.length)) throw new Error("Unreadable YAML.");
    let removed = 0;
    for (const doc of docs) visitYaml(doc, {
      Pair(_, pair) {
        const key = isScalar(pair.key) ? String(pair.key.value) : "";
        const plain = isScalar(pair.value) ? pair.value.value : undefined;
        if (NPMRC_SECRET.test(key) || secretFieldName(key) || (typeof plain === "string" && SECRET_VALUE.test(plain))) { removed++; return visitYaml.REMOVE; }
        return undefined;
      },
    });
    return removed ? docs.map((doc) => doc.toString()).join("") : null;
  }
  let removed = 0;
  const kept = text.split("\n").filter((line) => {
    const field = /^\s*([^=#;]+?)\s*=\s*(.*)$/.exec(line);
    if (!field) return true;
    const name = field[1]!.split(":").pop()!.trim();
    if (NPMRC_SECRET.test(name) || secretFieldName(name) || SECRET_VALUE.test(field[2]!)) { removed++; return false; }
    return true;
  });
  return removed ? kept.join("\n") : null;
}

/** A file a bot export (server/bot-zip.ts) leaves out because it is a
 * sign-in or a key whatever folder it sits in: the sign-in files
 * (credentialFileName), an engine's (`.credentials.json`, `auth.json`,
 * `.env` but not its templates), a sealed store (`.enc`), a certificate or
 * private key (`.pem`, `.p12`, `.pfx`), a `.key` that is not a Keynote
 * document (`zip` true when the file starts like a zip), and any file in a
 * `.ssh`, `.aws`, `.gnupg` or `.docker` folder. */
export function exportedSecretFile(relativePath: string, zip: () => boolean): boolean {
  const parts = relativePath.split("/");
  const name = parts[parts.length - 1]!;
  if (parts.slice(0, -1).some((part) => /^(?:\.ssh|\.aws|\.azure|\.gnupg|\.docker|\.kube|keyrings)$/i.test(part))) return true;
  if (/^\.env\.(?:example|sample|template|dist)$/i.test(name)) return false;
  if (CREDENTIAL_FILE.test(name)) return true;
  if (/\.key(?:~|[.-](?:bak|backup|old|orig|prev|previous|save|swp|lock|tmp))?$/i.test(name)) return !zip();
  return ENGINE_CREDENTIAL_FILE.test(name) && !/\.keys?$/i.test(name);
}

/** Claude Code's sign-in fields of `.claude.json`, which a restore puts
 * back from the destination's own copy (carryDestinationSecrets). */
export const CLAUDE_AUTH_FIELDS = ["oauthAccount", "primaryApiKey", "customApiKeyResponses"] as const;

/** Secrets Sagax keeps itself (JC, 2026-10-18 15:55: « Exclure tout »):
 * every sealed store or key, `*.enc` and `*.key` at any depth of the data
 * folder (a person's engine provider keys, personal connections, credential
 * vault, MCP sign-ins and cloud agent keys under `principals/<id>/`; the
 * marketplace Git tokens, revocations pending, the HMAC keys of the agent
 * API, the media proxy, published pages and template links at the top; a
 * bot's or a later store's in a sub-folder), with any suffix a copy, an
 * atomic write or a lock leaves (`.bak`, `.lock`, `.tmp`, `.previous`,
 * `.1.tmp`, `~`), and the phones' push registrations. Never exported, never
 * installed by a restore; an archive from a release that did export them
 * restores without them. The match ignores case. */
const WORKSPACE_SECRET = /^(?:(?:[^/]+\/)*[^/]+\.(?:enc|keys?)(?:~|[.-](?:bak|backup|old|orig|prev|previous|save|swp|lock|tmp)(?:[.~-][\w.~-]*)?|\.\d+(?:\.[0-9a-f-]+)?\.tmp)?|push-devices(?:\/.*)?)$/i;
/** The folders that hold a person's own files rather than the app's: chat
 * attachments, conversation work folders, workspaces (projects, skills) and
 * the local VM homes.
 * A `.key` there is as likely a Keynote document as a key, and a `.enc` a
 * file the person encrypted; only the sign-in files (credentialFileName)
 * are left out of them. */
const PERSON_FILES = /^(?:attachments|task-workspaces|workspaces|vm-home|vm-homes)(?:\/|$)/i;

export function savedSignInPath(path: string): boolean {
  if (engineCredentialPath(path)) return true;
  if (credentialFileName(path.split("/").pop()!)) return true;
  return !PERSON_FILES.test(path) && WORKSPACE_SECRET.test(path);
}

/** A top-level name of the data folder whose secret stays on the
 * destination as it is (keptInPlace): the app regenerates a missing HMAC
 * key at start, and a phone registers again. */
export function destinationSignInFile(name: string): boolean {
  return !name.includes("/") && (WORKSPACE_SECRET.test(name) || credentialFileName(name));
}

/** What a person reconnects after a restore, by category (never a name or
 * a value): the reconnect list of a backup summary. */
export function secretCategory(path: string): WorkspaceBackupReconnectCategory | null {
  const folded = path.toLowerCase();
  if (engineCredentialPath(path)) return "engines";
  const name = folded.split("/").pop()!;
  if (/^engine-api-keys\.(?:enc|json)(?:$|\.)|^workspace-credentials\.json$/.test(name)) return "providerKeys";
  if (/^connections\.enc(?:$|\.)/.test(name)) return "connections";
  if (/^credential-vault\.enc(?:$|\.)/.test(name)) return "credentialVault";
  if (/^mcp-oauth\.(?:enc|json)(?:$|\.)/.test(name)) return "mcp";
  if (/^(?:org-github-tokens|org-bot-secrets|marketplace-tokens)\.enc(?:$|\.)/.test(name)) return "github";
  if (/^cloud-agent-credentials\.enc(?:$|\.)/.test(name)) return "cloudAgents";
  if (/^trigger-poller-credentials\.enc(?:$|\.)/.test(name)) return "triggers";
  if (/^push-devices\/[^/]+\.json$/.test(folded)) return "phones";
  // a sign-in file (`.netrc`, `.npmrc`, an SSH key) or a store in a folder
  if (credentialFileName(name) || (folded.includes("/") && !folded.startsWith("push-devices/") && savedSignInPath(path))) return "files";
  return null;
}

/** Counts by category for the reconnect list: a person's files count once
 * per person, an engine sign-in once per engine home. */
export class ReconnectTally {
  private readonly items = new Map<WorkspaceBackupReconnectCategory, Set<string>>();
  private readonly people = new Map<WorkspaceBackupReconnectCategory, Set<string>>();
  private readonly extra = new Map<WorkspaceBackupReconnectCategory, number>();

  constructor(base?: WorkspaceBackupReconnect) {
    for (const [category, entry] of Object.entries(base ?? {}) as Array<[WorkspaceBackupReconnectCategory, { count: number } | undefined]>) {
      if (entry?.count) this.count(category, entry.count);
    }
  }

  /** One path left out (or scrubbed); its category from secretCategory unless given. */
  path(path: string, category: WorkspaceBackupReconnectCategory | null = secretCategory(path)): void {
    if (!category) return;
    const person = /^principals\/([^/]+)\//i.exec(path)?.[1];
    const home = /^((?:principals\/[^/]+|org|engine-policies)\/[^/]+)/i.exec(path)?.[1];
    const key = category === "engines" || category === "engineSettings" ? (home ?? path).toLowerCase() : path.toLowerCase();
    if (!this.items.has(category)) this.items.set(category, new Set());
    this.items.get(category)!.add(key);
    if (person) {
      if (!this.people.has(category)) this.people.set(category, new Set());
      this.people.get(category)!.add(person.toLowerCase());
    }
  }

  count(category: WorkspaceBackupReconnectCategory, count: number): void {
    if (count > 0) this.extra.set(category, (this.extra.get(category) ?? 0) + count);
  }

  result(): WorkspaceBackupReconnect {
    const out: WorkspaceBackupReconnect = {};
    for (const category of WORKSPACE_BACKUP_RECONNECT) {
      const count = (this.items.get(category)?.size ?? 0) + (this.extra.get(category) ?? 0);
      if (!count) continue;
      const people = this.people.get(category)?.size ?? 0;
      out[category] = people ? { count, people } : { count };
    }
    return out;
  }
}

/** Top-level config sections other than the portable ones that hold a
 * secret (a provider key, a token, a password, an MCP server's env or
 * headers): counted for the reconnect list, never copied. */
export function configSecretCounts(value: unknown): { providerKeys: number; mcp: number } {
  const counts = { providerKeys: 0, mcp: 0 };
  if (!value || typeof value !== "object" || Array.isArray(value)) return counts;
  const holdsSecret = (item: unknown): boolean => {
    if (Array.isArray(item)) return item.some(holdsSecret);
    if (!item || typeof item !== "object") return false;
    return Object.entries(item as Record<string, unknown>).some(([key, inner]) =>
      (secretFieldName(key) && typeof inner === "string" && inner.length > 0) ||
      (typeof inner === "string" && SECRET_VALUE.test(inner)) ||
      (SECRET_MAP.test(key) && !!inner && typeof inner === "object" && Object.keys(inner).length > 0) ||
      (/^key$/i.test(key) && typeof inner === "string" && inner.length > 0) ||
      holdsSecret(inner));
  };
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if ((PORTABLE_CONFIG_KEYS as readonly string[]).includes(key)) continue;
    if (key === "mcpServers" && item && typeof item === "object") {
      counts.mcp += Object.values(item as Record<string, unknown>).filter(holdsSecret).length;
    } else if (key === "instances" && item && typeof item === "object") {
      counts.providerKeys += Object.values(item as Record<string, unknown>).filter(holdsSecret).length;
    } else if (holdsSecret(item)) counts.providerKeys++;
  }
  return counts;
}

/** An engine home's own scratch and caches, which the CLI makes again:
 * Codex `tmp/` (its `tmp/arg0/*` links to the codex binary, outside the
 * workspace, made every backup fail) and `.tmp/`, `.cache/`, and the
 * `Library/Caches/` a CLI run with HOME set there leaves on macOS. */
export function disposableEngineHomePath(path: string): boolean {
  const rest = ENGINE_HOME.exec(path)?.[1];
  return !!rest && /^(?:tmp|\.tmp|\.cache|Library\/Caches)(?:\/|$)/i.test(rest);
}
