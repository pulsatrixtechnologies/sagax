// @ts-nocheck
/** acceptDirectSend (#1388). Pure move from server/index.ts. */
import { queuedSteeredMessage } from "../turns/steer-queue.ts";
export type Host = Record<string, any>;

export function createAcceptDirectSend(getHost: () => Host): any {
async function acceptDirectSend(
  input: {
    botId: string;
    threadId: string;
    text: string;
    sendId?: string;
    replyTo?: Message;
    sender?: ResolvedSender;
    trigger: UsageTrigger;
    via?: "call";
    /** Who speaks (org payer and join rules); absent: from `sender`'s auth. */
    speaker?: TurnSpeaker;
    /** The Live call the words were spoken on (Message.callId); only with via. */
    callId?: string;
    /** The Data result the person was viewing (shared/data-context.ts):
     * recorded on the message, and put in front of the words the model gets. */
    dataContext?: DataContext;
    /** A person is proven present (a paired session, or the desktop's owner
     * capability): steering their words in clears the unattended mark. */
    personPresent: boolean;
  },
  guardedStart?: (currentAtStart: BotRecord) => Promise<DirectSendReceipt>,
): Promise<DirectSendReceipt> {
  const host = getHost();
  const { spokenLineFields } = host;

  const { botId, threadId, text, sendId, replyTo, sender, trigger, via, speaker, callId, dataContext, personPresent } = input;
  const refused = host.directSendRefusal(botId, threadId);
  if (refused) throw refused;
  return host.sendSequencer.run(
    sendId ? `bot:${botId}:${threadId}:${sendId}` : undefined,
    host.sendFingerprint(text, replyTo?.id),
    async (): Promise<DirectSendReceipt> => {
      if (sendId) {
        if (host.cancelledChatFollowup("bot", botId, threadId, sendId)) {
          throw Object.assign(new Error("this queued sendId was cancelled; send a new message to try again"), { status: 409 });
        }
        const accepted = host.acceptedSendMatch(host.store.messagesFor(threadId), sendId, text, replyTo?.id);
        if (accepted.kind === "conflict") {
          throw Object.assign(new Error("sendId already belongs to another message"), { status: 409 });
        }
        if (accepted.kind === "match") {
          const canonical = {
            ok: true as const,
            threadId,
            message: accepted.message
          };
          return accepted.message.steered
            ? { ...canonical, steered: true as const }
            : canonical;
        }
        const queued = queuedSteeredMessage(botId, threadId, sendId);
        if (queued) {
          if (queued.text !== text || queued.replyToId !== replyTo?.id) {
            throw Object.assign(new Error("sendId already belongs to another message"), { status: 409 });
          }
          return { ok: true as const, queued: true as const, queueId: queued.id, threadId, reason: queued.reason };
        }
      }

      // Resolve first-run setup before reading admission/guarded-send
      // preconditions. Provider discovery yields; transcript reservation
      // after those checks must remain synchronous.
      const profile = host.store.bot(botId);
      if (profile && !profile.modelSelection.instanceId && !profile.modelSelection.model) {
        if (host.enginesRead) await host.enginesRead;
        // Probes afresh for an engine installed or signed in since.
        host.registry.forgetSnapshots();
        await host.refreshUnsetModelSelections();
      }
      const currentAtStart = host.store.projectBotForTask(botId, threadId);
      if (!currentAtStart) throw Object.assign(new Error("no such bot"), { status: 404 });
      if (!host.store.taskByThread(currentAtStart.id, threadId)) {
        throw Object.assign(new Error("the target task no longer exists"), { status: 409 });
      }

      const messageActor = host.misuseActor(speaker?.origin === "person" || speaker?.origin === "owner-routine" || speaker?.origin === "peer" ? speaker.principalId : undefined, speaker?.origin);
      const misuse = host.misuseRefusal(text, { ...messageActor, surface: "message", botId, threadId });
      if (misuse) throw Object.assign(new Error(misuse.message), { status: misuse.status, code: misuse.code, ...(misuse.reason ? { reason: misuse.reason } : {}) });
      const safetyMessage = host.safetyHttpRefusal({ text, surface: "message", triage: messageActor.triage, ...(messageActor.principalId ? { principalId: messageActor.principalId } : {}), botId, threadId });
      if (safetyMessage) throw Object.assign(new Error(safetyMessage.message), { status: safetyMessage.status, code: safetyMessage.code });

      // Organization server: a turn asking Full access is refused while
      // the organization does not allow it (org-full-access.ts).
      if (host.IDENTITY.kind === "perspicax" && host.approvalModeFor(currentAtStart) === "full" && !host.orgFullAccessPolicy()) {
        throw Object.assign(new Error(host.ORG_FULL_ACCESS_DISABLED.error), { status: host.ORG_FULL_ACCESS_DISABLED.status, code: host.ORG_FULL_ACCESS_DISABLED.code });
      }

      if (guardedStart) return guardedStart(currentAtStart);

      // Claude can accept the message inside its live turn. If the write
      // loses a race with turn settlement, or the engine cannot steer, the
      // existing server-side queue records it atomically for the next turn.
      if (currentAtStart.busy) {
        const instance = host.runningTurnInstance(currentAtStart, threadId);
        let steered: SteerOutcome = "refused";
        // Attachments steer only into an engine that takes images mid-turn
        // (steerImages), as the same native blocks a new turn would carry.
        // Elsewhere an attachment message stays intact for the next ordinary
        // turn, where central image admission hands it over natively.
        // Over-limit attachments still refuse the send here (413), as before.
        // #4169: videos count as attachments too (frames are sampled later).
        const steerInput = host.extractTurnImages(text);
        const carriesImages = steerInput.images.length > 0 || steerInput.videos.length > 0;
        const steerTarget = host.handoffs.current(threadId);
        const busyAdmission = host.admit("direct-busy", {
          carriesImages,
          engineCanSteerImages: host.engineSteersImages(instance),
          pendingComputerSelection: Boolean(host.computerSelectionTurns.get(threadId)?.selected),
          engineCanSteer: Boolean(instance?.adapter.capabilities.queueing && instance.adapter.steer)
            // someone else's words never join a running turn on an
            // organization server; a turn being stopped takes no new words
            && (speaker ? host.orgJoinsRunningTurn(currentAtStart, threadId, speaker) : host.IDENTITY.kind !== "perspicax")
            && !host.stoppingThreads.has(threadId)
        });
        // steer was offered only when a live instance could take it;
        // the second check carries that fact to the type system.
        const steerId = host.randomUUID();
        if (busyAdmission.action === "steer" && instance?.adapter.steer) {
          const prompt = host.promptWithReply(host.promptWithDataContext(steerInput.text, dataContext), replyTo, host.cfg.profile?.name?.trim() || "User");
          steered = await instance.adapter
            .steer(threadId, prompt, { steerId, ...(steerInput.images.length > 0 ? { images: steerInput.images } : {}) })
            .catch((): SteerOutcome => "indeterminate");
        }
        // steer() is awaited adapter work. The turn can settle, the task can
        // switch, or the whole bot can be deleted before its acknowledgement
        // arrives. Re-read every ownership invariant before appending even a
        // successful steer; otherwise that late acknowledgement writes a user
        // message into a task the bot no longer owns. A conflict leaves the
        // text in the client's composer/outbox to resend deliberately.
        const current = host.store.projectBotForTask(botId, threadId);
        if (!current) throw Object.assign(new Error("no such bot"), { status: 404 });
        if (!host.store.taskByThread(botId, threadId)) {
          throw Object.assign(new Error("the target task no longer exists"), { status: 409 });
        }
        const delivered = steered !== "refused";
        if (delivered) {
          if (steered === "steered" && !current.busy) {
            throw Object.assign(
              new Error("the running turn ended before the steered message could be recorded"),
              { status: 409 },
            );
          }
          // "indeterminate" falls through to the same record: the words
          // may already be folded into a turn whose acknowledgement was
          // lost, and handing them back for a resend could run them
          // twice. Recording them once is the honest outcome.
          // A person steering a webhook turn is present, and auto mode may
          // follow them again; words that do not prove a person never lift it.
          if (personPresent) host.clearUnattended(threadId);
          const message = host.store.appendMessage(threadId, {
            role: "user",
            kind: "text",
            text,
            replyToId: replyTo?.id,
            sendId,
            ...(dataContext ? { dataContext } : {}),
            steered: true,
            sender,
            ...spokenLineFields(via, callId)
          });
          // Written here, as the words that start a turn are (startTurn).
          host.store.setTaskAskedAt(botId, threadId, message.at);
          if (host.store.taskByThread(botId, threadId)?.openedBy?.kind !== "agent") host.store.restoreAutoArchived(botId, threadId);
          // Durable while the engine process holds them: a crash or stop can
          // resume them once (held-steers.ts).
          try {
            host.recordHeldSteer(host.DATA_DIR, { botId, threadId, messageId: message.id, text, at: message.at });
          } catch (error) {
            console.warn(`held-steers: could not record steered message: ${error instanceof Error ? error.message : String(error)}`);
          }
          // Offered to the next turn again unless the person stops this one.
          host.handoffs.steered(threadId, steerTarget, instance?.instanceId, message.id, steerId);
          return { ok: true as const, steered: true as const, threadId, message };
        }
        if (!current.busy) {
          return host.startOrQueueDirectMessage(botId, threadId, text, replyTo, sendId, sender, trigger, speaker, undefined, via, callId, dataContext);
        }
        const queued = host.queueSteeredMessage(current.id, threadId, text, {
          replyToId: replyTo?.id,
          sendId,
          dataContext,
          prompt: host.promptWithReply(host.promptWithDataContext(text, dataContext), replyTo, host.cfg.profile?.name?.trim() || "User"),
          sender,
          trigger,
          speaker,
          via,
          callId
        });
        return { ok: true as const, queued: true as const, queueId: queued.id, threadId };
      }
      return host.startOrQueueDirectMessage(botId, threadId, text, replyTo, sendId, sender, trigger, speaker, undefined, via, callId, dataContext);
    },
  );
}
  return acceptDirectSend;
}
