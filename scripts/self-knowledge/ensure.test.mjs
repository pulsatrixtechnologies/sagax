import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ensureGeneratedKnowledge } from "./ensure.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "knowledge-generate-"));
  roots.push(root);
  mkdirSync(join(root, "scripts/self-knowledge"), { recursive: true });
  mkdirSync(join(root, "server/self-knowledge"), { recursive: true });
  const generator = join(root, "scripts/self-knowledge/generate.ts");
  const output = join(root, "server/self-knowledge/knowledge.generated.json");
  writeFileSync(generator, `require('node:fs').writeFileSync(${JSON.stringify(output)}, '{"sections":["fresh"]}')`);
  return { root, generator, output };
}
it("generates a missing source checkout output", async () => {
  const { root, output } = fixture();
  await ensureGeneratedKnowledge(root);
  expect(JSON.parse(readFileSync(output, "utf8")).sections).toEqual(["fresh"]);
});
it("regeneration failures propagate even when an older output exists", async () => {
  const { root, generator, output } = fixture();
  await ensureGeneratedKnowledge(root);
  writeFileSync(generator, "process.exit(7)");
  await expect(ensureGeneratedKnowledge(root, true)).rejects.toMatchObject({ code: 7 });
  expect(JSON.parse(readFileSync(output, "utf8")).sections).toEqual(["fresh"]);
});
it("does not launch a generator when a non-forced output already exists", async () => {
  const { root, generator } = fixture();
  await ensureGeneratedKnowledge(root);
  rmSync(generator);
  await expect(ensureGeneratedKnowledge(root)).resolves.toBeUndefined();
});
