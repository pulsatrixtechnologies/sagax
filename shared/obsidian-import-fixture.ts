// The fixture vault of the Obsidian import's tests (shared/fixtures/obsidian-vault):
// nested folders, wikilinks, tags, front matter, an embedded image, .obsidian/,
// .trash/, an env file and a note named like one already in the destination.
// A note holding a key is added here, never committed as a file.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { VaultFile } from "./obsidian-import.ts";

export const OBSIDIAN_FIXTURE = fileURLToPath(new URL("./fixtures/obsidian-vault", import.meta.url));

/** The fixture vault as the page reads a picked folder: paths under the folder, notes with their text. */
export function fixtureVault(): VaultFile[] {
  const out: VaultFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      const path = relative(OBSIDIAN_FIXTURE, full).split("\\").join("/");
      out.push({ path, size: statSync(full).size, ...(path.endsWith(".md") ? { text: readFileSync(full, "utf8") } : {}) });
    }
  };
  walk(OBSIDIAN_FIXTURE);
  out.push({ path: "Field Notes/Leaked key.md", size: 80, text: `The deploy key is ${"sk-ant-"}api03-${"a".repeat(28)} do not share.` });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
