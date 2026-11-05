// Builds the bot panel's launched-agent rows from hidden peer threads this
// bot opened (agent API send_prompt / create_agent then prompt).
import type { BotActivityStatus } from "../shared/bot-activity.ts";
import type { BotLaunchedAgentItem, BotLaunchedAgentPullRequest } from "../shared/bot-launched-agents.ts";
import { BOT_LAUNCHED_AGENTS_LIMIT, BOT_LAUNCHED_AGENTS_WINDOW_MS } from "../shared/bot-launched-agents.ts";
import { CodeWorkCollector, type RepositoryInfo } from "./activity/activity-code-work.ts";
import { addCodingSignal, isCodingWork, type CodingSignals } from "./activity/activity-coding.ts";
import { turnStartIndex } from "./routes/bot-activity.ts";

export interface LaunchedAgentTask {
  threadId: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
  busy?: boolean;
  activity?: string;
  turnStartedAt?: number;
  hidden?: true;
  openedBy?: { botId: string; at: number };
  cwd?: string | null;
  closedBy?: unknown;
  archivedAt?: number;
}

export interface LaunchedAgentMessage {
  role: string;
  kind: string;
  requestCancelled?: boolean;
  status?: string;
  turnSucceeded?: boolean;
  tool?: { name: string; ok?: boolean; summary?: string; input?: unknown; output?: unknown };
}

export interface LaunchedAgentBot {
  id: string;
  name: string;
  hidden?: boolean;
}

export interface LaunchedAgentsDeps {
  launcherBotId: string;
  bots(): LaunchedAgentBot[];
  tasks(botId: string): LaunchedAgentTask[];
  messages(threadId: string, limit: number): LaunchedAgentMessage[];
  threadReadable(targetBotId: string, threadId: string, viewerId: string | undefined): boolean;
  threadBusy(targetBotId: string, threadId: string): boolean;
  queued(threadId: string): boolean;
  inRepository?(cwd: string): boolean;
  repository?(cwd: string): RepositoryInfo | undefined;
  now?: () => number;
}

const CODING_SCAN = 80;
const SETTLED_SCAN = 12;

function settledStatus(messages: readonly LaunchedAgentMessage[]): BotActivityStatus {
  // A person's Stop marks the request (requestCancelled); the interrupted
  // turn then ends with turnSucceeded: false, which is not a failure.
  const request = messages.findLast((message) => message.role === "user");
  if (request?.requestCancelled) return "stopped";
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === "user") return "finished";
    if (message.requestCancelled) return "stopped";
    if (message.status === "failed" || message.turnSucceeded === false) return "failed";
    if (message.turnSucceeded === true || message.kind === "digest") return "finished";
  }
  return "finished";
}

function displayTitle(task: LaunchedAgentTask, targetName: string): string {
  const raw = task.title.trim();
  const agentSuffix = /^@[^·]+ · agent$/i;
  const body = raw && !agentSuffix.test(raw) ? raw : "";
  return body ? `${targetName}: ${body}` : targetName;
}

/** Coding work, read off the agent's own tool calls and folder from its
 * newest prompt on (turnStartIndex, as a thread entry reads its newest
 * turn): a prompt sent on to the same conversation is its own run, never
 * Coding for an earlier prompt's commit (2026-11-02). Its calls add up, so
 * a run that changed code stays Coding while it reads; with no prompt in
 * the page, the whole page is that run. */
function codingRun(messages: readonly LaunchedAgentMessage[], repository: RepositoryInfo | undefined): boolean {
  const signals: CodingSignals = { edits: 0, codeFiles: 0, vcs: false };
  for (const message of messages.slice(turnStartIndex(messages) + 1)) if (message.tool) addCodingSignal(signals, message.tool);
  return isCodingWork(signals, Boolean(repository));
}

function latestPullRequest(messages: readonly LaunchedAgentMessage[], repository: RepositoryInfo | undefined): BotLaunchedAgentPullRequest | undefined {
  const collector = new CodeWorkCollector(repository?.origin);
  for (const message of messages) if (message.tool) collector.add(message.tool, 0);
  const prs = collector.result().pullRequests;
  if (!prs.length) return undefined;
  const newest = prs.reduce((best, entry) => (entry.at > best.at ? entry : best), prs[0]!);
  if (!newest.number) return undefined;
  return { number: newest.number, ...(newest.url ? { url: newest.url } : {}) };
}

function statusOf(task: LaunchedAgentTask, deps: LaunchedAgentsDeps): BotActivityStatus {
  if (task.busy) return task.activity === "waiting-on-you" ? "waiting" : "running";
  if (deps.queued(task.threadId)) return "queued";
  return settledStatus(deps.messages(task.threadId, SETTLED_SCAN));
}

export function launchedAgentsForBot(deps: LaunchedAgentsDeps, viewerId: string | undefined): BotLaunchedAgentItem[] {
  const now = (deps.now ?? Date.now)();
  const since = now - BOT_LAUNCHED_AGENTS_WINDOW_MS;
  const out: BotLaunchedAgentItem[] = [];
  for (const peer of deps.bots()) {
    if (peer.hidden) continue;
    for (const task of deps.tasks(peer.id)) {
      if (task.archivedAt || task.closedBy) continue;
      if (task.hidden !== true) continue;
      if (task.openedBy?.botId !== deps.launcherBotId) continue;
      const updatedAt = task.updatedAt ?? task.createdAt;
      const status = statusOf(task, deps);
      const active = status === "running" || status === "waiting" || status === "queued";
      if (!active && updatedAt < since) continue;
      const readable = deps.threadReadable(peer.id, task.threadId, viewerId);
      const messages = deps.messages(task.threadId, CODING_SCAN);
      const repository = task.cwd && deps.inRepository?.(task.cwd) ? deps.repository?.(task.cwd) : undefined;
      const coding = codingRun(messages, repository);
      const pullRequest = coding && status === "failed" ? latestPullRequest(messages, repository) : undefined;
      out.push({
        id: `thread:${task.threadId}`,
        targetBotId: peer.id,
        targetBotName: peer.name,
        title: displayTitle(task, peer.name),
        status,
        startedAt: task.openedBy?.at ?? task.createdAt,
        updatedAt,
        ...(readable ? { threadId: task.threadId } : {}),
        ...(coding ? { coding: true as const } : {}),
        ...(pullRequest ? { pullRequest } : {}),
      });
    }
  }
  return out
    .sort((a, b) => {
      const active = (s: BotActivityStatus) => s === "running" || s === "waiting" || s === "queued";
      return Number(active(b.status)) - Number(active(a.status)) || b.updatedAt - a.updatedAt;
    })
    .slice(0, BOT_LAUNCHED_AGENTS_LIMIT);
}
