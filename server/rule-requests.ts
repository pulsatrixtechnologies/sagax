// propose_rule: a bot offers to add, change or remove one of the person's
// custom Auto-review rules on a card they confirm.
// Writes go through CustomRuleStore (custom-approval-rules.json). Org Ask
// and Deny rules stay locked and still win at runtime. Nothing is saved
// before Confirm (or a Primary Bot quote that applies at once).
import {
  CUSTOM_RULE_BEHAVIORS,
  MAX_RULE_TEXT,
  RISK_CLASSES,
  isCustomRuleBehavior,
  isRiskClass,
  type CustomRule,
  type CustomRuleBehavior,
  type RiskClass,
} from "../shared/custom-rules.ts";
import {
  ruleCardCopy,
  type RuleRequestAction,
  type RuleRequestCardData,
  type RuleRequestOperation,
} from "../shared/rule-request.ts";
import { newId } from "./contracts.ts";
import type { DirectApply, DirectApplyCheck } from "./direct-apply.ts";
import { redactSecretsInText } from "./redact.ts";
import type { CustomRulePatch, CustomRuleStore, NewCustomRule } from "./custom-rules-store.ts";
import { ORG_ALWAYS_ALLOW_OFF, ORG_RULE_LOCKED } from "./custom-rules-org.ts";

const MAX_REASON = 500;
const NO_SUCH_BOT = "That bot no longer exists";
const NO_SUCH_RULE = "That approval rule no longer exists";
const STALE = "This approval rule changed after this card was prepared. Ask the bot to propose again.";
const ORG_LOCKED = "Required by your administrator. You cannot change or delete this rule.";

export interface OptionCardLike {
  title: string;
  subtitle: string;
  options: string[];
  answered?: string;
  dismissed?: boolean;
  expired?: boolean;
  requestId?: string;
  tool?: string;
  held?: string;
  autoApplied?: boolean;
  undone?: boolean;
  ruleRequest?: RuleRequestCardData;
}

export interface RuleRequestStore {
  bot(id: string): { id: string; name: string; ownerUserId?: string | null; color?: string } | undefined | null;
  messagesFor(threadId: string): Array<{ id: string; card?: OptionCardLike }>;
  appendMessage(
    threadId: string,
    message: {
      role: "bot";
      kind: "options";
      card: OptionCardLike;
      from?: { botId: string; name: string; color: string };
    },
  ): { id: string };
  patchMessage(threadId: string, messageId: string, patch: { card: OptionCardLike }): { id: string } | null;
}

export interface RuleRequestServiceOptions {
  store: RuleRequestStore;
  rules: CustomRuleStore;
  /** Person whose rules this bot writes (bot owner). */
  ownerOf: (botId: string) => string | undefined;
  now?: () => number;
  autoApply?: DirectApplyCheck;
  canPersist?: (botId: string, threadId: string, opensCard: boolean) => { ok: true } | { ok: false; status: number; error: string };
}

export class RuleRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = "RuleRequestError";
    this.status = status;
    this.code = code;
  }
}

export type ResolveRuleRequestResult =
  | { claimed: false; state: "not_found" }
  | { claimed: true; state: "invalid"; error: string; status: number; code?: string }
  | { claimed: true; state: "already_settled"; behavior: string }
  | { claimed: true; state: "denied" }
  | { claimed: true; state: "applied"; ruleId: string; action: RuleRequestAction; settlementPending?: true; message?: string };

function reasonText(value: unknown): string {
  if (typeof value !== "string") throw new RuleRequestError("reason is required");
  const trimmed = value.trim();
  if (!trimmed) throw new RuleRequestError("reason is required");
  if (trimmed.length > MAX_REASON) throw new RuleRequestError(`reason must be ${MAX_REASON} characters or fewer`);
  return redactSecretsInText(trimmed);
}

function whenText(value: unknown): string {
  if (typeof value !== "string") throw new RuleRequestError("when is required");
  const trimmed = value.trim();
  if (!trimmed) throw new RuleRequestError("when is required");
  if (trimmed.length > MAX_RULE_TEXT) throw new RuleRequestError(`when must be ${MAX_RULE_TEXT} characters or fewer`);
  if (trimmed.split(/\s+/).filter(Boolean).length < 3) {
    throw new RuleRequestError("when needs at least three words");
  }
  return redactSecretsInText(trimmed);
}

