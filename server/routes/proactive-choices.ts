// #3423: the person's proactive choices (shared/proactive-choices.ts), read
// and changed by the person, or by any of their bots on their behalf through
// sagax_settings (`notifications.proactiveChoices`). The session's person
// only: no admin, no other person's row.
//
// GET lists the stored choices and the domains the person can choose
// (`available`: slug, label, each watch with its summary and cadence, and
// whether it runs on the bot), so a bot asked in words never guesses a slug.
// GET ?view=all (#3432) adds `receive`: per eligible domain, the person's
// bots that can carry it and its watches with their last alert, and per bot
// the ambient rows it can draw, for the person's Settings and bot pages.
// PUT answers that a domain or a watch is unknown, or that a domain cannot
// run on the named bot, instead of storing a yes that would never run.
import {
  PROACTIVE_CHOICES_PATH, PROACTIVE_RECEIVE_VIEW, parseChoiceChange,
  type ChoiceChange, type PersonChoices, type ReceiveBot, type ReceiveDomain, type ReceiveView,
} from "../../shared/proactive-choices.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { OfferedDomain, OfferedListing } from "../proactive/flow-watches.ts";
import type { ProactiveChoices } from "../proactive/proactive-choices.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ProactiveChoicesRouteDeps {
  store: Pick<ProactiveChoices, "get" | "apply">;
  /** The person this request speaks for, or "" (no person: refused). */
  person(auth: RequestAuth): string;
  /** The bot the person names for a domain, when it can carry it: their
   * own, visible and not temporary. */
  ownBot(person: string, botId: string): boolean;
  /** The default carrier of a yes without a bot: the person's main bot,
   * else another bot of theirs. */
  mainBot(person: string): string | undefined;
  /** The domains the person can choose on that bot (the watch loop's
   * listing, server/proactive/flow-watches.ts offered). */
  offered(person: string, botId: string): Promise<OfferedListing>;
  /** #3432: the person's bots that can carry a domain (own, visible, not
   * temporary), with the ambient rows each can draw. */
  bots?(person: string): ReceiveBot[];
  /** #3432: when this watch last alerted the person. */
  lastAlert?(person: string, watchId: string): number | undefined;
}

const UNAVAILABLE: Record<Extract<OfferedListing, { ok: false }>["cause"], string> = {
  "bot-gone": "that bot is gone",
  "bot-not-eligible": "that bot cannot carry a watch (not yours, hidden or temporary)",
  "no-flow": "the organization's Pulsatrix Flow plugin is not on this server",
  "flow-failed": "the organization's Pulsatrix Flow plugin does not answer; try again in a few minutes",
  "no-access": "your Pulsatrix connection does not answer for you",
};

function availableView(listing: OfferedListing | null): Record<string, unknown> {
  if (!listing) return { available: [], unavailable: "you have no bot that can carry a watch" };
  if (!listing.ok) return { available: [], botId: listing.botId, unavailable: UNAVAILABLE[listing.cause] };
  return { available: listing.domains, botId: listing.botId };
}

function names(domains: readonly OfferedDomain[]): string {
  return domains.map((row) => `${row.domain} (${row.label.en ?? row.label.fr ?? row.domain})`).join(", ") || "none";
}

/** #3432: everything the person's pages draw, from the watch loop's own
 * listing on each of their bots: a domain is listed only when one of their
 * bots can carry it, a watch only when it runs on one of them. Listings are
 * read one bot at a time, so the person's daily products read is made once;
 * a listing the GET already read (`known`) is reused, not read again. */
async function receiveView(deps: ProactiveChoicesRouteDeps, person: string, known: ReadonlyMap<string, OfferedListing> = new Map()): Promise<ReceiveView> {
  const bots = deps.bots?.(person) ?? [];
  if (!bots.length) return { bots, domains: [], unavailable: "you have no bot that can carry a watch" };
  const byDomain = new Map<string, ReceiveDomain>();
  let failure: string | undefined;
  for (const bot of bots) {
    const listing = known.get(bot.id) ?? await deps.offered(person, bot.id);
    if (!listing.ok) { failure ??= UNAVAILABLE[listing.cause]; continue; }
    for (const offered of listing.domains) {
      if (!offered.eligible) continue;
      const row = byDomain.get(offered.domain) ?? {
        domain: offered.domain, label: offered.label, ...(offered.audience ? { audience: offered.audience } : {}), carriers: [], watches: [],
      };
      row.carriers.push(bot.id);
      for (const watch of offered.watches) {
        if (!watch.runs) continue;
        const known = row.watches.find((entry) => entry.id === watch.id);
        if (known) { known.runsOn.push(bot.id); continue; }
        const lastAlertAt = deps.lastAlert?.(person, watch.id);
        row.watches.push({ id: watch.id, summary: watch.summary, cadence: watch.cadence, runsOn: [bot.id], ...(lastAlertAt ? { lastAlertAt } : {}) });
      }
      byDomain.set(offered.domain, row);
    }
  }
  const domains = [...byDomain.values()].sort((a, b) => a.domain.localeCompare(b.domain)).map((row) => {
    const last = Math.max(0, ...row.watches.map((watch) => watch.lastAlertAt ?? 0));
    return last ? { ...row, lastAlertAt: last } : row;
  });
  return { bots, domains, ...(!domains.length && failure ? { unavailable: failure } : {}) };
}

