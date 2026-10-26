// Tailcat remote-support sessions for the person who owns the conversation.
// The tunnel address never enters a request body or a JSON answer.
import type { ServerResponse } from "node:http";
import { z } from "zod";

import {
  parseRemoteSessionCode,
  parseRemoteSessionEnd,
  parseRemoteSessionId,
  parseRemoteSessionOs,
  publicText,
  safeRemotePath,
  safeUploadName,
} from "../../shared/remote-session.ts";
import { PASS } from "./table.ts";
import type { RouteHandler } from "./table.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { PublishRemoteSession, RemoteSessionService } from "../remote-sessions.ts";
import { remoteCallerIsAgent } from "./remote-session-files.ts";
import { consumeRemoteExecApproval, remoteCommandReadOnly } from "../remote-session-exec.ts";

const LIST = /^\/api\/bots\/([\w-]{1,80})\/remote-sessions$/;
const ONE = /^\/api\/bots\/([\w-]{1,80})\/remote-sessions\/([a-f0-9]{12})(?:\/(close|focus|shell|upload|download|screen|os))?$/;
const UPLOAD_JSON_MAX = 12_000_000;

const publishBody = z.object({
  flow_session_id: z.string(),
  code: z.string(),
  os: z.enum(["windows", "macos", "linux"]),
  rights: z.enum(["standard", "elevated"]),
  end_at: z.string(),
  hostname: z.string().max(200).optional(),
  user: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  serial: z.string().max(200).optional(),
  cpu: z.string().max(200).optional(),
  ram: z.string().max(80).optional(),
  disk: z.string().max(200).optional(),
  os_name: z.string().max(200).optional(),
}).strict();

const execBody = z.object({
  session: z.string().max(20).optional(),
  command: z.string().max(8000).optional(),
  timeout_seconds: z.number().int().min(1).max(120).optional(),
}).strict();

export function parsePublishBody(body: unknown, now: number): { error: string } | { value: Omit<PublishRemoteSession, "botId" | "threadId" | "principalId"> } {
  const parsed = publishBody.safeParse(body);
  if (!parsed.success) return { error: "Send flow_session_id, code, os, rights and end_at. Do not send an address or a key." };
  const id = parseRemoteSessionId(parsed.data.flow_session_id);
  const code = parseRemoteSessionCode(parsed.data.code);
  const os = parseRemoteSessionOs(parsed.data.os);
  if (!id || !code || !os) return { error: "flow_session_id must be 12 hex, code a 6-character support code, and os windows, macos or linux." };
  const end = parseRemoteSessionEnd(parsed.data.end_at, now);
  if (end === null) return { error: "end_at must be an ISO-8601 time within the next day." };
  const fact = (value: string | undefined) => publicText(value);
  return {
    value: {
      id,
      code,
      os,
      elevated: parsed.data.rights === "elevated",
      endAt: new Date(end).toISOString(),
      facts: {
        hostname: fact(parsed.data.hostname),
        user: fact(parsed.data.user),
        model: fact(parsed.data.model),
        serial: fact(parsed.data.serial),
        cpu: fact(parsed.data.cpu),
        ram: fact(parsed.data.ram),
        disk: fact(parsed.data.disk),
        osName: fact(parsed.data.os_name),
      },
    },
  };
}

function filenameOf(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120);
  return cleaned.replace(/^\.+/, "") || "download";
}

function sendBytes(res: ServerResponse, status: number, type: string, body: Buffer, filename?: string) {
  const headers: Record<string, string> = { "content-type": type, "cache-control": "no-store" };
  if (filename) headers["content-disposition"] = `attachment; filename="${filenameOf(filename)}"`;
  res.writeHead(status, headers);
  res.end(body);
}

