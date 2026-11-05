// The artifact tools (agents-artifact-tools.ts) carried to the internal
// route (server/routes/artifacts.ts), which checks and stores. They live
// here rather than in agents-call.ts, which is at its size ratchet; callTool
// hands these names over and returns the answer as it stands.
import type { ToolCallContext, ToolCallResult } from "./agents-call-types.ts";
import type { Json } from "./agents-client.ts";
import { CLAUDE_ARTIFACT_TOOL_NAME } from "./agents-artifact-tools.ts";
import { callClaudeArtifactTool } from "./agents-call-claude-artifact.ts";

export { ARTIFACT_TOOL_NAMES } from "./agents-artifact-tools.ts";

export async function callArtifactTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  if (context.externalRuntime) return { text: `Unknown tool: ${name}`, isError: true };
  if (name === CLAUDE_ARTIFACT_TOOL_NAME) return callClaudeArtifactTool(args, context);
  const { ok, body } = await context.client.apiResponse("/api/internal/artifacts", {
    method: "POST",
    body: JSON.stringify({ tool: name, args: args ?? {} }),
  });
  if (!ok) return { text: String(body.error ?? "The artifact could not be saved."), isError: true };
  if (name === "save_artifact") {
    const artifact = body.artifact as { id?: unknown; source?: unknown } | undefined;
    return {
      text: `Saved as artifact ${String(artifact?.id ?? "")}. It is in your Files tab under Artifacts${artifact?.source ? "; Sagax refreshes it from its source on the interval, with no turn of yours" : ""}. To change it later, call update_artifact with this id.`,
    };
  }
  if (name === "delete_artifact") return { text: "Deleted." };
  return { text: JSON.stringify(name === "list_artifacts" ? body.artifacts ?? [] : body.artifact ?? null) };
}
