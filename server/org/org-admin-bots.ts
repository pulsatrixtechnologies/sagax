// Bots (console design 4.3 and section 5): a bot's page, and the admin
// actions Clone, Archive, Restore, Transfer owner, Change model, Stop,
// Delete, the bulk variants, Download package and Import. Every write is
// audited with the console person as actor; the owner is told when someone
// else stopped or deleted their bot.
import type { IncomingMessage } from "node:http";

import { BOT_ZIP_MAX_BYTES, type BotZipPreview } from "../../shared/bot-zip.ts";
import type { BotCapabilities } from "../../shared/capabilities.ts";
import type { AdminBot, AdminBotReach, AdminPerson } from "./org-admin-routes.ts";
import {
  badRequest,
  ConsoleRefusal,
  fail,
  notFound,
  objectBody,
  ok,
  onlyKeys,
  type ConsoleAnswer,
  type ConsoleContext,
  type ConsoleRoute,
} from "./org-admin-console.ts";

/** The package format's own cap (shared/package-format.ts PACKAGE_MAX_BYTES). */
export const BOT_PACKAGE_MAX_BYTES = 4 * 1024 * 1024;
export const BOT_IMPORT_MAX_BODY = BOT_PACKAGE_MAX_BYTES + 64 * 1024;
export const BULK_MAX_IDS = 100;
const NAME_MAX = 80;

export interface BotDetail {
  threads: { count: number; lastAt: number | null };
  soul: { chars: number; summary: string | null };
  skills: Array<{ id: string; name: string; source: string | null }>;
  permissions: { approvalMode: string; fullAccess: boolean };
  routineList: Array<{ id: string; name: string; enabled: boolean; schedule: string }>;
}

export interface BotsDeps {
  bots(): Array<{ bot: AdminBot; reach: AdminBotReach }>;
  detail(botId: string): BotDetail | null;
  /** A person of the organization who may own a bot (known, not disabled). */
  owner(principalId: string): AdminPerson | null;
  ownerBySub(sub: string): AdminPerson | null;
  /** A copy for `ownerPrincipalId`: soul, skills, model and settings; no
   * threads, memory, grants or routines. Answers the new bot's id. */
  clone(botId: string, input: { ownerPrincipalId: string; name?: string }): Promise<string>;
  setArchived(botId: string, archived: boolean): void;
  /** The new owner owns it; grants kept, the old owner keeps `manage`. */
  transfer(botId: string, ownerPrincipalId: string): void;
  setModel(botId: string, input: { engineInstanceId?: string; model: string | null }): void;
  /** 2026-10-16: the bot's default level to Ask or Approve for me (never
   * Full, Custom or Edits from here); with `threads`, its conversations on
   * Ask follow to Auto (a conversation on another level keeps it). Throws a
   * ConsoleRefusal: 409 busy, 400 mode_not_supported. Answers the levels
   * before and after and the conversations it moved. */
  setApprovalMode?(botId: string, mode: "ask" | "auto", threads: boolean): { before: string; after: string; threadsMoved: string[] };
  stop(botId: string): Promise<void>;
  remove(botId: string): Promise<{ status: number; body: { ok?: boolean; error?: string } }>;
  notifyOwner(botId: string, action: "stop" | "delete", adminPrincipalId: string): void;
  /** The package document v2 of one bot, secrets redacted. */
  exportPackage(botId: string): { document: unknown; filename: string; redacted: string[]; skipped: unknown[] };
  importPackage(document: unknown, input: { ownerPrincipalId: string; name?: string }): Promise<{ botId: string; warnings: string[] }>;
  /** The bot as a sagax.bot zip (server/bot-zip.ts): its size before
   * compression and a writer that streams it. */
  exportZip?(botId: string, options: { conversations: boolean; sharing: boolean }): { filename: string; bytes: number; write(sink: (chunk: Buffer) => Promise<void>): Promise<{ bytes: number; redacted: number }> };
  /** A zip (or an older package file) uploaded as the request body: its
   * preview, or a new bot of `ownerPrincipalId`. */
  importZip?(request: IncomingMessage, input: { ownerPrincipalId: string; name?: string; conversations: boolean; sharing: boolean; preview: boolean }):
    Promise<{ preview: BotZipPreview } | { botId: string; warnings: string[] }>;
  /** 2026-10-11: the bot's uploaded picture (server/org/org-admin-look.ts
   * readBotAvatar): null when it has none, `too_large` past the cap. */
  avatar?(botId: string): { bytes: Buffer; type: string; version: string } | "too_large" | null;
  /** Capacités lot 1d (2026-10-30): the bot's one resolved list of
   * capabilities (shared/capabilities.ts, the same as
   * GET /api/bots/:id/capabilities) for the console person; null when the
   * bot or its engine is gone. Read only. */
  capabilities?(botId: string, viewer: { principalId: string; orgAdmin: boolean }): BotCapabilities | null;
}

