// Fold one SSE server frame into store actions (#1383 live stream).
import { flushSync } from "react-dom";
import type { Action, AppState, Bot, BotAnnouncement, ConfigStatusFrame, Group, Message } from "./model";
import {
  configStatusFromFrame,
  liveCallFromFrame,
  openBotThread,
  openNotificationTarget,
  peopleDmReadTarget,
  personThreadKept,
  threadsReadOnScreen,
  visibleNotificationThread,
} from "./model";
import { api, runtimeFrameAction } from "./api";
import type { ServerFrame } from "../../../shared/wire";
import { uiCommandToAction } from "../../../shared/bot-act";
import { onNudgeReceived, onNudgeSentEcho } from "@/lib/desktop-nudge";
import { applyPresenceFrame } from "@/lib/presence";
import { receiveOrgApprovalsFrame } from "@/lib/org-approvals";
import { VOICE_CALL_ENDED_EVENT } from "@/lib/voice-mode/call-end";
import { receiveAchievementsFrame } from "@/lib/achievements";
import { announceServerPreferences, applyBotPreference } from "@/lib/user-preferences-sync";
import { receiveDeviceSettingsFrame } from "@/lib/device-settings-app";
import { applyPersonLabel } from "@/lib/person-labels";
import { announcePersonAvatar, withViewerAvatar } from "@/lib/person-avatars";
import { receiveThreadReadFrame } from "@/lib/read-receipts-feed";
import { ARTIFACTS_EVENT } from "@/lib/artifact-events";
import { BOT_TASKS_EVENT } from "@/lib/bot-task-events";
import { blockedDmSender, notifyReportsChanged } from "@/lib/moderation";
import { approvalWithdrawKey, showNotification, withdrawNotification } from "@/lib/notify";
import { speaker } from "@/lib/tts";
import { botShowsUnread } from "@/lib/bot-unread";
import { currentCall } from "@/lib/call";
import { singleStreamTurnField } from "@/lib/thread-preferences";
import { isViewersPrimaryBot } from "@/lib/primary-bot";
import { viewerActorId } from "@/lib/viewer";

export type FoldLiveFrameCtx = {
  rawDispatch: (action: Action) => void;
  dispatch: (action: Action) => void;
  stateRef: { current: AppState };
  clearStream: (threadId: string) => void;
  flushDeltas: () => void;
  deltaBuffer: { push: (threadId: string, kind: string, delta: string) => void };
  withTaskWrites: (bot: BotAnnouncement) => BotAnnouncement;
  botPatchQueue: { overlayFor: (botId: string) => Partial<BotAnnouncement>; cancel: (botId: string) => void };
  showThreadsRef: { current: boolean };
  refreshInstancesPeripheral: () => void;
};

