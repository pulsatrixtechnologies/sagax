// @ts-nocheck
/** deleteBotWithLifecycle (#1388). Pure move from server/index.ts. */
import { requireBrowserCleanupAcknowledged } from "../browser/browser-lifecycle-cleanup.ts";
import { boatCreateRecoverySnapshot } from "../computer/boat-create-idempotency.ts";
import { boatDeletionSnapshot } from "../computer/boat-delete-journal.ts";
import * as boat from "../computer/boat.ts";
import { perBotLocalVmTarget, containerComputerStatus, containerComputerAction } from "../computer/container-computer.ts";
import * as vps from "../computer/vps-computer.ts";
import { vpsSshAlias, localVmMode } from "../config.ts";
import { dataEngine } from "../data/deps.ts";
import { forgetDataScopes } from "../data/scope.ts";
import { cancelPeerApprovalsFor } from "../peers/peer-approval.ts";
import { existsSync } from "node:fs";
import { rm as removeDirectory } from "node:fs/promises";
export type Host = Record<string, any>;

export function createDeleteBotWithLifecycle(getHost: () => Host): any {
async function deleteBotWithLifecycle(botId: string, revalidate: () => void = () => {}, setupRequest?: TeamSetupRequest) {
  const host = getHost();
  const deletionResponse = (status: number, body: { error?: string; ok?: boolean }) => ({ status, body });
      revalidate();
      const bot = host.store.bot(botId);
      if (!bot) return deletionResponse( 404, { error: "no such bot" });
      if (host.computerProviderConfigTransitions.size > 0) {
        return deletionResponse( 409, { error: "computer provider settings are being updated — wait before deleting this bot" });
      }
      if (host.localVmModeChangeBusy) {
        return deletionResponse(409, { error: "Local VM settings are being updated — wait before deleting this bot" });
      }
      if (host.boatLifecycleBusyBots.has(bot.id)) {
        return deletionResponse( 409, { error: "wait for this bot's cloud computer action to finish before deleting the bot" });
      }
      const activeRoutine = host.routines!.activeRunForBot(bot.id);
      if (activeRoutine) {
        return deletionResponse( 409, {
          error: "stop this bot's active routine before deleting the bot"
        });
      }
      const activeGroup = host.activeGroupTurnForBot(bot.id);
      if (activeGroup) {
        return deletionResponse( 409, {
          error: `stop this bot's work in channel ${activeGroup.group.name} before deleting the bot`
        });
      }
      // A direct turn that has already claimed the bot can provision a Boat in
      // its background setup. Do not let deletion race that work while a Boat
      // account is configured; the person can stop the turn and retry.
      if ((boat.boatConfigured(host.cfg) || vpsSshAlias(host.cfg)) && (bot.busy || host.hasDirectDispatch(bot.id))) {
        return deletionResponse( 409, { error: "stop this bot's work before checking and deleting its cloud computer" });
      }
      const botBoatRecovery = boatCreateRecoverySnapshot().filter((entry) => entry.botId === bot.id);
      const botBoatDeletions = boatDeletionSnapshot().filter((entry) => entry.ownerBotId === bot.id);
      if (botBoatRecovery.some((entry) => !entry.resolved)) {
        return deletionResponse( 409, {
          error: "finish reconciling this bot's pending cloud computer creation before deleting it — check boat.dev, then retry Boat setup"
        });
      }
      // Bot deletion awaits VM/browser/provider cleanup. Claim the bot and
      // every channel it belongs to before that first await so a phone save
      // cannot begin halfway through teardown (or vice versa). The computer
      // lifecycle claim is synchronous too, so either both claims are held or
      // neither survives this request.
      const releaseComputerLifecycle = host.claimBotComputerLifecycle(bot.id);
      const releasePhoneSecretMutation = host.claimPhoneSecretBotDeletion(bot.id);
      if (!releasePhoneSecretMutation) {
        releaseComputerLifecycle();
        return deletionResponse( 409, { error: "this bot or one of its channels is securely saving a credential" });
      }
      let claimedLocalVmTarget: LocalVmTarget | null = null;
      try {
        let localVmCleanup: { target: LocalVmTarget; removeContainer: boolean } | null = null;
        if (localVmMode(host.cfg) === "per-bot") {
          const target = perBotLocalVmTarget(bot.id);
          if (host.localVmActiveThreads.has(target.key) || host.localVmLifecycleBusy.has(target.key)) {
            return deletionResponse( 409, { error: "stop this bot's Local VM turn or setup action before deleting the bot" });
          }
          if (host.localVmLeaseFor(target).current(host.localVmOwnerBusy)) {
            return deletionResponse(409, { error: "stop this bot's Local VM turn before deleting the bot" });
          }
          // Hold the target from preflight through deletion. A simultaneous
          // mode change or lifecycle route must not recreate the container
          // after we checked it and before its bot owner disappears.
          host.localVmLifecycleBusy.add(target.key);
          claimedLocalVmTarget = target;
          const vm = await containerComputerStatus(undefined, undefined, target);
          if (!vm.daemonUp && existsSync(target.workspaceDir)) {
            return deletionResponse( 409, {
              error: "start the container runtime so Sagax can remove this bot's Local VM while deleting it"
            });
          }
          if (vm.container !== "missing" && !vm.managed) {
            return deletionResponse(409, {
              error: `The container named ${vm.container_name} was not created by Sagax. Remove it manually before deleting this bot`
            });
          }
          localVmCleanup = {
            target,
            removeContainer: vm.container !== "missing"
          };
        }

        // Preflight every provider before deleting any resource. Cleanup can
        // still fail mid-flight across independent providers, but a missing
        // credential or offline daemon should not cause avoidable partial work.
        const vpsInventory = await vps.listManagedVpsComputers(host.cfg, host.managedBoatOwners());
        if (vpsInventory.configured && !vpsInventory.available) {
          return deletionResponse( 503, {
            error: `${vpsInventory.problem ?? "VPS computer inventory is unavailable"}. The bot was kept so its computer can be retried safely`
          });
        }
        const ownedVpsComputers = vpsInventory.instances.filter((instance) => instance.ownerBotId === bot.id);

        if ((botBoatRecovery.length > 0 || botBoatDeletions.length > 0) && !boat.boatConfigured(host.cfg)) {
          return deletionResponse(409, {
            error: "Reconnect the Boat account that owns this bot's remembered cloud computer, then retry deletion"
          });
        }
        const cloudInventory = await boat.listManagedBoats(host.cfg, host.managedBoatOwners());
        if (cloudInventory.configured && !cloudInventory.available) {
          return deletionResponse( 503, {
            error: `${cloudInventory.problem ?? "cloud computer inventory is unavailable"}. The bot was kept so its computer can be retried safely`
          });
        }
        const ownedBoatComputers = cloudInventory.instances.filter((instance) => instance.ownerBotId === bot.id);

        // Revalidate a reviewed Primary Bot-of-Staff request and establish the
        // browser cleanup intent before the first irreversible provider
        // mutation. A stale review or damaged journal therefore leaves every
        // computer intact. Cross-provider rollback is impossible, so every
        // subsequent operation is exact and retry-safe.
        revalidate();
        const browserCleanupRequest = host.browserCleanup.prepare("bot", bot.id);
        try {
          // Provider-owned computers are durable, billable resources. Remove
          // each exact, freshly revalidated identity before making its bot
          // owner disappear. Shared team computers use a different owner id
          // and are intentionally absent from these lists.
          for (const instance of ownedBoatComputers) {
            const removed = await boat.deleteManagedBoat(host.cfg, host.managedBoatOwners(), instance.boxId, instance.name);
            if (removed.pending) {
              throw Object.assign(
                new Error("The cloud computer deletion has started but is still finishing. The bot was kept; retry in a moment"),
                { status: 409 },
              );
            }
          }
          for (const instance of ownedVpsComputers) {
            await vps.removeManagedVpsComputer(host.cfg, host.managedBoatOwners(), instance.name, instance.name);
          }
          if (localVmCleanup) {
            if (localVmCleanup.removeContainer) {
              await containerComputerAction("remove", undefined, undefined, localVmCleanup.target);
            }
            // Unlike the standalone "Delete VM" action, deleting the bot is
            // a complete erasure: its now-ownerless desktop files and browser
            // session must not remain hidden on disk or block the event loop.
            await removeDirectory(localVmCleanup.target.workspaceDir, { recursive: true, force: true });
            host.localVmSeen.delete(localVmCleanup.target.key);
            host.localVmIdles.get(localVmCleanup.target.key)?.cancel();
            host.localVmIdles.delete(localVmCleanup.target.key);
            host.localVmLeases.forget(localVmCleanup.target.key);
          }
          // a running turn dies with its bot
          // Invalidate every bot-callable bearer before the first asynchronous
          // teardown step. A request that already passed its initial header
          // check is revalidated after its body arrives and must fail closed.
          for (const task of host.store.tasks(bot.id)) host.revokeInternalCapabilitiesForThread(task.threadId);
          await host.interruptAllDirectThreads(bot.id);
          // Deletion removes the thread before a late turn.completed can fold
          // staged provider images into a message, so dispose them here.
          for (const task of host.store.tasks(bot.id)) {
            host.purgeTurnAttachmentsForThread(task.threadId);
            host.clearTurnDigestState(task.threadId);
            host.settleDirectFollowup(host.directTurnGenerationByThread.get(task.threadId), { ok: false, text: "The bot was deleted while it was working" });
            host.directTurnGenerationByThread.delete(task.threadId);
            host.directTurnBots.delete(task.threadId);
          }
          host.stopScreenPoller(bot.id);
          host.activeVpsThreads.delete(bot.id);
          host.lastReply.delete(bot.threadId);
          // a peer approval naming this bot can never be meaningfully answered
          // now, and its caller would otherwise wait out the 15-minute timeout
          cancelPeerApprovalsFor(bot.id);
          host.computerControl.forget(bot.id);
          host.computerControlRevision.delete(bot.id);
          const target = perBotLocalVmTarget(bot.id);
          host.localVmIdles.get(target.key)?.cancel();
          host.localVmIdles.delete(target.key);
          // Provider and local-computer teardown above can await for an
          // arbitrary amount of time. A reviewed Primary Bot deletion is bound to
          // the exact target profile it presented; re-check that receipt at
          // the final durable mutation boundary so a concurrent profile edit
          // cannot be erased under a stale approval.
          revalidate();
          // its confidential threads' engine transcripts, keyed before they go
          const confidentialEngines = host.store.tasks(bot.id).filter((task) => task.confidential === true)
            .map((task) => ({ threadId: task.threadId, keys: host.threadEngineKeys(bot.id, task.threadId) }));
          host.botWaits.removeForBot(bot.id);
          host.store.deleteBot(bot.id, setupRequest);
          host.skillReview.dropBot(bot.id);
          host.purgeDeletedThreadEngines(confidentialEngines, "bot deleted");
          host.skillReview.dropBot(bot.id);
          // Removing schedules is not a security revocation. Keep them intact
          // if the bot/receipt write fails, so a failed deletion is retryable.
          host.routines!.disableForBot(bot.id);
          host.webhooks.disableForBot(bot.id);
          host.botMailResync();
          host.calendarCalls!.removeBot(bot.id);
          host.browserLive.closeForBot(bot.id);
          host.browserNetworkDebug.clearBot(bot.id);
          host.cacheKeepWarm.cancelBot(bot.id);
          host.computerTeach.discardBot(bot.id);
          await host.forgetTemporaryBrowser(bot.id);
          // The bot's database and sheet go with the bot; a failure here
          // must not undo a deletion the store already made durable.
          // Every scope of it too: each person's and each confidential thread's.
          host.dataSheets.delete(bot.id);
          forgetDataScopes(bot.id);
          if (dataEngine.unavailable() === null) await dataEngine.deleteBot(bot.id).catch((error) => console.warn(`data: could not delete ${bot.id}'s database`, error));
        } catch (error) {
          if (browserCleanupRequest) {
            // Store removal is already durable once the in-memory owner is
            // gone. A later cleanup error must retain its browser erasure
            // intent for retry instead of aborting a completed deletion.
            if (host.store.bot(bot.id)) host.browserCleanup.abort(browserCleanupRequest);
            else host.browserCleanup.commit(browserCleanupRequest);
          }
          throw error;
        }
        if (browserCleanupRequest) {
          const committedCleanup = host.browserCleanup.commit(browserCleanupRequest);
          const acknowledged = await host.browserCleanup.ensure(committedCleanup);
          requireBrowserCleanupAcknowledged(acknowledged, `Browser data for ${bot.name}`);
        }
        return deletionResponse( 200, { ok: true });
      } finally {
        if (claimedLocalVmTarget) host.localVmLifecycleBusy.delete(claimedLocalVmTarget.key);
        releaseComputerLifecycle();
        releasePhoneSecretMutation();
      }
}
  return deleteBotWithLifecycle;
}
