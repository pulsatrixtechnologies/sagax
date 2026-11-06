// @ts-nocheck
/** settingsActions (#1388). Pure move from server/index.ts. */
import { actorForTurn } from "../../shared/bot-act.ts";
export type Host = Record<string, any>;

export function createIndexSettingsActions(getHost: () => Host): any {
function settingsActions() {
  const host = getHost();
  const { appendAdminAction } = host;
  host.settingsActionService ??= host.createSettingsActions({
    organization: () => host.IDENTITY.kind === "perspicax",
    facts: host.actTurnFacts,
    acts: host.botActs,
    operatorId: () => host.localPrincipalId(),
    botOwner: (botId) => {
      const bot = host.store.bot(botId);
      return bot ? host.effectiveBotOwner(bot) || null : null;
    },
    botOfThread: (threadId) => host.store.botByThread(threadId)?.id ?? null,
    routineBot: (routineId) => host.routines?.listRoutines().find((routine) => routine.id === routineId)?.botId ?? null,
    groupOwner: (groupId) => {
      const group = host.store.groups.find((candidate) => candidate.id === groupId);
      if (!group) return null;
      return host.IDENTITY.kind === "perspicax" ? host.groupOwnerId(group) : host.localPrincipalId();
    },
    // 2026-10-26: the people of a group (a group of the person's own bots
    // only is theirs: settings-actions.ts)
    groupHumans: (groupId) => host.store.groups.find((candidate) => candidate.id === groupId)?.humanIds ?? null,
    turnMode: (botId, threadId) => {
      const bot = host.store.projectBotForTask(botId, threadId) ?? host.store.bot(botId);
      return bot ? host.approvalModeForTurn(bot, false, threadId) : "ask";
    },
    approvalLevel: (botId, threadId) => host.approvalLevelOf(botId, threadId),
    keyRequired: (person, classes, fallback) => host.securityKeys.required(person, classes, fallback),
    // 2026-10-20: the person asked their Primary Bot for this change now
    personAsked: (input, quote) => {
      const gate = host.primaryTurnGate(input.botId, input.threadId, input.generation, "settings");
      if ("error" in gate) return gate.error;
      const check = host.checkPersonQuote({ quote, message: gate.message.text, intent: "setting" });
      return check.ok ? { message: gate.message.text, primary: { botId: gate.botId, botName: gate.botName, messageId: gate.message.id } } : check.reason;
    },
    ruleText: (person, kind, id) => {
      if (!person) return undefined;
      if (kind === "custom") return host.customRules.get(person, id)?.when;
      const rule = host.ownerApprovals.rulesOf(person).find((row) => row.id === id);
      return rule ? [rule.description, ...Object.values(rule.scope ?? {})].join(" ") : undefined;
    },
    instanceName: (instanceId) => host.registry.get(instanceId)?.displayName,
    // #1545 (2026-10-28): a secret copied by reference stays on the server
    vaultValue: (person, itemId, field) => host.credentialVault.reveal(host.IDENTITY.kind === "perspicax" ? person : host.LOCAL_VAULT_PRINCIPAL, itemId, field),
    // #1545 (2026-10-28): an engine another person's bot, or the
    // organization's default model, uses: changing it stops their work
    engineShared: (instanceId, speaker) => {
      if (!speaker) return undefined;
      if (host.cfg.defaultModelSelection?.instanceId === instanceId || host.cfg.newBotDefaults?.profile.modelSelection?.instanceId === instanceId) return true;
      return host.store.bots.some((bot) => host.effectiveBotOwner(bot) !== speaker
        && (bot.modelSelection?.instanceId === instanceId || (bot.fallback ?? []).some((row) => row.instanceId === instanceId)));
    },
    targetName: (kind, id, botId) => {
      if (kind === "bot") return host.store.bot(id)?.name;
      if (kind === "thread") return botId ? `${host.store.bot(botId)?.name ?? "Bot"}: ${host.store.taskByThread(botId, id)?.title ?? "conversation"}` : undefined;
      if (kind === "routine") return host.routines?.listRoutines().find((routine) => routine.id === id)?.name;
      if (kind === "group") return host.store.groups.find((group) => group.id === id)?.name;
      if (kind === "section") return id;
      return undefined;
    },
    audit: ({ key, target, value, secret, how, botId, actor, primary }) => {
      appendAdminAction(host.DATA_DIR, {
        category: "setting",
        action: "setting.change",
        ...(target ? { target: { kind: key.split(".")[0] ?? "setting", id: target } } : {}),
        changed: [key],
        // a long value is kept as its size and fingerprint, a secret never;
        // a Primary Bot's change on the person's words says so (2026-10-20)
        after: { [key]: secret ? "[hidden]" : host.auditValue(value), how, bot: botId, ...(primary ? { via: "primary-bot", viaBot: primary.botName, messageId: primary.messageId } : {}) },
        actor: actor && host.IDENTITY.kind === "perspicax" ? { kind: "person", principalId: actor, via: "sagax" } : { kind: "loopback" }
      });
    },
    screen: (facts, command, input) => {
      const actor = actorForTurn(facts);
      if (actor.kind === "none") return { status: 403, body: { error: "This turn is not tied to a signed-in person." } };
      const audience = actor.kind === "person" ? actor.personKey : host.localPrincipalId();
      host.broadcast({ kind: "bot-act", audience, action: command, input });
      return { status: 200, body: { text: "Done." } };
    },
    // #1545: an engine's sign-in card, like request_credential's: the person
    // signs in from Settings > Models; only they see the card
    card: (input, card) => {
      const actor = actorForTurn(host.actTurnFacts(input.threadId, input.generation));
      const person = actor.kind === "person" ? actor.personKey : actor.kind === "operator" ? host.localPrincipalId() : null;
      if (!person) return { status: 403, body: { error: "This turn is not tied to a signed-in person: nobody to sign in." } };
      const owner = host.connectorThread(input.botId, input.threadId);
      if (!owner) return { status: 403, body: { error: "source conversation does not belong to sender" } };
      host.store.appendMessage(input.threadId, {
        role: "bot",
        kind: "access",
        text: `${owner.bot.name} asks you to sign in to ${card.name}. Open Settings > Models to sign in.`,
        ...(owner.group ? { from: { botId: owner.bot.id, name: owner.bot.name, color: owner.bot.color } } : {}),
        access: { reason: "sign_in", engine: card.name, instanceId: card.instanceId, botId: owner.bot.id, botName: owner.bot.name, ownerPrincipalId: person, payerPrincipalId: person }
      });
      return { status: 201, body: { text: "posted" } };
    }
  });
  return host.settingsActionService;

}
  return settingsActions;
}
