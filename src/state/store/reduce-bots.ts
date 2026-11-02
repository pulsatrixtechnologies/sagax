// Domain slice of the client store reduce(bots).
// Returns the next state when it handles the action, otherwise undefined.
import type {Action, AppState} from "./model";
import {clearThreadReturnIfHome, currentTaskBot, mergeTaskStamps, openedUnreadDivider, panelFollowsSelection, patchCard, patchGroupCard, readOnScreen, reconcileModelVariantSessions, reconcileSnapshotQueues, taskPatchFields, updateBot, visibleMessages, withMascotMotion, type Bot} from "./model";
import {fallbackSelection} from "@/lib/selection-fallback";
import {threadOpensUnread, threadReadCursor} from "@/lib/unread-divider";
import {sameModelSelection} from "../../../shared/thread-model";
import {withPrimaryBot} from "@/lib/primary-bot";

export type ReduceFn = (state: AppState, action: Action) => AppState;

export function reduceBots(state: AppState, action: Action, reduce: ReduceFn): AppState | undefined {
  switch (action.type) {
    case "select": {
      const leaving = Boolean(state.threadReturn) && action.id !== state.selectedId && action.id !== state.threadReturn?.ownerId;
      const base = leaving ? { ...state, threadReturn: null } : state;
      const room = base.groups.find((g) => g.id === action.id);
      if (room) {
        return clearThreadReturnIfHome({
          ...base,
          ...panelFollowsSelection(base, action.id),
          unreadDivider: openedUnreadDivider(base, room.threadId, Boolean(room.unread), room.messages, room.lastReadMessageId),
          activeView: "chat",
          selectedId: action.id,
          groups: base.groups.map((g) => (g.id === action.id ? { ...g, unread: false } : g)),
        });
      }
      const opened = base.bots.find((b) => b.id === action.id);
      return clearThreadReturnIfHome(updateBot(
        withMascotMotion(
          {
            ...base,
            ...panelFollowsSelection(base, action.id),
            unreadDivider: opened
              ? openedUnreadDivider(base, opened.threadId, threadOpensUnread(opened), visibleMessages(opened), threadReadCursor(opened))
              : base.unreadDivider,
            activeView: "chat",
            selectedId: action.id,
          },
          action.id,
          "switch",
        ),
        action.id,
        (b) => readOnScreen(b, b.threadId),
      ));
    }
    // optimistic card settle; the server's message.patch confirms it later
    case "answerCard": {
      if (action.groupId) return patchGroupCard(state, action.groupId, action.messageId, { answered: action.answer });
      const bot = state.bots.find((candidate) => candidate.id === action.botId);
      const card = bot?.messages.find((message) => message.id === action.messageId)?.card;
      return withMascotMotion(
        patchCard(state, action.botId, action.messageId, {
          answered: action.answer,
          // talking past the first-run quiz hides it; live asks and a
          // proactive proposal stay, with the pick marked
          ...(card?.requestId || card?.proactiveProposal ? {} : { dismissed: true }),
          ...(card?.proactiveProposal ? { answeredText: action.answer } : {}),
        }),
        action.botId,
        "working",
      );
    }
    case "dismissCard":
      if (action.groupId) return patchGroupCard(state, action.groupId, action.messageId, { dismissed: true });
      return patchCard(state, action.botId, action.messageId, { dismissed: true });
    case "decideRequest":
      return state; // the server's request.resolved patch settles the card
    case "botAdded":
      return withMascotMotion({
        ...state,
        // An HTTP create/import response and its SSE broadcast can race. Fold
        // both paths without ever showing the same bot twice.
        bots: [action.bot, ...state.bots.filter((bot) => bot.id !== action.bot.id)],
        ...(action.preserveSelection ? {} : { activeView: "chat" as const, selectedId: action.bot.id }),
      }, action.bot.id, "arrive");
    case "deleteBot": {
      const bots = state.bots.filter((b) => b.id !== action.botId);
      const selectedId =
        state.selectedId === action.botId ? fallbackSelection(bots, state.groups, state.sidebarHiddenKeys) : state.selectedId;
      const { [action.botId]: _deleted, ...deletingBots } = state.deletingBots;
      return reconcileModelVariantSessions({ ...state, bots, selectedId, deletingBots });
    }
    case "botDeletionPending": {
      if (action.on) {
        if (state.deletingBots[action.botId]) return state;
        return { ...state, deletingBots: { ...state.deletingBots, [action.botId]: true } };
      }
      if (!state.deletingBots[action.botId]) return state;
      const { [action.botId]: _settled, ...deletingBots } = state.deletingBots;
      return { ...state, deletingBots };
    }
    case "playMascotMotion":
      return withMascotMotion(state, action.botId, action.kind);
    case "markUnread":
      return updateBot(withMascotMotion(state, action.botId, "surprise"), action.botId, (b) => ({ ...b, unread: true }));
    case "botPatched": {
      const before = state.bots.find((b) => b.id === action.bot.id);
      // Bot frames are complete except for their transcript. An unknown one
      // was created by another client (the phone, another app window, or a
      // team import), so add it now; the following message frames will fill
      // its greeting without waiting for a full-page hydration.
      if (!before) {
        const added = {
          ...state,
          bots: [{ ...action.bot, messages: action.bot.messages ?? [] }, ...state.bots],
        };
        return reconcileSnapshotQueues(added, [action.bot]);
      }
      const kind =
        action.bot.unread && !before?.unread
          ? "surprise"
          : action.bot.busy === true && !before?.busy
            ? "working"
            : action.bot.busy === false && before?.busy
              ? "celebrate"
              : null;
      const motioned = kind ? withMascotMotion(state, action.bot.id, kind) : state;
      // A start that failed never sends a first frame: its line ends with the turn.
      const animated = action.bot.busy === false && before?.busy && motioned.computerStarts[action.bot.id]
        ? reduce(motioned, { type: "computerStart", botId: action.bot.id, start: null }) : motioned;
      // One Primary Bot per person, not per section.
      const next = action.bot.chiefOfStaff
        ? { ...animated, bots: withPrimaryBot(animated.bots, { ...before, ...action.bot } as Bot) }
        : animated;
      const switchedThread =
        typeof action.bot.threadId === "string" && action.bot.threadId !== before.threadId &&
        !action.bot.tasks?.some((task) => task.threadId === before.threadId);
      // As with explicit navigation, the snapshot already includes events
      // buffered while its thread was in the background. Replay only races
      // after this switch begins, not older approval patches.
      let switching = next;
      if (switchedThread) {
        const { [action.bot.threadId]: _stale, ...otherThreadEvents } = next.backgroundThreadEvents;
        switching = { ...next, backgroundThreadEvents: otherThreadEvents };
      }
      if ((switchedThread || (before.awaitingThreadSnapshot && action.bot.threadId === before.threadId)) &&
          Array.isArray(action.bot.messages)) {
        // The slim deletion broadcast can arrive before the full snapshot.
        // Finish that switch once, replaying any events received in between.
        // Later duplicate HTTP snapshots must not overwrite newer messages.
        return reduce(switching, { type: "taskSwitched", bot: { ...before, ...action.bot, computer: action.bot.computer, section: action.bot.section, toolScope: action.bot.toolScope, waitingApprovals: action.bot.waitingApprovals, botConversations: action.bot.botConversations, messages: action.bot.messages, browserProfile: action.bot.browserProfile } });
      }
      const patched = updateBot(switching, action.bot.id, (b) => ({
        ...b,
        ...action.bot,
        threadId: switchedThread ? action.bot.threadId : b.threadId,
        activeLeafId: switchedThread ? null : b.activeLeafId,
        awaitingThreadSnapshot: switchedThread || b.awaitingThreadSnapshot,
        // Complete bot frames omit this optional field after switching back
        // to Own browser (or deleting a shared profile). Do not retain the
        // previous profile's name and selection in another window.
        browserProfile: action.bot.browserProfile,
        // Resetting Works on to Auto removes the field from the complete
        // server frame; merging alone would keep the old target highlighted.
        computer: action.bot.computer,
        toolScope: action.bot.toolScope,
        // A complete frame omits section after another client moves the bot
        // into General. Retaining the old label strands an empty team in UI.
        section: action.bot.section,
        // A complete frame omits it once no bot-to-bot card waits.
        waitingApprovals: action.bot.waitingApprovals,
        botConversations: action.bot.botConversations,
        tasks: action.bot.tasks ? mergeTaskStamps(b.tasks, action.bot.tasks) : b.tasks,
        // Clear immediately on deletion: old approvals must never be sent
        // to the replacement thread while waiting for its transcript.
        messages: switchedThread ? [] : b.messages,
        // This branch keeps the transcript it holds, so it keeps that
        // transcript's scrollback answer too. A frame's hasMore describes
        // the page it carries (often another thread's); taskSwitched takes
        // it together with that page.
        hasMore: switchedThread ? undefined : b.hasMore,
      }));
      return reconcileModelVariantSessions(patched);
    }
    case "computerStart": {
      const { [action.botId]: _ended, ...others } = state.computerStarts;
      return {
        ...(action.start ? withMascotMotion(state, action.botId, "launch") : state),
        computerStarts: action.start ? { ...others, [action.botId]: action.start } : others,
      };
    }
    case "computerControl":
      return {
        ...state,
        computerControl: {
          ...state.computerControl,
          [action.botId]: { held: action.held, helpReason: action.helpReason },
        },
      };
    case "modelVariantRuntime": {
      const event = action.event;
      if (!event.turnId) return state;
      if (event.type === "session.model-fallback") {
        if (!event.providerInstanceId) return state;
        // A group: another person's turn ran on their own fallback, not this viewer's.
        const me = state.config?.viewer?.principalId?.trim().toLowerCase();
        if (event.principalId && me && event.principalId.trim().toLowerCase() !== me) return state;
        return { ...state, modelFallbacks: { ...state.modelFallbacks, [event.threadId]: {
          instanceId: event.providerInstanceId, requested: event.requested, actual: event.actual,
          ...(event.actualInstanceId ? { actualInstanceId: event.actualInstanceId } : {}),
        } } };
      }
      if (event.type === "turn.started" && state.modelFallbacks?.[event.threadId]) {
        const { [event.threadId]: _gone, ...rest } = state.modelFallbacks;
        state = { ...state, modelFallbacks: rest };
      }
      const owner = state.bots.find((bot) => bot.threadId === event.threadId || bot.tasks?.some((task) => task.threadId === event.threadId));
      if (!owner) return state;
      const selection = currentTaskBot(owner, event.threadId).modelSelection;
      if (selection.instanceId !== event.providerInstanceId ||
          !state.instances.find((instance) => instance.instanceId === selection.instanceId)?.capabilities?.modelVariants) return state;
      const previous = state.modelVariantSessions[event.threadId];
      if (event.type === "turn.started") {
        if (previous && (previous.turnId === event.turnId || Date.parse(previous.startedAt) > Date.parse(event.createdAt))) return state;
        return { ...state, modelVariantSessions: { ...state.modelVariantSessions, [event.threadId]: {
          instanceId: selection.instanceId, model: selection.model, turnId: event.turnId, startedAt: event.createdAt, acceptingUpdates: true,
        } } };
      }
      if (!previous?.acceptingUpdates || previous.turnId !== event.turnId || previous.instanceId !== selection.instanceId || previous.model !== selection.model) return state;
      if (event.type === "session.model-variants" && event.model === selection.model) {
        return { ...state, modelVariantSessions: { ...state.modelVariantSessions, [event.threadId]: { ...previous, variants: event.variants } } };
      }
      if (event.type === "turn.completed") {
        return { ...state, modelVariantSessions: { ...state.modelVariantSessions, [event.threadId]: { ...previous, acceptingUpdates: false } } };
      }
      return state;
    }
    case "setModel":
      if (action.threadId && action.updateBotDefault) {
        return reconcileModelVariantSessions(updateBot(state, action.botId, (bot) => ({ ...bot, modelSelection: action.selection,
          tasks: bot.tasks?.map((task) => ({ ...task, modelSelection: action.selection, followsBotModel: true })) })));
      }
      if (action.threadId) {
        const picked = reduce(state, { type: "updateTask", botId: action.botId, threadId: action.threadId,
          patch: { modelSelection: action.selection } });
        // Picking the bot's model, or making the pick the bot's, is following it.
        return updateBot(picked, action.botId, (bot) => ({ ...bot, tasks: bot.tasks?.map((task) => task.threadId !== action.threadId ? task
          : { ...task, followsBotModel: Boolean(action.updateBotDefault) || sameModelSelection(action.selection, bot.modelSelection) }) }));
      }
      return reconcileModelVariantSessions(updateBot(state, action.botId, (b) => ({ ...b, modelSelection: action.selection,
        tasks: b.tasks?.map((task) => ({ ...task, modelSelection: action.selection, followsBotModel: true })) })));
    case "updateTask": {
      const patch = taskPatchFields(action.patch);
      return reconcileModelVariantSessions(updateBot(state, action.botId, (bot) => ({
        ...bot,
        tasks: (bot.tasks ?? [{ threadId: bot.threadId, title: "New thread", createdAt: Date.now() }]).map((task) =>
          task.threadId === action.threadId ? { ...task, ...patch } : task),
      })));
    }
    case "botCreationPending":
      return { ...state, botCreationPending: action.on };
    case "updateBot": {
      const mascotChanged =
        Object.prototype.hasOwnProperty.call(action.patch, "color") ||
        Object.prototype.hasOwnProperty.call(action.patch, "mascotExpression");
      // a new skin is shown off with the wings open
      const skinChanged = Object.prototype.hasOwnProperty.call(action.patch, "mascotSkin");
      const animated = skinChanged
        ? withMascotMotion(state, action.botId, "spread-wings")
        : mascotChanged
          ? withMascotMotion(state, action.botId, "customize")
          : state;
      const target = animated.bots.find((bot) => bot.id === action.botId);
      // One Primary Bot per person, not per section.
      const next = action.patch.chiefOfStaff && target
        ? { ...animated, bots: withPrimaryBot(animated.bots, target) }
        : animated;
      const {
        acknowledgeLocalAuto: _localAck,
        confirmFullAccess: _fullConfirmation,
        applyToAllThreads: _allThreads,
        organizationFullAccess: _orgFull,
        threadId: _threadId,
        host,
        computer,
        ...rest
      } = action.patch;
      const botPatch: Partial<Bot> = { ...rest };
      const followMode = action.patch.approvalMode;
      if (computer === null) botPatch.computer = undefined;
      else if (computer !== undefined) botPatch.computer = computer;
      if (host === "fleet") botPatch.host = { kind: "fleet" };
      else if (host && typeof host === "object" && host.kind === "machine") {
        const userId = target?.host?.kind === "machine" ? target.host.userId : (target?.ownerUserId ?? "");
        botPatch.host = { kind: "machine", deviceId: host.deviceId, userId };
        if (host.model) botPatch.modelSelection = { ...(target?.modelSelection ?? { instanceId: host.model.instanceId, model: host.model.model }), instanceId: host.model.instanceId, model: host.model.model };
      }
      return updateBot(next, action.botId, (b) => {
        const updated: Bot = { ...b, ...botPatch };
        if (botPatch.modelSelection) updated.tasks = updated.tasks?.map((task) => ({
          ...task, modelSelection: botPatch.modelSelection!, followsBotModel: true,
        }));
        // #1169: a new bot level reaches every thread; none keeps its own
        if (followMode && updated.tasks) {
          updated.tasks = updated.tasks.map(({ approvalMode: _mode, autoApprove: _auto, approvalOwn: _own, ...task }) => task);
        }
        return updated;
      });
    }
    case "newBot":
      return state;
    case "duplicateBot":
      return state;
    case "createProject":
      return state;
    case "updateProject":
      return state;
    case "deleteProject":
      return state;
    case "reorderProjects":
      return state;
    case "interrupt":
      return state;
    case "refreshTaskPermissions":
      return state;
    case "followBotModel":
      return state;
  }
  return undefined;
}
