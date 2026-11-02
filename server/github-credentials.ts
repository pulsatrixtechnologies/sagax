// One list of GitHub (and other git host) credentials (Capabilities >
// Sources > GitHub, 2026-10-28). It replaces three places that each kept
// tokens of their own:
//
//   - org-github-tokens.enc: the organization's labeled access tokens (an
//     admin's, tried for every member after their own connection);
//   - marketplace-tokens.enc: one token per marketplace, per bot (its owner
//     or a manager) or for the whole installation (`workspace`, an admin);
//   - (unchanged) the person's own GitHub connection
//     (principals/<id>/capabilities.enc, server/github-connect.ts): gh, git,
//     the GitHub MCP and Sagax's own fetches for them.
//
// Here: labeled credentials, each owned by one person (their principal id;
// `local` on a solo server) or by the organization (`org`), and the choice
// of each marketplace (per bot or `workspace`, keyed by source): one
// credential id, or nothing for Automatic. A former per-marketplace token
// becomes a credential labeled with its marketplace, chosen by that
// marketplace, and `onlyWhereChosen` so Automatic never tries it elsewhere:
// each marketplace keeps the same effective credential.
//
// Stored like the files it replaces: one AES-256-GCM file
// (github-credentials.enc, AAD "sagax github-credentials v1") sealed with
// the mcp-oauth vault key, mode 0600, left out of workspace backups. No
// listing returns a token (a label and the last 4 characters at most);
// nothing here logs one. An unreadable file is never replaced with an empty
// one. The migration is idempotent: it marks what it took in, reuses ids, and
// removes an old file only after the new one is written.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import type { VaultKeySource } from "./mcp-oauth.ts";
import { MAX_ORG_GITHUB_TOKENS, orgGithubTokenHint } from "../shared/org-github-tokens.ts";
import { MAX_PERSON_GITHUB_CREDENTIALS, type GithubCredentialPublic, type MarketplaceCredentialView } from "../shared/github-credentials.ts";

const FILE = "github-credentials.enc";
const AAD = Buffer.from("sagax github-credentials v1");
const ID = /^gt_[0-9a-f]{16}$/;
const TOKEN = /^[\x21-\x7e]{8,4096}$/;
const SCOPE = /^[\w-]{1,80}$/;
// oxlint-disable-next-line no-control-regex -- a label must not carry control characters
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_TOTAL = 2000;

/** The owner of the organization's shared credentials. */
export const ORG_OWNER = "org";
/** The owner on a solo server (one person). */
export const LOCAL_OWNER = "local";
/** The marketplace scope of the whole installation ("Everyone"). */
export const WORKSPACE_SCOPE = "workspace";

const credentialSchema = z.object({
  id: z.string().regex(ID),
  label: z.string().min(1).max(80),
  token: z.string().regex(TOKEN),
  owner: z.string().min(1).max(200),
  addedAt: z.number(),
  onlyWhereChosen: z.literal(true).optional(),
}).strict();
const choiceSchema = z.object({ scope: z.string().regex(SCOPE), source: z.string().min(1).max(500), credential: z.string().regex(ID) }).strict();
const usedSchema = z.object({
  scope: z.string().regex(SCOPE),
  source: z.string().min(1).max(500),
  via: z.enum(["person", "credential", "none"]),
  credential: z.string().regex(ID).optional(),
  login: z.string().max(100).optional(),
  at: z.number(),
}).strict();
const documentSchema = z.object({
  version: z.literal(1),
  credentials: z.array(credentialSchema).max(MAX_TOTAL),
  choices: z.array(choiceSchema).max(MAX_TOTAL),
  used: z.array(usedSchema).max(MAX_TOTAL),
  migrated: z.array(z.string().max(80)).max(20),
}).strict();

type Credential = z.infer<typeof credentialSchema>;
type Document = z.infer<typeof documentSchema>;

export class GithubCredentialsError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "GithubCredentialsError";
    this.code = code;
    this.status = status;
  }
}

export type CredentialChange =
  | { op: "add"; label: string; token: string }
  | { op: "remove"; id: string }
  | { op: "rename"; id: string; label: string }
  | { op: "replace"; id: string; token: string };

/** A body sent by a client: one explicit change, and for an add the list it
 * goes to ("mine" by default, "org" for an organization admin). A rename
 * carries no token and a replace no label. */
