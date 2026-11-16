// @ts-nocheck
/** deliverLateQuestionAnswer (#1388). Pure move from server/index.ts. */
import { DATA_DIR } from "../config.ts";
import { sendFingerprint, acceptedSendMatch } from "../messages/send-idempotency.ts";
import { speakerFor } from "../request-speaker.ts";
import { queuedChannelMessage, queueChannelMessage } from "../rooms/channel-queue.ts";
import { queuedSteeredMessage } from "../turns/steer-queue.ts";
import { assertWithinBudget } from "../usage/spend.ts";
import { createHash } from "node:crypto";
import { questionAnswersByQuestion, visibleQuestionAnswer } from "../../shared/ask-question.ts";
import { serverCardKind } from "../../shared/fix-card-keys.ts";
import { answerWithNote } from "../../shared/options-card.ts";
import { answeredByWith } from "../rooms/room-ask-cards.ts";
import { cardAnsweredBy } from "./answeringCardAs.ts";
export type Host = Record<string, any>;

export function createDeliverLateQuestionAnswer(getHost: () => Host): any {
async function deliverLateQuestionAnswer(
  auth: RequestAuth,
  threadId: string,
  requestId: string,
  answer: string,
  cardMessage: Message,
  owner: BotRecord,
  via?: "call",
  /** The Live call a spoken answer was given on (Message.callId); only with via. */
  callId?: string,
  /** #4438: the device opens the place a server card's answer names (the
   * routine's page); a released app or a call does not. */
  opens?: boolean,
): Promise<{ queued: boolean }> {
  const host = getHost();
  // the isolated / as-is question of a bot computer (#2727): remember the
  // answer for that host and bot; the bot still reads it as the next message
  try { host.hostComputers?.answer(requestId, answer); } catch (error) { console.warn(`host computer answer: ${String(error)}`); }
  const group = host.store.groupByThread(threadId);
  const roomTarget = group
    ? group.dm
      ? group.threadId === threadId
      : Boolean(host.store.groupTaskByThread(group.id, threadId))
    : false;
  if (group && (!roomTarget || !group.memberIds.includes(owner.id))) {
    throw Object.assign(new Error("the bot that asked this question is no longer in this conversation"), { status: 409 });
  }
  if (!group && !host.store.taskByThread(owner.id, threadId)) {
    throw Object.assign(new Error("the question's conversation no longer exists"), { status: 409 });
  }

  // #3007: the person's own words in the chat, never the model-facing
  // English lead-in; the model gets the question from promptWithReply
  const shown = visibleQuestionAnswer(answer, cardMessage.card?.questionRequest?.questions);

  // #4438: a card the server raised itself (a routine's fix card) whose
  // choice the server can do at once: done here, with no model turn and no
  // line in the chat; the answered card says what happened. The answer is
  // read as the card's one question's pick.
  const askKey = cardMessage.card?.askKey;
  // only the server's own cards: a bot's keyed card keeps the idempotent
  // send path below (the same answer sent again is accepted as a match)
  if (askKey && serverCardKind(askKey) && typeof host.serverCardAnswer === "function") {
    const open = host.store.messagesFor(threadId).find((message) => message.id === cardMessage.id)?.card;
    if (!open || open.answered || open.dismissed) throw Object.assign(new Error("this question has already been answered"), { status: 409 });
    if (open.expired) throw Object.assign(new Error("this question is closed"), { status: 409 });
    const questions = open.questionRequest?.questions ?? [];
    const picked = questions.length === 1 ? (questionAnswersByQuestion(answer, questions)[questions[0]!.question] ?? shown) : shown;
    const direct = await host.serverCardAnswer(auth, askKey, picked.trim(), { threadId, messageId: cardMessage.id, opens: opens === true && via !== "call" });
    if (direct) {
      const latest = host.store.messagesFor(threadId).find((message) => message.id === cardMessage.id)?.card ?? open;
      // an app released before answerNote draws only answeredText: a device
      // that did not say it reads the note gets the line there too
      const answeredText = opens === true && via !== "call" ? answer : answerWithNote(answer, direct.note);
      host.store.patchMessage(threadId, cardMessage.id, { card: { ...latest, answered: "answer", answeredText, answerNote: direct.note, dismissed: false } });
      host.cardTurnSettled?.(threadId, cardMessage.id);
      return { queued: false, direct: true, ...(direct.open ? { open: direct.open } : {}) };
    }
  }
  const text = group ? `@${owner.name}: ${shown}` : shown;
  const sendId = `late-question-${createHash("sha256").update(`${threadId}:${requestId}`).digest("hex").slice(0, 32)}`;
  const key = group
    ? `group:${group.id}:${threadId}:${sendId}`
    : `bot:${owner.id}:${threadId}:${sendId}`;
  const receipt = await host.sendSequencer.run(key, sendFingerprint(text, cardMessage.id, group ? "chat" : undefined), async () => {
    const accepted = acceptedSendMatch(host.store.messagesFor(threadId), sendId, text, cardMessage.id, group ? "chat" : undefined);
    if (accepted.kind === "conflict") throw Object.assign(new Error("this question already has a different recorded answer"), { status: 409 });
    if (accepted.kind === "match") return { queued: false };

    const queuedDirect = group ? null : queuedSteeredMessage(owner.id, threadId, sendId);
    if (queuedDirect) {
      if (queuedDirect.text !== text || queuedDirect.replyToId !== cardMessage.id) {
        throw Object.assign(new Error("this question already has a different queued answer"), { status: 409 });
      }
      return { queued: true };
    }
    const queuedRoom = group ? queuedChannelMessage(group.id, threadId, sendId) : null;
    if (queuedRoom) {
      if (queuedRoom.text !== text || queuedRoom.replyToId !== cardMessage.id || queuedRoom.mode !== "chat") {
        throw Object.assign(new Error("this question already has a different queued answer"), { status: 409 });
      }
      return { queued: true };
    }

    const latestCard = host.store.messagesFor(threadId).find((message) => message.id === cardMessage.id)?.card;
    if (!latestCard || latestCard.answered || latestCard.dismissed) {
      throw Object.assign(new Error("this question has already been answered"), { status: 409 });
    }
    // #4205: a closed card (its run cancelled or superseded, its key
    // retired) starts nothing
    if (latestCard.expired) throw Object.assign(new Error("this question is closed"), { status: 409 });
    assertWithinBudget(host.cfg, DATA_DIR);
    // #4219: the answering turn of a keyed room card names who answered,
    // in the card's one answeredBy: written here, in the sequenced delivery,
    // for the one answer accepted (a second person answering at the same
    // moment gets the 409 above and never overwrites it); answeringCardAs
    // then keeps it
    const answerer = host.roomAskAnswerer?.(auth, threadId, requestId);
    const target = answerer
      ? host.store.patchMessage(threadId, cardMessage.id, { card: { ...latestCard, answeredBy: answeredByWith(cardAnsweredBy(host, auth, via), answerer) } }) ?? cardMessage
      : cardMessage;
    // #4438: the card is answered the moment its answer is accepted, before
    // the turn it starts (which may wait for a warm process or a busy
    // conversation): every surface that lists it (the pinned card, Today,
    // another device) drops it at once. A start that fails puts it back.
    const before = host.store.messagesFor(threadId).find((message) => message.id === cardMessage.id)?.card ?? latestCard;
    host.store.patchMessage(threadId, cardMessage.id, { card: { ...before, answered: "answer", answeredText: answer, dismissed: false } });
    const reopen = () => {
      const now = host.store.messagesFor(threadId).find((message) => message.id === cardMessage.id)?.card;
      if (now && now.answered === "answer" && now.answeredText === answer) {
        const { answered: _answered, answeredText: _text, ...rest } = now;
        host.store.patchMessage(threadId, cardMessage.id, { card: { ...rest, ...(before.answered !== undefined ? { answered: before.answered } : {}), ...(before.answeredText !== undefined ? { answeredText: before.answeredText } : {}) } });
      }
    };
    try {
      const sender = host.messageSender(auth);
      const trigger = host.usageTriggerFor(auth);
      if (group) {
        const current = host.store.group(group.id);
        if (!current || !roomTarget) throw Object.assign(new Error("the room switched tasks before it could receive the answer"), { status: 409 });
        if (host.groupThreadIsWorking(current.id, threadId)) {
          const queued = queueChannelMessage(current.id, threadId, text, {
            replyToId: cardMessage.id,
            sendId,
            mode: "chat",
            sender,
            trigger
          });
          return { queued: true, queueId: queued.id };
        }
        host.startGroupTurn(current.id, text, target, sendId, "chat", undefined, { threadId, sender, trigger });
        return { queued: false };
      }
      const direct = await host.startOrQueueDirectMessage(owner.id, threadId, text, target, sendId, sender, trigger, speakerFor(auth), undefined, via, callId);
      return { queued: "queued" in direct && Boolean(direct.queued) };
    } catch (error) {
      reopen();
      throw error;
    }
  });

  const latest = host.store.messagesFor(threadId).find((message) => message.id === cardMessage.id)?.card;
  if (latest && !latest.answered && !latest.dismissed) {
    host.store.patchMessage(threadId, cardMessage.id, { card: { ...latest, answered: "answer", answeredText: answer, dismissed: false } });
  }
  // #3514: queued behind the turn that posted the card, the answer ends that
  // turn at its safe point and starts its own turn at once
  host.cardTurnSettled?.(threadId, cardMessage.id);
  return receipt;
}
  return deliverLateQuestionAnswer;
}
