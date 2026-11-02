import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { generated } from "../scripts/gen-electron-org-library-catalog.mjs";

test("the Electron catalog copy matches shared/org-library-catalog.ts", () => {
  assert.equal(readFileSync(new URL("./org-library-catalog.mjs", import.meta.url), "utf8"), generated());
});

// Only electron/** is packed into app.asar: a runtime module that imports
// outside it crashes the packaged app at launch.
test("Electron runtime modules import nothing outside electron/", () => {
  const dir = new URL("./", import.meta.url);
  const offenders = readdirSync(dir).filter((name) => /\.(mjs|cjs|js)$/.test(name) && !/test/.test(name))
    .filter((name) => /(?:from\s+|import\(\s*)["']\.\.\//.test(readFileSync(new URL(name, dir), "utf8")));
  assert.deepEqual(offenders, []);
});
