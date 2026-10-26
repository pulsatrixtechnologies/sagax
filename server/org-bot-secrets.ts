// The organization's team secrets (decision JC, 2026-10-21): one encrypted
// file, org-bot-secrets.enc, sealed with the same vault key as the GitHub
// tokens. An admin of the Perspicax organization assigns each secret to a
// team bot. list() never returns a value. connectorEnv() is for a connector
// process the server starts. shellEnv() is always empty: the bot's own
// shell (and the sandbox) must not see the value.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import {
  MAX_ORG_BOT_SECRETS,
  ORG_BOT_SECRET_ID,
  ORG_BOT_SECRET_KINDS,
  parseBotIds,
  parseInjection,
  type OrgBotSecretPublic,
} from "../shared/org-bot-secrets.ts";
import { writeFileAtomic } from "./atomic.ts";
import type { VaultKeySource } from "./mcp-oauth.ts";

const FILE = "org-bot-secrets.enc";
const AAD = Buffer.from("sagax org-bot-secrets v1");
const VALUE = /^[\x21-\x7e]{1,4096}$/;

const injectionSchema = z.union([
  z.object({ via: z.literal("env"), name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/) }).strict(),
  z.object({ via: z.literal("plugin"), plugin: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/), key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/) }).strict(),
]);

const entrySchema = z.object({
  id: z.string().regex(ORG_BOT_SECRET_ID),
  kind: z.enum(ORG_BOT_SECRET_KINDS),
  label: z.string().min(1).max(80),
  value: z.string().regex(VALUE),
  injection: injectionSchema,
  botIds: z.array(z.string().regex(/^[\w-]{1,128}$/)).min(1).max(20),
  login: z.string().min(1).max(80).optional(),
  addedAt: z.number(),
}).strict();

const documentSchema = z.object({
  version: z.literal(1),
  secrets: z.array(entrySchema).max(MAX_ORG_BOT_SECRETS),
}).strict();

type Stored = z.infer<typeof entrySchema>;
type Document = z.infer<typeof documentSchema>;

export class OrgBotSecretsError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "OrgBotSecretsError";
    this.code = code;
    this.status = status;
  }
}

export type OrgBotSecretChange =
  | { op: "add"; kind: "secret" | "serviceAccount"; label: string; value: string; injection: Stored["injection"]; botIds: string[]; login?: string }
  | { op: "remove"; id: string }
  | { op: "assign"; id: string; botIds: string[] }
  | { op: "replace"; id: string; value: string };

const CHANGE_KEYS: Record<OrgBotSecretChange["op"], readonly string[]> = {
  add: ["op", "kind", "label", "value", "injection", "botIds", "login"],
  remove: ["op", "id"],
  assign: ["op", "id", "botIds"],
  replace: ["op", "id", "value"],
};

function plain(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  return value as Record<string, unknown>;
}

function labelOf(value: unknown): string {
  if (typeof value !== "string") throw new OrgBotSecretsError("The label must be 1 to 80 characters.", "invalid_label");
  let label = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) label += char;
  }
  label = label.trim();
  if (!label || label.length > 80) throw new OrgBotSecretsError("The label must be 1 to 80 characters.", "invalid_label");
  return label;
}

function secretValue(value: unknown): string {
  if (typeof value !== "string" || !VALUE.test(value.trim())) {
    throw new OrgBotSecretsError("The secret must be a single line of printable characters.", "invalid_value");
  }
  return value.trim();
}

