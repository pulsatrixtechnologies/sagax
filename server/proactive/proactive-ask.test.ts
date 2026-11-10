// #3431 (lot 4 of #3408): the bot asks, proposes one domain with a choice
// card, and the server keeps every bound whatever the model does.
import { describe, expect, it } from "vitest";

import { autoVerdict } from "../approvals/auto-approve.ts";
import { availableTools, catalogProfileFromEnv } from "../drivers/agents-catalog.ts";
import { createProactiveAskInternalRoutes } from "../routes/proactive-ask.ts";
import type { OfferedDomain, OfferedListing } from "./flow-watches.ts";
import {
  ASK_LISTING_FRESH_MS, askTurnRefusal, BRIEF_ASK_DOMAIN, cadenceWords, choiceCard, firstQuestionText, PROACTIVE_ASK_WAIT_MS, ProactiveAsk, proposerFor, SECOND_CARD_AFTER_MS,
  watchReadCovered, withinWait, type AskBot, type AskTurnFacts, type ChoiceCard,
} from "./proactive-ask.ts";
import { briefCard } from "./brief-routine.ts";
import { ProactiveChoices } from "./proactive-choices.ts";
import { PROPOSAL_TTL_MS, type ProposalChoice } from "./proactive-wake.ts";

const DAY = 24 * 60 * 60_000;
const START = Date.UTC(2026, 10, 10, 15, 0);
const PERSON = "person-1";

function domain(slug: string, audience: string, label = slug, fr?: { label: string; audience: string }): OfferedDomain {
  return {
    domain: slug,
    label: { en: label, fr: fr?.label ?? label },
    audience: { en: audience, ...(fr ? { fr: fr.audience } : {}) },
    eligible: true,
    watches: [
      { id: `${slug}-open`, summary: `Open ${label} items waiting`, cadence: "15m", products: ["p"], runs: true, tools: [`${slug}_query`] },
      { id: `${slug}-late`, summary: `Late ${label} items`, cadence: "daily@08:00", products: ["p"], runs: true, tools: [`${slug}_query`] },
    ],
  };
}

const DISPATCH = domain("dispatch", "dispatchers who assign service tickets to technicians", "Dispatch", { label: "Répartition", audience: "ceux qui font la répartition des billets aux techniciens" });
const SECURITY = domain("security", "people who watch endpoint security alerts", "Security", { label: "Sécurité", audience: "ceux qui suivent les alertes de sécurité des postes" });

interface Harness {
  ask: ProactiveAsk;
  choices: ProactiveChoices;
  posted: Array<{ botId: string; threadId: string; card: ChoiceCard; choice: ProposalChoice; id: string }>;
  clock: { now: number };
  bots: AskBot[];
  /** #3456: the bots whose brief routine a yes created. */
  briefYes: string[];
}

function harness(input: { bots?: AskBot[]; offered?: Record<string, OfferedDomain[]>; aboutMe?: string; since?: number; people?: number } = {}): Harness {
  // the store's `since` (the upgrade) is the clock when it is made
  const clock = { now: input.since ?? START - DAY };
  const store = new ProactiveChoices(undefined, () => clock.now);
  clock.now = START;
  const bots = input.bots ?? [{ id: "main", title: "Assistant", description: "", main: true, bornAt: START - 30 * DAY }];
  const offered = input.offered ?? { main: [DISPATCH, SECURITY] };
  const posted: Harness["posted"] = [];
  const briefYes: string[] = [];
  const ask = new ProactiveAsk({
    choices: store,
    bots: () => bots,
    offered: async (_person, botId): Promise<OfferedListing> => ({ ok: true, botId, domains: offered[botId] ?? [] }),
    aboutMe: () => input.aboutMe ?? "",
    people: () => input.people ?? 1,
    timeZone: () => "America/Toronto",
    language: () => "fr",
    postCard: (row) => {
      const id = `p${posted.length + 1}`;
      posted.push({ ...row, id });
      return id;
    },
    briefYes: (_person, botId) => { briefYes.push(botId); },
    now: () => clock.now,
  });
  return { ask, choices: store, posted, clock, bots, briefYes };
}

const propose = (h: Harness, over: Partial<Parameters<ProactiveAsk["propose"]>[0]> = {}) =>
  h.ask.propose({ person: PERSON, botId: "main", threadId: "t-main", message: "je fais la répartition des billets", domain: "dispatch", ...over });