type Find = { bot: AdminBot; reach: AdminBotReach } | null;

function find(ctx: ConsoleContext, deps: BotsDeps, botId: string): Find {
  const entry = deps.bots().find((candidate) => candidate.bot.id === botId) ?? null;
  return entry && ctx.botVisible(entry.reach) ? entry : null;
}

const botOf = (deps: BotsDeps, botId: string): AdminBot | null => deps.bots().find((candidate) => candidate.bot.id === botId)?.bot ?? null;

/** A name in a body: absent, or 1 to 80 characters. */
function nameField(value: unknown): string | undefined | ConsoleRefusal {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim() || value.trim().length > NAME_MAX) return new ConsoleRefusal(400, "bad_request", `name is 1 to ${NAME_MAX} characters.`);
  return value.trim();
}

/** The target owner, by `ownerPrincipalId` or `ownerSub` (the Perspicax
 * user id, how the console names people): absent means `fallback`; a
 * manager may only choose someone in their reach. */
function targetOwner(ctx: ConsoleContext, deps: BotsDeps, body: Record<string, unknown>, fallback: string): AdminPerson | ConsoleRefusal {
  const notFound = new ConsoleRefusal(404, "owner_not_found", "No such person to own the bot, or they are disabled.");
  if (body.ownerPrincipalId !== undefined && body.ownerSub !== undefined) return new ConsoleRefusal(400, "bad_request", "Send ownerPrincipalId or ownerSub, not both.");
  if (body.ownerSub !== undefined && body.ownerSub !== null) {
    if (typeof body.ownerSub !== "string" || !body.ownerSub || body.ownerSub.length > 256) return new ConsoleRefusal(400, "bad_request", "ownerSub is a Perspicax user id.");
    const bySub = deps.ownerBySub(body.ownerSub);
    return bySub && ctx.inReach(bySub.principalId) ? bySub : notFound;
  }
  const requested = body.ownerPrincipalId;
  const principalId = requested === undefined || requested === null ? fallback : requested;
  if (typeof principalId !== "string" || !principalId) return new ConsoleRefusal(400, "bad_request", "Name the owner: ownerSub (Perspicax user id) or ownerPrincipalId.");
  const person = deps.owner(principalId);
  if (!person || !ctx.inReach(person.principalId)) return notFound;
  return person;
}

type ActionName = "archive" | "restore" | "transfer" | "model" | "approvalMode";

