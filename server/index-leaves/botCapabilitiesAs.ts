// @ts-nocheck
/** botCapabilitiesAs (#1388). Pure move from server/index.ts. */
import { readPluginContents } from "../bots/bot-plugins.ts";
import { resolveBotCapabilities } from "../capabilities/capabilities.ts";
import { builtinRuntimeMissing } from "../capabilities/builtin-plugin-mounts.ts";
import { BUILTIN_PLUGINS, builtinPluginEnabled } from "../../shared/builtin-plugins.ts";
import { skillsLibraryEnabled, customMcpServers } from "../config.ts";
import { claudeAiConnectorsForTurn } from "../harness-connectors.ts";
import { parseStoredMcpServer, reservedMcpServerName, isRemoteMcpServer } from "../mcp/mcp-registry.ts";
import { guarded as orgFlowGuarded } from "../org/org-flow-plugins.ts";
import { skillDiscoveryAvailable } from "../skills/skill-discovery.ts";
import { readSkillLibraryIndex } from "../skills/skill-library.ts";
import { listBotSkillsWithOrigin, listSkills } from "../skills/skills.ts";
import { supportsWorkspaceFiles } from "../workspace/workspace.ts";
export type Host = Record<string, any>;

export function createBotCapabilitiesAs(getHost: () => Host): any {
function botCapabilitiesAs(
  bot: NonNullable<ReturnType<typeof store.bot>>,
  engineId: string | undefined,
  viewer: { principal?: string; mayChange: boolean; marketplace: MarketplaceViewer; computedFor?: { principalId: string; name: string } },
): BotCapabilitiesAnswer {
  const host = getHost();
  const instance = host.registry.get(engineId ?? bot.modelSelection.instanceId);
  if (!instance) return { ok: false, status: engineId ? 400 : 404, error: "Unknown engine.", code: "unknown_engine" };
  const organization = host.IDENTITY.kind === "perspicax";
  const principal = organization ? viewer.principal : undefined;
  const speaker: TurnSpeaker = principal ? { origin: "person", principalId: principal } : { origin: "operator" };
  const mayChange = viewer.mayChange;
  const owner = host.effectiveBotOwner(bot);
  const kind = instance.driverKind;
  const library = skillsLibraryEnabled(host.cfg);
  // what the marketplaces offer, for "update available" (names only)
  const offered = new Map<string, boolean>();
  try {
    for (const market of host.botPlugins.listMarketplaces(bot.id, viewer.marketplace)) {
      for (const plugin of market.plugins) if (plugin.updateAvailable) offered.set(`${plugin.name}@${market.name}`, true);
    }
  } catch { /* listed without updates */ }
  const workspaceOffered = new Map<string, boolean>();
  try {
    for (const market of host.pluginMarketplaces.list({ seesAll: true })) {
      for (const plugin of market.plugins) if (plugin.updateAvailable) workspaceOffered.set(`${plugin.name}@${market.name}`, true);
    }
  } catch { /* listed without updates */ }
  const installationServers: InstallationServerInput[] = Object.entries(host.cfg.mcpServers ?? {}).map(([name, raw]) => {
    const parsed = parseStoredMcpServer(name, raw);
    if (!parsed.ok) return { name, valid: reservedMcpServerName(name), enabled: false, remote: false };
    return {
      name, valid: true, enabled: parsed.server.enabled, remote: isRemoteMcpServer(parsed.server),
      ...(isRemoteMcpServer(parsed.server) ? { url: parsed.server.url } : {}),
      ...(parsed.server.source ? { source: parsed.server.source } : {})
    };
  });
  const remote = host.remoteMcpServers();
  const declaration = organization ? host.perspicaxDirectory?.flowPlugins() : undefined;
  const sub = principal ? host.perspicaxSubOf(principal) : null;
  const account = host.accountConnectorInput(bot, instance, speaker);
  const claudeRides = claudeAiConnectorsForTurn(account);
  let personal: CapabilityInputs["personal"];
  if (organization && principal) {
    let servers: Record<string, PersonalMcpServer> = {};
    try { servers = host.personConnections.servers(principal); } catch { /* unreadable: none listed */ }
    personal = {
      servers,
      github: host.personGithub(principal),
      hasEnvironment: Boolean(host.userSandbox),
      hostRefused: (url) => host.personalHostChecks.get(url)?.refused,
      signedIn: (name, server) => server.kind === "remote" && host.personOAuth(principal).status(name, host.personalRemoteSpec(server))?.auth === "connected"
    };
  }
  const prompt = host.scopedSkillsPrompt(bot, instance, principal, { managedTools: skillDiscoveryAvailable(instance.adapter.capabilities.agentsMcp === true, bot.toolScope), fileAccess: supportsWorkspaceFiles(kind) });
  const inputs: CapabilityInputs = {
    organization,
    bot: { id: bot.id, name: bot.name, ...(bot.mcpServers ? { mcpServers: bot.mcpServers } : {}), ...(bot.assignedSkills ? { assignedSkills: bot.assignedSkills } : {}) },
    engine: { instanceId: instance.instanceId, kind, label: instance.displayName ?? kind, customMcp: instance.adapter.capabilities.customMcp === true, agentsMcp: skillDiscoveryAvailable(instance.adapter.capabilities.agentsMcp === true, bot.toolScope) },
    botPlugins: host.botPlugins.listPlugins(bot.id).map((plugin) => {
      const folder = host.botPlugins.installedFolder(bot.id, plugin);
      let contents: PluginContents = { skills: [], commands: [], agents: [] };
      try { if (folder.present) contents = readPluginContents(folder.dir); } catch { /* listed without its contents */ }
      return {
        key: plugin.key, name: plugin.name, marketplace: plugin.marketplace, enabled: plugin.enabled, declaredMcpServers: plugin.declaredMcpServers,
        dir: folder.dir, present: folder.present, contents,
        ...(plugin.description ? { description: plugin.description } : {}),
        ...(plugin.version ? { version: plugin.version } : {}),
        ...host.readableInstaller(plugin.installedBy),
        ...(offered.get(plugin.key) ? { updateAvailable: true } : {})
      };
    }),
    botPluginDirs: host.scopedPluginFolders(bot, principal ?? owner).filter((plugin) => plugin.scope === "bot").map((plugin) => plugin.dir),
    personalSkills: library && (principal || !organization) ? host.personalSkillInputs(bot, principal) : [],
    personalPlugins: (principal || !organization ? host.personalPlugins.listPlugins(principal ?? host.localPrincipalId()) : []).map((plugin) => {
      const folder = host.personalPlugins.installedFolder(principal ?? host.localPrincipalId(), plugin);
      let contents: PluginContents = { skills: [], commands: [], agents: [] };
      try { if (folder.present) contents = readPluginContents(folder.dir); } catch { /* listed without its contents */ }
      // the stored installer is a principal id: a readable name, or nothing (#2029)
      const { installedBy: _storedInstaller, ...rest } = plugin;
      return { ...rest, ...host.readableInstaller(plugin.installedBy), dir: folder.dir, present: folder.present, contents };
    }),
    pluginMcp: principal || !organization ? host.scopedPluginMcp(bot, principal ?? host.localPrincipalId()) : [],
    pluginEnvironment: Boolean(host.userSandbox),
    builtinPlugins: BUILTIN_PLUGINS.map((plugin) => ({
      plugin, enabled: builtinPluginEnabled(bot, plugin.id),
      // an organization runs it in the person's sandbox: no desktop check
      runtimeMissing: !organization && builtinRuntimeMissing(plugin),
    })),
    pluginHostRefused: (url) => host.personalHostChecks.get(url)?.refused,
    workspacePlugins: host.pluginMarketplaces.installed().map((plugin) => ({
      key: plugin.key, name: plugin.name, marketplace: plugin.marketplace, servers: plugin.servers, skills: plugin.skills,
      ...(plugin.version ? { version: plugin.version } : {}),
      ...(workspaceOffered.get(plugin.key) ? { updateAvailable: true } : {}),
      ...(host.installationPlugins.folder(plugin.key) ? { folder: host.installationPlugins.folder(plugin.key)! } : {})
    })),
    // lot 4: the organization's declarations, for the person looking
    orgDeclarations: organization ? host.orgDeclarationInputs(principal) : [],
    orgFlow: {
      dirsFor: (own) => host.orgFlowPlugins.dirsFor(principal ?? owner, own),
      ...(declaration ? { declared: declaration.plugins } : {}),
      guarded: orgFlowGuarded(declaration),
      member: Boolean(principal) && host.orgMemberActive(principal!),
      aliases: [...host.pluginMarketplaces.installed(), ...host.personalPlugins.listPlugins(principal ?? host.localPrincipalId()), ...host.botPlugins.listPlugins(bot.id)].filter((plugin) => host.linkedFlowAlias(plugin.name, plugin.marketplace)).map((plugin) => plugin.key),
      pack: host.orgFlowPlugins.loadedPack(),
      versionOf: (name) => host.orgFlowPlugins.loadedVersion(name),
      contentsOf: (name) => { const dir = host.orgFlowPlugins.loadedDir(name); return dir ? readPluginContents(dir) : undefined; },
      dirOf: (name) => host.orgFlowPlugins.loadedDir(name)
    },
    installationServers,
    configured: customMcpServers(host.cfg, bot.mcpServers),
    filterPolicy: (servers) => host.managedPolicy.filterMcp(servers),
    githubToken: host.githubAccountToken(host.orgSpeakerPrincipal(bot, speaker)),
    serverAuth: (name) => {
      const spec = remote[name];
      return spec ? host.mcpOAuth.status(name, spec, bot.mcpAccounts?.[name])?.auth : undefined;
    },
    ...(personal ? { personal } : {}),
    skills: (() => {
      const natives = host.listNativeBotSkills(bot, bot.threadId);
      if (library) {
        return listBotSkillsWithOrigin(bot.id, bot.assignedSkills, [], undefined, natives).skills.map((skill) => ({
          name: skill.name, description: skill.description, enabled: skill.enabled, origin: skill.origin, source: skill.source,
        }));
      }
      const own = listSkills(bot.id).map((skill) => ({ name: skill.name, description: skill.description, enabled: skill.enabled, origin: "private" as const, source: skill.source }));
      const names = new Set(own.map((skill) => skill.name));
      return [...own, ...natives.filter((skill) => !names.has(skill.name)).map((skill) => ({ name: skill.name, description: skill.description, enabled: skill.enabled, origin: skill.origin, source: skill.source }))];
    })(),
    librarySkills: Object.values(readSkillLibraryIndex()).map((skill) => ({ name: skill.name, source: skill.source })),
    skillsLibrary: library,
    ...(prompt ? { promptIndex: prompt.index, capabilityPromptIndex: prompt.byCapability } : {}),
    roles: {
      catalog: organization ? (host.perspicaxDirectory?.profileCatalog() ?? []) : [],
      held: sub && host.perspicaxDirectory ? host.perspicaxDirectory.profilesOf(sub) : null
    },
    claudeAi: claudeRides ? { rides: true, ...((): { connectors?: Array<{ name: string; status: string }> } => {
      const connectors = host.claudeAiConnectorRows(account);
      return connectors ? { connectors } : {};
    })() } : { rides: false },
    grokCloud: host.grokCloudOnTurn(account, instance, bot)
  };
  return { ok: true, capabilities: resolveBotCapabilities(inputs, { ...(principal ? { principalId: principal } : {}), mayChange, ...(viewer.computedFor ? { computedFor: viewer.computedFor } : {}) }) };
}
  return botCapabilitiesAs;
}
