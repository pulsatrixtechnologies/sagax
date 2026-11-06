// @ts-nocheck
/** resolveAndSendTeamSetup (#1388). Pure move from server/index.ts. */
import { DATA_DIR } from "../config.ts";
import { appendDecision } from "../decision-log.ts";
import { json } from "../harness/http.ts";
export type Host = Record<string, any>;

export function createResolveAndSendTeamSetup(getHost: () => Host): any {
async function resolveAndSendTeamSetup(res: ServerResponse, args: { botId: string; threadId: string; requestId: string; behavior: string }, applyRefusal: (request: TeamSetupRequest) => Record<string, unknown> | null): Promise<boolean> {
  const host = getHost();
  const card = host.store.messagesFor(args.threadId).find((item) => item.card?.requestId === args.requestId && item.card.teamSetupRequest)?.card;
  if (!card) return false;
  const refused = args.behavior === "allow" ? applyRefusal(card.teamSetupRequest!) : null;
  if (refused) { json(res, 403, refused); return true; }
  if (args.behavior === "allow" && !card.answered && !card.dismissed && !card.expired) {
    // Confirmed Primary Bot setup can move bots without the ordinary PATCH route.
    // Keep that atomic Store operation behind the same shared-machine fence.
    for (const operation of card.teamSetupRequest!.operations) {
      const before = host.store.bot(operation.botId);
      if (before && operation.action === "update") host.assertTeamComputerChangeIdle(before, { ...before, ...operation.fields });
    }
  }
  const resolved = await host.teamSetupRequests.resolve(args);
  if (!resolved) return false;
  if (!resolved.duplicate) {
    appendDecision(DATA_DIR, { threadId: args.threadId, requestId: args.requestId, botId: args.botId, tool: card.tool,
      summary: card.subtitle, decision: resolved.result.state === "applied" ? "user-approved" : "user-denied", source: "user" });
  }
  // The decision is recorded; the node parked on the card (a bot's own
  // conversation or a room member's) runs again with it. The card says
  // `resumed` only once the runtime took the answer, so a decision after a
  // Stop starts nothing.
  const current = host.store.messagesFor(args.threadId).find((item) => item.id === resolved.messageId);
  if (current?.card?.teamSetupRequest?.result && !current.card.teamSetupRequest.resumed) {
    if (host.answerCardNode(args.threadId, current.id, host.teamSetupDecisionText(resolved.request))) {
      host.store.patchMessage(args.threadId, current.id, { card: { ...current.card, teamSetupRequest: { ...current.card.teamSetupRequest, resumed: true } } });
    }
  }
  json(res, 200, { ok: true, outcome: resolved.result.state === "applied" ? "allowed-once" : "rejected", result: resolved.result, alreadySettled: resolved.duplicate });
  return true;
}
  return resolveAndSendTeamSetup;
}
