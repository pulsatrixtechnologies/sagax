// @ts-nocheck
/** scopedSkillInventory (#1388). Pure move from server/index.ts. */
import { join, relative, sep } from "node:path";
import { skillsLibraryEnabled } from "../config.ts";
export type Host = Record<string, any>;

export function createScopedSkillInventory(getHost: () => Host): any {
function scopedSkillInventory(bot: BotRecord, instance: { driverKind: string } | null | undefined, principal?: string): { rows: DiscoveredSkill[]; incomplete: boolean } {
  const host = getHost();
  const { DATA_DIR } = host;

  const person = host.IDENTITY.kind === "perspicax" ? principal ?? host.effectiveBotOwner(bot) : host.localPrincipalId();
  const personal = person ? host.personalSkillInputs(bot, person).filter((skill) => !skill.shadowed) : [];
  const personalNames = new Set(personal.filter((skill) => skill.enabled).map((skill) => skill.name));
  const assigned = skillsLibraryEnabled(host.cfg) ? (host.store.bot(bot.id)?.assignedSkills ?? bot.assignedSkills) : undefined;
  const rows: DiscoveredSkill[] = host.resolvedSkillFiles(bot.id, assigned).filter((skill) => !personalNames.has(skill.name)).map((skill) => {
    const file = skill.file;
    const local = file ? relative(host.workspaceDir(bot.id), file) : "";
    const library = Boolean(file && (local === ".." || local.startsWith(".." + sep)));
    const scope = skill.source.startsWith("org:") ? "organization" : library ? "library" : "bot";
    return { id: `${scope}:skill:${skill.name}`, name: skill.name, kind: "skill", scope,
      source: scope, enabled: skill.enabled && Boolean(file), editable: skill.editable,
      capability: { key: `skill:${scope === "library" ? "installation" : scope}:${skill.name}`, name: skill.name },
      ...(skill.enabled && file ? { description: skill.description, ...(host.IDENTITY.kind !== "perspicax" ? { filePath: file } : {}), path: library ? `skill-library/${skill.name}/SKILL.md` : local.split(sep).join("/") } : {}) };
  });
  for (const skill of personal) rows.push({ id: `person:skill:${skill.name}`, name: skill.name, kind: "skill", scope: "person", source: "Me",
    enabled: skill.enabled, capability: { key: `skill:me:${skill.name}`, name: skill.name },
    ...(skill.enabled ? { description: skill.description, filePath: join(host.IDENTITY.kind === "perspicax" ? "/workspace/sagax-capability-skills/me" : host.personalSkills.root(person), "skills", skill.name, "SKILL.md"), path: `capability-skills/me/skills/${skill.name}/SKILL.md` } : {}) });
  if (instance) {
    // Every selected plugin folder reaches every engine, the organization's
    // Flow included (lot 3): Claude natively, the others through the prompt
    // per capability and managed aliases when skills_list/workspace_read are
    // mounted.
    const folders = host.scopedPluginFolders(bot, person);
    const byDir = new Map(folders.map((folder) => [folder.dir, folder]));
    const byName = new Map(folders.map((folder) => [folder.name, folder]));
    const capabilities = new Map(folders.map((folder) => [folder.dir, host.pluginFolderCapability(bot, person, folder)]));
    const inventory = host.pluginTurnInventory(folders.map((plugin) => plugin.dir), {
      pathForDir: (dir) => `plugins/${byDir.get(dir)!.name}`,
      cacheRoot: host.pluginMetadataCacheRoot(DATA_DIR)
    });
    for (const file of inventory.files) {
      const plugin = byName.get(file.path.split("/")[1]!)!;
      const capability = capabilities.get(plugin.dir);
      rows.push({ id: `${plugin.scope}:plugin:${plugin.name}:${file.kind}:${file.path}`, name: file.name, kind: file.kind,
        scope: plugin.scope, source: plugin.name, enabled: true, description: file.description, path: file.path, filePath: host.IDENTITY.kind === "perspicax" ? file.path.replace(/^plugins\//, "/workspace/sagax-plugins/") : join(plugin.dir, ...file.path.split("/").slice(2)),
        ...(capability ? { capability } : {}),
        ...(instance.driverKind === "claudeAgent" ? { native: true } : {}) });
    }
    return { rows: host.orderedSkillDiscovery(rows), incomplete: inventory.truncated || inventory.unreadable > 0 };
  }
  return { rows: host.orderedSkillDiscovery(rows), incomplete: false };

}
  return scopedSkillInventory;
}
