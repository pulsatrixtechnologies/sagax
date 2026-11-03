// A bot's own runtime settings and tool access (2026-10-15), edited in the
// bot editor instead of Settings > General > Advanced
// (server/bot-runtime-settings.ts says what each field does).
//
//   GET   /api/bots/:id/runtime-settings -> { settings, stored }
//   PATCH /api/bots/:id/runtime-settings { maxConcurrentThreads?,
//         maxParallelPerPerson?, busySend?, automaticRecovery?,
//         turnPayer?: "owner" | "speaker" | null,
//         turnLimits?: { roomPosts?, threadsOpened?, roomsCreated? } } -> same
//
// `turnLimits` (#1098): the bot's per-turn anti-loop limits
// (shared/turn-limits.ts), merged into what it has. `maxParallelPerPerson`
// goes up to 16 on a solo server and stays at most 10 on an organization
// server (shared/parallel-tasks.ts maxParallelPerPersonFor).
//
// `turnPayer` (#1137, shared/turn-payer.ts): who pays for the bot's replies
// to the people it is shared with; null goes back to the default, which
// `settings.turnPayer` reads when nothing is stored. The bot's owner sets it
// without an admin (bots.behaviour is always theirs).
//   GET   /api/bots/:id/tool-grants -> { grants } (this bot's, with state)
//   POST  /api/bots/:id/tool-grants { scope, expiresAt? } -> 201 { grant }
//   POST  /api/bots/:id/tool-grants/:grantId/revoke -> { ok }
//
// Who: the bot's owner or an admin (`mayManage`, the server's gate: a member
// owner also needs the permission of their profiles, bots.behaviour for the
// settings and bots.tools for the grants). 2026-10-26: an admin-tier grant
// is the owner's too when its scope stays in their own environment
// (shared/grant-reach.ts); a scope that reaches other people, the whole
// organization, the shared server or its billing stays an admin's
// (`isAdmin`, 403 `org_scope_admin_only`). An admin-tier grant always ends
// within 30 days (docs/tool-policy.md §6); revoking only narrows, so the
// owner may revoke any of the bot's grants.
// Every change is one row in the admin activity log. Member scope:
// request-auth.ts CLIENT_ALLOW lists these paths; the handler decides.
import type { IncomingMessage } from "node:http";
import { z } from "zod";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { ToolGrantStore } from "../tool-grants.ts";
import {
  botRuntimeSettingsPatchSchema,
  effectiveBotRuntimeSettings,
  type BotAutomaticRecovery,
  type BotRuntimeSettings,
  type GlobalRuntimeSettings,
} from "../bot-runtime-settings.ts";
import { PASS, type RouteHandler } from "./table.ts";
import { grantStaysInOwnEnvironment, ORG_REACH_AREAS } from "../../shared/grant-reach.ts";
import { maxParallelPerPersonFor } from "../../shared/parallel-tasks.ts";
import { DEFAULT_TURN_LIMITS } from "../../shared/turn-limits.ts";
import { isSharedHost } from "../host-kind.ts";
import type { TurnPayerMode } from "../../shared/turn-payer.ts";

const SETTINGS = /^\/api\/bots\/([\w-]+)\/runtime-settings$/;
const GRANTS = /^\/api\/bots\/([\w-]+)\/tool-grants$/;
const REVOKE = /^\/api\/bots\/([\w-]+)\/tool-grants\/(tg_[\w-]+)\/revoke$/;
const MAX_ADMIN_DAYS = 30;
const RUNTIME_FIELDS = ["maxConcurrentThreads", "maxParallelPerPerson", "busySend", "automaticRecovery", "turnPayer", "turnLimits"] as const;

type StoredRuntime = BotRuntimeSettings & { turnPayer?: TurnPayerMode };
type RuntimeBot = { id: string; name?: string } & StoredRuntime;

