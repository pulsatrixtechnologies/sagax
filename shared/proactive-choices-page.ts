// #3513: `notifications.proactiveChoices` as a bot reads it through
// sagax_settings: whole, never cut in the middle of a domain. The person's
// choices and what was already asked (and when) come first, then the
// domains they can choose, a page at a time; `nextOffset` reads on.

/** The characters a page of domains holds at most (one domain always
 * fits, however long). */
export const PROACTIVE_CHOICES_PAGE_BUDGET = 6_000;
/** The last asks a first page carries (the ledger keeps more). */
export const PROACTIVE_ASKS_SHOWN = 20;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function offsetOf(request: unknown): number {
  const raw = isObject(request) ? request.offset : request;
  const offset = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  return typeof offset === "number" && Number.isSafeInteger(offset) && offset > 0 ? offset : 0;
}

function iso(at: unknown): string | undefined {
  return typeof at === "number" && Number.isFinite(at) ? new Date(at).toISOString() : undefined;
}

/** One domain the person can choose, without what a bot never needs to
 * choose (the tools and products of each watch). */
function compactDomain(row: unknown): Json | null {
  if (!isObject(row) || typeof row.domain !== "string") return null;
  const watches = Array.isArray(row.watches) ? row.watches.flatMap((watch): Json[] => {
    if (!isObject(watch) || typeof watch.id !== "string") return [];
    return [{
      id: watch.id, summary: watch.summary, cadence: watch.cadence, runs: watch.runs === true,
      ...(watch.missing ? { missing: watch.missing } : {}),
      ...(Array.isArray(watch.lacking) && watch.lacking.length ? { lacking: watch.lacking } : {}),
    }];
  }) : [];
  return {
    domain: row.domain, label: row.label, eligible: row.eligible === true,
    ...(row.audience ? { audience: row.audience } : {}),
    watches,
  };
}

/** The answer of GET /api/me/proactive as a page: the first page (offset
 * 0) carries the person's choices, when the first question was asked, what
 * each bot asked and the last asks; every page carries the domains from
 * `offset` that fit, `total` and `nextOffset` (null on the last page). */
export function pageProactiveChoices(value: unknown, request: unknown, budget = PROACTIVE_CHOICES_PAGE_BUDGET): unknown {
  if (!isObject(value)) return value;
  const offset = offsetOf(request);
  const all = (Array.isArray(value.available) ? value.available : []).map(compactDomain).filter((row): row is Json => row !== null);
  const asks = Array.isArray(value.asks) ? value.asks.filter(isObject) : [];
  const head: Json = offset === 0 ? {
    choices: isObject(value.domains) ? value.domains : {},
    ...(iso(value.firstAskedAt) ? { firstQuestionAt: iso(value.firstAskedAt) } : {}),
    ...(isObject(value.asked) ? { firstQuestionByBot: Object.fromEntries(Object.entries(value.asked).flatMap(([bot, at]) => (iso(at) ? [[bot, iso(at)]] : []))) } : {}),
    asks: asks.slice(-PROACTIVE_ASKS_SHOWN).map((ask) => ({
      domain: ask.domain, botId: ask.botId, at: iso(ask.at),
      answer: typeof ask.answer === "string" ? ask.answer : "waiting",
      ...(iso(ask.answeredAt) ? { answeredAt: iso(ask.answeredAt) } : {}),
    })),
    ...(asks.length > PROACTIVE_ASKS_SHOWN ? { asksTotal: asks.length } : {}),
  } : {};
  const room = Math.max(0, budget - JSON.stringify(head).length);
  const available: Json[] = [];
  let used = 0;
  for (let at = offset; at < all.length; at += 1) {
    const size = JSON.stringify(all[at]).length + 1;
    if (available.length > 0 && used + size > room) break;
    available.push(all[at]!);
    used += size;
  }
  const end = offset + available.length;
  const nextOffset = end < all.length ? end : null;
  return {
    ...head,
    ...(typeof value.botId === "string" ? { botId: value.botId } : {}),
    ...(typeof value.unavailable === "string" ? { unavailable: value.unavailable } : {}),
    available,
    total: all.length,
    offset,
    nextOffset,
    ...(nextOffset !== null ? { next: `get notifications.proactiveChoices again with value {"offset": ${nextOffset}} for the next domains` } : {}),
  };
}
