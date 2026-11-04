import { equalRows, peerBots } from "@/state/view-slices";
import { shallowEqual, useStoreDispatch, useStoreGetter, useStoreSelector } from "@/state/store-selector";
import { visibleMessages, currentTaskBot, type Bot, type Group } from "@/state/store";
import { orgFullAccessFor } from "@/lib/full-access";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { useBoundedLock } from "@/lib/composer-lock";
import { pendingQuestions } from "@/lib/pending-question";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { useShowThreads } from "@/lib/thread-preferences";
import { sendKeyLabel, useSendKey } from "@/lib/send-key";
import { goalCoordinatorForComposer, openTaskWorking, roomRespondersForComposer, roomTakesImages } from "@/lib/group-routing";
import { pendingApprovals, type Pending } from "../PendingApproval";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { useThreadRefs } from "../ThreadRefs";
import { useParallelCards } from "../parallel-approvals";
import { useOnCall } from "@/lib/call";
import { useSendBlock } from "@/lib/send-state";

export function useComposerSession({
  profile,
  group,
  members,
}: {
  profile?: Bot;
  group?: Group;
  members?: Bot[];
}) {
  const bot = profile ? currentTaskBot(profile) : undefined;
  // 2026-10-29: the box locks only while a thread's page is on its way, and
  // for a bounded time (src/lib/composer-lock.ts): a page that never lands
  // (a server restart, a dropped fetch) must not keep the person from
  // writing. A pending approval never locks it either: the person answers
  // the card or writes past it, and their words join the running turn at
  // its next safe point or wait for it (server/busy-routing.ts).
  const locked = useBoundedLock(Boolean(bot?.awaitingThreadSnapshot));
  // Slices of the store, so a dispatch elsewhere (an unread mark, another
  // bot's frame) does not render the composer while someone types.
  const dispatch = useStoreDispatch();
  const getState = useStoreGetter();
  const storeBots = useStoreSelector(peerBots, equalRows);
  const routines = useStoreSelector((current) => current.routines.filter((routine) => routine.botId === bot?.id || members?.some((member) => member.id === routine.botId)), shallowEqual);
  const config = useStoreSelector((current) => current.config);
  const instances = useStoreSelector((current) => current.instances);
  const ownerOrAdmin = useOwnerOrAdmin();
  const { threads, currentBotId } = useThreadRefs();
  const { capabilities } = useDesktopCapabilities();
  // Enter, Shift+Enter or Ctrl/⌘+Enter, from Settings → Appearance; the hints name it.
  const sendKey = useSendKey();
  const sendLabel = sendKeyLabel(sendKey);
  const remoteClient = window.ogb?.remoteClient?.active === true;
  // Unified target: a 1:1 bot thread or a room. In a room the @ picker
  // offers members plus @everyone; explicit mentions override the room's
  // configured default responder.
  const threadId = group?.threadId ?? bot?.threadId ?? "";
  // The maintainer, 2026-10-27: a bot that certainly cannot answer this person (its
  // engine not connected for them, the computer or local server behind its
  // model down) does not take the message; one line says why and what to do,
  // and the draft stays. Asked again when the bot or its engines change.
  const sendStateKey = bot ? `${bot.modelSelection.instanceId}\u0000${bot.modelSelection.model}\u0000${bot.activity ?? ""}\u0000${instances.map((instance) => `${instance.instanceId}:${instance.snapshot?.authenticated ?? ""}`).join(",")}` : "";
  const sendState = useSendBlock(!group ? bot?.id : undefined, !group ? bot?.threadId : undefined, sendStateKey);
  const sendBlock = sendState.block;
  const currentGroupTask = group?.tasks?.find((task) => task.threadId === threadId);
  const groupBusyBotId = currentGroupTask?.busyBotId ?? (currentGroupTask?.working ? group?.busyBotId : (group?.threadId === threadId ? group?.busyBotId : null));
  const groupWorking = group ? openTaskWorking(group) : false;
  const busy = group ? Boolean(groupWorking || groupBusyBotId) : Boolean(bot?.busy);
  // an engine with a live session takes a message INTO the running turn;
  // for those the composer never locks — the server steers instead of 409.
  // A room steers through its busy speaker's engine, mirroring how the
  // server's queue-steer route resolves the running turn.
  const steerInstanceId = group
    ? members?.find((member) => member.id === groupBusyBotId)?.modelSelection.instanceId
    : bot?.modelSelection.instanceId;
  const canSteer =
    instances.find((i) => i.instanceId === steerInstanceId)?.capabilities?.queueing === true;
  // The conversation's own place, when pinned; the chip reads it next to the bot default.
  const composerTask = profile?.tasks?.find((task) => task.threadId === threadId);
  // the VISIBLE branch only — an approval left on a branch you edited away
  // from must not keep blocking the composer
  // this conversation's own, then those its parallel tasks wait on
  // #1145: with threads hidden, every parallel task of the one conversation,
  // its questions included: the person never leaves it to answer
  const showThreadsHere = useShowThreads();
  const parallelCards = useParallelCards(group ? undefined : bot, !showThreadsHere);
  const parallelApprovals = parallelCards.pendings;
  const parallelQuestions = parallelCards.questions;
  const approvals = [...pendingApprovals(group ? group.messages : bot ? visibleMessages(bot) : []), ...parallelApprovals];
  const approval = approvals[0];
  // A bot's question waits in the chat; the composer stays free. Writing
  // about something else leaves it open (the bot never picks for the
  // person, and there is no X on a waiting question, #885).
  const openQuestions = pendingQuestions(group ? group.messages : bot ? visibleMessages(bot) : []);
  const approvalBotFor = (pending: Pending) => pending.message.card?.approvalOrigin
    ? storeBots.find(candidate => candidate.id === pending.message.from?.botId)
    : group
    ? members?.find((member) => member.id === pending.message.from?.botId) ??
      members?.find((member) => member.id === groupBusyBotId)
    : bot;
  // A send while this 1:1 conversation works is "auto" (2026-10-18): the
  // bot decides whether it joins the running work, runs as a parallel task
  // or waits for it (server/busy-routing.ts). Nobody is asked. On a voice
  // call the words join the running turn.
  const onCall = useOnCall();
  const autoRoutesBusySend = Boolean(bot && !group && busy && onCall !== bot.id);
  // image paste is offered only when every bot that will actually answer
  // can open one. sendGroup routes to mentions, else the room default —
  // `members.some` would let a mixed room send <attached-image> to Grok.
  const botSupportsImages = (candidate?: Bot) =>
    Boolean(
      candidate &&
        instances.find((i) => i.instanceId === candidate.modelSelection.instanceId)?.capabilities?.images,
    );
  const imageTargetsSupport = (message: string, mode: "chat" | "goal") => {
    if (!group) return botSupportsImages(bot);
    if (mode === "goal") {
      return botSupportsImages(goalCoordinatorForComposer(message, members ?? [], group) ?? undefined);
    }
    const responders = roomRespondersForComposer(message, members ?? [], group);
    return roomTakesImages(group, responders, botSupportsImages);
  };
  // Approval mode belongs to one bot; a room has several, each with its own.
  const modeBot = group ? undefined : bot;
  const trustedThreadAccess = Boolean(!remoteClient && window.ogb?.approvals && capabilities.host.packaged);
  // Organization server: the bot's owner grants Full over HTTP while the
  // organization allows it (src/lib/full-access.ts, server/org/org-full-access.ts).
  const perspicaxOrg = usePerspicaxOrg();
  const viewerId = config?.viewer?.principalId ?? null;
  const orgFullAccess = orgFullAccessFor(perspicaxOrg, modeBot, viewerId);
  const fullAccessAvailable = trustedThreadAccess || orgFullAccess === "allowed";

  return {
    bot,
    locked,
    dispatch,
    getState,
    storeBots,
    routines,
    config,
    instances,
    ownerOrAdmin,
    threads,
    currentBotId,
    capabilities,
    sendKey,
    sendLabel,
    remoteClient,
    threadId,
    sendState,
    sendBlock,
    busy,
    canSteer,
    composerTask,
    showThreadsHere,
    parallelCards,
    parallelApprovals,
    parallelQuestions,
    approvals,
    approval,
    openQuestions,
    approvalBotFor,
    onCall,
    autoRoutesBusySend,
    botSupportsImages,
    imageTargetsSupport,
    modeBot,
    trustedThreadAccess,
    perspicaxOrg,
    viewerId,
    orgFullAccess,
    fullAccessAvailable,
  };
}
