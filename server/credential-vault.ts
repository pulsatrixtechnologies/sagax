// The credential vault: logins (user name, password, one-time code seed),
// API keys and notes a person keeps for their bots, with the bots each item
// is granted to. One encrypted file per person:
//
//   solo or desktop       DATA_DIR/credential-vault.enc
//   organization server   DATA_DIR/principals/<pid>/credential-vault.enc
//
// AES-256-GCM with a key derived (HKDF) from the server's vault key, the one
// mcp-oauth.enc uses (server/mcp-oauth.ts resolveVaultKey): on the desktop
// that key lives in the OS keychain through Electron safeStorage
// (credentials.bin) and reaches the server as SAGAX_MCP_OAUTH_KEY; a
// headless server keeps it in a 0600 key file beside its data. The
// additional data names the person, so a file copied into another person's
// folder does not open.
//
// Nothing here returns a value to a caller other than resolveForFill, which
// only the browser runtime's fill path calls (server/credential-fill.ts),
// after the grant and the page's origin are checked. Listings carry booleans.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import {
  bindingUrl,
  MAX_VAULT_DOMAINS,
  MAX_VAULT_ITEMS,
  VAULT_GRANT_MODES,
  VAULT_ITEM_KINDS,
  VAULT_ONCE_GRANT_MS,
  VAULT_SINGLE_USE_MS,
  itemIdFromHandle,
  vaultHandle,
  normalizeVaultDomain,
  vaultDomainMatches,
  type VaultFillField,
  type VaultGrantMode,
  type VaultItemKind,
  type VaultItemListing,
} from "../shared/credential-vault.ts";
import {
  cardExpiryText,
  isPaymentFillField,
  mergeCard,
  parseAddress,
  parseAmount,
  parseContact,
  parseCurrency,
  publicCard,
  purchaseBotNote,
  purchaseCardText,
  type PurchaseFlightLeg,
  type PurchaseItem,
  type PaymentFillField,
  type StoredAddress,
  type StoredCard,
  type StoredContact,
} from "../shared/payment-vault.ts";
import { mergePatch, planVaultImport, type VaultDuplicateMode, type VaultExportFormat, type VaultTransferItem } from "../shared/credential-vault-transfer.ts";
import { writeFileAtomic } from "./atomic.ts";
import type { VaultKeySource } from "./mcp-oauth.ts";
import { principalDir } from "./person-connections.ts";
import { parseTotpSeed, totp } from "./totp.ts";

export const LOCAL_VAULT_PRINCIPAL = "local";
const FILE = "credential-vault.enc";
const AAD_PREFIX = "sagax credential-vault v1";
const HKDF_INFO = Buffer.from("sagax credential-vault key v1");
const BOT_ID = /^[\w-]{1,128}$/;
const THREAD_ID = /^[\w:.-]{1,200}$/;

const grantSchema = z.object({
  botId: z.string().regex(BOT_ID),
  mode: z.enum(VAULT_GRANT_MODES),
  threadId: z.string().regex(THREAD_ID).optional(),
  grantedAt: z.number(),
  expiresAt: z.number().optional(),
  /** 2026-10-21 (review of #954): a 1Password item allowed once is one
   * sign-in, not 15 minutes: its first fill starts a short window
   * (VAULT_SINGLE_USE_MS) for that sign-in's steps, then it is gone. */
  singleUse: z.boolean().optional(),
  usedAt: z.number().optional(),
}).strict();

const onePasswordRefSchema = z.object({
  via: z.enum(["cli", "connect"]),
  vaultId: z.string().min(1).max(128),
  itemId: z.string().min(1).max(128),
}).strict();

const cardSchema = z.object({
  pan: z.string().regex(/^\d{13,19}$/),
  cvv: z.string().regex(/^\d{3,4}$/),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(2000).max(2100),
  holder: z.string().min(1).max(80),
  brand: z.enum(["visa", "mastercard", "amex", "discover", "card"]),
  last4: z.string().regex(/^\d{4}$/),
}).strict();

const addressSchema = z.object({
  recipient: z.string().min(1).max(80),
  line1: z.string().min(1).max(120),
  line2: z.string().min(1).max(120).optional(),
  city: z.string().min(1).max(80),
  region: z.string().min(1).max(80).optional(),
  postal: z.string().min(1).max(20),
  country: z.string().regex(/^[A-Z]{2}$/),
  phone: z.string().min(1).max(32).optional(),
}).strict();

const contactSchema = z.object({
  fullName: z.string().min(1).max(80),
  email: z.string().min(3).max(120).optional(),
  phone: z.string().min(1).max(32).optional(),
  company: z.string().min(1).max(80).optional(),
}).strict();

const purchaseSchema = z.object({
  id: z.string().regex(/^pay_[a-f0-9]{16}$/),
  botId: z.string().regex(BOT_ID),
  threadId: z.string().regex(THREAD_ID),
  merchant: z.string().min(1).max(80),
  domain: z.string().min(1).max(253),
  amount: z.string().regex(/^\d{1,6}\.\d{2}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  cardId: z.string().regex(/^[a-z0-9]{8,40}$/),
  addressId: z.string().regex(/^[a-z0-9]{8,40}$/).optional(),
  contactId: z.string().regex(/^[a-z0-9]{8,40}$/).optional(),
  // "always" is only read from files written before JC's rule of
  // 2026-10-22 (every purchase its own card): it never covers a payment
  status: z.enum(["pending", "once", "always", "denied"]),
  createdAt: z.number(),
  answeredAt: z.number().optional(),
  expiresAt: z.number().optional(),
  via: z.string().min(1).max(80).optional(),
  // R13 (purchase agent): what the cart holds, and the receipt once the
  // shop confirmed it (record_purchase)
  items: z.array(z.object({ name: z.string().min(1).max(120), quantity: z.number().int().min(1).max(999), price: z.string().regex(/^\d{1,6}\.\d{2}$/).optional() }).strict()).max(30).optional(),
  flights: z.array(z.object({ from: z.string().min(1).max(80), to: z.string().min(1).max(80), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), flight: z.string().min(1).max(20).optional(), passenger: z.string().min(1).max(80).optional() }).strict()).max(8).optional(),
  // the approved cart above never changes; the shop's receipt sits beside
  // it, as the bot declared it (record_purchase): Sagax does not read it
  // from the page, and the card says so
  receipt: z.object({
    at: z.number(),
    orderRef: z.string().min(1).max(64).optional(),
    total: z.string().regex(/^\d{1,6}\.\d{2}$/).optional(),
    items: z.array(z.object({ name: z.string().min(1).max(120), quantity: z.number().int().min(1).max(999), price: z.string().regex(/^\d{1,6}\.\d{2}$/).optional() }).strict()).max(30).optional(),
    flights: z.array(z.object({ from: z.string().min(1).max(80), to: z.string().min(1).max(80), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), flight: z.string().min(1).max(20).optional(), passenger: z.string().min(1).max(80).optional() }).strict()).max(8).optional(),
  }).strict().optional(),
  // a once approval is used at the first payment field filled, of any
  // kind: the other fields of that same form and page may follow for a few
  // minutes, each once (re-review of #956)
  cardFilledAt: z.number().optional(),
  formKey: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  filledFields: z.array(z.string().min(1).max(40)).max(20).optional(),
}).strict();

const itemSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{8,40}$/),
  kind: z.enum(VAULT_ITEM_KINDS),
  name: z.string().min(1).max(120),
  username: z.string().max(512).optional(),
  domains: z.array(z.string()).max(MAX_VAULT_DOMAINS),
  password: z.string().max(4_096).optional(),
  totpSeed: z.string().max(1_024).optional(),
  apiKey: z.string().max(16_384).optional(),
  notes: z.string().max(16_384).optional(),
  card: cardSchema.optional(),
  address: addressSchema.optional(),
  contact: contactSchema.optional(),
  source: z.enum(["local", "1password"]),
  onePassword: onePasswordRefSchema.optional(),
  grants: z.array(grantSchema).max(200),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastUsedAt: z.number().optional(),
  lastUsedBy: z.string().regex(BOT_ID).optional(),
}).strict();

const documentSchema = z.object({
  version: z.literal(1),
  items: z.record(z.string(), itemSchema),
  purchases: z.record(z.string(), purchaseSchema).optional(),
}).strict();

export type StoredVaultItem = z.infer<typeof itemSchema>;
export type StoredPurchase = z.infer<typeof purchaseSchema>;
export type OnePasswordRef = z.infer<typeof onePasswordRefSchema>;
type VaultDocument = z.infer<typeof documentSchema>;

export interface PurchaseListing {
  id: string;
  botId: string;
  threadId: string;
  merchant: string;
  domain: string;
  amount: string;
  currency: string;
  cardName: string;
  cardLast4: string;
  cardBrand: string;
  addressName?: string;
  contactName?: string;
  status: StoredPurchase["status"];
  via?: string;
  createdAt: number;
  title: string;
  line: string;
  items?: PurchaseItem[];
  flights?: PurchaseFlightLeg[];
  orderRef?: string;
  doneAt?: number;
  /** What the shop confirmed, beside the approved cart. */
  receipt?: { orderRef?: string; total?: string; items?: PurchaseItem[]; flights?: PurchaseFlightLeg[] };
  /** The confirmed total is not the approved amount. */
  mismatch?: boolean;
}

export class CredentialVaultError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** What a person types to create or change an item. A secret field left
 * out keeps its value; an empty string clears it. */
export interface VaultItemInput {
  kind?: unknown;
  name?: unknown;
  username?: unknown;
  domains?: unknown;
  password?: unknown;
  totpSeed?: unknown;
  apiKey?: unknown;
  notes?: unknown;
  /** A card, an address or a contact. A blank secret on an edit keeps it. */
  card?: unknown;
  address?: unknown;
  contact?: unknown;
}

const REVEAL_FIELDS = ["password", "apiKey", "notes", "pan", "cvv"] as const;
export type VaultRevealField = (typeof REVEAL_FIELDS)[number];

/** Reads a 1Password item's field at fill time (server/onepassword.ts). */
export type OnePasswordFieldReader = (ref: OnePasswordRef, field: VaultFillField) => Promise<string | null>;

export interface VaultImportOutcome {
  created: number;
  merged: number;
  /** Matched a saved item and left as it was. */
  duplicates: number;
  /** Repeated an earlier item of the file. */
  inFile: number;
  /** Over the vault's item limit. */
  overLimit: number;
  /** Refused by the vault's rules (a seed it cannot read, a site it refuses). */
  refused: number;
}

export type FillResolution =
  | { ok: true; value: string; item: VaultItemListing; field: VaultFillField }
  | { ok: false; code: "unknown_item" | "not_granted" | "wrong_origin" | "no_value" | "unavailable"; message: string };

function deriveKey(source: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", source, Buffer.alloc(0), HKDF_INFO, 32));
}

function aad(principalId: string): Buffer {
  return Buffer.from(`${AAD_PREFIX}\0${principalId}`);
}

function newItemId(): string {
  return randomBytes(12).toString("hex");
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new CredentialVaultError(`${field} must be text`, "invalid_field");
  if (value.length > max) throw new CredentialVaultError(`${field} is too long`, "invalid_field");
  return value;
}

function domainsFrom(value: unknown): string[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : null;
  if (!list) throw new CredentialVaultError("domains must be a list of site names", "invalid_domains");
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw === "string" && !raw.trim()) continue;
    const domain = normalizeVaultDomain(raw);
    if (!domain) throw new CredentialVaultError("A site must be a name such as example.com", "invalid_domains");
    if (!out.includes(domain)) out.push(domain);
  }
  if (out.length > MAX_VAULT_DOMAINS) throw new CredentialVaultError(`At most ${MAX_VAULT_DOMAINS} sites per item`, "invalid_domains");
  return out;
}

function activeGrants(item: StoredVaultItem, now: number): StoredVaultItem["grants"] {
  // a 1Password item is allowed once only (review of #954): an Always saved
  // before that rule answers nothing and is dropped at the next write
  if (item.source === "1password") return item.grants.filter((grant) => grant.mode === "once" && (grant.expiresAt ?? 0) > now);
  return item.grants.filter((grant) => grant.mode === "always" || (grant.expiresAt ?? 0) > now);
}

/** How the bot is told about an item: a 1Password item's own title never
 * reaches it (review of #954), in a refusal or a result. */
function botName(item: StoredVaultItem): string {
  return item.source === "1password" ? "this 1Password login" : `"${item.name}"`;
}

