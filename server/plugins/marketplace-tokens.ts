// LEGACY since 2026-10-28: read once at start and moved into the one
// credential list (server/github-credentials.ts), then the file is removed.
//
// A token per bot and plugin marketplace (Capabilities, "For this bot",
// Manage > Marketplaces): how a bot reads a private repository when nobody's
// GitHub connection can, and how it reads one on another git host (GitLab,
// Gitea, a company server). The marketplace itself is in the installation's
// one list (server/plugins/plugin-marketplaces.ts); its token stays per bot.
//
// Stored like MCP header values and the organization's GitHub tokens: one
// AES-256-GCM file under the data directory (marketplace-tokens.enc),
// sealed with the mcp-oauth vault key, mode 0600. Never in config.json,
// never in a bot zip (only `needsToken`), never in a listing (`hasToken`),
// never in a log. Keyed by bot and marketplace source (owner/repo or the
// https address), so it survives an Update and goes with Remove.
//
// The "Everyone" scope of Capabilities keeps one token per marketplace for
// the whole installation under the key `workspace` (WORKSPACE_TOKEN_KEY):
// set by an admin only, audited, never shown back. It reads the marketplace
// for everyone; a bot's own token still comes first in its scope.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import type { VaultKeySource } from "../mcp/mcp-oauth.ts";

const FILE = "marketplace-tokens.enc";
const AAD = Buffer.from("sagax marketplace-tokens v1");
const TOKEN = /^[\x21-\x7e]{8,4096}$/;
const BOT_ID = /^[\w-]{1,80}$/;
const MAX_TOKENS = 500;
/** The key of the installation's own tokens ("Everyone" in Capabilities),
 * in place of a bot id. */
export const WORKSPACE_TOKEN_KEY = "workspace";

const entrySchema = z.object({
  bot: z.string().regex(BOT_ID),
  source: z.string().min(1).max(500),
  token: z.string().regex(TOKEN),
  addedAt: z.number(),
  addedBy: z.string().max(200).optional(),
}).strict();
const documentSchema = z.object({ version: z.literal(1), tokens: z.array(entrySchema).max(MAX_TOKENS) }).strict();
type Entry = z.infer<typeof entrySchema>;

export class MarketplaceTokenError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "MarketplaceTokenError";
    this.code = code;
    this.status = status;
  }
}

/** A pasted token: one line of printable characters. */
export function cleanMarketplaceToken(value: unknown): string {
  if (typeof value !== "string") throw new MarketplaceTokenError("The token must be one line of printable characters.", "invalid_token");
  const token = value.trim();
  if (!TOKEN.test(token)) throw new MarketplaceTokenError("The token must be one line of printable characters.", "invalid_token");
  return token;
}

export class MarketplaceTokens {
  private readonly file: string;
  private readonly keySource: () => VaultKeySource;
  private cache: Entry[] | null = null;

  constructor(dataDir: string, keySource: () => VaultKeySource) {
    this.file = join(dataDir, FILE);
    this.keySource = keySource;
  }

  /** The stored token, for the server's own clone. Never send it anywhere else. */
  get(botId: string, source: string): string | undefined {
    return this.read().find((entry) => entry.bot === botId && entry.source === source)?.token;
  }

  /** Sources of this bot that have a token (names only). */
  sourcesFor(botId: string): Set<string> {
    try {
      return new Set(this.read().filter((entry) => entry.bot === botId).map((entry) => entry.source));
    } catch {
      return new Set();
    }
  }

  set(botId: string, source: string, token: string, addedBy?: string): void {
    if (!BOT_ID.test(botId)) throw new MarketplaceTokenError("invalid bot", "invalid_bot");
    const clean = cleanMarketplaceToken(token);
    const entries = this.read().filter((entry) => !(entry.bot === botId && entry.source === source));
    if (entries.length >= MAX_TOKENS) throw new MarketplaceTokenError(`${MAX_TOKENS} marketplace tokens is the limit.`, "too_many");
    entries.push({ bot: botId, source, token: clean, addedAt: Date.now(), ...(addedBy ? { addedBy } : {}) });
    this.write(entries);
  }

  remove(botId: string, source: string): boolean {
    const entries = this.read();
    const next = entries.filter((entry) => !(entry.bot === botId && entry.source === source));
    if (next.length === entries.length) return false;
    this.write(next);
    return true;
  }

  /** Every saved token, for the one-time move into the credential list
   * (server/github-credentials.ts). Never send these to a client. */
  all(): Entry[] {
    return this.read();
  }

  /** The old file goes once its tokens are in the credential list. */
  discard(): void {
    rmSync(this.file, { force: true });
    this.cache = [];
  }

  forgetBot(botId: string): void {
    if (botId === WORKSPACE_TOKEN_KEY) return;
    const entries = this.read();
    const next = entries.filter((entry) => entry.bot !== botId);
    if (next.length !== entries.length) this.write(next);
  }

  private key(): Buffer {
    const source = this.keySource();
    if (source.kind === "unavailable") throw new MarketplaceTokenError(source.reason, "store_unavailable", 503);
    return source.key;
  }

  private read(): Entry[] {
    if (this.cache) return this.cache.map((entry) => ({ ...entry }));
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.cache = [];
        return [];
      }
      throw new MarketplaceTokenError("The saved marketplace tokens could not be read.", "store_unavailable", 503);
    }
    try {
      const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
      if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") throw new Error("format");
      const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(AAD);
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
      this.cache = documentSchema.parse(JSON.parse(plain)).tokens;
      return this.cache.map((entry) => ({ ...entry }));
    } catch (error) {
      if (error instanceof MarketplaceTokenError) throw error;
      throw new MarketplaceTokenError("The saved marketplace tokens could not be read.", "store_unavailable", 503);
    }
  }

  private write(entries: Entry[]): void {
    let parsed: z.infer<typeof documentSchema>;
    try {
      parsed = documentSchema.parse({ version: 1, tokens: entries });
    } catch {
      // A schema message can quote the value: never surface it.
      throw new MarketplaceTokenError("The token could not be saved.", "store_unavailable", 503);
    }
    if (!parsed.tokens.length) {
      rmSync(this.file, { force: true });
      this.cache = [];
      return;
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(AAD);
    const data = Buffer.concat([cipher.update(JSON.stringify(parsed), "utf8"), cipher.final()]);
    mkdirSync(join(this.file, ".."), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }), { mode: 0o600 });
    this.cache = parsed.tokens;
  }
}
