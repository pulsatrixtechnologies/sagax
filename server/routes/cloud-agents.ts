// HTTP routes for cloud coding agents on a bot, and credential settings.
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";
import type { CloudAgentManager } from "../cloud-agents/manager.ts";
import type { CloudAgentCredentialStore } from "../cloud-agents/credentials.ts";
import { CLOUD_AGENT_PROVIDERS, type CloudAgentFollowUpMode, type CloudAgentKeyProviderId, type CloudAgentProviderId } from "../../shared/cloud-agents.ts";
import { ProviderHttpError } from "../cloud-agents/providers/http.ts";

export interface CloudAgentRouteDeps {
  manager: CloudAgentManager;
  credentials: CloudAgentCredentialStore;
  providerLabel: (id: CloudAgentProviderId) => string;
  botVisible: (auth: RequestAuth, botId: string) => boolean;
  principalId: (auth: RequestAuth) => string | null;
  botName: (botId: string) => string | undefined;
  /** The viewer may see this record: theirs, or one launched in a thread they can read. */
  recordVisible: (auth: RequestAuth, record: import("../../shared/cloud-agents.ts").CloudAgentRecord) => boolean;
}

const BOT_PATH = /^\/api\/bots\/([\w-]+)\/cloud-agents(?:\/([\w-]+)(?:\/(follow-up|cancel|archive|artifacts|transcript))?)?$/;
const CREDS_PATH = /^\/api\/me\/cloud-agent-providers(?:\/(cursor|claude|codex)(?:\/test)?)?$/;

function providerError(res: import("node:http").ServerResponse, json: typeof import("../harness/http.ts").json, e: unknown) {
  if (e instanceof ProviderHttpError) {
    return json(res, e.status >= 400 && e.status < 600 ? e.status : 502, { error: e.message, code: e.code });
  }
  throw e;
}

