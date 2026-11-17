// #4518: the catalog tests (budget, loaded part, wire, families) run for
// every lot that touches a file feeding the tool list a bot is sent, and only
// then.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CATALOG_TESTS, GUARD_TESTS, catalogFeeders, catalogPlan } from "./guard-tests.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "catalog-plan-"));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

describe("catalogPlan (#4518)", () => {
  it("selects the budget and wire tests for the files the real catalog imports", () => {
    const feeders = catalogFeeders(ROOT);
    // the files that grew the list unseen: a tool family, a shared schema, the profiles
    for (const file of [
      "server/drivers/agents-catalog.ts",
      "server/drivers/agents-catalog-budget.ts",
      "server/drivers/agents-tools/extras.ts",
      "server/drivers/agents-tools/shared.ts",
      "server/drivers/agents-settings-tools.ts",
      "server/drivers/agents-artifact-tools.ts",
      "shared/outbound-call.ts",
      "shared/options-card.ts",
      "server/drivers/agents-proxy.ts",
      "server/drivers/agents-catalog-goldens/direct-full.tools-list.json",
      "server/drivers/agents-catalog-goldens/profiles.json",
    ]) {
      if (file.endsWith(".ts")) expect(feeders.has(file), file).toBe(true);
      expect(catalogPlan([file], ROOT).tests, file).toEqual(CATALOG_TESTS);
    }
    expect(catalogPlan(["docs/releasing.md", "src/App.tsx", "server/routes/bots.ts"], ROOT)).toMatchObject({ tests: [], run: [], skip: "no file of the tool list touched" });
  });

  it("runs the budget, loaded part and family tests itself and leaves the wire test to the guard tests", () => {
    const own = ["server/drivers/agents-call-cards.test.ts", "server/drivers/agents-catalog-budget.test.ts", "server/drivers/agents-catalog-deferred.test.ts", "server/drivers/agents-merged.test.ts"];
    expect(GUARD_TESTS).toContain("server/drivers/agents-catalog-wire.test.ts");
    for (const test of own) expect(GUARD_TESTS, test).not.toContain(test);
    expect(catalogPlan(["server/drivers/agents-tools/routines.ts"], ROOT).run).toEqual(own);
    expect(catalogPlan(["server/drivers/agents-catalog-budget.test.ts"], ROOT).run).toEqual(own);
  });

  it("follows relative imports transitively and skips a type-only import", () => {
    const root = repo({
      "server/drivers/agents-catalog.ts": 'import { A } from "./family.ts";\nimport type { T } from "./types.ts";\n',
      "server/drivers/family.ts": 'export { B } from "../../shared/schema";\nimport "node:fs";\n',
      "server/drivers/types.ts": "export type T = 1;\n",
      "shared/schema.ts": "export const B = 1;\n",
      "server/drivers/agents-call-cards.test.ts": "",
      "server/drivers/agents-catalog-budget.test.ts": "",
      "server/drivers/agents-catalog-deferred.test.ts": "",
      "server/drivers/agents-catalog-wire.test.ts": "",
      "server/drivers/agents-merged.test.ts": "",
    });
    expect([...catalogFeeders(root)].sort()).toEqual(["server/drivers/agents-catalog.ts", "server/drivers/family.ts", "shared/schema.ts"]);
    expect(catalogPlan(["shared/schema.ts"], root).tests).toEqual(CATALOG_TESTS);
    expect(catalogPlan(["server/drivers/types.ts"], root).tests).toEqual([]);
  });
});
