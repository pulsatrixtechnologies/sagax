// A bot as one zip (server/bots/bot-zip.ts, docs/bot-package.md).
//
//   GET    /api/bots/:id/export.zip?conversations=1&sharing=1
//          The whole bot, streamed. The owner, a person who manages the bot
//          or an organization admin. Audited bot.export.
//   POST   /api/bots/import/upload        body: the file (zip or an older package)
//          { id, preview }: staged for 30 minutes, for this person only.
//   POST   /api/bots/import/:id/preview   { name? }   { preview }
//   POST   /api/bots/import/:id           { name?, conversations?, sharing? }
//          201 { botId, name, warnings }. Audited bot.import.
//   DELETE /api/bots/import/:id           forget a staged file
//   GET    /api/bots/import/agent         { prompt }: the export prompt to send to the person's bot on x.ai
//   POST   /api/bots/import/agent         { text, timeZone? }: that bot's reply, made into a Sagax
//          package here (shared/grok-import.ts) and staged like an upload:
//          { id, preview, leftOut }. For the phone, which has no copy of the
//          converter; the desktop makes the package itself (AgentImport.tsx).
//          { marketplace: slug, timeZone? } instead: a bot of the xAI Bot
//          Marketplace (shared/xai-marketplace.ts), read on the server and
//          made into a package the same way.
//
// Import needs the right to create bots. An organization member's copy
// drops host settings (memberImportReset). Member scope (request-auth.ts
// CLIENT_ALLOW); every rule is checked here.
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BOT_ZIP_MAX_BYTES, type BotZipExportOptions } from "../../shared/bot-zip.ts";
import {
  BotZipError,
  closeInspected,
  importBotZip,
  inspectBotZip,
  planBotZip,
  previewBotZip,
  stageBotZipUpload,
  writeBotZip,
  type BotZipHost,
} from "../bots/bot-zip.ts";
import { GROK_EXPORT_PROMPT, GrokImportError, grokExportToPackage, parseGrokExport } from "../../shared/grok-import.ts";
import { xaiMarketplaceToPackage, type XaiMarketplaceBot } from "../../shared/xai-marketplace.ts";
import { XaiMarketplaceError } from "../plugins/xai-marketplace.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const BOT_ZIP_STAGE_MS = 30 * 60 * 1000;
const STAGED_PER_PERSON = 4;

export interface BotZipImporter {
  /** Who owns the copy (undefined: the operator of a solo server). */
  principalId: string | undefined;
  /** The key a staged file belongs to (a person, or the local operator). */
  key: string;
  canCreate: boolean;
  /** An organization member, not an admin: host settings are dropped. */
  asMember: boolean;
}

export interface BotZipAuditRow {
  action: "bot.export" | "bot.import";
  target: { kind: "bot"; id: string; name: string };
  after?: Record<string, unknown>;
}

export interface BotZipRouteDeps {
  host: BotZipHost;
  stagingDir: string;
  mayExport(auth: RequestAuth, botId: string): boolean;
  importer(auth: RequestAuth): BotZipImporter | null;
  audit(auth: RequestAuth, row: BotZipAuditRow): void;
  /** After an import: tell the clients about the new bot. */
  imported?(botId: string): void;
  /** The new bot as the client sees it, for the import's answer. */
  wireBot?(botId: string): unknown;
  /** A bot of the xAI Bot Marketplace (server/plugins/xai-marketplace.ts), for the phone's import. */
  xaiMarketplaceBot?(slug: string): Promise<XaiMarketplaceBot>;
  now?(): number;
}

interface Staged {
  key: string;
  path: string;
  expires: number;
}

const ROUTE = /^\/api\/bots\/(?:([\w-]+)\/export\.zip|import\/(upload|agent|[0-9a-f-]{36})(?:\/(preview))?)$/;
const AGENT_TEXT_MAX = 4 * 1024 * 1024;

function flag(value: string | null): boolean {
  return value === "1" || value === "true";
}