export function listingOf(item: StoredVaultItem, now: number = Date.now()): VaultItemListing {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    ...(item.username ? { username: item.username } : {}),
    domains: [...item.domains],
    hasPassword: Boolean(item.password) || (item.source === "1password" && item.kind === "login"),
    hasTotp: Boolean(item.totpSeed),
    hasApiKey: Boolean(item.apiKey),
    hasNotes: Boolean(item.notes),
    ...(item.card ? { card: publicCard(item.card) } : {}),
    ...(item.address ? { address: { ...item.address } } : {}),
    ...(item.contact ? { contact: { ...item.contact } } : {}),
    source: item.source,
    grants: activeGrants(item, now).map((grant) => ({ ...grant })),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(item.lastUsedAt ? { lastUsedAt: item.lastUsedAt } : {}),
    ...(item.lastUsedBy ? { lastUsedBy: item.lastUsedBy } : {}),
  };
}

export class CredentialVault {
  private readonly dataDir: string;
  private readonly keySource: () => VaultKeySource;
  private readonly now: () => number;
  private readonly cache = new Map<string, VaultDocument>();

  constructor(dataDir: string, keySource: () => VaultKeySource, now: () => number = Date.now) {
    this.dataDir = dataDir;
    this.keySource = keySource;
    this.now = now;
  }

  private file(principalId: string): string {
    if (principalId === LOCAL_VAULT_PRINCIPAL) return join(this.dataDir, FILE);
    return join(principalDir(this.dataDir, principalId), FILE);
  }

  private key(): Buffer {
    const source = this.keySource();
    if (source.kind !== "key") throw new CredentialVaultError(source.reason, "vault_unavailable", 503);
    return deriveKey(source.key);
  }

  /** Never an empty document in place of one that could not be opened, so
   * a wrong key can never overwrite saved items. */
  private load(principalId: string): VaultDocument {
    const cached = this.cache.get(principalId);
    if (cached) return cached;
    const key = this.key();
    let raw: string;
    try {
      raw = readFileSync(this.file(principalId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const empty: VaultDocument = { version: 1, items: {} };
        this.cache.set(principalId, empty);
        return empty;
      }
      throw new CredentialVaultError("The credential vault could not be read.", "vault_unavailable", 503);
    }
    try {
      const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
      if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") {
        throw new Error("format");
      }
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(aad(principalId));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
      const document = documentSchema.parse(JSON.parse(plain));
      this.cache.set(principalId, document);
      return document;
    } catch {
      throw new CredentialVaultError("The credential vault could not be decrypted on this launch.", "vault_unavailable", 503);
    }
  }

