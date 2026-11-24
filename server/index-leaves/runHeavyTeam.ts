/** runHeavyTeam (#4901, rebuilt by #5089, owner 2026-11-19, M-20261119-077,
 * D-20261119-084, D-20261119-085): the experts of a Heavy turn. Before the
 * turn's own model (the leader, Expert's pick) acts:
 *
 * 1. the leader plans the team: how many experts (2 to 5) and each one's
 *    persona, on a short hidden ask of its own;
 * 2. each expert takes a seat of the person's own accounts and models,
 *    different accounts first, then different models (server/heavy-team.ts
 *    assignSeats, server/models/model-mode.ts heavySeats);
 * 3. round 1 every expert proposes; then cross critiques, round after round,
 *    until they agree, at most HEAVY_MAX_ROUNDS; without agreement the leader
 *    decides and shows what is still disputed beside the plan;
 * 4. the leader's prompt carries the team's notes, and the bot carries the
 *    plan out ONCE in this very turn, with its usual writes and cards.
 *
 * Every expert, and the plan, is a hidden thread of the same bot for the
 * same person (the turn's speaker: their sign-ins, keys and connectors), run
 * through askBotAndWait like run_with_engine. Each is read-only, held by the
 * server before its first turn (store.confineHeavyExpert: the conversation's
 * tool scope of #4993, host tools withheld, every permission request refused
 * by createHeavyExpertFence). An expert that could not be confined never
 * runs. One activity row of the conversation holds the whole run
 * (shared/heavy-team.ts), patched while it works. What the experts spent is
 * carried onto the leader's turn (heavyUsage).
 *
 * A seat whose engine or model refuses its expert (M-20261123-040) is
 * replaced by the next one (server/heavy-team.ts SeatBench, askOnSeats): the
 * expert goes on there, the row says who refused and why, and a refusal that
 * will last (no access, no credit, a model the provider does not serve)
 * leaves Heavy's and Auto's offer for this person for a while.
 *
 * Never fails the turn: an expert that fails leaves the team, a team that
 * returns nothing leaves the leader to act alone. Stopping the turn stops
 * the experts. */
import { HEAVY_MAX_EXPERTS, HEAVY_TEAM_TOOL_NAME } from "../../shared/heavy-team.ts";
import {
  HeavyTeamTracker, SeatBench, askOnSeats, assignSeats, conversationContext, expertToolScope, heavyAgentThreads, heavyUsage, leaderNotes,
  parseTeamPlan, planPrompt, refusalLasts, runRounds, sumUsage,
} from "../heavy-team.ts";
import { agentEffort } from "../models/model-mode.ts";
import { reportBackgroundError } from "../background-error.ts";
export type Host = Record<string, any>;

/** How long one expert's turn of one round may take before the team goes on without it. */
const AGENT_WAIT_MS = 4 * 60_000;
/** The leader's plan is a short answer. */
const PLAN_WAIT_MS = 90_000;

