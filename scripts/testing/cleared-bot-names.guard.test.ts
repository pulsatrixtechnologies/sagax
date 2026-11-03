// 2026-11-03 (audit S-7): a real bot's name stayed in 35 tracked files (tests,
// docs, iOS, gallery) because check:terms scans those only when the
// FORBIDDEN_TERMS secret is set, which a local run never has. The names
// cleared from the whole repository stay cleared: each is kept here only as
// the truncated SHA-256 of its lower-cased word, like
// scripts/npm-package-terms.mjs, never in clear.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const CLEARED = new Set(["6236954eb0980f3a"]);
const SKIPPED = /(?:^|\/)(?:third_party|node_modules)\/|^pnpm-lock\.yaml$|\.(?:png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|wasm|zip|gz|mp[34]|mov|pdf|bin|onnx|gguf|p8)$/i;
const digest = (word: string) => createHash("sha256").update(word.normalize("NFKC").toLowerCase()).digest("hex").slice(0, 16);

it("a bot name cleared from the repository never comes back, in any tracked file", () => {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter((file) => file && !SKIPPED.test(file));
  const seen = new Map<string, boolean>();
  const cleared = (word: string) => {
    let hit = seen.get(word);
    if (hit === undefined) seen.set(word, (hit = CLEARED.has(digest(word))));
    return hit;
  };
  const hits = new Set<string>();
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    // whole letter runs, and their camelCase parts (bot-osprey, ospreyBot, OSPREY2)
    const words = new Set([...(text.match(/\p{L}{4,}/gu) ?? []), ...(text.match(/\p{Lu}?\p{Ll}{3,}|\p{Lu}{4,}(?!\p{Ll})/gu) ?? [])].map((word) => word.toLowerCase()));
    for (const word of words) if (cleared(word)) hits.add(file);
  }
  // only the place is reported, never the word
  expect([...hits]).toEqual([]);
}, 120_000);
