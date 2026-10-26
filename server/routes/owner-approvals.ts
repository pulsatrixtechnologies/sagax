// A person's own approval rules and their bots' permission modes
// (2026-10-14, docs/superpowers/specs/2026-10-14-bot-owner-permissions.md).
//
//   GET    /api/approval-rules?botId=        -> { rules }: the caller's rules
//                                               (and their bots' earlier
//                                               per-bot Allow keys, `legacy`)
//   PATCH  /api/approval-rules/:id           { behavior?, description?, botId?, anyTarget? }
//   DELETE /api/approval-rules/:id           (also an Always allow someone
//                                               else saved on an admin's card
//                                               of a bot the caller owns or
//                                               administers, 2026-10-21)
//   GET    /api/bots/:id/permission-mode     -> { mode, canBypass }
//   PUT    /api/bots/:id/permission-mode     { mode, confirmBypass? }
//
// Every route is the caller's own: their rules, their bots. A local
// service or a turn's token is never a person here (`manager` is null), so
// a bot cannot widen its own leash.
import type { RequestAuth } from "../request-auth.ts";
import { isBotPermissionMode, isRuleBehavior, type BotPermissionMode, type OwnerRule } from "../owner-approval.ts";
import type { OwnerApprovalStore } from "../owner-approval-store.ts";
import { ORG_ALWAYS_ALLOW_OFF, standingGrantsAllowed } from "../custom-rules-org.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface LegacyRule extends OwnerRule {
  legacy: true;
}

export interface OwnerApprovalRouteDeps {
  store: OwnerApprovalStore;
  /** The person on this request, or null (a local service, nobody). */
  manager: (auth: RequestAuth) => string | null;
  /** The bots this person owns now, with their earlier per-bot Allow keys. */
  ownedBots: (personId: string) => ReadonlyArray<{ id: string; name: string; threadId: string; alwaysAllow?: readonly string[] }>;
  /** A bot's current owner, or null when there is no such bot. */
  ownerOf: (botId: string) => string | null;
  /** A bot's name for the list (a rule saved on a bot someone else owns,
   * an admin's rule on a member's bot), or undefined when it is gone. */
  botName?: (botId: string) => string | undefined;
  /** 2026-10-21 (JC): the rules saved on an admin's card of this bot
   * (`from: "admin"`) by someone else, that this person may see and remove:
   * the bot's owner and an organization admin. Empty for anyone else. */
  sharedBotRules?: (personId: string, botId: string) => OwnerRule[];
  /** Whether this person manages this bot's rules without owning it (an
   * organization admin). */
  managesBot?: (personId: string, botId: string) => boolean;
  /** The name of the person who saved a rule, never an id. */
  personName?: (personId: string) => string | undefined;
  /** An earlier per-bot Allow key in plain words. */
  describeLegacy: (key: string) => string;
  /** Remove an earlier Allow key from a bot and its conversations. */
  revokeLegacy: (botId: string, key: string) => void;
  /** Why this person may not turn Bypass on, or null. */
  bypassRefusal: (auth: RequestAuth) => string | null;
  /** A mode this bot may not take now (a member's bot while the
   * organization turned automatic levels off), or null. */
  modeRefusal?: (botId: string, mode: BotPermissionMode) => { error: string; code: string } | null;
  audit: (row: { action: string; botId?: string; personId: string; before?: Record<string, unknown>; after?: Record<string, unknown> }, auth: RequestAuth) => void;
  /** One journal row for a mode change. */
  journalMode: (bot: { id: string; name: string; threadId: string }, before: BotPermissionMode, after: BotPermissionMode) => void;
  /** 2026-10-16 (security keys): a change that loosens (a rule that allows,
   * a looser mode) needs the person's key when they chose "rule-change"
   * (shared/step-up.ts). Null lets it through; else the refusal. */
  stepUp?: (auth: RequestAuth, personId: string, action: "approval-rules.allow" | "permission-mode" | "rules.remove", detail: Record<string, unknown>, stepUp: unknown) => { status: number; body: unknown } | null;
}

