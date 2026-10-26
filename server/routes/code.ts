// The desktop's « Code » section (2026-10-18, lot P1.7,
// docs/superpowers/specs/2026-10-18-code-section-design.md): every
// Perspicax run of the signed-in person, whatever bot or origin started it,
// and what one run did (its conversation, diff, commits, files), live.
//
// Sagax is a client here: each call goes to Perspicax's `/api/v1/agents`
// with this server's link token and the viewer's own sign-in token as the
// subject (PerspicaxAgentsClient), and Perspicax
// decides what they see and may do (scope, quotas, approvals). Nothing is
// cached on this server but the local records of runs a bot launched from a
// conversation (server/cloud-agents/store.ts), which these routes refresh so
// the conversation's card follows.
//
//   GET  /api/code/status                     available, or why not (solo: Sagax Business;
//                                             not_available: Perspicax without the agents API)
//   GET  /api/code/environments
//   GET  /api/code/runs                       ?mine, newest first, archived left out
//   POST /api/code/runs                       { env_id, prompt, engine?, model?, title? }
//   GET  /api/code/runs/:id                   ...and /events?after=, /stream?after= (SSE, Last-Event-ID too)
//   POST /api/code/runs/:id/(read|followup|approve|stop|archive)
//   GET  /api/code/runs/:id/(diff|commits|files)
import type { ServerResponse } from "node:http";

import { RUN_ENGINES, type PerspicaxRun } from "../../shared/cloud-agents.ts";
import { SAGAX_BUSINESS_URL, type CodeRun, type CodeSubscription, type CodeStatus, type CodeUnavailableReason, type FollowUpMode } from "../../shared/code-runs.ts";
import type { CloudAgentManager } from "../cloud-agents/manager.ts";
import type { PerspicaxAccess, PerspicaxAgentsClient } from "../cloud-agents/perspicax-client.ts";
import { ProviderHttpError } from "../cloud-agents/providers/http.ts";
import { personalEnvironment, type PersonalSubscriptions } from "../cloud-agents/providers/perspicax.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export type CodeAccess =
  | { ok: true; access: PerspicaxAccess; principalId: string }
  | { ok: false; reason: CodeUnavailableReason };

export interface CodeRouteDeps {
  /** The person's Perspicax access, or why there is none. */
  access: (auth: RequestAuth) => Promise<CodeAccess>;
  /** Whether the server could ever reach Perspicax for this request, without
   * borrowing a token (the status route answers from it). */
  reachable: (auth: RequestAuth) => { ok: true } | { ok: false; reason: CodeUnavailableReason };
  client: PerspicaxAgentsClient;
  manager: CloudAgentManager;
  consoleUrl: () => string | undefined;
  botVisible: (auth: RequestAuth, botId: string) => boolean;
  /** Personal runs' subscriptions (organization server): the check before a
   * launch, the watch after it, and what the run view shows. */
  personal?: () => (PersonalSubscriptions & { status(runId: string, principalId?: string): CodeSubscription | undefined }) | null;
  /** The viewer may read that thread of that bot (a thread can turn
   * confidential, or a grant be withdrawn, after the launch). */
  threadReadable?: (auth: RequestAuth, botId: string, threadId: string) => boolean;
  fixture?: boolean;
  /** Clock for the probe cache (tests). */
  now?: () => number;
}

const RUN_PATH = /^\/api\/code\/runs\/([A-Za-z0-9_-]{1,80})(?:\/(events|stream|read|followup|approve|stop|archive|diff|commits|files))?$/;
const PROMPT_MAX = 50_000;
const STREAM_MAX_MS = 30 * 60_000;
/** How long the answer to "does this Perspicax serve the agents API" holds. */
export const PROBE_TTL_MS = 5 * 60_000;
const PROBE_RETRY_MS = 60_000;

function fail(res: ServerResponse, json: typeof import("../harness/http.ts").json, e: unknown) {
  if (e instanceof ProviderHttpError) {
    const status = e.status >= 400 && e.status < 600 ? e.status : 502;
    return json(res, status, { error: e.message, code: e.code });
  }
  throw e;
}

const str = (body: unknown, key: string): string => {
  const value = body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value.trim() : "";
};

