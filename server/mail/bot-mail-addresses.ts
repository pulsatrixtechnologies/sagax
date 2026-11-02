// The bots' own email addresses, read from Perspicax (contract B of
// 2026-10-21, B21 / iOS CO5; the delivery side is server/mail/bot-inbound-mail.ts).
//
//   POST <perspicax>/api/v1/pulsabot/inbound-mail/addresses   (link token)
//   { "bots": [ { "id", "name", "owner_sub" } ] }   at most 500
//   -> { "enabled", "domain", "addresses": [ { "bot_id", "address", "enabled" } ] }
//
// Perspicax records each (server, bot, name, owner) and allocates an address
// for a bot it does not know yet, only while inbound mail is enabled there.
// Sagax asks for every bot that has a Perspicax owner in ONE call and keeps
// the answer 5 minutes. A 404 (an older Perspicax), any other refusal, a
// timeout, an answer that is not the contract's, or inbound mail off: the
// bot has no address (`available: false`) and the app shows nothing. Never
// logs the link token or a body (linkPostJson does neither).
//
// 2026-10-28: each call also carries the owner's own token
// (x-perspicax-subject-token) when there is one. A Perspicax that asks for
// it takes one owner per call and answers `403 subject` to a list of
// several owners; from that answer on, this server asks owner by owner, and
// `complete` then speaks for that owner's bots only. A Perspicax that does
// not ask for it keeps getting the one call for every bot, as before (there
// `complete` speaks for the whole server, so it never gets one owner's list
// marked complete).
import { isSubjectRefusal, type LinkPostLimits, type LinkPostResult } from "../perspicax-link.ts";

export const BOT_MAIL_ADDRESSES_PATH = "/api/v1/pulsabot/inbound-mail/addresses";
export const BOT_MAIL_CACHE_MS = 5 * 60_000;
export const BOT_MAIL_BATCH_MAX = 500;
/** Owner calls in flight at once (one owner per call). */
const OWNER_CALLS_AT_ONCE = 4;
const TIMEOUT_MS = 5_000;
const ANSWER_MAX_BYTES = 256 * 1024;
const ADDRESS = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9.-]{1,253}$/;
/** v2: the local part an owner may ask for (Perspicax checks uniqueness and
 * reserved names). */
export const BOT_MAIL_LOCAL_PART = /^[a-z0-9]([a-z0-9.-]{0,38}[a-z0-9])?$/;

/** The owner's change of address, as Sagax reports it. */
export type LocalPartResult =
  | { ok: true; mail: BotInboundMail }
  | { ok: false; error: "invalid" | "not_owner" | "no_bot" | "taken" | "rate_limited" | "unavailable" };

/** One of this server's bots, as contract B names it. */
export interface BotMailBot {
  id: string;
  name: string;
  /** The owner's Perspicax user id; null for a bot with no Perspicax owner
   * (it then has no address and is not sent). */
  ownerSub: string | null;
}

/** What `GET /api/bots/:id/inbound-mail` answers (contract C). */
export interface BotInboundMail {
  available: boolean;
  address: string | null;
  enabled: boolean;
}

export const NO_BOT_MAIL: BotInboundMail = Object.freeze({ available: false, address: null, enabled: false });

export interface BotMailAddressesOptions {
  /** The Perspicax link (PerspicaxDirectory), null on a solo server. */
  link: () => { linkPostJson(path: string, body: unknown, limits: LinkPostLimits): Promise<LinkPostResult> } | null;
  bots: () => BotMailBot[];
  now?: () => number;
  log?: (line: string) => void;
}

interface Snapshot {
  at: number;
  /** The bot ids the call asked for. */
  asked: Set<string>;
  /** Null when the call failed or inbound mail is off. */
  entries: Map<string, BotInboundMail> | null;
}

/** The answer's entries, or null when it is not the contract's. */
export function parseAddresses(body: unknown): Map<string, BotInboundMail> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { enabled, addresses } = body as { enabled?: unknown; addresses?: unknown };
  if (typeof enabled !== "boolean" || !Array.isArray(addresses)) return null;
  const entries = new Map<string, BotInboundMail>();
  if (!enabled) return entries;
  for (const item of addresses) {
    if (!item || typeof item !== "object") return null;
    const { bot_id: botId, address, enabled: on } = item as { bot_id?: unknown; address?: unknown; enabled?: unknown };
    if (typeof botId !== "string" || typeof on !== "boolean") return null;
    if (address === null) continue;
    if (typeof address !== "string" || address.length > 320 || !ADDRESS.test(address)) return null;
    entries.set(botId, { available: true, address, enabled: on });
  }
  return entries;
}

