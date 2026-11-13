// @ts-nocheck
/** configStatus (#1388). Pure move from server/index.ts. */
import * as boat from "../computer/boat.ts";
import { threadEventLogMaxBytes, threadEventLogRetentionDays, semanticRecallEnabled, vpsSshAlias, openCodeProviderKeys, liveSettingsFor, roomTurnTimeoutMinutes, mcpCallTimeoutMinutes, cacheKeepWarmSettings, maxConcurrentBotThreads, maxParallelTasksPerPerson, localVmMode, localVmMaxInstances, localVmIdleTimeoutMinutes, skillAuthoringEnabled, skillReviewEnabled, skillReviewSteps, skillsLibraryEnabled, showToolCallsEnabled, routinesInConversationEnabled, templatesEnabled, vpsComputerEnabled, boatComputerEnabled, decisionModelEnabled, dataWindowEnabled, meetingNotetakerEnabled, routineGroupSettingsEnabled, builtInBrowserEnabled, sharedComputersEnabled, claudeUserMcpEnabled, autoRecallEnabled, roomMemoryCaptureEnabled, llmThreadTitlesEnabled } from "../config.ts";
import { describeDecider } from "../decider/index.ts";
import { decisionRetentionDays } from "../decision-log.ts";
import { editionStatus, workspaceMembership } from "../enterprise.ts";
import { fleetAvailable, fleetSocketPath } from "../fleet/fleet-client.ts";
import { loopGuardSettings, correctiveRounds } from "../host/loop-guard.ts";
import { avatarImageStatus } from "../media/avatar-image.ts";
import { compatServers } from "../openai-compat-servers.ts";
import { savedStepsEnabled } from "../saved-steps/saved-steps.ts";
import * as tts from "../tts/index.ts";
import { claudeUserSkillsEnabled } from "../turn-settings.ts";
import { TEACH_TASK_OFFERED } from "../../shared/teach-task.ts";
export type Host = Record<string, any>;

