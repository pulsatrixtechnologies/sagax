// Holds a bot's write until the signed-in person allows it, then performs
// that action as them. The pending body stays in memory. The card stores
// only the request id.

import { createHash } from "node:crypto";

import type { ActTarget, TurnFacts } from "../shared/bot-act.ts";
import { actorForTurn, decideBotAct, summaryOf } from "../shared/bot-act.ts";
import { botActClasses } from "../shared/step-up.ts";

/** 2026-10-19 (JC: "Toujours permettre" on every card): what "Always allow"
 * on an act card keeps, as the person's own rule for this bot
 * (server/owner-approval.ts OwnerRule): a setting (its key and target) or a
 * route (method and exact path), and the exact value when the change is
 * more than a simple one (a secret, another person, a deletion, a widening,
 * the organization). Never "anything this bot does". */
export type ActRuleCandidate = { tool: "sagax_settings" | "sagax_act"; scope: Record<string, string>; description: string };

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

/** A short fingerprint of an exact value (a rule keeps it, never the value). */
export function valueDigest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex").slice(0, 32);
}

/** A change to rules, permissions or standing grants: never an Always allow. */
function ruleChange(classes: readonly string[]): boolean {
  return classes.includes("rule-change") || classes.includes("always-grant");
}

/** The rule "Always allow" would keep for a raw act. A write that is more
 * than a plain one (any class but irreversible) is bound to its exact body. */
export function actRuleCandidate(target: ActTarget, classes: readonly string[], describe: (target: ActTarget) => string): ActRuleCandidate {
  const exact = classes.some((name) => name !== "irreversible");
  if (target.kind === "ui") {
    return { tool: "sagax_act", scope: { screen: target.command, ...(exact ? { value: valueDigest(target.input) } : {}) }, description: describe(target) };
  }
  return {
    tool: "sagax_act",
    scope: { route: `${target.method.toUpperCase()} ${target.path}`, ...(exact ? { value: valueDigest({ query: target.query ?? null, body: target.body ?? null }) } : {}) },
    description: describe(target),
  };
}

const PENDING_CAP = 32;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export type PerformActor =
  | { kind: "person"; sessionId: string; personKey: string; scopes: Array<"admin" | "client"> }
  | { kind: "operator" };

export type BotActAnswerer =
  | { kind: "session"; personKey: string; sessionId: string; scopes: readonly string[]; admin: boolean }
  | { kind: "operator" }
  | { kind: "service" };

export type BotActResult = { status: number; body: Record<string, unknown> };

type LiveSession = { id: string; scopes: Array<"admin" | "client"> };

type CardState = { messageId: string; answered?: string; dismissed?: boolean; expired?: boolean };

type Pending = {
  requestId: string;
  threadId: string;
  botId: string;
  rule?: ActRuleCandidate;
  messageId: string;
  actorKey: string;
  actor: PerformActor;
  audience: string;
  target: ActTarget;
  createdAt: number;
  running: boolean;
  /** A planned setting change (server/settings-actions.ts): its step-up
   * classes, and what to record once it ran. */
  planned?: PlannedAct;
};

/** A change the settings registry built and classed (sagax_settings): the
 * act engine runs or holds it as decided, never re-reading its body for
 * approval fields (the registry put them there on purpose). */
export type PlannedAct = {
  effect: "run" | "hold";
  summary: string;
  /** Security key classes the card's Allow must cover. */
  stepUpClasses: readonly string[];
  /** Called once the route answered below 400. */
  onDone?: (how: "run" | "allowed" | "rule") => void;
  /** What "Always allow" keeps for this change (settings-actions.ts). */
  /** No Always allow on this card (a change to rules or permissions). */
  noRule?: boolean;
  rule?: ActRuleCandidate;
  /** 2026-10-20: the person asked their own Primary Bot for this change in
   * this turn (sagax_settings with quote): the replay says so. */
  primary?: { botId: string; botName: string; messageId: string };
};

