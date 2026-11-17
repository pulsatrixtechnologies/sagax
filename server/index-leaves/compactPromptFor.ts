// @ts-nocheck
/** compactPromptFor (#1388). Pure move from server/index.ts.
 * #4527: the turn's prompt is counted in its conversation's session and the
 * session's frozen verdict (server/tools/tool-keep.ts) gives what a compact
 * prompt lists whole: the bot's own use only, decided at the session's
 * first turn and the same for every later turn of it. */
import { compactMemoryDir } from "../context/compact-prompt.ts";
import { toolKeepTurn, type ToolKeepContext } from "../tools/tool-keep.ts";
export type Host = Record<string, any>;

export interface CompactTurn {
  threadId: string;
  /** the compaction record in force in the conversation */
  compaction?: string | null;
  /** a routine, webhook or other automation run */
  routine?: boolean;
  /** false for a warm start: no prompt counted */
  prompt: boolean;
  context?: ToolKeepContext;
}

export function createCompactPromptFor(getHost: () => Host): any {
function compactPromptFor(bot: BotRecord, person: string, turn: CompactTurn) {
  const host = getHost();
  const { DATA_DIR } = host;
  // a cheap lookup by bot: this runs on every turn of every engine
  const hasRoutines = host.routines?.hasRoutineForBot?.(bot.id);
  const verdict = toolKeepTurn({
    botId: bot.id,
    person,
    threadId: turn.threadId,
    compaction: turn.compaction ?? null,
    routine: turn.routine === true,
    prompt: turn.prompt,
    ...(typeof hasRoutines === "boolean" ? { hasRoutines } : {}),
    ...(turn.context ? { context: turn.context } : {}),
  });
  // lot C: the session's left out tools ride beside the compact pins (the
  // caller takes them off before a compact prompt is handed to an engine)
  return { ...verdict.pins, memoryDir: compactMemoryDir(DATA_DIR, bot.id, person), leftOut: verdict.leftOut };

}
  return compactPromptFor;
}
