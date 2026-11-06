// @ts-nocheck
/** memberHostToolPlace (#1388). Pure move from server/index.ts. */
import { join } from "node:path";
import { realpathSync } from "node:fs";
export type Host = Record<string, any>;

export function createMemberHostToolPlace(getHost: () => Host): any {
function memberHostToolPlace(bot: BotRecord, threadId: string) {
  const host = getHost();
  const { DATA_DIR, localVmMode, workspaceDir } = host;
  const speaker = host.turnSpeakerPrincipals.get(threadId)?.trim().toLowerCase() ?? "";
  const speakerOwns = host.IDENTITY.kind === "perspicax" && Boolean(speaker) && !host.turnRoutineLineage.has(threadId)
    && speaker === host.effectiveBotOwner(bot).trim().toLowerCase();
  return {
    ownLocalVm: localVmMode(host.cfg) === "per-bot",
    ownComputers: speakerOwns,
    ownMcpList: speakerOwns,
    botRoots: [join(realpathSync(DATA_DIR), "task-workspaces", bot.id), workspaceDir(bot.id)]
  };

}
  return memberHostToolPlace;
}
