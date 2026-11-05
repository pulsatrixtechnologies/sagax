// claude.ai artifacts over HTTP (#2018). Every call runs through the
// session person's own Claude account, never another person's.
//
// The person's routes (request-auth.ts CLIENT_ALLOW):
//   GET  /api/claude-artifacts/summary?url=     {url,title,icon?,owned,updatedAt?,summary?} | {url,blocked,account?}
//   GET  /api/claude-artifacts/comments?url=    {threads}
//   POST /api/claude-artifacts/comments/reply   {url,threadId,text} -> {ok:true}
//   POST /api/claude-artifacts/comments/resolve {url,threadId}      -> {ok:true}
//   POST /api/claude-artifacts/copy             {url,botId,threadId?} -> {ok:true}
//   409 {error:"claude_not_signed_in"} when the person has no Claude login.
//
// The bot's tool claude_artifact (server/drivers/agents-call-claude-artifact.ts):
//   POST /api/internal/claude-artifact          {tool,input,html?,file?}
import { z } from "zod";

import type { RequestAuth } from "../auth/request-auth.ts";
import { claudeArtifactUrl, parseArtifactPublish } from "../../shared/claude-chat-blocks.ts";
import { noteArtifactPublished } from "../claude-artifacts/events.ts";
import { CLAUDE_ARTIFACT_TOOLS } from "../claude-artifacts/runner.ts";
import {
  actOnClaudeArtifactComment,
  ArtifactCallError,
  listClaudeArtifactComments,
  summarizeClaudeArtifact,
  type ArtifactSummaryCache,
  type PersonArtifactCall,
} from "../claude-artifacts/service.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const CLAUDE_ARTIFACT_PAGE_MAX = 2_000_000;

export interface ClaudeArtifactRouteDeps {
  /** The session person; undefined: no person (refused). */
  principalId(auth: RequestAuth): string | undefined;
  call: PersonArtifactCall;
  cache: ArtifactSummaryCache;
  /** Ask the person's bot to publish a copy from its own account. */
  copy?(auth: RequestAuth, botId: string, threadId: string | undefined, url: string): Promise<{ ok: true } | { status: number; error: string }>;
}

const replyBody = z.object({ url: z.string().max(300), threadId: z.string().min(1).max(200), text: z.string().min(1).max(4_000) }).strict();
const resolveBody = z.object({ url: z.string().max(300), threadId: z.string().min(1).max(200) }).strict();
const copyBody = z.object({ url: z.string().max(300), botId: z.string().min(1).max(100), threadId: z.string().min(1).max(200).optional() }).strict();

function failureStatus(error: unknown): { status: number; body: { error: string } } {
  if (error instanceof ArtifactCallError && error.unavailable) {
    return { status: 409, body: { error: error.unavailable === "not_signed_in" ? "claude_not_signed_in" : `claude_${error.unavailable}` } };
  }
  return { status: 502, body: { error: error instanceof Error ? error.message : String(error) } };
}

export function createClaudeArtifactRoutes(deps: ClaudeArtifactRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/claude-artifacts/")) return PASS;
    const principalId = deps.principalId(auth);
    if (!principalId) return json(res, 403, { error: "a signed-in person only" });
    res.setHeader("cache-control", "private, no-store");
    try {
      if (path === "/api/claude-artifacts/summary" || path === "/api/claude-artifacts/comments") {
        if (method !== "GET") return json(res, 405, { error: "GET only" });
        const target = claudeArtifactUrl(url.searchParams.get("url") ?? undefined);
        if (!target) return json(res, 400, { error: "url: a claude.ai artifact link" });
        if (path === "/api/claude-artifacts/comments") {
          return json(res, 200, { threads: await listClaudeArtifactComments(deps.call, principalId, target) });
        }
        const cached = deps.cache.get(principalId, target);
        if (cached) return json(res, 200, cached);
        const summary = await summarizeClaudeArtifact(deps.call, principalId, target);
        deps.cache.set(principalId, target, summary);
        return json(res, 200, summary);
      }
      if (method !== "POST") return json(res, 405, { error: "POST only" });
      if (path === "/api/claude-artifacts/comments/reply" || path === "/api/claude-artifacts/comments/resolve") {
        const reply = path.endsWith("/reply");
        const parsed = (reply ? replyBody : resolveBody).safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: reply ? "send { url, threadId, text }" : "send { url, threadId }" });
        const target = claudeArtifactUrl(parsed.data.url);
        if (!target) return json(res, 400, { error: "url: a claude.ai artifact link" });
        const text = "text" in parsed.data && typeof parsed.data.text === "string" ? parsed.data.text : undefined;
        const note = await actOnClaudeArtifactComment(deps.call, principalId, reply ? "reply" : "resolve", target, parsed.data.threadId, text);
        return json(res, 200, { ok: true, ...(note ? { note } : {}) });
      }
      if (path === "/api/claude-artifacts/copy") {
        if (!deps.copy) return json(res, 404, { error: "not found" });
        const parsed = copyBody.safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: "send { url, botId, threadId? }" });
        const target = claudeArtifactUrl(parsed.data.url);
        if (!target) return json(res, 400, { error: "url: a claude.ai artifact link" });
        const result = await deps.copy(auth, parsed.data.botId, parsed.data.threadId, target);
        return "ok" in result ? json(res, 200, { ok: true }) : json(res, result.status, { error: result.error });
      }
      return json(res, 404, { error: "not found" });
    } catch (error) {
      const failure = failureStatus(error);
      return json(res, failure.status, failure.body);
    }
  };
}

