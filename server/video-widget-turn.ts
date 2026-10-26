import type { SagaxVideoEmit } from "../shared/video-widget.ts";
import { videosFromToolOutput } from "../shared/video-widget.ts";
import { askedForView } from "../shared/requested-views.ts";
import { wireVideoFromEmit } from "./media-proxy.ts";
import type { Message } from "./store.ts";

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
