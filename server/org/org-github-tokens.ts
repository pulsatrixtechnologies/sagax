// LEGACY since 2026-10-28: read once at start and moved into the one
// credential list (server/github-credentials.ts), then the file is removed.
//
// The organization's GitHub access tokens (personal access tokens or
// repository credentials), one list for Settings > Organization > Plugins
// and GitHub. Not the OAuth App client id (that stays on organization.githubClientId).
//
// Stored like a person's connections: one AES-256-GCM file under the data
// directory (org-github-tokens.enc), sealed with the mcp-oauth vault key.
// Not config.json, so a settings save cannot drop the list, and not a file
// in git. A change rewrites the whole document from the current list, so
// adding, renaming, replacing or removing one entry keeps the others.
// Nothing here logs a token. list() never returns one.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import type { VaultKeySource } from "../mcp/mcp-oauth.ts";
import { MAX_ORG_GITHUB_TOKENS, orgGithubTokenHint, type OrgGithubTokenPublic } from "../../shared/org-github-tokens.ts";

const FILE = "org-github-tokens.enc";
const AAD = Buffer.from("sagax org-github-tokens v1");
const ID = /^gt_[0-9a-f]{16}$/;
const TOKEN = /^[\x21-\x7e]{8,4096}$/;
// oxlint-disable-next-line no-control-regex -- a token must not carry control characters
const CONTROL = /[\u0000-\u001f\u007f]/;

const entrySchema = z.object({
  id: z.string().regex(ID),
  label: z.string().min(1).max(80),
  token: z.string().regex(TOKEN),
  addedAt: z.number(),
}).strict();

const documentSchema = z.object({
  version: z.literal(1),
  tokens: z.array(entrySchema).max(MAX_ORG_GITHUB_TOKENS),
}).strict();

type StoredToken = z.infer<typeof entrySchema>;
type Document = z.infer<typeof documentSchema>;

export class OrgGithubTokensError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "OrgGithubTokensError";
    this.code = code;
    this.status = status;
  }
}

export type OrgGithubTokenChange =
  | { op: "add"; label: string; token: string }
  | { op: "remove"; id: string }
  | { op: "rename"; id: string; label: string }
  | { op: "replace"; id: string; token: string };

const CHANGE_KEYS: Record<OrgGithubTokenChange["op"], readonly string[]> = {
  add: ["op", "label", "token"],
  remove: ["op", "id"],
  rename: ["op", "id", "label"],
  replace: ["op", "id", "token"],
};

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  return value as Record<string, unknown>;
}

function labelError(value: unknown): string | null {
  if (typeof value !== "string") return "The label must be 1 to 80 characters.";
  const label = value.trim();
  if (!label || label.length > 80 || CONTROL.test(label)) return "The label must be 1 to 80 characters.";
  return null;
}

function tokenError(value: unknown): string | null {
  if (typeof value !== "string") return "The token must be a single line of printable characters.";
  const token = value.trim();
  if (!TOKEN.test(token)) return "The token must be a single line of printable characters.";
  return null;
}

/** One explicit change. A rename cannot carry a token, and a replace cannot
 * omit one: replacing the secret is its own step. */
export function parseOrgGithubTokenChange(value: unknown): OrgGithubTokenChange {
  const record = plainRecord(value);
  const op = record?.op;
  if (!record || (op !== "add" && op !== "remove" && op !== "rename" && op !== "replace")) {
    throw new OrgGithubTokensError("Send { op: \"add\", label, token }, { op: \"remove\", id }, { op: \"rename\", id, label } or { op: \"replace\", id, token }.", "invalid_token");
  }
  const allowed = CHANGE_KEYS[op];
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new OrgGithubTokensError("Replacing the secret is a separate step from renaming.", "invalid_token");
  }
  if (op === "remove" || op === "rename" || op === "replace") {
    if (typeof record.id !== "string" || !ID.test(record.id)) throw new OrgGithubTokensError("No token with that id.", "not_found", 404);
  }
  if (op === "add" || op === "rename") {
    if (labelError(record.label)) throw new OrgGithubTokensError("The label must be 1 to 80 characters.", "invalid_label");
  }
  if (op === "add" || op === "replace") {
    if (tokenError(record.token)) throw new OrgGithubTokensError("The token must be a single line of printable characters.", "invalid_token");
  }
  if (op === "add") return { op, label: (record.label as string).trim(), token: (record.token as string).trim() };
  if (op === "rename") return { op, id: record.id as string, label: (record.label as string).trim() };
  if (op === "replace") return { op, id: record.id as string, token: (record.token as string).trim() };
  return { op, id: record.id as string };
}

function publicOf(entry: StoredToken): OrgGithubTokenPublic {
  return { id: entry.id, label: entry.label, hint: orgGithubTokenHint(entry.token) };
}

function labelHoldsToken(label: string, token: string): boolean {
  return label === token || label.includes(token);
}

