// @ts-nocheck
/** botActs (#1388). Pure move from server/index.ts. */
import { requiredScope } from "../auth/request-auth.ts";
export type Host = Record<string, any>;

export function createBotActs(getHost: () => Host): any {
function botActs() {
  const host = getHost();
  const { DATA_DIR, STEP_UP_CLASSES, appendDecision, randomUUID, ruleCoversExactScope, sharedComputersEnabled } = host;
  host.botActService ??= createBotActService({
    now: () => Date.now(),
    // 0.8.46: a line a bot's act writes as the person is never taken as the
    // person's own answer to a parked question (start-turn-prepare-admit.ts).
    markActSend: (sendId) => host.markBotActSend(sendId),
    newId: () => randomUUID(),
    neededScope: (method, path) => requiredScope(method, path, {
      sharedComputers: sharedComputersEnabled(host.cfg),
      orgPairing: host.IDENTITY.kind === "perspicax",
      orgDirectory: host.IDENTITY.kind === "perspicax",
      serverCatalogue: host.IDENTITY.kind !== "perspicax"
    }),
    operatorAudience: () => host.localPrincipalId(),
    sessionForPerson: (key) => {
      const live = host.sessions.liveWhere((session) => host.personKey(session) === key);
      const admin = live.find((session) => session.scopes.includes("admin"));
      const picked = admin ?? live[0];
      return picked ? { id: picked.id, scopes: [...picked.scopes] } : null;
    },
    performRoute: host.performBotActRouteOutsideConfidential,
    broadcastUi: (audience, command, input) => {
      // a screen command never opens or names a confidential thread
      if (host.namesConfidentialThread(JSON.stringify(input))) return;
      host.broadcast({ kind: "bot-act", audience, action: command, ...(Object.keys(input).length ? { input } : {}) });
    },
    postCard: ({ threadId, botId, botName, botColor, requestId, summary, rule }) => {
      // a bot act's card, applied at Full by its route (selfApplyBlocked,
      // fullAccessForSource); full-access: proposal
      const message = host.store.appendMessage(threadId, {
        role: "bot",
        kind: "options",
        from: { botId, name: botName, color: botColor },
        card: {
          title: "Approval needed",
          subtitle: summary,
          options: ["Allow", "Deny"],
          requestId,
          tool: "act",
          botActRequest: { id: requestId },
          // 2026-10-19: what Always allow keeps on this card
          ...(rule ? { ownerRule: { tool: rule.tool, scope: rule.scope, description: rule.description } } : {})
        }
      });
      return { messageId: message.id };
    },
    // 2026-10-19 ("Toujours permettre" on every card): the person's own
    // rule for this bot, the very same setting or route (and value when it
    // is bound to one), while no security key of theirs protects the change
    actRule: ({ person, botId, candidate, classes }) => {
      const owner = person ?? host.localPrincipalId();
      const protectedBy = classes.filter((name): name is StepUpClass => (STEP_UP_CLASSES as readonly string[]).includes(name));
      if (protectedBy.length && host.securityKeys.required(owner, protectedBy, owner).length) return null;
      const rule = host.ownerApprovals.rulesOf(owner, botId).find((row) => row.botId === botId && ruleCoversExactScope(row, candidate.tool, candidate.scope));
      return rule ? { id: rule.id } : null;
    },
    saveActRule: ({ person, botId, candidate }) => {
      const owner = person ?? host.localPrincipalId();
      try {
        const saved = host.ownerApprovals.add({ ownerId: owner, botId, tool: candidate.tool, scope: candidate.scope, behavior: "allow", description: candidate.description });
        host.orgAudit({
          category: "approval", action: "approval.rule.save", target: host.auditBotTarget(botId),
          after: { rule: saved.id, behavior: saved.behavior, tool: saved.tool },
          actor: host.IDENTITY.kind === "perspicax" && person ? { kind: "person", principalId: person, via: "sagax" } : { kind: "loopback" }
        });
        return null;
      } catch (error) {
        const status = (error as { status?: number }).status;
        return { status: status === 409 || status === 503 ? status : 500, error: error instanceof Error ? error.message : String(error) };
      }
    },
    describeAct: (target) => host.describeActForRule(target),
    journalRule: ({ threadId, botId, botName, summary, rule }) => {
      appendDecision(DATA_DIR, { threadId, requestId: `act-rule-${randomUUID()}`, botId, botName, tool: "act", summary, decision: "auto-approved", source: "owner-rule", rule });
      host.store.appendMessage(threadId, { role: "bot", kind: "activity", from: { botId, name: botName, color: host.store.bot(botId)?.color ?? "" }, tool: { name: `approved (your rule): ${summary.slice(0, 120)}`, ok: true } });
    },
    patchCard: (threadId, messageId, patch) => {
      const message = host.store.messagesFor(threadId).find((row) => row.id === messageId);
      if (!message?.card) return;
      host.store.patchMessage(threadId, messageId, { card: { ...message.card, ...patch } });
    },
    findCard: (threadId, requestId) => {
      const message = host.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId && row.card.botActRequest);
      if (!message?.card) return null;
      return { messageId: message.id, answered: message.card.answered, dismissed: message.card.dismissed, expired: message.card.expired };
    }
  });
  return host.botActService;

}
  return botActs;
}