export function parseCredentialChange(value: unknown): { change: CredentialChange; scope: "mine" | "org" } {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const op = record?.op;
  const bad = () => new GithubCredentialsError("Send { op: \"add\", label, token, scope? }, { op: \"remove\", id }, { op: \"rename\", id, label } or { op: \"replace\", id, token }.", "invalid_change");
  if (!record || (op !== "add" && op !== "remove" && op !== "rename" && op !== "replace")) throw bad();
  const allowed: Record<string, readonly string[]> = { add: ["op", "label", "token", "scope"], remove: ["op", "id"], rename: ["op", "id", "label"], replace: ["op", "id", "token"] };
  if (Object.keys(record).some((key) => !allowed[op]!.includes(key))) throw new GithubCredentialsError("Replacing the secret is a separate step from renaming.", "invalid_change");
  const scope = record.scope === undefined || record.scope === "mine" ? "mine" : record.scope === "org" ? "org" : null;
  if (!scope) throw bad();
  if (op !== "add" && (typeof record.id !== "string" || !ID.test(record.id))) throw new GithubCredentialsError("No credential with that id.", "not_found", 404);
  if (op === "add" || op === "rename") cleanLabel(record.label);
  if (op === "add" || op === "replace") cleanToken(record.token);
  if (op === "add") return { scope, change: { op, label: cleanLabel(record.label), token: cleanToken(record.token) } };
  if (op === "rename") return { scope, change: { op, id: record.id as string, label: cleanLabel(record.label) } };
  if (op === "replace") return { scope, change: { op, id: record.id as string, token: cleanToken(record.token) } };
  return { scope, change: { op, id: record.id as string } };
}

function cleanLabel(value: unknown): string {
  const label = typeof value === "string" ? value.trim() : "";
  if (!label || label.length > 80 || CONTROL.test(label)) throw new GithubCredentialsError("The label must be 1 to 80 characters.", "invalid_label");
  return label;
}

function cleanToken(value: unknown): string {
  const token = typeof value === "string" ? value.trim() : "";
  if (!TOKEN.test(token)) throw new GithubCredentialsError("The token must be a single line of printable characters.", "invalid_token");
  return token;
}

function labelHoldsToken(label: string, token: string): boolean {
  return label === token || label.includes(token);
}

function shortLabel(text: string): string {
  // oxlint-disable-next-line no-control-regex -- strip control characters from a label made of a source
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return (clean.length > 80 ? `${clean.slice(0, 79)}…` : clean) || "Marketplace";
}

/** A stable id for a migrated marketplace token: the same token migrates to
 * the same entry, however often the migration runs. */
function migratedId(scope: string, source: string): string {
  return `gt_${createHash("sha256").update(`${scope}\u0000${source}`).digest("hex").slice(0, 16)}`;
}

/** A credential the server tries for a repository. Never sent to a client. */
export interface CredentialSecret {
  id: string;
  label: string;
  token: string;
  owner: string;
}

export interface CredentialMigrationInput {
  /** The organization's former list (server/org/org-github-tokens.ts). */
  orgTokens?: { list(): Array<{ id: string; label: string }>; tokenFor(id: string): string | undefined; discard(): void };
  /** The former per-marketplace tokens (server/marketplace-tokens.ts). */
  marketplaceTokens?: { all(): Array<{ bot: string; source: string; token: string; addedAt: number; addedBy?: string }>; discard(): void };
  /** Who owns the installation's (workspace) tokens: `org` on an organization server, `local` solo. */
  workspaceOwner: string;
  /** Who owns a bot's token when it does not say who added it. */
  ownerOfBot: (botId: string) => string | undefined;
  botName?: (botId: string) => string | undefined;
  /** The owner when nothing else says (solo: `local`). */
  fallbackOwner: string;
  /** The owner key of a person who added a token (solo: always `local`). */
  personOwner?: (principalId: string) => string;
}

export class GithubCredentials {
  private readonly file: string;
  private readonly keySource: () => VaultKeySource;
  private cached: Document | null = null;
  private unreadable: string | null = null;
  private loaded = false;

  constructor(dataDir: string, keySource: () => VaultKeySource) {
    this.file = join(dataDir, FILE);
    this.keySource = keySource;
  }

  // ── the list ───────────────────────────────────────────────────────────

  /** What `viewer` sees: their own credentials, then the organization's
   * (when `org`). Labels and hints only. */
  list(viewer: string, options: { org: boolean }): GithubCredentialPublic[] {
    const document = this.read();
    const chosenBy = (id: string) => document.choices.filter((choice) => choice.credential === id).length;
    return document.credentials
      .filter((entry) => entry.owner === viewer || (options.org && entry.owner === ORG_OWNER && viewer !== ORG_OWNER))
      .map((entry) => ({
        id: entry.id, label: entry.label, hint: orgGithubTokenHint(entry.token),
        owner: entry.owner === ORG_OWNER ? "org" as const : "mine" as const,
        ...(entry.onlyWhereChosen ? { onlyWhereChosen: true as const } : {}),
        chosenBy: chosenBy(entry.id),
      }))
      .sort((a, b) => (a.owner === b.owner ? 0 : a.owner === "mine" ? -1 : 1));
  }

