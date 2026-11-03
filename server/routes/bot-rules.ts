// The persona editor's Rules section as rule sets (server/rule-sets.ts,
// docs/bot-workspace.md): list them with their text and their size against
// the budgets, add one, rename it, switch it on or off, reorder them, save a
// set's text, delete one.
//
// The Soul edit's gate, like the workspace routes (2026-10-09: members
// manage their own bots): an admin, the bot's owner, or someone granted edit
// on it; a person who may only use shared bots is refused. The scope rule
// (server/auth/request-auth.ts CLIENT_ALLOW) lets a client session reach the
// handler; `mayEdit` decides. Text changes go through the memory store and
// its journal (revertable in History, conflict hash, secret scrub); every
// change is also written to the admin activity log (`audit`).
import type { IncomingMessage } from "node:http";
import { z } from "zod";

import { journalMemoryDelete, journalMemoryWrite } from "../memory/memory-journal.ts";
import { MemoryStoreError, readMemoryDoc } from "../memory/memory-store.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import {
  RULE_SET_NAME_MAX,
  RULE_SETS_MAX,
  RULES_MAX_BYTES,
  RULES_MAX_LINES,
  RULES_TEMPLATE,
  RULES_TOTAL_MAX_BYTES,
  RULES_TOTAL_MAX_LINES,
  cleanRuleSetName,
  effectiveRulesText,
  hasRules,
  isRuleSetId,
  listRuleSets,
  measureRules,
  newRuleSetId,
  ruleSetFile,
  setOverBudget,
  totalOverBudget,
  writeRuleSets,
  type RuleSet,
} from "../rule-sets.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotRulesAuditRow {
  action: string;
  botId: string;
  setId: string;
  changed?: string[];
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface BotRulesRouteDeps {
  bot(id: string): { id: string; name?: string } | null | undefined;
  /** Whether this caller may change the bot's Soul: admin, owner, or edit
   * grant, and not a use-only person. */
  mayEdit(auth: RequestAuth, botId: string): boolean;
  /** Wraps a write, as the memory routes do on a Cloud home. */
  ownersWrite?: <T>(auth: RequestAuth, botId: string, write: () => T) => T;
  /** The admin activity log (server/admin-activity.ts). */
  audit?(auth: RequestAuth, req: IncomingMessage, row: BotRulesAuditRow): void;
}

const FORBIDDEN = { error: "forbidden: only this bot's owner or an admin can change its rules", code: "bot_rules_owner_only" };

const nameSchema = z.string().max(RULE_SET_NAME_MAX * 4);

/** One set as the editor reads it. */
function wireSet(botId: string, set: RuleSet) {
  const doc = readMemoryDoc(botId, set.file);
  const measure = measureRules(doc.text);
  return {
    id: set.id,
    name: set.name,
    enabled: set.enabled,
    file: set.file,
    text: doc.text,
    hash: doc.hash,
    exists: doc.exists,
    lines: measure.lines,
    bytes: measure.bytes,
    over: setOverBudget(measure),
    loads: set.enabled && hasRules(effectiveRulesText(doc.text)),
  };
}

export function rulesListing(botId: string) {
  const sets = listRuleSets(botId).map((set) => wireSet(botId, set));
  const total = sets.filter((set) => set.loads).reduce((sum, set) => ({ lines: sum.lines + set.lines, bytes: sum.bytes + set.bytes }), { lines: 0, bytes: 0 });
  return {
    budgets: {
      set: { maxLines: RULES_MAX_LINES, maxBytes: RULES_MAX_BYTES },
      total: { maxLines: RULES_TOTAL_MAX_LINES, maxBytes: RULES_TOTAL_MAX_BYTES },
    },
    maxSets: RULE_SETS_MAX,
    maxNameLength: RULE_SET_NAME_MAX,
    template: RULES_TEMPLATE,
    sets,
    total: { ...total, over: totalOverBudget(total) },
  };
}

