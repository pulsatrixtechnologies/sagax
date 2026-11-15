// The server's side of the files an Apple app tool (mac_*) carries on an
// organization server: a file to send is read from the bot's folder in
// chunks for the desktop bridge's stage_file, and an attachment the Mac saved
// comes back into the conversation's folder (server/desktop/desktop-bridge-tools.ts
// relayMacAppCall). The paths were already checked to sit in the bot's folders.
import { mkdirSync, openSync, readSync, closeSync, fstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { macAppFileName } from "../../electron/mac-apps.mjs";
import type { MacAppRelayFiles } from "../desktop/desktop-bridge-tools.ts";

const CHUNK = 512 * 1024;

async function* chunks(file: string): AsyncIterable<{ data: Buffer; offset: number; final: boolean }> {
  const handle = openSync(file, "r");
  try {
    const size = fstatSync(handle).size;
    if (size === 0) { yield { data: Buffer.alloc(0), offset: 0, final: true }; return; }
    for (let offset = 0; offset < size; offset += CHUNK) {
      const data = Buffer.alloc(Math.min(CHUNK, size - offset));
      const read = readSync(handle, data, 0, data.length, offset);
      yield { data: data.subarray(0, read), offset, final: offset + read >= size };
    }
  } finally {
    closeSync(handle);
  }
}

/** The relay's file io for one conversation (saveDir: its folder). */
export function macAppRelayFiles(saveDir: string | null): MacAppRelayFiles {
  return {
    chunks,
    ...(saveDir ? {
      save: (name: string, data: Buffer) => {
        mkdirSync(saveDir, { recursive: true, mode: 0o700 });
        const file = join(saveDir, macAppFileName(name));
        writeFileSync(file, data, { mode: 0o600 });
        return file;
      },
    } : {}),
  };
}