export interface BotRuntimeSettingsRouteDeps {
  bot(id: string): RuntimeBot | null | undefined;
  /** The global values of config.json: the default of a bot with none. */
  global(): GlobalRuntimeSettings;
  /** The bot's owner or an admin, with the permission of `area`. */
  mayManage(auth: RequestAuth, bot: RuntimeBot, area: "behaviour" | "tools"): boolean;
  /** An admin (grants whose scope reaches past the person stay theirs). */
  isAdmin(auth: RequestAuth): boolean;
  /** A backup model the server can run: the checked selection, or why not. */
  checkBackup(selection: NonNullable<BotAutomaticRecovery["backup"]>): { ok: true; selection: NonNullable<BotAutomaticRecovery["backup"]> } | { ok: false; status: number; error: string; code?: string };
  /** Store the fields on the bot and tell the clients. A field set to
   * undefined is cleared (turnPayer back to its default). */
  save(botId: string, patch: StoredRuntime): RuntimeBot | null;
  /** #1137: the bot's default "who pays" when it has no choice of its own.
   * Absent: "speaker" (solo server, tests). */
  turnPayerDefault?(bot: RuntimeBot): TurnPayerMode;
  /** #1098: an organization server (its ceilings protect the others).
   * Absent: server/host-kind.ts. */
  sharedHost?(): boolean;
  grants: Pick<ToolGrantStore, "all" | "grant" | "revoke">;
  audit(action: "bot.runtime_settings" | "tool_grants.grant" | "tool_grants.revoke", auth: RequestAuth, req: IncomingMessage, detail: Record<string, unknown>): void;
  now?: () => number;
}

const grantBody = z.object({
  scope: z.string().regex(/^[a-z0-9-]+:(read|write|admin)$/),
  expiresAt: z.number().int().positive().optional(),
}).strict();

function actor(auth: RequestAuth): string {
  return auth.kind === "session" ? auth.session.principalId ?? `session:${auth.session.id}` : "loopback";
}

function stored(bot: RuntimeBot): StoredRuntime {
  return Object.fromEntries(RUNTIME_FIELDS.filter((field) => bot[field] !== undefined).map((field) => [field, structuredClone(bot[field])]));
}

