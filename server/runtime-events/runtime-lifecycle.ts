// @ts-nocheck
/** handleRuntimeLifecycle (#1388). Pure move from server/index.ts bus.subscribe. */
import { RETRY_MAX_ATTEMPTS } from "../drivers/retry.ts";
import { driverKeyBacked } from "../config.ts";
import { keyVia } from "../engines/engine-credentials.ts";
import { isModelRefusal } from "../models/model-auto.ts";
import { deliverableNotification } from "../notify.ts";
import { redactSecretsInText } from "../redact.ts";
export function handleRuntimeLifecycle(event: any, ctx: any, host: any): void {
  const {
    bot, group, speaker, pushMessage, pushStoppedTurn,
  } = ctx;
  switch (event.type) {
    case "turn.started":
    {
      host.turnStartedAt.set(event.threadId, Date.now());
      // #1154: the turn left the bot's model for one its payer can run. The
      // model menu and the composer show it as a fallback of this thread.
      const switched = host.turnModelSwitches.get(event.threadId);
      if (switched && event.turnId) {
        host.turnModelSwitches.delete(event.threadId);
        host.broadcast({ kind: "runtime", event: {
          eventId: `${event.eventId}-model-switch`, provider: event.provider, providerInstanceId: switched.requested.instanceId,
          threadId: event.threadId, turnId: event.turnId, createdAt: event.createdAt,
          type: "session.model-fallback", requested: switched.requested.model, actual: switched.actual.model,
          ...(switched.actual.instanceId !== switched.requested.instanceId ? { actualInstanceId: switched.actual.instanceId } : {}),
          ...(switched.principalId ? { principalId: switched.principalId } : {})
        } });
      }
      // A stop that never saw its turn.completed must not pass for this turn.
      host.stoppedTurns.delete(event.threadId);
      break;
    }
    case "session.started":
      // a call's own session never becomes the conversation's cursor
      if (bot && event.sessionId && event.providerInstanceId && !(host.voiceCalls.active(event.threadId) && host.voiceSessions.noteSession(event.threadId, event.providerInstanceId, event.sessionId))) {
        host.store.setResumeCursor(bot.id, event.providerInstanceId, event.sessionId, event.threadId);
      }
      if (typeof event.model === "string" && event.model) host.sessionModelByThread.set(event.threadId, event.model);
      break;
    case "turn.retrying":
      // #2013: Codex relaunching to turn its own native MCP entries off for
      // a tool selection is Sagax's housekeeping, not a failure to show.
      if (event.reason === "ambient_mcp") break;
      // the driver is about to relaunch the turn after a transient failure;
      // the activity chip keeps the bot visibly busy through the backoff
      pushMessage({
        role: "bot",
        kind: "activity",
        tool: { name: `retrying — attempt ${event.attempt + 1}/${RETRY_MAX_ATTEMPTS} in ${Math.round(event.delayMs / 1000)}s — ${event.reason}`, ok: true }
      });
      break;
    case "session.model-fallback":
      // #1154: the model the engine really ran, kept so the next turn's
      // prompt tells the bot (modelPrompt) instead of the pick it keeps.
      host.modelFallbackByThread.set(event.threadId, { requested: event.requested, actual: event.actual });
      host.modelFallbackByPayer.set(host.modelFallbackPayerKey(event.threadId, event.providerInstanceId, event.requested), event.actual);
      // The reply's line names the model that wrote it, and the pick it replaced.
      {
        const room = bot ? undefined : host.roomTurnRuns.get(event.threadId);
        const ran = bot ? host.turnRunByThread.get(event.threadId) : room?.run;
        if (ran && ran.model === event.requested) {
          const next: TurnRun = { ...ran, model: event.actual, requested: ran.requested ?? { instanceId: ran.instanceId, model: event.requested } };
          if (bot) host.turnRunByThread.set(event.threadId, next);
          else if (room) host.roomTurnRuns.set(event.threadId, { ...room, run: next });
        }
      }
      break;
    case "runtime.notice":
      // An engine's technical note (an MCP server skipped, a session
      // rebuilt, a model fallback, a quiet engine, a Codex slot): the turn
      // carries on. It goes to the server log and the Events lens (the
      // runtime stream, server/threads/thread-events.ts), never into the chat
      // (the maintainer, 2026-10-26, shared/chat-notices.ts).
      console.info(`[notice] ${event.threadId}: ${redactSecretsInText(event.message.slice(0, 240))}`);
      break;
    case "runtime.error":
    {
      // The maintainer, 2026-11-04: an engine account at its usage limit or out of
      // credit writes no error card in the chat. #3552: the limit failover
      // writes the conversation's one line instead (the message held for the
      // reset, or nothing held), server/usage/limit-line.ts.
      let engineLimited = false;
      if (bot) {
        const instance = host.registry.get(event.providerInstanceId ?? bot.modelSelection.instanceId);
        const access = host.turnAccessByThread.get(event.threadId);
        const verdict = host.readinessFailureClass(event.message, { setup: event.setup, stalled: event.stalled, limitResetsAt: event.limitResetsAt, limitScope: event.limitScope === "model" ? "model" : undefined });
        if (instance && verdict.kind === "owner" && verdict.cause !== "setup") host.noteEngineRefusal({ engine: instance.instanceId,
          account: host.refusalAccount(access?.via ?? "server", access?.payerPrincipalId, host.turnSlotFor(bot, instance)), cause: verdict.cause,
          resetsAt: verdict.resetsAt, at: Date.now() });
        engineLimited = Boolean(instance) && verdict.kind === "owner" && (verdict.cause === "credits"
          || (verdict.cause === "usage_limit" && host.limitFailover.refusalHoldsEngine(event.threadId, event.limitScope === "model" ? "model" : undefined)));
      }

      // A stop the person asked for is not a row in the chat.
      if (event.message.trim() === "turn stopped") break;
      // A client abort is a quiet stop with retry, not a failure (shared/client-cancel.ts).
      if (host.errorTranscript(event.message).kind === "stopped") {
        pushStoppedTurn(event.turnId);
        break;
      }
      // Auto: a model the engine refused is skipped for this payer for a
      // while; the engine's own error still shows below.
      const autoRan = host.autoTurnsByThread.get(event.threadId);
      const accessDisabled = event.message === host.MODEL_ACCESS_DISABLED_MESSAGE;
      // A model at its usage limit is skipped the same way: Auto's next pick
      // goes to one that can answer instead of hitting the same wall.
      // #1760: Claude Code too old for the model is the same wall until the
      // image (or install) moves; leave it out of Auto and the picker.
      if (autoRan && (accessDisabled || event.claudeUpdate || isModelRefusal(event.message) || host.USAGE_LIMIT.test(event.message))) host.rememberAutoRefusal(autoRan.payer, autoRan.entry);
      // #1450: a model the paying account turned off leaves that payer's
      // model lists for a while: retrying it cannot help.
      // #1760: a model this Claude Code does not support leaves the picker too.
      if ((accessDisabled || event.claudeUpdate) && bot) {
        const ran = autoRan?.entry ?? host.turnSelection(bot.id, event.threadId);
        const instanceId = event.providerInstanceId ?? ran?.instanceId ?? "";
        if (ran && ran.instanceId === instanceId) host.modelAccessRefusals.remember(host.refusalPayerOf(host.turnAccessByThread.get(event.threadId)), instanceId, ran.model);
      }
      // Organization server: a key-backed engine whose provider refused the
      // key gets the key_refused card, not the generic error row.
      const refusedInstance = bot ? host.registry.get(event.providerInstanceId ?? bot.modelSelection.instanceId) : null;
      const ranOn = host.turnAccessByThread.get(event.threadId);
      const keyRefused = bot && refusedInstance ? host.keyRefusedCard({
        identity: host.IDENTITY.kind, setup: event.setup, claudeUpdate: event.claudeUpdate,
        keyBacked: driverKeyBacked(host.cfg, refusedInstance.driverKind, refusedInstance.instanceId) || keyVia(ranOn?.via),
        message: event.message, botId: bot.id, ownerPrincipalId: host.effectiveBotOwner(bot),
        engine: refusedInstance.displayName || refusedInstance.driverKind, redact: host.redactSecretsInText,
        // a person's own key: the card is theirs alone (accessCardAudience)
        ...(keyVia(ranOn?.via) && ranOn?.payerPrincipalId ? { payerPrincipalId: ranOn.payerPrincipalId } : {})
      }) : null;
      // A turn on a person's own key (slice 4) also counts: that key is dropped at once.
      if (keyRefused && keyVia(ranOn?.via) && ranOn?.payerSub && ranOn.provider) host.perspicaxDirectory?.invalidate(ranOn.payerSub, ranOn.provider);
      // #1533 / #1759: the person's own subscription sign-in was refused
      // (Claude, Codex, Grok) and could not be refreshed: their engine card
      // says Reconnect, and the chat shows the access card with that button,
      // not the engine's raw words.
      const expiredCard = bot && refusedInstance && !keyRefused ? host.subscriptionExpiredCard(bot, refusedInstance, ranOn, event.message) : null;
      // The engine refusing is a backup the usage-limit failover picked, not
      // one the person chose: no sign-in card for it. The thread goes back
      // and its "continuing on" line becomes the one error the person reads.
      if ((keyRefused || event.setup) && bot && host.limitBackupRefusedInThread(bot.id, event.threadId) !== null) break;
      // One error per bot and cause (shared/failure-dedup.ts): sending again
      // while the bot cannot answer does not write the same row twice.
      const failureFrom = group ? speaker : undefined;
      if (keyRefused && bot) {
        if (!host.repeatsShownFailure(host.store.messagesFor(event.threadId), { role: "bot", kind: "access", access: keyRefused, from: failureFrom }, bot.id)) {
          pushMessage({ role: "bot", kind: "access", access: keyRefused });
          host.notifyAccess(deliverableNotification("turn-failed", bot, event.threadId, host.engineAccessNotice("key_refused", keyRefused.engine), { avatarUrl: bot.avatarUrl, personTurn: host.directRequestOwners.get(event.threadId)?.personLine === true }), keyRefused);
        }
      } else if (expiredCard && bot && refusedInstance) {
        const showExpired = () => {
          if (!host.repeatsShownFailure(host.store.messagesFor(event.threadId), { role: "bot", kind: "access", access: expiredCard, from: failureFrom }, bot.id)) {
            pushMessage({ role: "bot", kind: "access", access: expiredCard });
            host.notifyAccess(deliverableNotification("turn-failed", bot, event.threadId, host.engineAccessNotice("no_access", expiredCard.engine, expiredCard), { avatarUrl: bot.avatarUrl, personTurn: host.directRequestOwners.get(event.threadId)?.personLine === true }), expiredCard);
          }
        };
        // #2057: a chat turn the person sent waits on the renew; the card
        // shows only when the renew really failed, and a renewed sign-in
        // sends the same message again once, with nothing to click.
        const request = host.directRequestOwners.get(event.threadId);
        const messageId = request?.messageId;
        const resendable = Boolean(messageId && !request?.stopped && request?.origin?.kind === "user" &&
          !ranOn?.routine && !host.routines?.runForThread(event.threadId));
        const resendSpeaker = host.turnSpeakers.get(event.threadId);
        const failedTool = host.failedTurnTool(event.message, event);
        const held = host.holdSignInRefusal(bot, refusedInstance, expiredCard, event.threadId, resendable, {
          show: (afterHold) => {
            showExpired();
            if (afterHold) host.reportIncident({ kind: "failed", bot, threadId: event.threadId, detail: host.redactSecretsInText(event.message).slice(0, 600) });
          },
          resend: () => {
            if (!messageId) return false;
            host.resendUserMessage(bot.id, event.threadId, messageId, resendSpeaker, "sign-in-retry");
            return true;
          },
          fail: () => {
            if (!host.repeatsShownFailure(host.store.messagesFor(event.threadId), { role: "bot", kind: "activity", tool: failedTool, from: failureFrom }, bot.id)) {
              pushMessage({ role: "bot", kind: "activity", tool: failedTool });
            }
            host.reportIncident({ kind: "failed", bot, threadId: event.threadId, detail: host.redactSecretsInText(event.message).slice(0, 600) });
          }
        });
        if (held) host.signInRefusalHeld.add(event.threadId);
      } else {
        const tool = host.failedTurnTool(event.message, event);
        // #2013 (the maintainer, 2026-11-05): a refusal before any prompt went out (the
        // engine not ready, its own configuration in conflict, its sign-in
        // expired) is no red card in a bot's chat: the composer says it with
        // its action (sendStateFor, shared/send-state.ts engine_refused).
        const preSend = bot && !group && !tool.place ? host.preSendRefusalKind(event.message, event) : null;
        const refusedOn = bot ? host.registry.get(event.providerInstanceId ?? bot.modelSelection.instanceId) : null;
        if (preSend && preSend !== "engine_limit" && bot && refusedOn) {
          const fix = preSend === "config_conflict" && host.isCodexAmbientMcpRefusal(event.message) && host.ambientRefusalFor(event.threadId) ? "codex_native_mcp" as const : undefined;
          host.preSendRefusals.note(event.threadId, { kind: preSend, cause: host.redactSecretsInText(event.message).slice(0, 600), instanceId: refusedOn.instanceId, ...(fix ? { fix } : {}), at: Date.now() });
        } else if (!engineLimited && !host.repeatsShownFailure(host.store.messagesFor(event.threadId), { role: "bot", kind: "activity", tool, from: failureFrom }, bot?.id ?? "")) {
          pushMessage({ role: "bot", kind: "activity", tool });
        }
      }
      // a setup error means the engine could not even start: the bot is
      // dead until something changes, not merely idle. The next successful
      // dispatch moves it to working; turn.completed (which follows a setup
      // failure) is told to leave "dead" alone.
      if (event.setup && bot) host.store.setTaskActivity(bot.id, event.threadId, "dead");
      break;
    }
    case "thread.token-usage.updated":
      // running totals for the turn in flight; folded into the task's
      // tally at turn.completed (below) so retries never double-count
      host.turnUsage.set(event.threadId, { input: event.input, output: event.output, cachedInput: event.cachedInput });
      if (event.contextTokens !== undefined || event.contextWindow !== undefined) {
        host.turnContext.set(event.threadId, { tokens: event.contextTokens, window: event.contextWindow });
      }
      break;
  }
}
