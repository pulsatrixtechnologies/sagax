// The person's proactive choices (#3423, lot 2 of #3408): what the server may
// go looking for on the person's behalf, by watch domain of the
// organization's Pulsatrix Flow, and which one of their bots carries it.
//
// Ambient sources (the server goes looking) never run until the person said
// yes. Absent means off: nothing here is ever filled from a default or from a
// bot's stored proactiveMode (createBot and the startup both write
// "proactive", so that value is not a choice).
//
// One row per person; per domain, the one bot that carries it, so two of the
// person's bots never report the same thing. The yes to a domain covers that
// domain's read-only tools inside its alerts (`coversReads`); a write still
// asks and the organization's Refuse and Ask first rules win.

export const PROACTIVE_CHOICES_PATH = "/api/me/proactive";

/** #3432: GET ?view=all adds `receive`, what the person's pages draw
 * (Settings, Notifications, « Ce que je reçois », and each bot's
 * « Ce que ce bot suit pour toi »). */
export const PROACTIVE_RECEIVE_VIEW = "all";

/** One watch of an eligible domain: the person's bots it runs on, and the
 * last time it alerted the person. */
export interface ReceiveWatch {
  id: string;
  summary: string;
  cadence: string;
  runsOn: string[];
  lastAlertAt?: number;
}

/** One domain the person can choose: only eligible ones are listed, with
 * the person's bots that can carry it. */
export interface ReceiveDomain {
  domain: string;
  label: { fr?: string; en?: string };
  audience?: { fr?: string; en?: string };
  carriers: string[];
  watches: ReceiveWatch[];
  lastAlertAt?: number;
}

/** One bot of the person: the ambient rows it can draw. A field that is
 * absent is a row that cannot work there (no screen context off the
 * desktop app, no checklist without HEARTBEAT.md items). */
export interface ReceiveBot {
  id: string;
  brief: boolean;
  screen?: boolean;
  checklist?: boolean;
}

export interface ReceiveView {
  bots: ReceiveBot[];
  domains: ReceiveDomain[];
  /** Why no domain can be listed now, when none can. */
  unavailable?: string;
}

export const DOMAIN_STATES = ["on", "off", "never"] as const;
export type DomainState = (typeof DOMAIN_STATES)[number];

/** How a choice was made: a card, the settings, asked in words to a bot,
 * or an alert's own exit (its "never", stop this watch, stop this domain). */
export const CHOICE_VIAS = ["card", "settings", "words", "alert"] as const;
export type ChoiceVia = (typeof CHOICE_VIAS)[number];

export interface WatchOff {
  at: number;
  via: ChoiceVia;
}

export interface DomainChoice {
  state: DomainState;
  /** The one bot of the person that carries this domain (state on). */
  botId?: string;
  /** Watches of the domain the person switched off; a new watch the
   * organization adds to a chosen domain is on. */
  watchesOff?: Record<string, WatchOff>;
  /** Decision 3 (2026-11-10): the yes covers the domain's read-only tools
   * inside its alerts, without a card. */
  coversReads?: boolean;
  /** When and how it was set, and by whom (a principal id). */
  at: number;
  via: ChoiceVia;
  by: string;
}

/** What a bot proposed, and the answer (#3431, lot 4: the card). An
 * entry without an answer older than three days counts as "not-now". */
export interface AskEntry {
  domain: string;
  botId: string;
  at: number;
  /** The card's proposal (server/proactive/proactive-wake.ts). */
  proposalId?: string;
  answer?: "yes" | "not-now" | "never";
  answeredAt?: number;
}

export interface PersonChoices {
  domains: Record<string, DomainChoice>;
  asks?: AskEntry[];
  /** When the first question was asked of this person (lot 4). */
  firstAskedAt?: number;
  /** #3431: when each bot of the person asked its first question. */
  asked?: Record<string, number>;
}

/** The longest ask ledger kept per person. */
export const ASKS_KEPT = 200;

const ID = /^[\w.:-]{1,120}$/;

export function validChoiceId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