/** One encrypted list for the organization. An unreadable file is never
 * replaced with an empty one. */
export class OrgGithubTokens {
  private readonly file: string;
  private readonly keySource: () => VaultKeySource;
  private cached: Document | null = null;
  private unreadable: string | null = null;
  private loaded = false;

  constructor(dataDir: string, keySource: () => VaultKeySource) {
    this.file = join(dataDir, FILE);
    this.keySource = keySource;
  }

  /** Labels and hints only. */
  list(): OrgGithubTokenPublic[] {
    return this.read().tokens.map(publicOf);
  }

  /** The stored secret, for the server's own use. Never send this to a client. */
  tokenFor(id: string): string | undefined {
    return this.read().tokens.find((entry) => entry.id === id)?.token;
  }

  /** The old file goes once its tokens are in the credential list
   * (server/github-credentials.ts). */
  discard(): void {
    rmSync(this.file, { force: true });
    this.cached = { version: 1, tokens: [] };
    this.loaded = true;
    this.unreadable = null;
  }

  /** Apply one change and return the redacted list. Other entries stay. */
  change(change: OrgGithubTokenChange): OrgGithubTokenPublic[] {
    const document = this.read();
    const tokens = document.tokens.map((entry) => ({ ...entry }));
    if (change.op === "add") {
      if (tokens.length >= MAX_ORG_GITHUB_TOKENS) {
        throw new OrgGithubTokensError(`${MAX_ORG_GITHUB_TOKENS} GitHub access tokens is the limit.`, "too_many");
      }
      if (labelHoldsToken(change.label, change.token)) {
        throw new OrgGithubTokensError("The label must not contain the token.", "invalid_label");
      }
      let id = "";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const next = `gt_${randomBytes(8).toString("hex")}`;
        if (!tokens.some((entry) => entry.id === next)) { id = next; break; }
      }
      if (!id) throw new OrgGithubTokensError("The token could not be saved.", "store_unavailable", 503);
      tokens.push({ id, label: change.label, token: change.token, addedAt: Date.now() });
    } else {
      const index = tokens.findIndex((entry) => entry.id === change.id);
      if (index < 0) throw new OrgGithubTokensError("No token with that id.", "not_found", 404);
      const current = tokens[index]!;
      if (change.op === "remove") tokens.splice(index, 1);
      else if (change.op === "rename") {
        if (labelHoldsToken(change.label, current.token)) {
          throw new OrgGithubTokensError("The label must not contain the token.", "invalid_label");
        }
        tokens[index] = { ...current, label: change.label };
      } else {
        if (labelHoldsToken(current.label, change.token)) {
          throw new OrgGithubTokensError("The label must not contain the token.", "invalid_label");
        }
        tokens[index] = { ...current, token: change.token };
      }
    }
    this.write({ version: 1, tokens });
    return this.list();
  }

  private read(): Document {
    if (this.loaded) {
      if (this.unreadable || !this.cached) throw new OrgGithubTokensError(this.unreadable ?? "The saved GitHub tokens could not be read.", "store_unavailable", 503);
      return { version: 1, tokens: this.cached.tokens.map((entry) => ({ ...entry })) };
    }
    const source = this.keySource();
    if (source.kind === "unavailable") {
      this.loaded = true;
      this.unreadable = source.reason;
      throw new OrgGithubTokensError(source.reason, "store_unavailable", 503);
    }
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.cached = { version: 1, tokens: [] };
        this.loaded = true;
        this.unreadable = null;
        return { version: 1, tokens: [] };
      }
      this.loaded = true;
      this.unreadable = "The saved GitHub tokens could not be read.";
      throw new OrgGithubTokensError(this.unreadable, "store_unavailable", 503);
    }
    try {
      const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
      if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") throw new Error("format");
      const decipher = createDecipheriv("aes-256-gcm", source.key, Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(AAD);
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
      const document = documentSchema.parse(JSON.parse(plain));
      this.cached = document;
      this.loaded = true;
      this.unreadable = null;
      return { version: 1, tokens: document.tokens.map((entry) => ({ ...entry })) };
    } catch (error) {
      if (error instanceof OrgGithubTokensError) throw error;
      this.loaded = true;
      this.unreadable = "The saved GitHub tokens could not be read.";
      throw new OrgGithubTokensError(this.unreadable, "store_unavailable", 503);
    }
  }

  private write(document: Document): void {
    if (this.unreadable) throw new OrgGithubTokensError(this.unreadable, "store_unavailable", 503);
    // A schema failure must not travel as a Zod message: that message can quote the value.
    let parsed: Document;
    try {
      parsed = documentSchema.parse(document);
    } catch {
      throw new OrgGithubTokensError("The token could not be saved.", "store_unavailable", 503);
    }
    const source = this.keySource();
    if (source.kind === "unavailable") throw new OrgGithubTokensError(source.reason, "store_unavailable", 503);
    if (!parsed.tokens.length) {
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