export function foldLiveFrame(frame: ServerFrame, ctx: FoldLiveFrameCtx): void {
  const {
    rawDispatch,
    dispatch,
    stateRef,
    clearStream,
    flushDeltas,
    deltaBuffer,
    withTaskWrites,
    botPatchQueue,
    showThreadsRef,
    refreshInstancesPeripheral,
  } = ctx;
      switch (frame.kind) {
        case "sections":
          rawDispatch({ type: "sections", sections: frame.sections });
          break;
        case "bot.queued":
          rawDispatch({ type: "botQueues", queues: frame.queues });
          break;
        case "message": {
          rawDispatch({ type: "messageAdded", threadId: frame.threadId, message: frame.message as Message });
          if (frame.message?.role === "user" && typeof frame.message.queueId === "string") {
            rawDispatch({
              type: "consumePendingQueued",
              threadId: frame.threadId,
              queueId: frame.message.queueId,
            });
          }
          // a settled assistant bubble replaces the in-flight stream
          if (frame.message?.role === "bot" && frame.message?.kind === "text") {
            clearStream(frame.threadId);
            // Auto-speak lives HERE rather than in the chat view so a bot
            // you switched away from still reads its answer out — which is
            // the whole point of listening while you do something else. A
            // Auto-speak is disabled during any call. Call mode owns both the
            // singleton speaker and microphone ordering for its whole lifetime.
            const owner = stateRef.current.bots.find((b) => b.threadId === frame.threadId || b.tasks?.some((task) => task.threadId === frame.threadId));
            const live = stateRef.current.liveCall;
            const onLiveCall = Boolean(live && live.status !== "ended" && live.botId === owner?.id);
            if (owner?.speakReplies && currentCall() === null && !onLiveCall && frame.message.text?.trim()) {
              void speaker.speak(frame.message.text, {
                botId: owner.id,
                messageId: frame.message.id,
                voiceId: owner.voice,
              });
            }
          }
          break;
        }
        case "message.patch":
          rawDispatch({ type: "messagePatched", threadId: frame.threadId, message: frame.message as Message });
          break;
        case "thread":
          rawDispatch({ type: "threadActive", threadId: frame.threadId, activeLeafId: frame.activeLeafId });
          // a rewind also invalidates any half-streamed text from the old branch
          clearStream(frame.threadId);
          break;
        case "bot": {
          const bot = frame.bot as BotAnnouncement;
          // reading the selected chat clears its badge immediately: the
          // thread on screen, the one a switch is opening while it is under
          // way (this frame may be its own announcement), never one it leaves
          const selected = stateRef.current.bots.find((candidate) => candidate.id === bot.id);
          const shown = selected?.switchingTo ?? selected?.threadId;
          const selectedTask = bot.tasks?.find((task) => task.threadId === shown);
          // Under a fresh topic the thread is not on screen: its answer stays
          // unread, so the topic gives way and shows it (ChatView).
          const covered = stateRef.current.freshTopic[bot.id]?.threadId === shown;
          const readWith = shown && !covered ? threadsReadOnScreen(bot as Pick<Bot, "tasks">, shown).slice(1) : [];
          if (!covered && bot.id === stateRef.current.selectedId && stateRef.current.activeView === "chat" &&
              (selectedTask?.unread || (!bot.tasks && bot.unread) || readWith.length > 0)) {
            const wasUnread = Boolean(selectedTask?.unread || (!bot.tasks && bot.unread));
            if (selectedTask) selectedTask.unread = false;
            // Threads hidden: a reply landing in another thread of the one
            // conversation on screen is read with it (threadsReadOnScreen).
            for (const task of bot.tasks ?? []) if (readWith.includes(task.threadId)) task.unread = false;
            // Hidden routine runs must not put the dot back on the next frame.
            // No task list: the bot flag is the unread signal.
            bot.unread = botShowsUnread(bot);
            for (const threadId of [...(wasUnread ? [shown] : []), ...readWith]) {
              fetch(`/api/bots/${bot.id}/read`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId }) }).catch(() => {});
            }
          }
          rawDispatch({
            type: "botPatched",
            bot: withTaskWrites({ ...bot, ...botPatchQueue.overlayFor(bot.id) }),
          });
          break;
        }
        case "group": {
          const group = frame.group as Partial<Group> & { id: string };
          const held = stateRef.current.groups.find((candidate) => candidate.id === group.id);
          if (group.peopleDm || held?.peopleDm) {
            // A person conversation: the frame names its default thread;
            // this client keeps the one it has open (groupPatched), and
            // reads that thread only, so a sibling's dot stays.
            const open = held && personThreadKept(held, group) ? held.threadId : group.threadId;
            if (group.id === stateRef.current.selectedId && open) {
              const read = peopleDmReadTarget({ ...group, threadId: open, tasks: group.tasks ?? held?.tasks });
              if (read) api(`/api/groups/${group.id}/read`, { method: "POST", body: JSON.stringify(read) }).catch(() => {});
            }
            rawDispatch({ type: "groupPatched", group });
            // the thread on screen was deleted (by the other person): open
            // the default one with its messages
            if (held && group.tasks && !group.tasks.some((task) => task.threadId === held.threadId) && typeof group.threadId === "string") {
              dispatch({ type: "switchGroupTask", groupId: group.id, threadId: group.threadId });
            }
            break;
          }
          // reading the selected room clears its badge immediately
          if (group.unread && group.id === stateRef.current.selectedId) {
            group.unread = false;
            fetch(`/api/groups/${group.id}/read`, { method: "POST" }).catch(() => {});
          }
          rawDispatch({ type: "groupPatched", group });
          break;
        }
        // the harness decided this was worth interrupting for; the toggle
        // in each bot's settings is what gates it, server-side
        case "notify":
          // the wrapped dispatch, not rawDispatch: `select` clears the badge
          // in local state either way, but only the wrapper PATCHes
          // unread:false back. Opening a bot from its own notification and
          // watching the badge return on the next hydration is exactly the
          // bug that makes notifications feel broken. Opened as the sidebar
          // shows threads when it is clicked.
          // A direct message from someone this person blocked stays quiet
          // (src/lib/moderation.ts): their line is folded away anyway.
          if (frame.notification.kind === "message" && blockedDmSender(frame.notification.threadId, stateRef.current)) break;
          if (frame.notification.kind === "report") notifyReportsChanged();
          showNotification(
            frame.notification,
            (target) => frame.notification.kind === "report"
              // a report opens the admins' list (Settings > Notifications)
              ? dispatch({ type: "toggleAppSettings", open: true, section: "notifications" })
              : openNotificationTarget(dispatch, target, stateRef.current, showThreadsRef.current),
            stateRef.current.bots.find((bot) => bot.id === frame.notification.botId)?.avatarUrl,
            visibleNotificationThread(stateRef.current),
          );
          break;
        case "notify-withdraw":
          withdrawNotification(approvalWithdrawKey(frame.threadId, frame.requestId));
          break;
        case "group.deleted":
          rawDispatch({ type: "groupDeleted", groupId: frame.groupId });
          break;
        case "group.left":
          rawDispatch({ type: "groupDeleted", groupId: frame.roomId });
          break;
        case "routine":
          rawDispatch({ type: "routinePatched", routine: frame.routine });
          break;
        case "routine.deleted":
          rawDispatch({ type: "routineDeleted", routineId: frame.routineId });
          break;
        case "routine.folders":
          rawDispatch({ type: "routineFoldersPatched", botId: frame.botId, folders: frame.folders });
          break;
        // a person's own unlocks (server/achievements.ts sends them to their streams only)
        case "achievements":
          receiveAchievementsFrame(frame);
          break;
        // a person's preferences saved on another device (or this one): the
        // sync module applies them to this page (src/lib/user-preferences-sync.ts)
        case "preferences":
          announceServerPreferences(frame);
          break;
        case "routine.run":
          rawDispatch({ type: "routineRunPatched", run: frame.run });
          break;
        case "webhook":
          rawDispatch({ type: "webhookPatched", webhook: frame.webhook });
          break;
        case "webhook.attempt":
          rawDispatch({ type: "webhookAttempted", attempt: frame.attempt });
          break;
        case "webhook.deleted":
          rawDispatch({ type: "webhookDeleted", webhookId: frame.webhookId });
          break;
        case "runtime": {
          const event = frame.event;
          const action = runtimeFrameAction(event);
          if (action) rawDispatch(action);
          if (event.type === "content.delta") {
            deltaBuffer.push(event.threadId, event.streamKind, event.delta);
          } else if (event.type === "turn.started") {
            // A new turn always starts empty. After a gap that missed
            // turn.completed, stale live text would otherwise prepend onto
            // this answer (#1749).
            clearStream(event.threadId);
          } else if (event.type === "turn.completed") {
            // flush any buffered tail before clearing so no tokens are lost
            flushDeltas();
            clearStream(event.threadId);
          }
          break;
        }
        case "screen":
          // The picture went to the Computer panel (publishLiveFrame). For
          // the store, a first frame only means the computer is set up.
          if (stateRef.current.computerStarts[frame.botId]) {
            rawDispatch({ type: "computerStart", botId: frame.botId, start: null });
          }
          break;
        case "computer":
          rawDispatch({ type: "computerStart", botId: frame.botId,
            start: { state: frame.state, ...(frame.place ? { place: frame.place } : {}) } });
          break;
        case "computer-control":
          rawDispatch({
            type: "computerControl",
            botId: frame.botId,
            held: frame.held === true,
            helpReason: typeof frame.helpReason === "string" ? frame.helpReason : null,
          });
          break;
        case "data":
          rawDispatch({ type: "dataSheet", sheet: frame.sheet, ...(typeof frame.threadId === "string" && frame.threadId ? { threadId: frame.threadId } : {}) });
          break;
        case "bot.deleted":
          botPatchQueue.cancel(frame.botId);
          rawDispatch({ type: "deleteBot", botId: frame.botId });
          break;
        case "cloud.agent":
          window.dispatchEvent(new CustomEvent("sagax-cloud-agent", { detail: { botId: frame.botId, item: frame.item } }));
          break;
        case "artifacts":
          // Ids only (server/artifacts.ts): the Files tab and the palette fetch again.
          window.dispatchEvent(new CustomEvent(ARTIFACTS_EVENT, { detail: { botId: frame.botId, artifactId: frame.artifactId, deleted: frame.deleted === true } }));
          break;
        case "bot.tasks":
          // Ids only (server/bot-task-list.ts): the bot's Tasks section reads its list again.
          window.dispatchEvent(new CustomEvent(BOT_TASKS_EVENT, { detail: { botId: frame.botId } }));
          break;
        case "live.call": {
          const framed = liveCallFromFrame(frame);
          // Rendered at once: a bot message frame right behind this one
          // decides auto-speak from stateRef, which must know the call by then.
          if (framed) flushSync(() => rawDispatch({ type: "liveCall", call: framed.call }));
          break;
        }
        // #1545: a bot reads or changes a setting kept on this device
        case "device-settings":
          receiveDeviceSettingsFrame(() => {
            const now = stateRef.current;
            const viewer = viewerActorId(now.config);
            return { bots: now.bots, primary: now.bots.find((bot) => isViewersPrimaryBot(bot, viewer)) ?? null };
          });
          break;
        case "bot-act": {
          const command = uiCommandToAction(frame.action, frame.input);
          // a preference on this device (sagax_settings): written where its
          // module reads it, then announced like another tab's change
          if (command && command.action.type === "setPreference") {
            applyBotPreference(String(command.action.key), String(command.action.value));
            break;
          }
          // a bot's "open that thread" passes the one-conversation gate like
          // every other way in (openBotThread)
          const commanded = command?.action as Action | undefined;
          if (commanded && commanded.type === "switchTask") {
            const target = stateRef.current.bots.find((candidate) => candidate.id === commanded.botId);
            if (target) openBotThread(dispatch, target, commanded.threadId, !singleStreamTurnField().singleStream);
            break;
          }
          if (command) dispatch(command.action as Action);
          break;
        }
        // addressed to this person only (server/nudge.ts): front, shake, ring, notify
        case "nudge":
          void onNudgeReceived(frame, (target) => openNotificationTarget(dispatch, target, stateRef.current, showThreadsRef.current));
          break;
        case "voice.opener":
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("sagax-voice-opener", { detail: frame }));
          }
          break;
        case "voice.call.ended":
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent(VOICE_CALL_ENDED_EVENT, { detail: frame }));
          }
          break;
        // a nudge this person sent, on each of their windows: front, shake, ring
        case "nudge.sent":
          void onNudgeSentEcho(frame);
          break;
        case "presence.changed":
          applyPresenceFrame(frame);
          break;
        // organization admins only: the approvals waiting for an admin
        case "org.approvals":
          receiveOrgApprovalsFrame(frame, () => dispatch({ type: "toggleAppSettings", open: true, section: "organization" }));
          break;
        case "person.label":
          applyPersonLabel(frame.principalId, frame.label);
          break;
        // a person changed their own photo (src/lib/person-avatars.ts)
        case "person.avatar": {
          const change = { principalId: frame.principalId, avatarUrl: frame.avatarUrl };
          const config = stateRef.current.config;
          const next = config ? withViewerAvatar(config, change) : config;
          if (next && next !== config) rawDispatch({ type: "configStatus", config: next });
          announcePersonAvatar(change);
          break;
        }
        // a read position moved (src/lib/read-receipts-feed.ts)
        case "thread.read":
          receiveThreadReadFrame(frame);
          break;
        // a key changed and the fleet hot-reloaded — refresh the picker so
        // newly available providers un-dim immediately
        case "config":
          rawDispatch({
            type: "configStatus",
            config: configStatusFromFrame(frame as unknown as ConfigStatusFrame),
          });
          refreshInstancesPeripheral();
          break;
      }
}

