// Who uploaded each stored attachment (by its file name), on an organization
// server where conversations are private. A file no conversation uses yet
// (an upload before its message is sent) is its uploader's only: nobody else,
// an administrator included, reads its bytes or its archive manifest until a
// conversation they read uses it (server/index-leaves/attachmentSeenBy.ts).
//
// One small file per attachment under its own folder, never in the
// attachments folder (nothing here is served). The first uploader of a name
// stays its uploader: a retry with the same upload id and the same bytes by
// someone else names the same file and changes nothing.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NAME = /^[\w.-]{1,200}$/;

const normalized = (person: string): string => person.trim().toLowerCase();

export class AttachmentUploaders {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  /** Records `person` as the uploader of `name`, unless it already has one. */
  record(name: string, person: string): void {
    const who = normalized(person);
    if (!NAME.test(name) || name.startsWith(".") || !who) return;
    mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(join(this.#dir, name), who, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }

  /** The uploader of `name`, lowercased, or null when none was recorded. */
  uploaderOf(name: string): string | null {
    if (!NAME.test(name) || name.startsWith(".")) return null;
    try {
      return normalized(readFileSync(join(this.#dir, name), "utf8")) || null;
    } catch {
      return null;
    }
  }

  /** Whether `person` uploaded `name`. */
  uploadedBy(name: string, person: string | undefined): boolean {
    const who = person ? normalized(person) : "";
    return Boolean(who) && this.uploaderOf(name) === who;
  }
}
