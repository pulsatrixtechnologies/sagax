// @ts-nocheck
/** packageImportDeps (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPackageImportDeps(getHost: () => Host): any {
function packageImportDeps(selection: ModelSelection) {
  const host = getHost();
  const { installOrgSkill, installSkill, setSkillEnabled, writeSectionContext } = host;
  return {
    store: host.store,
    routines: host.routines!,
    skills: { install: installSkill, setEnabled: setSkillEnabled, installOrg: installOrgSkill },
    memory: { writeIndex: host.writeMemoryFile, writeTopic: host.writeMemoryTopic },
    mcp: { servers: () => host.cfg.mcpServers ?? {}, refusal: host.mcpPolicyRefusal, persist: host.persistMcpServers },
    sections: { writeBrief: (section, text) => void writeSectionContext(section, text) },
    images: {
      save: (bytes, mime) => {
        const avatarUrl = host.botAvatarUrlFromStoredPath(saveImage(Buffer.from(bytes), mime).path);
        if (!avatarUrl) throw new Error("A picture in this package could not be stored");
        return avatarUrl;
      }
    },
    defaultSelection: () => selection,
    presets: host.presetStore
  };

}
  return packageImportDeps;
}
