import type { SagaxVideoEmit } from "../../shared/video-widget.ts";
import { extractSagaxVideoBlocks, videosFromToolOutput } from "../../shared/video-widget.ts";
import { askedForView } from "../../shared/requested-views.ts";
import { wireVideoFromEmit } from "../media/media-proxy.ts";
import type { Message } from "../store.ts";

/** The video rows a tool's output adds: none unless the person's message of
 * the turn asked to watch something (shared/requested-views.ts). */
export function videoMessagesFromTool(
  toolName: string,
  output: string | undefined,
  threadId: string,
  personText: string | undefined,
  now = Date.now(),
): Array<Omit<Message, "id" | "at">> {
  if (!askedForView(personText, "video")) return [];
  const emits = videosFromToolOutput(toolName, output);
  if (!emits.length) return [];
  return emits.map((emit: SagaxVideoEmit) => ({
    role: "bot",
    kind: "video",
    requested: true,
    video: wireVideoFromEmit(emit, threadId, now),
  }));
}

/** The video cards a bot wrote in its own reply (a ```video fence, or the
 * same {"sagaxVideos":[...]} envelope in a ```json fence or bare): taken out
 * of the text and turned into player rows, proxied like a tool's. A view the
 * bot writes itself follows the system prompt's "views only on request"
 * rule, like ```chart, so no ask is checked here. */
export function videoMessagesFromText(
  text: string,
  threadId: string,
  now = Date.now(),
): { text: string; messages: Array<Omit<Message, "id" | "at">> } {
  const { text: rest, videos } = extractSagaxVideoBlocks(text);
  if (!videos.length) return { text, messages: [] };
  return {
    text: rest,
    messages: videos.map((emit) => ({
      role: "bot",
      kind: "video",
      requested: true,
      video: wireVideoFromEmit(emit, threadId, now),
    })),
  };
}
