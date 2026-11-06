// @ts-nocheck
/** workplaceTurnText (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createWorkplaceTurnText(getHost: () => Host): any {
function workplaceTurnText(text: string, decision: WorkplaceDecision): { text: string; staging: TurnWorkplace["staging"]; annotated: boolean } {
  const host = getHost();
  const { ATTACHMENTS_DIR, isArchiveAttachment, soloArchiveText } = host;
  if (host.IDENTITY.kind !== "perspicax") return { ...soloArchiveText(text), staging: null };
  const person = decision.principal;
  const files = host.attachedFilesInText(text, ATTACHMENTS_DIR).filter((file) => person && host.attachmentIsTheirs(person, host.attachmentReferences(file.file)));
  if (!files.length) return { text, staging: null, annotated: false };
  const desktop = decision.target === "user-desktop" ? host.desktopBridges.current(person) : null;
  const target: StagingTarget | null = desktop
    ? { kind: "user-desktop", attachmentsDir: desktop.attachmentsDir, platform: desktop.platform }
    : decision.target === "user-sandbox" ? { kind: "user-sandbox" } : null;
  let annotated = false;
  // An archive also gets its manifest, and the folder it is unpacked into
  // next to its copy at the first tool call (server/attachments/attachment-archives.ts).
  const staged = host.stageTurnAttachments(text, files, target, (file, where) => {
    if (!isArchiveAttachment(file.file)) return null;
    annotated = true;
    const folder = where ? where.slice(0, where.length - host.stagedName(file).length) + host.extractedFolderName(host.stagedName(file)) : null;
    return host.archiveNote({ name: file.name, manifest: host.storedArchiveManifest(file.file), extractedPath: folder, when: "first-tool", texts: host.archiveInlineTexts(file.serverPath) });
  });
  return { text: staged.text, staging: target && staged.staged.length ? { target, files: staged.staged } : null, annotated };

}
  return workplaceTurnText;
}