export type BotActDeps = {
  now: () => number;
  newId: () => string;
  neededScope: (method: string, path: string) => "admin" | "client";
  operatorAudience: () => string;
  sessionForPerson: (personKey: string) => LiveSession | null;
  /** `confirmed`: this replay follows that person's own Allow on a planned
   * change's card (the card's step-up covered `classes`). */
  performRoute: (actor: PerformActor, target: Extract<ActTarget, { kind: "route" }>, confirmed?: { personKey: string | null; classes: readonly string[]; primary?: { botId: string; botName: string; messageId: string } }, maxChars?: number) => Promise<{ status: number; text: string }>;
  broadcastUi: (audience: string, command: string, input: Record<string, unknown>) => void;
  postCard: (input: { threadId: string; botId: string; botName: string; botColor: string; requestId: string; summary: string; rule?: ActRuleCandidate }) => { messageId: string };
  /** 2026-10-19: the person's saved Always allow that answers this act now
   * (their own rule for this bot, no security key of theirs protecting the
   * change's classes), or null. */
  actRule?: (input: { person: string | null; botId: string; candidate: ActRuleCandidate; classes: readonly string[] }) => { id: string } | null;
  /** Save the person's Always allow from an act card. Null, or the refusal. */
  saveActRule?: (input: { person: string | null; botId: string; candidate: ActRuleCandidate }) => { status: number; error: string } | null;
  /** A route or screen command in plain words for a rule (names, never ids). */
  describeAct?: (target: ActTarget) => string;
  /** One journal row for an act a saved rule allowed. */
  journalRule?: (input: { threadId: string; botId: string; botName: string; summary: string; rule: string }) => void;
  patchCard: (threadId: string, messageId: string, patch: { answered?: "allow" | "deny"; expired?: true }) => void;
  findCard: (threadId: string, requestId: string) => CardState | null;
};

const NONE_REASON: Record<string, string> = {
  automation: "A routine or a webhook cannot act as a person.",
  guest: "A guest turn cannot act as a person.",
  unproven: "This turn is not tied to a signed-in person.",
  stale: "This turn's sender was not proven.",
  shared: "This server has no owner to act as.",
};

export type BotActService = {
  handle(input: {
    facts: TurnFacts;
    raw: unknown;
    threadId: string;
    botId: string;
    botName: string;
    botColor: string;
    mode: "ask" | "edits" | "auto" | "full" | "custom" | undefined;
  }): Promise<BotActResult>;
  confirm(input: {
    threadId: string;
    requestId: string;
    behavior: string;
    answerer: BotActAnswerer;
    sharedServer: boolean;
    /** "allow": also keep the card's Always allow as the answerer's rule. */
    rule?: "allow";
  }): Promise<{ handled: false } | { handled: true; status: number; body: Record<string, unknown> }>;
  /** What a waiting act card would do (its route and body), for the
   * security key step-up; undefined once it is gone. */
  target(requestId: string): ActTarget | undefined;
  /** The step-up classes a planned change's card adds. */
  plannedClasses(requestId: string): readonly string[];
  /** A setting change the registry built and classed. The actor and the
   * route's scope are checked here as for any act. */
  handlePlanned(input: {
    facts: TurnFacts;
    target: ActTarget;
    plan: PlannedAct;
    threadId: string;
    botId: string;
    botName: string;
    botColor: string;
    /** A read whose whole answer the caller picks a value from. */
    maxChars?: number;
  }): Promise<BotActResult>;
};

