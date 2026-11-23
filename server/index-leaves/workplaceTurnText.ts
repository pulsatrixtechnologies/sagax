// @ts-nocheck
/** workplaceTurnText (#1388). Pure move from server/index.ts. */
import { stageMissingImages } from "../attachments/attachment-staging.ts";
export type Host = Record<string, any>;

export function createWorkplaceTurnText(getHost: () => Host): any {
function workplaceTurnText(text: string, decision: WorkplaceDecision, source?: string): { text: string; staging: TurnWorkplace["staging"]; annotated: boolean } {
  const host = getHost();
  const { ATTACHMENTS_DIR, isArchiveAttachment, soloArchiveText } = host;
  if (host.IDENTITY.kind !== "perspicax") return { ...soloArchiveText(text), staging: null };
  const person = decision.principal;
  const own = (file: { file: string }) => person && host.attachmentIsTheirs(person, host.attachmentReferences(file.file));
  const files = host.attachedFilesInText(text, ATTACHMENTS_DIR).filter(own);
  const desktop = decision.target === "user-desktop" ? host.desktopBridges.current(person) : null;
  const target: StagingTarget | null = desktop
    ? { kind: "user-desktop", attachmentsDir: desktop.attachmentsDir, platform: desktop.platform }
    : decision.target === "user-sandbox" ? { kind: "user-sandbox" } : null;
  let annotated = false;
  // An archive also gets its manifest, and the folder it is unpacked into
  // next to its copy at the first tool call (server/attachments/attachment-archives.ts).
  const staged = files.length
    ? host.stageTurnAttachments(text, files, target, (file, where) => {
      if (!isArchiveAttachment(file.file)) return null;
      annotated = true;
      const folder = where ? where.slice(0, where.length - host.stagedName(file).length) + host.extractedFolderName(host.stagedName(file)) : null;
      return host.archiveNote({ name: file.name, manifest: host.storedArchiveManifest(file.file), extractedPath: folder, when: "first-tool", texts: host.archiveInlineTexts(file.serverPath) });
    })
    : { text, staged: [] };
  // #5134: a picture sent as vision is lifted out of the provider text.
  // The original message still names it, and it is copied like any file.
  const images = stageMissingImages(text, source, ATTACHMENTS_DIR, target, staged.staged);
  const combined = images.text ? `${staged.text.replace(/\s+$/, "")}\n\n${images.text}` : staged.text;
  const copied = images.staged.length ? [...staged.staged, ...images.staged] : staged.staged;
  if (!copied.length && !annotated) return { text: combined, staging: null, annotated: false };
  return { text: combined, staging: target && copied.length ? { target, files: copied } : null, annotated };

}
  return workplaceTurnText;
}