export function createCloudAgentRoutes(deps: CloudAgentRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const credMatch = CREDS_PATH.exec(path);
    if (credMatch) {
      const principalId = deps.principalId(auth);
      if (!principalId) return json(res, 401, { error: "Unauthorized" });
      const provider = credMatch[1] as CloudAgentKeyProviderId | undefined;
      const testing = path.endsWith("/test");
      if (!provider) {
        if (method !== "GET") return PASS;
        const providers = deps.credentials.list(principalId).map((row) => ({
          ...row,
          label: deps.providerLabel(row.provider),
        }));
        return json(res, 200, { providers });
      }
      if (testing) {
        if (method !== "POST") return PASS;
        const body = await readBody(req).catch(() => undefined);
        const token = body && typeof body === "object" && typeof (body as { token?: unknown }).token === "string"
          ? (body as { token: string }).token
          : undefined;
        try {
          await deps.manager.testCredential(principalId, provider, token);
          return json(res, 200, { ok: true });
        } catch (e) {
          return providerError(res, json, e);
        }
      }
      if (method === "PUT") {
        const body = await readBody(req).catch(() => undefined);
        const token = body && typeof body === "object" && typeof (body as { token?: unknown }).token === "string"
          ? (body as { token: string }).token
          : "";
        const label = body && typeof body === "object" && typeof (body as { label?: unknown }).label === "string"
          ? (body as { label: string }).label
          : undefined;
        if (!token.trim()) return json(res, 400, { error: "token is required" });
        deps.credentials.set(principalId, provider, token, label);
        return json(res, 200, { provider, configured: true });
      }
      if (method === "DELETE") {
        deps.credentials.remove(principalId, provider);
        return json(res, 200, { provider, configured: false });
      }
      return PASS;
    }

    const match = BOT_PATH.exec(path);
    if (!match) return PASS;
    const botId = match[1]!;
    if (!deps.botVisible(auth, botId)) return json(res, 404, { error: "no such bot" });
    const principalId = deps.principalId(auth);
    const agentId = match[2];
    const action = match[3];

    if (!agentId) {
      if (method === "GET") {
        // The stored records only: the sync timer and the stream frames keep
        // them fresh, so opening a thread never calls the providers.
        const thread = url.searchParams.get("thread") ?? "";
        const items = deps.manager.list(botId)
          .filter((record) => (!thread || record.threadId === thread) && deps.recordVisible(auth, record));
        return json(res, 200, { items });
      }
      if (method === "POST") {
        if (!principalId) return json(res, 401, { error: "Unauthorized" });
        const body = await readBody(req).catch(() => undefined);
        if (!body || typeof body !== "object") return json(res, 400, { error: "invalid body" });
        const launch = body as Record<string, unknown>;
        const provider = launch.provider;
        if (typeof provider !== "string" || !CLOUD_AGENT_PROVIDERS.includes(provider as CloudAgentProviderId)) {
          return json(res, 400, { error: "provider must be cursor, claude, codex or perspicax" });
        }
        const prompt = typeof launch.prompt === "string" ? launch.prompt.trim() : "";
        if (!prompt) return json(res, 400, { error: "prompt is required" });
        const threadId = typeof launch.threadId === "string" ? launch.threadId : "";
        if (!threadId) return json(res, 400, { error: "threadId is required" });
        try {
          const record = await deps.manager.launch({
            botId,
            threadId,
            principalId,
            launch: {
              provider: provider as CloudAgentProviderId,
              prompt,
              repos: Array.isArray(launch.repos) ? launch.repos as { url: string; ref?: string; prUrl?: string }[] : undefined,
              model: typeof launch.model === "string" ? launch.model : undefined,
              name: typeof launch.name === "string" ? launch.name : undefined,
              workOnCurrentBranch: launch.workOnCurrentBranch === true,
              autoCreatePr: launch.autoCreatePr === true,
              ...(typeof launch.envId === "string" && launch.envId ? { envId: launch.envId } : {}),
              ...(typeof launch.engine === "string" && launch.engine ? { engine: launch.engine } : {}),
            },
          });
          return json(res, 201, { item: record });
        } catch (e) {
          return providerError(res, json, e);
        }
      }
      return PASS;
    }

    if (method === "GET" && !action) {
      const item = deps.manager.get(agentId);
      if (!item || item.botId !== botId || !deps.recordVisible(auth, item)) return json(res, 404, { error: "no such cloud agent" });
      // Only the person who launched it refreshes it: a refresh borrows
      // their credentials (their key, or their Perspicax sign-in).
      if (item.principalId !== deps.principalId(auth)) return json(res, 200, { item });
      await deps.manager.refresh(agentId);
      const fresh = deps.manager.get(agentId);
      return json(res, 200, { item: fresh });
    }

    if (!principalId) return json(res, 401, { error: "Unauthorized" });

    try {
      if (action === "follow-up" && method === "POST") {
        const body = await readBody(req).catch(() => undefined);
        const text = body && typeof body === "object" && typeof (body as { text?: unknown }).text === "string"
          ? (body as { text: string }).text.trim()
          : "";
        const modeRaw = body && typeof body === "object" ? (body as { mode?: unknown }).mode : "queue";
        const mode: CloudAgentFollowUpMode = modeRaw === "steer" || modeRaw === "interrupt" ? modeRaw : "queue";
        if (!text) return json(res, 400, { error: "text is required" });
        const item = await deps.manager.followUp(agentId, principalId, { text, mode });
        if (item.botId !== botId) return json(res, 404, { error: "no such cloud agent" });
        return json(res, 200, { item });
      }
      if (action === "cancel" && method === "POST") {
        const item = await deps.manager.cancel(agentId, principalId);
        if (item.botId !== botId) return json(res, 404, { error: "no such cloud agent" });
        return json(res, 200, { item });
      }
      if (action === "archive" && method === "POST") {
        const item = await deps.manager.archive(agentId, principalId);
        if (item.botId !== botId) return json(res, 404, { error: "no such cloud agent" });
        return json(res, 200, { item });
      }
      if (action === "artifacts" && method === "GET") {
        const item = deps.manager.get(agentId);
        if (!item || item.botId !== botId) return json(res, 404, { error: "no such cloud agent" });
        const artifacts = await deps.manager.artifacts(agentId, principalId);
        return json(res, 200, { artifacts });
      }
      if (action === "transcript" && method === "GET") {
        const item = deps.manager.get(agentId);
        if (!item || item.botId !== botId) return json(res, 404, { error: "no such cloud agent" });
        const lines = await deps.manager.transcript(agentId, principalId);
        return json(res, 200, { lines });
      }
    } catch (e) {
      return providerError(res, json, e);
    }

    return PASS;
  };
}
