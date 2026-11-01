// Agents a bot launched through the agent-to-agent API (send_prompt on a
// peer's hidden conversation). GET /api/bots/:id/activity `launchedAgents`.
// The bot panel lists the coding ones (`coding`) under Details > Coding and
// the rest (a dispatch run, bot-to-bot work) under Activity.
import type { BotActivityStatus } from "./bot-activity-status.ts";

export interface BotLaunchedAgentPullRequest {
  number: number;
  url?: string;
}

export interface BotLaunchedAgentItem {
  /** `thread:<threadId>` on the target bot */
  id: string;
  /** The bot that runs the agent (the peer that was prompted). */
  targetBotId: string;
  targetBotName: string;
  /** Shown as “{targetBotName}: {title}”. */
  title: string;
  status: BotActivityStatus;
  startedAt: number;
  updatedAt: number;
  /** Open the agent's hidden conversation when the viewer may read it. */
  threadId?: string;
  /** Coding work (server/activity-coding.ts, read off its tool calls and
   * folder, never its title). Absent for everything else. */
  coding?: true;
  /** The pull request tied to a failed run, when the agent opened one. */
  pullRequest?: BotLaunchedAgentPullRequest;
}

export const BOT_LAUNCHED_AGENTS_LIMIT = 20;
export const BOT_LAUNCHED_AGENTS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