describe("the turn that may propose (bound 1)", () => {
  const owner: AskTurnFacts = { ownsThread: true, inRoom: false, depth: 0, ownerOwnWords: true, onCall: false };

  it("only the owner's own one-to-one turn may post a card", () => {
    expect(askTurnRefusal(owner)).toBeNull();
  });

  it("a wake, a routine, a room, a call, another bot's hop or another person's turn cannot", () => {
    // a wake or a routine runs as a routine lineage: not the owner's own words
    expect(askTurnRefusal({ ...owner, ownerOwnWords: false })).toMatch(/not a wake, a routine/);
    expect(askTurnRefusal({ ...owner, inRoom: true })).toMatch(/never in a room/);
    expect(askTurnRefusal({ ...owner, onCall: true })).toMatch(/call/);
    expect(askTurnRefusal({ ...owner, depth: 1 })).toMatch(/own message/);
    expect(askTurnRefusal({ ...owner, tainted: true })).toMatch(/own message/);
    expect(askTurnRefusal({ ...owner, ownsThread: false })).toMatch(/not yours/);
  });

  it("the route answers a refused turn in one line and never reaches the card", async () => {
    let proposed = 0;
    let learned = 0;
    const route = createProactiveAskInternalRoutes({
      turn: () => ({ refused: askTurnRefusal({ ...owner, ownerOwnWords: false })! }),
      ask: () => ({ propose: async () => { proposed += 1; return { posted: true, text: "" }; } }),
      learn: () => { learned += 1; return 1; },
    });
    let answer: { status: number; body: Record<string, unknown> } | undefined;
    await route({
      res: {} as never, path: "/api/internal/proactive/propose", method: "POST",
      json: ((_res: unknown, status: number, body: Record<string, unknown>) => { answer = { status, body }; }) as never,
      capability: { botId: "main", threadId: "t-main", generation: "g" },
      readBody: async () => ({ domain: "dispatch", about_person: ["Fait la répartition"] }),
    } as never);
    expect(answer).toEqual({ status: 200, body: { applied: false, text: expect.stringMatching(/not a wake, a routine/) } });
    expect(proposed).toBe(0);
    expect(learned).toBe(0);
  });
});