function behaviorOf(value: unknown): CustomRuleBehavior {
  if (!isCustomRuleBehavior(value)) {
    throw new RuleRequestError(`behavior must be one of ${CUSTOM_RULE_BEHAVIORS.join(", ")}`);
  }
  return value;
}

function riskScopeOf(value: unknown, behavior: CustomRuleBehavior): RiskClass[] {
  if (behavior !== "allow") return [];
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isRiskClass)) {
    throw new RuleRequestError(`risk_scope entries must be one of ${RISK_CLASSES.join(", ")}`);
  }
  return value as RiskClass[];
}

function snapshot(rule: CustomRule): { when: string; behavior: CustomRuleBehavior; botId: string | null; enabled: boolean } {
  return { when: rule.when, behavior: rule.behavior, botId: rule.botId, enabled: rule.enabled };
}

function sameBefore(
  rule: CustomRule,
  before: { when: string; behavior: CustomRuleBehavior; botId: string | null; enabled?: boolean },
): boolean {
  if (rule.when !== before.when || rule.behavior !== before.behavior || rule.botId !== before.botId) return false;
  if (before.enabled !== undefined && rule.enabled !== before.enabled) return false;
  return true;
}

export class RuleRequestService {
  private readonly store: RuleRequestStore;
  private readonly rules: CustomRuleStore;
  private readonly ownerOf: (botId: string) => string | undefined;
  private readonly now: () => number;
  private readonly autoApply?: DirectApplyCheck;
  private readonly canPersist?: RuleRequestServiceOptions["canPersist"];

  constructor(options: RuleRequestServiceOptions) {
    this.store = options.store;
    this.rules = options.rules;
    this.ownerOf = options.ownerOf;
    this.now = options.now ?? Date.now;
    this.autoApply = options.autoApply;
    this.canPersist = options.canPersist;
  }

  propose(args: {
    botId: string;
    threadId: string;
    action: unknown;
    when?: unknown;
    behavior?: unknown;
    ruleId?: unknown;
    /** Target bot for the rule; omit for the speaking bot; null for every bot. */
    scopeBotId?: unknown;
    riskScope?: unknown;
    changes?: unknown;
    reason: unknown;
    from?: { botId: string; name: string; color: string };
    primaryAsked?: boolean;
  }): { requestId: string; messageId: string; title: string; summary: string; detail: string } {
    return this.prepare(args);
  }

  submit(args: Parameters<RuleRequestService["propose"]>[0]) {
    const proposal = this.prepare(args, true);
    return { ...proposal, state: proposal.result ? "applied" as const : "pending" as const };
  }