export function createBotActService(deps: BotActDeps): BotActService {
  const pending = new Map<string, Pending>();

  const sweep = () => {
    const now = deps.now();
    for (const [id, item] of pending) {
      if (item.createdAt + PENDING_TTL_MS > now) continue;
      pending.delete(id);
      deps.patchCard(item.threadId, item.messageId, { expired: true });
    }
  };

  const refuse = (status: number, error: string): BotActResult => ({ status, body: { error } });

  return {
    target(requestId) {
      return pending.get(requestId)?.target;
    },
    plannedClasses(requestId) {
      return pending.get(requestId)?.planned?.stepUpClasses ?? [];
    },
    async handlePlanned(input) {
      sweep();
      const actor = actorForTurn(input.facts);
      if (actor.kind === "none") return refuse(403, NONE_REASON[actor.reason] ?? "This turn cannot act.");
      let performActor: PerformActor;
      let scopes: string[];
      if (actor.kind === "person") {
        const session = deps.sessionForPerson(actor.personKey);
        if (!session) return refuse(403, "This person's session is no longer valid.");
        performActor = { kind: "person", sessionId: session.id, personKey: actor.personKey, scopes: session.scopes };
        scopes = session.scopes;
      } else {
        performActor = { kind: "operator" };
        scopes = ["admin", "client"];
      }
      if (input.target.kind === "route" && !scopes.includes(deps.neededScope(input.target.method, input.target.path))) {
        return refuse(403, "This person cannot change that setting: it needs rights they do not have.");
      }
      if (input.plan.effect === "run") {
        // the registry and its policy decided: the route reads it as the
        // person's planned change (no key was signed, so no class is covered)
        const planned = { personKey: performActor.kind === "person" ? performActor.personKey : null, classes: [] as string[], ...(input.plan.primary ? { primary: input.plan.primary } : {}) };
        const result = await run(performActor, input.target, undefined, planned, input.maxChars);
        if (result.status < 400) input.plan.onDone?.("run");
        return result;
      }
      // 2026-10-20 (security review): a change to rules or permissions never
      // has an Always allow, so a bot never replays an escalation unasked
      const plannedRule = ruleChange(input.plan.stepUpClasses) || input.plan.noRule ? undefined : input.plan.rule ?? actRuleCandidate(input.target, input.plan.stepUpClasses, describeOf);
      const allowedBy = plannedRule ? ruleFor(performActor, input.botId, plannedRule, input.plan.stepUpClasses) : null;
      if (allowedBy) {
        const planned = { personKey: performActor.kind === "person" ? performActor.personKey : null, classes: [] as string[] };
        const result = await run(performActor, input.target, undefined, planned, input.maxChars);
        if (result.status < 400) {
          input.plan.onDone?.("rule");
          deps.journalRule?.({ threadId: input.threadId, botId: input.botId, botName: input.botName, summary: input.plan.summary, rule: allowedBy.id });
        }
        return result;
      }
      const { rule: _offered, ...plan } = input.plan;
      return hold(performActor, input.target, input.plan.summary, input, plannedRule ? { ...plan, rule: plannedRule } : plan);
    },
    async handle(input) {
      sweep();
      const actor = actorForTurn(input.facts);
      if (actor.kind === "none") return refuse(403, NONE_REASON[actor.reason] ?? "This turn cannot act.");
      let performActor: PerformActor;
      let scopes: string[];
      if (actor.kind === "person") {
        const session = deps.sessionForPerson(actor.personKey);
        if (!session) return refuse(403, "This person's session is no longer valid.");
        performActor = { kind: "person", sessionId: session.id, personKey: actor.personKey, scopes: session.scopes };
        scopes = session.scopes;
      } else {
        performActor = { kind: "operator" };
        scopes = ["admin", "client"];
      }
      const decision = decideBotAct({ raw: input.raw, mode: input.mode, scopes, neededScope: deps.neededScope });
      if (!decision.ok) return refuse(decision.status, decision.error);
      if (decision.effect === "run") return run(performActor, decision.target);
      const classes = actClassesOf(decision.target);
      const candidate = ruleChange(classes) ? undefined : actRuleCandidate(decision.target, classes, describeOf);
      const allowedBy = candidate ? ruleFor(performActor, input.botId, candidate, classes) : null;
      if (allowedBy) {
        const result = await run(performActor, decision.target);
        if (result.status < 400) deps.journalRule?.({ threadId: input.threadId, botId: input.botId, botName: input.botName, summary: decision.summary, rule: allowedBy.id });
        return result;
      }
      return hold(performActor, decision.target, decision.summary, input, undefined, candidate);
    },

    async confirm(input) {
      sweep();
      const card = deps.findCard(input.threadId, input.requestId);
      if (!card) return { handled: false };
      if (card.answered || card.dismissed || card.expired) {
        pending.delete(input.requestId);
        return { handled: true, status: 409, body: { error: "This approval is already settled." } };
      }
      const item = pending.get(input.requestId);
      if (!item || item.threadId !== input.threadId) {
        if (card.messageId) deps.patchCard(input.threadId, card.messageId, { expired: true });
        return { handled: true, status: 409, body: { error: "This approval expired." } };
      }
      if (deps.now() >= item.createdAt + PENDING_TTL_MS) {
        pending.delete(item.requestId);
        deps.patchCard(item.threadId, item.messageId, { expired: true });
        return { handled: true, status: 409, body: { error: "This approval expired." } };
      }
      if (item.running) return { handled: true, status: 409, body: { error: "This approval is already running." } };
      if (input.behavior === "deny") {
        pending.delete(item.requestId);
        deps.patchCard(item.threadId, item.messageId, { answered: "deny" });
        return { handled: true, status: 200, body: { ok: true, outcome: "rejected" } };
      }
      if (input.behavior !== "allow") return { handled: true, status: 400, body: { error: "behavior must be allow or deny." } };
      const replay = replayActor(item, input.answerer, input.sharedServer, deps.neededScope);
      if ("error" in replay) return { handled: true, status: replay.status, body: { error: replay.error } };
      if (input.rule === "allow") {
        // kept before the change runs, as the person who answers, for this bot
        if (!item.rule || !deps.saveActRule) return { handled: true, status: 409, body: { error: "This approval cannot be remembered as a rule." } };
        const refused = deps.saveActRule({ person: replay.kind === "person" ? replay.personKey : null, botId: item.botId, candidate: item.rule });
        if (refused) return { handled: true, status: refused.status, body: { error: refused.error } };
      }
      item.running = true;
      try {
        const confirmed = item.planned
          ? { personKey: replay.kind === "person" ? replay.personKey : null, classes: item.planned.stepUpClasses }
          : undefined;
        const result = await run(replay, item.target, item.audience, confirmed);
        if (result.status >= 400) {
          item.running = false;
          const error = typeof result.body.error === "string" ? result.body.error : "The action was refused.";
          return { handled: true, status: result.status, body: { error } };
        }
        item.planned?.onDone?.("allowed");
        pending.delete(item.requestId);
        deps.patchCard(item.threadId, item.messageId, { answered: "allow" });
        return { handled: true, status: 200, body: { ok: true, outcome: "allowed-once" } };
      } catch {
        item.running = false;
        return { handled: true, status: 502, body: { error: "The action could not be completed." } };
      }
    },
  };

  function describeOf(target: ActTarget): string {
    return deps.describeAct ? deps.describeAct(target) : summaryOf(target);
  }

  function ruleFor(actor: PerformActor, botId: string, candidate: ActRuleCandidate, classes: readonly string[]): { id: string } | null {
    if (!deps.actRule || ruleChange(classes)) return null;
    return deps.actRule({ person: actor.kind === "person" ? actor.personKey : null, botId, candidate, classes });
  }

  function hold(
    performActor: PerformActor,
    target: ActTarget,
    summary: string,
    where: { threadId: string; botId: string; botName: string; botColor: string },
    planned?: PlannedAct,
    candidate?: ActRuleCandidate,
  ): BotActResult {
    const rule = planned?.rule ?? candidate;
    const actorKey = performActor.kind === "person" ? `person:${performActor.personKey}` : "operator";
    let waiting = 0;
    for (const item of pending.values()) if (item.actorKey === actorKey) waiting += 1;
    if (waiting >= PENDING_CAP) return refuse(429, "Too many actions are waiting for approval.");
    const requestId = deps.newId();
    const posted = deps.postCard({
      threadId: where.threadId,
      botId: where.botId,
      botName: where.botName,
      botColor: where.botColor,
      requestId,
      summary,
      ...(rule ? { rule } : {}),
    });
    pending.set(requestId, {
      requestId,
      threadId: where.threadId,
      botId: where.botId,
      ...(rule ? { rule } : {}),
      messageId: posted.messageId,
      actorKey,
      actor: performActor,
      audience: performActor.kind === "person" ? performActor.personKey : deps.operatorAudience(),
      target,
      createdAt: deps.now(),
      running: false,
      ...(planned ? { planned } : {}),
    });
    return {
      status: 200,
      body: { held: true, text: `Approval needed. ${summary} A card is waiting in the conversation. Do not retry this action.` },
    };
  }

  async function run(actor: PerformActor, target: ActTarget, audience?: string, confirmed?: { personKey: string | null; classes: readonly string[]; primary?: { botId: string; botName: string; messageId: string } }, maxChars = 8000): Promise<BotActResult> {
    if (target.kind === "ui") {
      deps.broadcastUi(audience ?? (actor.kind === "person" ? actor.personKey : deps.operatorAudience()), target.command, target.input);
      return { status: 200, body: { text: "Done.", status: 200 } };
    }
    try {
      const performed = await deps.performRoute(actor, target, confirmed, maxChars);
      const text = performed.text.trim() ? performed.text.slice(0, maxChars) : performed.status < 400 ? "Done." : "The action was refused.";
      if (performed.status >= 400) return { status: performed.status, body: { error: text, text, status: performed.status } };
      return { status: performed.status, body: { text, status: performed.status } };
    } catch {
      return { status: 502, body: { error: "The action could not be completed." } };
    }
  }
}

