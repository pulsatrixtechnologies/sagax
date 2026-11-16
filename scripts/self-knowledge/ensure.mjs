// Source checkouts generate their knowledge locally. Packaged servers carry it.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export async function ensureGeneratedKnowledge(root, force = false) {
  const output = join(root, "server/self-knowledge/knowledge.generated.json");
  if (!force && existsSync(output)) return;
  await run(process.execPath, ["--experimental-strip-types", join(root, "scripts/self-knowledge/generate.ts")], { cwd: root });
}