/** One explicit change. A replace cannot rename, and an assign cannot carry the value. */
export function parseOrgBotSecretChange(value: unknown, teamBot: (botId: string) => boolean): OrgBotSecretChange {
  const row = plain(value);
  const op = row?.op;
  if (!row || (op !== "add" && op !== "remove" && op !== "assign" && op !== "replace")) {
    throw new OrgBotSecretsError("Send { op: \"add\" }, { op: \"remove\", id }, { op: \"assign\", id, botIds } or { op: \"replace\", id, value }.", "invalid_secret");
  }
  const allowed = CHANGE_KEYS[op];
  if (Object.keys(row).some((key) => !allowed.includes(key))) {
    throw new OrgBotSecretsError("Replacing the secret is a separate step from assigning it.", "invalid_secret");
  }
  if (op === "remove" || op === "assign" || op === "replace") {
    if (typeof row.id !== "string" || !ORG_BOT_SECRET_ID.test(row.id)) throw new OrgBotSecretsError("No secret with that id.", "not_found", 404);
  }
  if (op === "remove") return { op, id: row.id as string };
  if (op === "replace") return { op, id: row.id as string, value: secretValue(row.value) };
  const bots = parseBotIds(row.botIds);
  if (typeof bots === "string") throw new OrgBotSecretsError(bots, "invalid_bot");
  for (const botId of bots) {
    if (!teamBot(botId)) throw new OrgBotSecretsError("A secret is assigned only to a team bot.", "not_team_bot");
  }
  if (op === "assign") return { op, id: row.id as string, botIds: bots };
  if (row.kind !== "secret" && row.kind !== "serviceAccount") throw new OrgBotSecretsError("kind must be secret or serviceAccount.", "invalid_kind");
  const injection = parseInjection(row.injection);
  if (typeof injection === "string") throw new OrgBotSecretsError(injection, "invalid_injection");
  const label = labelOf(row.label);
  const stored = secretValue(row.value);
  if (label === stored || label.includes(stored)) throw new OrgBotSecretsError("The label must not contain the secret.", "invalid_label");
  let login: string | undefined;
  if (row.kind === "serviceAccount") {
    login = labelOf(row.login);
    if (login === stored || login.includes(stored)) throw new OrgBotSecretsError("The login must not contain the secret.", "invalid_label");
  } else if (row.login !== undefined) {
    throw new OrgBotSecretsError("A secret has no login. A service account does.", "invalid_kind");
  }
  return { op, kind: row.kind, label, value: stored, injection, botIds: bots, ...(login ? { login } : {}) };
}

function publicOf(entry: Stored): OrgBotSecretPublic {
  return {
    id: entry.id,
    kind: entry.kind,
    label: entry.label,
    injection: entry.injection,
    botIds: [...entry.botIds],
    ...(entry.login ? { login: entry.login } : {}),
  };
}

export class OrgBotSecrets {
  private readonly file: string;
  private readonly keySource: () => VaultKeySource;
  private cached: Document | null = null;
  private unreadable: string | null = null;
  private loaded = false;

  constructor(dataDir: string, keySource: () => VaultKeySource) {
    this.file = join(dataDir, FILE);
    this.keySource = keySource;
  }

  /** Names, assignments and logins. Never a value. */
  list(): OrgBotSecretPublic[] {
    return this.read().secrets.map(publicOf);
  }

