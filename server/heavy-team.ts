// Heavy mode (#4901), the pure half: what each agent of a Team of Experts is
// asked, the notes the Leader reads, and the state of a run as the chat's row
// shows it (shared/heavy-team.ts). The running half, which opens the agents'
// hidden threads on the same machinery as run_with_engine, is
// server/index-leaves/runHeavyTeam.ts.
import type { ModeModel } from "../shared/model-mode.ts";
import {
  HEAVY_MESSAGES_PER_AGENT, HEAVY_MESSAGE_CHARS,
  type HeavyAgentLine, type HeavyAgentStatus, type HeavyLeaderStepKind, type HeavyTeamLine,
} from "../shared/heavy-team.ts";

/** The hidden threads of the agents working now. They are the one turn's own work, not threads the
 * person opened: they do not count toward the bot's limit of parallel threads (the Leader's turn and
 * five agents would never fit under the default three). */
const agentThreads = new Set<string>();
export const heavyAgentThreads = {
  add: (threadId: string): void => { agentThreads.add(threadId); },
  delete: (threadId: string): void => { agentThreads.delete(threadId); },
  has: (threadId: string): boolean => agentThreads.has(threadId),
};

/** The angle of each agent, so a team on one model does not write one answer three times. */
export const HEAVY_ANGLES: readonly string[] = [
  "Answer the request directly and completely, as the best expert on it would.",
  "Look for what the direct answer could miss: a wrong assumption, an edge case, a risk, a better option.",
  "Check the facts and the details the answer depends on, and say how sure you are of each.",
  "Come at it from another direction than the obvious one, and say what you would do differently.",
  "Write the shortest version that is still correct, and say what to do first.",
];

