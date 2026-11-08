// @ts-nocheck
/** previewSystemPrompt (#1388). Pure move from server/index.ts. */
import { botCreationOffered } from "../bots/bot-creation.ts";
import { recordedBotOwner } from "../bots/bot-owner.ts";
import { BUILT_IN_BROWSER_SYSTEM_PROMPT } from "../browser/browser-engine.ts";
import { chiefOfStaffSystemPrompt } from "../chief-of-staff.ts";
import { localVmMode, builtInBrowserEnabled, skillAuthoringEnabled } from "../config.ts";
import { onDemandPromptParts, promptReferencesAvailable } from "../context/prompt-references.ts";
import { finishUntilPrompt } from "../finish-until.ts";
import { reachablePeers, peerRosterSystemPrompt } from "../peers/peer-roster.ts";
import { sectionContextSystemPrompt } from "../rooms/section-context.ts";
import { hideServerPathsInSections } from "../server-path-prompt.ts";
import { setupSystemPrompt, setupModeActive } from "../setup-mode.ts";
import { skillDiscoveryAvailable } from "../skills/skill-discovery.ts";
import { resolveSurface, surfacePrompt } from "../surface.ts";
import { resolveComputerPromptKind, userProfileSystemPrompt, longCommandsPrompt, computerPrompt, customMcpPrompt, CREDENTIAL_PROMPT, REACTION_PROMPT, MEME_PROMPT, IMAGE_PROMPT, FEEDBACK_PROMPT, ROUTINE_PROMPT, richOutputPrompt, TEAM_MEMORY_PROMPT, teamAvailabilityPart, buildSystemPrompt, CLAUDE_REUSE_VOLATILE_SECTIONS } from "../system-prompt.ts";
import { rulesSystemPrompt, docsIndexPrompt } from "../workspace/workspace-files.ts";
import { supportsWorkspaceFiles, WITHHELD_HOST_TOOLS_PROMPT } from "../workspace/workspace.ts";
export type Host = Record<string, any>;