  private prepare(args: Parameters<RuleRequestService["propose"]>[0], submitted = false): {
    requestId: string; messageId: string; title: string; summary: string; detail: string;
    result?: Extract<ResolveRuleRequestResult, { state: "applied" }>;
    appliedBy?: DirectApply;
  } {
    const reason = reasonText(args.reason);
    const action = String(args.action ?? "").trim() as RuleRequestAction;
    if (action !== "add" && action !== "change" && action !== "remove") {
      throw new RuleRequestError("action must be add, change or remove");
    }

    const proposer = this.store.bot(args.botId);
    if (!proposer) throw new RuleRequestError(NO_SUCH_BOT, 404);
    const ownerId = this.ownerOf(args.botId)?.trim().toLowerCase();
    if (!ownerId) throw new RuleRequestError("This bot has no owner to hold approval rules for.", 403);

    const operation = this.buildOperation(action, ownerId, args);
    const scopeBotId = operation.action === "add"
      ? operation.botId
      : operation.action === "change"
        ? (operation.changes.botId !== undefined ? operation.changes.botId : operation.before.botId)
        : operation.before.botId;
    const scopeBot = scopeBotId ? this.store.bot(scopeBotId) : null;
    if (scopeBotId && !scopeBot) throw new RuleRequestError(NO_SUCH_BOT, 404);
    if (scopeBotId && this.ownerOf(scopeBotId)?.trim().toLowerCase() !== ownerId) {
      throw new RuleRequestError("That bot belongs to someone else.", 403);
    }

    const sentence = operation.action === "add"
      ? operation.when
      : operation.action === "change"
        ? (operation.changes.when ?? operation.before.when)
        : operation.before.when;
    const behavior = operation.action === "add"
      ? operation.behavior
      : operation.action === "change"
        ? (operation.changes.behavior ?? operation.before.behavior)
        : operation.before.behavior;

    const copy = ruleCardCopy({
      action,
      sentence,
      behavior,
      scopeBotName: scopeBot?.name ?? proposer.name,
      allBots: scopeBotId === null,
      reason,
      beforeWhen: operation.action === "change" ? operation.before.when : undefined,
    });

    const requestId = newId();
    const payload: RuleRequestCardData = {
      version: 1,
      requestId,
      botId: args.botId,
      threadId: args.threadId,
      ownerId,
      scopeBotId,
      scopeBotName: scopeBot?.name ?? (scopeBotId === null ? "every bot" : proposer.name),
      createdAt: this.now(),
      reason,
      operation,
      sentence,
    };

    const opensCard = !(args.primaryAsked === true);
    if (this.canPersist) {
      const gate = this.canPersist(args.botId, args.threadId, opensCard);
      if (!gate.ok) throw new RuleRequestError(gate.error, gate.status);
    }

    // Allow rules never auto-apply from Full / self alone: Confirm is the
    // grant. A Primary Bot quote still applies at once (person asked).
    const widens = operation.action === "add" && operation.behavior === "allow"
      || operation.action === "change" && (operation.changes.behavior ?? operation.before.behavior) === "allow";
    const grant = submitted
      ? (args.primaryAsked ? "primary-bot" as const : widens ? null : (this.autoApply?.(args.botId, args.threadId, scopeBotId ?? args.botId) ?? null))
      : null;

    if (grant) {
      const applied = this.apply(ownerId, operation);
      const message = this.store.appendMessage(args.threadId, {
        role: "bot",
        kind: "options",
        card: {
          title: copy.title,
          subtitle: copy.detail,
          options: ["Confirm", "Cancel"],
          requestId,
          tool: "propose_rule",
          answered: "allow",
          autoApplied: true,
          ruleRequest: { ...payload, appliedAt: this.now() },
        },
        from: args.from ?? { botId: proposer.id, name: proposer.name, color: proposer.color ?? "#888" },
      });
      return {
        requestId,
        messageId: message.id,
        title: copy.title,
        summary: copy.summary,
        detail: copy.detail,
        result: { claimed: true, state: "applied", ruleId: applied.ruleId, action },
        appliedBy: grant,
      };
    }

    const message = this.store.appendMessage(args.threadId, {
      role: "bot",
      kind: "options",
      card: {
        title: copy.title,
        subtitle: copy.detail,
        options: ["Confirm", "Cancel"],
        requestId,
        tool: "propose_rule",
        ruleRequest: payload,
      },
      from: args.from ?? { botId: proposer.id, name: proposer.name, color: proposer.color ?? "#888" },
    });
    return { requestId, messageId: message.id, title: copy.title, summary: copy.summary, detail: copy.detail };
  }

  private buildOperation(
    action: RuleRequestAction,
    ownerId: string,
    args: Parameters<RuleRequestService["propose"]>[0],
  ): RuleRequestOperation {
    if (action === "add") {
      const when = whenText(args.when);
      const behavior = behaviorOf(args.behavior ?? "allow");
      const riskScope = riskScopeOf(args.riskScope, behavior);
      let botId: string | null;
      if (args.scopeBotId === null) botId = null;
      else if (typeof args.scopeBotId === "string" && args.scopeBotId.trim()) botId = args.scopeBotId.trim();
      else botId = args.botId;
      if (behavior === "allow" && !this.rules.orgPolicy().alwaysAllow) {
        throw new RuleRequestError(ORG_ALWAYS_ALLOW_OFF.error, 403, ORG_ALWAYS_ALLOW_OFF.code);
      }
      return { action: "add", when, behavior, botId, ...(riskScope.length ? { riskScope } : {}) };
    }

    const ruleId = typeof args.ruleId === "string" ? args.ruleId.trim() : "";
    if (!ruleId) throw new RuleRequestError("rule_id is required");
    const rule = this.rules.get(ownerId, ruleId);
    if (!rule) {
      // Org rules are visible in the list but locked.
      const orgHit = this.rules.orgRules().find((candidate) => candidate.id === ruleId);
      if (orgHit) throw new RuleRequestError(ORG_LOCKED, 403, ORG_RULE_LOCKED.code);
      throw new RuleRequestError(NO_SUCH_RULE, 404);
    }
    if (rule.org) throw new RuleRequestError(ORG_LOCKED, 403, ORG_RULE_LOCKED.code);

    if (action === "remove") {
      return { action: "remove", ruleId, before: { when: rule.when, behavior: rule.behavior, botId: rule.botId } };
    }

    const raw = args.changes && typeof args.changes === "object" && !Array.isArray(args.changes)
      ? args.changes as Record<string, unknown>
      : {};
    const changes: RuleRequestOperation & { action: "change" } extends never ? never : {
      when?: string;
      behavior?: CustomRuleBehavior;
      botId?: string | null;
      enabled?: boolean;
      riskScope?: RiskClass[];
    } = {};
    if (raw.when !== undefined) changes.when = whenText(raw.when);
    if (raw.behavior !== undefined) changes.behavior = behaviorOf(raw.behavior);
    if (raw.botId === null) changes.botId = null;
    else if (typeof raw.botId === "string") changes.botId = raw.botId.trim() || null;
    if (typeof raw.enabled === "boolean") changes.enabled = raw.enabled;
    const nextBehavior = changes.behavior ?? rule.behavior;
    if (raw.riskScope !== undefined || changes.behavior === "allow") {
      changes.riskScope = riskScopeOf(raw.riskScope, nextBehavior);
    }
    if (Object.keys(changes).length === 0) throw new RuleRequestError("Nothing would change");
    if (nextBehavior === "allow" && !this.rules.orgPolicy().alwaysAllow) {
      throw new RuleRequestError(ORG_ALWAYS_ALLOW_OFF.error, 403, ORG_ALWAYS_ALLOW_OFF.code);
    }
    return { action: "change", ruleId, before: snapshot(rule), changes };
  }

