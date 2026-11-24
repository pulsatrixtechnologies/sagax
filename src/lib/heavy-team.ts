// Heavy mode (#4901, #5089, #5090) in the person's words and shapes: the
// row's header, the round, the outcome, the leader's steps, an expert's
// state, and the orbit's geometry (who sits where, who is linked while they
// critique, when they merge into the bot). The state itself is
// shared/heavy-team.ts.
import { t } from "@/lib/i18n";
import { formatElapsed } from "@/lib/working-time";
import {
  heavyCurrentRound, heavyIsRunning, heavyThoughtMs,
  type HeavyAgentLine, type HeavyLeaderStep, type HeavyRefusalCause, type HeavyRefusalLine, type HeavyTeamLine,
} from "../../shared/heavy-team";

export { heavyIsRunning, heavyThoughtMs };

/** The owls that stand for the experts, one plumage each (the palette's vivid colours). */
export const AGENT_COLORS = ["blue", "green", "orange", "purple", "pink"] as const;

/** The row's header: the leader picking the team, then "Experts thinking ·
 * round 2 of 5 · 6s" while they work, "Thought for 8s" after. */
export function heavyHeader(line: HeavyTeamLine, busy: boolean, now: number): string {
  const elapsed = formatElapsed(heavyThoughtMs(line, now, heavyIsRunning(line, busy)));
  const working = line.phase === "planning" || line.phase === "agents";
  // a run nobody patches any more (the server restarted, the turn was stopped) never reads as thinking
  if (line.phase === "stopped" || (working && !busy)) return t("heavy.stopped", { elapsed });
  if (line.phase === "planning") return t("heavy.planning", { elapsed });
  if (line.phase === "agents") {
    const round = heavyCurrentRound(line) ?? line.rounds.at(-1);
    return round ? t("heavy.runningRound", { round: round.n, max: line.maxRounds, elapsed }) : t("heavy.running", { elapsed });
  }
  return t("heavy.thought", { elapsed });
}

/** One line on how it ended: agreed in round N, or decided after N rounds. */
export function heavyOutcomeText(line: HeavyTeamLine): string | null {
  const last = line.rounds.at(-1)?.n ?? 0;
  if (line.outcome === "agreed") return t("heavy.agreed", { round: line.rounds.find((round) => round.agreed)?.n ?? last });
  if (line.outcome === "decided") return t("heavy.decided", { rounds: last });
  return null;
}

/** D-20261119-086: the one line saying Auto chose Heavy on its own. */
export function heavyAutoText(line: HeavyTeamLine): string | null {
  return line.auto === "risky" ? t("heavy.auto.risky") : line.auto === "big" ? t("heavy.auto.big") : null;
}

export function leaderStepText(step: HeavyLeaderStep): string {
  switch (step.kind) {
    case "planned": return t("heavy.leader.planned");
    case "sent": return t("heavy.leader.sent");
    case "processing": return t("heavy.leader.processing");
    case "agreed": return t("heavy.leader.agreed", { round: step.round ?? 0 });
    case "decided": return t("heavy.leader.decided", { round: step.round ?? 0 });
    case "writing": return t("heavy.leader.writing");
  }
}

/** The step the leader is on: the last one. */
export function leaderNow(line: HeavyTeamLine): HeavyLeaderStep {
  return line.leader.steps.at(-1) ?? { kind: "processing", at: line.startedAt };
}

/** "Expert 2 · Security": the expert's name in the panel and the preview. */
export function expertName(agent: Pick<HeavyAgentLine, "n" | "persona">): string {
  return agent.persona ? t("heavy.agentPersona", { n: agent.n, persona: agent.persona }) : t("heavy.agent", { n: agent.n });
}

/** M-20261123-040: why a seat gave no answer, in the person's words. */
export function heavyCauseText(cause: HeavyRefusalCause): string {
  switch (cause) {
    case "access": return t("heavy.cause.access");
    case "credits": return t("heavy.cause.credits");
    case "limit": return t("heavy.cause.limit");
    case "model": return t("heavy.cause.model");
    case "unavailable": return t("heavy.cause.unavailable");
    case "timeout": return t("heavy.cause.timeout");
    case "other": return t("heavy.cause.other");
  }
}

