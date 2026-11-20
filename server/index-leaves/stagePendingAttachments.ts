// @ts-nocheck
/** stagePendingAttachments (#1388). Pure move from server/index.ts. */
import { SANDBOX_ATTACHMENTS_DIR } from "../attachments/attachment-staging.ts";
export type Host = Record<string, any>;

export function createStagePendingAttachments(getHost: () => Host): any {
async function stagePendingAttachments(threadId: string, generation: string) {
  const host = getHost();
  const { isArchiveAttachment } = host;

  const workplace = host.turnWorkplaces.get(threadId);
  if (!workplace?.staging || workplace.generation !== generation || !workplace.decision.principal) return;
  const { target, files } = workplace.staging;
  workplace.staging = null;
  const person = workplace.decision.principal;
  for (const file of files) {
    try {
      // #5138: the one copy into a person's place (index-leaves/personPlaces.ts)
      if (target.kind === "user-sandbox" && !host.userSandbox) continue;
      const path = await host.personPlaces.copyToPersonPlace({
        person, botId: workplace.botId, threadId, generation, target, name: host.stagedName(file),
        chunks: (size: number) => host.attachmentChunks(file, size)
      });
      if (isArchiveAttachment(file.file) && host.storedArchiveManifest(file.file)?.status === "ok") {
        if (target.kind === "user-sandbox") {
          const argv = host.sandboxArchiveArgv(path, `${SANDBOX_ATTACHMENTS_DIR}/${host.extractedFolderName(host.stagedName(file))}`);
          const result = await host.userSandbox.exec(person, { argv, timeoutSec: 300 }, workplace.botId);
          const outcome = host.parseArchiveOutcome(result.stdout);
          if (result.exitCode !== 0 || !outcome?.extracted) throw new Error(`unpack failed: ${outcome?.reason ?? (result.stderr.trim().slice(0, 200) || "no result")}`);
        } else {
          // The desktop app unpacks it next to its copy with the same rules
          // (electron/archive-extract.mjs); an older app answers that it does
          // not know the action, and the bot was told to unpack it then.
          const active = () => host.activeInternalGenerationByThread.get(threadId) === generation;
          const desktop = host.desktopBridges.current(person);
          if (!desktop) throw new Error("The computer is offline.");
          const result = await host.desktopBridges.request(person, { action: "extract_archive", name: host.stagedName(file), timeout_seconds: 300 }, active, undefined, desktop.id, { botId: workplace.botId, threadId }) as { isError?: boolean; content?: { text?: string }[] } | null;
          if (result?.isError) throw new Error(`unpack failed: ${result.content?.[0]?.text ?? "no result"}`);
        }
      }
      host.bridgeAudit.record({ person, botId: workplace.botId, threadId, target: target.kind, kind: "tool", detail: `attachment ${host.stagedName(file)}`, ok: true });
    } catch (error) {
      host.bridgeAudit.record({ person, botId: workplace.botId, threadId, target: target.kind, kind: "tool", detail: `attachment ${host.stagedName(file)}`, ok: false, error: (error as Error).message });
      console.error(`[omb-bridge] could not copy attachment ${file.file} to ${target.kind}: ${(error as Error).message}`);
    }
  }

}
  return stagePendingAttachments;
}