/** One action on one bot, shared by the single routes and `bots/bulk`. */
function act(ctx: ConsoleContext, deps: BotsDeps, action: ActionName, botId: string, body: Record<string, unknown>): { bot: AdminBot } | ConsoleRefusal {
  const entry = find(ctx, deps, botId);
  if (!entry) return new ConsoleRefusal(404, "not_found", "No such bot.");
  const before = entry.bot;
  const target = { kind: "bot", id: before.id, name: before.name };
  try {
    if (action === "archive" || action === "restore") {
      const archived = action === "archive";
      if ((before.status === "archived") === archived) return { bot: before };
      deps.setArchived(botId, archived);
      ctx.record({ category: "bot", action: archived ? "bot.archive" : "bot.restore", target, changed: ["status"], before: { status: before.status }, after: { status: archived ? "archived" : "active" } });
    } else if (action === "transfer") {
      const owner = targetOwner(ctx, deps, body, "");
      if (owner instanceof ConsoleRefusal) return owner;
      if (owner.principalId === before.owner.principalId) return { bot: before };
      deps.transfer(botId, owner.principalId);
      ctx.record({ category: "bot", action: "bot.transfer", target, changed: ["owner"], before: { ownerPrincipalId: before.owner.principalId }, after: { ownerPrincipalId: owner.principalId } });
    } else if (action === "approvalMode") {
      if (!deps.setApprovalMode) return new ConsoleRefusal(404, "not_found", "This server does not change approval levels from the console.");
      const mode = body.mode;
      if (mode !== "auto" && mode !== "ask") return new ConsoleRefusal(400, "bad_request", "mode is auto or ask.");
      const changed = deps.setApprovalMode(botId, mode, body.threads === true);
      if (changed.before !== changed.after || changed.threadsMoved.length) {
        ctx.record({
          category: "approval", action: "approval.mode", target, changed: ["approvalMode"],
          before: { approvalMode: changed.before },
          after: { approvalMode: changed.after, ...(changed.threadsMoved.length ? { threads: changed.threadsMoved.length } : {}) },
        });
      }
    } else {
      const engine = body.engineInstanceId;
      const model = body.model;
      if ((engine !== undefined && (typeof engine !== "string" || !engine.trim() || engine.length > 80)) || (model !== null && (typeof model !== "string" || !model.trim() || model.length > 200))) {
        return new ConsoleRefusal(400, "bad_request", "Send { \"engineInstanceId\"?: an engine instance, \"model\": a model id or null }.");
      }
      deps.setModel(botId, { ...(typeof engine === "string" ? { engineInstanceId: engine.trim() } : {}), model: typeof model === "string" ? model.trim() : null });
      const after = botOf(deps, botId)!;
      ctx.record({ category: "bot", action: "bot.model", target, changed: ["model"], before: { engine: before.engine.instanceId, model: before.model }, after: { engine: after.engine.instanceId, model: after.model } });
    }
  } catch (error) {
    if (error instanceof ConsoleRefusal) return error;
    throw error;
  }
  return { bot: botOf(deps, botId)! };
}

const answerOf = (result: { bot: AdminBot } | ConsoleRefusal): ConsoleAnswer =>
  result instanceof ConsoleRefusal ? fail(result.status, result.code, result.message) : ok({ bot: result.bot });

/** "admin, or manager in reach": the route is open to managers, `find`
 * keeps them to their reach. */
function single(deps: BotsDeps, path: string, action: ActionName, keys: string[], check: (body: Record<string, unknown>) => string | null, min: "manager" | "admin", own = false): ConsoleRoute {
  return {
    method: "POST",
    path,
    min,
    ...(own ? { ownerGrant: "own-bot" as const } : {}),
    handle(ctx) {
      const body = objectBody(ctx.body ?? {});
      const extra = body ? onlyKeys(body, keys) : "Send a JSON object.";
      const invalid = extra ?? (body ? check(body) : null);
      if (!body || invalid) return badRequest(invalid ?? "Send a JSON object.");
      return answerOf(act(ctx, deps, action, ctx.params.id!, body));
    },
  };
}

/** `GET bots/{id}/capabilities` (Capacités lot 1d): read only, a manager
 * in reach, an admin, or the owner by the `own-bot` grant. */
function capabilitiesRoute(deps: BotsDeps, resolve: NonNullable<BotsDeps["capabilities"]>): ConsoleRoute {
  return {
    method: "GET",
    path: "bots/{id}/capabilities",
    min: "manager",
    ownerGrant: "own-bot",
    handle(ctx) {
      const entry = find(ctx, deps, ctx.params.id!);
      const list = entry ? resolve(entry.bot.id, { principalId: ctx.viewer.principalId, orgAdmin: ctx.viewer.orgAdmin }) : null;
      return list ? ok(list) : notFound("No such bot.");
    },
  };
}