export function createConfigStatus(getHost: () => Host): any {
function configStatus() {
  const host = getHost();
  // off-by-default thread cleanup knobs stay absent so clients can tell
  // "unset" apart from any in-range value
  const eventLogMaxBytes = threadEventLogMaxBytes(host.cfg);
  const eventLogRetentionDays = threadEventLogRetentionDays(host.cfg);
  return {
    xai: { configured: Boolean(host.cfg.xai?.key) },
    mistral: { configured: Boolean(host.cfg.mistral?.key) },
    cerebras: { configured: Boolean(host.cfg.cerebras?.key) },
    groq: { configured: Boolean(host.cfg.groq?.key) },
    meta: { configured: Boolean(host.cfg.meta?.key) },
    deepseek: { configured: Boolean(host.cfg.deepseek?.key) },
    anthropic: { configured: Boolean(host.cfg.anthropic?.key), everyClaudeBot: host.cfg.anthropic?.everyClaudeBot !== false },
    openai: { configured: Boolean(host.cfg.openai?.key) },
    openrouter: { configured: Boolean(host.cfg.openrouter?.key) },
    // a fleet agent on this server means Settings → Installations has something to drive
    fleet: { available: fleetAvailable(fleetSocketPath()) },
    // the features this server runs with (every one in the open-source
    // edition), so Settings shows only what works here
    edition: host.editionForSettings(editionStatus()),
    // settings, not secrets: the cap and the operator's own price list
    budgets: {
      ...(host.cfg.budgets?.monthlyUsd !== undefined ? { monthlyUsd: host.cfg.budgets.monthlyUsd } : {}),
      ...(host.cfg.budgets?.warnAtPercent !== undefined ? { warnAtPercent: host.cfg.budgets.warnAtPercent } : {})
    },
    billing: { currency: host.cfg.billing?.currency ?? "USD", prices: host.cfg.billing?.prices ?? {} },
    // how long the approval decision log is kept, after env and default
    decisions: { retentionDays: decisionRetentionDays(host.cfg.decisions?.retentionDays) },
    // recall by meaning (server/recall/semantic-index.ts); the endpoint is an address, not a secret
    memory: { semanticRecall: semanticRecallEnabled(host.cfg), embeddingsUrl: host.cfg.memory?.embeddingsUrl ?? "", embeddingsModel: host.cfg.memory?.embeddingsModel ?? "" },
    // the base URL is a setting, not a secret; the key stays write-only
    openaiCompat: { configured: Boolean(host.cfg.openaiCompat?.key), url: host.cfg.openaiCompat?.url ?? "", model: host.cfg.openaiCompat?.model ?? "" },
    // lot 4: changes when the organization's declarations (public fields) do
    ...(host.orgCapabilitiesRevision ? { orgCapabilities: { revision: host.orgCapabilitiesRevision } } : {}),
    // 2026-10-30: the named OpenAI-compatible servers, never their keys.
    // Person isolation (#2054) is applied in configForPerson / instancesForViewer.
    openaiCompatServers: compatServers(host.cfg),
    // configured = cloud computers work here; included = through Cloud Pro,
    // not a saved key
    box: boat.describeBoatAccount(host.cfg),
    vps: { configured: Boolean(vpsSshAlias(host.cfg)), sshAlias: vpsSshAlias(host.cfg) ?? "" },
    // names only: every provider key stays write-only
    opencodeGo: { configured: Boolean(host.cfg.opencodeGo?.apiKey), providerKeys: Object.keys(openCodeProviderKeys(host.cfg)) },
    // the chosen voice is a setting, not a secret; the key is reported the
    // same configured-or-not way as every other credential
    tts: tts.describeVoice(host.cfg),
    // the decision model: switches and configured-or-not, never the key
    decider: describeDecider(host.cfg),
    imageGen: avatarImageStatus(host.cfg),
    // Live calls: configured-or-not only; the voice name is a setting
    live: liveSettingsFor(host.cfg),
    // not a secret — the sidebar shows it
    profile: { name: host.cfg.profile?.name ?? "", email: host.cfg.profile?.email ?? "", aboutMe: host.cfg.profile?.aboutMe ?? "", avatarUrl: host.cfg.profile?.avatarUrl ?? "" },
    // the enrolled organisation's read-only desktop policy; null when not enrolled
    managedPolicy: host.managedPolicy.summary(),
    // not a secret — the settings picker shows it; "" = follow the system
    language: host.cfg.language ?? "",
    rooms: { turnTimeoutMinutes: roomTurnTimeoutMinutes(host.cfg) },
    mcp: { callTimeoutMinutes: mcpCallTimeoutMinutes(host.cfg) },
    automaticRecovery: host.cfg.automaticRecovery ?? { enabled: false },
    cacheKeepWarm: cacheKeepWarmSettings(host.cfg),
    // The new-bot template's visible defaults. Memory files and skills stay
    // on GET /api/bot-defaults; this line is what Settings summarizes.
    newBotDefaults: {
      profile: {
        ...(host.cfg.newBotDefaults?.profile.modelSelection ? { modelSelection: host.cfg.newBotDefaults.profile.modelSelection } : {}),
        ...(host.cfg.newBotDefaults?.profile.approvalMode ? { approvalMode: host.cfg.newBotDefaults.profile.approvalMode } : {}),
        ...(host.cfg.newBotDefaults?.profile.computer !== undefined && host.cfg.newBotDefaults.profile.computer !== null
          ? { computer: host.cfg.newBotDefaults.profile.computer }
          : {})
      }
    },
    threads: {
      maxConcurrentPerBot: maxConcurrentBotThreads(host.cfg),
      maxParallelPerPerson: maxParallelTasksPerPerson(host.cfg),
      ...(eventLogMaxBytes !== null ? { eventLogMaxBytes } : {}),
      ...(eventLogRetentionDays !== null ? { eventLogRetentionDays } : {})
    },
    localVm: {
      mode: localVmMode(host.cfg),
      maxInstances: localVmMaxInstances(host.cfg),
      idleTimeoutMinutes: localVmIdleTimeoutMinutes(host.cfg)
    },
    features: {
      skillAuthoring: skillAuthoringEnabled(host.cfg),
      skillReview: skillReviewEnabled(host.cfg),
      skillReviewSteps: skillReviewSteps(host.cfg),
      skillsLibrary: skillsLibraryEnabled(host.cfg),
      showToolCalls: showToolCallsEnabled(host.cfg),
      routinesInConversation: routinesInConversationEnabled(host.cfg),
      templates: templatesEnabled(host.cfg),
      vpsComputer: vpsComputerEnabled(host.cfg),
      boatComputer: boatComputerEnabled(host.cfg),
      decisionModel: decisionModelEnabled(host.cfg),
      dataWindow: dataWindowEnabled(host.cfg),
      meetingNotetaker: meetingNotetakerEnabled(host.cfg),
      routineGroupSettings: routineGroupSettingsEnabled(host.cfg),
      browser: builtInBrowserEnabled(host.cfg),
      connectedApps: host.cfg.features?.connectedApps === true,
      // Maintainer-only escape hatch, not a Settings toggle: the desktop
      // shell and the Settings UI read it so they offer nothing this server
      // would refuse.
      sharedComputers: sharedComputersEnabled(host.cfg),
      // Capabilities > Installed switch: Claude bots also see this machine's
      // own Claude Code MCP servers
      claudeUserMcp: claudeUserMcpEnabled(host.cfg, host.IDENTITY.kind === "perspicax"),
      // Off unless true: personal Claude Code skills via --add-dir
      claudeUserSkills: claudeUserSkillsEnabled(host.cfg),
      autoRecall: autoRecallEnabled(host.cfg),
      roomMemoryCapture: roomMemoryCaptureEnabled(host.cfg),
      // hand-edited config.json only; the thread menu offers Regenerate title from it
      llmThreadTitles: llmThreadTitlesEnabled(host.cfg),
      savedSteps: savedStepsEnabled(host.cfg),
      savedStepsHere: host.savedSteps.here(),
      // not a setting: Teach a task and /learn are offered (shared/teach-task.ts,
      // #4209), read by the phone app, which cannot import the switch
      teachTask: TEACH_TASK_OFFERED
    },
    ...(() => {
      const guard = loopGuardSettings(host.cfg);
      return {
        loopGuard: {
          enabled: guard.enabled,
          steerAt: guard.steerAt,
          ...(guard.stopAt === undefined ? {} : { stopAt: guard.stopAt }),
          correctiveRounds: correctiveRounds(host.cfg)
        }
      };
    })(),
    // first-run progress — not a secret; the app decides whether to show
    // the welcome tour from this, never from browser storage
    onboarding: {
      completedAt: host.cfg.onboarding?.completedAt ?? "",
      version: host.cfg.onboarding?.version ?? 0,
      reelSeen: host.cfg.onboarding?.reelSeen === true,
      hintsSeen: host.cfg.onboarding?.hintsSeen ?? [],
      ...(host.cfg.onboarding?.launchMode ? { launchMode: host.cfg.onboarding.launchMode } : {}),
      ...(host.cfg.onboarding?.firstTurnAt ? { firstTurnAt: host.cfg.onboarding.firstTurnAt } : {})
    },
    // Which browser this server can give bots: the desktop app's surface,
    // the agent-browser engine, or nothing yet (with the reason).
    browserEngine: host.browserEngineSummary(),
    // partitionId is non-secret routing metadata. The renderer needs it to
    // show the same durable session as an agent, but config PATCH validation
    // keeps it read-only and rejects callers that try to choose it.
    browserProfiles: host.cfg.browserProfiles ?? [],
    // who may sign in with an emailed code (server/auth/account-signin.ts); a
    // solo server's only: an organization server's people are in Perspicax
    ...(host.IDENTITY.kind === "perspicax" ? {} : { signIn: { admins: host.cfg.signIn?.admins ?? [], members: host.cfg.signIn?.members ?? [] } }),
    // whether that list decides anything here, or the organisation's Admin does
    membership: workspaceMembership(),
    // organization server: the model providers its admin allows (null: all)
    ...(host.IDENTITY.kind === "perspicax" ? { allowedEngines: host.orgAllowedEngines(), ownAccountsOutsideList: host.orgOwnAccountsOutsideList() } : {}),
    // 2026-10-30 (lot 2): the models the organization turned off; on a solo
    // server, the installation's own switches (a person's own come with configForPerson)
    ...(host.IDENTITY.kind === "perspicax" ? { disabledModels: host.orgDisabledModels() } : { myDisabledModels: host.personDisabledModels(null) }),
    // organization server: new threads start confidential (server/threads/confidential-threads.ts)
    ...(host.IDENTITY.kind === "perspicax" ? { confidentialThreadsByDefault: host.confidentialThreadsByDefault() } : {})
  };
}
  return configStatus;
}
