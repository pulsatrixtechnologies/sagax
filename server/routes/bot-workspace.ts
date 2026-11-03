// The persona editor's Files category (docs/bot-workspace.md): the bot's
// whole workspace as a tree, with when each file reaches the bot, its size
// against a budget, its dates and its last use; a download of any file;
// create / upload / rename / move / delete for any file or folder inside
// the bot folder (server/workspace/workspace-manage.ts). Markdown RULES.md and
// docs/<name>.md still read and save through /workspace/file and the
// memory journal. MEMORY.md and memory/ stay on the admin memory routes
// for their text editor, and are also reachable for delete/rename guards
// through workspace-manage.
//
// The same gate as the Soul edit (2026-10-09: members manage their own
// bots): an admin, the bot's owner, or someone granted edit on it; a person
// who may only use shared bots is refused. The scope rule
// (server/request-auth.ts CLIENT_ALLOW) lets a client session reach the
// handler; `mayEdit` decides.
import { basename } from "node:path";
import type { IncomingMessage } from "node:http";
import { z } from "zod";

import { readAtRestSync } from "../encryption/content-at-rest.ts";
import { MEMORY_MAX_BYTES, MEMORY_MAX_LINES, workspaceDir } from "../workspace/workspace.ts";
import {
  FORGOTTEN_AFTER_MS,
  RULES_MAX_BYTES,
  RULES_MAX_LINES,
  RULES_TEMPLATE,
  RULES_TOTAL_MAX_BYTES,
  RULES_TOTAL_MAX_LINES,
  SOUL_MAX_BYTES,
  WorkspacePathError,
  isForgotten,
  resolveWorkspaceFile,
  workspaceTree,
} from "../workspace/workspace-files.ts";
import {
  CORE_WORKSPACE_FILES,
  WORKSPACE_UPLOAD_MAX_BYTES,
  countWorkspaceFiles,
  createWorkspaceFile,
  createWorkspaceFolder,
  deleteWorkspaceEntry,
  renameWorkspaceEntry,
  writeWorkspaceBytes,
  type WorkspaceManageResult,
} from "../workspace/workspace-manage.ts";
import { MemoryStoreError, RULES_PATH, parseMemoryPath, readMemoryDoc } from "../memory/memory-store.ts";
import { journalMemoryDelete, journalMemoryWrite } from "../memory/memory-journal.ts";
import type { RequestAuth } from "../request-auth.ts";
import { renameDoc } from "../workspace/workspace-tools.ts";
import { workspaceUsage } from "../workspace/workspace-usage.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotWorkspaceRouteDeps {
  bot(id: string): { id: string; soul?: string; memoryEnabled?: boolean; updatedAt?: number | string; createdAt?: number | string } | null | undefined;
  /** Whether this caller may change the bot's Soul: admin, owner, or edit
   * grant, and not a use-only person. */
  mayEdit(auth: RequestAuth, botId: string): boolean;
  /** Wraps a write, as the memory routes do on a Cloud home. */
  ownersWrite?: <T>(auth: RequestAuth, botId: string, write: () => T) => T;
}

const FORBIDDEN = { error: "forbidden: only this bot's owner or an admin can change its rules and documents", code: "bot_documents_owner_only" };

/** RULES.md, rules/<set>.md or docs/<name>.md, nothing else: this route is reachable by a
 * member, and memory files stay an admin's. */
function rulesOrDoc(path: string | null): string | null {
  if (!path) return null;
  try {
    const ref = parseMemoryPath(path);
    return ref.kind === "rules" || ref.kind === "ruleset" || ref.kind === "doc" ? path : null;
  } catch {
    return null;
  }
}

function time(value: number | string | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function manageStatus(result: WorkspaceManageResult): number {
  if (result.ok) return 200;
  switch (result.code) {
    case "missing": return 404;
    case "exists": case "conflict": return 409;
    case "forbidden": return 403;
    case "too-large": return 413;
    case "not-empty": return 409;
    default: return 400;
  }
}

/** The body as bytes, or null past `max` (the rest is drained, not kept). */
function readBytes(req: IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > max) {
        over = true;
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on("error", reject);
  });
}