  /** Env for a connector process of this bot. Not for the bot's shell. */
  connectorEnv(botId: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const entry of this.read().secrets) {
      if (entry.injection.via === "env" && entry.botIds.includes(botId)) env[entry.injection.name] = entry.value;
    }
    return env;
  }

  /** Plugin settings for this bot and this plugin. Never log the result. */
  pluginSettings(botId: string, plugin: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const entry of this.read().secrets) {
      if (entry.injection.via === "plugin" && entry.injection.plugin === plugin && entry.botIds.includes(botId)) {
        out[entry.injection.key] = entry.value;
      }
    }
    return out;
  }

  /** The bot's shell, the sandbox and any command the model runs. Always empty. */
  shellEnv(_botId: string): Record<string, string> {
    return {};
  }

  change(change: OrgBotSecretChange): OrgBotSecretPublic[] {
    const document = this.read();
    const secrets = document.secrets.map((entry) => ({ ...entry, botIds: [...entry.botIds], injection: { ...entry.injection } }));
    if (change.op === "add") {
      if (secrets.length >= MAX_ORG_BOT_SECRETS) throw new OrgBotSecretsError(`${MAX_ORG_BOT_SECRETS} team secrets is the limit.`, "too_many");
      let id = "";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const next = `bs_${randomBytes(8).toString("hex")}`;
        if (!secrets.some((entry) => entry.id === next)) { id = next; break; }
      }
      if (!id) throw new OrgBotSecretsError("The secret could not be saved.", "store_unavailable", 503);
      secrets.push({
        id, kind: change.kind, label: change.label, value: change.value, injection: change.injection,
        botIds: change.botIds, ...(change.login ? { login: change.login } : {}), addedAt: Date.now(),
      });
    } else {
      const index = secrets.findIndex((entry) => entry.id === change.id);
      if (index < 0) throw new OrgBotSecretsError("No secret with that id.", "not_found", 404);
      const current = secrets[index]!;
      if (change.op === "remove") secrets.splice(index, 1);
      else if (change.op === "assign") secrets[index] = { ...current, botIds: change.botIds };
      else {
        if (current.label === change.value || current.label.includes(change.value) || (current.login && (current.login === change.value || current.login.includes(change.value)))) {
          throw new OrgBotSecretsError("The label must not contain the secret.", "invalid_label");
        }
        secrets[index] = { ...current, value: change.value };
      }
    }
    this.write({ version: 1, secrets });
    return this.list();
  }

  private read(): Document {
    if (this.loaded) {
      if (this.unreadable || !this.cached) throw new OrgBotSecretsError(this.unreadable ?? "The team secrets could not be read.", "store_unavailable", 503);
      return { version: 1, secrets: this.cached.secrets.map((entry) => ({ ...entry, botIds: [...entry.botIds] })) };
    }
    const source = this.keySource();
    if (source.kind === "unavailable") {
      this.loaded = true;
      this.unreadable = source.reason;
      throw new OrgBotSecretsError(source.reason, "store_unavailable", 503);
    }
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.cached = { version: 1, secrets: [] };
        this.loaded = true;
        return { version: 1, secrets: [] };
      }
      this.loaded = true;
      this.unreadable = "The team secrets could not be read.";
      throw new OrgBotSecretsError(this.unreadable, "store_unavailable", 503);
    }
    try {
      const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
      if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") throw new Error("format");
      const decipher = createDecipheriv("aes-256-gcm", source.key, Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(AAD);
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plainText = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
      const document = documentSchema.parse(JSON.parse(plainText));
      this.cached = document;
      this.loaded = true;
      return { version: 1, secrets: document.secrets.map((entry) => ({ ...entry, botIds: [...entry.botIds] })) };
    } catch (error) {
      if (error instanceof OrgBotSecretsError) throw error;
      this.loaded = true;
      this.unreadable = "The team secrets could not be read.";
      throw new OrgBotSecretsError(this.unreadable, "store_unavailable", 503);
    }
  }

  private write(document: Document): void {
    if (this.unreadable) throw new OrgBotSecretsError(this.unreadable, "store_unavailable", 503);
    let parsed: Document;
    try {
      parsed = documentSchema.parse(document);
    } catch {
      throw new OrgBotSecretsError("The secret could not be saved.", "store_unavailable", 503);
    }
    const source = this.keySource();
    if (source.kind === "unavailable") throw new OrgBotSecretsError(source.reason, "store_unavailable", 503);
    if (!parsed.secrets.length) {
      rmSync(this.file, { force: true });
      this.cached = parsed;
      this.loaded = true;
      return;
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", source.key, iv);
    cipher.setAAD(AAD);
    const data = Buffer.concat([cipher.update(JSON.stringify(parsed), "utf8"), cipher.final()]);
    mkdirSync(join(this.file, ".."), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }), { mode: 0o600 });
    this.cached = parsed;
    this.loaded = true;
  }
}