/** Input keys that name local files: the server sets file_path itself. */
const LOCAL_FILE_KEYS = ["file_path", "file_paths", "files", "root", "out_dir"] as const;

const internalBody = z.object({
  tool: z.enum(CLAUDE_ARTIFACT_TOOLS),
  input: z.record(z.string(), z.unknown()),
  html: z.string().max(CLAUDE_ARTIFACT_PAGE_MAX).optional(),
  file: z.string().min(1).max(1_000).optional(),
}).strict();

export function createClaudeArtifactInternalRoutes(deps: {
  call: PersonArtifactCall;
  /** The conversation belongs to this bot (connectorThread in index.ts). */
  ownsThread(botId: string, threadId: string): boolean;
  /** Who is speaking in this conversation: whose Claude account is used. */
  speaker(threadId: string): string | undefined;
  /** An absolute path inside the bot's workspace, or null. */
  workspaceFile(botId: string, file: string): string | null;
}): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== "/api/internal/claude-artifact") return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!deps.ownsThread(capability.botId, capability.threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const parsed = internalBody.safeParse(await readBody());
    if (!parsed.success) return json(res, 400, { error: "Send { tool: Artifact | ArtifactData | ArtifactComments, input, html?, file? }." });
    const { tool, input, html, file } = parsed.data;
    const named = LOCAL_FILE_KEYS.filter((key) => key in input);
    if (named.length) return json(res, 400, { error: `${named.join(", ")}: pass the page as html, or file (a path in your workspace).` });
    if (html !== undefined && file !== undefined) return json(res, 400, { error: "html or file, not both." });
    let staged: string | undefined;
    if (file !== undefined) {
      const resolved = deps.workspaceFile(capability.botId, file);
      if (!resolved) return json(res, 400, { error: "file: a file inside your workspace." });
      staged = resolved;
    }
    const principalId = deps.speaker(capability.threadId);
    if (!principalId) return json(res, 403, { error: "no person speaks in this conversation" });
    const result = await deps.call(principalId, tool, input, html !== undefined ? { html } : staged ? { file: staged } : undefined);
    if (!result.ok) {
      if ("unavailable" in result) {
        return json(res, 409, { error: result.unavailable === "not_signed_in"
          ? "claude_not_signed_in: the person has no Claude login in Sagax (Settings > Models, Claude)."
          : `claude_${result.unavailable}: no claude.ai account for this person.` });
      }
      if ("blocked" in result) return json(res, 200, { blocked: "other_account", ...(result.account ? { account: result.account } : {}) });
      return json(res, 502, { error: result.error });
    }
    if (tool === "Artifact" && input.action === "publish") {
      const page = parseArtifactPublish(result.result) ?? parseArtifactPublish(result.text);
      if (page?.url) {
        noteArtifactPublished({
          url: page.url, title: page.title, owned: page.owned ?? true,
          botId: capability.botId, threadId: capability.threadId, principalId,
        });
      }
    }
    return json(res, 200, { result: result.result, ...(typeof result.result === "string" ? {} : { text: result.text.slice(0, 20_000) }) });
  };
}
