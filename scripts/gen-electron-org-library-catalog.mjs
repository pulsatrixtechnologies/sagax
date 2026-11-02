// Writes electron/org-library-catalog.mjs from shared/org-library-catalog.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

export const HEADER = "// Generated from shared/org-library-catalog.ts with node:module stripTypeScriptTypes.\n// Electron main loads only electron/** from app.asar, so it cannot import ../shared.\n// electron/org-library-catalog.test.mjs fails when the two drift: regenerate with\n// node scripts/gen-electron-org-library-catalog.mjs.\n";
export const generated = () => HEADER + stripTypeScriptTypes(readFileSync(new URL("../shared/org-library-catalog.ts", import.meta.url), "utf8"), { mode: "strip" });

if (import.meta.url === `file://${process.argv[1]}`) writeFileSync(new URL("../electron/org-library-catalog.mjs", import.meta.url), generated());