export function createPreviewSystemPrompt(getHost: () => Host): any {
function previewSystemPrompt(bot: BotRecord, principal?: string) {
  const host = getHost();
  // `cfg` is the module-level config (`const cfg = loadConfig()` near the
  // top of index.ts), the same object the turn code reads.
  const persona = [
    `You are ${bot.name}, a personal bot in Sagax.`,
    bot.title && `Role: ${bot.title}.`,
    bot.description && `About: ${bot.description}`,
  ]
    .filter(Boolean)
    .join(" ");
  const instance = host.registry.get(bot.modelSelection.instanceId);
  const caps = instance?.adapter.capabilities;
  const teamComputer = host.IDENTITY.kind === "perspicax" ? undefined : host.inheritedTeamComputer(bot);
  const previewComputer = teamComputer ? "cloud" : bot.computer;
  const computerPromptKind = resolveComputerPromptKind({
    kind: previewComputer === "vm" ? "vm" : previewComputer === "cloud"
      ? (host.IDENTITY.kind === "perspicax" ? null : bot.cloudBackend === "vps" ? "vps" : "box") : previewComputer === "local" ? "local" : null,
    vmPrivate: localVmMode(host.cfg) === "per-bot"
  });
  const peers = reachablePeers(host.store.bots, bot);
  const coordination = bot.chiefOfStaff
    ? chiefOfStaffSystemPrompt(bot.id, host.store.bots, true)
    : peers.length > 0
      ? peerRosterSystemPrompt(peers, true, botCreationOffered(bot, host.ownerBotsReadOnly(bot)), host.sameOwnerRosterMember(bot))
      : "";
  // Same gate a real turn applies: the block only goes to a bot whose
  // engine actually mounts agent tools, since it names propose_profile,
  // propose_routine and request_credential.
  const agentsMounted = caps?.agentsMcp === true;
  // The preview asks the same question a dispatch asks, through the same
  // policy, so "what the model sees" cannot drift from what a turn sends.
  // Spelling the browser rule out a second time here is what let Off keep a
  // browser in one place while the preview said it had none.
  const previewPlan = resolveSurface({
    destination: previewComputer,
    browserOn: caps?.browserMcp === true && builtInBrowserEnabled(host.cfg) && bot.browser !== false
  });
  const privateWorkspace = instance && supportsWorkspaceFiles(instance.driverKind);
  const previewParts = [
    { id: "finish-until", label: "Do not finish until", text: finishUntilPrompt(bot.finishUntil) },
    { id: "user-profile", label: "About the user", text: userProfileSystemPrompt(host.botUserProfile(bot)) },
    {
      id: "setup",
      label: "Setup",
      text: setupSystemPrompt(agentsMounted && setupModeActive({ soul: bot.soul, description: bot.description, text: "" }), {
        skills: host.personalFeatureOn("skillAuthoring", skillAuthoringEnabled(host.cfg), recordedBotOwner(bot)),
        cwd: bot.cwd
      })
    },
    { id: "shell", label: "Long-running commands", text: privateWorkspace ? longCommandsPrompt(computerPromptKind) : "" },
    { id: "computer", label: "Computer", text: computerPrompt(computerPromptKind) },
    { id: "team-computer", label: "Team computer", text: host.teamComputerPrompt(teamComputer) },
    // Auto cannot know its place until dispatch, so the preview stays silent
    // there and only carries the note; explicit settings preview the paragraph.
    { id: "plan", label: "Surface", text: previewPlan.computer === undefined ? "" : surfacePrompt({
      computer: previewPlan.computer && previewPlan.computer !== "off" && computerPromptKind ? previewPlan.computer : null,
      browser: previewPlan.computer === undefined ? false : previewPlan.browser
    }, { note: previewPlan.note, cloudHome: false }) },
    { id: "cloud-home", label: "OMB Cloud", text: "" },
    { id: "mcp", label: "MCP servers", text: caps?.customMcp ? customMcpPrompt(Object.keys(host.engineMcpServers(bot)), host.mcpServersHost.off(bot)) : "" },
    { id: "browser", label: "Browser", text: previewPlan.browser ? BUILT_IN_BROWSER_SYSTEM_PROMPT : "" },
    { id: "coordination", label: "Team", text: agentsMounted && coordination ? ` ${coordination}` : "" },
    { id: "credential", label: "Credentials", text: agentsMounted ? CREDENTIAL_PROMPT : "" },
    { id: "reactions", label: "Reactions", text: agentsMounted ? REACTION_PROMPT : "" },
    { id: "memes", label: "Memes", text: agentsMounted && bot.memeReplies !== "off" ? MEME_PROMPT : "" },
    { id: "images", label: "Images", text: agentsMounted ? IMAGE_PROMPT : "" },
    { id: "feedback", label: "Feedback", text: agentsMounted && bot.systemBot !== "feedback" ? FEEDBACK_PROMPT : "" },
    { id: "routine", label: "Routines", text: agentsMounted ? ROUTINE_PROMPT : "" },
    { id: "profile", label: "Profile changes", text: agentsMounted ? host.botProfilePrompt(bot) : "" },
    { id: "rich-output", label: "Rich output", text: richOutputPrompt(bot.emailDrafts !== false) },
    { id: "section-context", label: "Section context", text: (() => { const team = host.teamStorageForBot(bot); return sectionContextSystemPrompt(team.key, team.label); })() },
    { id: "team-memory", label: "Team memory", text: (() => { const team = host.teamStorageForBot(bot); return host.teamMemory.systemPrompt(team.key, team.label) + (agentsMounted ? TEAM_MEMORY_PROMPT : ""); })() },
    teamAvailabilityPart(agentsMounted && coordination ? peers : []),
    { id: "rules", label: "Rules (RULES.md)", text: rulesSystemPrompt(bot.id, { writes: agentsMounted }) },
    { id: "memory", label: "Memory", text: host.memoryPromptFor(bot, { managedWrites: agentsMounted, fileTools: Boolean(privateWorkspace), withholdHostTools: Boolean(instance && host.withholdHostToolsFor(instance)) }) },
    { id: "host-tools", label: "Host tools", text: instance && host.withholdHostToolsFor(instance) ? WITHHELD_HOST_TOOLS_PROMPT : "" },
    { id: "docs", label: "Documents index", text: docsIndexPrompt(bot.id, { tools: agentsMounted ? "agents" : privateWorkspace ? "files" : "none" }) },
    { id: "skills", label: "Skills index", text: host.scopedSkillsPrompt(bot, instance, principal, { managedTools: skillDiscoveryAvailable(agentsMounted, bot.toolScope), fileAccess: Boolean(privateWorkspace) })?.text ?? "" },
  ];
  // 2026-11-02: the preview names no server path where the turn would not
  // (server/server-path-prompt.ts)
  const previewHidden = instance && host.withholdHostToolsFor(instance) ? hideServerPathsInSections(previewParts, host.serverPathView(bot.id)).sections : previewParts;
  const built = buildSystemPrompt(persona, bot.soul ?? "", onDemandPromptParts(previewHidden, promptReferencesAvailable(agentsMounted, bot.toolScope)), instance?.driverKind === "claudeAgent" ? CLAUDE_REUSE_VOLATILE_SECTIONS : undefined);
  const totalBytes = built.sections.reduce((n, s) => n + s.bytes, 0);
  return {
    sections: built.sections,
    totalBytes,
    approxTokens: Math.ceil(totalBytes / 4),
    note:
      "Preview from current bot settings, not the exact prompt of a running task. Task folders, notes, recall, selected skills and available connections can change the dispatched prompt. Token count is an estimate."
  };
}
  return previewSystemPrompt;
}