  /** The stored secret, for the server's own use. Never send it to a client. */
  tokenFor(id: string): string | undefined {
    return this.read().credentials.find((entry) => entry.id === id)?.token;
  }

  ownerOf(id: string): string | undefined {
    return this.read().credentials.find((entry) => entry.id === id)?.owner;
  }

  /** The credentials Automatic tries for `owner` (not the ones kept for one marketplace). */
  automatic(owner: string): CredentialSecret[] {
    return this.read().credentials
      .filter((entry) => entry.owner === owner && !entry.onlyWhereChosen)
      .map(({ id, label, token, owner: who }) => ({ id, label, token, owner: who }));
  }

  /** Apply one change to `owner`'s list. Another owner's credential is not
   * found. Removing one sends the marketplaces that picked it back to Automatic. */
  change(owner: string, change: CredentialChange): void {
    const document = this.read();
    const credentials = document.credentials.map((entry) => ({ ...entry }));
    let choices = document.choices;
    let used = document.used;
    if (change.op === "add") {
      const limit = owner === ORG_OWNER ? MAX_ORG_GITHUB_TOKENS : MAX_PERSON_GITHUB_CREDENTIALS;
      if (credentials.filter((entry) => entry.owner === owner).length >= limit) {
        throw new GithubCredentialsError(`${limit} credentials is the limit.`, "too_many");
      }
      if (labelHoldsToken(change.label, change.token)) throw new GithubCredentialsError("The label must not contain the token.", "invalid_label");
      credentials.push({ id: this.newId(credentials), label: change.label, token: change.token, owner, addedAt: Date.now() });
    } else {
      const index = credentials.findIndex((entry) => entry.id === change.id && entry.owner === owner);
      if (index < 0) throw new GithubCredentialsError("No credential with that id.", "not_found", 404);
      const current = credentials[index]!;
      if (change.op === "remove") {
        credentials.splice(index, 1);
        choices = choices.filter((choice) => choice.credential !== change.id);
        used = used.filter((entry) => entry.credential !== change.id);
      } else if (change.op === "rename") {
        if (labelHoldsToken(change.label, current.token)) throw new GithubCredentialsError("The label must not contain the token.", "invalid_label");
        credentials[index] = { ...current, label: change.label };
      } else {
        if (labelHoldsToken(current.label, change.token)) throw new GithubCredentialsError("The label must not contain the token.", "invalid_label");
        credentials[index] = { ...current, token: change.token };
      }
    }
    this.write({ ...document, credentials, choices, used });
  }

  // ── each marketplace's choice ──────────────────────────────────────────

  /** The credential `scope` (a bot id or `workspace`) picks for `source`. */
  chosen(scope: string, source: string): string | undefined {
    return this.read().choices.find((choice) => choice.scope === scope && choice.source === source)?.credential;
  }

  /** The picked credential's token (server/bot-plugins.ts). */
  get(scope: string, source: string): string | undefined {
    const id = this.chosen(scope, source);
    return id ? this.tokenFor(id) : undefined;
  }

  /** The picked credential with its label, for messages and `used`. */
  chosenSecret(scope: string, source: string): CredentialSecret | undefined {
    const document = this.read();
    const id = document.choices.find((choice) => choice.scope === scope && choice.source === source)?.credential;
    const entry = id ? document.credentials.find((candidate) => candidate.id === id) : undefined;
    return entry ? { id: entry.id, label: entry.label, token: entry.token, owner: entry.owner } : undefined;
  }

  /** Sources `scope` picks a credential for (names only). */
  sourcesFor(scope: string): Set<string> {
    try {
      return new Set(this.read().choices.filter((choice) => choice.scope === scope).map((choice) => choice.source));
    } catch {
      return new Set();
    }
  }

  /** Pick a credential for a marketplace, or (null) go back to Automatic. */
  choose(scope: string, source: string, credential: string | null): void {
    if (!SCOPE.test(scope)) throw new GithubCredentialsError("invalid scope", "invalid_scope");
    const document = this.read();
    if (credential !== null && !document.credentials.some((entry) => entry.id === credential)) {
      throw new GithubCredentialsError("No credential with that id.", "not_found", 404);
    }
    const choices = document.choices.filter((choice) => !(choice.scope === scope && choice.source === source));
    if (credential !== null) choices.push({ scope, source, credential });
    this.write({ ...document, choices });
  }

