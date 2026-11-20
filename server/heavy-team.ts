// Heavy mode (#4901, rebuilt by #5089), the pure half: who the experts are
// (the leader's plan), what each one is asked in each round, how a verdict
// reads, the rounds themselves (proposals, then cross critiques until
// agreement, HEAVY_MAX_ROUNDS at most), the notes the leader reads, the
// state of a run as the chat's row shows it (shared/heavy-team.ts), and the
// confinement that keeps every expert read-only on the server. The running
// half, which opens the experts' hidden threads on the same machinery as
// run_with_engine, is server/index-leaves/runHeavyTeam.ts.
import type { ModeModel } from "../shared/model-mode.ts";
import {
  HEAVY_MAX_EXPERTS, HEAVY_MAX_ROUNDS, HEAVY_MESSAGES_PER_AGENT, HEAVY_MESSAGE_CHARS, HEAVY_MIN_EXPERTS,
  type HeavyAgentLine, type HeavyAgentStatus, type HeavyLeaderStepKind, type HeavyTeamLine,
} from "../shared/heavy-team.ts";
import type { ToolScope } from "../shared/tool-scope.ts";
import { READ_ONLY_AGENT_TOOL_NAMES } from "./tools/agent-tool-policy.ts";
import { PERSPICAX_READ_ONLY_TOOLS } from "./drivers/acp/grok-read-only-tools.ts";

/** The hidden threads of the experts working now. They are the one turn's own work, not threads the
 * person opened: they do not count toward the bot's limit of parallel threads (the leader's turn and
 * five experts would never fit under the default three). */
const agentThreads = new Set<string>();
export const heavyAgentThreads = {
  add: (threadId: string): void => { agentThreads.add(threadId); },
  delete: (threadId: string): void => { agentThreads.delete(threadId); },
  has: (threadId: string): boolean => agentThreads.has(threadId),
};

/** What a Heavy turn's experts (and the leader's plan) spent, carried onto
 * the leader's turn: the person reads Heavy's cost in the normal usage of
 * that one turn, never in a banner (owner, M-20261119-077). The month's
 * ledger already holds each expert's own turns. */
export interface HeavyUsage { input: number; output: number; cachedInput: number; costUsd: number | null }
const usageCarry = new Map<string, HeavyUsage>();
export const heavyUsage = {
  carry: (threadId: string, usage: HeavyUsage): void => { usageCarry.set(threadId, usage); },
  /** Once: the leader's turn.completed banks it with its own figures. */
  take: (threadId: string): HeavyUsage | undefined => {
    const usage = usageCarry.get(threadId);
    usageCarry.delete(threadId);
    return usage;
  },
};

/** The sum of the experts' conversations' usage (TaskUsage records). */
export function sumUsage(records: ReadonlyArray<{ input?: number; output?: number; cachedInput?: number; costUsd?: number | null } | undefined>): HeavyUsage {
  const total: HeavyUsage = { input: 0, output: 0, cachedInput: 0, costUsd: null };
  for (const record of records) {
    if (!record) continue;
    total.input += Math.max(0, record.input ?? 0);
    total.output += Math.max(0, record.output ?? 0);
    total.cachedInput += Math.max(0, record.cachedInput ?? 0);
    if (typeof record.costUsd === "number" && Number.isFinite(record.costUsd)) total.costUsd = (total.costUsd ?? 0) + record.costUsd;
  }
  return total;
}

// ── read-only, held by the server ─────────────────────────────────────────

/** The MCP mount names an expert's selection reads: Sagax's own tools and
 * the Perspicax mount (shared/tool-scope.ts selectors). */
const AGENTS_MOUNT = "agents";
const PERSPICAX_MOUNT = "perspicax";

/** An expert conversation's tool selection (#4993's conversation scope,
 * `store.confineHeavyExpert`), set before its first turn: the reviewed
 * reads of Sagax's own tools and of Perspicax, nothing else of any MCP
 * server (no connector, no computer, no write). The engine's own tools stay
 * `native:*` (Claude and Codex cannot narrow theirs), and the expert's turn
 * withholds every host tool (shell, files, fetch: SendTurnInput
 * .withholdHostTools, each driver's tested mode), so no native tool writes
 * either. A permission request that still comes is refused by the server
 * (`createHeavyExpertFence`). Never a hint in the prompt alone. */
