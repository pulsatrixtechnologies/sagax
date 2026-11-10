// The person's proactive choices on disk (#3423, lot 2 of #3408):
// `proactive-choices.json` under the data folder, mode 0600, one row per
// person (shared/proactive-choices.ts has the shape and the rules).
//
// Nothing here is ever filled from a default or from a stored mode: a person
// without a row has chosen nothing, and nothing ambient runs for them.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import {
  ASKS_KEPT, chosenDomains, emptyChoices, parsePersonChoices,
  type AskEntry, type ChoiceChange, type ChoiceVia, type DomainChoice, type PersonChoices,
} from "../../shared/proactive-choices.ts";

export class ProactiveChoices {
  private people: Record<string, PersonChoices> = {};

  private readonly file: string | undefined;

  private readonly now: () => number;

  /** #3431: when this store first ran (the upgrade): a bot older than it
   * existed before the choice, so the main bot says nothing is sent on its
   * own any more. Kept in the file, set once. */
  readonly since: number;

  constructor(file?: string, now: () => number = () => Date.now()) {
    this.file = file;
    this.now = now;
    let since: number | undefined;
    try {
      const parsed = file ? JSON.parse(readFileSync(file, "utf8")) as { people?: unknown; since?: unknown } : null;
      if (parsed && typeof parsed.since === "number") since = parsed.since;
      if (parsed && typeof parsed.people === "object" && parsed.people !== null) {
        for (const [person, row] of Object.entries(parsed.people as Record<string, unknown>)) {
          const key = personKey(person);
          if (key) this.people[key] = parsePersonChoices(row);
        }
      }
    } catch {
      // no choice yet
    }
    this.since = since ?? now();
    if (file && since === undefined) this.save();
  }

  /** A person's choices (a copy); absent reads as nothing chosen. */
  get(person: string): PersonChoices {
    return structuredClone(this.people[personKey(person)] ?? emptyChoices());
  }

  /** Every person with at least one domain on, and those domains. */
  chosen(): Array<{ person: string; domains: Array<{ domain: string; botId: string; watchesOff: string[] }> }> {
    return Object.entries(this.people).flatMap(([person, row]) => {
      const domains = chosenDomains(row);
      return domains.length ? [{ person, domains }] : [];
    });
  }

  /** Apply one change made by `by` (the person, or the person through
   * their bot). `botId` is already checked as the person's own bot. */
  apply(person: string, change: ChoiceChange, by: string): PersonChoices {
    const key = personKey(person);
    if (!key) return emptyChoices();
    const row = this.people[key] ?? emptyChoices();
    const at = this.now();
    const previous = row.domains[change.domain];
    if ("watch" in change) {
      const watchesOff = { ...previous?.watchesOff };
      if (change.on) delete watchesOff[change.watch];
      else watchesOff[change.watch] = { at, via: change.via };
      const base: DomainChoice = previous ?? { state: "off", at, via: change.via, by };
      const { watchesOff: _old, ...rest } = base;
      row.domains[change.domain] = { ...rest, ...(Object.keys(watchesOff).length ? { watchesOff } : {}) };
    } else {
      const next: DomainChoice = {
        state: change.state,
        ...(change.state === "on" && change.botId ? { botId: change.botId } : {}),
        ...(previous?.watchesOff ? { watchesOff: previous.watchesOff } : {}),
        // decision 3: a yes covers the domain's read-only tools in its alerts
        ...(change.state === "on" ? { coversReads: true } : {}),
        at, via: change.via, by,
      };
      row.domains[change.domain] = next;
    }
    this.people[key] = row;
    this.save();
    return this.get(key);
  }

  /** An alert's "never" or "stop this watch": that watch stops for good. */
  stopWatch(person: string, domain: string, watchId: string, via: ChoiceVia = "alert"): void {
    this.apply(person, { domain, watch: watchId, on: false, via }, person);
  }

  /** One proposal and, later, its answer (the card, #3431). */
  noteAsk(person: string, entry: AskEntry): void {
    const key = personKey(person);
    if (!key) return;
    const row = this.people[key] ?? emptyChoices();
    row.asks = [...(row.asks ?? []), entry].slice(-ASKS_KEPT);
    row.firstAskedAt ??= entry.at;
    this.people[key] = row;
    this.save();
  }

