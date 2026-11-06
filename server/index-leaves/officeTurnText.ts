// @ts-nocheck
/** officeTurnText (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOfficeTurnText(getHost: () => Host): any {
function officeTurnText(text: string, principal: WorkplaceDecision["principal"], nativeImages: boolean, already: readonly TurnImageInput[] = []): { text: string; images: TurnImageInput[] } {
  const host = getHost();

  const files = host.attachedFilesInText(text, ATTACHMENTS_DIR).filter((file) => host.officeKind(file.file)
    && (host.IDENTITY.kind !== "perspicax" || Boolean(principal && host.attachmentIsTheirs(principal, host.attachmentReferences(file.file)))));
  if (!files.length) return { text, images: [] };
  const images: TurnImageInput[] = [];
  // The composer's own pictures count against the same budget.
  let bytes = already.reduce((sum, image) => sum + image.bytes, 0);
  const room = () => host.OFFICE_IMAGE_MAX_COUNT - already.length - images.length;
  const notes = files.map((file) => {
    const media = host.readOfficeMedia(file.serverPath, ATTACHMENTS_DIR);
    if (!media) return null;
    const fits = nativeImages && media.images.length <= room()
      && bytes + media.images.reduce((sum, image) => sum + image.bytes, 0) <= host.OFFICE_IMAGES_MAX_TOTAL_BYTES;
    if (fits) {
      for (const image of media.images) images.push({ path: image.path, mime: image.mime, bytes: image.bytes });
      bytes += media.images.reduce((sum, image) => sum + image.bytes, 0);
    }
    return { file, note: host.officeNote(file.name, media, fits) };
  });
  let out = text;
  for (const entry of notes.filter((item): item is NonNullable<typeof item> => item !== null).toReversed()) {
    // A blank line: the tag stays its own HTML node, so staging still finds it.
    out = `${out.slice(0, entry.file.end)}\n\n${entry.note}${out.slice(entry.file.end)}`;
  }
  return { text: out, images };

}
  return officeTurnText;
}
