// @ts-nocheck
/** runHeavyTeam (#4901): the Team of Experts of a Heavy turn. Before the turn's
 * own model (the Leader) answers, several agents work on the request in
 * parallel, each on its own model, and the Leader reads what they found.
 *
 * The agents are the machinery of run_with_engine (server/run-with-engine.ts,
 * server/routes/internal-rooms-engine.ts), not a copy of it: a thread of the
 * same bot, for the same person (the turn's speaker, so their sign-ins, keys
 * and connectors apply), at the bot's approval level (Ask where the engine
 * cannot carry it), run through askBotAndWait. They differ only in being
 * hidden threads (never listed, never an unread dot) and in running several
 * at once. One activity row of the conversation holds the whole run
 * (shared/heavy-team.ts) and is patched while it works; the final answer is the
 * Leader's ordinary reply.
 *
 * Never fails the turn: an agent that fails is a failed agent, a team that
 * returns nothing leaves the Leader to answer alone. Stopping the turn stops
 * the agents. */
import { HEAVY_TEAM_TOOL_NAME } from "../../shared/heavy-team.ts";
import { HeavyTeamTracker, agentPrompt, conversationContext, heavyAgentThreads, leaderNotes, runAgents } from "../heavy-team.ts";
import { agentEffort } from "../models/model-mode.ts";
import { relayThreadLevel } from "../run-with-engine.ts";
import { reportBackgroundError } from "../background-error.ts";
export type Host = Record<string, any>;

/** How long one agent may work before the team goes on without it. */
const AGENT_WAIT_MS = 4 * 60_000;

export function createRunHeavyTeam(getHost: () => Host): any {
async function runHeavyTeam(state: any): Promise<void> {
  const host = getHost();
  const pick = state.autoTurn?.pick;
  const team = pick?.team;
  if (pick?.mode !== "heavy" || !Array.isArray(team) || team.length < 2) return;
  // Only the person's own typed turn runs a team. A call turn answers with the Leader alone (a
  // phone answer waits for no team), work a bot hands out is Auto's, a continuation of the same
  // request keeps the team's first run, and nothing of a confidential conversation leaves it.
  const opts = state.opts ?? {};
  if (state.warmOnly || state.onCall || state.voiceCallTurn || state.autoContinuing || (state.commsDepth ?? 0) > 0) return;
  if (opts.automationSource !== undefined || opts.peerAsk || state.userMessage?.peerAsk || opts.cardContinuation || opts.compactOnly || opts.coordination) return;
  if (host.isRelayPart(state.threadId) || host.store.isConfidentialThread(state.threadId)) return;
  const bot = host.store.bot(state.botId);
  if (!bot) return;

  const tracker = new HeavyTeamTracker(team, { engineLabel: pick.engineLabel, modelLabel: pick.modelLabel }, (line) => {
    host.store.patchMessage(state.threadId, row.id, { tool: { name: HEAVY_TEAM_TOOL_NAME, ok: true, team: line } });
  });
  // the row sits before the Leader's first word, where the run begins
  const row = host.store.appendMessage(state.threadId, { role: "bot", kind: "activity", tool: { name: HEAVY_TEAM_TOOL_NAME, ok: true, team: structuredClone(tracker.line) } });
  state.heavyTracker = tracker;

  const request = String(state.userMessage?.text ?? state.text ?? "");
  const context = conversationContext(host.store.messagesFor(state.threadId).filter((message) => message.id !== state.userMessage?.id));
  const waitMs = Math.max(5_000, Number(process.env.SAGAX_HEAVY_AGENT_WAIT_MS) || AGENT_WAIT_MS);
  const agentThreads = [];
  let cancelled = false;
  const stopAgents = () => {
    for (const threadId of agentThreads) void host.interruptDirectThread(bot.id, threadId).catch(() => {});
  };
  // the person's Stop ends the turn's claim: the agents stop with it
  const watch = setInterval(() => {
    if (cancelled || host.directTurnClaimIsCurrent(bot.id, state.dispatchClaimId, state.threadId)) return;
    cancelled = true;
    stopAgents();
  }, 500);
  watch.unref?.();

  try {
    const results = await runAgents({
      team,
      tracker,
      runAgent: async (agent, n, hooks) => {
        const instance = host.registry.get(agent.instanceId);
        if (!instance) return { status: "error", text: "this engine is not available" };
        const effort = agentEffort(instance.adapter?.capabilities);
        const selection = { instanceId: agent.instanceId, model: agent.model, ...(effort ? { effort } : {}) };
        // a level the agent's engine cannot carry becomes Ask in its thread, as for run_with_engine
        const level = relayThreadLevel({
          botLevel: host.approvalModeFor(bot),
          fromDriver: host.registry.cliTarget(bot.modelSelection.instanceId)?.driverKind,
          toDriver: instance.driverKind,
        });
        const task = host.store.createTask(bot.id, `Agent ${n}`, false, undefined, { botId: bot.id, name: bot.name, at: Date.now() },
          level, host.openedThreadOwner(bot, state.threadId, bot), selection, true, undefined, false);
        if (!task) return { status: "error", text: "could not open a thread for this agent" };
        agentThreads.push(task.threadId);
        heavyAgentThreads.add(task.threadId);
        host.threadStarters.set(task.threadId, host.openerFrom(state.threadId));
        host.noteRelayParent(task.threadId, state.threadId);
        if (cancelled) return { status: "error", text: "stopped" };
        const unsubscribe = host.bus.subscribe((event) => {
          if (event.threadId !== task.threadId) return;
          if (event.type === "content.delta" && event.streamKind === "assistant_text") hooks.onDelta(event.delta);
          else if (event.type === "item.completed" && event.itemType === "assistant_text") hooks.onMessage(event.text);
        });
        try {
          const outcome = await host.askBotAndWait(bot.id, agentPrompt({ n, count: team.length, modelLabel: agent.modelLabel, request, context }), 0, bot.id, state.threadId, task.threadId,
            { timeoutMs: waitMs, selfRelay: true, speaker: state.speaker });
          if (outcome.status === "timeout") {
            await host.interruptDirectThread(bot.id, task.threadId).catch(() => {});
            return { status: "timeout", text: outcome.text || "no answer in time" };
          }
          return outcome;
        } finally {
          unsubscribe();
          heavyAgentThreads.delete(task.threadId);
        }
      },
    });
    if (cancelled) {
      tracker.stop();
      throw new host.DirectTurnSetupCancelled("turn stopped while the team worked");
    }
    tracker.agentsDone();
    state.heavyNotes = leaderNotes(results);
  } catch (error) {
    if (cancelled || error instanceof host.DirectTurnSetupCancelled) {
      tracker.stop();
      throw error instanceof host.DirectTurnSetupCancelled ? error : new host.DirectTurnSetupCancelled("turn stopped while the team worked");
    }
    // a team that broke is no reason to fail the person's turn: the Leader answers alone
    tracker.stop();
    reportBackgroundError(error);
  } finally {
    clearInterval(watch);
  }
}
  return runHeavyTeam;
}
