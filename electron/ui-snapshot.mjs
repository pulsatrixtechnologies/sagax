// The last thing this computer's own workspace showed (sidebar and open
// conversation), kept so the next launch can draw it before the local server
// answers (src/lib/ui-snapshot.ts). Read only by the local page
// (localOnly IPC), never by an organization or remote page.
//
// - One file per local data folder (an environment is its own workspace):
//   switching environments never shows another one's snapshot.
// - Encrypted with safeStorage (the same keychain secret as credentials.bin).
//   Without it nothing is written and nothing is read: the snapshot holds
//   conversation text and never goes to disk in clear.
// - Bounded in size; anything that does not decrypt or parse is discarded.
import crypto from "node:crypto";
import nodeFs from "node:fs";
import path from "node:path";

export const UI_SNAPSHOT_MAX_BYTES = 1_000_000;

/**
 * @param {{
 *   dir: string,                         userData/ui-snapshot
 *   dataDir: () => string | null,        the local data folder in use
 *   safeStorage: { isEncryptionAvailable(): boolean, encryptString(s: string): Buffer, decryptString(b: Buffer): string },
 *   fs?: typeof nodeFs,
 * }} deps
 */
export function createUiSnapshotStore({ dir, dataDir, safeStorage, fs = nodeFs }) {
  const file = () => {
    const folder = dataDir();
    if (!folder) return null;
    const key = crypto.createHash("sha256").update(path.resolve(folder)).digest("hex").slice(0, 32);
    return path.join(dir, `${key}.bin`);
  };
  const usable = () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  };
  return {
    read() {
      const target = file();
      if (!target || !usable()) return null;
      try {
        const sealed = fs.readFileSync(target);
        if (sealed.length > UI_SNAPSHOT_MAX_BYTES * 2) return null;
        return safeStorage.decryptString(sealed);
      } catch {
        return null;
      }
    },
    write(text) {
      const target = file();
      if (!target || !usable() || typeof text !== "string" || text.length > UI_SNAPSHOT_MAX_BYTES) return false;
      try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const temporary = `${target}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, safeStorage.encryptString(text), { mode: 0o600 });
        fs.renameSync(temporary, target);
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      const target = file();
      if (!target) return;
      try { fs.rmSync(target, { force: true }); } catch {}
    },
  };
}