export function angleOf(n: number): string {
  return HEAVY_ANGLES[(n - 1) % HEAVY_ANGLES.length]!;
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The opening of an agent's hidden thread: the bot's own words, never the person's. */
export function agentPrompt(input: { n: number; count: number; modelLabel: string; request: string; context?: string }): string {
  const context = input.context?.trim();
  return [
    `[You are Agent ${input.n} of ${input.count} on a team of experts working in parallel on one request, on ${input.modelLabel}. A Leader reads everyone's work, then writes the only answer the person sees. This is your own work for the same person, in a thread of its own.]`,
    `Your angle: ${angleOf(input.n)}`,
    "Think and look things up as far as the request needs. Do not take outward actions (no sending, writing, deleting, buying, posting or changing anything for the person): the Leader does those after reading the team. Reply with your findings and your recommended answer, complete and plain, as short as the request allows. Address the Leader, not the person.",
    ...(context ? [`The conversation so far:\n${context}`] : []),
    `The request:\n${input.request.trim()}`,
  ].join("\n\n");
}

/** The last few lines of the conversation, for an agent that starts with none. */
export function conversationContext(messages: ReadonlyArray<{ role: string; kind?: string; text?: string }>, limit = 6, each = 1_200): string {
  return messages
    .filter((message) => (message.role === "user" || message.role === "bot") && (message.kind === undefined || message.kind === "text") && message.text?.trim())
    .slice(-limit)
    .map((message) => `${message.role === "user" ? "Person" : "You"}: ${clip(message.text!.trim(), each)}`)
    .join("\n");
}

export interface HeavyAgentResult {
  n: number;
  modelLabel: string;
  status: HeavyAgentStatus;
  text: string;
}

const AGENT_NOTE_CHARS = 6_000;
const NOTES_CHARS = 24_000;

/** The Leader's section of the prompt: what the team found, and what is left to it. */
export function leaderNotes(results: readonly HeavyAgentResult[]): string {
  const usable = results.filter((result) => result.status === "done" && result.text.trim());
  const head = "\n## Team of Experts (Heavy mode)\n";
  if (!usable.length) {
    return `${head}The person chose Heavy. A team of ${results.length} agents worked on this request first and none of them came back with anything usable. Answer the request yourself, with your full strength, and do not mention the team.\n`;
  }
  const budget = Math.floor(NOTES_CHARS / usable.length);
  const notes = usable.map((result) => `### Agent ${result.n} (${result.modelLabel})\n${clip(result.text.trim(), Math.min(AGENT_NOTE_CHARS, budget))}`).join("\n\n");
  const missing = results.length - usable.length;
  return `${head}The person chose Heavy. Before you answer, ${results.length} agents worked on their request in parallel, each on its own model. You are the Leader: read what they found, weigh where they agree and where they differ, check anything doubtful yourself, then give the person ONE final answer in your own words. Never paste the agents' messages or mention a team, agents or this section unless asked. The agents took no action: do whatever the request calls for yourself.${missing ? ` ${missing} of them did not finish.` : ""}\n\n${notes}\n`;
}

/** What an agent's turn came to: askBotAndWait's outcome in words the row keeps. */
export type HeavyAgentOutcome = { status: "reply" | "failed" | "error" | "timeout"; text: string };

export function agentStatusOf(outcome: HeavyAgentOutcome): "done" | "failed" {
  return outcome.status === "reply" ? "done" : "failed";
}

/** The row's state, kept as events arrive and published at most every `throttleMs`. */
export class HeavyTeamTracker {
  readonly line: HeavyTeamLine;
  private lastPublished = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly publish: (line: HeavyTeamLine) => void;
  private readonly now: () => number;
  private readonly throttleMs: number;

  constructor(
    team: readonly ModeModel[],
    leader: Pick<ModeModel, "engineLabel" | "modelLabel">,
    publish: (line: HeavyTeamLine) => void,
    now: () => number = Date.now,
    throttleMs = 400,
  ) {
    this.publish = publish;
    this.now = now;
    this.throttleMs = throttleMs;
    const at = now();
    this.line = {
      phase: "agents",
      startedAt: at,
      updatedAt: at,
      agents: team.map((agent, index): HeavyAgentLine => ({ n: index + 1, engineLabel: agent.engineLabel, modelLabel: agent.modelLabel, status: "working", messages: [] })),
      leader: { engineLabel: leader.engineLabel, modelLabel: leader.modelLabel, steps: [{ kind: "sent", at }, { kind: "processing", at }] },
    };
  }

  private agent(n: number): HeavyAgentLine | undefined {
    return this.line.agents.find((agent) => agent.n === n);
  }

  /** Text an agent is writing now: the live preview, never kept on its own. */
  delta(n: number, text: string): void {
    const agent = this.agent(n);
    if (!agent || agent.status !== "working") return;
    agent.live = clip(`${agent.live ?? ""}${text}`, HEAVY_MESSAGE_CHARS);
    this.touch();
  }

  /** A message an agent finished: kept, in order, within the row's limits. */
  message(n: number, text: string): void {
    const agent = this.agent(n);
    const body = text.trim();
    if (!agent || !body) return;
    delete agent.live;
    if (agent.messages.length < HEAVY_MESSAGES_PER_AGENT) agent.messages.push(clip(body, HEAVY_MESSAGE_CHARS));
    this.touch();
  }

  finish(n: number, status: Exclude<HeavyAgentStatus, "working">, error?: string): void {
    const agent = this.agent(n);
    if (!agent || agent.status !== "working") return;
    delete agent.live;
    agent.status = status;
    agent.endedAt = this.now();
    if (error) agent.error = clip(error, 200);
    this.touch();
  }

  /** Every agent is done: the Leader writes. */
  agentsDone(): void {
    this.line.phase = "leader";
    this.line.thoughtEndedAt = this.now();
    this.line.leader.steps.push({ kind: "writing", at: this.line.thoughtEndedAt });
    this.flush();
  }

  /** The Leader's reply started. */
  leaderStarted(): void {
    if (this.line.phase === "stopped") return;
    this.line.phase = "done";
    this.flush();
  }

  /** The person stopped the turn: what still worked stops with it. */
  stop(): void {
    for (const agent of this.line.agents) if (agent.status === "working") this.finish(agent.n, "stopped");
    this.line.phase = "stopped";
    this.line.thoughtEndedAt ??= this.now();
    this.flush();
  }

  leaderStep(kind: HeavyLeaderStepKind): void {
    this.line.leader.steps.push({ kind, at: this.now() });
    this.touch();
  }

  private touch(): void {
    this.line.updatedAt = this.now();
    if (this.timer) return;
    const wait = Math.max(0, this.lastPublished + this.throttleMs - this.now());
    if (wait === 0) {
      this.flush();
      return;
    }
    this.timer = setTimeout(() => this.flush(), wait);
    this.timer.unref?.();
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.lastPublished = this.now();
    this.line.updatedAt = this.lastPublished;
    this.publish(structuredClone(this.line));
  }
}

/** Runs every agent at once and reports each as it ends; an agent that throws is a failed one, never the run's failure. */
export async function runAgents(input: {
  team: readonly ModeModel[];
  tracker: HeavyTeamTracker;
  runAgent: (agent: ModeModel, n: number, hooks: { onDelta: (text: string) => void; onMessage: (text: string) => void }) => Promise<HeavyAgentOutcome>;
}): Promise<HeavyAgentResult[]> {
  const { tracker } = input;
  const results = await Promise.all(input.team.map(async (agent, index): Promise<HeavyAgentResult> => {
    const n = index + 1;
    try {
      const outcome = await input.runAgent(agent, n, { onDelta: (text) => tracker.delta(n, text), onMessage: (text) => tracker.message(n, text) });
      const status = agentStatusOf(outcome);
      // an engine that only reports its reply when the turn ends still shows it
      const kept = tracker.line.agents.find((line) => line.n === n)!;
      if (status === "done" && !kept.messages.length && outcome.text.trim()) tracker.message(n, outcome.text);
      tracker.finish(n, status, status === "failed" ? outcome.text : undefined);
      return { n, modelLabel: agent.modelLabel, status, text: outcome.text };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      tracker.finish(n, "failed", text);
      return { n, modelLabel: agent.modelLabel, status: "failed", text };
    }
  }));
  return results;
}