const MODE_RANK: Record<BotPermissionMode, number> = { approval: 0, auto: 1, bypass: 2 };

export function legacyRuleId(botId: string, key: string): string {
  return `legacy_${Buffer.from(`${botId}\n${key}`).toString("base64url")}`;
}

export function parseLegacyRuleId(id: string): { botId: string; key: string } | null {
  if (!id.startsWith("legacy_")) return null;
  const [botId, ...rest] = Buffer.from(id.slice(7), "base64url").toString("utf8").split("\n");
  const key = rest.join("\n");
  return botId && key ? { botId, key } : null;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function createOwnerApprovalRoutes(deps: OwnerApprovalRouteDeps): RouteHandler {
  const legacyRules = (personId: string, botId?: string): LegacyRule[] => deps.ownedBots(personId)
    .filter((bot) => botId === undefined || bot.id === botId)
    .flatMap((bot) => (bot.alwaysAllow ?? []).map((key) => ({
      id: legacyRuleId(bot.id, key),
      legacy: true as const,
      ownerId: personId,
      botId: bot.id,
      tool: key.startsWith("mcp:") ? key.slice(4) : key,
      scope: {},
      behavior: "allow" as const,
      description: deps.describeLegacy(key),
      createdAt: 0,
      updatedAt: 0,
    })));

  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (path === "/api/approval-rules" && method !== "GET") return json(res, 405, { error: "GET only" });
    if (path === "/api/approval-rules" && method === "GET") {
      res.setHeader("cache-control", "no-store");
      const me = deps.manager(auth);
      if (!me) return json(res, 403, { error: "Sign in to see your approval rules." });
      const botId = url.searchParams.get("botId") ?? undefined;
      const owned = !botId || deps.ownedBots(me).some((bot) => bot.id === botId);
      if (botId && !owned && !deps.managesBot?.(me, botId)) return json(res, 404, { error: "no such bot" });
      const named = (rows: OwnerRule[]) => rows.map((row) => {
        const name = row.botId && deps.botName ? deps.botName(row.botId) : undefined;
        return name ? { ...row, botName: name } : row;
      });
      // 2026-10-21 (JC): an Always allow saved on an admin's card of this
      // bot by someone else is listed too, to remove (never to edit)
      const shared = botId ? (deps.sharedBotRules?.(me, botId) ?? []).filter((row) => !same(row.ownerId, me)) : [];
      const own = owned ? deps.store.rulesOf(me, botId) : deps.store.rulesOf(me).filter((row) => row.botId === botId);
      return json(res, 200, { rules: [
        ...named([...own, ...(owned ? legacyRules(me, botId) : [])]),
        ...named(shared).map(({ ownerId, scope, ...row }) => {
          // review of #938: the saver by name only, never their id, and
          // never the real folder (the card's words already say what it is)
          const savedBy = deps.personName?.(ownerId);
          const { cwd: _folder, ...visible } = scope;
          return { ...row, scope: visible, byOther: true as const, ...(savedBy ? { savedBy } : {}) };
        }),
      ] });
    }

    // each route sits beside its method guard (scripts/tool-policy/route-inventory.ts)
    const rule = /^\/api\/approval-rules\/([\w-]+)$/.exec(path);
    if (rule && method !== "PATCH" && method !== "DELETE") return json(res, 405, { error: "PATCH or DELETE only" });
    if (rule && (method === "PATCH" || method === "DELETE")) {
      const me = deps.manager(auth);
      if (!me) return json(res, 403, { error: "Sign in to change your approval rules." });
      const body = (await readBody(req)) ?? {};
      if (body.behavior !== undefined && !isRuleBehavior(body.behavior)) return json(res, 400, { error: "behavior must be allow, ask or deny" });
      if (body.description !== undefined && typeof body.description !== "string") return json(res, 400, { error: "description must be text" });
      if (body.botId !== undefined && body.botId !== null && (typeof body.botId !== "string" || !deps.ownedBots(me).some((bot) => bot.id === body.botId))) {
        return json(res, 400, { error: "a rule applies to one of your bots, or to all of them" });
      }
      const id = rule[1]!;
      const legacy = parseLegacyRuleId(id);
      if (legacy) {
        const bot = deps.ownedBots(me).find((candidate) => candidate.id === legacy.botId);
        if (!bot || !(bot.alwaysAllow ?? []).includes(legacy.key)) return json(res, 404, { error: "no such rule" });
        let converted: OwnerRule | null = null;
        // an earlier per-bot Allow made a rule for every bot widens it
        if (method === "PATCH" && body.botId === null && deps.stepUp) {
          const refused = deps.stepUp(auth, me, "approval-rules.allow", { id, behavior: isRuleBehavior(body.behavior) ? body.behavior : "allow", botId: null, legacy: true }, body.stepUp);
          if (refused) return json(res, refused.status, refused.body);
        }
        // 2026-10-21: no allow rule is made while the organization turned
        // Always allow off (server/custom-rules-org.ts)
        if (method === "PATCH" && (body.behavior ?? "allow") === "allow" && !standingGrantsAllowed()) return json(res, 403, ORG_ALWAYS_ALLOW_OFF);
        if (method === "PATCH") {
          // editing an earlier rule makes it this person's own rule
          if (!legacy.key.startsWith("mcp:")) return json(res, 400, { error: "This rule is about another bot or room; remove it instead." });
          converted = deps.store.add({
            ownerId: me,
            botId: body.botId === undefined ? bot.id : body.botId as string | null,
            tool: legacy.key.slice(4).toLowerCase(),
            scope: {},
            behavior: isRuleBehavior(body.behavior) ? body.behavior : "allow",
            description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : deps.describeLegacy(legacy.key),
          });
        }
        deps.revokeLegacy(bot.id, legacy.key);
        deps.audit({
          action: converted ? "approval.rule.update" : "approval.rule.remove", botId: bot.id, personId: me,
          before: { key: legacy.key }, ...(converted ? { after: { rule: converted.id, behavior: converted.behavior } } : {}),
        }, auth);
        return json(res, 200, converted ? { rule: converted } : { ok: true });
      }
      const existing = deps.store.rulesOf(me).find((candidate) => candidate.id === id);
      // removing a deny or ask rule, or making one ask less, loosens
      const loosensGuard = existing && existing.behavior !== "allow" && (method === "DELETE" ||
        (isRuleBehavior(body.behavior) && body.behavior !== existing.behavior && !(existing.behavior === "ask" && body.behavior === "deny")) ||
        body.anyTarget === true || (body.botId !== undefined && body.botId !== existing.botId));
      if (loosensGuard && deps.stepUp && !(method === "PATCH" && body.behavior === "allow")) {
        const refused = deps.stepUp(auth, me, "rules.remove", {
          op: method === "DELETE" ? "remove-owner-rule" : "update-owner-rule", id,
          ...(method === "PATCH" ? {
            ...(isRuleBehavior(body.behavior) ? { behavior: body.behavior } : {}),
            ...(body.botId !== undefined ? { botId: body.botId } : {}),
            ...(body.anyTarget === true ? { anyTarget: true } : {}),
          } : {}),
        }, body.stepUp);
        if (refused) return json(res, refused.status, refused.body);
      }
      if (method === "DELETE") {
        // 2026-10-21 (JC): the bot's owner or an admin removes an Always
        // allow someone else saved on an admin's card of that bot
        const shared = existing ? undefined : deps.store.adminRuleById(id);
        if (shared?.botId && deps.sharedBotRules?.(me, shared.botId).some((row) => row.id === id && !same(row.ownerId, me))) {
          if (!deps.store.remove(shared.ownerId, id)) return json(res, 404, { error: "no such rule" });
          deps.audit({ action: "approval.rule.remove", botId: shared.botId, personId: me, before: { rule: id } }, auth);
          return json(res, 200, { ok: true });
        }
        if (!deps.store.remove(me, id)) return json(res, 404, { error: "no such rule" });
        deps.audit({ action: "approval.rule.remove", personId: me, before: { rule: id } }, auth);
        return json(res, 200, { ok: true });
      }
      const current = deps.store.rulesOf(me).find((rule) => rule.id === id);
      const widens = body.behavior === "allow"
        ? current?.behavior !== "allow" || body.anyTarget === true || body.botId === null
        : body.behavior === undefined && current?.behavior === "allow" && (body.anyTarget === true || body.botId === null);
      if (current && widens && !standingGrantsAllowed()) return json(res, 403, ORG_ALWAYS_ALLOW_OFF);
      if (current && widens && deps.stepUp) {
        const refused = deps.stepUp(auth, me, "approval-rules.allow", {
          id,
          ...(isRuleBehavior(body.behavior) ? { behavior: body.behavior } : {}),
          ...(body.botId !== undefined ? { botId: body.botId } : {}),
          ...(body.anyTarget === true ? { anyTarget: true } : {}),
        }, body.stepUp);
        if (refused) return json(res, refused.status, refused.body);
      }
      const updated = deps.store.update(me, id, {
        ...(isRuleBehavior(body.behavior) ? { behavior: body.behavior } : {}),
        ...(typeof body.description === "string" ? { description: body.description } : {}),
        ...(body.botId !== undefined ? { botId: body.botId as string | null } : {}),
        ...(body.anyTarget === true ? { anyTarget: true } : {}),
      });
      if (!updated) return json(res, 404, { error: "no such rule" });
      deps.audit({ action: "approval.rule.update", personId: me, after: { rule: updated.id, behavior: updated.behavior } }, auth);
      return json(res, 200, { rule: updated });
    }

    const mode = /^\/api\/bots\/([\w-]+)\/permission-mode$/.exec(path);
    if (mode && method !== "GET" && method !== "PUT") return json(res, 405, { error: "GET or PUT only" });
    if (mode && (method === "GET" || method === "PUT")) {
      const botId = mode[1]!;
      const ownerId = deps.ownerOf(botId);
      if (!ownerId) return json(res, 404, { error: "no such bot" });
      const me = deps.manager(auth);
      if (!me || !same(me, ownerId)) return json(res, 403, { error: "Only this bot's owner chooses its permission mode.", code: "not_bot_owner" });
      if (method === "GET") return json(res, 200, { mode: deps.store.modeOf(botId, ownerId), canBypass: deps.bypassRefusal(auth) === null });
      const body = await readBody(req);
      if (!isBotPermissionMode(body.mode)) return json(res, 400, { error: "mode must be approval, auto or bypass" });
      const next: BotPermissionMode = body.mode;
      if (next === "bypass") {
        if (body.confirmBypass !== true) return json(res, 400, { error: "Bypass needs an explicit confirmation.", code: "bypass_confirmation_required" });
        const refusal = deps.bypassRefusal(auth);
        if (refusal) return json(res, 403, { error: refusal, code: "bypass_not_allowed" });
      }
      const before = deps.store.modeOf(botId, ownerId);
      const modeRefused = next !== before ? deps.modeRefusal?.(botId, next) ?? null : null;
      if (modeRefused) return json(res, 403, modeRefused);
      if (MODE_RANK[next] > MODE_RANK[before] && deps.stepUp) {
        const refused = deps.stepUp(auth, me, "permission-mode", { botId, mode: next }, body.stepUp);
        if (refused) return json(res, refused.status, refused.body);
      }
      try {
        deps.store.setMode(botId, ownerId, next);
      } catch (error) {
        return json(res, (error as { status?: number }).status === 503 ? 503 : 500, { error: error instanceof Error ? error.message : String(error) });
      }
      deps.audit({ action: "bot.permission-mode", botId, personId: me, before: { mode: before }, after: { mode: next } }, auth);
      const bot = deps.ownedBots(ownerId).find((candidate) => candidate.id === botId);
      if (bot) deps.journalMode(bot, before, next);
      return json(res, 200, { mode: next, canBypass: deps.bypassRefusal(auth) === null });
    }
    return PASS;
  };
}