describe("propose_proactive and its bounds", () => {
  it("posts one card for an eligible domain, with the watches the bot understood", async () => {
    const h = harness();
    const out = await propose(h, { watches: ["dispatch-open"] });
    expect(out.posted).toBe(true);
    expect(h.posted).toHaveLength(1);
    expect(h.posted[0]!.choice).toEqual({ person: PERSON, domain: "dispatch", watches: ["dispatch-open"], others: ["dispatch-late"] });
    expect(h.posted[0]!.card.title).toBe("Recevoir les alertes de répartition ?");
    expect(h.posted[0]!.card.options).toEqual(["Oui", "Pas maintenant"]);
    expect(h.posted[0]!.card.subtitle).toContain("toutes les 15 minutes");
    expect(h.posted[0]!.card.subtitle).toContain("Sur Assistant");
    expect(h.posted[0]!.card.details!.watches.map((watch) => [watch.id, watch.on])).toEqual([["dispatch-open", true], ["dispatch-late", false]]);
    expect(h.choices.get(PERSON).asks).toEqual([{ domain: "dispatch", botId: "main", at: START, proposalId: "p1" }]);
  });

  it("a domain that is unknown or cannot run on the bot: one line, nothing shown", async () => {
    const h = harness({ offered: { main: [{ ...DISPATCH, eligible: false }] } });
    expect((await propose(h)).posted).toBe(false);
    expect((await propose(h, { domain: "nope" })).text).toMatch(/not a domain you can carry/);
    expect(h.posted).toHaveLength(0);
  });

  it("already on: refused", async () => {
    const h = harness();
    h.choices.apply(PERSON, { domain: "dispatch", state: "on", botId: "main", via: "settings" }, PERSON);
    expect((await propose(h)).text).toMatch(/already receives it/);
    expect(h.posted).toHaveLength(0);
  });

  it("one open card per person, all bots together (bound 2)", async () => {
    const h = harness();
    await propose(h);
    h.clock.now += DAY;
    const second = await propose(h, { domain: "security" });
    expect(second.posted).toBe(false);
    expect(second.text).toMatch(/already waiting/);
    expect(h.posted).toHaveLength(1);
  });

  it("one bot-initiated ask per person per local day (bound 3), a first question included", async () => {
    const h = harness();
    expect(await h.ask.question(PERSON, "main", false)).toBeTruthy();
    const out = await propose(h);
    expect(out.text).toMatch(/already asked something today/);
    expect(h.posted).toHaveLength(0);
    h.clock.now += DAY;
    expect((await propose(h)).posted).toBe(true);
  });

  it("two cards per domain at most: the second after Not now, 14 days later, on the person's own words about it (bound 4)", async () => {
    const h = harness();
    await propose(h);
    h.ask.answer({ id: "p1", botId: "main", choice: h.posted[0]!.choice }, false);
    h.clock.now += 3 * DAY;
    expect((await propose(h)).text).toMatch(/less than 14 days/);
    h.clock.now = START + SECOND_CARD_AFTER_MS + DAY;
    expect((await propose(h)).text).toMatch(/pass their words as quote/);
    expect((await propose(h, { quote: "des alertes de sécurité" })).text).toMatch(/not in the person's own message/);
    expect((await propose(h, { message: "il fait beau", quote: "il fait beau" })).text).toMatch(/not about this domain/);
    const again = await propose(h, { message: "finalement la répartition des billets m'intéresse", quote: "la répartition des billets" });
    expect(again.posted).toBe(true);
    h.ask.answer({ id: "p2", botId: "main", choice: h.posted[1]!.choice }, false);
    h.clock.now += SECOND_CARD_AFTER_MS + DAY;
    expect((await propose(h, { message: "la répartition des billets", quote: "la répartition des billets" })).text).toMatch(/proposed twice/);
    expect(h.posted).toHaveLength(2);
  });

  it("an unanswered card ends after three days and counts as Not now (bound 6)", async () => {
    const h = harness();
    await propose(h);
    h.clock.now += PROPOSAL_TTL_MS + 1;
    // no longer open: another domain may be proposed
    expect((await propose(h, { domain: "security" })).posted).toBe(true);
    // and the first domain waits 14 days from the day its card ended
    h.clock.now = START + PROPOSAL_TTL_MS + SECOND_CARD_AFTER_MS - DAY;
    expect((await propose(h, { quote: "la répartition des billets" })).text).toMatch(/less than 14 days|already waiting/);
  });

  it("Ne plus proposer is final for bots (bound 5); the person can still turn it on", async () => {
    const h = harness();
    await propose(h);
    h.ask.never({ id: "p1", choice: h.posted[0]!.choice });
    expect(h.choices.get(PERSON).domains.dispatch?.state).toBe("never");
    expect(h.choices.get(PERSON).asks?.[0]?.answer).toBe("never");
    h.clock.now += 60 * DAY;
    expect((await propose(h, { quote: "la répartition des billets" })).text).toMatch(/said never/);
    expect(h.posted).toHaveLength(1);
    h.choices.apply(PERSON, { domain: "dispatch", state: "on", botId: "main", via: "settings" }, PERSON);
    expect(h.choices.get(PERSON).domains.dispatch?.state).toBe("on");
  });

  it("a yes writes the choice with the bot that proposed it, the other watches off", async () => {
    const h = harness();
    await propose(h, { watches: ["dispatch-open"] });
    h.ask.answer({ id: "p1", botId: "main", choice: h.posted[0]!.choice }, true);
    const row = h.choices.get(PERSON).domains.dispatch!;
    expect(row).toMatchObject({ state: "on", botId: "main", via: "card", coversReads: true });
    expect(Object.keys(row.watchesOff ?? {})).toEqual(["dispatch-late"]);
    expect(h.choices.get(PERSON).asks?.[0]?.answer).toBe("yes");
    expect(h.choices.chosen()).toEqual([{ person: PERSON, domains: [{ domain: "dispatch", botId: "main", watchesOff: ["dispatch-late"] }] }]);
  });

  it("the card's switches decide which watches the yes turns on", async () => {
    const h = harness();
    await propose(h, { watches: ["dispatch-open"] });
    h.ask.answer({ id: "p1", botId: "main", choice: h.posted[0]!.choice }, true, ["dispatch-late"]);
    expect(Object.keys(h.choices.get(PERSON).domains.dispatch!.watchesOff ?? {})).toEqual(["dispatch-open"]);
  });
});

describe("one proposer per person and domain (bound 9)", () => {
  const bots: AskBot[] = [
    { id: "main", title: "Assistant", description: "Helps with everything", main: true },
    { id: "disp", title: "Dispatch helper", description: "Assigns service tickets to technicians", main: false },
    { id: "sec", title: "Security watcher", description: "Endpoint alerts", main: false },
  ];

  it("the bot whose title and description match the domain best; the main bot on a tie or no match", () => {
    const eligible = bots.map((bot) => ({ ...bot, eligible: true }));
    expect(proposerFor("dispatchers who assign service tickets to technicians", eligible)).toBe("disp");
    expect(proposerFor("people who watch endpoint security alerts", eligible)).toBe("sec");
    expect(proposerFor("accounting and invoices", eligible)).toBe("main");
    expect(proposerFor("dispatch and security", eligible)).toBe("main");
    // a bot that cannot carry the domain never proposes it
    expect(proposerFor("dispatchers who assign service tickets", eligible.map((bot) => ({ ...bot, eligible: bot.id !== "disp" })))).toBe("main");
  });

  it("two eligible bots of one person: only the best match may propose the domain", async () => {
    const h = harness({ bots, offered: { main: [DISPATCH, SECURITY], disp: [DISPATCH], sec: [SECURITY] } });
    const fromMain = await propose(h);
    expect(fromMain.posted).toBe(false);
    expect(fromMain.text).toMatch(/Another of the person's bots/);
    expect(h.posted).toHaveLength(0);
    expect((await propose(h, { botId: "disp", threadId: "t-disp" })).posted).toBe(true);
    expect(h.posted[0]!.botId).toBe("disp");
    // the others stay silent on that domain: their section does not carry it
    expect((await h.ask.candidates(PERSON, "main")).map((row) => row.domain.domain)).toEqual([]);
    expect((await h.ask.candidates(PERSON, "sec")).map((row) => row.domain.domain)).toEqual(["security"]);
  });
});

describe("the prompt section and the first question", () => {
  it("ranks at most three undecided domains by About me, then the bot's title", async () => {
    const many = ["alpha", "bravo", "charlie", "delta"].map((slug) => domain(slug, `people who follow ${slug} work`));
    const h = harness({ offered: { main: many }, aboutMe: "Je m'occupe de delta et de charlie." });
    expect((await h.ask.candidates(PERSON, "main")).map((row) => row.domain.domain)).toEqual(["charlie", "delta", "alpha"]);
    const section = await h.ask.turnSection(PERSON, "main");
    expect(section).toContain("propose_proactive");
    expect(section).toContain("one simple question at a time, never a list");
    expect(section).not.toContain("bravo");
  });

  it("propose_proactive is listed only in a turn that carries the section (SAGAX_PROACTIVE_ASK)", () => {
    const base = { SAGAX_BOT_ID: "b", SAGAX_CHIEF_OF_STAFF: "1", SAGAX_PERSPICAX_TOOLS: "1" };
    const listed = (env: Record<string, string>) => availableTools(catalogProfileFromEnv(env)).some((tool) => tool.name === "propose_proactive");
    expect(listed(base)).toBe(false);
    expect(listed({ ...base, SAGAX_PROACTIVE_ASK: "1" })).toBe(true);
    expect(listed({ ...base, SAGAX_PROACTIVE_ASK: "1", SAGAX_EXTERNAL_RUNTIME: "1" })).toBe(false);
  });

  it("empty when nothing is eligible or everything is decided, so the tool is not mounted either", async () => {
    expect(await harness({ offered: { main: [] } }).ask.turnSection(PERSON, "main")).toBe("");
    const h = harness();
    expect(await h.ask.turnSection(PERSON, "main")).not.toBe("");
    h.choices.apply(PERSON, { domain: "dispatch", state: "never", via: "settings" }, PERSON);
    h.choices.apply(PERSON, { domain: "security", state: "on", botId: "main", via: "settings" }, PERSON);
    expect(await h.ask.turnSection(PERSON, "main")).toBe("");
  });

  it("the main bot of an existing person writes its sentence once, first saying nothing is sent on its own any more", async () => {
    const h = harness();
    const first = await h.ask.onOwnerTurn(PERSON, "main");
    expect(first).toEqual({ botId: "main", text: expect.stringMatching(/^Du nouveau : je ne t'envoie plus rien de moi-même tant que tu ne l'as pas choisi\. Je peux te prévenir de moi-même pour répartition et sécurité\./) });
    h.clock.now += DAY;
    expect(await h.ask.onOwnerTurn(PERSON, "main")).toBeNull();
  });

  it("every other bot asks the first time the person writes to it, at most one ask a day; a bot with nothing to offer asks nothing", async () => {
    const bots: AskBot[] = [
      { id: "main", title: "Assistant", description: "", main: true, bornAt: START - 30 * DAY },
      { id: "disp", title: "Dispatch helper", description: "assigns service tickets to technicians", main: false, bornAt: START - 30 * DAY },
      { id: "notes", title: "Notes", description: "", main: false, bornAt: START - 30 * DAY },
    ];
    const h = harness({ bots, offered: { main: [SECURITY], disp: [DISPATCH], notes: [] } });
    // the main bot writes first, in its own chat, whichever bot the person wrote to
    expect((await h.ask.onOwnerTurn(PERSON, "disp"))?.botId).toBe("main");
    expect(await h.ask.onOwnerTurn(PERSON, "disp")).toBeNull();
    h.clock.now += DAY;
    const second = await h.ask.onOwnerTurn(PERSON, "disp");
    expect(second?.botId).toBe("disp");
    expect(second?.text).not.toContain("Du nouveau");
    expect(second?.text).toContain("répartition");
    h.clock.now += DAY;
    expect(await h.ask.onOwnerTurn(PERSON, "notes")).toBeNull();
  });

  it("a new bot adds the question to its intro, without the upgrade sentence", async () => {
    const h = harness({ since: START - 60 * DAY });
    const text = await h.ask.question(PERSON, "main", false);
    expect(text).toBe("Je peux te prévenir de moi-même pour répartition et sécurité. Dis-moi ce que tu fais, tes responsabilités et celles de ton équipe, et ce que tu aimerais recevoir.");
    expect(h.choices.get(PERSON).asked?.main).toBe(START);
    expect(await h.ask.question(PERSON, "main", false)).toBeNull();
  });

  it("words the person reads", () => {
    expect(firstQuestionText(["Sécurité"], "en", false)).toBe("I can let you know on my own about Sécurité. Tell me what you do, your responsibilities and your team's, and what you would like to receive.");
    expect(cadenceWords("1h", "fr")).toBe("toutes les heures");
    expect(cadenceWords("weekly:mon@08:30", "fr")).toBe("chaque lundi à 8 h 30");
    expect(cadenceWords("daily@08:00", "en")).toBe("daily at 08:00");
    expect(choiceCard({ domain: SECURITY, chosen: ["security-open"], botName: "Bob", language: "en" }).title).toBe("Receive Security alerts?");
    const all = `${firstQuestionText(["a", "b"], "fr", true)} ${choiceCard({ domain: DISPATCH, chosen: ["dispatch-open"], botName: "Bob", language: "fr" }).subtitle}`;
    expect(all).not.toMatch(/[–—]/);
  });
});

describe("reads covered by the yes (decision 3)", () => {
  const watches = [{ id: "dispatch-open", domain: "dispatch", reads: ["dispatch_query"] }];
  const on = () => {
    const choices = new ProactiveChoices();
    choices.apply(PERSON, { domain: "dispatch", state: "on", botId: "main", via: "card" }, PERSON);
    return choices.get(PERSON);
  };

  it("inside a chosen domain's wake, a read the domain declares runs without a card", () => {
    const covered = watchReadCovered({ tool: "mcp__perspicax__dispatch_query", botId: "main", watches, choices: on() });
    expect(covered).toBe(true);
    expect(autoVerdict("ask", "mcp__perspicax__dispatch_query", { watchRead: covered })).toEqual({ approve: expect.stringContaining("dispatch_query"), source: "watch-read" });
  });

  it("a write still asks", () => {
    const covered = watchReadCovered({ tool: "mcp__perspicax__dispatch_write", botId: "main", watches, choices: on() });
    expect(covered).toBe(false);
    expect(autoVerdict("ask", "mcp__perspicax__dispatch_write", { watchRead: covered }).approve).toBeNull();
    // and a send is never answered as a read, whatever the flag says
    expect(autoVerdict("ask", "send_mail", { watchRead: true, outbound: true }).approve).toBeNull();
  });

  it("an organization Deny still refuses, an Ask first still asks", () => {
    expect(autoVerdict("ask", "mcp__perspicax__dispatch_query", { watchRead: true, customRule: { behavior: "deny", id: "orule_1" } })).toEqual({ approve: null, source: "custom-rule-deny" });
    expect(autoVerdict("ask", "mcp__perspicax__dispatch_query", { watchRead: true, customRule: { behavior: "ask", id: "orule_2" } })).toEqual({ approve: null, source: "custom-rule-ask" });
  });

  it("outside a chosen domain, on another bot, or with that watch off: no pass", () => {
    expect(watchReadCovered({ tool: "dispatch_query", botId: "main", watches: undefined, choices: on() })).toBe(false);
    expect(watchReadCovered({ tool: "dispatch_query", botId: "other", watches, choices: on() })).toBe(false);
    const off = new ProactiveChoices();
    off.apply(PERSON, { domain: "dispatch", state: "on", botId: "main", via: "card" }, PERSON);
    off.stopWatch(PERSON, "dispatch", "dispatch-open");
    expect(watchReadCovered({ tool: "dispatch_query", botId: "main", watches, choices: off.get(PERSON) })).toBe(false);
    expect(watchReadCovered({ tool: "dispatch_query", botId: "main", watches, choices: null })).toBe(false);
  });
});

// #3458 (lot 9 of #3408): a domain nobody in the organization follows comes
// first among those that match the person, and its card says so.
describe("a domain nobody follows comes first", () => {
  const BILLING = domain("billing", "people who bill service tickets", "Billing", { label: "Facturation", audience: "ceux qui facturent les billets des techniciens" });
  const ABOUT = "Je fais la répartition des billets aux techniciens.";
  const NOBODY = "Personne ne suit encore ce domaine dans ton organisation.";
  const followedBy = (h: Harness, other: string, slug: string) => h.choices.apply(other, { domain: slug, state: "on", botId: `${other}-bot`, via: "settings" }, other);

  it("two domains match the person, one is followed in the organization: the other is offered first and its card says so", async () => {
    const h = harness({ offered: { main: [DISPATCH, BILLING] }, aboutMe: ABOUT, people: 3 });
    followedBy(h, "person-2", "dispatch");
    const found = await h.ask.candidates(PERSON, "main");
    expect(found.map((row) => row.domain.domain)).toEqual(["billing", "dispatch"]);
    expect(found.map((row) => row.unfollowed)).toEqual([true, false]);
    const section = await h.ask.turnSection(PERSON, "main");
    expect(section.indexOf("domain \"billing\"")).toBeLessThan(section.indexOf("domain \"dispatch\""));
    expect(section).toMatch(/domain "billing".*Nobody in the organization follows it yet/);
    expect(section).not.toMatch(/domain "dispatch".*Nobody in the organization/);
    await propose(h, { domain: "billing" });
    expect(h.posted[0]!.card.subtitle).toContain(NOBODY);
    // a followed domain's card has no such line, and no one else's choice shows
    const other = harness({ offered: { main: [DISPATCH, BILLING] }, aboutMe: ABOUT, people: 3 });
    followedBy(other, "person-2", "dispatch");
    await propose(other, { domain: "dispatch" });
    expect(other.posted[0]!.card.subtitle).not.toContain(NOBODY);
    expect(JSON.stringify(other.posted[0]!.card)).not.toContain("person-2");
  });

  it("a domain nobody follows that does not match the person is not offered", async () => {
    const TIME = domain("time", "technicians who enter time on service tickets", "Time", { label: "Temps", audience: "les techniciens qui saisissent le temps des billets" });
    const h = harness({ offered: { main: [DISPATCH, BILLING, TIME, SECURITY] }, aboutMe: ABOUT, people: 3 });
    for (const slug of ["dispatch", "billing", "time"]) followedBy(h, "person-2", slug);
    const found = await h.ask.candidates(PERSON, "main");
    expect(found.map((row) => row.domain.domain)).not.toContain("security");
    expect(await h.ask.turnSection(PERSON, "main")).not.toContain("Nobody in the organization");
    // with room left, it still does not jump ahead of a matching one
    const two = harness({ offered: { main: [DISPATCH, SECURITY] }, aboutMe: ABOUT, people: 3 });
    followedBy(two, "person-2", "dispatch");
    expect((await two.ask.candidates(PERSON, "main")).map((row) => row.domain.domain)).toEqual(["dispatch", "security"]);
    expect(await two.ask.turnSection(PERSON, "main")).not.toMatch(/Nobody in the organization follows it yet: offer it first/);
  });

  it("a personal server (one person): no line, nothing changes", async () => {
    const h = harness({ offered: { main: [DISPATCH, BILLING] }, aboutMe: ABOUT, people: 1 });
    const found = await h.ask.candidates(PERSON, "main");
    expect(found.map((row) => row.domain.domain)).toEqual(["dispatch", "billing"]);
    expect(found.every((row) => !row.unfollowed)).toBe(true);
    expect(await h.ask.turnSection(PERSON, "main")).not.toContain("Nobody in the organization");
    await propose(h, { domain: "billing" });
    expect(h.posted[0]!.card.subtitle).not.toContain(NOBODY);
  });
});

describe("#3456: the card « Garder le brief du jour ? » goes through the same ledger and bounds", () => {
  const offer = (h: Harness) => h.ask.offerBrief({ person: PERSON, botId: "main", threadId: "t-main", at: "08:00" });

  it("posted once, with the brief's words and no watch details; no second card", () => {
    const h = harness();
    expect(offer(h)).toBe("posted");
    expect(h.posted).toHaveLength(1);
    expect(h.posted[0]!.card.title).toBe("Garder le brief du jour ?");
    // it claims no past sending and no past time: only that the default was on and stopped, and what the yes does
    expect(h.posted[0]!.card.subtitle).toBe("Le brief du jour était actif par défaut, sans que tu l'aies choisi : je l'ai arrêté. Si tu dis oui, je te l'envoie chaque jour à 8 h 00, comme une de mes routines, que tu peux mettre en pause, modifier ou supprimer.");
    expect(h.posted[0]!.card.subtitle).not.toMatch(/envoyais/);
    expect(briefCard("08:00", "en").subtitle).toBe("Today's brief was on by default, without you choosing it: I stopped it. If you say yes, I send it to you every day at 08:00, as one of my routines, which you can pause, edit or delete.");
    expect(h.posted[0]!.card.options).toEqual(["Oui", "Pas maintenant"]);
    expect(h.posted[0]!.card.details).toBeUndefined();
    expect(h.posted[0]!.choice).toEqual({ person: PERSON, domain: BRIEF_ASK_DOMAIN, watches: [], others: [] });
    expect(h.choices.get(PERSON).asks).toEqual([{ domain: BRIEF_ASK_DOMAIN, botId: "main", at: START, proposalId: "p1" }]);
    // answered not now, then days later: never a second card
    h.ask.answer({ id: "p1", botId: "main", choice: h.posted[0]!.choice }, false);
    h.clock.now = START + 30 * DAY;
    expect(offer(h)).toBe("closed");
    expect(h.posted).toHaveLength(1);
    expect(h.briefYes).toEqual([]);
  });

  it("a yes creates the brief routine and writes no watch domain", () => {
    const h = harness();
    offer(h);
    h.ask.answer({ id: "p1", botId: "main", choice: h.posted[0]!.choice }, true);
    expect(h.briefYes).toEqual(["main"]);
    const choices = h.choices.get(PERSON);
    expect(choices.domains).toEqual({});
    expect(choices.asks?.[0]).toMatchObject({ answer: "yes" });
    expect(h.choices.chosen()).toEqual([]);
  });

  it("\"never\" is kept in the ledger, no routine, no domain row, no card again", () => {
    const h = harness();
    offer(h);
    h.ask.never({ id: "p1", choice: h.posted[0]!.choice });
    expect(h.choices.get(PERSON).asks?.[0]).toMatchObject({ answer: "never" });
    expect(h.choices.get(PERSON).domains).toEqual({});
    expect(h.briefYes).toEqual([]);
    h.clock.now = START + 60 * DAY;
    expect(offer(h)).toBe("closed");
    expect(h.posted).toHaveLength(1);
  });

  it("is not the first question: a later-day owner turn on the main bot still writes the upgrade sentence first", async () => {
    const h = harness();
    expect(offer(h)).toBe("posted");
    expect(h.choices.get(PERSON).firstAskedAt).toBeUndefined();
    h.ask.answer({ id: "p1", botId: "main", choice: h.posted[0]!.choice }, false);
    h.clock.now = START + DAY;
    const first = await h.ask.onOwnerTurn(PERSON, "main");
    expect(first).toEqual({ botId: "main", text: expect.stringMatching(/^Du nouveau : je ne t'envoie plus rien de moi-même tant que tu ne l'as pas choisi\./) });
  });

  it("counts in the bounds: waits while another card is open or the person was asked today, and then holds them back", async () => {
    const h = harness();
    expect((await propose(h)).posted).toBe(true);
    expect(offer(h)).toBe("later");
    // the domain card answered, but the person was asked today: still later
    h.ask.answer({ id: "p1", botId: "main", choice: h.posted[0]!.choice }, false);
    expect(offer(h)).toBe("later");
    h.clock.now = START + DAY;
    expect(offer(h)).toBe("posted");
    expect(h.posted).toHaveLength(2);
    // the brief card is open and counts as today's ask: no domain card
    expect((await propose(h, { domain: "security" })).posted).toBe(false);
  });
});

describe("#3470: an owner turn never freezes the server on its listing", () => {
  const BOTS = 20;
  /** A person with many bots; `busyMs`: each bot's listing holds the
   * event loop that long (a slow skill inventory). */
  function many(busyMs = 0) {
    const clock = { now: START - DAY };
    const choices = new ProactiveChoices(undefined, () => clock.now);
    clock.now = START;
    const bots: AskBot[] = Array.from({ length: BOTS }, (_, index) => ({ id: `b${index}`, title: `Bot ${index}`, description: "", main: index === 0, bornAt: START - 30 * DAY }));
    const reads: string[] = [];
    const ask = new ProactiveAsk({
      choices,
      bots: () => bots,
      offered: async (_person, botId): Promise<OfferedListing> => {
        reads.push(botId);
        const until = Date.now() + busyMs;
        while (Date.now() < until) { /* a synchronous inventory */ }
        return { ok: true, botId, domains: botId === "b0" ? [DISPATCH, SECURITY] : [DISPATCH] };
      },
      aboutMe: () => "",
      timeZone: () => "America/Toronto",
      language: () => "fr",
      postCard: () => "p1",
      now: () => clock.now,
    });
    return { ask, reads, clock, choices, bots };
  }
  /** One owner turn as server/index.ts runs it: the first question, then the section. */
  const turn = async (ask: ProactiveAsk) => {
    const asked = await ask.onOwnerTurn(PERSON, "b0");
    return { asked, section: await ask.turnSection(PERSON, "b0") };
  };

  it("one listing per owner turn: the first question and the section share it", async () => {
    const h = many();
    const { asked, section } = await turn(h.ask);
    expect(asked?.botId).toBe("b0");
    expect(section).toContain("dispatch");
    expect(h.reads).toHaveLength(BOTS);
  });

  it("a listing just read is not rebuilt at the person's next turn, and is after a change of their choices or bots", async () => {
    const h = many();
    await turn(h.ask);
    h.clock.now += 60_000;
    await turn(h.ask);
    expect(h.reads).toHaveLength(BOTS);
    h.choices.apply(PERSON, { domain: "security", state: "never", via: "card" }, PERSON);
    await h.ask.turnSection(PERSON, "b0");
    expect(h.reads).toHaveLength(2 * BOTS);
    h.bots.pop();
    await h.ask.turnSection(PERSON, "b0");
    expect(h.reads).toHaveLength(3 * BOTS - 1);
    h.clock.now += ASK_LISTING_FRESH_MS;
    await h.ask.turnSection(PERSON, "b0");
    expect(h.reads).toHaveLength(4 * BOTS - 2);
  });

  it("a timer fires between two bots of a listing", async () => {
    const h = many(5);
    let firedAfter = -1;
    setTimeout(() => { firedAfter = h.reads.length; }, 0);
    await h.ask.listing(PERSON);
    expect(firedAfter).toBeGreaterThan(0);
    expect(firedAfter).toBeLessThan(BOTS);
  });

  it("the turn does not wait past its bound with a slow inventory", async () => {
    // 20 bots of 30 ms each: a listing of 600 ms against a bound of 100 ms
    const h = many(30);
    const started = Date.now();
    const section = await withinWait(turn(h.ask).then((row) => row.section), 100, "");
    const waited = Date.now() - started;
    expect(section).toBe("");
    expect(waited).toBeLessThan(100 + 3 * 30);
    expect(PROACTIVE_ASK_WAIT_MS).toBe(2_000);
  });
});
