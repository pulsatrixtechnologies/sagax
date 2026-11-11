// #3431 (lot 4 of #3408): a bot learns who its person works with, asks what
// they would like to receive, and proposes one watch domain of the
// organization's Pulsatrix Flow with a choice card. Everything here is
// decided by the server, without a model:
//
// - the first question, written by the server, in the bot's own chat (a new
//   bot's intro, the person's main bot once after the upgrade, each other bot
//   the first time the person writes to it);
// - the prompt section of the owner's one-to-one turns (at most three
//   eligible domains not yet decided, ranked by words shared with About me,
//   then with the bot's title; #3458: a domain nobody in the organization
//   follows comes first among those that match About me);
// - `propose_proactive` and its bounds: one proposer per person and domain,
//   one open card per person, one bot-initiated ask per person per local
//   day, two cards per domain at most (the second after "Not now", 14 days
//   later, on the person's own words), "never" final for bots, an unanswered
//   card counted as "Not now" after three days;
// - the card's answer: a yes writes the person's choice with the bot that
//   proposed it; "Ne plus proposer" is kept.
//
// - #3456 (lot 5): the card « Garder le brief du jour ? » of a main bot that
//   had the brief only by default goes through the same ledger and the same
//   bounds (one open card, one ask a day); it is posted once, ever; a yes
//   creates the brief routine, "never" is kept.
//
// The eligibility listing is the watch loop's (flow-watches.ts `offered`),
// the store is the person's choices (proactive-choices.ts): nothing here is
// a second listing or a second store.
import type { AskEntry, PersonChoices } from "../../shared/proactive-choices.ts";
import type { OfferedDomain, OfferedListing, OfferedWatch } from "./flow-watches.ts";
import { parseCadence, readableName } from "./flow-watches.ts";
import type { ProactiveChoices } from "./proactive-choices.ts";
import { PROPOSAL_TTL_MS, type ProposalChoice } from "./proactive-wake.ts";
import { briefCard } from "./brief-routine.ts";

/** #3456: the ledger's key of the brief card (never a Flow domain slug). */
export const BRIEF_ASK_DOMAIN = "sagax.daily-brief";

/** A second card for a domain comes at least this long after "Not now". */
export const SECOND_CARD_AFTER_MS = 14 * 24 * 60 * 60_000;
/** Cards per person and domain, ever. */
export const CARDS_PER_DOMAIN = 2;
/** Domains the prompt section carries at most. */
export const ASK_CANDIDATES = 3;
/** Things the first question names at most. */
const QUESTION_NAMES = 3;

export type AskLanguage = "fr" | "en";

/** How long a turn waits on the first listing of the day. */
export const PROACTIVE_ASK_WAIT_MS = 2_000;
/** #3470: a listing just read serves the person's next turns for this
 * long (dropped sooner when the person's choices or bots change). */
export const ASK_LISTING_FRESH_MS = 5 * 60_000;

/** The work, or `fallback` once `ms` passed: a turn never waits longer. */
export function withinWait<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([work, new Promise<T>((resolve) => { setTimeout(() => resolve(fallback), ms).unref?.(); })]);
}

/** #3470: a macrotask boundary, so timers and requests run between two
 * bots of a listing. */
const yieldLoop = () => new Promise<void>((resolve) => { setImmediate(resolve); });

// ── words ──────────────────────────────────────────────────────────────────

const STOP = new Set([
  "the", "and", "for", "with", "who", "what", "that", "this", "these", "those", "your", "you", "their", "them", "they", "are", "from",
  "about", "into", "when", "any", "all", "each", "every", "has", "have", "its", "our", "can", "will", "not", "but",
  "les", "des", "une", "pour", "avec", "qui", "que", "quoi", "dans", "sur", "par", "est", "son", "ses", "leur", "leurs", "aux",
  "pas", "plus", "tout", "tous", "toute", "toutes", "ceux", "celles", "elle", "elles", "ils", "nous", "vous", "mais", "comme",
  "cette", "ces", "chaque", "entre", "sans", "chez", "bot", "bots",
]);

/** The words a text is about, accents and case folded, a plural "s" off. */
export function wordsOf(text: string): Set<string> {
  const out = new Set<string>();
  const folded = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  for (const raw of folded.split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    out.add(raw.length > 4 && raw.endsWith("s") ? raw.slice(0, -1) : raw);
  }
  return out;
}

/** How many words two texts share. */
export function sharedWords(a: string, b: string): number {
  const left = wordsOf(a);
  let count = 0;
  for (const word of wordsOf(b)) if (left.has(word)) count += 1;
  return count;
}

function both(words: { fr?: string; en?: string } | undefined): string {
  return [words?.fr, words?.en].filter(Boolean).join(" ");
}

/** A domain's "who it is for" line, both languages (its label without one). */
export function audienceText(domain: Pick<OfferedDomain, "audience" | "label" | "domain">): string {
  return both(domain.audience) || both(domain.label) || domain.domain;
}