export function emptyChoices(): PersonChoices {
  return { domains: {} };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function viaOf(value: unknown): ChoiceVia | undefined {
  return typeof value === "string" && (CHOICE_VIAS as readonly string[]).includes(value) ? value as ChoiceVia : undefined;
}

/** A stored row, read whole; what does not match is dropped (absent = off). */
export function parsePersonChoices(value: unknown): PersonChoices {
  const out = emptyChoices();
  if (!isObject(value)) return out;
  if (isObject(value.domains)) {
    for (const [domain, row] of Object.entries(value.domains)) {
      if (!validChoiceId(domain) || !isObject(row)) continue;
      const state = typeof row.state === "string" && (DOMAIN_STATES as readonly string[]).includes(row.state) ? row.state as DomainState : undefined;
      const via = viaOf(row.via);
      if (!state || !via || typeof row.at !== "number" || typeof row.by !== "string") continue;
      const watchesOff: Record<string, WatchOff> = {};
      if (isObject(row.watchesOff)) {
        for (const [watchId, off] of Object.entries(row.watchesOff)) {
          const offVia = isObject(off) ? viaOf(off.via) : undefined;
          if (validChoiceId(watchId) && isObject(off) && typeof off.at === "number" && offVia) watchesOff[watchId] = { at: off.at, via: offVia };
        }
      }
      out.domains[domain] = {
        state,
        ...(validChoiceId(row.botId) ? { botId: row.botId } : {}),
        ...(Object.keys(watchesOff).length ? { watchesOff } : {}),
        ...(row.coversReads === true ? { coversReads: true } : {}),
        at: row.at, via, by: row.by,
      };
    }
  }
  if (Array.isArray(value.asks)) {
    const asks = value.asks.flatMap((row): AskEntry[] => {
      if (!isObject(row) || !validChoiceId(row.domain) || !validChoiceId(row.botId) || typeof row.at !== "number") return [];
      const answer = row.answer === "yes" || row.answer === "not-now" || row.answer === "never" ? row.answer : undefined;
      return [{
        domain: row.domain, botId: row.botId, at: row.at,
        ...(validChoiceId(row.proposalId) ? { proposalId: row.proposalId } : {}),
        ...(answer ? { answer } : {}), ...(typeof row.answeredAt === "number" ? { answeredAt: row.answeredAt } : {}),
      }];
    });
    if (asks.length) out.asks = asks.slice(-ASKS_KEPT);
  }
  if (typeof value.firstAskedAt === "number") out.firstAskedAt = value.firstAskedAt;
  if (isObject(value.asked)) {
    const asked: Record<string, number> = {};
    for (const [botId, at] of Object.entries(value.asked)) if (validChoiceId(botId) && typeof at === "number") asked[botId] = at;
    if (Object.keys(asked).length) out.asked = asked;
  }
  return out;
}

/** One change a person (or their bot, on their behalf) asks for. */
export type ChoiceChange =
  | { domain: string; state: DomainState; botId?: string; via: ChoiceVia }
  | { domain: string; watch: string; on: boolean; via: ChoiceVia };

/** The body of PUT /api/me/proactive, or why it is not one. */
export function parseChoiceChange(body: unknown): { ok: true; change: ChoiceChange } | { ok: false; error: string } {
  const usage = "send { domain, state: on|off|never, botId? } or { domain, watch, on: true|false }";
  if (!isObject(body) || !validChoiceId(body.domain)) return { ok: false, error: usage };
  const via = body.via === undefined ? "settings" : viaOf(body.via);
  if (!via) return { ok: false, error: `via must be one of ${CHOICE_VIAS.join(", ")}` };
  if (body.watch !== undefined) {
    if (!validChoiceId(body.watch) || typeof body.on !== "boolean") return { ok: false, error: usage };
    return { ok: true, change: { domain: body.domain, watch: body.watch, on: body.on, via } };
  }
  if (typeof body.state !== "string" || !(DOMAIN_STATES as readonly string[]).includes(body.state)) return { ok: false, error: usage };
  if (body.botId !== undefined && body.botId !== null && !validChoiceId(body.botId)) return { ok: false, error: "botId must be a bot id" };
  return {
    ok: true,
    change: { domain: body.domain, state: body.state as DomainState, ...(typeof body.botId === "string" ? { botId: body.botId } : {}), via },
  };
}

/** The domains a person turned on, with their bot: what the watch loop walks. */
export function chosenDomains(choices: PersonChoices): Array<{ domain: string; botId: string; watchesOff: string[] }> {
  return Object.entries(choices.domains).flatMap(([domain, row]) =>
    row.state === "on" && row.botId ? [{ domain, botId: row.botId, watchesOff: Object.keys(row.watchesOff ?? {}) }] : []);
}