  private apply(ownerId: string, operation: RuleRequestOperation): { ruleId: string } {
    if (operation.action === "add") {
      const input: NewCustomRule = {
        ownerId,
        botId: operation.botId,
        when: operation.when,
        behavior: operation.behavior,
        ...(operation.riskScope ? { riskScope: operation.riskScope } : {}),
      };
      const rule = this.rules.add(input);
      return { ruleId: rule.id };
    }
    if (operation.action === "remove") {
      if (!this.rules.remove(ownerId, operation.ruleId)) throw new RuleRequestError(NO_SUCH_RULE, 404);
      return { ruleId: operation.ruleId };
    }
    const current = this.rules.get(ownerId, operation.ruleId);
    if (!current) throw new RuleRequestError(NO_SUCH_RULE, 404);
    if (!sameBefore(current, operation.before)) throw new RuleRequestError(STALE, 409);
    const patch: CustomRulePatch = { ...operation.changes };
    const updated = this.rules.update(ownerId, operation.ruleId, patch);
    if (!updated) throw new RuleRequestError(NO_SUCH_RULE, 404);
    return { ruleId: updated.id };
  }

  resolve(args: {
    botId: string;
    threadId: string;
    requestId: string;
    behavior: string;
    /** Person answering the card; must own the rules. */
    personId?: string;
  }): ResolveRuleRequestResult {
    const message = this.store.messagesFor(args.threadId).find(
      (row) => row.card?.requestId === args.requestId && row.card.ruleRequest,
    );
    const card = message?.card;
    const request = card?.ruleRequest;
    if (!message || !card || !request) return { claimed: false, state: "not_found" };

    if (card.answered || card.dismissed || card.expired) {
      return { claimed: true, state: "already_settled", behavior: card.answered === "allow" ? "allow" : "deny" };
    }

    const allow = args.behavior === "allow" || args.behavior === "Confirm" || args.behavior === "confirm";
    if (!allow) {
      this.store.patchMessage(args.threadId, message.id, {
        card: { ...card, answered: "deny", ruleRequest: request },
      });
      return { claimed: true, state: "denied" };
    }

    const person = (args.personId ?? request.ownerId).trim().toLowerCase();
    if (person !== request.ownerId) {
      return { claimed: true, state: "invalid", error: "Only the person who owns these rules can confirm this card.", status: 403 };
    }

    try {
      const applied = this.apply(person, request.operation);
      this.store.patchMessage(args.threadId, message.id, {
        card: {
          ...card,
          answered: "allow",
          ruleRequest: { ...request, appliedAt: this.now() },
        },
      });
      return { claimed: true, state: "applied", ruleId: applied.ruleId, action: request.operation.action };
    } catch (error) {
      if (error instanceof RuleRequestError) {
        return { claimed: true, state: "invalid", error: error.message, status: error.status, code: error.code };
      }
      throw error;
    }
  }
}
