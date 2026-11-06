// @ts-nocheck
/** soloArchiveText (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSoloArchiveText(getHost: () => Host): any {
function soloArchiveText(text: string): { text: string; annotated: boolean } {
  const host = getHost();
  const { ATTACHMENTS_DIR, isArchiveAttachment } = host;
  const archives = host.attachedFilesInText(text, ATTACHMENTS_DIR).filter((file) => isArchiveAttachment(file.file));
  if (!archives.length) return { text, annotated: false };
  let out = text;
  for (const file of [...archives].sort((a, b) => b.start - a.start)) {
    const note = host.archiveNote({ name: file.name, manifest: host.storedArchiveManifest(file.file), extractedPath: host.localExtractedPath(file.serverPath), when: "ready", texts: host.archiveInlineTexts(file.serverPath) });
    out = `${out.slice(0, file.end)}\n${note}${out.slice(file.end)}`;
  }
  return { text: out, annotated: true };

}
  return soloArchiveText;
}