export function createBotZipRoutes(deps: BotZipRouteDeps): RouteHandler {
  const now = () => deps.now?.() ?? Date.now();
  const staged = new Map<string, Staged>();
  mkdirSync(deps.stagingDir, { recursive: true, mode: 0o700 });
  // A restart forgets staged files: clear what an earlier run left.
  try {
    for (const name of readdirSync(deps.stagingDir)) rmSync(join(deps.stagingDir, name), { force: true });
  } catch { /* nothing to clear */ }
  const sweep = () => {
    for (const [id, entry] of staged) {
      if (entry.expires > now()) continue;
      staged.delete(id);
      rmSync(entry.path, { force: true });
    }
  };
  const fail = (error: unknown, json: (res: import("node:http").ServerResponse, status: number, body: unknown) => void, res: import("node:http").ServerResponse) => {
    if (error instanceof BotZipError) return json(res, error.status, { error: error.message, code: error.code });
    const status = (error as { status?: unknown })?.status;
    if (typeof status === "number" && status >= 400 && status < 500) return json(res, status, { error: error instanceof Error ? error.message : "Refused." });
    throw error;
  };

  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const match = ROUTE.exec(path);
    if (!match) return PASS;
    const [, exportId, importId, preview] = match;
    res.setHeader("cache-control", "private, no-store");
    sweep();

    if (exportId) {
      if (method !== "GET") return json(res, 405, { error: "GET only" });
      const bot = deps.host.store.bot(exportId);
      if (!bot || !deps.mayExport(auth, bot.id)) return json(res, 404, { error: "No such bot." });
      const options: BotZipExportOptions = { conversations: flag(url.searchParams.get("conversations")), sharing: flag(url.searchParams.get("sharing")) };
      let plan;
      try {
        plan = planBotZip(deps.host, bot.id, options);
        if (plan.bytes > BOT_ZIP_MAX_BYTES) throw new BotZipError("This bot is larger than 512 MB. Export it without conversations, or remove large files from its folder.", "too_large", 413);
      } catch (error) {
        return fail(error, json, res);
      }
      res.writeHead(200, {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${plan.filename}"`,
        "x-content-type-options": "nosniff",
      });
      const sink = (chunk: Buffer) => new Promise<void>((resolve, reject) => {
        if (res.destroyed) { reject(new Error("The download was cancelled.")); return; }
        if (res.write(chunk)) resolve();
        else res.once("drain", resolve);
      });
      try {
        const written = await writeBotZip(plan, sink);
        res.end();
        deps.audit(auth, { action: "bot.export", target: { kind: "bot", id: bot.id, name: bot.name },
          after: { bytes: written.bytes, redacted: written.redacted, conversations: options.conversations, sharing: options.sharing } });
      } catch (error) {
        console.warn(`[bot-zip] export of ${bot.id} stopped: ${error instanceof Error ? error.message : String(error)}`);
        res.destroy();
      }
      return;
    }

    const importer = deps.importer(auth);
    if (!importer) return json(res, 403, { error: "forbidden: importing a bot is for a person", code: "import_bot_person_only" });
    if (!importer.canCreate) return json(res, 403, { error: "You cannot create bots on this server.", code: "bots_read_only" });

    if (importId === "agent" && !preview) {
      if (method === "GET") return json(res, 200, { prompt: GROK_EXPORT_PROMPT });
      if (method !== "POST") return json(res, 405, { error: "GET or POST only" });
      const body = await readBody(req, AGENT_TEXT_MAX + 4_096).catch(() => null) as { text?: unknown; timeZone?: unknown; marketplace?: unknown } | null;
      const timeZone = typeof body?.timeZone === "string" ? body.timeZone : undefined;
      const marketplace = typeof body?.marketplace === "string" ? body.marketplace.trim() : "";
      if (!marketplace && (typeof body?.text !== "string" || !body.text.trim())) return json(res, 400, { error: "Paste the reply your bot on x.ai wrote." });
      let made;
      try {
        if (marketplace) {
          if (!deps.xaiMarketplaceBot) return json(res, 404, { error: "The xAI Bot Marketplace is not offered here.", code: "xai_not_found" });
          made = xaiMarketplaceToPackage(await deps.xaiMarketplaceBot(marketplace), { timeZone });
        } else {
          made = grokExportToPackage(parseGrokExport(body!.text as string), { timeZone });
        }
      } catch (error) {
        if (error instanceof XaiMarketplaceError) return json(res, error.status, { error: error.message, code: error.code });
        if (error instanceof GrokImportError) return json(res, 400, { error: error.message, code: "invalid_export" });
        throw error;
      }
      const id = randomUUID();
      const file = join(deps.stagingDir, `${id}.upload`);
      try {
        writeFileSync(file, JSON.stringify(made.document), { mode: 0o600, flag: "wx" });
        const inspected = inspectBotZip(file);
        try {
          const answer = await previewBotZip(deps.host, inspected, { asMember: importer.asMember });
          staged.set(id, { key: importer.key, path: file, expires: now() + BOT_ZIP_STAGE_MS });
          return json(res, 200, { id, preview: answer, leftOut: made.leftOut });
        } finally {
          closeInspected(inspected);
        }
      } catch (error) {
        rmSync(file, { force: true });
        return fail(error, json, res);
      }
    }

    if (importId === "upload") {
      if (method !== "POST") return json(res, 405, { error: "POST only" });
      const mine = [...staged.entries()].filter(([, entry]) => entry.key === importer.key);
      for (const [id, entry] of mine.slice(0, Math.max(0, mine.length - STAGED_PER_PERSON + 1))) {
        staged.delete(id);
        rmSync(entry.path, { force: true });
      }
      const id = randomUUID();
      const file = join(deps.stagingDir, `${id}.upload`);
      try {
        await stageBotZipUpload(req, file);
        const inspected = inspectBotZip(file);
        try {
          const answer = await previewBotZip(deps.host, inspected, { asMember: importer.asMember });
          staged.set(id, { key: importer.key, path: file, expires: now() + BOT_ZIP_STAGE_MS });
          return json(res, 200, { id, preview: answer });
        } finally {
          closeInspected(inspected);
        }
      } catch (error) {
        rmSync(file, { force: true });
        return fail(error, json, res);
      }
    }

    const entry = staged.get(importId!);
    if (!entry || entry.key !== importer.key) return json(res, 404, { error: "This file is no longer staged. Choose it again.", code: "not_staged" });
    if (method === "DELETE" && !preview) {
      staged.delete(importId!);
      rmSync(entry.path, { force: true });
      return json(res, 200, { ok: true });
    }
    if (method !== "POST") return json(res, 405, { error: "POST or DELETE" });
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return json(res, 415, { error: "content-type must be application/json" });
    const raw = await readBody(req, 4_096);
    const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const allowed = preview ? ["name"] : ["name", "conversations", "sharing"];
    const extra = Object.keys(body).find((key) => !allowed.includes(key));
    if (extra) return json(res, 400, { error: `Unknown field ${extra}.` });
    let name: string | undefined;
    if (body.name !== undefined && body.name !== null) {
      if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100) return json(res, 400, { error: "name is 1 to 100 characters." });
      name = body.name.trim();
    }
    if ((body.conversations !== undefined && typeof body.conversations !== "boolean") || (body.sharing !== undefined && typeof body.sharing !== "boolean")) {
      return json(res, 400, { error: "conversations and sharing are true or false." });
    }
    let inspected;
    try {
      statSync(entry.path);
      inspected = inspectBotZip(entry.path);
    } catch (error) {
      staged.delete(importId!);
      rmSync(entry.path, { force: true });
      return fail(error, json, res);
    }
    try {
      if (preview) return json(res, 200, { preview: await previewBotZip(deps.host, inspected, { asMember: importer.asMember }, name) });
      const result = await importBotZip(deps.host, inspected, {
        ownerPrincipalId: importer.principalId, asMember: importer.asMember, ...(name ? { name } : {}),
        conversations: body.conversations === true, sharing: body.sharing === true,
      });
      staged.delete(importId!);
      rmSync(entry.path, { force: true });
      deps.audit(auth, { action: "bot.import", target: { kind: "bot", id: result.botId, name: result.name },
        after: { from: inspected.kind === "zip" ? inspected.manifest.bot.id : "package", kind: inspected.kind, conversations: body.conversations === true, sharing: body.sharing === true, memberDefaults: importer.asMember, warnings: result.warnings.length } });
      deps.imported?.(result.botId);
      const bot = deps.wireBot?.(result.botId);
      return json(res, 201, { ...result, ...(bot ? { bot } : {}) });
    } catch (error) {
      return fail(error, json, res);
    } finally {
      closeInspected(inspected);
    }
  };
}
