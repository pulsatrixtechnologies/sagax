// @ts-nocheck
/** streamDigestPrompt (#1388). Pure move from server/index.ts. */
import { STREAM_FULL_ENTRIES, composeStreamDigest } from "../streams/single-stream.ts";
export type Host = Record<string, any>;

export function createStreamDigestPrompt(getHost: () => Host): any {
function streamDigestPrompt(bot: BotRecord, threadId: string): { text: string; threadIds: ReadonlySet<string> } {
  const host = getHost();

  const candidates = host.streamCandidates(bot, threadId);
  if (!candidates.length) return { text: "", threadIds: new Set() };
  // Only the newest topics get a digest body (composeStreamDigest), so only
  // theirs are worked out: an old bot with hundreds of threads reads eight.
  const newest = [...candidates].sort((a, b) => host.segmentStamp(b) - host.segmentStamp(a));
  const composed = composeStreamDigest(newest.map((task, index) => ({
    threadId: task.threadId, title: task.title, createdAt: task.createdAt, lastAt: host.segmentStamp(task),
    ...(index < STREAM_FULL_ENTRIES ? { digest: host.segmentDigestText(bot, task) } : {})
  })));
  console.info(`[stream] ${bot.id} ${threadId}: digest of ${composed.full} topic(s) + ${composed.indexed} indexed, ${composed.chars} chars (~${Math.ceil(composed.chars / 4)} tokens)${composed.omitted ? `, ${composed.omitted} omitted` : ""}`);
  return { text: composed.text ? `\n\n${composed.text}` : "", threadIds: new Set(candidates.map((task) => task.threadId)) };

}
  return streamDigestPrompt;
}
