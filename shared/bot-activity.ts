// What a bot is doing and did lately, as its side panel lists it (Details >
// Coding and Activity): its conversations' engine sessions (Claude Code, Codex, ...), the
// work other bots handed it (coordinate_bots, delegations), the sub-agents
// it handed to other bots, and its routine runs. Served by
// GET /api/bots/:id/activity (server/routes/bot-activity.ts), narrowed to
// what the asking person may read: on an organization server their own
// threads only, and the routines they may see (routineSeenBy).
import type { BotLaunchedAgentItem } from "./bot-launched-agents.ts";
import type { WireAccessCard } from "./wire.ts";

export type { BotActivityStatus } from "./bot-activity-status.ts";
import type { BotActivityStatus } from "./bot-activity-status.ts";

export type BotActivityKind = "session" | "routine" | "hop" | "subagent";

export interface BotActivityActor {
  kind: "person" | "bot" | "routine";
  name: string;
}

export interface BotActivityItem {
  /** `thread:<threadId>` or `run:<routineRunId>` */
  id: string;
  kind: BotActivityKind;
  /** The bot the work runs on (another bot's, for a sub-agent). */
  botId: string;
  botName?: string;
  /** A conversation's entry: the request its newest turn answers, once the
   * conversation had others (else the thread's title). */
  title: string;
  /** The conversation's own title, when `title` is a later request. */
  threadTitle?: string;
  /** That request is the same words sent again (Regenerate, Retry). */
  retry?: boolean;
  status: BotActivityStatus;
  startedAt: number;
  /** Absent while it runs. */
  endedAt?: number;
  updatedAt: number;
  /** Present only when the viewer may open that conversation. */
  threadId?: string;
  startedBy?: BotActivityActor;
  /** Sub-agents and hops this one started, counted for the card. */
  childCount?: number;
  /** Coding work (server/activity-coding.ts): its newest turn edited code,
   * ran version control or changed files inside a repository (a thread
   * whose folder is a repository: any turn). Read off its tool calls and
   * folder, never its title. Absent for everything else, an ordinary
   * conversation's turn that did no code work included. */
  coding?: boolean;
  /** While it runs: the tool call in flight (or the newest), or what a
   * waiting run asks. */
  currentStep?: string;
  /** While it runs: the viewer may stop it (thread.post on its thread). */
  canStop?: boolean;
  /** A listed sub-agent: the entry that started it. */
  parentId?: string;
  /** A parallel task of a conversation (shared/parallel-tasks.ts): the
   * person can steer it (send it a message) and stop it on its own. */
  parallel?: boolean;
  /** The code work of an entry that did coding work in any turn read
   * (server/activity-code-work.ts): its repository folder and branch, and
   * the pull requests, branches and commits its own git, gh and GitHub tool
   * calls produced. Present even when its newest turn is not coding, so the
   * Coding section's code work keeps it. Absent for everything else. */
  code?: BotCodeWork;
  /** The engine and model this work runs on, when known. */
  engine?: { instanceId: string; model: string };
}

/** What the bot did to a pull request, read off its own calls (`gh pr
 * create` opened it, `gh pr merge` merged it, ...). Not GitHub's live
 * state: nothing here asks GitHub. */
export type BotCodePullAction = "opened" | "merged" | "closed" | "updated";

export interface BotCodePullRequest {
  /** owner/name, when known. */
  repo?: string;
  number?: number;
  title?: string;
  /** The pull request's web page, when known. */
  url?: string;
  action: BotCodePullAction;
  /** Its head branch, when the call named it (or it was the current one). */
  branch?: string;
  at: number;
}

export interface BotCodeBranch {
  name: string;
  repo?: string;
  /** Pushed to a remote (else only created where the bot works). */
  pushed: boolean;
  url?: string;
  at: number;
}

export interface BotCodeCommit {
  sha: string;
  message?: string;
  branch?: string;
  repo?: string;
  pushed: boolean;
  url?: string;
  at: number;
}

export interface BotCodeWork {
  /** The folder its turns run in, when it is a git repository on the
   * server (a folder on the person's computer is not read). */
  folder?: string;
  /** That folder's checked-out branch now. */
  branch?: string;
  /** owner/name of that folder's origin remote. */
  repo?: string;
  repoUrl?: string;
  pullRequests: BotCodePullRequest[];
  branches: BotCodeBranch[];
  commits: BotCodeCommit[];
}

/** GET /api/bots/:id/activity: the entries (`?filter=coding|other`), and
 * the sub-agents their threads started, running or recent. */
export interface BotActivityList {
  items: BotActivityItem[];
  subagents: BotActivityItem[];
  /** Hidden peer conversations this bot opened (agent API send_prompt). */
  launchedAgents?: BotLaunchedAgentItem[];
}

export interface BotActivityStep {
  id: string;
  name: string;
  summary?: string;
  /** undefined while the call runs */
  ok?: boolean;
  at: number;
  /** Organization server: the person's own computer (the desktop bridge)
   * or their server environment. Absent on a solo server. */
  where?: "computer" | "server";
  files?: string[];
  /** The call's arguments as the chat shows them (bounded, redacted). */
  input?: string;
  /** A call a sub-agent made: the step of the Agent call that started it. */
  parentId?: string;
  /** On a sub-agent's own step (Claude's Agent tool): what it was asked
   * and, once done, what it reported. */
  subagent?: { description?: string; prompt?: string; type?: string; result?: string };
}

export interface BotActivityDetail extends BotActivityItem {
  engine?: { instanceId: string; model: string };
  /** Whose credentials the newest turn ran with (TurnDigest.access). */
  via?: "subscription" | "owner-key" | "speaker-key" | "server" | "org-key";
  payer?: "speaker" | "owner" | "organization";
  /** The newest turn's tool calls (an earlier turn's stay in the
   * conversation). */
  steps: BotActivityStep[];
  /** Older steps exist beyond the ones listed (an earlier turn, or past the
   * page). */
  stepsTruncated: boolean;
  files: string[];
  /** The sub-agents the newest turn started. */
  children: BotActivityItem[];
  /** A routine run's error or the question it waits on. */
  note?: string;
  /** The viewer may stop it now. */
  canStop: boolean;
  /** A failed routine run refused for lack of credentials (or paused): its
   * access card, only when the viewer is in the card's audience
   * (accessCardAudience). The bot's owner reads it here even when the run's
   * thread is another person's private one; nothing else of that thread. */
  access?: WireAccessCard;
}

export const BOT_ACTIVITY_LIMIT = 20;
export const BOT_ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60_000;
export const BOT_ACTIVITY_STEPS = 200;

export function activityStatusActive(status: BotActivityStatus): boolean {
  return status === "running" || status === "waiting" || status === "queued";
}