function replayActor(
  item: Pending,
  answerer: BotActAnswerer,
  sharedServer: boolean,
  neededScope: (method: string, path: string) => "admin" | "client",
): PerformActor | { error: string; status: 403 } {
  const routeScopeOk = (scopes: readonly string[]) => {
    if (item.target.kind !== "route") return true;
    return scopes.includes(neededScope(item.target.method, item.target.path));
  };
  if (item.actor.kind === "person") {
    if (answerer.kind !== "session" || answerer.personKey !== item.actor.personKey) {
      return { error: "Only that person can allow this.", status: 403 };
    }
    if (!routeScopeOk(answerer.scopes)) return { error: "This session cannot call that route.", status: 403 };
    return { kind: "person", sessionId: answerer.sessionId, personKey: answerer.personKey, scopes: answerer.scopes.filter((scope): scope is "admin" | "client" => scope === "admin" || scope === "client") };
  }
  if (sharedServer) return { error: "This server has no owner to act as.", status: 403 };
  if (answerer.kind === "service") return { error: "A service cannot allow this.", status: 403 };
  if (answerer.kind === "operator") return { kind: "operator" };
  if (answerer.kind === "session" && answerer.admin) {
    if (!routeScopeOk(answerer.scopes)) return { error: "This session cannot call that route.", status: 403 };
    return { kind: "person", sessionId: answerer.sessionId, personKey: answerer.personKey, scopes: answerer.scopes.filter((scope): scope is "admin" | "client" => scope === "admin" || scope === "client") };
  }
  return { error: "Only the owner can allow this.", status: 403 };
}

/** The step-up classes of a raw act (shared/step-up.ts botActClasses),
 * mirrored here so the rule check sees the same classes the card's Allow
 * would need. */
function actClassesOf(target: ActTarget): string[] {
  return botActClasses(target);
}

export { summaryOf };
