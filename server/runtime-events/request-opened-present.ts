// @ts-nocheck
/** presentRequestOpened: the answer half of request.opened (#1388). */
import { modelReviewCardEligible } from "../../shared/custom-rules.ts";
import { HELD_NOTE } from "../approvals/auto-approve.ts";
import { approvalPlain } from "../../shared/approval-describe.ts";
import {
  approvalHeldNote,
  approvalHeldReason,
  deliverFullAccessApproval,
} from "../approvals/auto-approve.ts";
import { appendDecision, decisionCall } from "../decision-log.ts";
import { deliverableNotification } from "../notify.ts";
import { choiceQuestionMismatch } from "../../shared/notification-context.ts";
import { questionNotificationWords } from "./question-notification-words.ts";
import {
  customRuleCandidate,
  serverHome,
} from "../rules/custom-rules-review.ts";
import {
  safetyArm,
} from "../safety/safety-review.ts";

/** The answer half of request.opened: an automatic answer, a hold, or the card the person sees. */
export function presentRequestOpened(event: any, ctx: any, host: any, s: any): void {
  const { bot, pushMessage, routineRun } = ctx;
  const { adminApproval, asker, cardAnswerer, command, customCall, customDecision, customNotice, customReview, destinationAnswerer, effectiveApprovalMode, emailDraftRequest, foreignDestination, gateAllowKey, gateGrantBlocked, grantsOffered, guestDriven, ownSandboxCall, owner, ownerCall, ownerOriginRefused, ownerRuleCandidate, ownerRuleFolderCandidate, ownerStepUp, permission, safetyEffect, safetyWho, serverCommandHolder, strictCard, toolAllowKey, unattended, verdict } = s;
      if (verdict?.approve && asker && event.requestId) {
        const instance = event.providerInstanceId
          ? host.registry.get(event.providerInstanceId)
          : host.registry.get(asker.modelSelection.instanceId);
        const requestId = event.requestId;
        const { tool, summary } = event;
        const sourceGeneration = host.directTurnGenerationByThread.get(event.threadId);
        const sourceSpeaker = host.groupSpeakers.get(event.threadId);
        const isCurrent = () => !host.shouldIgnoreProviderEvent(event) && (
          (sourceGeneration !== undefined && host.directTurnGenerationByThread.get(event.threadId) === sourceGeneration) ||
          (sourceSpeaker !== undefined && host.groupSpeakers.get(event.threadId) === sourceSpeaker)
        );
        // The chip is written only AFTER the provider takes the answer.
        // Claiming approval first and correcting later means a moment
        // where the transcript says "approved" over a request nothing
        // answered — and if the provider is gone entirely, forever.
        void (async () => {
          const outcome = await deliverFullAccessApproval(instance?.adapter, event.threadId, requestId, event.turnId, isCurrent);
          if (!isCurrent()) return;
          if (outcome !== "allowed-once") {
            host.watchdog.setWaitingOnHuman(event.threadId, false);
            if (outcome !== "unavailable") pushMessage({
              role: "bot", kind: "activity",
              tool: outcome === "rejected"
                ? { name: `The provider rejected this action despite ${verdict.source === "command-allowlist" ? "the saved command permission" : verdict.source === "widget-approval" ? "your approval in the ConnectWise widget" : verdict.source === "owner-rule" || verdict.source === "custom-rule" ? "your rule" : verdict.source === "admin-rule" ? "an admin's saved rule" : verdict.source === "email-draft-approval" ? "your approval of the email draft" : verdict.source === "owner-auto" ? "automatic approval" : verdict.source === "owner-bypass" ? "bypass" : verdict.source === "own-environment" ? "your own environment" : "Full access"}.`, ok: false }
                : host.failedTurnTool("could not deliver approval to the provider; retry the task after reconnecting.")
            });
            return;
          }
          // 2026-10-28: an ask answered with no card is not a row of its
          // own ("approved ... (full access)" read like a permission asked
          // each time): what answered it goes on the call's own row, in its
          // details (tool-auto-approval.ts).
          host.noteAutoApproval(event.threadId, [tool, event.mcpTool], {
            source: verdict.source,
            ...("rule" in verdict && typeof verdict.rule === "string" ? { rule: verdict.rule } : {})
          }, verdict.source === "custom-rule" && customNotice ? customNotice : undefined);
          // Log only once the provider has actually taken the answer.
          appendDecision(host.DATA_DIR, {
            threadId: event.threadId,
            requestId,
            botId: asker.id,
            botName: asker.name,
            tool,
            summary,
            decision: "auto-approved",
            source: verdict.source,
            ...("rule" in verdict && typeof verdict.rule === "string" ? { rule: verdict.rule } : {}),
            ...(customCall ? { call: decisionCall(customCall) } : {})
          });
        })().catch(() => {
          // A receipt failure must neither crash the server nor manufacture
          // a new permission request after the provider took our answer.
          console.error("[approval] Could not record the provider approval result.");
        });
        return;
      }
      if (safetyEffect?.kind === "hold" && event.requestId) {
        safetyArm(event.requestId, {
          ...(safetyWho?.principalId ? { principalId: safetyWho.principalId } : {}),
          threadId: event.threadId,
          fingerprint: safetyEffect.fingerprint,
          ...(safetyEffect.classKey ? { classKey: safetyEffect.classKey } : {})
        });
      }
      const heldContext = { source: verdict?.source, permission };
      // A structured ask (Claude's AskUserQuestion) is a question whatever
      // the provider routed it as: it has no allow/deny answer, only the
      // model's own options. The card carries them so the person can choose.
      const questions = event.questions?.length ? event.questions : undefined;
      // One generator for the card and its push (shared/approval-describe.ts):
      // "Allow the bot to run a command?" and one plain line, never a raw id.
      const plainWords = permission ? host.serverApprovalWords(host.languageOfPerson(cardAnswerer)) : undefined;
      const declaredProduct = permission ? host.declaredToolProduct(asker?.id, event.mcpTool ?? event.tool ?? "", event.input) : undefined;
      const plain = plainWords ? approvalPlain({ botName: asker?.name, tool: event.mcpTool ?? event.tool, toolInput: event.input, detail: event.summary, ...(declaredProduct ? { hints: declaredProduct } : {}) }, plainWords) : undefined;
      // An AI client's hidden conversation (#291) is not in anyone's sidebar:
      // its approval still reaches the person, and is declined when nobody
      // answers in time instead of holding the turn forever.
      const hiddenApproval = Boolean(permission && event.requestId && host.notificationInHiddenThread(event.threadId));
      // a routine run's card waits as long as the engine does (2 h), not the AI-client 15 minutes
      const hiddenApprovalTtl = host.routineApprovalWaitMs(event.threadId) ?? host.HIDDEN_APPROVAL_TTL_MS;
      // #1905 (2026-11-02): a may-I the model poses through its own question
      // tool ("Should I continue?", "May I contact the verifier?") under
      // Full access is the person's own answer already: the recommended
      // option, the first one, is given back and the turn goes on. A real
      // decision, a form of several questions, a multi-select and a fact
      // only the person can supply keep their card (full-access-gate.ts).
      // A harness ask (ask_choice) has this same reading in createChoiceCard,
      // and a Yes/No on "A, or B?" keeps its card on both (#2911,
      // fullAccessChoiceAnswer reads choiceOptionsFor).
      if (!permission && asker && event.requestId && !guestDriven && !event.harnessAsk) {
        const single = questions?.length === 1 ? questions[0] : undefined;
        const choice = single
          ? { ...(single.header ? { title: single.header } : {}), question: single.question, options: single.options.map((option) => option.label) }
          : !questions && event.choices?.length ? { question: event.summary, options: event.choices } : undefined;
        const answered = choice && single?.multiSelect !== true ? host.fullAccessChoiceAnswer(effectiveApprovalMode, choice) : null;
        if (answered && choice) {
          const instance = event.providerInstanceId ? host.registry.get(event.providerInstanceId) : host.registry.get(asker.modelSelection.instanceId);
          const requestId = event.requestId;
          const line = host.fullAccessChoiceLine(asker.name, choice.question, answered.choice);
          // full-access: question
          const settled = pushMessage({
            role: "bot", kind: "options",
            card: { title: "Your bot has a question", subtitle: choice.question, options: choice.options, requestType: "question", answered: "answer", answeredText: answered.choice, autoApplied: true },
          });
          void (async () => {
            const outcome = instance ? await instance.adapter.respondToRequest(event.threadId, requestId, { behavior: "answer", message: answered.choice }).catch(() => "unavailable" as const) : "unavailable";
            if (outcome !== "answered") {
              host.store.patchMessage(event.threadId, settled.id, { card: { title: "Your bot has a question", subtitle: choice.question, options: choice.options, requestType: "question", expired: true } });
              pushMessage({ role: "bot", kind: "activity", tool: { name: "Full access could not deliver the answer to the engine; retry the task after reconnecting.", ok: false } });
              return;
            }
            pushMessage({ role: "bot", kind: "activity", tool: { name: line, ok: true, autoApproval: { source: "full-access" } } });
            appendDecision(host.DATA_DIR, {
              threadId: event.threadId, requestId, botId: asker.id, botName: asker.name,
              tool: event.tool, summary: line, decision: "auto-approved", source: "full-access",
            });
          })().catch(() => console.error("[approval] Could not record a question Full access answered."));
          return;
        }
      }
      // #2909: a Yes / No on "A or B?" (or on an open question) from the
      // engine's own question tool cannot be answered by a tap: the same
      // rule as ask_choice (shared/options-card.ts). The engine gets the
      // reason back and asks again with the alternatives as options; the
      // chat shows that it happened (nothing invisible).
      const mismatch = nativeChoiceMismatch(event, questions, permission);
      if (mismatch && asker && event.requestId && !guestDriven && !event.harnessAsk) {
        const instance = event.providerInstanceId ? host.registry.get(event.providerInstanceId) : host.registry.get(asker.modelSelection.instanceId);
        if (instance) {
          const requestId = event.requestId;
          void (async () => {
            const outcome = await instance.adapter
              .respondToRequest(event.threadId, requestId, { behavior: "answer", message: `Sagax: not asked. ${mismatch}` })
              .catch(() => "unavailable" as const);
            pushMessage({
              role: "bot", kind: "activity",
              tool: outcome === "answered"
                ? { name: "Question sent back: its options did not match it (Yes / No on a pick between alternatives).", ok: true }
                : { name: "A question with options that did not match it could not be sent back to the engine.", ok: false },
            });
          })().catch(() => console.error("[approval] Could not send back a mismatched question."));
          return;
        }
      }
      // full-access: tool-approval
      const message = pushMessage({
        role: "bot",
        kind: "options",
        card: {
          title:
            permission && event.approvalScope === "local-computer"
              ? "Local computer approval"
              : permission
                ? "Approval needed"
                : "Your bot has a question",
          subtitle: event.summary,
          options: event.choices?.length ? event.choices : permission ? ["Allow", "Deny"] : [],
          requestId: event.requestId,
          requestType: permission ? "permission" : "question",
          tool: permission ? event.tool : undefined,
          toolInput: permission ? event.input : undefined,
          // 2026-10-27: the product the server declared for this tool, so
          // the card names it (shared/approval-describe.ts productFor)
          ...(permission && declaredProduct ? { toolHints: declaredProduct } : {}),
          questionRequest: questions
            ? { version: 1, questions, ...(event.origin === "output" ? { origin: "output" as const } : {}) }
            : undefined,
          ...(event.pageTargetChoice ? { pageTargetChoice: event.pageTargetChoice } : {}),
          commandAllowlist: command ?? undefined,
          ...(gateAllowKey && !strictCard && grantsOffered && !guestDriven && !gateGrantBlocked ? { allowKey: gateAllowKey } : toolAllowKey ? { allowKey: toolAllowKey } : {}),
          // Provider-owned session grants remain separate from exact commands.
          // a member's bot is approved one action at a time: a session rule
          // (Claude's own suggestion) could reach past its workspace, except
          // in the person's own sandbox (grantsOffered, #1098). Never on
          // a guest's turn either: an "always" for it would outlive it.
          // Review of #943: never on an outward call (a send, an engine
          // connector's write): each one is approved on its own card.
          allowSession: permission && event.allowSession && !event.requiresExplicitApproval && !strictCard && grantsOffered && !guestDriven && !destinationAnswerer && !foreignDestination && safetyEffect?.kind !== "hold"
            && event.outbound !== true && !host.isOutboundTool(event.mcpTool ?? event.tool) ? true : undefined,
          ...(adminApproval ? { adminApproval: true } : {}),
          ...(destinationAnswerer ? { destinationAnswerer } : {}),
          ...(serverCommandHolder ? { serverCommandHolder: true } : {}),
          ...(ownSandboxCall ? { ownSandbox: true } : {}),
          // who will answer it, for the member's waiting line
          ...(adminApproval && host.orgAdminNames().length ? { adminNames: host.orgAdminNames() } : {}),
          // The text stays for cards saved before heldCode existed, and for
          // clients that do not know the key yet.
          // An engine connector's call whose arguments the engine did not
          // send says so (review of #943).
          held: permission && event.engineConnector === true && !event.input ? HELD_NOTE["approval.held.connectorNoDetails"] : approvalHeldReason(heldContext),
          heldCode: permission && event.engineConnector === true && !event.input ? "approval.held.connectorNoDetails" : approvalHeldNote(heldContext),
          approvalScope: event.approvalScope,
          // action and locale: a phone words its own heading ("Nova wants
          // to {action}") when the card is in its reader's language (#426)
          ...(plain ? { plain: { title: plain.title, line: plain.line, action: plain.action, locale: plainWords?.locale ?? "en", ...(plain.risk ? { risk: plain.risk } : {}) } } : {}),
          ...(permission && event.mcpTool ? { mcpTool: event.mcpTool } : {}),
          ...(ownerRuleCandidate ? { ownerRule: ownerRuleCandidate } : {}),
          ...(ownerRuleFolderCandidate ? { ownerRuleFolder: ownerRuleFolderCandidate } : {}),
          // the person's own "Ask first" rule held it: the line names it
          ...(permission && owner?.kind === "card" && owner.reason === "ask-rule" && owner.rule ? { heldRule: { description: owner.rule.description.slice(0, 200) } } : {}),
          // the rule notice: an ask rule held this card, or an allow rule
          // matched without covering its risk class
          ...(permission && customNotice && (customNotice.outcome === "held" || customNotice.outcome === "risk") ? { customRule: customNotice } : {}),
          // "Toujours permettre ceci": never on an admin card, a guest's
          // turn, a safety hold, a sandbox widening or under an ask rule
          ...(permission && customReview && !adminApproval && !guestDriven && safetyEffect?.kind !== "hold" && !event.requiresExplicitApproval && customDecision?.kind !== "ask"
            ? (() => {
              const candidate = customRuleCandidate(customReview.facts, host.languageOfPerson(cardAnswerer), serverHome(), host.ruleProductsOf(asker?.id));
              return candidate ? { customRuleCandidate: candidate } : {};
            })()
            : {}),
          ...(hiddenApproval
            ? { expiresAt: Date.now() + hiddenApprovalTtl }
            : (() => {
              // #1940: every inbox card carries expiresAt so clients see when it leaves.
              const days = host.pendingExpireDaysForThread(event.threadId);
              const at = host.pendingApprovalExpiresAt(Date.now(), days);
              return at !== null ? { expiresAt: at } : {};
            })())
        }
      });
      if (event.requestId) host.askMessageByRequest.set(`${event.threadId}:${event.requestId}`, message.id);
      // 2026-10-19: a card in a bot-to-bot conversation refreshes the bot's
      // waitingApprovals, even when the conversation already waited on an
      // earlier card (no activity change, so no bot frame otherwise).
      if (asker && event.threadId) {
        const opener = host.store.taskByThread(asker.id, event.threadId)?.openedBy?.botId;
        const fresh = opener && opener !== asker.id ? host.store.bot(asker.id) : undefined;
        if (fresh) host.broadcast({ kind: "bot", bot: host.wireBot(fresh) });
      }
      if (hiddenApproval && asker) host.scheduleApprovalExpiry({
        threadId: event.threadId, requestId: event.requestId!, messageId: message.id,
        instanceId: event.providerInstanceId ?? asker.modelSelection.instanceId, botId: asker.id, botName: asker.name
      }, hiddenApprovalTtl);
      if (command && asker && event.requestId) host.pendingCommandRules.set(`${event.threadId}:${event.requestId}`, { botId: asker.id, candidate: command });
      // Every card that reaches a human is a decision too: "the provider
      // left this for you, in this mode". `question` marks the cards no
      // rule may ever answer; a permission card without a verdict (no known
      // asker, or no requestId to answer through) can only mean nothing was
      // granted.
      appendDecision(host.DATA_DIR, {
        threadId: event.threadId,
        requestId: event.requestId,
        botId: asker?.id,
        botName: asker?.name,
        tool: event.tool,
        summary: event.summary,
        decision: "card-shown",
        source: !permission ? "question" : verdict ? verdict.source : "no-grant",
        // 2026-10-26 (Journal): the rule that kept the card, and what a
        // rule test reads of the call
        ...(verdict && "rule" in verdict && typeof verdict.rule === "string" ? { rule: verdict.rule }
          : verdict?.source === "custom-rule-ask" && customDecision?.kind === "ask" ? { rule: customDecision.rule.id } : {}),
        ...(customCall ? { call: decisionCall(customCall) } : {}),
        origin: !permission && event.origin === "output" ? "output" : undefined,
        unattended: unattended || undefined
      });
      // Notify from HERE, not from a separate subscriber on request.opened:
      // this is the branch where a card actually reached a human. Anything
      // Full access answered took the early return above and never buzzes.
      // 2026-10-21 (the reference design parity A1, extended by A1b: comme Grok): a
      // card the matcher left is judged by the model reviewer, including a
      // routine, a webhook and another bot. The action stays untrusted
      // data. A guest, an admin card, a hold, a sandbox widening, a
      // question, a security key, an owner ask rule and an email draft stay
      // with the person. While it judges, the card says so and nobody is
      // notified yet.
      const modelReview = Boolean(asker && event.requestId && customReview && customDecision && modelReviewCardEligible({
        permission, requestId: true, reviewed: true,
        decision: customDecision.kind === "none" && customDecision.riskBlocked ? "blocked" : customDecision.kind,
        questions: Boolean(questions), strictCard, guest: guestDriven, adminApproval,
        hold: safetyEffect?.kind === "hold", explicitApproval: event.requiresExplicitApproval === true,
        ownerCall: Boolean(ownerCall), stepUp: ownerStepUp.length > 0, originRefused: ownerOriginRefused,
        emailDraft: Boolean(emailDraftRequest),
        ...(owner ? { owner: { kind: owner.kind, ...("reason" in owner ? { reason: owner.reason } : {}) } } : {})
      }));
      if (asker) {
        const card = host.store.messagesFor(event.threadId).find((candidate) => candidate.id === message.id)?.card;
        if (card && !card.answered) {
          const tellThePerson = () => {
            const notification = host.originApprovals.notificationFor(event.threadId, message.id);
            if (!notification) return;
            // the bot is not working now. it is waiting on a person
            if (bot) host.store.setTaskActivity(bot.id, event.threadId, "waiting-on-you");
            // A routine run's card waits in its hidden task: its one message in
            // the person's conversation says so and opens the run (2026-10-22).
            const waitingRun = routineRun ? host.routines?.runForThread(event.threadId) : null;
            if (waitingRun?.status === "waiting") host.syncRoutineRunToSource(waitingRun);
            else if (!bot && asker.busy) host.store.setActivity(asker.id, "waiting-on-you");
            if (event.requestId) host.showWaitingOnPersonChip(event.threadId, event.requestId, asker, permission ? "approval" : "answer");
            const notificationThread = notification.threadId;
            const notificationBot = (notificationThread !== event.threadId && host.store.botByThread(notificationThread))
              || (routineRun && host.routineSourceOwner(routineRun)?.bot) || asker;
            const notificationRequest = notification.requestId;
            // A peer view routes back to the execution; routines keep their
            // execution thread (#1743). Allow and withdrawal use the same address.
            // #2909: what the person reads before choosing, from the card itself
            const words = questionNotificationWords({
              permission, asker: asker.name, routed: notificationBot.name,
              summary: event.summary, plain, questions, options: card.options,
            });
            host.notify(deliverableNotification(
              permission ? "approval" : "question",
              notificationBot,
              notificationThread,
              words.line,
              {
                ...(notificationBot.avatarUrl ? { avatarUrl: notificationBot.avatarUrl } : {}),
                ...(words.title ? { title: words.title } : {}),
                ...(notificationRequest ? { requestId: notificationRequest } : {}),
                // Allow on the phone opens Sagax: this class needs the person's key.
                ...(permission && ownerStepUp.length > 0 ? { needsKey: true } : {}),
                // a question's own choices: the banner's buttons on the phone and the watch
                ...(!permission && card.options?.length ? { choices: card.options } : {}),
                ...(words.choiceLabels ? { choiceLabels: words.choiceLabels } : {}),
                ...(words.choiceDetails ? { choiceDetails: words.choiceDetails } : {}),
                context: words.context,
                // the tap opens the chat on this card: the card itself, or its
                // view in the chat the banner opens (a peer or a routine's owner)
                ...(notification.messageId ? { cardId: notification.messageId } : {}),
              },
            ));
          };
          const clearReviewing = () => {
            const row = host.store.messagesFor(event.threadId).find((candidate) => candidate.id === message.id);
            if (!row?.card?.reviewing) return row?.card;
            const { reviewing: _reviewing, ...rest } = row.card;
            host.store.patchMessage(event.threadId, row.id, { card: rest });
            return host.store.messagesFor(event.threadId).find((candidate) => candidate.id === message.id)?.card;
          };
          if (!modelReview || !event.requestId || !customReview || !customDecision) {
            tellThePerson();
          } else {
            host.store.patchMessage(event.threadId, message.id, { card: { ...card, reviewing: true } });
            const finishReview = (verdict: { kind: string }) => {
              const open = clearReviewing();
              if (!open || open.answered || open.answeredBy || open.dismissed || open.expired) return;
              if (verdict.kind !== "none" && verdict.kind !== "ask") return;
              tellThePerson();
            };
            void host.customRulesModel.reviewCard({
              threadId: event.threadId, requestId: event.requestId, botId: asker.id,
              instanceId: event.providerInstanceId ?? asker.modelSelection.instanceId,
              rules: host.customRules.rulesOf(cardAnswerer, asker.id), local: customDecision, facts: customReview.facts,
              startedBy: host.turnStartFor(event.threadId),
              call: { tool: event.mcpTool ?? event.tool, ...(typeof event.input === "string" ? { input: event.input } : {}), summary: event.summary },
              language: host.languageOfPerson(cardAnswerer)
            }).then(finishReview, () => finishReview({ kind: "none" }));
          }
        }
      }
}

/** #2909: why an engine's single question cannot be answered by its own
 * options (Yes / No on "A or B?"), or undefined. A permission, a form of
 * several questions and a multi-select are never sent back. */
export function nativeChoiceMismatch(event: any, questions: any[] | undefined, permission: boolean): string | undefined {
  if (permission) return undefined;
  if (questions) {
    if (questions.length !== 1 || questions[0]?.multiSelect === true) return undefined;
    const single = questions[0];
    const options = (single.options ?? []).map((option: any) => String(option?.label ?? "")).filter(Boolean);
    return options.length >= 2 ? choiceQuestionMismatch(String(single.question ?? ""), options) : undefined;
  }
  const choices = Array.isArray(event.choices) ? event.choices.map(String).filter(Boolean) : [];
  return choices.length >= 2 ? choiceQuestionMismatch(String(event.summary ?? ""), choices) : undefined;
}