export function expertToolScope(): ToolScope {
  const allow = [
    "native:*",
    ...[...READ_ONLY_AGENT_TOOL_NAMES].map((name) => `mcp:${AGENTS_MOUNT}:${name}`),
    ...[...PERSPICAX_READ_ONLY_TOOLS].map((name) => `mcp:${PERSPICAX_MOUNT}:${name}`),
  ];
  // a selection holds 256 selectors at most (shared/tool-scope.ts)
  return { allow: [...new Set(allow)].slice(0, 256) };
}

export const HEAVY_EXPERT_REFUSAL = "Heavy experts only read and think: Sagax refused this. Do not try another way; say what you would do, the leader acts.";

type RequestOpened = { threadId: string; requestId?: string | number; requestType?: string; providerInstanceId?: string; turnId?: string; tool?: string; summary: string };
type Adapter = { respondToRequest(threadId: string, requestId: any, decision: any): Promise<unknown> };

/** The request fence of the experts' conversations: every permission request
 * an expert's engine opens is refused here, by the server, before any grant,
 * rule or card (the read-and-draft fence's pattern, server/read-and-draft.ts);
 * the expert's turn goes on with its reads. */
export function createHeavyExpertFence(deps: {
  confines(threadId: string): boolean;
  adapter(instanceId: string): Adapter | undefined;
  decide?(row: { threadId: string; requestId?: string; tool?: string; summary: string; decision: "auto-denied"; source: "heavy"; rule: string }): void;
}) {
  function answers(event: RequestOpened, asker: { modelSelection: { instanceId: string } }): boolean {
    if (!deps.confines(event.threadId)) return false;
    deps.decide?.({ threadId: event.threadId, ...(event.requestId !== undefined ? { requestId: String(event.requestId) } : {}), ...(event.tool ? { tool: event.tool } : {}), summary: event.summary, decision: "auto-denied", source: "heavy", rule: "heavy-expert" });
    const adapter = deps.adapter(event.providerInstanceId ?? asker.modelSelection.instanceId);
    const decision = { behavior: event.requestType === "question" ? "answer" as const : "deny" as const, message: HEAVY_EXPERT_REFUSAL };
    if (event.requestId !== undefined && adapter) void adapter.respondToRequest(event.threadId, event.requestId, decision).catch(() => {});
    return true;
  }
  return { confines: deps.confines, answers };
}

// ── the leader's plan: how many experts, which personas ───────────────────

export interface ExpertBrief {
  persona: string;
  focus: string;
}

/** The personas the leader falls back on when its plan does not read. */
export const DEFAULT_EXPERTS: readonly ExpertBrief[] = [
  { persona: "Skeptic", focus: "Look for what the obvious answer misses: a wrong assumption, an edge case, a risk." },
  { persona: "Security", focus: "What could leak, break or be abused, and how to prevent it." },
  { persona: "User's advocate", focus: "What the person really needs, in their own words, and what would surprise them." },
  { persona: "Cost", focus: "Time, money and effort: the cheapest path that still works." },
  { persona: "Pragmatist", focus: "The simplest plan that gets it done, step by step, and what to do first." },
];

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** What the leader is asked first: how big a team this task needs, and who. */
export function planPrompt(input: { request: string; context?: string; seats: number }): string {
  const most = Math.max(HEAVY_MIN_EXPERTS, Math.min(HEAVY_MAX_EXPERTS, input.seats));
  const context = input.context?.trim();
  return [
    `[You are the leader of a team of experts that will work on the person's request before you act. Decide how many experts this task needs (${HEAVY_MIN_EXPERTS} to ${most}: more for a big or risky task, fewer for a narrow one) and give each one a persona chosen for this task (for example a skeptic, security, cost, the user's advocate, or anything the task calls for).]`,
    "Reply with JSON only, no prose: {\"experts\":[{\"persona\":\"short name\",\"focus\":\"one sentence\"}]}",
    ...(context ? [`The conversation so far:\n${context}`] : []),
    `The request:\n${input.request.trim()}`,
  ].join("\n\n");
}

/** The leader's plan, read from its reply: 2 to `seats` experts (never more
 * than HEAVY_MAX_EXPERTS). A reply that does not read gives three of the
 * default personas. */