  private write(principalId: string, document: VaultDocument): void {
    const key = this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad(principalId));
    const data = Buffer.concat([cipher.update(JSON.stringify(document), "utf8"), cipher.final()]);
    const envelope = { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
    const file = this.file(principalId);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileAtomic(file, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
    this.cache.set(principalId, document);
  }

  private mutate<T>(principalId: string, change: (items: Record<string, StoredVaultItem>, purchases: Record<string, StoredPurchase>) => T): T {
    const document = this.load(principalId);
    const items = structuredClone(document.items);
    const purchases = structuredClone(document.purchases ?? {});
    const result = change(items, purchases);
    this.write(principalId, { version: 1, items, ...(Object.keys(purchases).length ? { purchases } : {}) });
    return result;
  }

  /** Whether the vault can be opened now, and why not. */
  unavailableReason(principalId: string): string | null {
    try {
      this.load(principalId);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  list(principalId: string): VaultItemListing[] {
    const now = this.now();
    return Object.values(this.load(principalId).items)
      .map((item) => listingOf(item, now))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  item(principalId: string, itemId: string): VaultItemListing | null {
    const item = this.load(principalId).items[itemId];
    return item ? listingOf(item, this.now()) : null;
  }

  /** 2026-10-21 (parité R10, ligne 82): the reference already saved for this
   * 1Password item, so a card that picks it again reuses it. */
  findOnePassword(principalId: string, ref: OnePasswordRef): VaultItemListing | null {
    const found = Object.values(this.load(principalId).items).find((item) => item.source === "1password"
      && item.onePassword?.via === ref.via && item.onePassword.vaultId === ref.vaultId && item.onePassword.itemId === ref.itemId);
    return found ? listingOf(found, this.now()) : null;
  }

  /** The owner's own look at a note (Settings > Credentials, "Show"). */
  revealNotes(principalId: string, itemId: string): string {
    const item = this.load(principalId).items[itemId];
    if (!item) throw new CredentialVaultError("No such item", "unknown_item", 404);
    return item.notes ?? "";
  }

  create(principalId: string, input: VaultItemInput, extra: { source?: "local" | "1password"; onePassword?: OnePasswordRef } = {}): VaultItemListing {
    const kind = (VAULT_ITEM_KINDS as readonly unknown[]).includes(input.kind ?? "login") ? (input.kind ?? "login") as VaultItemKind : null;
    if (!kind) throw new CredentialVaultError("kind must be login, apiKey, note, card, address or contact", "invalid_kind");
    const now = this.now();
    const item: StoredVaultItem = {
      id: newItemId(),
      kind,
      name: "",
      domains: [],
      source: extra.source ?? "local",
      ...(extra.onePassword ? { onePassword: extra.onePassword } : {}),
      grants: [],
      createdAt: now,
      updatedAt: now,
    };
    applyInput(item, input, true);
    return this.mutate(principalId, (items) => {
      if (Object.keys(items).length >= MAX_VAULT_ITEMS) throw new CredentialVaultError(`At most ${MAX_VAULT_ITEMS} items`, "vault_full", 409);
      items[item.id] = item;
      return listingOf(item, now);
    });
  }

  update(principalId: string, itemId: string, input: VaultItemInput): VaultItemListing {
    const now = this.now();
    return this.mutate(principalId, (items) => {
      const item = items[itemId];
      if (!item) throw new CredentialVaultError("No such item", "unknown_item", 404);
      if (input.kind !== undefined && input.kind !== item.kind) throw new CredentialVaultError("An item keeps its kind", "invalid_kind");
      if (item.source === "1password" && ["password", "totpSeed", "apiKey", "username"].some((field) => (input as Record<string, unknown>)[field] !== undefined)) {
        throw new CredentialVaultError("A 1Password item is read-only here; change it in 1Password.", "read_only");
      }
      applyInput(item, input, false);
      item.updatedAt = now;
      return listingOf(item, now);
    });
  }

  remove(principalId: string, itemId: string): boolean {
    return this.mutate(principalId, (items) => {
      if (!items[itemId]) return false;
      delete items[itemId];
      return true;
    });
  }

  /** once: this conversation for VAULT_ONCE_GRANT_MS. always: the bot,
   * anywhere, until revoked. A new grant replaces the bot's earlier one. */
  grant(principalId: string, itemId: string, grant: { botId: string; mode: VaultGrantMode; threadId?: string; singleUse?: boolean }): VaultItemListing {
    if (!BOT_ID.test(grant.botId)) throw new CredentialVaultError("invalid bot", "invalid_bot");
    if (grant.mode === "once" && !(grant.threadId && THREAD_ID.test(grant.threadId))) {
      throw new CredentialVaultError("A one-time grant needs its conversation", "invalid_thread");
    }
    const now = this.now();
    return this.mutate(principalId, (items) => {
      const item = items[itemId];
      if (!item) throw new CredentialVaultError("No such item", "unknown_item", 404);
      const kept = activeGrants(item, now).filter((row) => !(row.botId === grant.botId && (grant.mode === "always" || row.threadId === grant.threadId)));
      kept.push(grant.mode === "always"
        ? { botId: grant.botId, mode: "always", grantedAt: now }
        : { botId: grant.botId, mode: "once", threadId: grant.threadId!, grantedAt: now, expiresAt: now + VAULT_ONCE_GRANT_MS, ...(grant.singleUse ? { singleUse: true } : {}) });
      item.grants = kept;
      return listingOf(item, now);
    });
  }

  revoke(principalId: string, itemId: string, botId: string): VaultItemListing {
    const now = this.now();
    return this.mutate(principalId, (items) => {
      const item = items[itemId];
      if (!item) throw new CredentialVaultError("No such item", "unknown_item", 404);
      item.grants = activeGrants(item, now).filter((row) => row.botId !== botId);
      return listingOf(item, now);
    });
  }

  /** Items a bot's request names: by site (an item bound to the domain or
   * to a parent of it) or by name. Listings only. */
  find(principalId: string, query: { name?: string; domain?: string }): VaultItemListing[] {
    const domain = query.domain ? normalizeVaultDomain(query.domain) : null;
    const name = query.name?.trim().toLowerCase();
    return this.list(principalId).filter((item) =>
      (domain && vaultDomainMatches(item.domains, bindingUrl(domain))) ||
      (name && item.name.toLowerCase().includes(name)));
  }

  /** Whether this bot may use the item in this conversation now. */
  granted(principalId: string, itemId: string, botId: string, threadId: string): boolean {
    const item = this.load(principalId).items[itemId];
    if (!item) return false;
    return activeGrants(item, this.now()).some((grant) => grant.botId === botId && (grant.mode === "always" || grant.threadId === threadId));
  }

  /** Whether this bot may use any item in this conversation now: its own
   * page scripts are then off in its browser (server/browser-runtime.ts). A
   * vault that cannot be opened counts as armed, the safe side. */
  armed(principalId: string, botId: string, threadId: string): boolean {
    let items: Record<string, StoredVaultItem>;
    try {
      items = this.load(principalId).items;
    } catch {
      return true;
    }
    const now = this.now();
    return Object.values(items).some((item) => activeGrants(item, now).some((grant) => grant.botId === botId && (grant.mode === "always" || grant.threadId === threadId)));
  }

  /** The value to fill, only for a granted bot and a page whose top-level
   * URL is on one of the item's sites. Marks the item used. The caller must
   * never put the value in a tool result, a message or a log. */
  async resolveForFill(
    principalId: string,
    request: { handle: unknown; field: VaultFillField; botId: string; threadId: string; pageUrl: string; form?: string },
    readOnePassword?: OnePasswordFieldReader,
  ): Promise<FillResolution> {
    const itemId = itemIdFromHandle(request.handle);
    let item: StoredVaultItem | undefined;
    try {
      item = itemId ? this.load(principalId).items[itemId] : undefined;
    } catch (error) {
      return { ok: false, code: "unavailable", message: error instanceof Error ? error.message : "The credential vault is unavailable." };
    }
    if (!item) return { ok: false, code: "unknown_item", message: "No saved credential has this handle. Call request_login to ask the person for one." };
    if (isPaymentFillField(request.field)) return this.resolvePayment(principalId, item, { ...request, field: request.field });
    if (!this.granted(principalId, item.id, request.botId, request.threadId)) {
      return { ok: false, code: "not_granted", message: `You are not allowed to use ${botName(item)} here. Call request_login so the person can allow it.` };
    }
    if (!item.domains.length || !vaultDomainMatches(item.domains, request.pageUrl)) {
      // The page's host, as the bot can name it to request_login: the person
      // then decides on the card whether this login also fills there.
      let host = "";
      try { host = new URL(request.pageUrl).host; } catch { host = ""; }
      return { ok: false, code: "wrong_origin", message: `${botName(item)} is only filled on ${item.domains.join(", ") || "its own sites"} over https, and this page is not one of them. Nothing was filled.${host ? ` If this is where the same account signs in, call request_login with domain ${host} so the person can allow it there.` : ""}` };
    }
    let value: string | null = null;
    if (item.source === "1password" && item.onePassword && request.field !== "totp") {
      if (!readOnePassword) return { ok: false, code: "unavailable", message: "1Password is not available on this computer right now. Nothing was filled." };
      try {
        value = await readOnePassword(item.onePassword, request.field);
      } catch {
        return { ok: false, code: "unavailable", message: "1Password did not answer. Nothing was filled." };
      }
    } else if (request.field === "username") value = item.username ?? null;
    else if (request.field === "password") value = item.password ?? null;
    else if (request.field === "apiKey") value = item.apiKey ?? null;
    else if (request.field === "totp") {
      const params = item.totpSeed ? parseTotpSeed(item.totpSeed) : null;
      value = params ? totp(params, this.now()) : null;
      if (!value && item.source === "1password" && item.onePassword && readOnePassword) {
        try { value = await readOnePassword(item.onePassword, "totp"); } catch { value = null; }
      }
    }
    if (!value) return { ok: false, code: "no_value", message: `${botName(item)} has no ${request.field === "totp" ? "one-time code" : request.field} saved. Nothing was filled.` };
    const now = this.now();
    try {
      this.mutate(principalId, (items) => {
        const current = items[item.id];
        if (current) {
          current.lastUsedAt = now;
          current.lastUsedBy = request.botId;
          current.grants = activeGrants(current, now);
          // a single-use grant: this sign-in's window starts at its first fill
          for (const row of current.grants) {
            if (row.singleUse && row.usedAt === undefined && row.botId === request.botId && row.threadId === request.threadId) {
              row.usedAt = now;
              row.expiresAt = Math.min(row.expiresAt ?? now, now + VAULT_SINGLE_USE_MS);
            }
          }
        }
      });
    } catch {
      // the fill still happens; only "last used" is not recorded
    }
    return { ok: true, value, item: listingOf(item, now), field: request.field };
  }

  /** Items read from another manager's file (Settings > Credentials,
   * Import), in one write: new ones created, ones that match a saved item
   * merged or left out (shared/credential-vault-transfer.ts
   * planVaultImport). An item the vault refuses is counted by its
   * position, never echoed. */
  importItems(principalId: string, input: readonly VaultTransferItem[], mode: VaultDuplicateMode): VaultImportOutcome {
    const now = this.now();
    return this.mutate(principalId, (items) => {
      const existing = Object.values(items).map((item) => ({ id: item.id, kind: item.kind, name: item.name, ...(item.username ? { username: item.username } : {}), domains: item.domains, source: item.source }));
      const plan = planVaultImport(input, existing, mode, MAX_VAULT_ITEMS - Object.keys(items).length);
      const outcome: VaultImportOutcome = { created: 0, merged: 0, duplicates: plan.duplicates, inFile: plan.inFile, overLimit: plan.overLimit, refused: 0 };
      for (const entry of plan.create) {
        const item: StoredVaultItem = { id: newItemId(), kind: entry.kind, name: "", domains: [], source: "local", grants: [], createdAt: now, updatedAt: now };
        try {
          applyInput(item, { name: entry.name, domains: entry.domains, username: entry.username, password: entry.password, totpSeed: entry.totpSeed, apiKey: entry.apiKey, notes: entry.notes }, true);
        } catch {
          outcome.refused++;
          continue;
        }
        items[item.id] = item;
        outcome.created++;
      }
      for (const { id, item: entry } of plan.merge) {
        const current = items[id];
        if (!current) continue;
        const next = structuredClone(current);
        try {
          // a bot allowed on this item never gains a site from a file
          applyInput(next, mergePatch(current, entry, { keepSites: activeGrants(current, now).length > 0 }), false);
        } catch {
          outcome.refused++;
          continue;
        }
        next.updatedAt = now;
        items[id] = next;
        outcome.merged++;
      }
      return outcome;
    });
  }

  /** The person's own items with their values, for an export file the
   * person asked for (the route checks a fresh sign-in or their security
   * key first). A 1Password item holds no value here and is left out.
   * Only what the format holds leaves the vault: Chrome CSV takes logins
   * without their one-time code seed. */
  exportItems(principalId: string, format: VaultExportFormat): { items: VaultTransferItem[]; onePassword: number; notInFormat: number; totpNotInFormat: number } {
    const all = Object.values(this.load(principalId).items).sort((left, right) => left.name.localeCompare(right.name));
    const items: VaultTransferItem[] = [];
    let onePassword = 0;
    let notInFormat = 0;
    let totpNotInFormat = 0;
    for (const item of all) {
      if (item.source !== "local") {
        onePassword++;
        continue;
      }
      if (item.kind === "card" || item.kind === "address" || item.kind === "contact" || (format === "chrome-csv" && item.kind !== "login")) {
        notInFormat++;
        continue;
      }
      if (format === "chrome-csv" && item.totpSeed) totpNotInFormat++;
      items.push({
        kind: item.kind,
        name: item.name,
        domains: [...item.domains],
        ...(item.username ? { username: item.username } : {}),
        ...(item.password ? { password: item.password } : {}),
        ...(item.totpSeed && format !== "chrome-csv" ? { totpSeed: item.totpSeed } : {}),
        ...(item.apiKey ? { apiKey: item.apiKey } : {}),
        ...(item.notes ? { notes: item.notes } : {}),
      });
    }
    return { items, onePassword, notInFormat, totpNotInFormat };
  }

  /** The owner's own look at one secret (Settings, or Face ID on the phone).
   * Never a bot, never a log. */
  reveal(principalId: string, itemId: string, field: unknown): string {
    if (typeof field !== "string" || !(REVEAL_FIELDS as readonly string[]).includes(field)) {
      throw new CredentialVaultError("Nothing to show.", "invalid_field");
    }
    const item = this.load(principalId).items[itemId];
    if (!item) throw new CredentialVaultError("No such item", "unknown_item", 404);
    if (field === "password") return item.password ?? "";
    if (field === "apiKey") return item.apiKey ?? "";
    if (field === "notes") return item.notes ?? "";
    if (field === "pan") {
      if (!item.card) throw new CredentialVaultError("This item has no card number.", "no_value");
      return item.card.pan;
    }
    if (!item.card) throw new CredentialVaultError("This item has no security code.", "no_value");
    return item.card.cvv;
  }

  /** Purchases still waiting on the person, newest first. No card number. */
  pendingPurchases(principalId: string): PurchaseListing[] {
    const document = this.load(principalId);
    return Object.values(document.purchases ?? {})
      .filter((row) => row.status === "pending")
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((row) => this.purchaseListing(document, row));
  }

  /** Ask the person to approve a payment. The page's own address is the
   * merchant site: the bot does not choose where the number is typed. */
  openPurchase(principalId: string, input: {
    botId: string; threadId: string; merchant?: string; pageUrl: string;
    amount: unknown; currency: unknown; cardId: string; addressId?: string; contactId?: string;
    items?: PurchaseItem[]; flights?: PurchaseFlightLeg[];
  }): { already: boolean; listing: PurchaseListing; note: string } {
    if (!BOT_ID.test(input.botId)) throw new CredentialVaultError("invalid bot", "invalid_bot");
    if (!THREAD_ID.test(input.threadId)) throw new CredentialVaultError("invalid conversation", "invalid_thread");
    const domain = domainOfPage(input.pageUrl);
    if (!domain) throw new CredentialVaultError("The page is not a site a card can be filled on.", "invalid_domains");
    const amount = parseAmount(input.amount);
    const currency = parseCurrency(input.currency);
    if (!amount || !currency) throw new CredentialVaultError("amount and currency are required", "invalid_amount");
    const now = this.now();
    return this.mutate(principalId, (items, purchases) => {
      const card = items[input.cardId];
      if (!card || card.kind !== "card" || !card.card) throw new CredentialVaultError("No such card", "unknown_item", 404);
      if (input.addressId) {
        const address = items[input.addressId];
        if (!address || address.kind !== "address") throw new CredentialVaultError("No such address", "unknown_item", 404);
      }
      if (input.contactId) {
        const contact = items[input.contactId];
        if (!contact || contact.kind !== "contact") throw new CredentialVaultError("No such contact", "unknown_item", 404);
      }
      // the same approval only for the same amount, currency and cart (review of #956)
      const cart = cartKey(input.items, input.flights);
      const live = Object.values(purchases).find((row) => purchaseCovers(row, input.botId, input.threadId, domain, now) && row.cardId === card.id
        && row.amount === amount && row.currency === currency && cartKey(row.items, row.flights) === cart && row.cardFilledAt === undefined);
      if (live && live.status !== "pending") {
        const listing = this.purchaseListing({ items }, live);
        return { already: true, listing, note: purchaseBotNote("once", { merchant: live.merchant, amount: live.amount, currency: live.currency, handle: vaultHandle(card.id) }) };
      }
      for (const row of Object.values(purchases)) {
        if (row.status === "pending" && row.botId === input.botId && row.cardId === card.id && row.domain === domain) delete purchases[row.id];
      }
      const merchant = visibleText(input.merchant ?? "").slice(0, 80) || domain;
      const id = newPurchaseId(purchases);
      const row: StoredPurchase = {
        id, botId: input.botId, threadId: input.threadId, merchant, domain, amount, currency,
        cardId: card.id, ...(input.addressId ? { addressId: input.addressId } : {}), ...(input.contactId ? { contactId: input.contactId } : {}),
        ...(input.items?.length ? { items: input.items } : {}), ...(input.flights?.length ? { flights: input.flights } : {}),
        status: "pending", createdAt: now,
      };
      purchases[id] = row;
      const listing = this.purchaseListing({ items }, row);
      return {
        already: false,
        listing,
        note: `Sagax purchase update: ${listing.title} ${listing.line} Nothing was charged. Wait for the person to allow it, then call fill_credential. You never receive the card number.`,
      };
    });
  }

  /** The person's answer: deny, this time, or always for this bot on this site. */
  answerPurchase(principalId: string, purchaseId: string, decision: unknown, via?: string): { listing: PurchaseListing; note: string } {
    // JC 2026-10-22: no standing grant for a purchase; each one is its own card
    if (decision !== "deny" && decision !== "once") {
      throw new CredentialVaultError("decision must be deny or once: every purchase needs its own approval", "invalid_decision");
    }
    const now = this.now();
    const name = via ? visibleText(via).slice(0, 80) : "";
    return this.mutate(principalId, (items, purchases) => {
      const row = purchases[purchaseId];
      if (!row || row.status !== "pending") throw new CredentialVaultError("This purchase was already answered.", "not_pending", 409);
      row.status = decision === "deny" ? "denied" : decision;
      row.answeredAt = now;
      if (decision === "once") row.expiresAt = now + VAULT_ONCE_GRANT_MS;
      if (name) row.via = name;
      const listing = this.purchaseListing({ items }, row);
      const handle = decision === "deny" ? undefined : vaultHandle(row.cardId);
      return { listing, note: purchaseBotNote(decision, { merchant: row.merchant, amount: row.amount, currency: row.currency, ...(handle ? { handle } : {}) }) };
    });
  }

  /** The shop confirmed the order (record_purchase): the receipt goes on
   * the purchase that let the bot pay on this site, and a purchase allowed
   * once is closed by it. Null when no approved purchase covers the page. */
  recordPurchase(principalId: string, input: {
    botId: string; threadId: string; pageUrl: string; orderRef?: string; total?: string; items?: PurchaseItem[]; flights?: PurchaseFlightLeg[];
  }): PurchaseListing | null {
    const domain = domainOfPage(input.pageUrl);
    if (!domain) return null;
    const now = this.now();
    return this.mutate(principalId, (items, purchases) => {
      const row = Object.values(purchases)
        .filter((candidate) => candidate.receipt === undefined && candidate.status === "once" && candidate.botId === input.botId
          && candidate.threadId === input.threadId && candidate.domain === domain && (candidate.answeredAt ?? 0) + VAULT_ONCE_GRANT_MS * 4 > now)
        .sort((a, b) => (b.answeredAt ?? 0) - (a.answeredAt ?? 0))[0];
      if (!row) return null;
      const orderRef = input.orderRef ? visibleText(input.orderRef).slice(0, 64) : "";
      row.receipt = {
        at: now,
        ...(orderRef ? { orderRef } : {}),
        ...(input.total ? { total: input.total } : {}),
        ...(input.items?.length ? { items: input.items } : {}),
        ...(input.flights?.length ? { flights: input.flights } : {}),
      };
      // closed: the next payment asks again
      row.expiresAt = now;
      return this.purchaseListing({ items }, row);
    });
  }

  /** One purchase as the owner sees it, or undefined. No card number. */
  purchaseById(principalId: string, purchaseId: string): PurchaseListing | undefined {
    const document = this.load(principalId);
    const row = document.purchases?.[purchaseId];
    return row ? this.purchaseListing(document, row) : undefined;
  }

  /** Every purchase kept, newest first. No card number. */
  listPurchases(principalId: string): PurchaseListing[] {
    const document = this.load(principalId);
    return Object.values(document.purchases ?? {}).sort((a, b) => b.createdAt - a.createdAt).map((row) => this.purchaseListing(document, row));
  }

  private purchaseListing(document: { items: Record<string, StoredVaultItem> }, row: StoredPurchase): PurchaseListing {
    const card = document.items[row.cardId];
    const address = row.addressId ? document.items[row.addressId] : undefined;
    const contact = row.contactId ? document.items[row.contactId] : undefined;
    const text = purchaseCardText({
      merchant: row.merchant,
      amount: row.amount,
      currency: row.currency,
      last4: card?.card?.last4 ?? "••••",
      brand: card?.card?.brand ?? "card",
      ...(address ? { addressName: address.name } : {}),
      ...(row.items ? { items: row.items } : {}),
      ...(row.flights ? { flights: row.flights } : {}),
    });
    return {
      id: row.id, botId: row.botId, threadId: row.threadId, merchant: row.merchant, domain: row.domain,
      amount: row.amount, currency: row.currency,
      cardName: card?.name ?? "Card", cardLast4: card?.card?.last4 ?? "", cardBrand: card?.card?.brand ?? "card",
      ...(address ? { addressName: address.name } : {}),
      ...(contact ? { contactName: contact.name } : {}),
      status: row.status, ...(row.via ? { via: row.via } : {}), createdAt: row.createdAt,
      title: text.title, line: text.line,
      ...(row.items ? { items: row.items } : {}), ...(row.flights ? { flights: row.flights } : {}),
      ...(row.receipt?.orderRef ? { orderRef: row.receipt.orderRef } : {}), ...(row.receipt ? { doneAt: row.receipt.at } : {}),
      ...(row.receipt ? {
        receipt: {
          ...(row.receipt.orderRef ? { orderRef: row.receipt.orderRef } : {}), ...(row.receipt.total ? { total: row.receipt.total } : {}),
          ...(row.receipt.items ? { items: row.receipt.items } : {}), ...(row.receipt.flights ? { flights: row.receipt.flights } : {}),
        },
      } : {}),
      ...(row.receipt?.total && row.receipt.total !== row.amount ? { mismatch: true } : {}),
    };
  }

  private resolvePayment(
    principalId: string,
    item: StoredVaultItem,
    request: { field: PaymentFillField; botId: string; threadId: string; pageUrl: string; form?: string },
  ): FillResolution {
    const domain = domainOfPage(request.pageUrl);
    const now = this.now();
    const formKey = paymentFormKey(request.pageUrl, request.form);
    let purchase: StoredPurchase | undefined;
    try {
      purchase = Object.values(this.load(principalId).purchases ?? {}).find((row) => {
        if (!purchaseCovers(row, request.botId, request.threadId, domain ?? "", now)) return false;
        // used at the first payment field: then only that form on that page,
        // each field once, for a few minutes
        if (row.cardFilledAt !== undefined && (row.cardFilledAt + PURCHASE_FORM_MS <= now || row.formKey !== formKey
          || (row.filledFields ?? []).includes(request.field))) return false;
        if (request.field.startsWith("card")) return row.cardId === item.id;
        if (request.field.startsWith("address")) return row.addressId === item.id;
        return row.contactId === item.id;
      });
    } catch (error) {
      return { ok: false, code: "unavailable", message: error instanceof Error ? error.message : "The credential vault is unavailable." };
    }
    if (!purchase) {
      return { ok: false, code: "not_granted", message: "A payment on this page needs the person's approval first. Call request_purchase. Nothing was filled, and you never receive the card number." };
    }
    const value = paymentField(item, request.field);
    if (!value) return { ok: false, code: "no_value", message: `"${item.name}" has no ${request.field} saved. Nothing was filled.` };
    {
      const used = purchase.id;
      try {
        this.mutate(principalId, (_items, purchases) => {
          const row = purchases[used];
          if (!row) return;
          if (row.cardFilledAt === undefined) {
            row.cardFilledAt = now;
            row.formKey = formKey;
          }
          row.filledFields = [...(row.filledFields ?? []), request.field].slice(-20);
        });
      } catch (error) {
        return { ok: false, code: "unavailable", message: error instanceof Error ? error.message : "The credential vault is unavailable." };
      }
    }
    const stamp = this.now();
    try {
      this.mutate(principalId, (items) => {
        const current = items[item.id];
        if (current) {
          current.lastUsedAt = stamp;
          current.lastUsedBy = request.botId;
        }
      });
    } catch {
      // the fill still happens
    }
    return { ok: true, value, item: listingOf(item, stamp), field: request.field };
  }

  /** Forget a person's whole vault (their account is deleted). */
  drop(principalId: string): void {
    rmSync(this.file(principalId), { force: true });
    this.cache.delete(principalId);
  }
}

function applyInput(item: StoredVaultItem, input: VaultItemInput, creating: boolean): void {
  if (input.name !== undefined || creating) {
    const name = text(input.name ?? "", "name", 120).trim();
    if (!name) throw new CredentialVaultError("A name is required", "invalid_name");
    item.name = name;
  }
  if (input.domains !== undefined) item.domains = domainsFrom(input.domains);
  const loginLike = item.kind === "login" || item.kind === "apiKey" || item.kind === "note";
  if (loginLike && input.username !== undefined) {
    const username = text(input.username, "username", 512).trim();
    if (username) item.username = username;
    else delete item.username;
  }
  if (loginLike && input.password !== undefined) {
    const password = text(input.password, "password", 4_096);
    if (password) item.password = password;
    else delete item.password;
  }
  if (loginLike && input.totpSeed !== undefined) {
    const seed = text(input.totpSeed, "one-time code seed", 1_024).trim();
    if (seed && !parseTotpSeed(seed)) throw new CredentialVaultError("The one-time code seed must be a base32 secret or an otpauth:// link", "invalid_totp");
    if (seed) item.totpSeed = seed;
    else delete item.totpSeed;
  }
  if (loginLike && input.apiKey !== undefined) {
    const apiKey = text(input.apiKey, "API key", 16_384).trim();
    if (apiKey) item.apiKey = apiKey;
    else delete item.apiKey;
  }
  if (input.notes !== undefined) {
    const notes = text(input.notes, "notes", 16_384);
    if (notes.trim()) item.notes = notes;
    else delete item.notes;
  }
  if (item.kind === "card") {
    const card = mergeCard(item.card, input.card, creating || !item.card);
    if (typeof card === "string") throw new CredentialVaultError(card, "invalid_card");
    item.card = card;
  }
  if (item.kind === "address" && (creating || input.address !== undefined)) {
    const address = parseAddress(input.address);
    if (typeof address === "string") throw new CredentialVaultError(address, "invalid_address");
    item.address = address;
  }
  if (item.kind === "contact" && (creating || input.contact !== undefined)) {
    const contact = parseContact(input.contact);
    if (typeof contact === "string") throw new CredentialVaultError(contact, "invalid_contact");
    item.contact = contact;
  }
  if (item.kind === "login" && !item.domains.length) {
    throw new CredentialVaultError("A login needs at least one site it may be filled on", "invalid_domains");
  }
}

function visibleText(value: string): string {
  let text = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) text += char;
  }
  return text.trim();
}

function domainOfPage(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    if (url.username || url.password || url.protocol !== "https:") return null;
    return normalizeVaultDomain(url.host);
  } catch {
    return null;
  }
}

function purchaseCovers(row: StoredPurchase, botId: string, threadId: string, domain: string, now: number): boolean {
  if (row.botId !== botId || row.domain !== domain) return false;
  if (row.status !== "once") return false;
  return row.threadId === threadId && (row.expiresAt ?? 0) > now;
}

/** How long the rest of a payment form may be filled after its card number. */
const PURCHASE_FORM_MS = 10 * 60_000;

/** The page and form a payment approval is used on: the page's address
 * without its query or fragment, and the form's identity the browser read
 * (its submit targets). */
function paymentFormKey(pageUrl: string, form: string | undefined): string {
  let page = pageUrl;
  try {
    const url = new URL(pageUrl);
    page = `${url.origin}${url.pathname}`;
  } catch {
    // the raw address
  }
  return createHash("sha256").update(JSON.stringify([page, form ?? ""])).digest("hex");
}

/** The cart a purchase approval is bound to. */
function cartKey(items: readonly PurchaseItem[] | undefined, flights: readonly PurchaseFlightLeg[] | undefined): string {
  return JSON.stringify([items ?? [], flights ?? []]);
}

function newPurchaseId(purchases: Record<string, StoredPurchase>): string {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = `pay_${randomBytes(8).toString("hex")}`;
    if (!purchases[id]) return id;
  }
  throw new CredentialVaultError("The purchase could not be saved.", "vault_unavailable", 503);
}

