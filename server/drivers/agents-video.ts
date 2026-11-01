import type { Json, HarnessClient } from "./agents-client.ts";
import type { ToolCallResult } from "./agents-call.ts";

export const VIDEO_TOOL_NAME = "make_video";

export const ENGINE_VIDEO_TOOLS = ["image_to_video", "reference_to_video"] as const;

export function videoToolDefinition() {
  return {
    name: VIDEO_TOOL_NAME,
    description: [
      "Generate a video using the person's xAI API key, or the organization's granted xAI images and videos account. This may incur API charges.",
      "Native image_to_video and reference_to_video remain available when the engine offers them.",
      "generate starts an async job and returns job_id; status reads progress, list finds this conversation's jobs, cancel stops local polling/download, retry resumes the SAME upstream request without another paid generation.",
      "The completed MP4 is saved and attached in this chat. Never claim completion from pending status or show a temporary provider URL.",
      "Use a stable request_key for safe retries across turns. A new generate request_key starts a separately billable job. No remote xAI cancellation API is documented.",
    ].join(" "),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["generate", "status", "list", "cancel", "retry"], description: "Default generate." },
        prompt: { type: "string", maxLength: 2_000, description: "What the video should show; required for generate." },
        image: { type: "string", maxLength: 500, description: "Optional exact attachment path or /api/attachments URL for an image in the current person's message. No external URL or arbitrary file." },
        duration: { type: "integer", minimum: 1, maximum: 15, description: "Seconds; default 8." },
        aspect_ratio: { type: "string", enum: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "5:2"] },
        resolution: { type: "string", enum: ["480p", "720p", "1080p"] },
        generate_audio: { type: "boolean", description: "Default true." },
        job_id: { type: "string", description: "Returned job id; required for status, cancel and retry." },
        request_key: { type: "string", maxLength: 100, description: "Stable identity for one generation. Same key and arguments reuse its job even across turns. Default: one generation per person request, including engine failover." },
        offset: { type: "integer", minimum: 0, description: "For list: next_offset from the previous page; 20 jobs per page." },
      },
      required: [] as string[],
    },
  };
}

export async function callVideoTool(args: Json, client: HarnessClient): Promise<ToolCallResult> {
  const { ok, body } = await client.apiResponse("/api/internal/video", { method: "POST", body: JSON.stringify(args ?? {}) });
  const failed = !ok || ["failed", "unknown", "paused"].includes(String(body.status));
  return { text: JSON.stringify(body), ...(failed ? { isError: true } : {}) };
}
