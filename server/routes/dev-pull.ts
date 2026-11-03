// A pull request this conversation already opened: its forge counts, and the
// verbs the bot already runs (`gh pr ready --undo`, `gh pr close`,
// `gh pr merge --auto`, `gh run rerun --failed`, deleting the head ref).
// The same person's GitHub connection and the same thread.post guard as the
// branch actions (server/routes/bot-code-branches.ts). A pull request the
// conversation did not open is refused, so this is not a general forge proxy.
import { CodeWorkCollector, type CodeWorkToolCall } from "../activity/activity-code-work.ts";
import { BranchActionError, BranchPulls, hostGit, type GitExec } from "../code-branches.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";
import type { BranchCredentials } from "./bot-code-branches.ts";

const PATH = /^\/api\/bots\/([\w-]+)\/code\/pull$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const SCAN = 500;

export interface DevPullRouteDeps {
  viewerId(auth: RequestAuth): string | undefined;
  threadWritable(botId: string, threadId: string, viewerId: string | undefined): boolean;
  messages(threadId: string, limit: number): { messages: Array<{ at: number; tool?: CodeWorkToolCall }> };
  credentials(viewerId: string | undefined): BranchCredentials;
  organization(): boolean;
  audit(auth: RequestAuth, action: string, target: { botId: string; branch: string; repo?: string }): void;
  exec?: GitExec;
}

function asked(value: unknown): { threadId: string; repo: string; number: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const body = value as { threadId?: unknown; repo?: unknown; number?: unknown };
  const threadId = typeof body.threadId === "string" ? body.threadId : "";
  const repo = typeof body.repo === "string" ? body.repo : "";
  const number = typeof body.number === "number" ? body.number : Number(body.number);
  if (!/^[\w-]+$/.test(threadId) || !REPO.test(repo) || !Number.isInteger(number) || number < 1 || number > 1_000_000) return undefined;
  return { threadId, repo, number };
}

export function createDevPullRoutes(deps: DevPullRouteDeps): RouteHandler {
  const exec = deps.exec ?? hostGit;
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const match = PATH.exec(path);
    if (!match) return PASS;
    if (method !== "GET" && method !== "POST") return json(res, 405, { error: "method not allowed" });
    const botId = match[1]!;
    const viewerId = deps.viewerId(auth);
    if (deps.organization() && !viewerId) return json(res, 403, { error: "Sign in as yourself to act on a pull request here.", code: "no_person" });
    const raw = method === "GET"
      ? { threadId: url.searchParams.get("threadId"), repo: url.searchParams.get("repo"), number: url.searchParams.get("number") }
      : await readBody(req);
    const query = asked(raw);
    if (!query) return json(res, 400, { error: "threadId, repo and number are required" });
    if (!deps.threadWritable(botId, query.threadId, viewerId)) return json(res, 404, { error: "no such conversation" });
    const collector = new CodeWorkCollector();
    for (const message of deps.messages(query.threadId, SCAN).messages) {
      if (message.tool) collector.add(message.tool, message.at);
    }
    const known = collector.result().pullRequests.some((pull) =>
      pull.number === query.number && (pull.repo ?? query.repo).toLowerCase() === query.repo.toLowerCase());
    if (!known) return json(res, 404, { error: "This conversation did not open that pull request." });
    const credentials = deps.credentials(viewerId);
    if (!credentials.publish) return json(res, method === "GET" ? 200 : 403, method === "GET"
      ? { pull: null, reason: "github_not_connected" }
      : { error: "Connect your own GitHub account to act on a pull request from here.", code: "github_not_connected" });
    const isolated = deps.organization() || credentials.isolated === true;
    const pulls = new BranchPulls(exec, process.cwd(), query.repo, { ...credentials.git, ...credentials.publish.gh }, isolated);
    const body = method === "POST" ? raw as { action?: unknown } : undefined;
    try {
      if (method === "GET") {
        const pull = await pulls.view(query.number);
        return json(res, 200, { pull: pull ?? null, canAct: true });
      }
      if (body?.action === "draft") {
        await pulls.toDraft(query.number);
        deps.audit(auth, "code.pull.draft", { botId, branch: `#${query.number}`, repo: query.repo });
        return json(res, 200, { ok: true, pull: await pulls.view(query.number) });
      }
      if (body?.action === "close") {
        await pulls.close(query.number);
        deps.audit(auth, "code.pull.close", { botId, branch: `#${query.number}`, repo: query.repo });
        return json(res, 200, { ok: true });
      }
      if (body?.action === "merge-ready") {
        const on = (body as { on?: unknown }).on !== false;
        await pulls.mergeWhenReady(query.number, on);
        deps.audit(auth, on ? "code.pull.merge-ready" : "code.pull.merge-ready.off", { botId, branch: `#${query.number}`, repo: query.repo });
        return json(res, 200, { ok: true, pull: await pulls.view(query.number) });
      }
      if (body?.action === "autofix") {
        const restarted = await pulls.autoFix(query.number);
        deps.audit(auth, "code.pull.autofix", { botId, branch: `#${query.number}`, repo: query.repo });
        return json(res, 200, { ok: true, restarted });
      }
      if (body?.action === "archive") {
        const archived = await pulls.autoArchive(query.number);
        deps.audit(auth, "code.pull.archive", { botId, branch: `#${query.number}`, repo: query.repo });
        return json(res, 200, { ok: true, archived, pull: await pulls.view(query.number) });
      }
      return json(res, 400, { error: "action must be draft, close, merge-ready, autofix or archive" });
    } catch (error) {
      if (error instanceof BranchActionError) return json(res, error.status, { error: error.message, code: error.code });
      return json(res, 500, { error: "The pull request could not be read." });
    }
  };
}