export function parseTeamPlan(text: string, seats = HEAVY_MAX_EXPERTS): ExpertBrief[] {
  const most = Math.max(HEAVY_MIN_EXPERTS, Math.min(HEAVY_MAX_EXPERTS, seats));
  const fallback = DEFAULT_EXPERTS.slice(0, Math.min(3, most));
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [...fallback];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { experts?: unknown };
    if (!Array.isArray(parsed.experts)) return [...fallback];
    const experts = parsed.experts.flatMap((entry): ExpertBrief[] => {
      if (!entry || typeof entry !== "object") return [];
      const persona = typeof (entry as { persona?: unknown }).persona === "string" ? clip((entry as { persona: string }).persona.trim(), 40) : "";
      const focus = typeof (entry as { focus?: unknown }).focus === "string" ? clip((entry as { focus: string }).focus.trim(), 240) : "";
      return persona ? [{ persona, focus }] : [];
    }).slice(0, most);
    if (experts.length >= HEAVY_MIN_EXPERTS) return experts;
    // one persona named: the team still needs a second voice
    return [...experts, ...DEFAULT_EXPERTS.filter((brief) => !experts.some((one) => one.persona === brief.persona))].slice(0, Math.max(HEAVY_MIN_EXPERTS, Math.min(3, most)));
  } catch {
    return [...fallback];
  }
}

/** D-20261119-084 and the owner's rule on accounts: each expert takes a seat
 * (an account and a model) from the pool, different accounts first, then
 * different models of the same provider; with fewer seats than experts the
 * seats are shared in turn. `pool` is the Heavy pick's team
 * (server/models/model-mode.ts heavySeats), strongest first. */
export function assignSeats(pool: readonly ModeModel[], count: number): ModeModel[] {
  if (!pool.length || count <= 0) return [];
  const out: ModeModel[] = [];
  const used = new Set<string>();
  const key = (seat: ModeModel) => `${seat.instanceId}\u0000${seat.model}`;
  // first every account once, then every model once, then shared
  for (const seat of pool) {
    if (out.length >= count) break;
    if (out.some((taken) => taken.instanceId === seat.instanceId)) continue;
    out.push(seat);
    used.add(key(seat));
  }
  for (const seat of pool) {
    if (out.length >= count) break;
    if (used.has(key(seat))) continue;
    out.push(seat);
    used.add(key(seat));
  }
  for (let at = 0; out.length < count; at += 1) out.push(pool[at % pool.length]!);
  return out;
}

// ── what each expert is asked ─────────────────────────────────────────────

export interface ExpertSeat extends ExpertBrief {
  n: number;
  seat: ModeModel;
}

/** Round 1: the expert's own proposal. The bot's own words, never the person's. */
export function proposePrompt(input: { expert: ExpertSeat; count: number; request: string; context?: string }): string {
  const { expert } = input;
  const context = input.context?.trim();
  return [
    `[You are Expert ${expert.n} of ${input.count}, "${expert.persona}", on a team of experts working on one request before the leader acts, on ${expert.seat.modelLabel}. This is your own work for the same person, in a thread of its own. You only read and think: you cannot write, send, change or buy anything (Sagax refuses it); the leader acts once the team agrees.]`,
    `Your focus: ${expert.focus || "the request as a whole"}`,
    "Round 1: propose your plan for the request, complete and plain, as short as it allows. Address the leader and the other experts, not the person.",
    ...(context ? [`The conversation so far:\n${context}`] : []),
    `The request:\n${input.request.trim()}`,
  ].join("\n\n");
}

const PEER_NOTE_CHARS = 3_000;

/** A critique round: the others' latest words, then this expert's critique,
 * its revised plan and its verdict on the last line. */
export function critiquePrompt(input: { round: number; maxRounds: number; others: ReadonlyArray<{ n: number; persona: string; text: string }> }): string {
  const notes = input.others.map((other) => `### Expert ${other.n} (${other.persona})\n${clip(other.text.trim(), PEER_NOTE_CHARS)}`).join("\n\n");
  return [
    `Round ${input.round} of at most ${input.maxRounds}: what the other experts said last.`,
    notes,
    "Critique their plans from your focus (what is wrong, missing or risky), then give your revised plan. On the last line write exactly `VERDICT: AGREE` if you would accept the team's plan as it now stands, or `VERDICT: DISAGREE: <the points still in dispute>`.",
  ].join("\n\n");
}

