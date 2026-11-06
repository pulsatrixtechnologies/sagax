// @ts-nocheck
/** storedFamily (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStoredFamily(getHost: () => Host): any {
function storedFamily(name: string) {
  const host = getHost();
  const { ATTACHMENTS_DIR, isArchiveAttachment } = host;
  const path = join(ATTACHMENTS_DIR, name);
  const out = [path];
  try { out.push(host.modelImageCopyPath(ATTACHMENTS_DIR, path)); } catch { /* not a picture of the folder */ }
  const folders = [host.officeKind(name) ? host.officeMediaFolder(ATTACHMENTS_DIR, name) : null, isArchiveAttachment(name) ? host.localExtractedPath(path) : null];
  for (const folder of folders) {
    if (!folder) continue;
    const pending = [folder];
    while (pending.length && out.length < 5_000) {
      const dir = pending.pop()!;
      let entries: import("node:fs").Dirent[];
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (entry.isDirectory()) pending.push(join(dir, entry.name));
        else if (entry.isFile()) out.push(join(dir, entry.name));
      }
    }
  }
  return out;

}
  return storedFamily;
}
