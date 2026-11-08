// @ts-nocheck
/** withWorkplaceNote (#1388). Pure move from server/index.ts. */
import { botFolderNote } from "../sandbox/sandbox-bot-folder.ts";
import { DATA_DIR } from "../config.ts";
export type Host = Record<string, any>;

export function createWithWorkplaceNote(getHost: () => Host): any {
function withWorkplaceNote(text: string, decision: WorkplaceDecision, auto?: AutoComputerState | null, botId?: string, threadId?: string) {
  const host = getHost();

  // 2026-11-02: the bot's own folder of the server environment, whenever
  // its tools may run there (server/sandbox/sandbox-bot-folder.ts).
  const folder = botId && host.userSandbox && (decision.target === "user-sandbox" || (auto?.auto && auto.sandboxConfigured)) ? host.sandboxBotFolder(botId) : null;
  // 2026-11-02: and that the engine's own folder on the server is not it
  const withFolder = (out: string) => folder ? `${out}\n\n<workplace>${botFolderNote(folder, DATA_DIR, threadId)}</workplace>` : out;
  return withFolder(host.workplaceNoteText(text, decision, auto));

}
  return withWorkplaceNote;
}
