// @ts-nocheck
/** updateInstallationPlugin (#1388). Pure move from server/index.ts. */
import { planServerUpdate } from "../plugins/plugin-marketplaces.ts";
import { updateLibrarySkill } from "../skills/skill-library.ts";
export type Host = Record<string, any>;

export function createUpdateInstallationPlugin(getHost: () => Host): any {
async function updateInstallationPlugin(marketplace: string, plugin: string, { auth }: { auth: RequestAuth }) {
  const host = getHost();
  const { cfg, installLibrarySkill, parseStoredMcpServer, readSkillLibraryIndex, removeLibrarySkillFrom, scanSkillText, sessionPrincipal } = host;
    const installed = host.pluginMarketplaces.installed().find((entry) => entry.key === `${plugin}@${marketplace}`);
    if (!installed) return { status: 404, body: { error: "That plugin is not installed.", code: "not_installed" } };
    if (host.mcpConfigBusy) return { status: 409, body: { error: "MCP servers are already being updated." } };
    const { plan, version, revision } = await host.pluginMarketplaces.prepare(marketplace, plugin, sessionPrincipal(auth) ?? undefined, host.marketplaceViewer(auth));
    const skipped = [...plan.skipped];
    const changes = planServerUpdate(plan, installed);
    const serverNames: Record<string, string> = {};
    const forget: string[] = [];
    const added: string[] = [];
    if (host.mcpConfigBusy) return { status: 409, body: { error: "MCP servers are already being updated." } };
    host.mcpConfigBusy = true;
    try {
      const current = { ...cfg.mcpServers };
      const fresh: Array<{ name: string; entry: Record<string, unknown> }> = [...changes.add];
      for (const server of changes.keep) {
        const existing = current[server.stored] === undefined ? null : parseStoredMcpServer(server.stored, current[server.stored]);
        // Removed or replaced by hand since: added again like a new server.
        if (!existing?.ok || existing.server.source !== marketplace) {
          fresh.push({ name: server.name, entry: server.entry });
          continue;
        }
        const kept = host.updatedMarketplaceServer(server.stored, existing.server, server.entry, marketplace, skipped);
        if (!kept) {
          serverNames[server.name] = server.stored;
          continue;
        }
        if ("url" in kept && "url" in existing.server && kept.url !== existing.server.url) forget.push(server.stored);
        current[server.stored] = kept;
        serverNames[server.name] = server.stored;
      }
      for (const name of changes.remove) {
        const parsed = current[name] === undefined ? null : parseStoredMcpServer(name, current[name]);
        if (parsed?.ok && parsed.server.source === marketplace) {
          delete current[name];
          forget.push(name);
        }
      }
      const addedNames = host.addMarketplaceServers(current, fresh, marketplace, plugin, skipped);
      Object.assign(serverNames, addedNames);
      added.push(...Object.values(addedNames));
      host.persistMcpServers(current);
    } finally {
      host.mcpConfigBusy = false;
    }
    for (const name of [...forget, ...added]) await host.mcpOAuth.forget(name).catch(() => undefined);
    if (added.length) await host.probeMcpOAuth(added);
    const skills: string[] = [];
    const library = readSkillLibraryIndex();
    for (const skill of plan.skills) {
      const warnings = scanSkillText(skill.text);
      const existing = library[skill.name];
      const result = existing && existing.source === marketplace && installed.skills.includes(skill.name)
        // The text changes in place; whether it is on stays the person's.
        ? updateLibrarySkill(skill.name, { text: skill.text, warnings })
        : installLibrarySkill({ name: skill.name, instructions: skill.text, source: marketplace, warnings, reviewState: "disabled" });
      if ("error" in result) skipped.push(`skill ${skill.name} (${result.error})`);
      else skills.push(skill.name);
    }
    for (const name of installed.skills) {
      if (!plan.skills.some((skill) => skill.name === name)) removeLibrarySkillFrom(name, marketplace);
    }
    const record = await host.pluginMarketplaces.recordUpdate(marketplace, plugin, {
      ...(version ? { version } : {}), ...(revision ? { revision } : {}),
      servers: Object.values(serverNames), serverNames, skills
    });
    host.installationPlugins.refresh(record);
    return { status: 200, body: { plugin: record, skipped, servers: host.mcpServerResponse(host.mcpViewer(auth)).servers } };

}
  return updateInstallationPlugin;
}