export function createCodeRoutes(deps: CodeRouteDeps): RouteHandler {
  /** The run plus the bot and thread that launched it here, when the viewer may see that bot. */
  const joined = (auth: RequestAuth, principalId: string, run: PerspicaxRun): CodeRun => {
    const local = deps.manager.byExternal("perspicax", run.id);
    const subscription = deps.personal?.()?.status(run.id, principalId);
    if (subscription) run = { ...run, subscription } as CodeRun;
    if (!local || local.principalId !== principalId || !local.botId || !deps.botVisible(auth, local.botId)) return run;
    const threadOk = local.threadId && (!deps.threadReadable || deps.threadReadable(auth, local.botId, local.threadId));
    return { ...run, botId: local.botId, ...(threadOk ? { threadId: local.threadId } : {}) };
  };
  /** A change seen here also refreshes the thread card of a bot-launched run. */
  const touchLocal = (runId: string) => {
    const local = deps.manager.byExternal("perspicax", runId);
    if (local) void deps.manager.refresh(local.id).catch(() => null);
  };

  // One answer per Perspicax origin: "yes" and "no" kept PROBE_TTL_MS, a
  // failure PROBE_RETRY_MS (Perspicax may come back sooner). A refusal (401,
  // 403: a Perspicax that serves the API but not to this Sagax's token, such
  // as one that wants the link token) is "denied", shown as not available
  // and never kept, since it depends on the person's token, not the origin.
  type Probe = "yes" | "no" | "denied" | "error";
  const probes = new Map<string, { at: number; ttl: number; answer: Promise<Probe> }>();
  const servesAgents = (access: PerspicaxAccess): Promise<Probe> => {
    const key = new URL(access.baseUrl).origin;
    const now = (deps.now ?? Date.now)();
    const kept = probes.get(key);
    if (kept && now - kept.at < kept.ttl) return kept.answer;
    const entry = { at: now, ttl: PROBE_TTL_MS, answer: Promise.resolve<Probe>("error") };
    entry.answer = deps.client.servesAgents(access).then(
      (yes): Probe => (yes ? "yes" : "no"),
      (e: unknown): Probe => {
        if (e instanceof ProviderHttpError && (e.status === 401 || e.status === 403)) {
          if (probes.get(key) === entry) probes.delete(key);
          return "denied";
        }
        entry.ttl = PROBE_RETRY_MS;
        return "error";
      },
    );
    probes.set(key, entry);
    return entry.answer;
  };

  return async ({ req, res, path, url, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/code/")) return PASS;

    if (path === "/api/code/status") {
      if (method !== "GET") return PASS;
      const reach = deps.reachable(auth);
      if (!reach.ok) {
        return json(res, 200, { available: false, reason: reach.reason, ...(reach.reason === "solo" ? { businessUrl: SAGAX_BUSINESS_URL } : {}) } satisfies CodeStatus);
      }
      // Does this Perspicax serve the cloud agents API at all? Asked once per
      // Perspicax and kept a few minutes, so a Perspicax without it (before
      // #372) costs one call, not one per page load.
      const access = await deps.access(auth);
      if (!access.ok) return json(res, 200, { available: false, reason: access.reason } satisfies CodeStatus);
      const served = await servesAgents(access.access);
      if (served === "no" || served === "denied") return json(res, 200, { available: false, reason: "not_available" } satisfies CodeStatus);
      if (served === "error") return json(res, 200, { available: false, reason: "unreachable" } satisfies CodeStatus);
      const status: CodeStatus = { available: true, ...(deps.consoleUrl() ? { consoleUrl: deps.consoleUrl() } : {}), ...(deps.fixture ? { fixture: true } : {}) };
      return json(res, 200, status);
    }

    const environments = path === "/api/code/environments";
    const list = path === "/api/code/runs";
    const match = RUN_PATH.exec(path);
    if (!environments && !list && !match) return PASS;

    const access = await deps.access(auth);
    if (!access.ok) {
      return json(res, access.reason === "solo" ? 404 : 401, {
        error: access.reason === "solo" ? "Code needs Sagax Business." : "Sign in to Perspicax again to reach your runs.",
        code: access.reason,
      });
    }
    const who = access.access;

    try {
      if (environments) {
        if (method !== "GET") return PASS;
        return json(res, 200, { items: await deps.client.environments(who) });
      }
      if (list) {
        if (method === "GET") {
          const rows = await deps.client.runs(who, { mine: true });
          const items = rows.filter((run) => run.state !== "archived")
            .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
            .map((run) => joined(auth, access.principalId, run));
          return json(res, 200, { items });
        }
        if (method === "POST") {
          const body = await readBody(req).catch(() => undefined);
          const envId = str(body, "env_id");
          const prompt = str(body, "prompt");
          if (!envId) return json(res, 400, { error: "env_id is required" });
          if (!prompt) return json(res, 400, { error: "prompt is required" });
          if (prompt.length > PROMPT_MAX) return json(res, 400, { error: "prompt is too long" });
          const engine = str(body, "engine");
          if (engine && !(RUN_ENGINES as readonly string[]).includes(engine)) return json(res, 400, { error: "engine must be claude-code or codex" });
          const model = str(body, "model").slice(0, 120);
          const title = str(body, "title").slice(0, 200);
          // A personal run needs the person's own sign-in for its engine.
          const subscriptions = deps.personal?.() ?? null;
          if (subscriptions) {
            const env = (await deps.client.environments(who)).find((row) => row.id === envId);
            if (env && personalEnvironment(env)) {
              const ready = subscriptions.ready(access.principalId, engine || env.engine_default);
              if (!ready.ok) return json(res, 409, { error: ready.message, code: "no_subscription" });
            }
          }
          const run = await deps.client.create(who, {
            env_id: envId,
            prompt,
            origin: "sagax",
            ...(engine ? { engine } : {}),
            ...(model ? { model } : {}),
            ...(title ? { title } : {}),
          });
          if (subscriptions && run.token_source === "personnel") subscriptions.watch(access.principalId, run.id);
          return json(res, 201, { item: joined(auth, access.principalId, run) });
        }
        return PASS;
      }

      const id = match![1]!;
      const action = match![2];
      if (!action) {
        if (method !== "GET") return PASS;
        return json(res, 200, { item: joined(auth, access.principalId, await deps.client.run(who, id)) });
      }
      if (method === "GET") {
        if (action === "events") {
          const after = Number(url.searchParams.get("after") ?? 0) || 0;
          return json(res, 200, { items: await deps.client.allEvents(who, id, after) });
        }
        // A 404 on an artifact route means "not served yet" (a later
        // Perspicax lot), so the run itself is checked first.
        if (action === "diff" || action === "commits" || action === "files") await deps.client.run(who, id);
        if (action === "diff") return json(res, 200, await deps.client.diff(who, id));
        if (action === "commits") return json(res, 200, await deps.client.commits(who, id));
        if (action === "files") return json(res, 200, await deps.client.files(who, id));
        if (action === "stream") {
          // Seen (and the run exists) before the stream opens: a refusal is
          // still a plain JSON answer.
          await deps.client.run(who, id);
          // An EventSource reconnects with its first URL and Last-Event-ID:
          // resume after the larger, as Perspicax does.
          const lastHeader = req.headers["last-event-id"];
          const lastId = Number(Array.isArray(lastHeader) ? lastHeader[0] : lastHeader ?? 0) || 0;
          const after = Math.max(0, Number(url.searchParams.get("after") ?? 0) || 0, lastId);
          const abort = new AbortController();
          const cap = setTimeout(() => abort.abort(), STREAM_MAX_MS);
          cap.unref?.();
          res.on("close", () => abort.abort());
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
          res.write(": ok\n\n");
          const ping = setInterval(() => { if (!res.writableEnded) res.write(": keep-alive\n\n"); }, 15_000);
          ping.unref?.();
          try {
            for await (const event of deps.client.stream(who, id, after, abort.signal)) {
              if (res.writableEnded) break;
              res.write(`event: ${event.kind.replace(/[^a-z_]/g, "")}\nid: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
              if (event.kind === "state" || event.kind === "pr" || event.kind === "stats") touchLocal(id);
            }
          } catch {
            // Perspicax went away: the client reconnects with its last seq.
          } finally {
            clearInterval(ping);
            clearTimeout(cap);
            if (!res.writableEnded) res.end();
          }
          return;
        }
        return PASS;
      }
      if (method !== "POST") return PASS;
      const body = await readBody(req).catch(() => undefined);
      let run: PerspicaxRun;
      if (action === "read") run = await deps.client.markRead(who, id);
      else if (action === "followup") {
        const text = str(body, "text");
        if (!text) return json(res, 400, { error: "text is required" });
        if (text.length > PROMPT_MAX) return json(res, 400, { error: "text is too long" });
        const raw = str(body, "mode");
        const mode: FollowUpMode = raw === "steer" || raw === "interrupt" ? raw : "queue";
        run = await deps.client.followUp(who, id, text, mode);
      } else if (action === "approve") {
        const approvalId = str(body, "approval_id");
        const option = str(body, "option");
        if (!approvalId || !option) return json(res, 400, { error: "approval_id and option are required" });
        await deps.client.approve(who, id, approvalId, option);
        run = await deps.client.run(who, id);
      } else if (action === "stop") run = await deps.client.stop(who, id);
      else if (action === "archive") run = await deps.client.archive(who, id);
      else return PASS;
      touchLocal(id);
      return json(res, 200, { item: joined(auth, access.principalId, run) });
    } catch (e) {
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
      }
      return fail(res, json, e);
    }
  };
}
