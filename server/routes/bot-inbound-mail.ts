// GET /api/bots/:id/inbound-mail (contract C, 2026-10-21, B21 / iOS CO5):
// the bot's own email address, given by the Perspicax relay
// (server/bot-mail-addresses.ts), for the bot profile row and the botmail
// trigger editor. `{ available, address, enabled, canChange }`:
// `available: false` on a solo server, an older Perspicax, inbound mail
// off, or any failure (the app then shows nothing). `enabled: false` is an
// address waiting for the administrator (off by default, JC decision 1).
// The address is not an id; it may be shown and copied.
//
// PUT /api/bots/:id/inbound-mail { localPart } (v2, JC decision 4): the
// bot's OWNER picks the part before the @. Checked here first (the person
// acting owns the bot, the format), then Perspicax checks uniqueness and
// reserved names with the owner's Perspicax user id. One audit row
// (metadata: the bot and its new address). At most 5 changes a minute per
// bot and per owner (second review, 2026-10-22), counted only when Perspicax
// is asked; Perspicax keeps its own limit too (429 `rate_limited`).
//
// Client-scoped in server/request-auth.ts; the bot visibility check every
// client route passes (bot-visibility.ts pathSubject) answers a hidden bot
// as missing before this runs.
import { BOT_MAIL_LOCAL_PART, NO_BOT_MAIL, type BotInboundMail, type LocalPartResult } from "../bot-mail-addresses.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotInboundMailReadDeps {
  bot(id: string): { id: string } | null | undefined;
  /** An organization server linked to Perspicax. */
  organization(): boolean;
  address(botId: string): Promise<BotInboundMail>;
  /** The Perspicax user id of the person making this request when they own
   * the bot, else null. */
  ownerSub(auth: RequestAuth, botId: string): string | null;
  setLocalPart(botId: string, ownerSub: string, localPart: string): Promise<LocalPartResult>;
  record(auth: RequestAuth, row: { botId: string; address: string }): void;
  /** Clock for the change limit (tests). */
  now?(): number;
}

/** Changes a minute per bot and per owner. */
export const LOCAL_PART_CHANGES_PER_MINUTE = 5;
const LIMIT_WINDOW_MS = 60_000;

const REFUSALS: Record<Exclude<LocalPartResult, { ok: true }>["error"], { status: number; message: string }> = {
  invalid: { status: 400, message: "Use 1 to 40 lowercase letters, digits, dots or dashes, starting and ending with a letter or a digit. Some names are reserved." },
  not_owner: { status: 403, message: "Only the bot's owner can change its address." },
  no_bot: { status: 404, message: "Perspicax does not know this bot yet. Try again in a few minutes." },
  taken: { status: 409, message: "This address is already taken. Pick another one." },
  rate_limited: { status: 429, message: "Too many address changes. Wait a minute, then try again." },
  unavailable: { status: 503, message: "Perspicax could not change the address right now. Try again later." },
};

export function createBotInboundMailReadRoutes(deps: BotInboundMailReadDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  // Times of the recent changes, by "bot:<id>" and "owner:<sub>".
  const recent = new Map<string, number[]>();
  const fresh = (key: string, at: number): number[] => {
    const kept = (recent.get(key) ?? []).filter((time) => at - time < LIMIT_WINDOW_MS);
    if (kept.length) recent.set(key, kept);
    else recent.delete(key);
    return kept;
  };
  /** Counts one change unless the bot or the owner is at the limit. */
  const admit = (botId: string, sub: string): boolean => {
    const at = now();
    const keys = [`bot:${botId}`, `owner:${sub}`];
    if (keys.some((key) => fresh(key, at).length >= LOCAL_PART_CHANGES_PER_MINUTE)) return false;
    for (const key of keys) recent.set(key, [...(recent.get(key) ?? []), at]);
    return true;
  };
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const m = /^\/api\/bots\/([\w-]+)\/inbound-mail$/.exec(path);
    if (!m || (method !== "GET" && method !== "PUT")) return PASS;
    const bot = deps.bot(m[1]!);
    if (!bot) return json(res, 404, { error: "no such bot" });
    res.setHeader("cache-control", "no-store");
    if (method === "GET") {
      if (!deps.organization()) return json(res, 200, NO_BOT_MAIL);
      let answer: BotInboundMail = NO_BOT_MAIL;
      try {
        answer = await deps.address(bot.id);
      } catch {
        answer = NO_BOT_MAIL;
      }
      return json(res, 200, { available: answer.available, address: answer.address, enabled: answer.enabled, canChange: answer.available && deps.ownerSub(auth, bot.id) !== null });
    }
    if (!deps.organization()) return json(res, 404, { error: "no such route" });
    const refuse = (error: keyof typeof REFUSALS) => {
      if (error === "rate_limited") res.setHeader("retry-after", "60");
      return json(res, REFUSALS[error].status, { error, message: REFUSALS[error].message });
    };
    const sub = deps.ownerSub(auth, bot.id);
    if (!sub) return refuse("not_owner");
    const body = await readBody(req);
    const localPart = body && typeof body === "object" && !Array.isArray(body) ? (body as { localPart?: unknown }).localPart : undefined;
    if (typeof localPart !== "string" || !BOT_MAIL_LOCAL_PART.test(localPart)) return refuse("invalid");
    if (!admit(bot.id, sub)) return refuse("rate_limited");
    const result = await deps.setLocalPart(bot.id, sub, localPart);
    if (!result.ok) return refuse(result.error);
    deps.record(auth, { botId: bot.id, address: result.mail.address! });
    return json(res, 200, { available: true, address: result.mail.address, enabled: result.mail.enabled, canChange: true });
  };
}
