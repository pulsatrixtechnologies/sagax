import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { moduleScopeProblems, parseBeneathCommonJs } from "./check-module-scopes.mjs";
import { markModuleScope } from "./mark-module-scope.mjs";

// Port of OpenMausBot #2800: ESM built output must not depend on the nearest
// package.json above the install folder.
describe("module scope of the packaged server and companion", () => {
  const fixture = () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-scope-test-"));
    writeFileSync(join(dir, "index.js"), 'import { sep } from "node:path";\nexport default sep;\n');
    return dir;
  };

  it("fails without a marker and under a CommonJS parent, passes once marked", () => {
    const dir = fixture();
    try {
      expect(moduleScopeProblems(dir, "server")[0]).toMatch(/missing/);
      expect(parseBeneathCommonJs(dir, "server")[0]).toMatch(/does not parse beneath a CommonJS parent/);
      markModuleScope(dir);
      expect(moduleScopeProblems(dir, "server")).toEqual([]);
      expect(parseBeneathCommonJs(dir, "server")).toEqual([]);
      writeFileSync(join(dir, "package.json"), '{"type":"commonjs"}');
      expect(moduleScopeProblems(dir, "server")[0]).toMatch(/expected "module"/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("creates the folder when it is missing", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "sagax-scope-test-")), "nested");
    try { markModuleScope(dir); expect(moduleScopeProblems(dir, "companion")).toEqual([]); }
    finally { rmSync(join(dir, ".."), { recursive: true, force: true }); }
  });
});
