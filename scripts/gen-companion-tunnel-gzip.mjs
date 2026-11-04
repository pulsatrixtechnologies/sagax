// The companion builds with rootDir src. Generate its standalone copy from the shared source.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const HEADER = "// Generated from shared/tunnel-gzip.ts.\n// Edit the shared source, then run node scripts/gen-companion-tunnel-gzip.mjs.\n";
export const generated = () => HEADER + readFileSync(new URL("../shared/tunnel-gzip.ts", import.meta.url), "utf8");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(new URL("../companion/src/tunnel-gzip.ts", import.meta.url), generated());
}
