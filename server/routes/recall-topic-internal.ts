// recall_topic (server/streams/single-stream.ts): one earlier topic of a person's
// single stream, served behind the per-turn agents capability the internal
// block of server/index.ts checks first (bearer, bot, live turn): so this
// module is in INTERNAL_ROUTES, never in ROUTES. The bot and the conversation
// are the capability's, never the body's.
//
//   POST /api/internal/recall-topic   {}                      list the topics
//   POST /api/internal/recall-topic   { topicId, before? }    one page of one
//
// Only a person's turn in a marked stream segment may ask, and only for that
// stream's own segments (index.ts streamCandidates: never a confidential,
// hidden, routine, parallel or bot-opened thread; the same person's own on an
// organization server). Anything else reads as missing.
import { z } from "zod";

import { PASS } from "./table.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";

const body = z.object({
  /** Older proxies send these; the capability's own values win. */
  fromBotId: z.string().optional(),
  fromThreadId: z.string().optional(),
  topicId: z.string().max(128).regex(/^[\w-]*$/).optional(),
  before: z.string().max(128).regex(/^[\w-]*$/).optional(),
}).strict();

export interface RecallTopicListing {
  id: string;
  title: string;
  createdAt: number;
  lastAt: number;
}

export function createRecallTopicInternalRoutes(deps: {
  /** The conversation belongs to this bot (connectorThread in index.ts). */
  ownsThread(botId: string, threadId: string): boolean;
  /** The stream's other topics, newest first, or null when this turn is not
   * a person's turn in a stream segment. */
  topics(capability: InternalCapabilityView): RecallTopicListing[] | null;
  /** One page of a topic already listed by `topics`. */
  page(capability: InternalCapabilityView, topicId: string, before?: string): { text: string; more: boolean; firstId?: string };
}): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== "/api/internal/recall-topic") return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!deps.ownsThread(capability.botId, capability.threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const parsed = body.safeParse(await readBody());
    if (!parsed.success) return json(res, 400, { error: "Invalid recall_topic request" });
    const topics = deps.topics(capability);
    if (!topics) return json(res, 403, { error: "recall_topic works only in a person's single-stream conversation" });
    const day = (at: number) => new Date(at).toISOString().slice(0, 10);
    const topicId = parsed.data.topicId?.trim();
    if (!topicId) {
      return json(res, 200, { topics: topics.map((topic) => ({ id: topic.id, title: topic.title, started: day(topic.createdAt), last: day(topic.lastAt) })) });
    }
    const topic = topics.find((candidate) => candidate.id === topicId);
    if (!topic) return json(res, 404, { error: "no such topic in this conversation" });
    const page = deps.page(capability, topic.id, parsed.data.before?.trim() || undefined);
    return json(res, 200, { title: topic.title, text: page.text, more: page.more, ...(page.firstId ? { firstId: page.firstId } : {}) });
  };
}