  /** A marketplace left `scope`: back to Automatic; a credential kept for
   * this marketplace only, and picked by nothing else, goes too. */
  unpick(scope: string, source: string): boolean {
    const document = this.read();
    const current = document.choices.find((choice) => choice.scope === scope && choice.source === source);
    if (!current) return false;
    const choices = document.choices.filter((choice) => choice !== current);
    const entry = document.credentials.find((candidate) => candidate.id === current.credential);
    const orphan = entry?.onlyWhereChosen && !choices.some((choice) => choice.credential === entry.id);
    const credentials = orphan ? document.credentials.filter((candidate) => candidate.id !== entry!.id) : document.credentials;
    this.write({ ...document, credentials, choices });
    return true;
  }

  /** Remember which credential read a marketplace (shown on its row). */
  noteUsed(scope: string, source: string, used: { via: "person" | "credential" | "none"; credential?: string; login?: string }): void {
    if (!SCOPE.test(scope)) return;
    try {
      const document = this.read();
      const previous = document.used.find((entry) => entry.scope === scope && entry.source === source);
      if (previous && previous.via === used.via && previous.credential === used.credential && previous.login === used.login) return;
      const rest = document.used.filter((entry) => !(entry.scope === scope && entry.source === source));
      const next = [...rest, { scope, source, via: used.via, ...(used.credential ? { credential: used.credential } : {}), ...(used.login ? { login: used.login.slice(0, 100) } : {}), at: Date.now() }];
      this.write({ ...document, used: next.slice(-MAX_TOTAL) });
    } catch {
      // the hint is a courtesy: a read never fails for it
    }
  }

  /** What a marketplace row shows to `viewer`: its pick and what read it last. */
  describe(scope: string, source: string, viewer: string): MarketplaceCredentialView {
    let document: Document;
    try { document = this.read(); } catch { return {}; }
    const choice = document.choices.find((entry) => entry.scope === scope && entry.source === source);
    const entry = choice ? document.credentials.find((candidate) => candidate.id === choice.credential) : undefined;
    const used = document.used.find((candidate) => candidate.scope === scope && candidate.source === source);
    const usedLabel = used?.credential ? document.credentials.find((candidate) => candidate.id === used.credential)?.label : undefined;
    return {
      ...(entry ? { chosen: { id: entry.id, label: entry.label, owner: entry.owner === ORG_OWNER ? "org" as const : entry.owner === viewer ? "mine" as const : "other" as const } } : {}),
      ...(used ? { used: { via: used.via, ...(usedLabel ? { label: usedLabel } : {}), ...(used.login ? { login: used.login } : {}), at: used.at } } : {}),
    };
  }

  /** A bot is deleted: its choices go; the credentials stay with their owners. */
  forgetScope(scope: string): void {
    if (scope === WORKSPACE_SCOPE) return;
    const document = this.read();
    if (!document.choices.some((choice) => choice.scope === scope) && !document.used.some((entry) => entry.scope === scope)) return;
    this.write({ ...document, choices: document.choices.filter((choice) => choice.scope !== scope), used: document.used.filter((entry) => entry.scope !== scope) });
  }

  /** A marketplace leaves a scope: its pick goes (a credential kept for it
   * only goes with it). */
  forgetSource(scope: string, source: string): void {
    this.unpick(scope, source);
  }

  // ── migration ──────────────────────────────────────────────────────────