/** Everything a person's words may name a domain by. */
function domainText(domain: OfferedDomain): string {
  return [both(domain.label), both(domain.audience), domain.domain.replace(/[-_.:]/g, " "), ...domain.watches.map((watch) => watch.summary)].join(" ");
}

export function domainLabelIn(domain: Pick<OfferedDomain, "label" | "domain">, language: AskLanguage): string {
  return (language === "fr" ? domain.label.fr ?? domain.label.en : domain.label.en ?? domain.label.fr) ?? readableName(domain.domain);
}

function audienceIn(domain: Pick<OfferedDomain, "audience">, language: AskLanguage): string | undefined {
  return language === "fr" ? domain.audience?.fr ?? domain.audience?.en : domain.audience?.en ?? domain.audience?.fr;
}

// ── one proposer per person and domain ─────────────────────────────────────

/** One bot of the person, as the proposer rule reads it. */
export interface AskBot {
  id: string;
  /** Its name (the bot's title). */
  title: string;
  description: string;
  /** The person's main bot. */
  main: boolean;
  /** When it first existed (its oldest conversation), when known. */
  bornAt?: number;
}

/** The one bot of the person that may propose a domain or ask its first
 * question about it: among the bots that can carry it, the one whose title
 * and description share the most words with the domain's "who it is for"
 * line; on a tie, or when none matches, the person's main bot (when it can
 * carry it), else the first of the best ones. */
export function proposerFor(audience: string, bots: ReadonlyArray<AskBot & { eligible: boolean }>): string | undefined {
  const eligible = bots.filter((bot) => bot.eligible);
  if (!eligible.length) return undefined;
  const scored = eligible.map((bot) => ({ bot, score: sharedWords(`${bot.title} ${bot.description}`, audience) }));
  const best = Math.max(...scored.map((row) => row.score));
  const top = best > 0 ? scored.filter((row) => row.score === best).map((row) => row.bot) : [];
  if (top.length === 1) return top[0]!.id;
  const main = eligible.find((bot) => bot.main);
  if (main) return main.id;
  return [...(top.length ? top : eligible)].sort((a, b) => a.id.localeCompare(b.id))[0]!.id;
}

// ── the ledger's bounds ───────────────────────────────────────────────────

/** An ask's answer as the bounds read it: an unanswered card older than
 * three days counts as "not-now" from the day it ended. */
export function settledAsk(ask: AskEntry, now: number): { answer: NonNullable<AskEntry["answer"]> | "open"; at: number } {
  if (ask.answer) return { answer: ask.answer, at: ask.answeredAt ?? ask.at };
  if (now - ask.at >= PROPOSAL_TTL_MS) return { answer: "not-now", at: ask.at + PROPOSAL_TTL_MS };
  return { answer: "open", at: ask.at };
}

export type DomainAskState =
  | { kind: "fresh" }
  /** Asked once, answered "Not now" 14 days ago or more: a second card
   * only when the person's own message of this turn is about it. */
  | { kind: "returning" }
  | { kind: "closed"; why: string };

/** Where one domain stands for a person: never asked, may come back once,
 * or closed (and why, in one line for the bot). */
export function domainAskState(choices: PersonChoices, domain: string, now: number): DomainAskState {
  const row = choices.domains[domain];
  if (row?.state === "on") return { kind: "closed", why: "the person already receives it" };
  if (row?.state === "never") return { kind: "closed", why: "the person said never: only they turn it on, in Settings or by asking you in words" };
  if (row?.state === "off" && row.via !== "card") return { kind: "closed", why: "the person turned it off themselves" };
  const asks = (choices.asks ?? []).filter((ask) => ask.domain === domain).map((ask) => settledAsk(ask, now));
  if (asks.some((ask) => ask.answer === "open")) return { kind: "closed", why: "its card is still waiting for the person's answer" };
  if (asks.some((ask) => ask.answer === "never")) return { kind: "closed", why: "the person said never: only they turn it on, in Settings or by asking you in words" };
  if (asks.length >= CARDS_PER_DOMAIN) return { kind: "closed", why: "it was already proposed twice" };
  if (!asks.length) return { kind: "fresh" };
  const last = asks[asks.length - 1]!;
  if (last.answer === "yes") return { kind: "closed", why: "the person already answered yes, then changed it themselves" };
  if (now - last.at < SECOND_CARD_AFTER_MS) return { kind: "closed", why: "the person said not now less than 14 days ago" };
  return { kind: "returning" };
}

