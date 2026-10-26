// A person's custom auto-review rules (shared/custom-rules.ts): natural
// language rules the approval reviewer applies before a card.
//
//   GET    /api/custom-rules?botId=   -> { rules: [rule + compiled] }: the caller's
//                                        rules that can apply to that bot (its own
//                                        and those for all bots), or all of them
//   POST   /api/custom-rules          { when | text, behavior?, botId, riskScope?, fromCard? }
//                                     -> { rule }   (201)
//   PATCH  /api/custom-rules/:id      { when?, behavior?, botId?, riskScope?, enabled? }
//   DELETE /api/custom-rules/:id
//   GET    /api/custom-rules/policy   -> { alwaysAllow, orgRules }: the organization's
//                                        approval policy (server/custom-rules-org.ts)
//
// 2026-10-21: the list also carries the organization's rules (`org: true`),
// which nobody changes here (403 org_rule_locked), and `orgPolicy`. While
// the organization turned Always allow off, no allow rule is saved or
// turned on (403 org_always_allow_off); the person's own allow rules stay
// listed, paused.
//
// Every route is the caller's own: their rules, their bots. A local service,
// a turn's token or a bot's act copy of a session is never a person here
// (`manager` is null), so a bot cannot write a rule that widens its own
// leash. `fromCard` ("Toujours permettre ceci") names an open permission
// card the rule was made from; the server checks the rule really covers
// that card's call and marks the card.
import type { RequestAuth } from "../request-auth.ts";
import type { CustomRuleStore } from "../custom-rules-store.ts";
import {
  compileRule,
  isCustomRuleBehavior,
  isRiskClass,
  parseRuleSentence,
  type CompiledRule,
  type CustomRule,
  type CustomRuleBinding,
  type RiskClass,
} from "../../shared/custom-rules.ts";
import { ORG_ALWAYS_ALLOW_OFF, ORG_RULE_LOCKED } from "../custom-rules-org.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface CustomRuleRouteDeps {
  store: CustomRuleStore;
  /** The person on this request, or null (a local service, a bot, nobody). */
  manager: (auth: RequestAuth) => string | null;
  /** The bots this person owns now. */
  ownedBots: (personId: string) => ReadonlyArray<{ id: string; name: string }>;
  /** The open card a rule is made from: whether this rule covers its call,
   * and mark it. Null when there is no such open card of this person. */
  /** Whether a rule (not yet saved) covers the call of an open card of
   * this person; null when there is no such open card. */
  fromCard?: (personId: string, card: { threadId: string; requestId: string }, rule: CustomRule) => "covered" | "not-covered" | null;
  /** Mark the card with the rule saved from it. */
  markCard?: (card: { threadId: string; requestId: string }, rule: CustomRule) => void;
  /** The binding of an open shell card of this person (its exact command,
   * tool, folder and engine instance): null when there is no such open
   * card, undefined when the card is not a shell command. */
  bindingFor?: (personId: string, card: { threadId: string; requestId: string }) => CustomRuleBinding | null | undefined;
  audit: (row: { action: string; personId: string; botId?: string | null; before?: Record<string, unknown>; after?: Record<string, unknown> }, auth: RequestAuth) => void;
  home?: string;
  /** 2026-10-16 (security keys): an allow rule saved or changed needs the
   * person's key when they chose "rule-change" (shared/step-up.ts). Null
   * lets it through; else the refusal to answer. */
  stepUp?: (auth: RequestAuth, personId: string, action: "custom-rules.allow" | "rules.remove", detail: Record<string, unknown>, stepUp: unknown) => { status: number; body: unknown } | null;
}

export type CustomRuleView = CustomRule & { compiled: CompiledRule };

/** For the shell, only exact command lines may be allowed automatically:
 * a family of commands ("run commands") cannot be told safe. */
/** An exact command is allowed from its own card only, bound to where it
 * was asked; its words cannot be edited into another command. */
export const EXACT_FROM_CARD_REFUSAL = {
  error: "An exact command can be allowed only from its approval card (Always allow this), where it is bound to that bot, that tool and the session's launch folder.",
  code: "exact_command_from_card",
} as const;

export const SHELL_FAMILY_REFUSAL = {
  error: "For the shell, only exact commands can be allowed automatically. Use \"la commande exacte `...`\", or Ask first or Refuse.",
  code: "shell_family_allow",
} as const;

function riskScopeOf(value: unknown): RiskClass[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isRiskClass)) return null;
  return value;
}

