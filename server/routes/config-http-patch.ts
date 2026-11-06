// @ts-nocheck
/**
 * /api/config write pipeline (#1388): named steps of applyConfigHttpPatch.
 * Pure move out of server/index.ts; behaviour unchanged. Never imports index.ts.
 */
import type { ConfigWriteContext } from "./config-http.ts";

export type ConfigHttpPatchHost = Record<string, any>;

/** Full PUT/PATCH /api/config pipeline. `getHost` runs per request. */
export function createApplyConfigHttpPatch(getHost: () => ConfigHttpPatchHost): any {
  return async function applyConfigHttpPatch({ res, url, auth, body, json }: ConfigWriteContext): Promise<void> {
    const host = getHost();

    // --- step: validateConfigPatch ---
    const patch = parseConfigPatch(body as Parameters<typeof parseConfigPatch>[0]);
    // Grok voice runs on the xAI key (2026-10-14): a Grok voice key from an
    // older client fills the xAI key when none is saved. Logged, never the value.
    const grokVoiceFold = foldGrokVoiceKeyPatch(patch, host.cfg.xai?.key, { allowMove: !host.hostedModels });
    if (grokVoiceFold) console.log(grokVoiceKeyFoldMessage(grokVoiceFold));
    if (patch.newBotDefaults) {
      if (patch.newBotDefaults.profile.modelSelection) {
        const checked = host.checkedModelSelection(patch.newBotDefaults.profile.modelSelection);
        if (!checked.ok) return json(res, checked.status, { error: checked.error });
        patch.newBotDefaults.profile.modelSelection = checked.selection;
      }
      for (const skill of patch.newBotDefaults.skills) {
        const parsed = parseSkillMd(skill.text);
        if ("error" in parsed || parsed.name !== skill.name) return json(res, 400, { error: "Skill name does not match its contents" });
      }
    }
    if (host.hostedModels && patch.defaultModelSelection) {
      const checked = host.checkedModelSelection(patch.defaultModelSelection);
      if (!checked.ok) return json(res, checked.status, { error: checked.error });
    }
    if (patch.automaticRecovery?.enabled) {
      const checked = host.checkedModelSelection(patch.automaticRecovery.backup, undefined, true);
      if (!checked.ok) return json(res, checked.status, { error: checked.error });
      const target = host.registry.get(checked.selection.instanceId)!;
      if (!target.enabled) return json(res, 400, { error: "Enable the backup engine before selecting it for recovery." });
      const refusal = host.policyModelRefusal(target);
      if (refusal) return json(res, 403, { error: refusal, code: "managed_policy" });
      patch.automaticRecovery.backup = checked.selection;
    }
    if (!Object.keys(patch).length) {
      // Only a Grok voice key that was not kept: nothing else to save.
      if (grokVoiceFold) return json(res, 200, host.orgXaiMediaView(host.configForPerson(host.configForAccess(host.configStatus(), auth.scopes.includes("admin")), host.viewerIdentity(auth)), host.viewerIdentity(auth)));
      return json(res, 400, { error: "nothing to save" });
    }
    if (patch.decider) {
      // Saving a key is the "turn it on"; clearing it turns it off, or
      // falls back to Cloud Pro's included decisions where there are some.
      const planned = deciderSavePatch(patch.decider, host.cfg.decider, deciderIncludedHere());
      if (!planned.ok) return json(res, 400, { error: planned.error });
      patch.decider = planned.patch;
    }
    const changingVoiceProvider = patch.tts?.provider !== undefined
      && patch.tts.provider !== host.tts.voiceProvider(host.cfg);
    if (changingVoiceProvider && patch.tts?.voice === undefined) {
      // Voice ids are provider-owned opaque values. Never carry a default
      // from one catalog into another. A caller may explicitly supply a
      // voice for the newly selected provider in this same atomic patch.
      patch.tts = { ...patch.tts, voice: "" };
    }
    if (host.providerConfigBusy) return json(res, 409, { error: "provider settings are already being updated" });
    const bodyRecord = body && typeof body === "object" ? body as Record<string, unknown> : null;
    if (patch.browserProfiles !== undefined && bodyRecord && bodyRecord.expectedBrowserProfiles !== undefined) {
      const current = (host.cfg.browserProfiles ?? []).map(({ id, name }) => ({ id, name }));
      if (JSON.stringify(bodyRecord.expectedBrowserProfiles) !== JSON.stringify(current)) {
        return json(res, 409, { error: "Browser profiles changed in another window. Review the refreshed list and try again." });
      }
    }
    const disablingBuiltInBrowser = patch.features?.browser === false && builtInBrowserEnabled(host.cfg);
    const removedBrowserProfileIds = patch.browserProfiles === undefined
      ? []
      : (host.cfg.browserProfiles ?? [])
          .map((profile) => profile.id)
          .filter((id) => !patch.browserProfiles!.some((profile) => profile.id === id));
    const profileControlConflict = () => removedBrowserProfileIds.some((id) => {
      const target = browserProfilePartitionTarget(host.cfg, id);
      return target && host.browserRuntime.heldBy(browserSessionId("", target.partitionId));
    });
    if (profileControlConflict()) return json(res, 409, { error: "Release browser control before deleting its profile." });
    if (patch.browserProfiles !== undefined) {
      const currentProfiles = new Map((host.cfg.browserProfiles ?? []).map((profile) => [profile.id, profile]));
      const nextProfiles = patch.browserProfiles.map((profile) => {
        const partitionId = currentProfiles.get(profile.id)?.partitionId;
        return partitionId ? { ...profile, partitionId } : profile;
      });
      const routingConflict = browserProfileReplacementConflict(host.cfg.browserProfiles ?? [], nextProfiles);
      if (routingConflict) return json(res, 409, { error: routingConflict });
      const currentIds = new Set((host.cfg.browserProfiles ?? []).map((profile) => profile.id));
      const pendingReuse = patch.browserProfiles.find(
        (profile) => !currentIds.has(profile.id) && host.browserCleanup.hasPendingProfile(profile.id),
      );
      if (pendingReuse) {
        return json(res, 409, {
          error: `the previous “${pendingReuse.name}” browser session is still being erased — wait before reusing it`
        });
      }
    }
    if (patch.browserProfiles !== undefined) {
      const retained = new Set(patch.browserProfiles.map((profile) => profile.id));
      const activeReference = host.store.bots.find(
        (bot) => bot.busy && bot.browserProfile && bot.browserProfile !== "guest" && !host.isPersonalBrowserProfileId(bot.browserProfile) && !retained.has(bot.browserProfile),
      );
      if (activeReference) {
        return json(res, 409, {
          error: `stop ${activeReference.name}'s turn before removing its browser profile`
        });
      }
    }
    if (patch.box?.token !== undefined) patch.box.token = patch.box.token.trim();
    const currentBoatToken = host.cfg.box?.token?.trim() ?? "";
    // --- step: validateConfigCredentials ---
    const nextBoatToken = patch.box?.token === undefined ? currentBoatToken : patch.box.token;
    const changingBoatToken = patch.box?.token !== undefined && nextBoatToken !== currentBoatToken;
    const currentVpsAlias = vpsSshAlias(host.cfg);
    const nextVpsAlias = patch.vps === undefined
      ? currentVpsAlias
      : vpsSshAlias({ ...cfg, vps: patch.vps });
    const changingVpsAlias = patch.vps !== undefined && nextVpsAlias !== currentVpsAlias;
    const transitioningProviders: RemoteComputerProvider[] = [
      ...(changingBoatToken ? ["box" as const] : []),
      ...(changingVpsAlias ? ["vps" as const] : []),
    ];
    // Organization mode: one server environment per PERSON
    // (user-sandbox), never a VM per bot.
    if (host.IDENTITY.kind === "perspicax" && patch.localVm?.mode === "per-bot") {
      return json(res, 409, { error: "On an organization server each person has one server environment shared by all their bots; a VM per bot is not available.", code: "org_user_sandbox" });
    }
    host.providerConfigBusy = true;
    const changingLocalVmMode = patch.localVm?.mode !== undefined && patch.localVm.mode !== localVmMode(host.cfg);
    if (changingLocalVmMode) host.localVmModeChangeBusy = true;
    try {
      for (const provider of transitioningProviders) {
        const conflict = host.providerOperationConflict(provider);
        if (conflict) return json(res, 409, { error: conflict });
      }
      for (const provider of transitioningProviders) host.computerProviderConfigTransitions.add(provider);

      if (changingVpsAlias && currentVpsAlias) {
        const inventory = await host.vps.listManagedVpsComputers(
          { vps: { sshAlias: currentVpsAlias } },
          host.managedBoatOwners(),
        );
        if (!inventory.available) {
          return json(res, 503, {
            error: `${inventory.problem ?? "VPS computer inventory is unavailable"}. Keep the current SSH config alias and retry`
          });
        }
        const resourceError = vpsAliasResourceChangeError(inventory.instances.length);
        if (resourceError) return json(res, 409, { error: resourceError });
      }

      let boatRecovery = changingBoatToken ? host.boatCreateRecoverySnapshot() : [];
      let boatDeletions = changingBoatToken ? host.boatDeletionSnapshot() : [];
      if (changingBoatToken && boatDeletions.length > 0 && !nextBoatToken) {
        return json(res, 409, {
          error: "finish or retry pending cloud computer deletion before removing the Boat account"
        });
      }
      let replacementProvedByDeletion = false;
      if (changingBoatToken && boatDeletions.length > 0 && nextBoatToken) {
        try {
          await host.boat.verifyBoatDeletionCredential({ box: { token: nextBoatToken } });
          replacementProvedByDeletion = true;
          // Verification can observe a completed operation and retire both
          // its deletion fence and matching create receipt. Never continue
          // with the pre-verification snapshots: they would demand access
          // to a Boat whose exact operation just proved it was deleted.
          boatRecovery = host.boatCreateRecoverySnapshot();
          boatDeletions = host.boatDeletionSnapshot();
        } catch (error) {
          return json(res, (error as { status?: number })?.status ?? 503, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      let currentBoatInventory: host.boat.ManagedBoatInventory | null = null;
      let replacingRejectedBoatToken = false;
      let currentBoatResources: Array<{ boxId: string; name: string }> | null = null;
      const journalBoatResources: Array<{ boxId: string; name: string }> = [];
      const deletingBoatIds = new Set(boatDeletions.map((entry) => entry.boxId));
      if (changingBoatToken && currentBoatToken) {
        currentBoatInventory = await host.boat.listManagedBoats(
          { box: { token: currentBoatToken } },
          host.managedBoatOwners(),
        );
        if (!currentBoatInventory.available) {
          replacingRejectedBoatToken = currentBoatInventory.credentialRejected === true && Boolean(nextBoatToken);
          if (!replacementProvedByDeletion && !replacingRejectedBoatToken) {
            return json(res, 503, {
              error: `${currentBoatInventory.problem ?? "cloud computer inventory is unavailable"}. Keep the current Boat account and retry`
            });
          }
          // A rejected old key cannot authorize its own rotation. Below,
          // validate the replacement and prove access to remembered Boats;
          // pending deletions retain their target-bound verification.
          currentBoatInventory = null;
        }
        if (currentBoatInventory) {
          const currentById = new Map(
            currentBoatInventory.instances.map((instance) => [instance.boxId, { boxId: instance.boxId, name: instance.name }]),
          );
          for (const recovery of boatRecovery) {
            if (!recovery.boxId) continue;
            // A failed provisioning attempt may never have reached the
            // deterministic rename. The replacement credential already
            // proved the exact deletion target, so its in-flight resource
            // is governed by that stronger target-bound receipt rather
            // than a Sagax name check.
            if (replacementProvedByDeletion && deletingBoatIds.has(recovery.boxId)) continue;
            const inspected = await host.boat.inspectBoatIdentity({ box: { token: currentBoatToken } }, recovery.boxId);
            if (!inspected.available) {
              return json(res, 503, {
                error: `${inspected.problem ?? "a remembered cloud computer could not be verified"}. Keep the current Boat account and retry`
              });
            }
            if (!inspected.identity) {
              // Reconcile exact stale receipts while the current credential is
              // still available. Leaving one behind would make a later token
              // addition demand access to a Boat the provider proved is gone.
              host.retireDeletedBoatCreate(recovery.boxId);
              continue;
            }
            const listed = currentById.get(inspected.identity.boxId);
            if (listed && listed.name !== inspected.identity.name) {
              return json(res, 503, { error: "boat.dev returned conflicting cloud computer identities; keep the current Boat account and retry" });
            }
            currentById.set(inspected.identity.boxId, inspected.identity);
            journalBoatResources.push(inspected.identity);
          }
          currentBoatResources = [...currentById.values()];
        }
      }

      if (changingLocalVmMode) {
        if (host.localVmActiveThreads.size > 0 || host.localVmLifecycleBusy.size > 0 || host.localVmImageBusy) {
          return json(res, 409, { error: "stop Local VM turns and setup actions before changing the Local VM isolation mode" });
        }
        if (localVmMode(host.cfg) === "per-bot" && patch.localVm?.mode === "shared") {
          const existing = await host.perBotLocalVmCountForModeChange();
          if (existing === null) {
            return json(res, 409, {
              error: "start the container runtime and delete every per-bot VM before switching to shared mode"
            });
          }
          if (existing > 0) {
            return json(res, 409, {
              error: `delete the ${existing} per-bot Local VM${existing === 1 ? "" : "s"} before switching to shared mode`
            });
          }
        }
      }
    // check a boat token against the provider before storing it: a
    // rejected token used to save happily and only surface as a 401 in
    // another panel later, with nothing the user could act on
    const newBoatToken = patch.box?.token;
    if (newBoatToken?.trim()) {
      const check = await host.boat.verifyToken(newBoatToken);
      if (!check.ok) return json(res, 400, { error: check.message });
    }
    if (replacingRejectedBoatToken) {
      // An expired credential cannot authorize its own replacement. Probe
      // the new account without adopting or retiring any local identities.
      const replacement = await host.boat.listManagedBoats(
        { box: { token: nextBoatToken } }, host.managedBoatOwners(), { adoptLegacy: false },
      );
      if (!replacement.available) return json(res, 503, { error: replacement.problem ?? "Could not verify the replacement Boat key. Your saved key and computers are unchanged." });
    }
    if (changingBoatToken && (!currentBoatToken || replacementProvedByDeletion || replacingRejectedBoatToken) && boatRecovery.length > 0) {
      if (!nextBoatToken) {
        return json(res, 409, { error: "restore the Boat account that owns the remembered cloud computers before clearing it" });
      }
      for (const recovery of boatRecovery) {
        if (!recovery.boxId) {
          return json(res, 409, { error: "finish reconciling pending cloud computer creation before changing the Boat account" });
        }
        if (replacementProvedByDeletion && deletingBoatIds.has(recovery.boxId)) continue;
        const inspected = await host.boat.inspectBoatIdentity({ box: { token: nextBoatToken } }, recovery.boxId);
        if (!inspected.available) {
          return json(res, 503, {
            error: `${inspected.problem ?? "a remembered cloud computer could not be verified"}. Retry with the Boat account that created it`
          });
        }
        if (!inspected.identity || !(await host.boat.boatNameMatchesBot(recovery.botId, inspected.identity.name))) {
          return json(res, 409, { error: "that Boat token cannot access the remembered cloud computers from this installation" });
        }
      }
    }
    if (changingBoatToken && currentBoatInventory && currentBoatResources) {
      let replacementResources: Array<{ boxId: string; name: string }> | null = null;
      if (nextBoatToken) {
        const replacementInventory = await host.boat.listManagedBoats(
          { box: { token: nextBoatToken } },
          host.managedBoatOwners(),
          { adoptLegacy: false },
        );
        if (!replacementInventory.available) {
          return json(res, 503, {
            error: `${replacementInventory.problem ?? "cloud computer inventory is unavailable"}. Keep the current Boat account and retry`
          });
        }
        replacementResources = replacementInventory.instances.map((instance) => ({
          boxId: instance.boxId,
          name: instance.name
        }));
        const replacementById = new Map(
          replacementResources.map((instance) => [instance.boxId, { boxId: instance.boxId, name: instance.name }]),
        );
        for (const identity of journalBoatResources) {
          const inspected = await host.boat.inspectBoatIdentity({ box: { token: nextBoatToken } }, identity.boxId);
          if (!inspected.available) {
            return json(res, 503, {
              error: `${inspected.problem ?? "a remembered cloud computer could not be verified"}. Keep the current Boat account and retry`
            });
          }
          if (!inspected.identity || inspected.identity.name !== identity.name) {
            return json(res, 409, { error: "the replacement Boat token does not access the same cloud computers" });
          }
          replacementById.set(inspected.identity.boxId, inspected.identity);
        }
        replacementResources = [...replacementById.values()];
      }
      const resourceError = boatAccountResourceChangeError(
        currentBoatResources,
        replacementResources,
      );
      if (resourceError) return json(res, 409, { error: resourceError });
    }
    // Each cloud voice provider owns its own credential. Validate the field
    // against that provider rather than whichever provider happens to be
    // selected, so switching engines never sends one service another's key.
    const newTts = patch.tts;
    if (newTts?.key?.trim()) {
      const check = await host.tts.verifyKey("elevenlabs", newTts.key.trim());
      if (!check.ok) return json(res, 400, { error: check.message });
    }
    if (newTts?.fishKey?.trim()) {
      const check = await host.tts.verifyKey("fish", newTts.fishKey.trim());
      if (!check.ok) return json(res, 400, { error: check.message });
    }
    // A pasted decision-model key is tried once (one tiny yes/no call).
    // Only a refusal blocks the save: an offline or overloaded service must
    // not stop a person saving a key that may well be fine.
    if (patch.decider?.key) {
      const check = await host.decider.testKey({ key: patch.decider.key });
      if (!check.ok && check.reason === "rejected") {
        return json(res, 400, { error: "Jev rejected this key. Check it at typesafe.ai and paste it again.", code: "decider_rejected" });
      }
    }
    if (patch.browserProfiles !== undefined) {
      // Provider/credential validation above may await the network. A turn
      // can start during that window and claim a profile which looked idle
      // at the route's first check, so validate again at the mutation
      // boundary. Keep this check and the synchronous save/reference cleanup
      // below free of awaits.
      const retained = new Set(patch.browserProfiles.map((profile) => profile.id));
      const activeReference = host.store.bots.find(
        (bot) => bot.busy && bot.browserProfile && bot.browserProfile !== "guest" && !host.isPersonalBrowserProfileId(bot.browserProfile) && !retained.has(bot.browserProfile),
      );
      if (activeReference) {
        return json(res, 409, {
          error: `stop ${activeReference.name}'s turn before removing its browser profile`
        });
      }
    }
    // Provider validation above awaits remote services. The transition flag
    // blocks new work, while this second observation catches any operation
    // that already held a claim at the initial boundary.
    for (const provider of transitioningProviders) {
      const conflict = host.providerOperationConflict(provider);
      if (conflict) return json(res, 409, { error: conflict });
    }
    // A change names only the OpenCode provider keys it saves or removes;
    // the rest stay. Merged with no await before the save below, so it
    // starts from what is saved at that moment.
    if (patch.opencodeGo?.providerKeys) {
      const merged = mergeOpenCodeProviderKeys(host.cfg, patch.opencodeGo.providerKeys);
      if (!merged.ok) return json(res, 400, { error: merged.error });
      patch.opencodeGo = { ...patch.opencodeGo, providerKeys: merged.keys };
    }
    // --- step: commitConfigPatch ---
    const browserCleanupRequests: BrowserCleanupRequest[] = [];
    if (profileControlConflict()) return json(res, 409, { error: "Release browser control before deleting its profile." });
    try {
      for (const profileId of removedBrowserProfileIds) {
        const target = browserProfilePartitionTarget(host.cfg, profileId);
        if (!target) throw new Error(`browser profile cleanup target “${profileId}” is unavailable`);
        browserCleanupRequests.push(
          host.browserCleanup.prepare("profile", target.profileId, target.partitionId),
        );
      }
    } catch (error) {
      for (const request of browserCleanupRequests) host.browserCleanup.abort(request);
      throw error;
    }
    // A saved or cleared key starts over: neither it nor the key it
    // replaced stays marked as rejected.
    const resetKeys = host.PROVIDER_KEY_KINDS.flatMap((kind) => {
      const next = patch[kind]?.key;
      return next === undefined ? [] : [host.cfg[kind]?.key, next];
    });
    let configWriteCommitted = false;
    // What each engine is launched with before this write (reloadProviders).
    const enginesBefore = engineLaunches(host.providerConfigs());
    const externalSecretStorage = url.searchParams.get("secretStorage") === "external";
    try {
      // Provider-owned voice ids must be invalidated before the provider
      // commit. If bots.json cannot be written, leave the old provider in
      // place rather than committing a new provider with stale bot voices.
      // A later config-write failure may leave voices cleared, which is the
      // safe side of this cross-file mutation: no foreign id can be spoken.
      if (changingVoiceProvider) host.store.clearVoiceSelections();
      if (externalSecretStorage) {
        // The packaged Electron caller commits supplied credentials to the
        // OS-encrypted store before entering this route. Persist every
        // non-secret sibling in the same request, but replace each supplied
        // credential with an empty tombstone so an older plaintext value can
        // never survive the merge in config.json.
        const persisted = structuredClone(patch);
        if (persisted.xai?.key !== undefined) persisted.xai.key = "";
        if (persisted.box?.token !== undefined) persisted.box.token = "";
        if (persisted.opencodeGo?.apiKey !== undefined) persisted.opencodeGo.apiKey = "";
        if (persisted.tts?.key !== undefined) persisted.tts.key = "";
        if (persisted.tts?.fishKey !== undefined) persisted.tts.fishKey = "";
        if (persisted.tts?.xaiKey !== undefined) persisted.tts.xaiKey = "";
        if (persisted.decider?.key !== undefined) persisted.decider.key = "";
        if (persisted.imageGen?.key !== undefined) persisted.imageGen.key = "";
        if (persisted.imageGen?.customApiKey !== undefined) persisted.imageGen.customApiKey = "";
        if (persisted.openai?.key !== undefined) persisted.openai.key = "";
        saveConfig(persisted);
        configWriteCommitted = true;
        syncCredentialEnv(patch);
        Object.assign(host.cfg, loadConfig());
      } else {
        saveConfig(patch);
        configWriteCommitted = true;
        // loadConfig prefers env over the file for credentials, so the env
        // must follow the save — otherwise the value injected at boot would
        // shadow the new key until the next launch
        syncCredentialEnv(patch);
        Object.assign(host.cfg, loadConfig());
      }
    } catch (error) {
      if (configWriteCommitted) {
        for (const request of browserCleanupRequests) {
          const committed = host.browserCleanup.commit(request);
          void host.browserCleanup.ensure(committed);
        }
      } else {
        for (const request of browserCleanupRequests) host.browserCleanup.abort(request);
      }
      throw error;
    }
    // The operator keeps one principal id, so the org owner needs no
    // rewrite when the profile email changes; only the attribute moves,
    // once the config is saved. A cleared email clears it on the principal.
    if (patch.profile && typeof patch.profile.email === "string") {
      if (patch.profile.email.trim()) host.principals.localOperator(patch.profile.email);
      else host.principals.setEmail(host.principals.localOperator().id, "");
    }
    if (host.IDENTITY.kind !== "perspicax" && typeof patch.anthropic?.key === "string" && patch.anthropic.key.trim()) {
      host.recordAchievements(host.localPrincipalId(), [{ type: "claude.linked" }]);
    }
    for (const key of resetKeys) if (key) host.forgetKey(key);
    // A saved key reaches an engine through the environment its status read uses, often with no reload.
    host.registry.forgetSnapshots();
    // Desktops already counting down move to the new window at once, in
    // every isolation mode; busy work still defers its expiry.
    if (patch.localVm?.idleTimeoutMinutes !== undefined) {
      for (const idle of host.localVmIdles.values()) idle.setIdleMs(host.localVmIdleMs());
    }
    let browserReferenceCleanupError: unknown = null;
    if (patch.signIn !== undefined) {
      host.sessions.revalidateEmailSessions();
      host.resyncOpenCodeProviderKeys();
    }
    if (!host.lendingEnabled()) {
      host.sharedComputers.close();
      host.sharedComputerControl.close();
    }
    if (disablingBuiltInBrowser) { host.browserLive.closeAll(); host.browserNetworkDebug.clearAll(); }
    // The meeting notetaker (or the browser it runs in) was turned off: every
    // meeting leaves now.
    if (!meetingNotetakerEnabled(host.cfg) || disablingBuiltInBrowser) host.meetingService.leaveAll();
    for (const request of browserCleanupRequests) {
      if (request.kind === "profile") {
        host.browserLive.closeForSession(browserSessionId("", request.partitionId));
        host.browserNetworkDebug.clearSession(browserSessionId("", request.partitionId));
      }
    }
    if (patch.browserProfiles !== undefined) {
      const retained = new Set(patch.browserProfiles.map((profile) => profile.id));
      try {
        for (const bot of host.store.bots) {
          if (bot.browserProfile && bot.browserProfile !== "guest" && !host.isPersonalBrowserProfileId(bot.browserProfile) && !retained.has(bot.browserProfile)) {
            // The profile list and every bot reference change in the same
            // config request. Non-renderer clients therefore cannot leave a
            // bot pointing at a deleted cookie partition.
            host.store.patchBot(bot.id, { browserProfile: undefined });
          }
        }
      } catch (error) {
        // Config is already durable. Keep the cleanup intent prepared (so
        // it cannot wipe ambiguous state and its id remains locked), but do
        // not let this secondary write failure skip revocation/reload below.
        browserReferenceCleanupError = error;
      }
    }
    // Only an engine whose launch config this write changed is rebuilt: a
    // provider key, URL or model default reaches its own engines and no
    // others, and a setting no driver reads (profile, language, voice, VPS,
    // room timeout, onboarding progress), or the same values saved again,
    // rebuilds nothing and interrupts no turn.
    const changedEngines = new Set(changedInstanceIds(enginesBefore, engineLaunches(host.providerConfigs())));
    // Config is already durable. A changed engine's old children are
    // invalid immediately, including when browser cleanup below has to
    // await Electron before reloadProviders begins.
    host.revokeEngineCapabilities(changedEngines);
    // The cleanup marker becomes committed only after both pieces of durable
    // application state agree. Commit/ACK failures are deferred until every
    // mandatory consequence of the config write has run: no journal I/O
    // failure may leave a two-hour bearer or stale provider fleet active.
    const finalized = await finalizeBrowserCleanupMutation({
      requests: browserCleanupRequests,
      referenceError: browserReferenceCleanupError,
      commit: (request) => host.browserCleanup.commit(request),
      ensure: (request) => host.browserCleanup.ensure(request),
      mandatory: async () => {
        let mandatoryError: unknown = null;
        if (disablingBuiltInBrowser) {
          try {
          } catch (error) {
            mandatoryError = error;
          }
        }
        if (changedEngines.size > 0) {
          try {
            await host.reloadProviders(enginesBefore);
          } catch (error) {
            if (!mandatoryError) mandatoryError = error;
          }
        }
        const status = host.configStatus();
        host.broadcast({ kind: "config", ...status });
        if (patch.threads !== undefined) {
          host.drainQueuedSends();
          host.drainDelegationWakes();
          host.drainComputerResumes();
          host.drainSecretResumes();
          host.drainTeamSetupResumes();
        }
        if (mandatoryError) throw mandatoryError;
        return status;
      }
    });
    // Normal desktop deletes wait for Electron's acknowledgement. If
    // Electron is restarting, the committed journal keeps retrying and the
    // id-reuse guard above prevents stale logins from resurfacing. Delaying
    // this assertion until after every mandatory post-commit effect keeps
    // the runtime aligned with the config even on a truthful 503 response.
    requireBrowserCleanupAcknowledged(
      finalized.acknowledgements.every(Boolean),
      removedBrowserProfileIds.length === 1 ? "The browser profile" : "The browser profiles",
    );
    return json(res, 200, host.orgXaiMediaView(host.configForPerson(finalized.value, host.viewerIdentity(auth)), host.viewerIdentity(auth)));
    } finally {
      for (const provider of transitioningProviders) host.computerProviderConfigTransitions.delete(provider);
      if (changingLocalVmMode) host.localVmModeChangeBusy = false;
      host.providerConfigBusy = false;
    }
  };
}