export function createBotWorkspaceRoutes(deps: BotWorkspaceRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const gate = path.match(/^\/api\/bots\/([\w-]+)\/workspace(?:\/|$)/);
    if (!gate) return PASS;
    if (!deps.bot(gate[1])) return json(res, 404, { error: "no such bot" });
    if (!deps.mayEdit(auth, gate[1])) return json(res, 403, FORBIDDEN);
    const write = <T>(botId: string, change: () => T): T => deps.ownersWrite ? deps.ownersWrite(auth, botId, change) : change();
    let m = path.match(/^\/api\/bots\/([\w-]+)\/workspace$/);
    if (m && method === "GET") {
      const bot = deps.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const now = Date.now();
      const usage = workspaceUsage(bot.id);
      const tree = workspaceTree(bot.id, { memoryEnabled: bot.memoryEnabled });
      const entries = tree.entries.map((entry) => {
        const lastUsedAt = usage[entry.path];
        return { ...entry, ...(lastUsedAt ? { lastUsedAt } : {}), forgotten: isForgotten(entry, lastUsedAt, now) };
      });
      // SOUL.md is on the bot record (its mirror sits outside the
      // workspace): listed first, opened in the Soul category.
      const soul = bot.soul ?? "";
      const soulBytes = Buffer.byteLength(soul.trim(), "utf8");
      return json(res, 200, {
        workspacePath: workspaceDir(bot.id),
        now,
        forgottenAfterDays: Math.round(FORGOTTEN_AFTER_MS / (24 * 60 * 60_000)),
        uploadMaxBytes: WORKSPACE_UPLOAD_MAX_BYTES,
        budgets: {
          rules: { maxLines: RULES_MAX_LINES, maxBytes: RULES_MAX_BYTES },
          rulesTotal: { maxLines: RULES_TOTAL_MAX_LINES, maxBytes: RULES_TOTAL_MAX_BYTES },
          memory: { maxLines: MEMORY_MAX_LINES, maxBytes: MEMORY_MAX_BYTES },
          soul: { maxBytes: SOUL_MAX_BYTES },
        },
        rulesTemplate: RULES_TEMPLATE,
        soul: {
          path: "SOUL.md",
          kind: "file",
          virtual: "soul",
          bytes: soulBytes,
          load: soulBytes ? "every-turn" : "never",
          editable: false,
          markdown: true,
          budget: { maxBytes: SOUL_MAX_BYTES, lines: 0, bytes: soulBytes, over: soulBytes > SOUL_MAX_BYTES },
          ...(time(bot.createdAt) ? { createdAt: time(bot.createdAt) } : {}),
          ...(time(bot.updatedAt) ? { modifiedAt: time(bot.updatedAt) } : {}),
          ...(usage["SOUL.md"] ? { lastUsedAt: usage["SOUL.md"] } : {}),
          forgotten: false,
        },
        entries,
        truncated: tree.truncated,
      });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/workspace\/download$/);
    if (m && method === "GET") {
      const bot = deps.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      try {
        const file = resolveWorkspaceFile(bot.id, url.searchParams.get("path") ?? "");
        if (file.stat.size > WORKSPACE_UPLOAD_MAX_BYTES) {
          return json(res, 413, { error: `${file.path} is over ${WORKSPACE_UPLOAD_MAX_BYTES / (1024 * 1024)} MB; open the workspace folder on the server instead.` });
        }
        const body = readAtRestSync(file.absolute);
        const name = basename(file.path).replace(/["\r\n]/g, "_");
        const lower = name.toLowerCase();
        const contentType =
          /\.md$/i.test(name) ? "text/markdown; charset=utf-8"
            : lower.endsWith(".pdf") ? "application/pdf"
              : /\.(png|jpe?g|gif|webp|svg)$/i.test(name) ? `image/${lower.endsWith(".jpg") ? "jpeg" : lower.slice(lower.lastIndexOf(".") + 1)}`
                : "application/octet-stream";
        res.writeHead(200, {
          "content-type": contentType,
          "content-length": String(body.length),
          "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(basename(file.path))}`,
          "x-content-type-options": "nosniff",
          "cache-control": "no-store",
        });
        res.end(body);
        return;
      } catch (error) {
        if (error instanceof WorkspacePathError) return json(res, error.status, { error: error.message });
        throw error;
      }
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/workspace\/file$/);
    if (m && (method === "GET" || method === "PUT" || method === "DELETE")) {
      const botId = m[1];
      const reply = (error: unknown) => {
        if (!(error instanceof MemoryStoreError)) throw error;
        return error.code === "conflict"
          ? json(res, error.status, { error: error.message, code: error.code, currentHash: error.currentHash, current: error.current })
          : json(res, error.status, { error: error.message, code: error.code });
      };
      if (method === "GET") {
        const file = rulesOrDoc(url.searchParams.get("path") ?? RULES_PATH);
        if (!file) return json(res, 400, { error: "path must be RULES.md, rules/<set>.md or docs/<name>.md" });
        try {
          return json(res, 200, readMemoryDoc(botId, file));
        } catch (error) {
          return reply(error);
        }
      }
      if (method === "DELETE") {
        const file = rulesOrDoc(url.searchParams.get("path"));
        if (!file) return json(res, 400, { error: "path must be RULES.md, rules/<set>.md or docs/<name>.md" });
        if (CORE_WORKSPACE_FILES.has(file)) return json(res, 400, { error: `${file} cannot be deleted.`, code: "forbidden" });
        try {
          write(botId, () => journalMemoryDelete(botId, file, { actor: "person", via: "ui" }));
          return json(res, 200, { ok: true, path: file });
        } catch (error) {
          return reply(error);
        }
      }
      const parsed = z.object({ path: z.string(), text: z.string(), expectedHash: z.string().optional() }).safeParse(await readBody(req));
      const file = parsed.success ? rulesOrDoc(parsed.data.path) : null;
      if (!parsed.success || !file) return json(res, 400, { error: "send { path: RULES.md, rules/<set>.md or docs/<name>.md, text, expectedHash? }" });
      try {
        const { doc } = write(botId, () => journalMemoryWrite(botId, file, parsed.data.text, { actor: "person", via: "ui", expectedHash: parsed.data.expectedHash }));
        return json(res, 200, { ok: true, ...doc });
      } catch (error) {
        return reply(error);
      }
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/workspace\/docs\/rename$/);
    if (m && method === "POST") {
      const bot = deps.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const parsed = z.object({ from: z.string(), to: z.string() }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "from and to are document paths (docs/<name>.md)" });
      const result = renameDoc(bot.id, parsed.data.from, parsed.data.to);
      if (!result.ok) return json(res, result.code === "exists" ? 409 : result.code === "missing" ? 404 : 400, { error: result.error, code: result.code });
      return json(res, 200, { ok: true, path: result.path });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/workspace\/mkdir$/);
    if (m && method === "POST") {
      const botId = m[1];
      const parsed = z.object({ path: z.string() }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "send { path }" });
      const result = write(botId, () => createWorkspaceFolder(botId, parsed.data.path));
      return json(res, manageStatus(result), result.ok ? { ok: true, path: result.path } : { error: result.error, code: result.code });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/workspace\/touch$/);
    if (m && method === "POST") {
      const botId = m[1];
      const parsed = z.object({ path: z.string(), text: z.string().optional() }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "send { path, text? }" });
      const result = write(botId, () => createWorkspaceFile(botId, parsed.data.path, parsed.data.text ?? ""));
      return json(res, manageStatus(result), result.ok ? { ok: true, path: result.path, bytes: result.bytes } : { error: result.error, code: result.code });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/workspace\/rename$/);
    if (m && method === "POST") {
      const botId = m[1];
      const parsed = z.object({ from: z.string(), to: z.string() }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "send { from, to }" });
      const result = write(botId, () => renameWorkspaceEntry(botId, parsed.data.from, parsed.data.to));
      return json(res, manageStatus(result), result.ok ? { ok: true, path: result.path } : { error: result.error, code: result.code });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/workspace\/entry$/);
    if (m && method === "DELETE") {
      const botId = m[1];
      const target = url.searchParams.get("path") ?? "";
      const recursive = url.searchParams.get("recursive") === "1" || url.searchParams.get("recursive") === "true";
      const result = write(botId, () => deleteWorkspaceEntry(botId, target, { recursive }));
      if (!result.ok) {
        return json(res, manageStatus(result), { error: result.error, code: result.code, ...(result.count !== undefined ? { count: result.count } : {}) });
      }
      return json(res, 200, { ok: true, path: result.path, removed: result.removed });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/workspace\/count$/);
    if (m && method === "GET") {
      const botId = m[1];
      try {
        const target = url.searchParams.get("path") ?? "";
        return json(res, 200, { path: target, count: countWorkspaceFiles(botId, target) });
      } catch (error) {
        if (error instanceof WorkspacePathError) return json(res, error.status, { error: error.message });
        throw error;
      }
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/workspace\/upload$/);
    if (m && method === "POST") {
      const botId = m[1];
      const target = url.searchParams.get("path") ?? "";
      const overwrite = url.searchParams.get("overwrite") === "1" || url.searchParams.get("overwrite") === "true";
      if (!target) return json(res, 400, { error: "path query is required" });
      const bytes = await readBytes(req, WORKSPACE_UPLOAD_MAX_BYTES);
      if (bytes === null) return json(res, 413, { error: `File is over ${Math.round(WORKSPACE_UPLOAD_MAX_BYTES / (1024 * 1024))} MB.`, code: "too-large" });
      const result = write(botId, () => writeWorkspaceBytes(botId, target, bytes, { overwrite }));
      return json(res, manageStatus(result), result.ok ? { ok: true, path: result.path, bytes: result.bytes } : { error: result.error, code: result.code });
    }
    return PASS;
  };
}