export function createProactiveChoicesRoutes(deps: ProactiveChoicesRouteDeps): RouteHandler {
  const listingFor = async (person: string, botId: string | undefined): Promise<OfferedListing | null> =>
    botId ? deps.offered(person, botId) : null;

  /** Why this change cannot be stored, or null: a yes needs a domain that
   * runs on its bot; a no, or a watch switch, needs a known domain (or one
   * already in the person's choices). */
  const refusal = async (person: string, change: ChoiceChange, stored: PersonChoices): Promise<{ status: number; body: Record<string, unknown> } | null> => {
    const isOn = "state" in change && change.state === "on";
    const known = stored.domains[change.domain];
    const listing = await listingFor(person, isOn ? ("botId" in change ? change.botId : undefined) : deps.mainBot(person));
    if (!listing || !listing.ok) {
      // a no can always be stored; a yes or a switch needs the listing
      if (!isOn && ("state" in change || known)) return null;
      return { status: 409, body: { error: `cannot check the domain now: ${listing ? UNAVAILABLE[listing.cause] : "you have no bot that can carry a watch"}`, ...availableView(listing) } };
    }
    const domain = listing.domains.find((row) => row.domain === change.domain);
    if (!domain) {
      if (!isOn && ("state" in change || known)) return null;
      return { status: 404, body: { error: `unknown domain "${change.domain}"; the domains you can choose: ${names(listing.domains)}`, ...availableView(listing) } };
    }
    if ("watch" in change && !domain.watches.some((watch) => watch.id === change.watch) && !known?.watchesOff?.[change.watch]) {
      return { status: 404, body: { error: `unknown watch "${change.watch}" in ${change.domain}; its watches: ${domain.watches.map((watch) => watch.id).join(", ")}`, ...availableView(listing) } };
    }
    if (isOn && !domain.eligible) {
      const missing = new Set(domain.watches.map((watch) => watch.missing));
      const causes = [
        missing.has("product") ? "your connection does not serve a product its watches need" : "",
        missing.has("skill") ? "this bot does not hold the skill its watches use" : "",
        missing.has("read") ? "your connection does not serve the read its watches use" : "",
      ].filter(Boolean);
      const why = causes.join(", or ") || "your connection does not serve a product its watches need";
      return { status: 409, body: { error: `domain "${change.domain}" cannot run on this bot: ${why}`, ...availableView(listing) } };
    }
    return null;
  };

  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (path !== PROACTIVE_CHOICES_PATH) return PASS;
    res.setHeader?.("cache-control", "no-store");
    const person = deps.person(auth);
    if (!person) return json(res, 403, { error: "Sign in as yourself." });
    if (method === "GET") {
      const asked = url?.searchParams.get("botId") ?? undefined;
      if (asked && !deps.ownBot(person, asked)) return json(res, 404, { error: "no such bot of yours" });
      const listed = asked ?? deps.mainBot(person);
      const listing = await listingFor(person, listed);
      const known = new Map(listed && listing ? [[listed, listing]] : []);
      const receive = url?.searchParams.get("view") === PROACTIVE_RECEIVE_VIEW ? { receive: await receiveView(deps, person, known) } : {};
      // #3513: what was already asked, and when, beside the choices
      const stored = deps.store.get(person);
      const ledger = { ...(stored.asks?.length ? { asks: stored.asks } : {}), ...(stored.firstAskedAt !== undefined ? { firstAskedAt: stored.firstAskedAt } : {}), ...(stored.asked ? { asked: stored.asked } : {}) };
      return json(res, 200, { domains: stored.domains, ...ledger, ...availableView(listing), ...receive });
    }
    if (method === "PUT") {
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
        return json(res, 415, { error: "send the choice as JSON (content-type: application/json)" });
      }
      const parsed = parseChoiceChange(await readBody(req));
      if (!parsed.ok) return json(res, 400, { error: parsed.error });
      let change = parsed.change;
      if ("state" in change && change.state === "on") {
        const botId = change.botId ?? deps.mainBot(person);
        if (!botId) return json(res, 400, { error: "name the bot that carries this domain (botId)" });
        if (!deps.ownBot(person, botId)) return json(res, 404, { error: "no such bot of yours" });
        change = { ...change, botId };
      }
      const refused = await refusal(person, change, deps.store.get(person));
      if (refused) return json(res, refused.status, refused.body);
      return json(res, 200, { domains: deps.store.apply(person, change, person).domains });
    }
    return json(res, 405, { error: "GET or PUT" });
  };
}
