// Heavy mode (#4901) in the person's words: the row's header, the Leader's
// steps and an agent's state. The state itself is shared/heavy-team.ts.
import { t } from "@/lib/i18n";
import { formatElapsed } from "@/lib/working-time";
import {
  heavyIsRunning, heavyThoughtMs,
  type HeavyAgentLine, type HeavyLeaderStep, type HeavyTeamLine,
} from "../../shared/heavy-team";

export { heavyIsRunning, heavyThoughtMs };

/** The owls that stand for the agents, one plumage each (the palette's vivid colours). */
export const AGENT_COLORS = ["blue", "green", "orange", "purple", "pink"] as const;

/** The row's header: "Agents thinking · 6s" while they work, "Thought for 8s" after. */
export function heavyHeader(line: HeavyTeamLine, busy: boolean, now: number): string {
  const elapsed = formatElapsed(heavyThoughtMs(line, now, heavyIsRunning(line, busy)));
  // a run nobody patches any more (the server restarted, the turn was stopped) never reads as thinking
  if (line.phase === "stopped" || (line.phase === "agents" && !busy)) return t("heavy.stopped", { elapsed });
  if (line.phase === "agents") return t("heavy.running", { elapsed });
  return t("heavy.thought", { elapsed });
}

export function leaderStepText(step: HeavyLeaderStep): string {
  switch (step.kind) {
    case "sent": return t("heavy.leader.sent");
    case "processing": return t("heavy.leader.processing");
    case "writing": return t("heavy.leader.writing");
  }
}

/** The step the Leader is on: the last one. */
export function leaderNow(line: HeavyTeamLine): HeavyLeaderStep {
  return line.leader.steps.at(-1) ?? { kind: "processing", at: line.startedAt };
}

/** What an agent shows in the live preview: what it is writing, else its last message, else that it thinks. */
export function agentPreview(agent: HeavyAgentLine): string {
  const text = (agent.live ?? agent.messages.at(-1) ?? "").replace(/\s+/g, " ").trim();
  if (text) return text;
  if (agent.status === "failed" && agent.error) return agent.error;
  return agent.status === "working" ? t("heavy.agent.working") : agent.status === "failed" ? t("heavy.agent.failed") : agent.status === "stopped" ? t("heavy.agent.stopped") : t("heavy.agent.nothing");
}

export function agentStatusText(agent: HeavyAgentLine): string {
  switch (agent.status) {
    case "working": return t("heavy.agent.working");
    case "done": return t("heavy.agent.done");
    case "failed": return t("heavy.agent.failed");
    case "stopped": return t("heavy.agent.stopped");
  }
}

/** Whether a message is a Heavy run's row. */
export function heavyLineOf(message: { kind: string; tool?: { team?: HeavyTeamLine } }): HeavyTeamLine | null {
  return message.kind === "activity" ? message.tool?.team ?? null : null;
}