export function createCustomRuleRoutes(deps: CustomRuleRouteDeps): RouteHandler {
  const view = (rule: CustomRule): CustomRuleView => ({ ...rule, compiled: compileRule(rule.when, deps.home) });
  const ownsBot = (me: string, botId: unknown) => typeof botId === "string" && deps.ownedBots(me).some((bot) => bot.id === botId);

  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (path !== "/api/custom-rules" && !path.startsWith("/api/custom-rules/")) return PASS;
    res.setHeader("cache-control", "no-store");

    // each route sits beside its method guard (scripts/tool-policy/route-inventory.ts)
    if (path === "/api/custom-rules/policy" && method !== "GET") return json(res, 405, { error: "GET only" });
    if (path === "/api/custom-rules/policy" && method === "GET") {
      const me = deps.manager(auth);
      if (!me) return json(res, 403, { error: "Sign in to see your rules." });
      return json(res, 200, { ...deps.store.orgPolicy(), orgRules: deps.store.orgRules().filter((rule) => rule.enabled).length });
    }
    if (path === "/api/custom-rules" && method !== "GET" && method !== "POST") return json(res, 405, { error: "GET or POST only" });
    if (path === "/api/custom-rules" && method === "GET") {
      const me = deps.manager(auth);
      if (!me) return json(res, 403, { error: "Sign in to see your rules." });
      const botId = url.searchParams.get("botId") ?? undefined;
      if (botId && !ownsBot(me, botId)) return json(res, 404, { error: "no such bot" });
      const own = deps.store.ownRulesOf(me, botId)
        .sort((a, b) => Number(a.botId === null) - Number(b.botId === null) || a.createdAt - b.createdAt);
      // the organization's rules first: they win over the person's own
      const org = deps.store.orgRules().filter((rule) => rule.enabled).sort((a, b) => a.createdAt - b.createdAt);
      return json(res, 200, { rules: [...org, ...own].map(view), orgPolicy: deps.store.orgPolicy() });
    }
    if (path === "/api/custom-rules" && method === "POST") {
      const me = deps.manager(auth);
      if (!me) return json(res, 403, { error: "Sign in to save a rule." });
      const body = await readBody(req);
      const raw = typeof body.when === "string" ? body.when : typeof body.text === "string" ? body.text : "";
      if (!raw.trim()) return json(res, 400, { error: "A rule needs words." });
      if (body.behavior !== undefined && !isCustomRuleBehavior(body.behavior)) return json(res, 400, { error: "behavior must be allow, ask or deny" });
      // a whole sentence ("toujours permettre ...") says its behavior itself
      const sentence = typeof body.text === "string" ? parseRuleSentence(raw, isCustomRuleBehavior(body.behavior) ? body.behavior : "ask") : null;
      const behavior = isCustomRuleBehavior(body.behavior) ? body.behavior : sentence?.behavior ?? "ask";
      const when = typeof body.when === "string" ? raw : sentence?.when ?? raw;
      if (body.botId !== null && !ownsBot(me, body.botId)) return json(res, 400, { error: "a rule applies to one of your bots, or to all of them" });
      const riskScope = riskScopeOf(body.riskScope);
      if (!riskScope) return json(res, 400, { error: "riskScope lists destructive, irreversible, money or external-send" });
      if (behavior === "allow" && !deps.store.orgPolicy().alwaysAllow) return json(res, 403, ORG_ALWAYS_ALLOW_OFF);
      if (behavior === "allow" && compileRule(when, deps.home).shellFamily) return json(res, 400, SHELL_FAMILY_REFUSAL);
      const card = body.fromCard && typeof body.fromCard === "object"
        ? body.fromCard as { threadId?: unknown; requestId?: unknown }
        : undefined;
      if (card && (typeof card.threadId !== "string" || typeof card.requestId !== "string")) return json(res, 400, { error: "fromCard names a threadId and a requestId" });
      // an exact command is allowed only where it was asked: from its card
      let binding: CustomRuleBinding | undefined;
      let botId = body.botId as string | null;
      if (behavior === "allow" && compileRule(when, deps.home).commands.length) {
        if (!card || !deps.bindingFor) return json(res, 400, EXACT_FROM_CARD_REFUSAL);
        // an exact command belongs to the card's bot, never to all bots
        if (botId === null) return json(res, 400, { error: "An exact command is allowed for the bot that asked it only.", code: "exact_command_one_bot" });
        const found = deps.bindingFor(me, { threadId: card.threadId as string, requestId: card.requestId as string });
        if (found === null) return json(res, 404, { error: "No such open approval.", code: "no_card" });
        if (!found) return json(res, 409, { error: "This rule would not cover this approval.", code: "rule_not_covering" });
        // the session's launch folder is part of the binding: none, no rule
        if (!found.cwd) return json(res, 409, { error: "This command has no known folder, so it cannot be allowed automatically.", code: "exact_command_no_cwd" });
        if (found.botId && found.botId !== botId) return json(res, 400, { error: "An exact command is allowed for the bot that asked it only.", code: "exact_command_one_bot" });
        binding = found;
        botId = found.botId ?? botId;
      }
      // check the card before anything is saved: a refusal leaves every
      // rule the person already has as it was
      if (card && deps.fromCard) {
        const provisional: CustomRule = {
          id: "provisional", ownerId: me, botId, when: when.trim(), behavior, riskScope: behavior === "allow" ? riskScope : [],
          enabled: true, ...(binding ? { binding } : {}), createdAt: 0, updatedAt: 0,
        };
        const covered = deps.fromCard(me, { threadId: card.threadId as string, requestId: card.requestId as string }, provisional);
        if (covered !== "covered") {
          return json(res, covered === null ? 404 : 409, {
            error: covered === null ? "No such open approval." : "This rule would not cover this approval. Make it narrower or ticked for this kind of action.",
            code: covered === null ? "no_card" : "rule_not_covering",
          });
        }
      }
      if (behavior === "allow" && deps.stepUp) {
        const refused = deps.stepUp(auth, me, "custom-rules.allow", { op: "add", when: when.trim(), botId, riskScope, ...(card ? { fromCard: { threadId: card.threadId, requestId: card.requestId } } : {}) }, body.stepUp);
        if (refused) return json(res, refused.status, refused.body);
      }
      let rule: CustomRule;
      try {
        rule = deps.store.add({ ownerId: me, botId, when, behavior, riskScope, ...(binding ? { binding } : {}) });
      } catch (error) {
        const status = (error as { status?: number }).status ?? 500;
        return json(res, status, { error: error instanceof Error ? error.message : String(error) });
      }
      if (card) deps.markCard?.({ threadId: card.threadId as string, requestId: card.requestId as string }, rule);
      deps.audit({ action: "custom_rule.add", personId: me, botId: rule.botId, after: { rule: rule.id, when: rule.when, botId: rule.botId, behavior: rule.behavior, riskScope: rule.riskScope, ...(card ? { fromCard: true } : {}) } }, auth);
      return json(res, 201, { rule: view(rule) });
    }

    const item = /^\/api\/custom-rules\/([\w-]+)$/.exec(path);
    if (item && method !== "PATCH" && method !== "DELETE") return json(res, 405, { error: "PATCH or DELETE only" });
    if (item && (method === "PATCH" || method === "DELETE")) {
      const me = deps.manager(auth);
      if (!me) return json(res, 403, { error: "Sign in to change your rules." });
      const id = item[1]!;
      if (deps.store.isOrgRule(id)) return json(res, 403, ORG_RULE_LOCKED);
      const before = deps.store.get(me, id);
      if (!before) return json(res, 404, { error: "no such rule" });
      // a deny or ask rule removed, turned off or made to hold less loosens
      // what the bot may do: the person's key, when they chose rule-change
      const guarding = before.behavior !== "allow" && before.enabled !== false;
      const delBody = method === "DELETE" ? (await readBody(req)) ?? {} : null;
      if (method === "DELETE" && guarding && deps.stepUp) {
        const refused = deps.stepUp(auth, me, "rules.remove", { op: "remove-custom-rule", id }, delBody?.stepUp);
        if (refused) return json(res, refused.status, refused.body);
      }
      if (method === "DELETE") {
        deps.store.remove(me, id);
        deps.audit({ action: "custom_rule.remove", personId: me, botId: before.botId, before: { rule: id, when: before.when, botId: before.botId, behavior: before.behavior, riskScope: before.riskScope } }, auth);
        return json(res, 200, { ok: true });
      }
      const body = await readBody(req);
      if (body.behavior !== undefined && !isCustomRuleBehavior(body.behavior)) return json(res, 400, { error: "behavior must be allow, ask or deny" });
      if (body.when !== undefined && (typeof body.when !== "string" || !body.when.trim())) return json(res, 400, { error: "A rule needs words." });
      if (body.enabled !== undefined && typeof body.enabled !== "boolean") return json(res, 400, { error: "enabled must be true or false" });
      if (body.botId !== undefined && body.botId !== null && !ownsBot(me, body.botId)) return json(res, 400, { error: "a rule applies to one of your bots, or to all of them" });
      const riskScope = body.riskScope === undefined ? undefined : riskScopeOf(body.riskScope);
      if (riskScope === null) return json(res, 400, { error: "riskScope lists destructive, irreversible, money or external-send" });
      const nextBehavior = isCustomRuleBehavior(body.behavior) ? body.behavior : before.behavior;
      // an allow rule saved or turned on while the organization keeps
      // approvals one at a time
      if (nextBehavior === "allow" && !deps.store.orgPolicy().alwaysAllow && (before.behavior !== "allow" || body.enabled === true || body.when !== undefined || body.botId !== undefined || body.riskScope !== undefined)) {
        return json(res, 403, ORG_ALWAYS_ALLOW_OFF);
      }
      if (guarding && nextBehavior !== "allow" && deps.stepUp && (
        body.enabled === false ||
        (nextBehavior !== before.behavior && !(before.behavior === "ask" && nextBehavior === "deny")) ||
        (typeof body.when === "string" && body.when.trim() !== before.when) ||
        (body.botId !== undefined && body.botId !== before.botId)
      )) {
        const refused = deps.stepUp(auth, me, "rules.remove", {
          op: "update-custom-rule", id,
          ...(typeof body.when === "string" ? { when: body.when } : {}),
          ...(isCustomRuleBehavior(body.behavior) ? { behavior: body.behavior } : {}),
          ...(body.botId !== undefined ? { botId: body.botId } : {}),
          ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        }, body.stepUp);
        if (refused) return json(res, refused.status, refused.body);
      }
      const nextWhen = typeof body.when === "string" ? body.when : before.when;
      if (nextBehavior === "allow" && compileRule(nextWhen, deps.home).shellFamily) return json(res, 400, SHELL_FAMILY_REFUSAL);
      // an exact command rule's words are its binding: they do not change,
      // and an unbound one never becomes an allow
      const exact = compileRule(nextWhen, deps.home).commands.length > 0 || compileRule(before.when, deps.home).commands.length > 0;
      if (exact && typeof body.when === "string" && body.when.trim() !== before.when) return json(res, 400, EXACT_FROM_CARD_REFUSAL);
      if (exact && nextBehavior === "allow" && !before.binding) return json(res, 400, EXACT_FROM_CARD_REFUSAL);
      if (before.binding && body.botId !== undefined && body.botId !== before.botId) {
        return json(res, 400, { error: "An exact command is allowed for the bot that asked it only.", code: "exact_command_one_bot" });
      }
      // a rule that allows after this change: the person's key, when chosen
      if (nextBehavior === "allow" && deps.stepUp) {
        const refused = deps.stepUp(auth, me, "custom-rules.allow", {
          op: "update", id,
          ...(typeof body.when === "string" ? { when: body.when } : {}),
          ...(isCustomRuleBehavior(body.behavior) ? { behavior: body.behavior } : {}),
          ...(body.botId !== undefined ? { botId: body.botId } : {}),
          ...(riskScope !== undefined ? { riskScope } : {}),
          ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        }, body.stepUp);
        if (refused) return json(res, refused.status, refused.body);
      }
      let updated: CustomRule | null;
      try {
        updated = deps.store.update(me, id, {
          ...(typeof body.when === "string" ? { when: body.when } : {}),
          ...(isCustomRuleBehavior(body.behavior) ? { behavior: body.behavior } : {}),
          ...(body.botId !== undefined ? { botId: body.botId as string | null } : {}),
          ...(riskScope !== undefined ? { riskScope } : {}),
          ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        });
      } catch (error) {
        const status = (error as { status?: number }).status ?? 500;
        return json(res, status, { error: error instanceof Error ? error.message : String(error) });
      }
      if (!updated) return json(res, 404, { error: "no such rule" });
      deps.audit({
        action: "custom_rule.update", personId: me, botId: updated.botId,
        before: { when: before.when, botId: before.botId, behavior: before.behavior, riskScope: before.riskScope, enabled: before.enabled },
        after: { rule: updated.id, when: updated.when, botId: updated.botId, behavior: updated.behavior, riskScope: updated.riskScope, enabled: updated.enabled },
      }, auth);
      return json(res, 200, { rule: view(updated) });
    }
    return PASS;
  };
}