class RouteError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createBotRulesRoutes(deps: BotRulesRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const gate = /^\/api\/bots\/([\w-]+)\/rules(?:\/|$)/.exec(path);
    if (!gate) return PASS;
    const botId = gate[1]!;
    const bot = deps.bot(botId);
    if (!bot) return json(res, 404, { error: "no such bot" });
    if (!deps.mayEdit(auth, botId)) return json(res, 403, FORBIDDEN);
    const write = <T>(change: () => T): T => deps.ownersWrite ? deps.ownersWrite(auth, botId, change) : change();
    const audit = (row: Omit<BotRulesAuditRow, "botId">) => {
      try {
        deps.audit?.(auth, req, { ...row, botId });
      } catch {
        // an audit row never undoes the change it records
      }
    };
    const fail = (error: unknown) => {
      if (error instanceof RouteError) return json(res, error.status, { error: error.message, code: error.code });
      if (error instanceof MemoryStoreError) {
        return error.code === "conflict"
          ? json(res, error.status, { error: error.message, code: error.code, currentHash: error.currentHash, current: error.current })
          : json(res, error.status, { error: error.message, code: error.code });
      }
      throw error;
    };
    const setOf = (sets: RuleSet[], id: string): RuleSet => {
      const set = isRuleSetId(id) ? sets.find((candidate) => candidate.id === id) : undefined;
      if (!set) throw new RouteError(404, "missing", "no such rule set");
      return set;
    };

    if (/^\/api\/bots\/[\w-]+\/rules$/.test(path) && method === "GET") {
      return json(res, 200, rulesListing(botId));
    }

    // add a set: { name, text? }
    if (/^\/api\/bots\/[\w-]+\/rules\/sets$/.test(path) && method === "POST") {
      const parsed = z.object({ name: nameSchema, text: z.string().optional() }).safeParse(await readBody(req));
      const name = parsed.success ? cleanRuleSetName(parsed.data.name) : null;
      if (!parsed.success || !name) return json(res, 400, { error: `send { name: 1 to ${RULE_SET_NAME_MAX} characters, text? }` });
      try {
        const created = write(() => {
          const sets = listRuleSets(botId);
          if (sets.length >= RULE_SETS_MAX) throw new RouteError(409, "too-many", `A bot has at most ${RULE_SETS_MAX} rule sets.`);
          if (sets.some((set) => (set.name ?? "").toLowerCase() === name.toLowerCase())) throw new RouteError(409, "exists", `A rule set named "${name}" already exists.`);
          const id = newRuleSetId(name, sets.map((set) => set.id));
          const set: RuleSet = { id, name, enabled: true, file: ruleSetFile(id) };
          const text = parsed.data.text ?? `# ${name}\n\n`;
          journalMemoryWrite(botId, set.file, text, { actor: "person", via: "ui", expectedHash: readMemoryDoc(botId, set.file).hash });
          writeRuleSets(botId, [...sets, set]);
          return set;
        });
        audit({ action: "bot.rules-set.create", setId: created.id, after: { name: created.name, enabled: true, file: created.file } });
        return json(res, 201, { ok: true, set: wireSet(botId, created), ...rulesListing(botId) });
      } catch (error) {
        return fail(error);
      }
    }

    // the order: { ids } holding every set once
    if (/^\/api\/bots\/[\w-]+\/rules\/order$/.test(path) && method === "PUT") {
      const parsed = z.object({ ids: z.array(z.string()).max(RULE_SETS_MAX * 2) }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "send { ids: every rule set id, in the new order }" });
      try {
        const before = write(() => {
          const sets = listRuleSets(botId);
          const ids = parsed.data.ids;
          if (ids.length !== sets.length || new Set(ids).size !== ids.length || !ids.every((id) => sets.some((set) => set.id === id))) {
            throw new RouteError(409, "stale", "The rule sets changed meanwhile; reload them and try again.");
          }
          writeRuleSets(botId, ids.map((id) => sets.find((set) => set.id === id)!));
          return sets.map((set) => set.id);
        });
        audit({ action: "bot.rules-set.reorder", setId: "*", changed: ["order"], before: { order: before }, after: { order: parsed.data.ids } });
        return json(res, 200, { ok: true, ...rulesListing(botId) });
      } catch (error) {
        return fail(error);
      }
    }

    // rename, switch: { name?, enabled? }
    let m = /^\/api\/bots\/[\w-]+\/rules\/sets\/([a-z0-9-]+)$/.exec(path);
    const setRoute = Boolean(m) && (method === "PATCH" || method === "DELETE");
    if (setRoute && method === "PATCH") {
      const parsed = z.object({ name: nameSchema.nullable().optional(), enabled: z.boolean().optional() }).safeParse(await readBody(req));
      if (!parsed.success || (parsed.data.name === undefined && parsed.data.enabled === undefined)) {
        return json(res, 400, { error: "send { name?, enabled? }" });
      }
      const setId = m![1]!;
      try {
        const { before, after } = write(() => {
          const sets = listRuleSets(botId);
          const set = setOf(sets, setId);
          const next: RuleSet = { ...set };
          if (parsed.data.name !== undefined) {
            const name = parsed.data.name === null ? null : cleanRuleSetName(parsed.data.name);
            if (parsed.data.name !== null && !name) throw new RouteError(400, "invalid", `A name is 1 to ${RULE_SET_NAME_MAX} characters.`);
            if (name && sets.some((other) => other.id !== set.id && (other.name ?? "").toLowerCase() === name.toLowerCase())) {
              throw new RouteError(409, "exists", `A rule set named "${name}" already exists.`);
            }
            next.name = name;
          }
          if (parsed.data.enabled !== undefined) next.enabled = parsed.data.enabled;
          writeRuleSets(botId, sets.map((candidate) => candidate.id === set.id ? next : candidate));
          return { before: set, after: next };
        });
        const changed = (["name", "enabled"] as const).filter((field) => before[field] !== after[field]);
        if (changed.length) {
          audit({
            action: changed.includes("enabled") && changed.length === 1 ? (after.enabled ? "bot.rules-set.enable" : "bot.rules-set.disable") : "bot.rules-set.update",
            setId,
            changed: [...changed],
            before: Object.fromEntries(changed.map((field) => [field, before[field]])),
            after: Object.fromEntries(changed.map((field) => [field, after[field]])),
          });
        }
        return json(res, 200, { ok: true, set: wireSet(botId, after), ...rulesListing(botId) });
      } catch (error) {
        return fail(error);
      }
    }

    if (setRoute && method === "DELETE") {
      const setId = m![1]!;
      try {
        const removed = write(() => {
          const sets = listRuleSets(botId);
          const set = setOf(sets, setId);
          // the manifest first: a failure after it leaves an unlisted file,
          // which the list shows again rather than losing it
          writeRuleSets(botId, sets.filter((candidate) => candidate.id !== set.id));
          if (readMemoryDoc(botId, set.file).exists) journalMemoryDelete(botId, set.file, { actor: "person", via: "ui" });
          return set;
        });
        audit({ action: "bot.rules-set.delete", setId, before: { name: removed.name, enabled: removed.enabled, file: removed.file } });
        return json(res, 200, { ok: true, ...rulesListing(botId) });
      } catch (error) {
        return fail(error);
      }
    }

    // a set's text: { text, expectedHash? }
    m = /^\/api\/bots\/[\w-]+\/rules\/sets\/([a-z0-9-]+)\/text$/.exec(path);
    if (m && method === "PUT") {
      const parsed = z.object({ text: z.string(), expectedHash: z.string().optional() }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "send { text, expectedHash? }" });
      const setId = m[1]!;
      try {
        const { set, doc } = write(() => {
          const sets = listRuleSets(botId);
          const set = setOf(sets, setId);
          const { doc } = journalMemoryWrite(botId, set.file, parsed.data.text, { actor: "person", via: "ui", expectedHash: parsed.data.expectedHash });
          return { set, doc };
        });
        const measure = measureRules(doc.text);
        audit({ action: "bot.rules-set.edit", setId, changed: ["text"], after: { lines: measure.lines, bytes: measure.bytes } });
        return json(res, 200, { ok: true, set: wireSet(botId, set), ...rulesListing(botId) });
      } catch (error) {
        return fail(error);
      }
    }
    return PASS;
  };
}