function paymentField(item: StoredVaultItem, field: PaymentFillField): string | null {
  const card: StoredCard | undefined = item.card;
  const address: StoredAddress | undefined = item.address;
  const contact: StoredContact | undefined = item.contact;
  if (field === "cardNumber") return card?.pan ?? null;
  if (field === "cardExpiry") return card ? cardExpiryText(card) : null;
  if (field === "cardCvc") return card?.cvv ?? null;
  if (field === "cardholder") return card?.holder ?? null;
  if (field === "addressRecipient") return address?.recipient ?? null;
  if (field === "addressLine1") return address?.line1 ?? null;
  if (field === "addressLine2") return address?.line2 ?? null;
  if (field === "addressCity") return address?.city ?? null;
  if (field === "addressRegion") return address?.region ?? null;
  if (field === "addressPostal") return address?.postal ?? null;
  if (field === "addressCountry") return address?.country ?? null;
  if (field === "addressPhone") return address?.phone ?? null;
  if (field === "contactName") return contact?.fullName ?? null;
  if (field === "contactEmail") return contact?.email ?? null;
  if (field === "contactPhone") return contact?.phone ?? null;
  return contact?.company ?? null;
}

/** The browser runtime's view of the vault for one turn
 * (server/browser-runtime.ts CredentialFillAccess): this person's vault, this
 * bot, this conversation. */