export function createBotRuntimeSettingsRoutes(deps: BotRuntimeSettingsRouteDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  const sharedHost = deps.sharedHost ?? isSharedHost;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const settings = path.match(SETTINGS);
    const grants = settings ? null : path.match(GRANTS);
    const revoke = settings || grants ? null : path.match(REVOKE);
    const id = settings?.[1] ?? grants?.[1] ?? revoke?.[1];
    if (!id) return PASS;
    res.setHeader("cache-control", "no-store");
    const bot = deps.bot(id);
    if (!bot) return json(res, 404, { error: "no such bot" });
    if (auth.kind === "loopback" && auth.trust === "service") return json(res, 403, { error: "forbidden" });

    if (settings) {
      if (method !== "GET" && method !== "PATCH") return json(res, 405, { error: "GET or PATCH" });
      if (!deps.mayManage(auth, bot, "behaviour")) return json(res, 403, { error: "forbidden: only the bot's owner or an admin can change its settings", code: "bot_settings_owner_only" });
      const answer = (current: RuntimeBot) => json(res, 200, {
        settings: {
          ...effectiveBotRuntimeSettings(current, deps.global()),
          turnPayer: current.turnPayer ?? deps.turnPayerDefault?.(current) ?? "speaker",
          turnLimits: { ...DEFAULT_TURN_LIMITS, ...current.turnLimits },
          maxParallelPerPersonCeiling: maxParallelPerPersonFor(sharedHost()),
        },
        stored: stored(current),
      });
      if (method === "GET") return answer(bot);
      const parsed = botRuntimeSettingsPatchSchema.safeParse(await readBody(req));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const message = issue?.code === "unrecognized_keys" ? `unknown setting: ${issue.keys[0]}` : issue?.message ?? "invalid settings";
        return json(res, 400, { error: message });
      }
      const { turnPayer, ...runtime } = parsed.data;
      const ceiling = maxParallelPerPersonFor(sharedHost());
      if (runtime.maxParallelPerPerson !== undefined && runtime.maxParallelPerPerson > ceiling) {
        return json(res, 400, { error: `at most ${ceiling} parallel tasks per person on this server`, code: "parallel_ceiling" });
      }
      const patch: StoredRuntime = { ...runtime } as BotRuntimeSettings;
      if (runtime.turnLimits) patch.turnLimits = { ...bot.turnLimits, ...runtime.turnLimits };
      if (turnPayer !== undefined) patch.turnPayer = turnPayer ?? undefined;
      const recovery = parsed.data.automaticRecovery;
      if (recovery?.backup) {
        const checked = deps.checkBackup(recovery.backup);
        // Turning recovery off never fails on a backup that went away.
        if (!checked.ok && recovery.enabled) return json(res, checked.status, { error: checked.error, ...(checked.code ? { code: checked.code } : {}) });
        patch.automaticRecovery = checked.ok ? { enabled: recovery.enabled, backup: checked.selection } : { enabled: false };
      }
      const before = stored(bot);
      const saved = deps.save(bot.id, patch);
      if (!saved) return json(res, 404, { error: "no such bot" });
      const after = stored(saved);
      const changed = RUNTIME_FIELDS.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
      if (changed.length) {
        deps.audit("bot.runtime_settings", auth, req, {
          bot: { id: bot.id, ...(bot.name ? { name: bot.name } : {}) }, changed,
          before: Object.fromEntries(changed.map((field) => [field, before[field] ?? null])),
          after: Object.fromEntries(changed.map((field) => [field, after[field] ?? null])),
        });
      }
      return answer(saved);
    }

    if (!deps.mayManage(auth, bot, "tools")) return json(res, 403, { error: "forbidden: only the bot's owner or an admin can change its tool access", code: "bot_tool_access_owner_only" });
    if (grants && method === "GET") {
      const at = now();
      const rows = deps.grants.all()
        .filter((g) => g.subject.kind === "bot" && g.subject.id === bot.id)
        .map((g) => ({ ...g, state: g.revokedAt !== undefined ? "revoked" : g.expiresAt !== undefined && g.expiresAt <= at ? "expired" : "active" }));
      const admin = deps.isAdmin(auth);
      // the owner grants the admin tier too, within their own environment
      return json(res, 200, { grants: rows, mayGrantAdmin: true, ...(admin ? {} : { adminOnlyAreas: ORG_REACH_AREAS }) });
    }
    if (grants && method === "POST") {
      const parsed = grantBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "scope <area>:<read|write|admin> required" });
      const { scope, expiresAt } = parsed.data;
      if (expiresAt !== undefined && expiresAt <= now()) return json(res, 400, { error: "expiresAt is in the past" });
      if (scope.endsWith(":admin")) {
        if (!deps.isAdmin(auth) && !grantStaysInOwnEnvironment(scope)) {
          return json(res, 403, { error: "this access reaches past your own environment: only an admin can grant it", code: "org_scope_admin_only" });
        }
        if (expiresAt === undefined || expiresAt - now() > MAX_ADMIN_DAYS * 86_400_000) {
          return json(res, 400, { error: `an admin grant needs an expiry within ${MAX_ADMIN_DAYS} days`, code: "admin_expiry" });
        }
      }
      const subject = { kind: "bot" as const, id: bot.id };
      const row = deps.grants.grant(subject, scope, actor(auth), expiresAt);
      deps.audit("tool_grants.grant", auth, req, { id: row.id, subject, scope, ...(expiresAt ? { expiresAt } : {}) });
      return json(res, 201, { grant: row });
    }
    if (revoke && method === "POST") {
      const grantId = revoke[2]!;
      const row = deps.grants.all().find((g) => g.id === grantId);
      // Another bot's or a person's grant is not reachable from this bot.
      if (!row || row.subject.kind !== "bot" || row.subject.id !== bot.id) return json(res, 404, { error: "no active grant with that id" });
      if (!deps.grants.revoke(grantId, actor(auth))) return json(res, 404, { error: "no active grant with that id" });
      deps.audit("tool_grants.revoke", auth, req, { id: grantId, subject: row.subject });
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: "method not allowed" });
  };
}