/** One sentence per seat that refused: which model on which engine, the
 * real cause with the provider's status, and what became of its expert. */
export function refusalText(refusal: HeavyRefusalLine): string {
  const values = {
    model: refusal.modelLabel,
    engine: refusal.engineLabel,
    cause: heavyCauseText(refusal.cause),
    code: refusal.status ? t("heavy.refusal.code", { status: refusal.status }) : "",
    expert: expertName(refusal),
  };
  return refusal.replacedBy
    ? t("heavy.refusal.replaced", { ...values, replacement: refusal.replacedBy.modelLabel })
    : t("heavy.refusal.left", values);
}

/** The provider's own words on a refusal, quoted, when it gave any. */
export function refusalSaysText(refusal: HeavyRefusalLine): string | null {
  return refusal.detail ? t("heavy.refusal.says", { engine: refusal.engineLabel, detail: refusal.detail }) : null;
}

/** What an expert shows in the live preview: what it is writing, else its last message, else that it thinks. */
export function agentPreview(agent: HeavyAgentLine): string {
  const text = (agent.live ?? agent.messages.at(-1) ?? "").replace(/\s+/g, " ").trim();
  if (text) return text;
  if (agent.status === "failed" && agent.cause) return heavyCauseText(agent.cause);
  if (agent.status === "failed" && agent.error) return agent.error;
  return agent.status === "working" ? t("heavy.agent.working") : agent.status === "failed" ? t("heavy.agent.failed") : agent.status === "stopped" ? t("heavy.agent.stopped") : t("heavy.agent.nothing");
}

export function agentStatusText(agent: HeavyAgentLine): string {
  if (agent.status === "working" && agent.agrees !== undefined) return t(agent.agrees ? "heavy.agent.agrees" : "heavy.agent.disagrees");
  switch (agent.status) {
    case "working": return t("heavy.agent.working");
    case "done": return agent.agrees === undefined ? t("heavy.agent.done") : t(agent.agrees ? "heavy.agent.agrees" : "heavy.agent.disagrees");
    case "failed": return agent.cause === "timeout" ? t("heavy.agent.timeout") : t("heavy.agent.failed");
    case "stopped": return t("heavy.agent.stopped");
  }
}

/** Whether a message is a Heavy run's row. */
export function heavyLineOf(message: { kind: string; tool?: { team?: HeavyTeamLine } }): HeavyTeamLine | null {
  return message.kind === "activity" ? message.tool?.team ?? null : null;
}

// ── the orbit (HeavyOrbit.tsx) ────────────────────────────────────────────

/** Where each expert sits around the bot: evenly on a circle, the first at the top. */
export function orbitPlaces(count: number, radius: number): Array<{ x: number; y: number }> {
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(1, count);
    return { x: Math.round(radius * Math.cos(angle) * 10) / 10, y: Math.round(radius * Math.sin(angle) * 10) / 10 };
  });
}

/** While a critique round runs, every two experts still in it are linked
 * (each reads and critiques the others); none while they propose. */
export function critiqueLinks(line: HeavyTeamLine): Array<[number, number]> {
  const round = heavyCurrentRound(line);
  if (line.phase !== "agents" || round?.kind !== "critique") return [];
  const live = line.agents.filter((agent) => agent.status === "working").map((agent) => agent.n);
  const out: Array<[number, number]> = [];
  for (let a = 0; a < live.length; a += 1) for (let b = a + 1; b < live.length; b += 1) out.push([live[a]!, live[b]!]);
  return out;
}

/** On agreement the experts merge into the bot (once the rounds are over). */
export function orbitMerged(line: HeavyTeamLine): boolean {
  return line.outcome === "agreed" && (line.phase === "leader" || line.phase === "done");
}