export function createRemoteSessionRoutes(deps: {
  sessions: RemoteSessionService;
  principalId(auth: RequestAuth): string | undefined;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody: readJson }) => {
    const list = LIST.exec(path);
    const one = ONE.exec(path);
    if (!list && !one) return PASS;
    const principalId = deps.principalId(auth);
    if (!principalId) return json(res, 401, { error: "Sign in to use a remote session." });
    const botId = (list ?? one)![1]!;
    if (list) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      return json(res, 200, { sessions: deps.sessions.list(principalId, botId) });
    }
    const id = one![2]!;
    const action = one![3];
    if (!action && method === "GET") return json(res, 200, { session: deps.sessions.list(principalId, botId).find((row) => row.id === id) ?? null });
    if (action === "close" && method === "POST") {
      const session = await deps.sessions.close(principalId, botId, id);
      if (!session) return json(res, 404, { error: "That remote session is not open." });
      return json(res, 200, { session });
    }
    if (action === "focus" && method === "POST") {
      const session = deps.sessions.focus(principalId, botId, id);
      if (!session) return json(res, 404, { error: "That remote session is not open." });
      return json(res, 200, { session });
    }
    if (action === "shell" && method === "POST") {
      const opened = await deps.sessions.openShell({ principalId, botId, threadId: "", id });
      if (!opened) return json(res, 404, { error: "That remote session is not open." });
      if ("error" in opened) return json(res, 409, { error: opened.error });
      return json(res, 200, { hostLabel: opened.hostLabel, messageId: opened.messageId });
    }
    if (action === "upload" && method === "POST") {
      let body: { name?: unknown; dataBase64?: unknown; dir?: unknown; overwrite?: unknown };
      try {
        body = await readJson(req, UPLOAD_JSON_MAX);
      } catch (error) {
        const status = (error as { status?: number }).status ?? 400;
        return json(res, status, { error: status === 413 ? "The file must be under 8 MB." : "Choose a file to send." });
      }
      const name = safeUploadName(body.name);
      const data = typeof body.dataBase64 === "string" ? body.dataBase64 : "";
      if (!name || !data || data.length > UPLOAD_JSON_MAX) return json(res, 400, { error: "Choose a simple file name and a file under 8 MB." });
      let bytes: Buffer;
      try {
        bytes = Buffer.from(data, "base64");
      } catch {
        return json(res, 400, { error: "Choose a file to send." });
      }
      // the folder chosen in the remote file browser (checked by the service),
      // and overwrite: the person confirmed replacing a file already there
      if (body.dir !== undefined && typeof body.dir !== "string") return json(res, 400, { error: "That folder cannot receive a file." });
      if (body.overwrite !== undefined && typeof body.overwrite !== "boolean") return json(res, 400, { error: "overwrite must be true or false." });
      if (remoteCallerIsAgent(req, auth) && (body.dir !== undefined || body.overwrite === true)) {
        return json(res, 403, { error: "A bot sends files only to the transfer folder and never replaces one. Ask the person to choose another folder in the remote session card." });
      }
      const sent = await deps.sessions.upload(principalId, botId, id, name, bytes, {
        ...(body.dir !== undefined ? { dir: body.dir } : {}),
        ...(body.overwrite === true ? { overwrite: true } : {}),
      });
      if ("error" in sent) {
        if (sent.code === "sensitive") return json(res, 403, { error: sent.error, code: "sensitive" });
        if (sent.code === "exists") return json(res, 409, { error: sent.error, code: "exists" });
        return json(res, 409, { error: sent.error });
      }
      return json(res, 200, sent);
    }
    if (action === "download" && method === "POST") {
      const body = z.object({ path: z.string().max(500) }).strict().safeParse(await readJson(req));
      if (!body.success || !safeRemotePath(body.data.path)) return json(res, 400, { error: "That path cannot be downloaded." });
      const file = await deps.sessions.download(principalId, botId, id, body.data.path);
      if ("error" in file) return json(res, 409, { error: file.error });
      return sendBytes(res, 200, "application/octet-stream", file.bytes, file.name);
    }
    if (action === "screen" && method === "GET") {
      const png = await deps.sessions.screen(principalId, botId, id);
      if (!png) {
        // the card says why (view.inventory, headless, screenDenied)
        const view = deps.sessions.list(principalId, botId).find((row) => row.id === id) ?? null;
        return json(res, 404, { error: "The screen is not available.", ...(view ? { session: view } : {}) });
      }
      return sendBytes(res, 200, "image/png", png);
    }
    if (action === "os" && method === "POST") {
      // the technician names the OS the computer could not (or told wrong)
      const body = z.object({ os: z.enum(["windows", "macos", "linux"]) }).strict().safeParse(await readJson(req));
      if (!body.success) return json(res, 400, { error: "os must be windows, macos or linux." });
      const session = await deps.sessions.setOs(principalId, botId, id, body.data.os);
      if (!session) return json(res, 404, { error: "That remote session is not open." });
      return json(res, 200, { session });
    }
    return json(res, 405, { error: "method not allowed" });
  };
}