export function fillResolverFor(
  vault: CredentialVault,
  context: { principalId: string; botId: string; threadId: string },
  readOnePassword?: OnePasswordFieldReader,
  /** A purchase was asked or recorded: the conversation shows its card. */
  onPurchase?: (listing: PurchaseListing) => void,
): {
  resolve(request: { handle: string; field: VaultFillField; pageUrl: string; form?: string }): Promise<{ ok: true; value: string; label: string } | { ok: false; message: string; code: string }>;
  armed(): boolean;
  requestPurchase(input: PurchaseRequestInput): { ok: true; message: string } | { ok: false; message: string };
  recordPurchase(input: { pageUrl: string; orderRef?: string; total?: string; items?: PurchaseItem[]; flights?: PurchaseFlightLeg[] }): { ok: true; message: string } | { ok: false; message: string };
} {
  return {
    async resolve(request) {
      const resolved = await vault.resolveForFill(context.principalId, { ...request, botId: context.botId, threadId: context.threadId }, readOnePassword);
      // a 1Password item's own title never reaches the bot (review of #954)
      return resolved.ok ? { ok: true, value: resolved.value, label: resolved.item.source === "1password" ? "a 1Password login" : resolved.item.name } : { ok: false, message: resolved.message, code: resolved.code };
    },
    armed: () => vault.armed(context.principalId, context.botId, context.threadId),
    requestPurchase(input) {
      try {
        const opened = vault.openPurchase(context.principalId, {
          botId: context.botId,
          threadId: context.threadId,
          pageUrl: input.pageUrl,
          amount: input.amount,
          currency: input.currency,
          cardId: input.cardId,
          ...(input.merchant ? { merchant: input.merchant } : {}),
          ...(input.addressId ? { addressId: input.addressId } : {}),
          ...(input.contactId ? { contactId: input.contactId } : {}),
          ...(input.items ? { items: input.items } : {}),
          ...(input.flights ? { flights: input.flights } : {}),
        });
        if (!opened.already) notify(opened.listing);
        return { ok: true as const, message: opened.note };
      } catch (error) {
        const message = error instanceof Error ? error.message : "The purchase could not be asked.";
        return { ok: false as const, message };
      }
    },
    recordPurchase(input) {
      try {
        const listing = vault.recordPurchase(context.principalId, { ...input, botId: context.botId, threadId: context.threadId });
        if (!listing) return { ok: false as const, message: "No approved purchase covers this page: nothing was recorded. A payment needs request_purchase first." };
        notify(listing);
        const mismatch = listing.mismatch ? ` The confirmed total ${listing.receipt?.total} ${listing.currency} does not match the approved ${listing.amount}: tell the person plainly.` : "";
        return { ok: true as const, message: `Recorded: ${listing.merchant}, ${listing.amount} ${listing.currency}${listing.orderRef ? `, order ${listing.orderRef}` : ""}. The person sees the receipt in this conversation. Tell them it is done.${mismatch}` };
      } catch (error) {
        return { ok: false as const, message: error instanceof Error ? error.message : "The purchase could not be recorded." };
      }
    },
  };
  function notify(listing: PurchaseListing): void {
    try {
      onPurchase?.(listing);
    } catch {
      // the card is a convenience: the purchase itself stands
    }
  }
}

export interface PurchaseRequestInput {
  pageUrl: string; amount: string; currency: string; cardId: string;
  merchant?: string; addressId?: string; contactId?: string;
  items?: PurchaseItem[]; flights?: PurchaseFlightLeg[];
}