export function botsRoutes(deps: BotsDeps): ConsoleRoute[] {
  const actionRoutes = [
    single(deps, "bots/{id}/archive", "archive", [], () => null, "manager", true),
    single(deps, "bots/{id}/restore", "restore", [], () => null, "manager", true),
    single(deps, "bots/{id}/transfer", "transfer", ["ownerPrincipalId", "ownerSub"], (body) => typeof body.ownerPrincipalId === "string" || typeof body.ownerSub === "string" ? null : "Send { \"ownerSub\": a Perspicax user id } or { \"ownerPrincipalId\" }.", "admin"),
    single(deps, "bots/{id}/model", "model", ["engineInstanceId", "model"], (body) => "model" in body ? null : "Send { \"engineInstanceId\"?: an engine instance, \"model\": a model id or null }.", "manager", true),
  ];
  return [
    {
      method: "GET",
      path: "bots/{id}",
      min: "manager",
      ownerGrant: "own-bot",
      handle(ctx) {
        const entry = find(ctx, deps, ctx.params.id!);
        const detail = entry ? deps.detail(entry.bot.id) : null;
        if (!entry || !detail) return notFound("No such bot.");
        return ok({ bot: { ...entry.bot, ...detail } });
      },
    },
    ...(deps.capabilities ? [capabilitiesRoute(deps, deps.capabilities)] : []),
    {
      // 2026-10-11: the picture `look.kind: "image"` names, for the gallery.
      method: "GET",
      path: "bots/{id}/avatar",
      min: "manager",
      ownerGrant: "own-bot",
      handle(ctx) {
        const entry = find(ctx, deps, ctx.params.id!);
        if (!entry) return notFound("No such bot.");
        const picture = deps.avatar?.(entry.bot.id) ?? null;
        if (picture === "too_large") return fail(413, "too_large", "This bot's picture is larger than the console serves.");
        if (!picture) return notFound("This bot has no picture.");
        const etag = `"${picture.version}"`;
        const headers = { etag, "cache-control": "private, no-cache", "x-content-type-options": "nosniff" };
        const asked = ctx.headers?.["if-none-match"];
        if (typeof asked === "string" && asked.split(",").map((tag) => tag.trim()).includes(etag)) return { status: 304, body: null, raw: "", headers };
        return { status: 200, body: null, raw: picture.bytes, headers: { ...headers, "content-type": picture.type, "content-length": String(picture.bytes.length) } };
      },
    },
    {
      method: "POST",
      path: "bots/{id}/clone",
      min: "manager",
      ownerGrant: "own-bot",
      async handle(ctx) {
        const body = objectBody(ctx.body ?? {});
        const extra = body ? onlyKeys(body, ["ownerPrincipalId", "ownerSub", "name"]) : "Send a JSON object.";
        if (!body || extra) return badRequest(extra ?? "Send a JSON object.");
        // Under the grant a copy stays the person's: an admin gives a bot away.
        if (ctx.ownOnly && ((body.ownerPrincipalId != null && body.ownerPrincipalId !== ctx.viewer.principalId) || (body.ownerSub != null && body.ownerSub !== ctx.viewer.sub))) {
          return fail(403, "forbidden_role", "A copy of your own bot stays yours; an admin gives a bot to someone else.");
        }
        const entry = find(ctx, deps, ctx.params.id!);
        if (!entry) return notFound("No such bot.");
        const name = nameField(body.name);
        if (name instanceof ConsoleRefusal) return fail(name.status, name.code, name.message);
        const owner = targetOwner(ctx, deps, body, entry.bot.owner.principalId);
        if (owner instanceof ConsoleRefusal) return fail(owner.status, owner.code, owner.message);
        const id = await deps.clone(entry.bot.id, { ownerPrincipalId: owner.principalId, ...(name ? { name } : {}) });
        const copy = botOf(deps, id)!;
        ctx.record({ category: "bot", action: "bot.clone", target: { kind: "bot", id: copy.id, name: copy.name }, after: { from: entry.bot.id, ownerPrincipalId: owner.principalId } });
        return ok({ bot: copy }, 201);
      },
    },
    ...actionRoutes,
    {
      method: "POST",
      path: "bots/{id}/stop",
      min: "admin",
      ownerGrant: "own-bot",
      async handle(ctx) {
        const body = objectBody(ctx.body ?? {});
        if (!body || onlyKeys(body, [])) return badRequest("Send {}.");
        const entry = find(ctx, deps, ctx.params.id!);
        if (!entry) return notFound("No such bot.");
        await deps.stop(entry.bot.id);
        ctx.record({ category: "bot", action: "bot.force_stop", target: { kind: "bot", id: entry.bot.id, name: entry.bot.name }, before: { ownerPrincipalId: entry.bot.owner.principalId } });
        if (entry.bot.owner.principalId !== ctx.viewer.principalId) deps.notifyOwner(entry.bot.id, "stop", ctx.viewer.principalId);
        return ok({ bot: botOf(deps, entry.bot.id) ?? entry.bot });
      },
    },
    {
      method: "POST",
      path: "bots/{id}/delete",
      min: "admin",
      ownerGrant: "own-bot",
      async handle(ctx) {
        const body = objectBody(ctx.body);
        const entry = find(ctx, deps, ctx.params.id!);
        if (!entry) return notFound("No such bot.");
        // The dialog names the bot; a stale list never deletes another one.
        if (!body || onlyKeys(body, ["confirm"]) || body.confirm !== entry.bot.name) {
          return fail(400, "confirm_required", "Send { \"confirm\": \"<the bot's name>\" }.");
        }
        try {
          await deps.stop(entry.bot.id);
        } catch {
          /* the delete still tries: the lifecycle refuses if work is left */
        }
        const removed = await deps.remove(entry.bot.id);
        if (removed.status !== 200) return fail(removed.status, removed.status === 409 ? "busy" : "refused", removed.body.error ?? "The bot could not be deleted.");
        ctx.record({ category: "bot", action: "bot.force_delete", target: { kind: "bot", id: entry.bot.id, name: entry.bot.name }, before: { ownerPrincipalId: entry.bot.owner.principalId } });
        if (entry.bot.owner.principalId !== ctx.viewer.principalId) deps.notifyOwner(entry.bot.id, "delete", ctx.viewer.principalId);
        return ok({ deleted: entry.bot.id });
      },
    },
    {
      method: "POST",
      path: "bots/bulk",
      min: "admin",
      handle(ctx) {
        const body = objectBody(ctx.body);
        const extra = body ? onlyKeys(body, ["action", "ids", "ownerPrincipalId", "ownerSub", "engineInstanceId", "model", "mode", "threads"]) : null;
        const action = body?.action;
        const ids = body?.ids;
        if (!body || extra || (action !== "archive" && action !== "restore" && action !== "transfer" && action !== "model" && action !== "approvalMode")
          || !Array.isArray(ids) || ids.length < 1 || ids.length > BULK_MAX_IDS || ids.some((id) => typeof id !== "string" || !id || id.length > 80) || new Set(ids).size !== ids.length) {
          return badRequest(extra ?? `Send { "action": "archive", "restore", "transfer", "model" or "approvalMode", "ids": 1 to ${BULK_MAX_IDS} distinct bot ids, and the action's fields }.`);
        }
        if (action === "transfer" && typeof body.ownerPrincipalId !== "string" && typeof body.ownerSub !== "string") return badRequest("transfer needs ownerSub or ownerPrincipalId.");
        if (action === "model" && !("model" in body)) return badRequest("model needs model (a model id or null).");
        // 2026-10-16: Ask or Approve for me only; Full and Custom need the
        // owner's own confirmation for that bot, never an admin's bulk.
        if (action === "approvalMode" && ((body.mode !== "auto" && body.mode !== "ask") || (body.threads !== undefined && typeof body.threads !== "boolean"))) {
          return badRequest("approvalMode needs mode \"auto\" or \"ask\", and optionally threads true or false.");
        }
        if (action !== "approvalMode" && (body.mode !== undefined || body.threads !== undefined)) return badRequest("mode and threads belong to approvalMode.");
        const fields = action === "transfer" ? (body.ownerSub !== undefined ? { ownerSub: body.ownerSub } : { ownerPrincipalId: body.ownerPrincipalId })
          : action === "model" ? { ...(body.engineInstanceId !== undefined ? { engineInstanceId: body.engineInstanceId } : {}), model: body.model }
            : action === "approvalMode" ? { mode: body.mode, threads: body.threads === true } : {};
        const results = (ids as string[]).map((id) => {
          const result = act(ctx, deps, action, id, fields);
          return result instanceof ConsoleRefusal ? { id, ok: false, code: result.code, message: result.message } : { id, ok: true };
        });
        return ok({ results });
      },
    },
    {
      method: "GET",
      path: "bots/{id}/package",
      min: "admin",
      ownerGrant: "own-bot",
      handle(ctx) {
        const entry = find(ctx, deps, ctx.params.id!);
        if (!entry) return notFound("No such bot.");
        const format = ctx.url.searchParams.get("format");
        if (format !== null && format !== "zip" && format !== "json") return badRequest("format is zip or json.");
        if (format === "zip") {
          if (!deps.exportZip) return fail(404, "not_found", "This server does not export bot zips.");
          const options = { conversations: ctx.url.searchParams.get("conversations") === "1", sharing: ctx.url.searchParams.get("sharing") === "1" };
          const zip = deps.exportZip(entry.bot.id, options);
          if (zip.bytes > BOT_ZIP_MAX_BYTES) return fail(413, "too_large", "This bot is larger than 512 MB. Export it without conversations.");
          return {
            status: 200,
            body: null,
            headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${zip.filename}"` },
            stream: async (write) => {
              const written = await zip.write(write);
              ctx.record({ category: "bot", action: "bot.export", target: { kind: "bot", id: entry.bot.id, name: entry.bot.name }, after: { format: "zip", bytes: written.bytes, redacted: written.redacted, ...options } });
            },
          };
        }
        const exported = deps.exportPackage(entry.bot.id);
        const text = JSON.stringify(exported.document);
        if (Buffer.byteLength(text) > BOT_PACKAGE_MAX_BYTES) return fail(413, "too_large", "This bot's package is larger than 4 MiB (its skills or pictures); it cannot be downloaded whole.");
        ctx.record({ category: "bot", action: "bot.export", target: { kind: "bot", id: entry.bot.id, name: entry.bot.name }, after: { bytes: Buffer.byteLength(text), redacted: exported.redacted.length } });
        return {
          status: 200,
          body: null,
          raw: text,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="${exported.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
            "x-sagax-package-redacted": String(exported.redacted.length),
          },
        };
      },
    },
    {
      method: "POST",
      path: "bots/import",
      min: "admin",
      maxBody: BOT_IMPORT_MAX_BODY,
      rawBody: BOT_ZIP_MAX_BYTES,
      async handle(ctx) {
        if (ctx.request) {
          // A file as the body (application/zip): the canonical bot zip, or
          // an older package file; the fields ride the query string.
          if (!deps.importZip) return fail(415, "unsupported", "Send the package as JSON.");
          const params = ctx.url.searchParams;
          const fields: Record<string, unknown> = {};
          for (const key of ["ownerPrincipalId", "ownerSub", "name"]) if (params.has(key)) fields[key] = params.get(key);
          const name = nameField(fields.name);
          if (name instanceof ConsoleRefusal) return fail(name.status, name.code, name.message);
          const owner = targetOwner(ctx, deps, fields, ctx.viewer.principalId);
          if (owner instanceof ConsoleRefusal) return fail(owner.status, owner.code, owner.message);
          const result = await deps.importZip(ctx.request, {
            ownerPrincipalId: owner.principalId, ...(name ? { name } : {}), preview: params.get("preview") === "1",
            conversations: params.get("conversations") === "1", sharing: params.get("sharing") === "1",
          });
          if ("preview" in result) return ok({ preview: result.preview });
          const bot = botOf(deps, result.botId)!;
          ctx.record({ category: "bot", action: "bot.import", target: { kind: "bot", id: bot.id, name: bot.name }, after: { format: "zip", ownerPrincipalId: owner.principalId, warnings: result.warnings.length } });
          return ok({ bot, warnings: result.warnings }, 201);
        }
        const body = objectBody(ctx.body);
        const extra = body ? onlyKeys(body, ["package", "ownerPrincipalId", "ownerSub", "name"]) : null;
        if (!body || extra || !body.package || typeof body.package !== "object") return badRequest(extra ?? "Send { \"package\": the package document, \"ownerPrincipalId\"? or \"ownerSub\"?, \"name\"? }.");
        if (Buffer.byteLength(JSON.stringify(body.package)) > BOT_PACKAGE_MAX_BYTES) return fail(413, "too_large", "The package is larger than 4 MiB.");
        const name = nameField(body.name);
        if (name instanceof ConsoleRefusal) return fail(name.status, name.code, name.message);
        const owner = targetOwner(ctx, deps, body, ctx.viewer.principalId);
        if (owner instanceof ConsoleRefusal) return fail(owner.status, owner.code, owner.message);
        const imported = await deps.importPackage(body.package, { ownerPrincipalId: owner.principalId, ...(name ? { name } : {}) });
        const bot = botOf(deps, imported.botId)!;
        ctx.record({ category: "bot", action: "bot.import", target: { kind: "bot", id: bot.id, name: bot.name }, after: { ownerPrincipalId: owner.principalId, warnings: imported.warnings.length } });
        return ok({ bot, warnings: imported.warnings }, 201);
      },
    },
  ];
}