export function createRunHeavyTeam(getHost: () => Host): any {
async function runHeavyTeam(state: any): Promise<void> {
  const host = getHost();
  const pick = state.autoTurn?.pick;
  const pool = pick?.team;
  if (pick?.mode !== "heavy" || !Array.isArray(pool) || pool.length < 1) return;
  // Only the person's own typed turn runs a team. A call turn answers with the leader alone (a
  // phone answer waits for no team), work a bot hands out is Auto's, a continuation of the same
  // request keeps the team's first run, and nothing of a confidential conversation leaves it.
  const opts = state.opts ?? {};
  if (state.warmOnly || state.onCall || state.voiceCallTurn || state.autoContinuing || (state.commsDepth ?? 0) > 0) return;
  if (opts.automationSource !== undefined || opts.peerAsk || state.userMessage?.peerAsk || opts.cardContinuation || opts.compactOnly || opts.coordination) return;
  if (host.isRelayPart(state.threadId) || host.store.isConfidentialThread(state.threadId)) return;
  // an expert's own conversation never starts a team of its own
  if (host.store.isHeavyExpert?.(state.botId, state.threadId)) return;
  const bot = host.store.bot(state.botId);
  if (!bot) return;

  const tracker = new HeavyTeamTracker({ engineLabel: pick.engineLabel, modelLabel: pick.modelLabel }, (line) => {
    host.store.patchMessage(state.threadId, row.id, { tool: { name: HEAVY_TEAM_TOOL_NAME, ok: true, team: line } });
  });
  // D-20261119-086: Auto chose Heavy on its own: the row says so in one line
  if (pick.autoHeavy) tracker.line.auto = pick.autoHeavy;
  // the row sits before the leader's first word, where the run begins
  const row = host.store.appendMessage(state.threadId, { role: "bot", kind: "activity", tool: { name: HEAVY_TEAM_TOOL_NAME, ok: true, team: structuredClone(tracker.line) } });
  state.heavyTracker = tracker;

  const request = String(state.userMessage?.text ?? state.text ?? "");
  const context = conversationContext(host.store.messagesFor(state.threadId).filter((message: { id?: string }) => message.id !== state.userMessage?.id));
  const waitMs = Math.max(5_000, Number(process.env.SAGAX_HEAVY_AGENT_WAIT_MS) || AGENT_WAIT_MS);
  const threads: string[] = [];
  let cancelled = false;
  const stopAll = () => {
    for (const threadId of threads) void host.interruptDirectThread(bot.id, threadId).catch(() => {});
  };
  // the person's Stop ends the turn's claim: the experts stop with it
  const watch = setInterval(() => {
    if (cancelled || host.directTurnClaimIsCurrent(bot.id, state.dispatchClaimId, state.threadId)) return;
    cancelled = true;
    stopAll();
  }, 500);
  watch.unref?.();

  /** One read-only hidden conversation on a seat, confined before its first turn. */
  const openExpert = (seat: any, title: string): string | null => {
    const instance = host.registry.get(seat.instanceId);
    if (!instance) return null;
    const effort = agentEffort(instance.adapter?.capabilities);
    const selection = { instanceId: seat.instanceId, model: seat.model, ...(effort ? { effort } : {}) };
    const task = host.store.createTask(bot.id, title, false, undefined, { botId: bot.id, name: bot.name, at: Date.now() },
      "ask", host.openedThreadOwner(bot, state.threadId, bot), selection, true, undefined, false);
    if (!task) return null;
    // read-only, held by the server, before anything is sent; never unconfined
    if (!host.store.confineHeavyExpert(bot.id, task.threadId, expertToolScope())) return null;
    threads.push(task.threadId);
    heavyAgentThreads.add(task.threadId);
    host.threadStarters.set(task.threadId, host.openerFrom(state.threadId));
    host.noteRelayParent(task.threadId, state.threadId);
    return task.threadId;
  };

  /** One turn of one hidden conversation: the same thread each round, so the expert keeps its own context. */
  const askOn = async (threadId: string, prompt: string, hooks?: { onDelta: (text: string) => void; onMessage: (text: string) => void }, timeoutMs = waitMs) => {
    if (cancelled) return { status: "error", text: "stopped" };
    const unsubscribe = hooks ? host.bus.subscribe((event: { threadId?: string; type?: string; streamKind?: string; itemType?: string; delta: string; text: string }) => {
      if (event.threadId !== threadId) return;
      if (event.type === "content.delta" && event.streamKind === "assistant_text") hooks.onDelta(event.delta);
      else if (event.type === "item.completed" && event.itemType === "assistant_text") hooks.onMessage(event.text);
    }) : () => {};
    try {
      const outcome = await host.askBotAndWait(bot.id, prompt, 0, bot.id, state.threadId, threadId, { timeoutMs, selfRelay: true, speaker: state.speaker });
      if (outcome.status === "timeout") {
        await host.interruptDirectThread(bot.id, threadId).catch(() => {});
        return { status: "timeout", text: outcome.text || "no answer in time" };
      }
      return outcome;
    } finally {
      unsubscribe();
    }
  };

  try {
    // 1. the leader plans the team (D-20261119-084: 2 to 5, its choice)
    const leaderSeat = { instanceId: pick.selection.instanceId, model: pick.selection.model, engineLabel: pick.engineLabel, modelLabel: pick.modelLabel };
    const planThread = openExpert(leaderSeat, "Heavy plan");
    const plan = planThread ? await askOn(planThread, planPrompt({ request, context, seats: HEAVY_MAX_EXPERTS }), undefined, PLAN_WAIT_MS) : { status: "error", text: "" };
    if (cancelled) throw new host.DirectTurnSetupCancelled("turn stopped while the team worked");
    const briefs = parseTeamPlan(plan.status === "reply" ? plan.text : "", HEAVY_MAX_EXPERTS);
    // 2. each expert on a seat: different accounts first, then different models
    const seats = assignSeats(pool, briefs.length);
    const experts = briefs.map((brief, index) => ({ ...brief, n: index + 1, seat: seats[index] }));
    tracker.setTeam(experts);
    const expertThread = new Map<number, string | null>();
    for (const expert of experts) expertThread.set(expert.n, openExpert(expert.seat, `Expert ${expert.n}`));
    // M-20261123-040: a seat that refuses is replaced by the next one
    const bench = new SeatBench(pool, leaderSeat);
    const payer = host.autoPayerKey(bot, state.speaker);

    // 3. the rounds
    const result = await runRounds({
      experts, tracker, request, context,
      cancelled: () => cancelled,
      ask: (expert, prompt, hooks, fresh) => askOnSeats({
        expert, prompt, fresh, bench,
        held: () => experts.filter((other) => other.n !== expert.n && tracker.line.agents.some((agent) => agent.n === other.n && agent.status === "working")).map((other) => other.seat),
        cancelled: () => cancelled,
        ask: async (seat, text, moved) => {
          // on another seat the expert starts a conversation of its own there
          if (moved) expertThread.set(expert.n, openExpert(seat, `Expert ${expert.n}`));
          const threadId = expertThread.get(expert.n);
          if (!threadId) return { status: "error", text: "could not open a read-only thread for this expert" };
          return askOn(threadId, text, hooks);
        },
        onRefusal: (from, refusal, to) => {
          tracker.refused(expert.n, from, refusal, to);
          // what will refuse again is not offered again for a while (Auto's memory of refused models)
          if (refusal && refusalLasts(refusal)) host.rememberAutoRefusal(payer, { instanceId: from.instanceId, model: from.model });
        },
      }),
    });
    if (cancelled) throw new host.DirectTurnSetupCancelled("turn stopped while the team worked");
    tracker.agentsDone(result);
    // 4. the leader acts once, in this turn
    state.heavyNotes = leaderNotes(result);
    heavyUsage.carry(state.threadId, sumUsage(threads.map((threadId) => host.store.taskByThread(bot.id, threadId)?.usage)));
  } catch (error) {
    if (cancelled || error instanceof host.DirectTurnSetupCancelled) {
      tracker.stop();
      throw error instanceof host.DirectTurnSetupCancelled ? error : new host.DirectTurnSetupCancelled("turn stopped while the team worked");
    }
    // a team that broke is no reason to fail the person's turn: the leader acts alone
    tracker.stop();
    reportBackgroundError(error);
  } finally {
    clearInterval(watch);
    for (const threadId of threads) heavyAgentThreads.delete(threadId);
  }
}
  return runHeavyTeam;
}