  /** Take in the former files once. Ids, labels and each marketplace's
   * effective credential are kept; an old file is removed only after the
   * new one is written. Safe to run at every start. */
  migrate(input: CredentialMigrationInput): { imported: number } {
    const document = this.read();
    const credentials = document.credentials.map((entry) => ({ ...entry }));
    const choices = [...document.choices];
    const migrated = new Set(document.migrated);
    let imported = 0;
    const done: Array<() => void> = [];

    if (input.orgTokens && !migrated.has("org-github-tokens")) {
      for (const entry of input.orgTokens.list()) {
        const token = input.orgTokens.tokenFor(entry.id);
        if (!token || credentials.some((candidate) => candidate.id === entry.id)) continue;
        credentials.push({ id: entry.id, label: entry.label, token, owner: ORG_OWNER, addedAt: Date.now() });
        imported += 1;
      }
      migrated.add("org-github-tokens");
    }
    if (input.orgTokens && migrated.has("org-github-tokens")) done.push(() => input.orgTokens!.discard());

    if (input.marketplaceTokens && !migrated.has("marketplace-tokens")) {
      for (const entry of input.marketplaceTokens.all()) {
        const scope = entry.bot;
        if (!SCOPE.test(scope) || choices.some((choice) => choice.scope === scope && choice.source === entry.source)) continue;
        const person = entry.addedBy?.trim().toLowerCase() || input.ownerOfBot(scope);
        const owner = scope === WORKSPACE_SCOPE ? input.workspaceOwner : person ? (input.personOwner?.(person) ?? person) : input.fallbackOwner;
        // The same token already kept by this owner for a marketplace: one credential.
        const same = credentials.find((candidate) => candidate.owner === owner && candidate.token === entry.token && candidate.onlyWhereChosen);
        let id = same?.id;
        if (!id) {
          id = migratedId(scope, entry.source);
          if (!credentials.some((candidate) => candidate.id === id)) {
            const bot = scope === WORKSPACE_SCOPE ? undefined : (input.botName?.(scope) ?? scope);
            const name = shortLabel(bot ? `${entry.source} (${bot})` : entry.source);
            credentials.push({ id, label: labelHoldsToken(name, entry.token) ? "Marketplace" : name, token: entry.token, owner, addedAt: entry.addedAt, onlyWhereChosen: true });
            imported += 1;
          }
        }
        choices.push({ scope, source: entry.source, credential: id });
      }
      migrated.add("marketplace-tokens");
    }
    if (input.marketplaceTokens && migrated.has("marketplace-tokens")) done.push(() => input.marketplaceTokens!.discard());

    if (imported || migrated.size !== document.migrated.length || choices.length !== document.choices.length) {
      this.write({ ...document, credentials, choices, migrated: [...migrated] });
    }
    for (const discard of done) discard();
    return { imported };
  }

  // ── file ───────────────────────────────────────────────────────────────

  private newId(existing: readonly Credential[]): string {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const next = `gt_${randomBytes(8).toString("hex")}`;
      if (!existing.some((entry) => entry.id === next)) return next;
    }
    throw new GithubCredentialsError("The credential could not be saved.", "store_unavailable", 503);
  }

  private empty(): Document {
    return { version: 1, credentials: [], choices: [], used: [], migrated: [] };
  }

  private copy(document: Document): Document {
    return {
      version: 1,
      credentials: document.credentials.map((entry) => ({ ...entry })),
      choices: document.choices.map((entry) => ({ ...entry })),
      used: document.used.map((entry) => ({ ...entry })),
      migrated: [...document.migrated],
    };
  }

  private read(): Document {
    if (this.loaded) {
      if (this.unreadable || !this.cached) throw new GithubCredentialsError(this.unreadable ?? "The saved credentials could not be read.", "store_unavailable", 503);
      return this.copy(this.cached);
    }
    const source = this.keySource();
    if (source.kind === "unavailable") {
      // not cached: the key may come later (a vault unlocked after boot)
      throw new GithubCredentialsError(source.reason, "store_unavailable", 503);
    }
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.cached = this.empty();
        this.loaded = true;
        this.unreadable = null;
        return this.copy(this.cached);
      }
      this.loaded = true;
      this.unreadable = "The saved credentials could not be read.";
      throw new GithubCredentialsError(this.unreadable, "store_unavailable", 503);
    }
    try {
      const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
      if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") throw new Error("format");
      const decipher = createDecipheriv("aes-256-gcm", source.key, Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(AAD);
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
      this.cached = documentSchema.parse(JSON.parse(plain));
      this.loaded = true;
      this.unreadable = null;
      return this.copy(this.cached);
    } catch {
      this.loaded = true;
      this.unreadable = "The saved credentials could not be read.";
      throw new GithubCredentialsError(this.unreadable, "store_unavailable", 503);
    }
  }

  private write(document: Document): void {
    if (this.unreadable) throw new GithubCredentialsError(this.unreadable, "store_unavailable", 503);
    let parsed: Document;
    try {
      parsed = documentSchema.parse(document);
    } catch {
      // A schema message can quote the value: never surface it.
      throw new GithubCredentialsError("The credential could not be saved.", "store_unavailable", 503);
    }
    const source = this.keySource();
    if (source.kind === "unavailable") throw new GithubCredentialsError(source.reason, "store_unavailable", 503);
    if (!parsed.credentials.length && !parsed.choices.length && !parsed.used.length && !parsed.migrated.length) {
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