export interface Verdict {
  agrees: boolean;
  /** The points still in dispute (DISAGREE). */
  points: string[];
  /** The text without its verdict line. */
  text: string;
}

/** An expert's verdict, from the last `VERDICT:` line. None is not an agreement. */
export function parseVerdict(reply: string): Verdict {
  const lines = reply.trimEnd().split("\n");
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const match = /^\W*verdict\W*?:\W*(agree|disagree)\b[\s:*_-]*(.*)$/i.exec(lines[at]!.trim());
    if (!match) continue;
    const text = [...lines.slice(0, at), ...lines.slice(at + 1)].join("\n").trim();
    if (match[1]!.toLowerCase() === "agree") return { agrees: true, points: [], text };
    const points = match[2]!.split(/;|\s\|\s/).map((point) => point.trim().replace(/[`*]+/g, "")).filter(Boolean);
    return { agrees: false, points: points.length ? points : ["(no reason given)"], text };
  }
  return { agrees: false, points: [], text: reply.trim() };
}

/** The last few lines of the conversation, for an expert that starts with none. */
export function conversationContext(messages: ReadonlyArray<{ role: string; kind?: string; text?: string }>, limit = 6, each = 1_200): string {
  return messages
    .filter((message) => (message.role === "user" || message.role === "bot") && (message.kind === undefined || message.kind === "text") && message.text?.trim())
    .slice(-limit)
    .map((message) => `${message.role === "user" ? "Person" : "You"}: ${clip(message.text!.trim(), each)}`)
    .join("\n");
}

// ── the rounds ────────────────────────────────────────────────────────────

/** What an expert's turn came to: askBotAndWait's outcome in words the row keeps. */
export type HeavyAgentOutcome = { status: "reply" | "failed" | "error" | "timeout"; text: string };

export interface RoundsResult {
  /** How many rounds ran (1 to maxRounds). */
  rounds: number;
  agreed: boolean;
  /** Each expert's last usable words, its verdict line removed. */
  finals: Array<{ n: number; persona: string; modelLabel: string; text: string; ok: boolean }>;
  /** The points still disputed after the last round (not agreed). */
  disagreements: string[];
}

/** D-20261119-085: round 1, every expert proposes (in parallel); then cross
 * critiques, round after round, until every expert still answering agrees
 * or `maxRounds` ran. The leader stops at the first round of agreement. An
 * expert that fails leaves the team; with fewer than two left the rounds
 * stop (nothing to critique). */
export async function runRounds(input: {
  experts: readonly ExpertSeat[];
  tracker: HeavyTeamTracker;
  maxRounds?: number;
  request: string;
  context?: string;
  ask: (expert: ExpertSeat, prompt: string, hooks: { onDelta: (text: string) => void; onMessage: (text: string) => void }) => Promise<HeavyAgentOutcome>;
  cancelled?: () => boolean;
}): Promise<RoundsResult> {
  const max = Math.max(1, Math.min(HEAVY_MAX_ROUNDS, input.maxRounds ?? HEAVY_MAX_ROUNDS));
  const { tracker, experts } = input;
  const latest = new Map<number, string>();
  const alive = new Set(experts.map((expert) => expert.n));
  let lastVerdicts = new Map<number, Verdict>();
  let rounds = 0;
  let agreed = false;
  const turn = async (expert: ExpertSeat, prompt: string): Promise<string | null> => {
    tracker.speaking(expert.n, true);
    try {
      const outcome = await input.ask(expert, prompt, { onDelta: (text) => tracker.delta(expert.n, text), onMessage: (text) => tracker.message(expert.n, text) });
      if (outcome.status !== "reply" || !outcome.text.trim()) {
        tracker.finish(expert.n, "failed", outcome.text || outcome.status);
        alive.delete(expert.n);
        return null;
      }
      tracker.settle(expert.n, outcome.text);
      return outcome.text;
    } catch (error) {
      tracker.finish(expert.n, "failed", error instanceof Error ? error.message : String(error));
      alive.delete(expert.n);
      return null;
    } finally {
      tracker.speaking(expert.n, false);
    }
  };
  for (let round = 1; round <= max; round += 1) {
    if (input.cancelled?.() || alive.size === 0) break;
    if (round > 1 && alive.size < 2) break;
    rounds = round;
    const kind = round === 1 ? "propose" : "critique";
    const speakers = experts.filter((expert) => alive.has(expert.n));
    tracker.roundStart(round, kind);
    const replies = await Promise.all(speakers.map(async (expert) => {
      const prompt = round === 1
        ? proposePrompt({ expert, count: experts.length, request: input.request, ...(input.context ? { context: input.context } : {}) })
        : critiquePrompt({
          round, maxRounds: max,
          others: speakers.filter((other) => other.n !== expert.n && latest.has(other.n)).map((other) => ({ n: other.n, persona: other.persona, text: latest.get(other.n)! })),
        });
      return [expert, await turn(expert, prompt)] as const;
    }));
    const verdicts = new Map<number, Verdict>();
    for (const [expert, text] of replies) {
      if (text === null) continue;
      if (round === 1) {
        latest.set(expert.n, text.trim());
        continue;
      }
      const verdict = parseVerdict(text);
      verdicts.set(expert.n, verdict);
      latest.set(expert.n, verdict.text || text.trim());
      tracker.verdict(expert.n, verdict.agrees);
    }
    agreed = round > 1 && verdicts.size >= 2 && [...verdicts.values()].every((verdict) => verdict.agrees);
    tracker.roundEnd(round, agreed);
    if (round > 1) lastVerdicts = verdicts;
    // the leader stops at the first round of agreement
    if (agreed) break;
  }
  const disagreements = agreed ? [] : [...new Set([...lastVerdicts.values()].flatMap((verdict) => verdict.points))].slice(0, 8);
  return {
    rounds,
    agreed,
    disagreements,
    finals: experts.map((expert) => ({ n: expert.n, persona: expert.persona, modelLabel: expert.seat.modelLabel, text: latest.get(expert.n) ?? "", ok: latest.has(expert.n) })),
  };
}

// ── the leader's notes ────────────────────────────────────────────────────

const EXPERT_NOTE_CHARS = 6_000;
const NOTES_CHARS = 24_000;

/** The leader's section of the prompt: what the team settled, and what is
 * left to it. The bot acts ONCE, now, with its usual tools and cards. */
export function leaderNotes(result: RoundsResult): string {
  const usable = result.finals.filter((final) => final.ok && final.text.trim());
  const head = "\n## Team of Experts (Heavy mode)\n";
  if (!usable.length) {
    return `${head}The person chose Heavy. A team of ${result.finals.length} experts worked on this request first and none of them came back with anything usable. Answer and act on the request yourself, with your full strength, and do not mention the team.\n`;
  }
  const budget = Math.floor(NOTES_CHARS / usable.length);
  const notes = usable.map((final) => `### Expert ${final.n}, ${final.persona} (${final.modelLabel})\n${clip(final.text.trim(), Math.min(EXPERT_NOTE_CHARS, budget))}`).join("\n\n");
  const settled = result.agreed
    ? `They agreed on a plan after ${result.rounds} round${result.rounds === 1 ? "" : "s"}.`
    : `After ${result.rounds} round${result.rounds === 1 ? "" : "s"} they did not all agree: you decide. Show the person the points still in dispute beside your plan, in a short list.${result.disagreements.length ? `\nStill in dispute: ${result.disagreements.map((point) => `- ${point}`).join("\n")}` : ""}`;
  return `${head}The person chose Heavy. Before you act, ${result.finals.length} read-only experts worked on their request, proposed plans and critiqued each other. ${settled} You are the leader: give the person the plan in your own words, then carry it out ONCE now, yourself, with your usual tools and approvals (the experts took no action, and nothing is done twice). Never paste the experts' messages unless asked.\n\n${notes}\n`;
}

// ── the row's state ───────────────────────────────────────────────────────

/** The row's state, kept as events arrive and published at most every `throttleMs`. */
export class HeavyTeamTracker {
  readonly line: HeavyTeamLine;
  private lastPublished = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly publish: (line: HeavyTeamLine) => void;
  private readonly now: () => number;
  private readonly throttleMs: number;

  constructor(
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
      phase: "planning",
      startedAt: at,
      updatedAt: at,
      agents: [],
      rounds: [],
      maxRounds: HEAVY_MAX_ROUNDS,
      leader: { engineLabel: leader.engineLabel, modelLabel: leader.modelLabel, steps: [] },
    };
  }

  /** The leader's plan is in: the experts, each on its seat. */
  setTeam(experts: readonly ExpertSeat[], maxRounds = HEAVY_MAX_ROUNDS): void {
    const at = this.now();
    this.line.agents = experts.map((expert): HeavyAgentLine => ({
      n: expert.n, persona: expert.persona, engineLabel: expert.seat.engineLabel, modelLabel: expert.seat.modelLabel, status: "working", messages: [],
    }));
    this.line.maxRounds = maxRounds;
    this.line.phase = "agents";
    this.line.leader.steps.push({ kind: "planned", at }, { kind: "sent", at }, { kind: "processing", at });
    this.flush();
  }

  private agent(n: number): HeavyAgentLine | undefined {
    return this.line.agents.find((agent) => agent.n === n);
  }

  roundStart(n: number, kind: "propose" | "critique"): void {
    this.line.rounds.push({ n, kind, startedAt: this.now() });
    this.flush();
  }

  roundEnd(n: number, agreed: boolean): void {
    const round = this.line.rounds.find((candidate) => candidate.n === n);
    if (round) {
      round.endedAt = this.now();
      if (agreed) round.agreed = true;
    }
    if (agreed) {
      this.line.outcome = "agreed";
      this.line.leader.steps.push({ kind: "agreed", at: this.now(), round: n });
    }
    this.flush();
  }

  speaking(n: number, on: boolean): void {
    const agent = this.agent(n);
    if (!agent) return;
    if (on) agent.speaking = true;
    else delete agent.speaking;
    this.touch();
  }

  verdict(n: number, agrees: boolean): void {
    const agent = this.agent(n);
    if (!agent) return;
    agent.agrees = agrees;
    this.touch();
  }

  /** Text an expert is writing now: the live preview, never kept on its own. */
  delta(n: number, text: string): void {
    const agent = this.agent(n);
    if (!agent || agent.status !== "working") return;
    agent.live = clip(`${agent.live ?? ""}${text}`, HEAVY_MESSAGE_CHARS);
    this.touch();
  }

  /** A message an expert finished: kept, in order, within the row's limits. */
  message(n: number, text: string): void {
    const agent = this.agent(n);
    const body = text.trim();
    if (!agent || !body) return;
    delete agent.live;
    if (agent.messages.length < HEAVY_MESSAGES_PER_AGENT) agent.messages.push(clip(body, HEAVY_MESSAGE_CHARS));
    this.touch();
  }

  /** A round's reply: kept once, even from an engine that only reports it when the turn ends. */
  settle(n: number, text: string): void {
    const agent = this.agent(n);
    if (!agent) return;
    const body = clip(text.trim(), HEAVY_MESSAGE_CHARS);
    if (body && agent.messages.at(-1) !== body) {
      delete agent.live;
      if (agent.messages.length < HEAVY_MESSAGES_PER_AGENT) agent.messages.push(body);
    }
    this.touch();
  }

  finish(n: number, status: Exclude<HeavyAgentStatus, "working">, error?: string): void {
    const agent = this.agent(n);
    if (!agent || agent.status !== "working") return;
    delete agent.live;
    delete agent.speaking;
    agent.status = status;
    agent.endedAt = this.now();
    if (error) agent.error = clip(error, 200);
    this.touch();
  }

  /** The rounds are over: the leader writes. Without agreement it decides. */
  agentsDone(result?: Pick<RoundsResult, "agreed" | "rounds" | "disagreements">): void {
    for (const agent of this.line.agents) if (agent.status === "working") this.finish(agent.n, "done");
    if (result && !result.agreed) {
      this.line.outcome = "decided";
      this.line.disagreements = result.disagreements;
      this.line.leader.steps.push({ kind: "decided", at: this.now(), round: result.rounds });
    }
    this.line.phase = "leader";
    this.line.thoughtEndedAt = this.now();
    this.line.leader.steps.push({ kind: "writing", at: this.line.thoughtEndedAt });
    this.flush();
  }

  /** The leader's reply started. */
  leaderStarted(): void {
    if (this.line.phase === "stopped") return;
    this.line.phase = "done";
    this.flush();
  }

  /** The person stopped the turn: what still worked stops with it. */
  stop(): void {
    for (const agent of this.line.agents) if (agent.status === "working") this.finish(agent.n, "stopped");
    const open = this.line.rounds.at(-1);
    if (open && open.endedAt === undefined) open.endedAt = this.now();
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
