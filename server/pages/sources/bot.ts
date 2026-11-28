// The `bot` page source (#5461): the page's own bot, as the reader may see
// it. Read only. Nothing is stored. Unknown params are ignored: this source
// has no filter. A reader who is not signed in, or who may not see that
// bot, gets a refusal and never the bot's name or its routines.
import type { RequestAuth } from "../../auth/request-auth.ts";
import { pageBotView, type PageBotRoutineInput, type PageBotRunInput } from "../../../shared/page-bot.ts";
import { PageSourceError, type PageSource } from "../page-sources.ts";

export const BOT_SOURCE_LABEL = "This page's bot";

export interface BotSourceDeps {
  /** The signed-in reader; undefined when nobody is. */
  person(auth: RequestAuth): string | undefined;
  /** The page's bot when it exists. Its name only. */
  bot(botId: string): { name: string } | null;
  /** Whether this reader may see that bot (its owner, or a right to use it). */
  visible(auth: RequestAuth, botId: string): boolean;
  approvalMode(botId: string): string;
  /** Activity as this reader may see it. */
  activity(auth: RequestAuth, botId: string): string;
  routines(botId: string): readonly PageBotRoutineInput[];
  runs(botId: string): readonly PageBotRunInput[];
}

export function createBotSource(deps: BotSourceDeps): PageSource {
  return {
    name: "bot",
    label: BOT_SOURCE_LABEL,
    async read(auth, input) {
      if (!deps.person(auth)) throw new PageSourceError("Sign in to see this page's bot.", "sign_in", 401);
      const botId = input.page?.botId;
      if (typeof botId !== "string" || !botId) throw new PageSourceError("This page has no bot.", "unavailable", 404);
      // Same answer when the bot is missing and when this reader may not see
      // it, and neither path reads the name or the routines.
      if (!deps.visible(auth, botId)) throw new PageSourceError("This bot is not available.", "unavailable", 404);
      const found = deps.bot(botId);
      if (!found) throw new PageSourceError("This bot is not available.", "unavailable", 404);
      const view = pageBotView({
        name: found.name,
        approvalMode: deps.approvalMode(botId),
        activity: deps.activity(auth, botId),
        routines: deps.routines(botId),
        runs: deps.runs(botId),
      });
      return { value: view, topics: [botId] };
    },
  };
}