export class BotMailAddresses {
  private readonly options: BotMailAddressesOptions;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private snapshot: Snapshot | null = null;
  private inflight: Promise<Snapshot> | null = null;
  private readonly logged = new Set<string>();
  /** Perspicax asked for one owner per call (a `403 subject` to a list of
   * several owners). Memory only: a restart asks once more. */
  private perOwner = false;
  /** In owner-by-owner mode, the owners whose list Perspicax holds, so an
   * owner left with no bot gets an empty complete list. */
  private readonly syncedOwners = new Set<string>();

  constructor(options: BotMailAddressesOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.log(line));
  }

  /** The bot's address, from the cache when it is fresh and covers it. */
  async forBot(botId: string): Promise<BotInboundMail> {
    const link = this.options.link();
    if (!link) return NO_BOT_MAIL;
    const bot = this.options.bots().find((candidate) => candidate.id === botId);
    if (!bot?.ownerSub) return NO_BOT_MAIL;
    let snapshot = this.snapshot;
    const fresh = snapshot && this.now() - snapshot.at < BOT_MAIL_CACHE_MS;
    if (!snapshot || !fresh || !snapshot.asked.has(botId)) snapshot = await this.refresh(botId);
    return snapshot.entries?.get(botId) ?? NO_BOT_MAIL;
  }

  /** Forget the cached answer (a bot renamed, created or deleted). */
  invalidate(): void {
    this.snapshot = null;
  }

  /** v2 (S3): a bot changed owner or was deleted: forget the cache and send
   * the full list now, so Perspicax's owner and rows stay right. Never throws. */
  async resync(): Promise<void> {
    this.snapshot = null;
    if (!this.options.link()) return;
    try {
      await this.inflight;
      await this.refresh("", true);
    } catch {
      /* a failed sync is retried by the next read */
    }
  }

  /** v2 (decision 4): the owner picks the bot's local part. `ownerSub`
   * is the Perspicax user id of the person acting, already checked to own
   * the bot here. */
  async setLocalPart(botId: string, ownerSub: string, localPart: string): Promise<LocalPartResult> {
    if (!BOT_MAIL_LOCAL_PART.test(localPart)) return { ok: false, error: "invalid" };
    const link = this.options.link();
    if (!link || !/^[\w-]{1,128}$/.test(botId)) return { ok: false, error: "unavailable" };
    const result = await link.linkPostJson(`${BOT_MAIL_ADDRESSES_PATH}/${encodeURIComponent(botId)}/local-part`, { owner_sub: ownerSub, local_part: localPart }, { timeoutMs: TIMEOUT_MS, maxBytes: 16 * 1024, subject: ownerSub });
    this.snapshot = null;
    if (result.ok) {
      const body = result.body as { bot_id?: unknown; address?: unknown; enabled?: unknown } | null;
      if (!body || typeof body.address !== "string" || !ADDRESS.test(body.address) || body.address.length > 320 || typeof body.enabled !== "boolean") {
        return { ok: false, error: "unavailable" };
      }
      return { ok: true, mail: { available: true, address: body.address, enabled: body.enabled } };
    }
    const code = (result.body as { error?: unknown } | undefined)?.error;
    // 429 `rate_limited`: Perspicax's own limit per bot and per owner.
    const known: Record<number, string> = { 400: "invalid", 403: "not_owner", 404: "no_bot", 409: "taken", 429: "rate_limited" };
    if (result.status && known[result.status] === code) return { ok: false, error: code as "invalid" | "not_owner" | "no_bot" | "taken" | "rate_limited" };
    return { ok: false, error: "unavailable" };
  }

  private refresh(first: string, evenEmpty = false): Promise<Snapshot> {
    // One call at a time; a read that waits gets that call's answer.
    this.inflight ??= this.fetch(first, evenEmpty).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetch(first: string, evenEmpty: boolean): Promise<Snapshot> {
    const link = this.options.link();
    const owned = this.options.bots().filter((bot) => bot.ownerSub);
    const at = this.now();
    if (link && this.perOwner) return this.fetchByOwner(link, owned, at, evenEmpty);
    const ordered = [...owned.filter((bot) => bot.id === first), ...owned.filter((bot) => bot.id !== first)].slice(0, BOT_MAIL_BATCH_MAX);
    const asked = new Set(ordered.map((bot) => bot.id));
    let entries: Map<string, BotInboundMail> | null = null;
    // A re-sync sends even an empty list: the last bot was deleted.
    if (link && (ordered.length || evenEmpty)) {
      // v2 (F8): `complete` only when this is every bot with an owner:
      // Perspicax then drops the rows of bots not listed.
      const complete = ordered.length === owned.length;
      const owners = new Set(ordered.map((bot) => bot.ownerSub!));
      const result = await link.linkPostJson(BOT_MAIL_ADDRESSES_PATH, {
        ...(complete ? { complete: true } : {}),
        bots: ordered.map((bot) => ({ id: bot.id, name: bot.name, owner_sub: bot.ownerSub })),
      }, { timeoutMs: TIMEOUT_MS, maxBytes: ANSWER_MAX_BYTES, ...(owners.size === 1 ? { subject: [...owners][0]! } : {}) });
      if (result.ok) {
        entries = parseAddresses(result.body);
        if (!entries) this.once("shape", "bot mail: Perspicax's address answer is not the expected shape; no address shown");
        if (owners.size === 1) this.syncedOwners.add([...owners][0]!);
      } else if (isSubjectRefusal(result) && owners.size > 1) {
        this.perOwner = true;
        this.once("per-owner", "bot mail: Perspicax asks for one owner per call; addresses are now read owner by owner");
        return this.fetchByOwner(link, owned, at, evenEmpty);
      } else if (result.status !== 404) {
        this.once(`error:${result.error}`, `bot mail: Perspicax addresses unavailable (${result.error}${result.status ? ` ${result.status}` : ""})`);
      }
    }
    const snapshot: Snapshot = { at, asked, entries };
    this.snapshot = snapshot;
    return snapshot;
  }

  /** One call per owner, with that owner's token: their bots, `complete`
   * when every one of them is listed. A re-sync also sends an empty
   * complete list to an owner synced before who has no bot left. An owner
   * whose call fails has no address shown; the others keep theirs. */
  private async fetchByOwner(link: NonNullable<ReturnType<BotMailAddressesOptions["link"]>>, owned: BotMailBot[], at: number, evenEmpty: boolean): Promise<Snapshot> {
    const byOwner = new Map<string, BotMailBot[]>();
    for (const bot of owned) byOwner.set(bot.ownerSub!, [...(byOwner.get(bot.ownerSub!) ?? []), bot]);
    if (evenEmpty) for (const owner of this.syncedOwners) if (!byOwner.has(owner)) byOwner.set(owner, []);
    const asked = new Set<string>();
    const entries = new Map<string, BotInboundMail>();
    let answered = false;
    const owners = [...byOwner.entries()];
    for (let start = 0; start < owners.length; start += OWNER_CALLS_AT_ONCE) {
      await Promise.all(owners.slice(start, start + OWNER_CALLS_AT_ONCE).map(async ([owner, all]) => {
        const bots = all.slice(0, BOT_MAIL_BATCH_MAX);
        for (const bot of bots) asked.add(bot.id);
        let result: LinkPostResult;
        try {
          result = await link.linkPostJson(BOT_MAIL_ADDRESSES_PATH, {
            ...(bots.length === all.length ? { complete: true } : {}),
            bots: bots.map((bot) => ({ id: bot.id, name: bot.name, owner_sub: owner })),
          }, { timeoutMs: TIMEOUT_MS, maxBytes: ANSWER_MAX_BYTES, subject: owner });
        } catch {
          result = { ok: false, error: "unreachable" };
        }
        if (!result.ok) {
          if (result.status !== 404) this.once(`error:${result.error}`, `bot mail: Perspicax addresses unavailable for an owner (${result.error}${result.status ? ` ${result.status}` : ""})`);
          return;
        }
        const parsed = parseAddresses(result.body);
        if (!parsed) {
          this.once("shape", "bot mail: Perspicax's address answer is not the expected shape; no address shown");
          return;
        }
        answered = true;
        if (all.length) this.syncedOwners.add(owner);
        else this.syncedOwners.delete(owner);
        for (const [botId, mail] of parsed) entries.set(botId, mail);
      }));
    }
    const snapshot: Snapshot = { at, asked, entries: answered ? entries : null };
    this.snapshot = snapshot;
    return snapshot;
  }

  private once(kind: string, line: string): void {
    if (this.logged.has(kind)) return;
    this.logged.add(kind);
    this.log(line);
  }
}
