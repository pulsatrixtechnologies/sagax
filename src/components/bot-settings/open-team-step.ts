// A step's coding chat, in a module of its own: the chat's note line opens it from the launch
// bundle, and ActivitySection (the whole Coding section) must stay off that path.
import type { Action } from "@/state/store";
import type { TeamWorkStep } from "@/lib/team-work";
import type { BotActivityStatus } from "../../../shared/bot-activity-status";
import type { TeamOpenStep } from "./TeamWorkSection";

/** The runtime status of a step, as the coding chat's header reads it. */
export function stepActivityStatus(status: TeamWorkStep["status"] | undefined): BotActivityStatus {
  switch (status) {
    case "queued": return "queued";
    case "needs_input":
    case "waiting": return "waiting";
    case "completed": return "finished";
    case "failed":
    case "expired": return "failed";
    case "cancelled": return "stopped";
    default: return "running";
  }
}

/** A step's coding chat: the team bot's thread, opened
 * where the chat is; the selected bot stays the orchestrator (#3462). */
export function openTeamStep(dispatch: (action: Action) => void, orchestratorId: string, step: TeamOpenStep, now = Date.now()): void {
  const itemId = `thread:${step.threadId}`;
  dispatch({
    type: "openCodingChat",
    target: {
      botId: step.botId,
      itemId,
      threadId: step.threadId,
      seed: { id: itemId, kind: "session", botId: step.botId, title: step.name, status: stepActivityStatus(step.status), startedAt: step.startedAt ?? now, updatedAt: now, threadId: step.threadId, coding: true },
      step: {
        orchestratorId,
        name: step.name,
        ...(step.work ? { work: step.work } : {}),
        ...(step.index !== undefined ? { index: step.index } : {}),
        ...(step.total !== undefined ? { total: step.total } : {}),
      },
    },
  });
}
