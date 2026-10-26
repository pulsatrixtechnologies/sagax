// Connections, Logs and Settings (console design 4.6, 4.8, 4.9 and section
// 5): engines, people's connections, MCP servers, marketplaces and
// the skills library, with a Test per line; the server log tail and the
// incidents; the organization's policies. Never a key, a token, an env
// value or a header value: providers and names only.
import type { AdminPerson } from "./org-admin-routes.ts";
import { compileRule, type CustomRule } from "../shared/custom-rules.ts";
import { isOrgRuleBehavior, registeredCustomRuleStore, type CustomRuleStore, type OrgRulePatch } from "./custom-rules-store.ts";
import {
  badRequest,
  enumParam,
  isAnswer,
  notImplemented,
  objectBody,
  ok,
  onlyKeys,
  pageOf,
  parsePage,
  fail,
  notFound,
  type ConsoleAnswer,
  type ConsoleContext,
  type ConsoleRoute,
} from "./org-admin-console.ts";
import type { EngineVia } from "./org-admin-people.ts";
import { INCIDENT_KINDS, reasonLabel, type ProblemKind, type ProblemRow } from "./org-problem-log.ts";
import { LOG_LEVELS, type LogLevel, type LogLine } from "./server-log-ring.ts";

export interface ConnectionsView {
  engines: Array<{ id: string; name: string; installed: boolean; version: string | null; orgKey: boolean; people: number }>;
  people: Array<{ person: AdminPerson; engines: Array<{ id: string; via: EngineVia; ok: boolean | null; checkedAt: number | null }>; mcpServers: number }>;
  mcpServers: Array<{ id: string; name: string; scope: "org" | "person"; owner: AdminPerson | null; transport: "remote" | "stdio"; state: string }>;
  marketplaces: Array<{ id: string; name: string; url: string; allowed: boolean; plugins: number }>;
  skills: Array<{ id: string; name: string; source: string | null; version: string | null; bots: number }>;
}

export type TestKind = "engine" | "mcp" | "marketplace";
export interface TestResult { ok: boolean; reason: string | null; label: string | null }

export interface Policies {
  allowedMarketplaces: string[] | null;
  allowedEngines: string[] | null;
  defaults: { engine: string | null; model: string | null; approvalMode: string | null };
}

export interface OpsDeps {
  connections(): Promise<ConnectionsView>;
  /** One check; `null` when this kind of line cannot be tested here. An
   * MCP server started by command (stdio) is started, answers the MCP
   * handshake and lists its tools (server/mcp-stdio-test.ts). */
  test(kind: TestKind, id: string, principalId: string | null): Promise<TestResult | null>;
  logs(input: { level: LogLevel | null; limit: number; before: number | null }): { lines: LogLine[]; next: number | null };
  problems(from: number): ProblemRow[];
  settings(): { org: unknown; policies: Policies; backup: { enabled: boolean; schedule: string | null; lastAt: number | null; ok: boolean | null } };
  /** Applies the changes; each setter audits its own row. Throws a
   * ConsoleRefusal for a value it refuses. */
  saveSettings(changes: SettingsChanges, adminPrincipalId: string): void;
  now(): number;
  /** 2026-10-21 (server/custom-rules-org.ts): the organization's approval
   * rules and its Always allow switch. Default: the server's custom rule
   * store. */
  orgApprovals?: Pick<CustomRuleStore, "orgPolicy" | "orgRules" | "setOrgAlwaysAllow" | "addOrgRule" | "updateOrgRule" | "removeOrgRule">;
}

/** One organization rule as the console shows it. */
export function orgRuleView(rule: CustomRule): { id: string; when: string; behavior: string; enabled: boolean; recognized: boolean; createdAt: number; updatedAt: number } {
  return { id: rule.id, when: rule.when, behavior: rule.behavior, enabled: rule.enabled, recognized: compileRule(rule.when).recognized, createdAt: rule.createdAt, updatedAt: rule.updatedAt };
}

function storeError(error: unknown): ConsoleAnswer {
  const status = (error as { status?: number }).status ?? 500;
  const message = error instanceof Error ? error.message : String(error);
  return status === 400 ? badRequest(message) : fail(status, status === 409 ? "conflict" : status === 503 ? "unavailable" : "error", message);
}

