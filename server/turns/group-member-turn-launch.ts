// @ts-nocheck
// #1383: runGroupMemberTurn launch composer. Never imports server/index.ts.
// Awaits stay in this function so finally still runs on the original return paths.
import type { GroupMemberTurnHost } from "./group-member-turn-types.ts";
import type { GroupMemberTurnCtx } from "./group-member-turn-ctx.ts";
import { createFinishGroupMemberTurn } from "./group-member-turn-finish.ts";
import { createPrepareRoomMemberTools, createClaimRoomMemberTurn } from "./group-member-turn-launch-tools.ts";
import { createMountRoomMemberTurn } from "./group-member-turn-launch-mount.ts";
import { createBuildRoomMemberPrompt } from "./group-member-turn-launch-prompt.ts";
import { createGuardRoomMemberDispatch, createBeginRoomMemberOutcome } from "./group-member-turn-launch-dispatch.ts";
import { createSettleRoomMemberTurn } from "./group-member-turn-launch-after.ts";

export { roomSubagentModel } from "./group-member-turn-room-model.ts";

export function createLaunchGroupMemberTurn(host: GroupMemberTurnHost) {
  const tools = createPrepareRoomMemberTools(host);
  const claimRoomMemberTurn = createClaimRoomMemberTurn(host);
  const mount = createMountRoomMemberTurn(host);
  const buildRoomMemberPrompt = createBuildRoomMemberPrompt(host);
  const guardRoomMemberDispatch = createGuardRoomMemberDispatch(host);
  const beginRoomMemberOutcome = createBeginRoomMemberOutcome(host);
  const settleRoomMemberTurn = createSettleRoomMemberTurn(host);
  const { finishCatch, finishFinally, bindRoomLease } = createFinishGroupMemberTurn(host);

  return async function launchGroupMemberTurn(ctx: GroupMemberTurnCtx): Promise<boolean> {
    ctx.retainRoomVmLease = false;
    ctx.roomSpeaker = undefined;
    ctx.providerDispatched = false;
    ctx.setupStallCause = undefined;
    ctx.unregisterSetupStall = () => {};
    ctx.roomComputerKind = null;
    ctx.roomVpsBotId = null;
    ctx.roomScreenBotId = null;
    ctx.roomHandoffSourceSucceeded = false;
    ctx.roomHandoffSourceStalled = false;
    ctx.roomClaimFailure = undefined;
    bindRoomLease(ctx);
    try {
      tools.prepareRoomImages(ctx);
      if (ctx.roomAttachmentsHold) await ctx.roomAttachmentsHold;
      // Frames after the hold so ffmpeg reads the plain clip (content-at-rest).
      if (ctx.usesNativeImageInput && !ctx.cardContinuation) {
        for (const video of ctx.burstVideos ?? []) {
          ctx.burstImages.push(...await host.videoFramesWithin(ctx.burstImages.length, [video]));
        }
        ctx.latestVideoFrames = await host.videoFramesWithin(
          ctx.burstImages.length + (ctx.resolvedLatestImages?.images?.length ?? 0),
          ctx.resolvedLatestImages?.videos ?? [],
        );
      }
      tools.placeAndSkills(ctx);
      if (ctx.instance.adapter.capabilities.customMcp === true) {
        await host.refreshMcpOAuth(ctx.bot);
        await host.prepareMcpServers(ctx.bot);
        tools.mountCustomMcp(ctx);
      }
      const perspicaxArgs = tools.perspicaxArgs(ctx);
      if (perspicaxArgs) tools.applyPerspicax(ctx, await host.perspicaxTurnIntegration(perspicaxArgs));
      const claimed = claimRoomMemberTurn(ctx);
      if (claimed !== undefined) return claimed;
      if (ctx.roomNeedsBrowser) {
        const browser = await host.browserIntegration(ctx.readyBot.id, ctx.readyBot.browserProfile, { threadId: ctx.threadId, generation: ctx.internalGeneration });
        if (browser) ctx.integrations.browser = browser.integration;
      }
      const browserGate = mount.afterBrowser(ctx);
      if (browserGate !== undefined) return browserGate;
      if (ctx.roomTeamComputer) {
        const attached = await host.attachTeamBoat(ctx.roomTeamComputer, ctx.readyBot.id, ctx.resourceOwner, host.canWorkOnCloud(host.cloudEngine(ctx.instance)));
        const teamGate = mount.afterTeamBoat(ctx, attached);
        if (teamGate !== undefined) return teamGate;
      }
      mount.beginDesktop(ctx);
      await host.mountPersonalMcp(ctx.integrations, {
        botId: ctx.readyBot.id, threadId: ctx.threadId, generation: ctx.internalGeneration,
        customMcp: ctx.instance.adapter.capabilities.customMcp === true, principal: ctx.roomPlace.principal,
      });
      await host.mountPluginMcp(ctx.integrations, {
        botId: ctx.readyBot.id, threadId: ctx.threadId, generation: ctx.internalGeneration,
        customMcp: ctx.instance.adapter.capabilities.customMcp === true, principal: ctx.roomPlace.principal,
      });
      const pluginGate = mount.afterPlugins(ctx);
      if (pluginGate !== undefined) return pluginGate;
      mount.defineScreens(ctx);
      {
        const {
          roomTeamComputer, roomPlan, resourceOwner, readyBot, instance, threadId, roomRemote, integrations,
          internalGeneration, readyGroup, isCancelled, roomSpeaker, failRoomClaim, roomSetupIsCurrent, showClaimedScreen,
        } = ctx;
        const {
          mountHostComputer, turnProvider, vpsThreadStarted, mountBotVps, boat, boatNotConfigured, mountBotBoat,
          cloudEngine, placeUnavailable, localVmTargetForThread, bindTurnComputer, localVmImageBusy, localVmModeChangeBusy,
          localVmLifecycleBusy, localVmLeaseFor, localVmOwnerBusy, localVmMode, cfg, localVmSeatPool, localVmThreadTargets,
          localVmActiveThreads, localVmIdleFor, readyLocalVmForTurn, containerComputerMcp, controlIntegration, asPlaceFailure,
          store, groupSpeakers, activeInternalGenerationByThread,
        } = host;
  try {
    if (!roomTeamComputer && roomPlan.computer === "local") {
      integrations.localComputer = await mountHostComputer(
        resourceOwner, readyBot.id, instance.adapter.capabilities.localComputerMcp === true, failRoomClaim);
      if (!roomSetupIsCurrent()) return false;
      ctx.roomComputerKind = "local";
    }
    if (!roomTeamComputer && !roomRemote.skipRemote && roomPlan.computer === "cloud") {
      if (turnProvider(readyBot) === "vps") {
        vpsThreadStarted(readyBot.id, threadId);
        ctx.roomVpsBotId = readyBot.id;
        const mounted = await mountBotVps(readyBot, resourceOwner, { start: true, onClaimed: showClaimedScreen });
        if (!roomSetupIsCurrent()) return false;
        if (!("integration" in mounted)) throw new Error(mounted.problem ?? "the VPS computer could not be created or reached");
        integrations.localComputer = mounted.integration;
        ctx.roomComputerKind = "vps";
      } else {
        if (!boat.boatConfigured(cfg)) throw boatNotConfigured(readyBot, "room");
        // As in a bot thread: created or woken by the member's first
        // computer call, never by the room message itself.
        integrations.localComputer = mountBotBoat(readyBot, resourceOwner, { source: "room", onClaimed: showClaimedScreen, onRejected: failRoomClaim });
        ctx.roomComputerKind = "box";
      }
    }

    // Room and Goal turns use the speaker's desktop, never the coordinator's.
    // Claim the same lease as direct turns before asynchronous VM setup.
    if (readyBot.computer === "vm") {
      if (instance.adapter.capabilities.computerMcp !== true) {
        throw placeUnavailable("vm", { state: "vm-cannot", params: { bot: readyBot.name, model: cloudEngine(instance, readyBot.modelSelection.model).name }, source: "room" }, false);
      }
      // A distinct identity fences cleanup even in shared mode on the same room thread.
      const target = { ...localVmTargetForThread(readyBot.id, threadId) };
      await bindTurnComputer(resourceOwner, `computer:vm:${target.key}`, true);
      if (localVmImageBusy || localVmModeChangeBusy || localVmLifecycleBusy.has(target.key)) {
        throw new Error("this Local VM is being started, stopped, or replaced");
      }
      if (!localVmLeaseFor(target).claim(threadId, readyBot.id, localVmOwnerBusy)) {
        throw new Error("this Local VM is already being used by another turn");
      }
      if (localVmMode(cfg) === "pool") localVmSeatPool.touch(threadId);
      ctx.roomVmTarget = target;
      localVmThreadTargets.set(threadId, target);
      localVmActiveThreads.set(target.key, threadId);
      localVmIdleFor(target).touch();
      const setupIsCurrent = () => !isCancelled?.() &&
        groupSpeakers.get(threadId) === roomSpeaker &&
        activeInternalGenerationByThread.get(threadId) === internalGeneration &&
        store.group(readyGroup.id)?.memberIds.includes(readyBot.id) === true &&
        store.bot(readyBot.id)?.busy === true &&
        store.group(readyGroup.id)?.busyBotId === readyBot.id;
      const vm = await readyLocalVmForTurn(readyBot.id, target, setupIsCurrent);
      if (!setupIsCurrent()) {
        return false;
      }
      if (!vm.ready || !vm.runtime) throw new Error(vm.problem ?? "the Local VM is not ready");
      const owner = localVmLeaseFor(target).current(localVmOwnerBusy);
      if (owner?.threadId !== threadId || owner.botId !== readyBot.id) {
        throw new Error("the Local VM lease expired while preparing the turn");
      }
      integrations.localComputer = containerComputerMcp(
        vm.runtime,
        controlIntegration(readyBot.id, threadId, internalGeneration, { localVmTarget: target }),
        target,
      );
    }
  } catch (error) {
    const place = roomPlan.computer;
    if (place !== "cloud" && place !== "vm" && place !== "local") throw error;
    throw await asPlaceFailure(error, place, "room", readyBot, turnProvider(readyBot) === "vps" ? "vps" : "box");
  }
      }
      await buildRoomMemberPrompt(ctx);
      // The start-up probe of this engine is part of setup: wait for it before the claim below.
      const ownEngineRead = typeof host.engineRead === "function" ? host.engineRead(ctx.instance.instanceId) : host.enginesRead;
      if (ownEngineRead) await ownEngineRead;
      if (!ctx.cardContinuation && ctx.bot.memoryEnabled !== false && host.autoRecallEnabled(host.cfg) && host.semanticEmbeddingEndpoint(host.cfg)) {
        await host.prepareSemanticRecall(ctx.bot.id, host.recallQuery(ctx.resolvedLatestImages.text));
      }
      if (ctx.skillAuthoring) ctx.skillAuthoringClaim.claimed = true;
      await host.pendingCancelledProviderHandshakes.waitForClear(ctx.threadId);
      const preDispatch = guardRoomMemberDispatch(ctx);
      if (preDispatch !== undefined) return preDispatch;
      const outcome = await beginRoomMemberOutcome(ctx);
      const settled = settleRoomMemberTurn(ctx, outcome);
      if (settled !== undefined) return settled;
      {
        const {
          orchestration, internalGeneration, isCancelled, hop, replyText, group, bot, threadId, spoken, operation,
          groupId, onProviderHandshakeStarted, onProviderHandshakeSettled, skillAuthoringClaim, runGroupMemberTurn,
        } = ctx;
        const { coordinator, MAX_GROUP_HOPS, store, mentionedBots, reachablePeers, roomResponders, waitForChatRoomMember } = host;
  // chained mentions: a member's reply can summon teammates  -  one hop only
  if (
    (orchestration?.followMentions ?? true) &&
    !orchestration?.roomHandoffId &&
    !coordinator.has(internalGeneration) &&
    !isCancelled?.() &&
    hop < MAX_GROUP_HOPS &&
    replyText.trim()
  ) {
    const members = group.memberIds
      .map((id) => store.bot(id))
      .filter((b): b is NonNullable<typeof b> => Boolean(b) && b!.id !== bot.id);
    // A mention of a section peer who is NOT in the room reaches nobody:
    // no turn, no error, just a name in the reply that looks like it did
    // something. Say so in the room, where the person who can fix it  -  by
    // adding them  -  is the one reading. Only reachable peers are checked,
    // so the chip never names a bot this one could not contact anyway.
    const missed = mentionedBots(
      replyText,
      reachablePeers(store.bots, bot).filter((peer) => !group.memberIds.includes(peer.id)),
    );
    for (const peer of missed) {
      store.appendMessage(threadId, {
        role: "bot",
        kind: "activity",
        tool: {
          name: `${peer.name} isn't in this room, so that mention didn't reach them  -  add them to the room to bring them in.`,
          ok: false
        }
      });
    }
    for (const next of roomResponders(replyText, members, { kind: "mentions" })) {
      if (isCancelled?.()) return false;
      if (spoken.has(next.id)) continue;
      if (operation) {
        // a summoned teammate busy elsewhere is woken later, exactly like a
        // direct responder; one skipped by the cap must not be retried as a
        // direct responder of the same round
        const verdict = await waitForChatRoomMember(operation, threadId, next);
        if (verdict === "stop") return false;
        if (verdict === "skip") {
          spoken.add(next.id);
          continue;
        }
      }
      if (!(await runGroupMemberTurn(
        groupId,
        threadId,
        next.id,
        hop + 1,
        spoken,
        undefined,
        undefined,
        isCancelled,
        onProviderHandshakeStarted,
        onProviderHandshakeSettled,
        skillAuthoringClaim,
        undefined,
        operation,
      ))) {
        return false;
      }
    }
  }
  return true;
      }
    } catch (error) {
      return finishCatch(ctx, error);
    } finally {
      finishFinally(ctx);
    }
    return true;
  };
}
