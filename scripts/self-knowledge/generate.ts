// Writes server/self-knowledge/knowledge.generated.json (sagax_help).
//   node --experimental-strip-types scripts/self-knowledge/generate.ts          write it
//   node --experimental-strip-types scripts/self-knowledge/generate.ts --check  exit 1 when stale
// Run by `pnpm build:server` (so every build and release carries a fresh
// base) and by hand after a change to the tools, Settings, docs or notes.
// The day in the file moves only when the content changes.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditKnowledgeText, buildKnowledge, KNOWLEDGE_FILE, serializeKnowledge } from "./build.ts";
import type { KnowledgeBase } from "../../server/self-knowledge-types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const path = join(root, KNOWLEDGE_FILE);
// SOURCE_DATE_EPOCH makes an image build reproducible.
const epoch = Number(process.env.SOURCE_DATE_EPOCH);
const today = new Date(Number.isFinite(epoch) && epoch > 0 ? epoch * 1000 : Date.now()).toISOString().slice(0, 10);
const previous: KnowledgeBase | null = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
const fresh = buildKnowledge(root, today);
const base = previous && previous.hash === fresh.hash && previous.version === fresh.version ? { ...fresh, generated: previous.generated } : fresh;

const text = serializeKnowledge(base);
const problems = auditKnowledgeText(text);
if (problems.length) {
  console.error(`${KNOWLEDGE_FILE} not written, it would hold:\n${problems.join("\n")}`);
  process.exit(1);
}
if (process.argv.includes("--check")) {
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (current !== text) {
    console.error(`${KNOWLEDGE_FILE} is stale: run node --experimental-strip-types scripts/self-knowledge/generate.ts`);
    process.exit(1);
  }
  console.log(`${KNOWLEDGE_FILE} is up to date (${base.sections.length} sections, ${base.hash}).`);
} else {
  writeFileSync(path, text);
  console.log(`${KNOWLEDGE_FILE}: ${base.sections.length} sections, ${Math.round(text.length / 1024)} KiB, ${base.hash}, ${base.generated}.`);
}
