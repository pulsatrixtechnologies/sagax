// Heavy mode (#4901, rebuilt by #5089, owner 2026-11-19, M-20261119-077,
// D-20261119-084, D-20261119-085): a team of experts, the Grok way. The bot
// (the leader) starts 2 to 5 copies of itself, the number and each one's
// persona chosen for the task; the experts are read-only (the server holds
// them there, server/heavy-team.ts); round 1 each proposes, then they
// critique each other round after round until they agree, at most
// HEAVY_MAX_ROUNDS; without agreement the leader decides and shows what is
// still disputed beside the plan. The bot then runs the plan once, with its
// usual writes and cards.
//
// The state of a run lives on one activity row of the conversation
// (`tool.team`), patched while it runs: the chat draws the experts around
// the bot (they pulse while they speak, lines link them while they critique,
// they merge into the bot on agreement), then "Thought for 8s", which opens
// the Thoughts panel with each expert's messages and the leader's steps. The
// experts are hidden threads of the same bot, never listed; the row keeps
// everything the panel shows.

/** The row's tool name, for a client that does not draw the team. */
export const HEAVY_TEAM_TOOL_NAME = "Team of Experts";

/** D-20261119-084: the leader starts 2 to 5 experts, the number it chooses. */
export const HEAVY_MIN_EXPERTS = 2;
export const HEAVY_MAX_EXPERTS = 5;
/** D-20261119-085: proposals, then critiques until agreement, 5 rounds at most. */
export const HEAVY_MAX_ROUNDS = 5;

export type HeavyAgentStatus = "working" | "done" | "failed" | "stopped";

export interface HeavyAgentLine {
  /** 1-based: "Expert 1". */
  n: number;
  /** The persona the leader gave it for this task ("Skeptic", "Security"). */
  persona?: string;
  engineLabel: string;
  modelLabel: string;
  status: HeavyAgentStatus;
  /** What the expert wrote, in order, one per round as the engine ended it. */
  messages: string[];
  /** The message being written now (a streaming one), shown live and then folded into `messages`. */
  live?: string;
  /** Its turn of the current round is running: its avatar pulses. */
  speaking?: boolean;
  /** Its verdict on the others' plan in the last critique round. */
  agrees?: boolean;
  endedAt?: number;
  /** Why a failed expert failed, in a few words. */
  error?: string;
}

/** The leader's steps, as codes the reader translates. */
export type HeavyLeaderStepKind = "planned" | "sent" | "processing" | "agreed" | "decided" | "writing";
export interface HeavyLeaderStep {
  kind: HeavyLeaderStepKind;
  at: number;
  /** The round it happened in (agreed, decided). */
  round?: number;
}

/** One round: the proposals, then each round of cross critiques. */
export interface HeavyRoundLine {
  n: number;
  kind: "propose" | "critique";
  startedAt: number;
  endedAt?: number;
  /** Every expert that answered agreed with the others' plan. */
  agreed?: boolean;
}

/** planning: the leader picks the team; agents: the rounds run; leader:
 * they are done, the leader writes; done: the leader's reply started (the
 * row reads "Thought for Ns"); stopped: the person stopped the turn or the
 * server restarted. */
export type HeavyPhase = "planning" | "agents" | "leader" | "done" | "stopped";

export interface HeavyTeamLine {
  phase: HeavyPhase;
  startedAt: number;
  /** When the rounds ended (the leader started): "Thought for" runs to here. */
  thoughtEndedAt?: number;
  /** The last time the server patched the row; a row nobody patches any more is a stopped one. */
  updatedAt: number;
  agents: HeavyAgentLine[];
  rounds: HeavyRoundLine[];
  maxRounds: number;
  /** agreed: the experts agreed; decided: no agreement after the last round, the leader decides. */
  outcome?: "agreed" | "decided";
  /** What is still disputed when the leader decided. */
  disagreements?: string[];
  /** D-20261119-086: plain Auto chose Heavy for this request: a big task or a risky one. */
  auto?: "big" | "risky";
  leader: { engineLabel: string; modelLabel: string; steps: HeavyLeaderStep[] };
}

/** How long the team thought, in ms: running, until now; finished, until the leader started. */
export function heavyThoughtMs(line: HeavyTeamLine, now: number, running: boolean): number {
  const end = line.thoughtEndedAt ?? (running ? now : line.updatedAt);
  return Math.max(0, end - line.startedAt);
}

/** Whether the row still shows a live run: the server patched it and the chat's turn still works. */
export function heavyIsRunning(line: HeavyTeamLine, busy: boolean): boolean {
  return busy && (line.phase === "planning" || line.phase === "agents" || line.phase === "leader");
}

/** The round running now, if any. */
export function heavyCurrentRound(line: HeavyTeamLine): HeavyRoundLine | undefined {
  const last = line.rounds.at(-1);
  return last && last.endedAt === undefined ? last : undefined;
}

/** Limits that keep the row small enough to ride a message: a run's whole record fits in a few tens of KB. */
export const HEAVY_MESSAGE_CHARS = 4_000;
export const HEAVY_MESSAGES_PER_AGENT = HEAVY_MAX_ROUNDS;