  /** The answer of a card, once: false when no open entry has this id. */
  answerAsk(person: string, proposalId: string, answer: NonNullable<AskEntry["answer"]>): boolean {
    const row = this.people[personKey(person)];
    const entry = row?.asks?.find((ask) => ask.proposalId === proposalId);
    if (!entry || (entry.answer && !(answer === "never" && entry.answer !== "never"))) return false;
    entry.answer = answer;
    entry.answeredAt = this.now();
    this.save();
    return true;
  }

  /** #3431: a bot asked its first question of this person. */
  noteQuestion(person: string, botId: string): void {
    const key = personKey(person);
    if (!key) return;
    const row = this.people[key] ?? emptyChoices();
    const at = this.now();
    row.asked = { ...row.asked, [botId]: at };
    row.firstAskedAt ??= at;
    this.people[key] = row;
    this.save();
  }

  /** A deleted bot: each domain it carried moves to `fallback` (the
   * person's main bot) when given, else stays named and pauses. Returns the
   * domains that moved, per person. */
  botGone(botId: string, fallback: (person: string) => string | undefined): Array<{ person: string; botId: string; domains: string[] }> {
    const moved: Array<{ person: string; botId: string; domains: string[] }> = [];
    let changed = false;
    for (const [person, row] of Object.entries(this.people)) {
      const carried = Object.entries(row.domains).filter(([, choice]) => choice.state === "on" && choice.botId === botId);
      if (!carried.length) continue;
      const next = fallback(person);
      if (!next || next === botId) continue;
      for (const [domain, choice] of carried) row.domains[domain] = { ...choice, botId: next };
      moved.push({ person, botId: next, domains: carried.map(([domain]) => domain) });
      changed = true;
    }
    if (changed) this.save();
    return moved;
  }

  save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileAtomic(this.file, JSON.stringify({ version: 1, since: this.since, people: this.people }), { mode: 0o600 });
    } catch {
      // kept in memory
    }
  }
}

function personKey(person: string): string {
  return person.trim().toLowerCase();
}

export type WatchPauseCause = "bot-gone" | "bot-not-eligible" | "no-flow" | "flow-failed" | "no-access" | "no-watch" | "unknown-domain";

/** The one line a carrying bot posts in its chat when a chosen domain
 * pauses (it resumes by itself once the cause is gone). */
export function watchPauseLine(domain: string, cause: WatchPauseCause, language: "fr" | "en"): string {
  const fr: Record<WatchPauseCause, string> = {
    "bot-gone": "ce bot n'est plus là",
    "bot-not-eligible": "ce bot ne peut pas porter cette veille (il n'est plus à toi, il est caché ou temporaire)",
    "no-flow": "le plugin Pulsatrix Flow de l'organisation n'est pas là",
    "flow-failed": "le plugin Pulsatrix Flow de l'organisation ne répond pas",
    "no-access": "ta connexion Pulsatrix ne répond pas pour toi",
    "no-watch": "aucune veille de ce domaine ne peut rouler ici (un produit que ta connexion ne sert pas, ou un skill que ce bot n'a pas)",
    "unknown-domain": "l'organisation n'a aucune veille sous ce nom. Demande à un de tes bots les domaines que tu peux choisir",
  };
  const en: Record<WatchPauseCause, string> = {
    "bot-gone": "this bot is gone",
    "bot-not-eligible": "this bot cannot carry it (no longer yours, hidden or temporary)",
    "no-flow": "the organization's Pulsatrix Flow plugin is missing",
    "flow-failed": "the organization's Pulsatrix Flow plugin does not answer",
    "no-access": "your Pulsatrix connection does not answer for you",
    "no-watch": "no watch of this domain can run here (a product your connection does not serve, or a skill this bot lacks)",
    "unknown-domain": "the organization has no watch by that name. Ask any of your bots for the domains you can choose",
  };
  // an unknown name never comes back by itself: the line says what to do
  if (cause === "unknown-domain") {
    return language === "fr" ? `Veille ${domain} en pause : ${fr[cause]}.` : `Watch ${domain} paused: ${en[cause]}.`;
  }
  return language === "fr"
    ? `Veille ${domain} en pause : ${fr[cause]}. Elle reprend d'elle-même.`
    : `Watch ${domain} paused: ${en[cause]}. It resumes by itself.`;
}

/** The one line the person's main bot posts when it takes the watch
 * domains of a deleted bot. */
export function watchMovedLine(domains: readonly string[], language: "fr" | "en"): string {
  const list = domains.join(", ");
  return language === "fr"
    ? `Le bot qui portait ta veille ${list} n'est plus là : je la porte maintenant.`
    : `The bot that carried your ${list} watch is gone: I carry it now.`;
}
