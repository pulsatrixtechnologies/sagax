// @ts-nocheck
/** packageImportDeps (#1388). Pure move from server/index.ts. */
import { botAvatarUrlFromStoredPath } from "../../shared/bot-avatar.ts";
import { saveImage } from "../attachments/attachments.ts";
import { writeSectionContext } from "../rooms/section-context.ts";
import { installSkill, setSkillEnabled, installOrgSkill } from "../skills/skills.ts";
import { writeMemoryFile, writeMemoryTopic } from "../workspace/workspace.ts";
export type Host = Record<string, any>;

export function createPackageImportDeps(getHost: () => Host): any {
function packageImportDeps(selection: ModelSelection): PackageImportDeps {
  const host = getHost();
  return {
    store: host.store,
    routines: host.routines!,
    skills: { install: installSkill, setEnabled: setSkillEnabled, installOrg: installOrgSkill },
    memory: { writeIndex: writeMemoryFile, writeTopic: writeMemoryTopic },
    mcp: { servers: () => host.cfg.mcpServers ?? {}, refusal: host.mcpPolicyRefusal, persist: host.persistMcpServers },
    sections: { writeBrief: (section, text) => void writeSectionContext(section, text) },
    images: {
      save: (bytes, mime) => {
        const avatarUrl = botAvatarUrlFromStoredPath(saveImage(Buffer.from(bytes), mime).path);
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
