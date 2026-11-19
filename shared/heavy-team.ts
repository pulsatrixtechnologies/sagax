// Heavy mode (#4901): a Team of Experts. Several agents work on the request in
// parallel, each on its own model, then a Leader (the turn itself, on the
// strongest model) reads what they found and writes the one answer.
//
// The state of a run lives on one activity row of the conversation
// (`tool.team`), patched while it runs: the chat draws "Agents thinking · 6s"
// with a live preview of the exchange, then "Thought for 8s", which opens the
// Thoughts panel with each agent's messages and the Leader's steps. The final
// answer is the Leader's ordinary reply, in the chat. The agents themselves
// are hidden threads of the same bot (server/index-leaves/runHeavyTeam.ts),
// never listed; the row keeps everything the panel shows.

/** The row's tool name, for a client that does not draw the team. */
export const HEAVY_TEAM_TOOL_NAME = "Team of Experts";

export type HeavyAgentStatus = "working" | "done" | "failed" | "stopped";

export interface HeavyAgentLine {
  /** 1-based: "Agent 1". */
  n: number;
  engineLabel: string;
  modelLabel: string;
  status: HeavyAgentStatus;
  /** What the agent wrote, in order, each as the engine ended it. */
  messages: string[];
  /** The message being written now (a streaming one), shown live and then folded into `messages`. */
  live?: string;
  endedAt?: number;
  /** Why a failed agent failed, in a few words. */
  error?: string;
}

/** The Leader's steps, as codes the reader translates. */
export type HeavyLeaderStepKind = "sent" | "processing" | "writing";
export interface HeavyLeaderStep {
  kind: HeavyLeaderStepKind;
  at: number;
}

/** agents: working in parallel; leader: they are done, the Leader writes;
 * done: the Leader's reply started (the row reads "Thought for Ns");
 * stopped: the person stopped the turn or the server restarted. */
export type HeavyPhase = "agents" | "leader" | "done" | "stopped";

export interface HeavyTeamLine {
  phase: HeavyPhase;
  startedAt: number;
  /** When the agents finished (the Leader started): "Thought for" runs to here. */
  thoughtEndedAt?: number;
  /** The last time the server patched the row; a row nobody patches any more is a stopped one. */
  updatedAt: number;
  agents: HeavyAgentLine[];
  leader: { engineLabel: string; modelLabel: string; steps: HeavyLeaderStep[] };
}

/** How long the team thought, in ms: running, until now; finished, until the Leader started. */
export function heavyThoughtMs(line: HeavyTeamLine, now: number, running: boolean): number {
  const end = line.thoughtEndedAt ?? (running ? now : line.updatedAt);
  return Math.max(0, end - line.startedAt);
}

/** Whether the row still shows a live run: the server patched it and the chat's turn still works. */
export function heavyIsRunning(line: HeavyTeamLine, busy: boolean): boolean {
  return busy && (line.phase === "agents" || line.phase === "leader");
}

/** Limits that keep the row small enough to ride a message: a run's whole record fits in a few tens of KB. */
export const HEAVY_MESSAGE_CHARS = 4_000;
export const HEAVY_MESSAGES_PER_AGENT = 12;
