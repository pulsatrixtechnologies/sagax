// #3581: what enters a bot's main chat. One rule, read by the server when it
// posts and by the apps when they draw (the phone reads the same cases from
// chat-relevance.vectors.json). Pure: no store, no clock.
//
// A row is for the person when it is one of four things: an answer to their
// own message, something that waits for them, a result they asked to
// receive, or a problem that needs them. Everything else is work, and work is
// never content in the main chat: it stays in its own thread, reachable from
// a surface that already exists (a routine's runs, the bot's panel, the name
// on a "Asked by" line). This is how every bot behaves: there is no switch.

import { backgroundOrigin, type BackgroundTaskFacts } from "./background-threads.ts";

/** Who the turn was for. */
export type ChatOrigin =
  /** The person's own conversation with the bot, a background task of it,
   * and the hand-offs its turn started. */
  | "person"
  /** A routine run or a wake. */
  | "routine"
  /** A thread another bot or the bot itself opened. */
  | "bot"
  /** An AI client's conversation (send_prompt over MCP). */
  | "agent";

/** What the row is, first match wins. */
export type ChatSignal =
  /** An open card or question: it waits for the person. */
  | "wait"
  /** A failure, a block, a result with problems, works again after
   * problems, an item tagged for the person (shared/person-attention.ts). */
  | "problem"
  /** The final message of a turn, or a relayed reply that stands for it. */
  | "answer"
  /** The report of a finished run or background task with none of the above. */
  | "result"
  /** Notes, steps, receipts, traces. */
  | "work";

/** Where the row goes in the main chat. */
export type ChatPlace =
  /** A card in the chat (what waits is pinned at the foot). */
  | "card"
  /** The whole message. */
  | "whole"
  /** Folded behind the turn's row, or one names line for the bots it asked. */
  | "folded"
  /** One quiet line that says the exchange happened; its content stays out. */
  | "trace"
  /** Nothing in the main chat: it stays in its own thread. */
  | "out";

export interface ChatPlaceFacts {
  /** `person` with `result`: the background task answers a message of the
   * person (else the bot opened it itself). */
  answersPerson?: boolean;
  /** `routine` with `result`: the routine posts its results in the
   * conversation (the routine's own choice; a wake the person opted into
   * posts when it has something). */
  postsResults?: boolean;
  /** `routine` with `result`: a person started this run. */
  startedByPerson?: boolean;
}

export const CHAT_ORIGINS: readonly ChatOrigin[] = ["person", "routine", "bot", "agent"];
export const CHAT_SIGNALS: readonly ChatSignal[] = ["wait", "problem", "answer", "result", "work"];

/** The rule. */
export function chatPlace(origin: ChatOrigin, signal: ChatSignal, facts: ChatPlaceFacts = {}): ChatPlace {
  if (signal === "wait" || signal === "problem") return "card";
  switch (origin) {
    case "person":
      if (signal === "answer") return "whole";
      if (signal === "result") return facts.answersPerson === true ? "whole" : "folded";
      return "folded";
    case "routine":
      if (signal === "result") return facts.postsResults === true || facts.startedByPerson === true ? "card" : "out";
      return "out";
    case "bot":
    case "agent":
      return "trace";
  }
}

/** Who a thread's turn was for, from the one reading of a thread's origin
 * (shared/background-threads.ts). A thread that is none of the background
 * kinds is the person's own conversation. */
export function chatOrigin(task: BackgroundTaskFacts | null | undefined): ChatOrigin {
  switch (task ? backgroundOrigin(task) : null) {
    case "routine-run":
    case "routine-results": return "routine";
    case "ai-client": return "agent";
    case "handoff":
    case "bot-opened": return "bot";
    default: return "person";
  }
}

/** The facts of a routine run the rule reads (server/routines/routine-report.ts). */
export interface ChatRunFacts {
  status: string;
  goalStatus?: string;
  /** The run ended with nothing for the person (its report said so). */
  quiet?: boolean;
  /** An approval or question card in the run's task waits on the person. */
  needsPerson?: boolean;
  /** The run completed with problems. */
  problems?: unknown;
  /** Its report holds items only the person can do. */
  attention?: boolean;
  /** The first run without problems after runs with problems. */
  recovered?: unknown;
  startedBy?: string;
}

const LIVE_RUN = new Set(["queued", "running", "waiting"]);

/** What a routine run's row is. A run a person started is a result from its
 * start (its row shows what started); another live run is work until it ends. */
export function routineRunSignal(run: ChatRunFacts): ChatSignal {
  if (run.goalStatus === "needs-input") return "wait";
  if (run.status === "waiting" && run.needsPerson === true) return "wait";
  if (run.status === "failed" || run.status === "blocked") return "problem";
  if (run.status === "completed") {
    if (run.problems || run.attention === true || run.recovered) return "problem";
    return run.quiet === true ? "work" : "result";
  }
  if (run.startedBy === "person" && LIVE_RUN.has(run.status)) return "result";
  return "work";
}