export interface SettingsChanges {
  allowFullAccess?: boolean;
  memberEnvironmentAutonomy?: boolean;
  memberAutoApproval?: boolean;
  /** 2026-10-18: people may export their credential vault in clear. */
  allowVaultExport?: boolean;
  pluginMarketplaces?: { mode: "any" } | { mode: "list"; allow: string[] };
  allowedEngines?: string[] | null;
  defaults?: { engine?: string | null; model?: string | null; approvalMode?: string | null };
  interimAttachDays?: number;
}

const TEST_TIMEOUT_MS = 10_000;

/** Runs `check` and times it; a throw is a failed test with its reason. */
export async function timed(check: () => Promise<TestResult | null>): Promise<{ result: TestResult | null; latencyMs: number }> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      check(),
      new Promise<TestResult>((resolve) => { timer = setTimeout(() => resolve({ ok: false, reason: "timeout", label: "The test did not answer within 10 seconds." }), TEST_TIMEOUT_MS); }),
    ]);
    return { result, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return { result: { ok: false, reason: "error", label: error instanceof Error ? error.message.slice(0, 300) : "The test failed." }, latencyMs: Math.round(performance.now() - started) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function settingsChanges(body: Record<string, unknown>): SettingsChanges | string {
  const extra = onlyKeys(body, ["allowFullAccess", "memberEnvironmentAutonomy", "memberAutoApproval", "allowVaultExport", "pluginMarketplaces", "allowedEngines", "defaults", "interimAttachDays"]);
  if (extra) return extra;
  if (!Object.keys(body).length) return "Send at least one setting.";
  const out: SettingsChanges = {};
  if (body.allowFullAccess !== undefined) {
    if (typeof body.allowFullAccess !== "boolean") return "allowFullAccess is true or false.";
    out.allowFullAccess = body.allowFullAccess;
  }
  if (body.memberEnvironmentAutonomy !== undefined) {
    if (typeof body.memberEnvironmentAutonomy !== "boolean") return "memberEnvironmentAutonomy is true or false.";
    out.memberEnvironmentAutonomy = body.memberEnvironmentAutonomy;
  }
  if (body.memberAutoApproval !== undefined) {
    if (typeof body.memberAutoApproval !== "boolean") return "memberAutoApproval is true or false.";
    out.memberAutoApproval = body.memberAutoApproval;
  }
  if (body.allowVaultExport !== undefined) {
    if (typeof body.allowVaultExport !== "boolean") return "allowVaultExport is true or false.";
    out.allowVaultExport = body.allowVaultExport;
  }
  if (body.pluginMarketplaces !== undefined) {
    const value = objectBody(body.pluginMarketplaces);
    if (value?.mode === "any" && Object.keys(value).length === 1) out.pluginMarketplaces = { mode: "any" };
    else if (value?.mode === "list" && Array.isArray(value.allow) && value.allow.length <= 100 && value.allow.every((entry) => typeof entry === "string" && entry.trim() && entry.length <= 300) && Object.keys(value).length === 2) {
      out.pluginMarketplaces = { mode: "list", allow: (value.allow as string[]).map((entry) => entry.trim()) };
    } else return "pluginMarketplaces is { mode: \"any\" } or { mode: \"list\", allow: [owner/repo, owner/*, https addresses] }.";
  }
  if (body.allowedEngines !== undefined) {
    const value = body.allowedEngines;
    if (value !== null && (!Array.isArray(value) || value.length > 100 || value.some((entry) => typeof entry !== "string" || !/^[A-Za-z0-9_.:-]{1,80}$/.test(entry)))) return "allowedEngines is null (every engine) or a list of engine instance ids.";
    out.allowedEngines = value === null ? null : [...new Set(value as string[])];
  }
  if (body.defaults !== undefined) {
    const value = objectBody(body.defaults);
    const bad = !value || onlyKeys(value, ["engine", "model", "approvalMode"])
      || (value.engine !== undefined && value.engine !== null && (typeof value.engine !== "string" || !value.engine || value.engine.length > 80))
      || (value.model !== undefined && value.model !== null && (typeof value.model !== "string" || !value.model || value.model.length > 200))
      || (value.approvalMode !== undefined && value.approvalMode !== null && !["ask", "auto", "full", "custom"].includes(String(value.approvalMode)));
    if (bad) return "defaults is { engine?, model?, approvalMode?: ask, auto, full or custom }.";
    out.defaults = value as SettingsChanges["defaults"];
  }
  if (body.interimAttachDays !== undefined) {
    if (!Number.isInteger(body.interimAttachDays) || (body.interimAttachDays as number) < 0 || (body.interimAttachDays as number) > 90) return "interimAttachDays is a whole number from 0 to 90.";
    out.interimAttachDays = body.interimAttachDays as number;
  }
  return out;
}

export function opsRoutes(deps: OpsDeps): ConsoleRoute[] {
  const approvals = () => deps.orgApprovals ?? registeredCustomRuleStore();
  return [
    // 2026-10-21 (Grok Bot parity lot 1A): the organization's approvals.
    // Rules ask first or refuse, for every person and bot, and members can
    // neither change nor remove them; alwaysAllow false keeps every approval
    // to one card at a time (server/custom-rules-org.ts).
    {
      method: "GET",
      path: "org-approvals",
      min: "admin",
      handle() {
        const store = approvals();
        if (!store) return notImplemented("Organization approval rules are not available on this server.");
        return ok({ ...store.orgPolicy(), rules: store.orgRules().map(orgRuleView) });
      },
    },
    {
      method: "POST",
      path: "org-approvals",
      min: "admin",
      handle(ctx) {
        const store = approvals();
        if (!store) return notImplemented("Organization approval rules are not available on this server.");
        const body = objectBody(ctx.body);
        if (!body || onlyKeys(body, ["alwaysAllow"]) || typeof body.alwaysAllow !== "boolean") return badRequest("Send { \"alwaysAllow\": true | false }.");
        const before = store.orgPolicy().alwaysAllow;
        try {
          store.setOrgAlwaysAllow(body.alwaysAllow);
        } catch (error) {
          return storeError(error);
        }
        if (before !== body.alwaysAllow) {
          ctx.record({ category: "approval", action: "org.approvals.alwaysAllow", target: { kind: "organization" }, changed: ["alwaysAllow"], before: { alwaysAllow: before }, after: { alwaysAllow: body.alwaysAllow } });
        }
        return ok({ ...store.orgPolicy(), rules: store.orgRules().map(orgRuleView) });
      },
    },
    {
      method: "POST",
      path: "org-approvals/rules",
      min: "admin",
      handle(ctx) {
        const store = approvals();
        if (!store) return notImplemented("Organization approval rules are not available on this server.");
        const body = objectBody(ctx.body);
        if (!body || onlyKeys(body, ["when", "behavior"]) || typeof body.when !== "string" || !body.when.trim() || body.when.length > 2000 || !isOrgRuleBehavior(body.behavior)) {
          return badRequest("Send { \"when\": words, \"behavior\": \"ask\" or \"deny\" }. An organization rule never allows.");
        }
        let rule: CustomRule;
        try {
          rule = store.addOrgRule({ when: body.when, behavior: body.behavior });
        } catch (error) {
          return storeError(error);
        }
        ctx.record({ category: "approval", action: "org.approvals.rule.add", target: { kind: "org-rule", id: rule.id }, after: { when: rule.when, behavior: rule.behavior } });
        return ok({ rule: orgRuleView(rule) }, 201);
      },
    },
    {
      method: "POST",
      path: "org-approvals/rules/{id}",
      min: "admin",
      handle(ctx) {
        const store = approvals();
        if (!store) return notImplemented("Organization approval rules are not available on this server.");
        const body = objectBody(ctx.body);
        const bad = !body || onlyKeys(body, ["when", "behavior", "enabled"]) || !Object.keys(body).length
          || (body.when !== undefined && (typeof body.when !== "string" || !body.when.trim() || body.when.length > 2000))
          || (body.behavior !== undefined && !isOrgRuleBehavior(body.behavior))
          || (body.enabled !== undefined && typeof body.enabled !== "boolean");
        if (bad) return badRequest("Send { \"when\"?, \"behavior\"?: \"ask\" or \"deny\", \"enabled\"?: true or false }.");
        const before = store.orgRules().find((rule) => rule.id === ctx.params.id);
        if (!before) return notFound("No such organization rule.");
        let rule: CustomRule | null;
        try {
          rule = store.updateOrgRule(ctx.params.id!, body as OrgRulePatch);
        } catch (error) {
          return storeError(error);
        }
        if (!rule) return notFound("No such organization rule.");
        ctx.record({
          category: "approval", action: "org.approvals.rule.update", target: { kind: "org-rule", id: rule.id },
          before: { when: before.when, behavior: before.behavior, enabled: before.enabled }, after: { when: rule.when, behavior: rule.behavior, enabled: rule.enabled },
        });
        return ok({ rule: orgRuleView(rule) });
      },
    },
    {
      method: "POST",
      path: "org-approvals/rules/{id}/remove",
      min: "admin",
      handle(ctx) {
        const store = approvals();
        if (!store) return notImplemented("Organization approval rules are not available on this server.");
        let removed: CustomRule | null;
        try {
          removed = store.removeOrgRule(ctx.params.id!);
        } catch (error) {
          return storeError(error);
        }
        if (!removed) return notFound("No such organization rule.");
        ctx.record({ category: "approval", action: "org.approvals.rule.remove", target: { kind: "org-rule", id: removed.id }, before: { when: removed.when, behavior: removed.behavior } });
        return ok({ ok: true });
      },
    },
    {
      method: "GET",
      path: "connections",
      min: "admin",
      async handle() {
        return ok(await deps.connections());
      },
    },
    {
      method: "POST",
      path: "connections/test",
      min: "admin",
      async handle(ctx) {
        const body = objectBody(ctx.body);
        const kind = body?.kind;
        if (!body || onlyKeys(body, ["kind", "id", "principalId"]) || (kind !== "engine" && kind !== "mcp" && kind !== "marketplace")
          || typeof body.id !== "string" || !body.id || body.id.length > 120 || (body.principalId !== undefined && (typeof body.principalId !== "string" || body.principalId.length > 160))) {
          return badRequest("Send { \"kind\": \"engine\", \"mcp\" or \"marketplace\", \"id\", \"principalId\"? }.");
        }
        const principalId = typeof body.principalId === "string" ? body.principalId : null;
        const { result, latencyMs } = await timed(() => deps.test(kind, body.id as string, principalId));
        if (!result) return notImplemented("This line cannot be tested from the console yet.");
        ctx.record({ category: kind === "engine" ? "engine" : kind === "mcp" ? "mcp" : "config", action: "connections.test", target: { kind, id: body.id as string }, after: { ok: result.ok, latencyMs, ...(principalId ? { principalId } : {}) } });
        return ok({ ok: result.ok, latencyMs, reason: result.reason, label: result.label });
      },
    },
    {
      method: "GET",
      path: "logs",
      min: "admin",
      handle(ctx) {
        const params = ctx.url.searchParams;
        const level = enumParam(params, "level", LOG_LEVELS);
        if (isAnswer(level)) return level;
        const rawLimit = params.get("limit");
        const limit = rawLimit ? Number(rawLimit) : 200;
        const rawBefore = params.get("before");
        const before = rawBefore ? Number(rawBefore) : null;
        if (!Number.isInteger(limit) || limit < 1 || limit > 500 || (before !== null && (!Number.isInteger(before) || before < 1))) {
          return badRequest("limit is 1 to 500, before the seq of a line this route gave.");
        }
        const page = deps.logs({ level, limit, before });
        return ok({ lines: page.lines.map(({ seq, at, level: lineLevel, area, message }) => ({ seq, at, level: lineLevel, area, message })), next: page.next });
      },
    },
    {
      method: "GET",
      path: "incidents",
      min: "admin",
      handle(ctx) {
        const page = parsePage(ctx.url.searchParams);
        if (isAnswer(page)) return page;
        const kind = enumParam(ctx.url.searchParams, "kind", INCIDENT_KINDS as readonly ProblemKind[]);
        if (isAnswer(kind)) return kind;
        const rows = deps.problems(ctx.now() - 90 * 24 * 60 * 60_000)
          .filter((row) => (INCIDENT_KINDS as readonly string[]).includes(row.kind) && (!kind || row.kind === kind))
          .filter((row) => !page.q || [row.botName, row.title, row.detail].some((text) => text?.toLocaleLowerCase().includes(page.q)))
          .map((row) => ({
            id: row.id, at: row.at, kind: row.kind, bot: { id: row.botId, name: row.botName }, threadId: row.threadId, title: row.title,
            reason: row.reason, label: reasonLabel(row.reason, ctx.locale), detail: row.detail, ...(row.routineId ? { routineId: row.routineId } : {}),
          }));
        return ok(pageOf(rows, page));
      },
    },
    {
      method: "GET",
      path: "settings",
      min: "admin",
      handle() {
        return ok(deps.settings());
      },
    },
    {
      method: "POST",
      path: "settings",
      min: "admin",
      handle(ctx: ConsoleContext) {
        const body = objectBody(ctx.body);
        if (!body) return badRequest("Send a JSON object.");
        const changes = settingsChanges(body);
        if (typeof changes === "string") return badRequest(changes);
        deps.saveSettings(changes, ctx.viewer.principalId);
        return ok({ settings: deps.settings() });
      },
    },
  ];
}

