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
      if (target.kind === "user-sandbox" && host.userSandbox) {
        const path = `${SANDBOX_ATTACHMENTS_DIR}/${host.stagedName(file)}`;
        // Linux keeps each environment string under 128 KiB: chunks of 48 KiB
        // (a multiple of 3, so their base64 pieces concatenate), up to 8 per
        // call so an archive of tens of MB does not take thousands of calls.
        const group: { data: Buffer; offset: number; final: boolean }[] = [];
        for await (const chunk of host.attachmentChunks(file, 48 * 1024)) {
          group.push(chunk);
          if (group.length < 8 && !chunk.final) continue;
          const names = group.map((_, index) => `SAGAX_CONTENT_B64_${index}`);
          const pieces = names.map((name) => `"$${name}"`).join(" ");
          const env: Record<string, string> = { SAGAX_PATH: path };
          group.forEach((chunk, index) => { env[names[index]!] = chunk.data.toString("base64"); });
          const result = await host.userSandbox.exec(person, {
            argv: ["sh", "-c", group[0]!.offset === 0
              ? `mkdir -p -- "$(dirname -- "$SAGAX_PATH")" && printf %s ${pieces} | base64 -d > "$SAGAX_PATH"`
              : `printf %s ${pieces} | base64 -d >> "$SAGAX_PATH"`],
            env,
            timeoutSec: 30
          }, workplace.botId);
          if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "copy failed");
          group.length = 0;
        }
        const argv = isArchiveAttachment(file.file) && host.storedArchiveManifest(file.file)?.status === "ok"
          ? host.sandboxArchiveArgv(path, `${SANDBOX_ATTACHMENTS_DIR}/${host.extractedFolderName(host.stagedName(file))}`)
          : null;
        if (argv) {
          const result = await host.userSandbox.exec(person, { argv, timeoutSec: 300 }, workplace.botId);
          const outcome = host.parseArchiveOutcome(result.stdout);
          if (result.exitCode !== 0 || !outcome?.extracted) throw new Error(`unpack failed: ${outcome?.reason ?? (result.stderr.trim().slice(0, 200) || "no result")}`);
        }
      } else if (target.kind === "user-desktop") {
        const active = () => host.activeInternalGenerationByThread.get(threadId) === generation;
        for await (const chunk of host.attachmentChunks(file, 512 * 1024)) {
          const result = await host.desktopBridges.request(person, {
            action: "stage_file", name: host.stagedName(file), content: chunk.data.toString("base64"), encoding: "base64", offset: chunk.offset, final: chunk.final
          }, active) as { isError?: boolean; content?: { text?: string }[] } | null;
          if (result?.isError) throw new Error(result.content?.[0]?.text ?? "copy failed");
        }
        if (isArchiveAttachment(file.file) && host.storedArchiveManifest(file.file)?.status === "ok") {
          // The desktop app unpacks it next to its copy with the same rules
          // (electron/archive-extract.mjs); an older app answers that it does
          // not know the action, and the bot was told to unpack it then.
          const result = await host.desktopBridges.request(person, { action: "extract_archive", name: host.stagedName(file), timeout_seconds: 300 }, active) as { isError?: boolean; content?: { text?: string }[] } | null;
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
