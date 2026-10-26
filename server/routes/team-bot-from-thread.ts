// "Create a Team Bot from this conversation" (server/team-bot-draft.ts).
//
//   POST /api/bots/:id/team-bot-draft   { threadId, language? }
//        { draft }: the new bot's name, role, description and instructions
//        drafted by this bot's model from the conversation (or from its title
//        and lines when the model cannot). Reading the conversation is the
//        only right it needs.
//   POST /api/bots/:id/team-bot-carry   410 private_memory_never, always.
//        JC 2026-10-21: a Team Bot copied from a conversation takes the
//        persona, the rules, the plugins and the team's shared memory (it
//        stays in the same team), never a conversation nor the bot's own
//        memory, which is its owner's. The route that used to copy memory
//        notes and a summary of the conversation writes nothing now.
//
// The bot itself is created by the ordinary POST /api/bots, its plugins by
// /api/bots/:id/plugins/install, and it is shared with the team through the
// existing Team Bot path (bot settings > Sharing on an organization server,
// grants through Perspicax). Nothing here adds a multi-person view.
import { z } from "zod";

import type { RequestAuth } from "../request-auth.ts";
import {
  conversationLines,
  excerptText,
  fallbackTeamBotDraft,
  parseTeamBotDraft,
  teamBotDraftPrompt,
  type DraftMessage,
} from "../team-bot-draft.ts";
import { PASS, type RouteHandler } from "./table.ts";

type Generate = (prompt: string, options?: { signal?: AbortSignal }) => Promise<string>;

export interface TeamBotFromThreadDeps {
  bot(id: string): { id: string; name: string } | undefined;
  /** The conversation, when this caller may read it; null otherwise. */
  thread(auth: RequestAuth, botId: string, threadId: string): { title: string; messages: readonly DraftMessage[] } | null;
  /** Whether this caller may change that bot (the new one). */
  mayChange(auth: RequestAuth, botId: string): boolean;
  /** The bot's one-shot when its model may be asked now; null otherwise. */
  generate(botId: string): Generate | null;
  /** Unused since 2026-10-21: a copy never takes the bot's memory. */
  memoryNotes?(botId: string): Array<{ path: string; bytes: number }>;
  readNote?(botId: string, path: string): string;
  writeNote?(auth: RequestAuth, botId: string, path: string, text: string): void;
  now?(): number;
  /** The one-shot's limit (tests shorten it). */
  timeoutMs?: number;
}

const draftBody = z.object({ threadId: z.string().regex(/^[\w-]{1,128}$/), language: z.enum(["fr", "en"]).optional() }).strict();

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("timed out")); }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createTeamBotFromThreadRoutes(deps: TeamBotFromThreadDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const draft = path.match(/^\/api\/bots\/([\w-]{1,128})\/team-bot-draft$/);
    if (draft && method === "POST") {
      const parsed = draftBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "send { threadId, language? }" });
      const bot = deps.bot(draft[1]!);
      const thread = bot ? deps.thread(auth, bot.id, parsed.data.threadId) : null;
      if (!bot || !thread) return json(res, 404, { error: "Conversation not found" });
      const language = parsed.data.language ?? "en";
      const lines = conversationLines(thread.messages);
      const fallback = fallbackTeamBotDraft(lines, { threadTitle: thread.title, language });
      let result = fallback;
      const generate = lines.length ? deps.generate(bot.id) : null;
      if (generate) {
        try {
          const prompt = teamBotDraftPrompt(excerptText(lines), { botName: bot.name, threadTitle: thread.title, language });
          result = parseTeamBotDraft(await withTimeout((signal) => generate(prompt, { signal }), deps.timeoutMs ?? 30_000), fallback);
        } catch {
          result = fallback;
        }
      }
      return json(res, 200, { draft: result });
    }
    if (/^\/api\/bots\/[\w-]{1,128}\/team-bot-carry$/.test(path) && method === "POST") {
      return json(res, 410, {
        error: "A copy never takes a conversation or the bot's private memory. Its team's shared memory follows it in the same team.",
        code: "private_memory_never",
      });
    }
    return PASS;
  };
}