export function createRemoteSessionInternalRoutes(deps: {
  sessions: RemoteSessionService;
  ownsThread(botId: string, threadId: string): boolean;
  /** The person speaking in this turn (the Perspicax credentials' owner).
   * The session row goes to them, never to the conversation's owner. */
  speaker?(threadId: string): string | undefined;
  now?: () => number;
  /** The person's yes for this exact command (server/remote-session-exec.ts). Tests inject it. */
  consumeApproval?(threadId: string, command: string): boolean;
}): InternalRouteHandler {
  const now = deps.now ?? (() => Date.now());
  return async ({ res, path, method, json, capability, readBody: readJson }) => {
    if (path === "/api/internal/remote-sessions/exec" || path === "/api/internal/remote-sessions/snapshot") {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      if (!deps.ownsThread(capability.botId, capability.threadId)) {
        return json(res, 403, { error: "source conversation does not belong to sender" });
      }
      // the person speaking: a session is theirs, never the conversation owner's
      const principalId = deps.speaker
        ? deps.speaker(capability.threadId)?.trim().toLowerCase()
        : deps.sessions.principalFor(capability.botId, capability.threadId);
      if (!principalId) return json(res, 403, { error: "No person speaks in this turn, so no remote session is theirs." });
      const parsed = execBody.safeParse(await readJson());
      if (!parsed.success) return json(res, 400, { error: "Send session (optional) and, for exec, command and timeout_seconds (optional)." });
      const target = { principalId, botId: capability.botId, threadId: capability.threadId, ...(parsed.data.session ? { id: parsed.data.session } : {}) };
      // A second check behind the approval hook (review of #965): a command
      // that does more than read, by the session's own OS, runs only after
      // the person allowed that exact command in this conversation, once.
      if (!path.endsWith("/snapshot") && parsed.data.command
        && !remoteCommandReadOnly(parsed.data.command, deps.sessions.osFor(target))
        && !(deps.consumeApproval ?? consumeRemoteExecApproval)(capability.threadId, parsed.data.command)) {
        return json(res, 403, { error: "This command changes the remote computer and the person has not allowed it. Call remote_session_exec again so Sagax asks them; never work around the card." });
      }
      const result = path.endsWith("/snapshot")
        ? await deps.sessions.snapshot(target)
        : parsed.data.command
          ? await deps.sessions.exec({ ...target, command: parsed.data.command, ...(parsed.data.timeout_seconds ? { timeoutMs: parsed.data.timeout_seconds * 1000 } : {}) })
          : { error: "command: the command line to run on the remote computer." };
      if ("error" in result) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }
    if (path !== "/api/internal/remote-sessions/publish") return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!deps.ownsThread(capability.botId, capability.threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const principalId = deps.speaker
      ? deps.speaker(capability.threadId)?.trim().toLowerCase()
      : deps.sessions.principalFor(capability.botId, capability.threadId);
    if (!principalId) return json(res, 403, { error: "No person speaks in this turn, so the remote session has no owner." });
    const parsed = parsePublishBody(await readJson(), now());
    if ("error" in parsed) return json(res, 400, { error: parsed.error });
    try {
      const published = await deps.sessions.publish({
        ...parsed.value,
        botId: capability.botId,
        threadId: capability.threadId,
        principalId,
      });
      const host = published.view.hostname || published.view.code;
      return json(res, 200, {
        ok: true,
        hostLabel: host,
        code: published.view.code,
        reachable: published.reachable,
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 403) return json(res, 403, { error: "That remote session belongs to someone else." });
      if (status === 409) return json(res, 409, { error: "That remote session was closed. Open a new one with remote_support_open." });
      return json(res, 500, { error: "The remote session card could not be posted." });
    }
  };
}
