// Agents tool family: Cloud coding agents.
// Definitions and handlers. Assembled in order by agents-catalog.ts;
// dispatched by agents-call.ts. Never import server/index.ts.

import { CLOUD_AGENT_READ_TOOLS, CLOUD_AGENT_WRITE_TOOLS, cloudAgentToolAction } from "../../../shared/cloud-agents.ts";
import type { ToolCallContext, ToolCallResult } from "../agents-call-types.ts";
import type { Json } from "../agents-client.ts";

export const DEF_LIST_CLOUD_AGENTS = {
    name: "list_cloud_agents",
    description:
      "List cloud coding agents you launched on external providers (Perspicax, Cursor, Claude Code cloud, Codex cloud) for this bot. Each row is a long-running job on a repository with its own dashboard URL when the provider offers one.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  };

export const DEF_GET_CLOUD_AGENT = {
    name: "get_cloud_agent",
    description: "Read one cloud agent by its Sagax id (ca_… from list_cloud_agents).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { cloud_agent_id: { type: "string", description: "The Sagax cloud agent id." } },
      required: ["cloud_agent_id"],
    },
  };

export const DEF_LAUNCH_CLOUD_AGENT = {
    name: "launch_cloud_agent",
    description:
      "Launch a cloud coding agent. On an organization server prefer provider perspicax: the run gets its own Pod in Perspicax, pushes a px/... branch, opens a draft pull request, and the person follows it in Sagax's Code section and in a card under your message; it uses their sign-in, no key. The environment is found by repo_url; when several match, ask the person which, then launch again with env_id. Other providers (cursor, claude, codex) need the person's own API key in Sagax settings. Pass a complete task prompt. Writes need the person's approval unless their allowlist permits it.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        provider: { type: "string", enum: ["perspicax", "cursor", "claude", "codex"], description: "Which provider runs the agent." },
        env_id: { type: "string", description: "perspicax: the environment to start from (env_...), when the repository alone is ambiguous." },
        engine: { type: "string", enum: ["claude-code", "codex"], description: "perspicax: the coding engine (the environment's default otherwise)." },
        prompt: { type: "string", minLength: 1, maxLength: 50_000, description: "What the cloud agent should do." },
        repo_url: { type: "string", description: "Git repository URL to work in." },
        ref: { type: "string", description: "Branch, tag or commit to start from." },
        model: { type: "string", description: "Optional provider model id." },
        name: { type: "string", description: "Short label for the job." },
        work_on_current_branch: { type: "boolean" },
        auto_create_pr: { type: "boolean" },
      },
      required: ["provider", "prompt"],
    },
  };

export const DEF_CLOUD_AGENT_FOLLOW_UP = {
    name: "cloud_agent_follow_up",
    description:
      "Send another instruction to a cloud agent. mode queue waits for the current run; steer or interrupt cancels the active run and starts a new one with your text.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cloud_agent_id: { type: "string" },
        text: { type: "string", minLength: 1, maxLength: 50_000 },
        mode: { type: "string", enum: ["queue", "steer", "interrupt"] },
      },
      required: ["cloud_agent_id", "text"],
    },
  };

export const DEF_CANCEL_CLOUD_AGENT = {
    name: "cancel_cloud_agent",
    description: "Cancel the active run of a cloud agent.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { cloud_agent_id: { type: "string" } },
      required: ["cloud_agent_id"],
    },
  };

export const DEF_ARCHIVE_CLOUD_AGENT = {
    name: "archive_cloud_agent",
    description: "Archive a cloud agent on the provider and mark it archived locally.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { cloud_agent_id: { type: "string" } },
      required: ["cloud_agent_id"],
    },
  };

export const DEF_FIND_CLOUD_AGENT_BY_PR = {
    name: "find_cloud_agent_by_pr",
    description: "Find a cloud agent by pull request URL (local mirror first, then the provider when configured).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        provider: { type: "string", enum: ["perspicax", "cursor", "claude", "codex"] },
        pr_url: { type: "string" },
      },
      required: ["provider", "pr_url"],
    },
  };

export const DEF_CLOUD_AGENT_TRANSCRIPT = {
    name: "cloud_agent_transcript",
    description: "Dump the transcript of a cloud agent's runs as JSON lines.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { cloud_agent_id: { type: "string" } },
      required: ["cloud_agent_id"],
    },
  };

export const DEF_LIST_CLOUD_AGENT_ARTIFACTS = {
    name: "list_cloud_agent_artifacts",
    description: "List artifact files a cloud agent produced.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { cloud_agent_id: { type: "string" } },
      required: ["cloud_agent_id"],
    },
  };

export const CLOUD_AGENTS_TOOL_NAMES: ReadonlySet<string> = new Set(['list_cloud_agents', 'get_cloud_agent', 'launch_cloud_agent', 'cloud_agent_follow_up', 'cancel_cloud_agent', 'archive_cloud_agent', 'find_cloud_agent_by_pr', 'cloud_agent_transcript', 'list_cloud_agent_artifacts'] as const);

/** Handle a tool of this family, or return null when the name is not ours. */
export async function callCloudAgentsTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult | null> {
  const { apiResponse } = context.client;
  if (!CLOUD_AGENTS_TOOL_NAMES.has(name)) return null;
  const cloudAgentAction = cloudAgentToolAction(name);
  if (cloudAgentAction) {
    if (!CLOUD_AGENT_READ_TOOLS.has(name) && !CLOUD_AGENT_WRITE_TOOLS.has(name)) {
      return { text: `Unknown cloud agent tool: ${name}`, isError: true };
    }
    const payload: Json = { ...args };
    if (name === "launch_cloud_agent") {
      const repoUrl = typeof args.repo_url === "string" ? args.repo_url.trim() : "";
      const ref = typeof args.ref === "string" ? args.ref.trim() : "";
      if (repoUrl) payload.repos = [{ url: repoUrl, ...(ref ? { ref } : {}) }];
      delete payload.repo_url;
      delete payload.ref;
    }
    const { ok, body } = await apiResponse(`/api/internal/cloud-agents/${cloudAgentAction}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const text = String(body.text ?? body.error ?? "").slice(0, 8000);
    if (!ok || body.isError) return { text: text || "The cloud agent call was refused.", isError: true };
    return { text: text || "Done." };
  }
  return null;
}

