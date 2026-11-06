// @ts-nocheck
/** scopedSkillsPrompt (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createScopedSkillsPrompt(getHost: () => Host): any {
function scopedSkillsPrompt(bot: BotRecord, instance: { driverKind: string } | null | undefined, principal: string | undefined, options: { managedTools: boolean; fileAccess: boolean; syncNative?: boolean; nativeWorkspace?: string; indexOnly?: boolean }) {
  const host = getHost();
  const { DATA_DIR, resolvedSkillFiles, skillsLibraryEnabled, workspaceDir } = host;
  const kind = instance?.driverKind ?? "";
  const names = new Set(host.personalSkillInputs(bot, principal).filter((skill) => skill.enabled && !skill.shadowed).map((skill) => skill.name));
  if (options.syncNative) syncSkillLinks(bot.id, { excludeNames: names });
  // A file engine needs its files or the managed tools (paths to read). An
  // engine without files receives an index when skills_list/workspace_read
  // are available. Without that retrieval route it receives whole files
  // within the per-capability budget. Native Claude plugins remain native.
  const person = host.IDENTITY.kind === "perspicax" ? principal ?? host.effectiveBotOwner(bot) : host.localPrincipalId();
  // Incident 2026-11-03: a Perspicax bot whose turn gets no Flow folder is
  // told where the Flow skills are (server/org/org-flow-plugins.ts).
  const flowNote = host.IDENTITY.kind === "perspicax" ? host.flowSkillsNote({
    declaration: host.perspicaxDirectory?.flowPlugins(),
    loadedDirs: host.orgFlowPlugins.dirsFor(person, []),
    member: Boolean(person) && host.orgMemberActive(person),
  }) : "";
  if (!instance || !(options.managedTools || !host.engineWorksInFiles(kind) || options.fileAccess)) {
    return flowNote ? { text: flowNote, byCapability: {}, index: { bytes: Buffer.byteLength(flowNote, "utf8"), maxBytes: 0, skills: 0, maxSkills: 0, omitted: 0, parts: { skills: 0, commands: 0, agents: 0 } } } : undefined;
  }
  const inventory = host.scopedSkillInventory(bot, instance, principal);
  const plugins = host.scopedPluginFolders(bot, person);
  const personalRoot = skillsLibraryEnabled(host.cfg) && person ? host.personalSkills.root(person) : undefined;
  const assigned = skillsLibraryEnabled(host.cfg) ? (host.store.bot(bot.id)?.assignedSkills ?? bot.assignedSkills) : undefined;
  if (options.syncNative && options.nativeWorkspace && host.engineWorksInFiles(kind)) {
    host.prepareTurnSkillLinks({ driverKind: kind, workspace: options.nativeWorkspace,
      stateRoot: join(DATA_DIR, "skill-state", bot.id, "turn-links"), rows: inventory.rows, plugins, personalRoot,
      skills: resolvedSkillFiles(bot.id, assigned).flatMap((skill) => skill.file ? [{ name: skill.name, file: skill.file }] : []),
    });
  }
  let library: Array<{ name: string; file: string }> | undefined;
  const read = (row: DiscoveredSkill): string | null => {
    if (!row.path) return null;
    try {
      library ??= resolvedSkillFiles(bot.id, assigned).flatMap((skill) => skill.file && relative(workspaceDir(bot.id), skill.file).startsWith(".." + sep) ? [{ name: skill.name, file: skill.file }] : []);
      const file = host.readWorkspaceText(bot.id, row.path, 0, plugins, personalRoot, library);
      // A file larger than one read is never cut: it is omitted whole.
      return file.nextOffset === null ? file.text : null;
    } catch { return null; }
  };
  const prompt = host.capabilityPrompt(kind, host.capabilityPromptGroups(kind, inventory.rows, { managedTools: options.managedTools, read }),
    { managedTools: options.managedTools, incomplete: inventory.incomplete && kind !== "claudeAgent", indexOnly: options.indexOnly === true });
  return flowNote ? { ...prompt, text: prompt.text + flowNote } : prompt;

}
  return scopedSkillsPrompt;
}
