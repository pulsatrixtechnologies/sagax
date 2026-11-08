import type { Json, HarnessClient } from "./agents-client.ts";
import type { ToolCallResult } from "./agents-call-types.ts";

/** make_image (#2954): native image generation and editing for every
 * engine, always loaded, so an edit request on an attached photo never
 * starts a skill search. */
export const IMAGE_TOOL_NAME = "make_image";

export function imageToolDefinition() {
  return {
    name: IMAGE_TOOL_NAME,
    description: [
      "Generate an image, or edit the image the person attached to their message (\"put this person in Paris\", \"make it a watercolor\", \"remove the background\").",
      "With an image attached, it edits that image by default; set use_attached_image false to start from scratch.",
      "Uses the person's connected image provider (xAI Grok Imagine or OpenAI gpt-image), chosen automatically; this may incur API charges.",
      "The result is posted in this chat as your image: do not attach it again or describe it at length.",
      "Call it directly: no skill or tool search is needed.",
    ].join(" "),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: { type: "string", maxLength: 4_000, description: "What the image should show, or the change to make to the attached image, in the person's words." },
        image: { type: "string", maxLength: 500, description: "Optional exact attachment path or /api/attachments URL of one image in the current person's message. Default: the latest image they attached." },
        use_attached_image: { type: "boolean", description: "Default true: edit the image attached to the person's message when there is one." },
        aspect_ratio: { type: "string", enum: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"], description: "For a new image only." },
      },
      required: ["prompt"],
    },
  };
}

export async function callImageTool(args: Json, client: HarnessClient): Promise<ToolCallResult> {
  const { ok, body } = await client.apiResponse("/api/internal/image", { method: "POST", body: JSON.stringify(args ?? {}) });
  if (!ok) return { text: String(body.error ?? "Image generation failed."), isError: true };
  return { text: String(body.text ?? "The image is in the chat.") };
}