/** The person's local day of an instant (YYYY-MM-DD). */
export function localDay(at: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

/** The last bot-initiated ask of the person (a card or a first question). */
function lastAskAt(choices: PersonChoices): number | undefined {
  const times = [...(choices.asks ?? []).map((ask) => ask.at), ...Object.values(choices.asked ?? {})];
  return times.length ? Math.max(...times) : undefined;
}

/** Bound 3: one bot-initiated ask per person per local day. */
export function askedToday(choices: PersonChoices, now: number, timeZone: string): boolean {
  const last = lastAskAt(choices);
  return last !== undefined && localDay(last, timeZone) === localDay(now, timeZone);
}

/** Bound 2: one open card per person, all bots together. */
export function openCard(choices: PersonChoices, now: number): boolean {
  return (choices.asks ?? []).some((ask) => settledAsk(ask, now).answer === "open");
}

function folded(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Bound 4, second card: the quote is the person's own message of this
 * turn and it is about the domain. Null when it holds. */
export function quoteRefusal(quote: string | undefined, message: string, domain: OfferedDomain): string | null {
  const said = folded(quote ?? "");
  if (!said) return "This domain was proposed before: propose it again only when the person's own message of this turn is about it, and pass their words as quote.";
  if (!folded(message).includes(said)) return "The quote is not in the person's own message of this turn: no card.";
  if (!sharedWords(said, domainText(domain))) return "The person's words of this turn are not about this domain: no card.";
  return null;
}

// ── the turn: who may propose ────────────────────────────────────────────

/** What the server knows of the turn that calls propose_proactive. */
export interface AskTurnFacts {
  /** The conversation belongs to the calling bot. */
  ownsThread: boolean;
  /** A room (group conversation). */
  inRoom: boolean;
  /** 0 is a person's own turn; more is another bot's hop. */
  depth: number;
  /** The bot's owner, in their own message (primaryTurnGate "cards"):
   * never a routine, a webhook, a wake, an automation or someone else. */
  ownerOwnWords: boolean;
  /** A live phone call. */
  onCall: boolean;
  /** Another bot's words joined this turn. */
  tainted?: boolean;
}

/** Bound 1: a bot proposes only in a turn its owner started, one to one.
 * Null when the turn may. */
export function askTurnRefusal(turn: AskTurnFacts): string | null {
  if (!turn.ownsThread) return "This conversation is not yours: no card.";
  if (turn.inRoom) return "Proactive alerts are proposed one to one with your person, never in a room: no card.";
  if (turn.onCall) return "Not during a call: no card.";
  if (turn.depth > 0 || turn.tainted) return "Only a turn your person started with their own message may propose: no card.";
  if (!turn.ownerOwnWords) return "Only your person's own message may lead to a proposal (not a wake, a routine, a webhook or someone else's turn): no card.";
  return null;
}

// ── words the person reads ───────────────────────────────────────────────

const DAY_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const DAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A watch's cadence in plain words. */
export function cadenceWords(cadence: string, language: AskLanguage): string {
  const parsed = parseCadence(cadence);
  if (!parsed) return cadence;
  const clock = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = String(minutes % 60).padStart(2, "0");
    return language === "fr" ? `${h} h ${m}` : `${String(h).padStart(2, "0")}:${m}`;
  };
  if (parsed.kind === "every") {
    const minutes = Math.round(parsed.ms / 60_000);
    if (minutes % 60 === 0) {
      const hours = minutes / 60;
      if (language === "fr") return hours === 1 ? "toutes les heures" : `toutes les ${hours} heures`;
      return hours === 1 ? "every hour" : `every ${hours} hours`;
    }
    return language === "fr" ? `toutes les ${minutes} minutes` : `every ${minutes} minutes`;
  }
  if (parsed.kind === "daily") return language === "fr" ? `chaque jour à ${clock(parsed.minutes)}` : `daily at ${clock(parsed.minutes)}`;
  return language === "fr" ? `chaque ${DAY_FR[parsed.day]} à ${clock(parsed.minutes)}` : `every ${DAY_EN[parsed.day]} at ${clock(parsed.minutes)}`;
}

function joinList(items: readonly string[], language: AskLanguage): string {
  if (items.length <= 1) return items[0] ?? "";
  const and = language === "fr" ? "et" : "and";
  return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}

function lowerFirst(text: string): string {
  // an acronym stays as it is
  return /^[A-ZÀ-Þ][a-zß-ÿ]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
}

/** The first question: one sentence naming up to three things this bot
 * could send, with the main bot's preface after the upgrade. */
export function firstQuestionText(labels: readonly string[], language: AskLanguage, preface: boolean): string {
  const names = joinList(labels.slice(0, QUESTION_NAMES).map((label) => (language === "fr" ? lowerFirst(label) : label)), language);
  if (language === "fr") {
    const before = preface ? "Du nouveau : je ne t'envoie plus rien de moi-même tant que tu ne l'as pas choisi. " : "";
    return `${before}Je peux te prévenir de moi-même pour ${names}. Dis-moi ce que tu fais, tes responsabilités et celles de ton équipe, et ce que tu aimerais recevoir.`;
  }
  const before = preface ? "Something changed: I no longer send you anything on my own until you choose it. " : "";
  return `${before}I can let you know on my own about ${names}. Tell me what you do, your responsibilities and your team's, and what you would like to receive.`;
}

/** #3513: why nothing can be offered to the person yet, by name: the
 * skills their bots lack, the products their connection does not serve,
 * and the listings that could not be read. */
export interface NothingOffered {
  skills: string[];
  products: string[];
  causes: Array<Extract<OfferedListing, { ok: false }>["cause"]>;
}

function namedList(names: readonly string[], language: AskLanguage): string {
  const shown = names.slice(0, QUESTION_NAMES).map(readableName);
  const more = names.length - shown.length;
  if (more <= 0) return joinList(shown, language);
  return language === "fr" ? `${shown.join(", ")} et ${more} autre${more > 1 ? "s" : ""}` : `${shown.join(", ")} and ${more} more`;
}

/** #3513: the main bot's one sentence of the upgrade when nothing can be
 * offered yet: it sends nothing on its own, and what is missing, by its
 * readable name (never an identifier). */
export function nothingYetText(nothing: NothingOffered, language: AskLanguage): string {
  const fr = language === "fr";
  const reasons: string[] = [];
  if (nothing.skills.length) {
    const many = nothing.skills.length > 1;
    reasons.push(fr ? `il manque ${many ? "les skills" : "le skill"} ${namedList(nothing.skills, language)} à tes bots` : `your bots lack the skill${many ? "s" : ""} ${namedList(nothing.skills, language)}`);
  }
  if (nothing.products.length) {
    reasons.push(fr ? `ta connexion ne donne pas accès à ${namedList(nothing.products, language)}` : `your connection does not give access to ${namedList(nothing.products, language)}`);
  }
  if (nothing.causes.includes("no-flow")) {
    reasons.push(fr ? "le pack Flow de ton organisation n'est pas sur tes bots" : "your organization's Flow pack is not on your bots");
  }
  if (nothing.causes.includes("no-access") || nothing.causes.includes("bot-not-eligible")) {
    reasons.push(fr ? "tes bots n'ont pas ta connexion au serveur de ton organisation" : "your bots do not have your connection to your organization's server");
  }
  if (!reasons.length) reasons.push(fr ? "le pack de ton organisation ne propose encore aucune alerte" : "your organization's pack offers no alert yet");
  return fr
    ? `Du nouveau : je ne t'envoie plus rien de moi-même tant que tu ne l'as pas choisi. Je ne peux encore rien te proposer : ${reasons.join(" ; ")}.`
    : `Something changed: I no longer send you anything on my own until you choose it. I cannot offer you anything yet: ${reasons.join("; ")}.`;
}

/** The card's options: options[0] is the yes (shared/proactive-proposal.ts). */
export function choiceCardOptions(language: AskLanguage): [string, string] {
  return language === "fr" ? ["Oui", "Pas maintenant"] : ["Yes", "Not now"];
}

/** One watch in the card's folded details: its label, cadence, whether the
 * yes turns it on, and the tools it reads with. Labels only on screen. */
export interface ChoiceCardWatch {
  id: string;
  label: string;
  cadence: string;
  on: boolean;
  tools: string[];
}

export interface ChoiceCard {
  title: string;
  subtitle: string;
  options: [string, string];
  /** The folded details of a watch domain; absent on the brief card. */
  details?: { domain: string; label: string; botName: string; watches: ChoiceCardWatch[] };
}

/** The choice card: a title, one or two plain lines (what it sends, how
 * often, on which bot), Yes and Not now, and the folded details. */
/** #3458: the card's line for a domain nobody in the organization follows. */
export function unfollowedLine(language: AskLanguage): string {
  return language === "fr" ? "Personne ne suit encore ce domaine dans ton organisation." : "Nobody in your organization follows this domain yet.";
}

export function choiceCard(input: { domain: OfferedDomain; chosen: readonly string[]; botName: string; language: AskLanguage; unfollowed?: boolean }): ChoiceCard {
  const { domain, language } = input;
  const label = domainLabelIn(domain, language);
  const runnable = domain.watches.filter((watch) => watch.runs);
  const on = runnable.filter((watch) => input.chosen.includes(watch.id));
  const lines = on.slice(0, 2).map((watch) => `${watch.summary.replace(/\s+/g, " ").trim().replace(/[.]$/, "")} (${cadenceWords(watch.cadence, language)})`);
  const more = on.length - lines.length;
  const what = `${lines.join("; ")}${more > 0 ? (language === "fr" ? `, et ${more} autre${more > 1 ? "s" : ""}` : `, and ${more} more`) : ""}.`;
  const lower = lowerFirst(label);
  const title = language === "fr"
    ? `Recevoir les alertes ${/^[aeiouyhàâéèêëîïôûù]/i.test(lower) ? "d'" : "de "}${lower} ?`
    : `Receive ${label} alerts?`;
  const base = language === "fr"
    ? `${what} Sur ${input.botName}, seulement si tu dis oui.`
    : `${what} On ${input.botName}, only if you say yes.`;
  const subtitle = input.unfollowed ? `${base} ${unfollowedLine(language)}` : base;
  return {
    title,
    subtitle,
    options: choiceCardOptions(language),
    details: {
      domain: domain.domain,
      label,
      botName: input.botName,
      watches: runnable.map((watch) => ({ id: watch.id, label: watch.summary, cadence: cadenceWords(watch.cadence, language), on: input.chosen.includes(watch.id), tools: [...(watch.tools ?? [])] })),
    },
  };
}

// ── the service ──────────────────────────────────────────────────────────

export interface ProactiveAskDeps {
  choices: Pick<ProactiveChoices, "get" | "apply" | "noteAsk" | "answerAsk" | "noteQuestion" | "noteFirstSaid" | "since" | "chosen"> & Partial<Pick<ProactiveChoices, "moveAsk">>;
  /** The person's bots that can carry a watch: their own, visible, not
   * temporary. */
  bots(person: string): AskBot[];
  /** The watch loop's listing for one bot (flow-watches.ts offered). */
  offered(person: string, botId: string): Promise<OfferedListing>;
  aboutMe(person: string): string;
  /** #3458: how many people of the organization have a bot (one on a
   * personal server). With one, nobody else could follow a domain. */
  people?(): number;
  timeZone(person: string): string;
  language(person: string): AskLanguage;
  /** Post the choice card in the bot's conversation with the person; the
   * proposal's id. No push: the person is in that conversation. */
  postCard(input: { botId: string; threadId: string; card: ChoiceCard; choice: ProposalChoice }): string;
  /** #3456: the brief card's yes: the bot's brief routine is created. */
  briefYes?(person: string, botId: string): void;
  now?: () => number;
}

/** What the person's bots can offer, per domain: each bot's eligible
 * domains, and the one proposer of each domain. */
export interface AskListing {
  byBot: Map<string, OfferedDomain[]>;
  proposer: Map<string, string>;
  /** #3513: what the person's bots lack, by name, when no domain is
   * eligible on any of them; `transient` when a listing could not be read
   * now (the reason is then not said). */
  nothing?: NothingOffered & { transient: boolean };
}

export interface ProposeInput {
  person: string;
  botId: string;
  threadId: string;
  /** The person's own message of this turn. */
  message: string;
  domain: string;
  watches?: readonly string[];
  quote?: string;
}

export class ProactiveAsk {
  private readonly deps: ProactiveAskDeps;

  private readonly now: () => number;

  /** #3470: the person's last listing (or the one being read), with the
   * bots and choices it was read for. */
  private readonly listings = new Map<string, { at: number; key: string; value: Promise<AskListing> }>();

  constructor(deps: ProactiveAskDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  /** Every bot of the person read once: what each can carry, and who
   * proposes what. Nothing eligible: empty maps. #3470: one listing serves
   * a turn and the person's next turns for a short time; a change of their
   * bots or choices reads it again. */
  listing(person: string): Promise<AskListing> {
    const bots = this.deps.bots(person);
    const key = JSON.stringify([bots, this.deps.choices.get(person).domains]);
    const hit = this.listings.get(person);
    const now = this.now();
    if (hit && hit.key === key && now - hit.at < ASK_LISTING_FRESH_MS) return hit.value;
    const value = this.read(person, bots);
    this.listings.set(person, { at: now, key, value });
    return value;
  }

  private async read(person: string, bots: AskBot[]): Promise<AskListing> {
    const byBot = new Map<string, OfferedDomain[]>();
    const skills = new Set<string>();
    const products = new Set<string>();
    const causes = new Set<NothingOffered["causes"][number]>();
    for (const [index, bot] of bots.entries()) {
      if (index > 0) await yieldLoop();
      const offered = await this.deps.offered(person, bot.id).catch(() => null);
      if (!offered) causes.add("flow-failed");
      else if (!offered.ok) causes.add(offered.cause);
      else {
        byBot.set(bot.id, offered.domains.filter((domain) => domain.eligible));
        for (const watch of offered.domains.flatMap((domain) => domain.watches)) {
          for (const name of watch.lacking ?? []) (watch.missing === "skill" ? skills : products).add(name);
        }
      }
    }
    const slugs = new Map<string, OfferedDomain>();
    for (const domains of byBot.values()) for (const domain of domains) if (!slugs.has(domain.domain)) slugs.set(domain.domain, domain);
    const proposer = new Map<string, string>();
    for (const [slug, domain] of slugs) {
      const picked = proposerFor(audienceText(domain), bots.map((bot) => ({ ...bot, eligible: Boolean(byBot.get(bot.id)?.some((row) => row.domain === slug)) })));
      if (picked) proposer.set(slug, picked);
    }
    const nothing = proposer.size ? undefined : {
      skills: [...skills].sort(), products: [...products].sort(), causes: [...causes].filter((cause) => cause !== "flow-failed" && cause !== "bot-gone").sort(),
      transient: causes.has("flow-failed"),
    };
    return { byBot, proposer, ...(nothing ? { nothing } : {}) };
  }

  /** #3458: the organization's domains somebody follows (a person has it
   * on), or null on a server of one person. Only this fact leaves the
   * store: never who follows it. */
  private followed(): Set<string> | null {
    if ((this.deps.people?.() ?? 1) < 2) return null;
    return new Set(this.deps.choices.chosen().flatMap((row) => row.domains.map((choice) => choice.domain)));
  }

  /** #3458: nobody in the organization follows this domain (never on a
   * server of one person). */
  unfollowed(domain: string): boolean {
    const followed = this.followed();
    return followed !== null && !followed.has(domain);
  }

  /** The domains this bot may still propose to its person, ranked by words
   * shared with About me, then with the bot's title; at most three. #3458:
   * a domain nobody in the organization follows comes first among those
   * that share words with About me (what the bot learned of the person's
   * work, responsibilities and team); one that does not match keeps its
   * place. `unfollowed` marks those. */
  async candidates(person: string, botId: string, listing?: AskListing): Promise<Array<{ domain: OfferedDomain; returning: boolean; unfollowed: boolean }>> {
    const read = listing ?? await this.listing(person);
    const choices = this.deps.choices.get(person);
    const now = this.now();
    const about = this.deps.aboutMe(person);
    const bot = this.deps.bots(person).find((row) => row.id === botId);
    const title = bot ? `${bot.title} ${bot.description}` : "";
    const followed = this.followed();
    return (read.byBot.get(botId) ?? [])
      .filter((domain) => read.proposer.get(domain.domain) === botId)
      .map((domain) => ({ domain, state: domainAskState(choices, domain.domain, now) }))
      .filter((row) => row.state.kind !== "closed")
      .map((row) => {
        const shared = sharedWords(about, domainText(row.domain));
        const unfollowed = followed !== null && !followed.has(row.domain.domain) && shared > 0;
        return { domain: row.domain, returning: row.state.kind === "returning", unfollowed, about: shared, titled: sharedWords(title, domainText(row.domain)) };
      })
      .sort((a, b) => Number(b.unfollowed) - Number(a.unfollowed) || b.about - a.about || b.titled - a.titled || a.domain.domain.localeCompare(b.domain.domain))
      .slice(0, ASK_CANDIDATES)
      .map(({ domain, returning, unfollowed }) => ({ domain, returning, unfollowed }));
  }

  /** The prompt section of an owner's one-to-one turn, or "" (and the
   * tool is then not mounted). */
  async turnSection(person: string, botId: string): Promise<string> {
    const found = await this.candidates(person, botId);
    if (!found.length) return "";
    const choices = this.deps.choices.get(person);
    const now = this.now();
    const blocked = openCard(choices, now) || askedToday(choices, now, this.deps.timeZone(person));
    const lines = found.map(({ domain, returning, unfollowed }) => {
      const audience = audienceIn(domain, "en") ?? audienceIn(domain, "fr");
      const watches = domain.watches.filter((watch) => watch.runs).map((watch) => `${watch.id}: ${watch.summary} (${cadenceWords(watch.cadence, "en")})`).join("; ");
      return `- ${domainLabelIn(domain, "en")} (domain "${domain.domain}")${audience ? `, for: ${audience}` : ""}. Watches: ${watches}.${unfollowed ? " Nobody in the organization follows it yet: offer it first when it matches their work." : ""}${returning ? " Proposed before and answered not now: propose it again only if the person's own message of this turn is about it, with their words as quote." : ""}`;
    });
    return [
      "",
      "",
      "Proactive alerts you could offer your person (watch domains of the organization they have not decided yet; nothing is sent before they say yes on a card):",
      ...lines,
      "Learn who you work with: their work, their responsibilities and their team. Ask one simple question at a time, never a list, and never what About the user already says. When they tell you about their work, their responsibilities or their team, save it with propose_proactive about_person (their facts, one per item); it goes to their About me, shared with all their bots.",
      blocked
        ? "No card can be posted today (one is waiting for an answer, or the person was already asked today): only learn, do not call propose_proactive with a domain."
        : "When their work, your own purpose or the present subject matches one of these, call propose_proactive once with that domain and the watches they want; the server posts the card. A refusal comes back in one line: say nothing about it to the person. Never promise an alert before they said yes on the card.",
      "If the person asks in words to turn one on or off, that is not a proposal: set it through sagax_settings (notifications.proactiveChoices).",
    ].join("\n");
  }

  /** propose_proactive with a domain: the card, or one line for the bot
   * (nothing is shown). The turn was already checked (askTurnRefusal). */
  async propose(input: ProposeInput): Promise<{ posted: boolean; text: string; proposalId?: string }> {
    const refuse = (text: string) => ({ posted: false, text });
    const listing = await this.listing(input.person);
    const domain = listing.byBot.get(input.botId)?.find((row) => row.domain === input.domain);
    if (!domain) return refuse(`"${input.domain}" is not a domain you can carry for this person (unknown, or its watches cannot run here): no card.`);
    if (listing.proposer.get(domain.domain) !== input.botId) return refuse("Another of the person's bots proposes this domain: no card, say nothing about it.");
    const choices = this.deps.choices.get(input.person);
    const now = this.now();
    const state = domainAskState(choices, domain.domain, now);
    if (state.kind === "closed") return refuse(`No card: ${state.why}.`);
    if (state.kind === "returning") {
      const quoted = quoteRefusal(input.quote, input.message, domain);
      if (quoted) return refuse(quoted);
    }
    if (openCard(choices, now)) return refuse("A card is already waiting for the person's answer: no second card.");
    if (askedToday(choices, now, this.deps.timeZone(input.person))) return refuse("The person was already asked something today by one of their bots: no card today.");
    const runnable = domain.watches.filter((watch: OfferedWatch) => watch.runs).map((watch) => watch.id);
    const asked = (input.watches ?? []).filter((id) => runnable.includes(id));
    const chosen = asked.length ? asked : runnable;
    const others = runnable.filter((id) => !chosen.includes(id));
    const bot = this.deps.bots(input.person).find((row) => row.id === input.botId);
    const card = choiceCard({ domain, chosen, botName: bot?.title ?? "", language: this.deps.language(input.person), unfollowed: this.unfollowed(domain.domain) });
    const proposalId = this.deps.postCard({ botId: input.botId, threadId: input.threadId, card, choice: { person: input.person, domain: domain.domain, watches: chosen, others } });
    this.deps.choices.noteAsk(input.person, { domain: domain.domain, botId: input.botId, at: now, proposalId });
    return { posted: true, proposalId, text: "The card is posted in this conversation. End your turn without repeating it: the person answers on the card." };
  }

  /** The first question of one bot, once, or null (nothing to offer, or
   * the person was asked today). Recorded when returned. */
  async question(person: string, botId: string, preface: boolean, listing?: AskListing): Promise<string | null> {
    const choices = this.deps.choices.get(person);
    if (choices.asked?.[botId] !== undefined) return null;
    const now = this.now();
    if (askedToday(choices, now, this.deps.timeZone(person))) return null;
    const read = listing ?? await this.listing(person);
    const found = (await this.candidates(person, botId, read)).filter((row) => !row.returning);
    if (!found.length) return null;
    const language = this.deps.language(person);
    this.deps.choices.noteQuestion(person, botId);
    return firstQuestionText(found.map((row) => domainLabelIn(row.domain, language)), language, preface);
  }

  /** The person writes to one of their bots, one to one: the person's main
   * bot writes its one sentence first after the upgrade (decision 4); else
   * this bot asks, the first time. Where to post it, or null. */
  async onOwnerTurn(person: string, botId: string): Promise<{ botId: string; text: string } | null> {
    const bots = this.deps.bots(person);
    if (!bots.some((bot) => bot.id === botId)) return null;
    const choices = this.deps.choices.get(person);
    const main = bots.find((bot) => bot.main);
    const listing = await this.listing(person);
    const existed = (bot: AskBot | undefined) => bot?.bornAt !== undefined && bot.bornAt < this.deps.choices.since;
    const mainSays = main && choices.firstAskedAt === undefined && existed(main) && choices.asked?.[main.id] === undefined;
    if (!listing.proposer.size) {
      // #3513: nothing can be offered: the main bot still says once that it
      // sends nothing on its own, and why nothing can be proposed yet; a
      // listing that could not be read now waits for a later turn
      if (!mainSays || !listing.nothing || listing.nothing.transient) return null;
      this.deps.choices.noteFirstSaid(person);
      return { botId: main.id, text: nothingYetText(listing.nothing, this.deps.language(person)) };
    }
    if (mainSays) {
      const text = await this.question(person, main.id, true, listing);
      if (text) return { botId: main.id, text };
    }
    const text = await this.question(person, botId, false, listing);
    return text ? { botId, text } : null;
  }

  /** #3456: the card « Garder le brief du jour ? » of a main bot that had
   * the brief only by default. Once ever per person; inside the bounds (one
   * open card, one bot-initiated ask a day): "later" when they hold it
   * back, "closed" when it was already posted. No push. */
  offerBrief(input: { person: string; botId: string; threadId: string; at: string }): "posted" | "later" | "closed" {
    const choices = this.deps.choices.get(input.person);
    if ((choices.asks ?? []).some((ask) => ask.domain === BRIEF_ASK_DOMAIN)) return "closed";
    const now = this.now();
    if (openCard(choices, now) || askedToday(choices, now, this.deps.timeZone(input.person))) return "later";
    const card = briefCard(input.at, this.deps.language(input.person));
    const proposalId = this.deps.postCard({ botId: input.botId, threadId: input.threadId, card, choice: { person: input.person, domain: BRIEF_ASK_DOMAIN, watches: [], others: [] } });
    this.deps.choices.noteAsk(input.person, { domain: BRIEF_ASK_DOMAIN, botId: input.botId, at: now, proposalId }, { firstQuestion: false });
    return "posted";
  }

  /** #3512, once: the open brief card posted again in the bot's main
   * conversation (`threadId`), in the person's language, when it sits in
   * another conversation or speaks another language. The caller closes the
   * old card; the ask keeps its place in the ledger under the new card.
   * Null when nothing moves. */
  repostBrief(input: { person: string; botId: string; threadId: string; at: string; proposalId: string; postedIn: string; postedTitle: string }): string | null {
    const ask = (this.deps.choices.get(input.person).asks ?? []).find((entry) => entry.proposalId === input.proposalId && entry.domain === BRIEF_ASK_DOMAIN);
    if (!ask || ask.answer || ask.movedAt !== undefined || !this.deps.choices.moveAsk) return null;
    const card = briefCard(input.at, this.deps.language(input.person));
    if (input.postedIn === input.threadId && input.postedTitle === card.title) return null;
    const proposalId = this.deps.postCard({ botId: input.botId, threadId: input.threadId, card, choice: { person: input.person, domain: BRIEF_ASK_DOMAIN, watches: [], others: [] } });
    this.deps.choices.moveAsk(input.person, input.proposalId, proposalId);
    return proposalId;
  }

  /** The card's answer: a yes writes the choice with the bot that proposed
   * it (the watches the person kept on, off the others); "Not now" is kept
   * in the ledger. `watchesOn` is the card's switches, when it sent them.
   * The brief card's yes creates the brief routine instead (#3456). */
  answer(proposal: { id: string; botId: string; choice: ProposalChoice }, accept: boolean, watchesOn?: readonly string[]): void {
    const { person, domain, watches, others } = proposal.choice;
    if (domain === BRIEF_ASK_DOMAIN) {
      if (accept) this.deps.briefYes?.(person, proposal.botId);
      this.deps.choices.answerAsk(person, proposal.id, accept ? "yes" : "not-now");
      return;
    }
    if (accept) {
      const all = [...watches, ...others];
      const on = watchesOn ? all.filter((id) => watchesOn.includes(id)) : watches;
      this.deps.choices.apply(person, { domain, state: "on", botId: proposal.botId, via: "card" }, person);
      for (const id of all) this.deps.choices.apply(person, { domain, watch: id, on: on.includes(id), via: "card" }, person);
    }
    this.deps.choices.answerAsk(person, proposal.id, accept ? "yes" : "not-now");
  }

  /** "Ne plus proposer": final for bots; the person can still turn it on. */
  never(proposal: { id: string; choice: ProposalChoice }): void {
    const { person, domain } = proposal.choice;
    // the brief card's "never" lives in the ledger: it is no watch domain
    if (domain !== BRIEF_ASK_DOMAIN) this.deps.choices.apply(person, { domain, state: "never", via: "card" }, person);
    this.deps.choices.answerAsk(person, proposal.id, "never");
  }
}

// ── reads covered by the yes (decision 3) ────────────────────────────────

/** Whether a call inside a watch wake is a read the person's yes covers:
 * the tool is one of the read-only tools the wake's watch declares, and
 * the person's choice of that domain is still on, on this bot, with that
 * watch on. Every other call (a write among them) keeps its card; the
 * organization's Refuse and Ask first rules are read before this. */
export function watchReadCovered(input: {
  tool: string;
  botId: string;
  watches: ReadonlyArray<{ id: string; domain: string; reads?: readonly string[] }> | undefined;
  choices: PersonChoices | null;
}): boolean {
  if (!input.watches?.length || !input.choices) return false;
  const bare = bareTool(input.tool);
  if (!bare) return false;
  return input.watches.some((watch) => {
    const choice = input.choices!.domains[watch.domain];
    return Boolean(choice && choice.state === "on" && choice.coversReads === true && choice.botId === input.botId
      && !choice.watchesOff?.[watch.id] && watch.reads?.some((tool) => bareTool(tool) === bare));
  });
}

/** `mcp__server__tool`, `server__tool` or `tool`: the tool itself. */
function bareTool(name: string): string {
  const raw = name.trim().replace(/^mcp__/, "");
  return (raw.includes("__") ? raw.slice(raw.lastIndexOf("__") + 2) : raw).toLowerCase();
}
