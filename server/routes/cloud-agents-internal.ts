// Agent tools reach cloud agents through the harness internal API.
import type { CloudAgentManager } from "../cloud-agents/manager.ts";
import { CLOUD_AGENT_PROVIDERS, type CloudAgentFollowUpMode, type CloudAgentProviderId } from "../../shared/cloud-agents.ts";
import { ProviderHttpError } from "../cloud-agents/providers/http.ts";

const PREFIX = /^\/api\/internal\/cloud-agents\/([a-z_]+)$/;

export interface CloudAgentInternalDeps {
  manager: CloudAgentManager;
  principalId: string;
  botId: string;
  threadId: string;
}

export function cloudAgentInternalAction(method: string, path: string): string | null {
  if (method !== "POST") return null;
  return PREFIX.exec(path)?.[1] ?? null;
}

function jsonError(e: unknown): { text: string; isError: true } {
  if (e instanceof ProviderHttpError) return { text: e.message, isError: true };
  return { text: e instanceof Error ? e.message : String(e), isError: true };
}

export async function handleCloudAgentInternal(
  action: string,
  body: Record<string, unknown>,
  deps: CloudAgentInternalDeps,
): Promise<{ text: string; isError?: boolean; item?: unknown }> {
  const pid = deps.principalId;
  if (!pid) return { text: "No signed-in person for cloud agent credentials.", isError: true };

  try {
    if (action === "list") {
      await deps.manager.syncBot(deps.botId);
      const items = deps.manager.list(deps.botId).filter((row) => row.principalId === pid);
      return { text: items.length ? JSON.stringify(items, null, 2) : "No cloud agents for this bot yet." };
    }
    if (action === "get") {
      const id = String(body.cloud_agent_id ?? "").trim();
      const item = id ? deps.manager.get(id) : null;
      if (!item || item.botId !== deps.botId || item.principalId !== pid) {
        return { text: "No such cloud agent.", isError: true };
      }
      await deps.manager.refresh(id);
      return { text: JSON.stringify(deps.manager.get(id), null, 2) };
    }
    if (action === "launch") {
      const provider = body.provider;
      if (typeof provider !== "string" || !CLOUD_AGENT_PROVIDERS.includes(provider as CloudAgentProviderId)) {
        return { text: "provider must be cursor, claude, codex or perspicax.", isError: true };
      }
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) return { text: "prompt is required.", isError: true };
      const record = await deps.manager.launch({
        botId: deps.botId,
        threadId: deps.threadId,
        principalId: pid,
        launch: {
          provider: provider as CloudAgentProviderId,
          prompt,
          repos: Array.isArray(body.repos) ? body.repos as { url: string; ref?: string; prUrl?: string }[] : undefined,
          model: typeof body.model === "string" ? body.model : undefined,
          name: typeof body.name === "string" ? body.name : undefined,
          workOnCurrentBranch: body.work_on_current_branch === true,
          autoCreatePr: body.auto_create_pr === true,
          ...(typeof body.env_id === "string" && body.env_id.trim() ? { envId: body.env_id.trim() } : {}),
          ...(typeof body.engine === "string" && body.engine.trim() ? { engine: body.engine.trim() } : {}),
        },
      });
      const where = record.provider === "perspicax"
        ? " It runs in Perspicax and shows in the person's Code section; a card under your message follows it."
        : "";
      // The id is for the follow-up tools; the person reads the run by name.
      return { text: `Launched cloud agent ${record.name}. Status: ${record.status}.${record.url ? ` ${record.url}` : ""}${where} Its cloud_agent_id for follow-up calls is ${record.id}; never show that id to the person, call the run by its name.` };
    }
    if (action === "follow_up") {
      const id = String(body.cloud_agent_id ?? "").trim();
      const text = typeof body.text === "string" ? body.text.trim() : "";
      const modeRaw = body.mode;
      const mode: CloudAgentFollowUpMode = modeRaw === "steer" || modeRaw === "interrupt" ? modeRaw : "queue";
      if (!id || !text) return { text: "cloud_agent_id and text are required.", isError: true };
      const item = await deps.manager.followUp(id, pid, { text, mode });
      return { text: `Follow-up ${mode} on ${item.name}: ${item.status}.` };
    }
    if (action === "cancel") {
      const id = String(body.cloud_agent_id ?? "").trim();
      if (!id) return { text: "cloud_agent_id is required.", isError: true };
      const item = await deps.manager.cancel(id, pid);
      return { text: `Cancelled ${item.name}.` };
    }
    if (action === "archive") {
      const id = String(body.cloud_agent_id ?? "").trim();
      if (!id) return { text: "cloud_agent_id is required.", isError: true };
      const item = await deps.manager.archive(id, pid);
      return { text: `Archived ${item.name}.` };
    }
    if (action === "transcript") {
      const id = String(body.cloud_agent_id ?? "").trim();
      if (!id) return { text: "cloud_agent_id is required.", isError: true };
      const lines = await deps.manager.transcript(id, pid);
      return { text: lines.length ? JSON.stringify(lines, null, 2) : "Transcript is empty." };
    }
    if (action === "artifacts") {
      const id = String(body.cloud_agent_id ?? "").trim();
      if (!id) return { text: "cloud_agent_id is required.", isError: true };
      const artifacts = await deps.manager.artifacts(id, pid);
      return { text: artifacts.length ? JSON.stringify(artifacts, null, 2) : "No artifacts." };
    }
    if (action === "find_by_pr") {
      const provider = body.provider;
      const prUrl = typeof body.pr_url === "string" ? body.pr_url.trim() : "";
      if (typeof provider !== "string" || !CLOUD_AGENT_PROVIDERS.includes(provider as CloudAgentProviderId) || !prUrl) {
        return { text: "provider and pr_url are required.", isError: true };
      }
      const hit = await deps.manager.findByPr(pid, provider as CloudAgentProviderId, prUrl);
      return { text: hit ? JSON.stringify(hit, null, 2) : "No cloud agent for that pull request." };
    }
    return { text: `Unknown cloud agent action ${action}.`, isError: true };
  } catch (e) {
    return jsonError(e);
  }
}
