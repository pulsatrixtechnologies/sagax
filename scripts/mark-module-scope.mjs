// Marks a built folder as ES modules (port of OpenMausBot #2800).
//
// The packaged server and companion are ESM `.js` files with no package.json
// of their own. Node decides module or CommonJS from the NEAREST package.json,
// so any folder above the install holding `{"type":"commonjs"}` (`npm init -y`
// writes one in C:\Users\<name>) made Node parse them as CommonJS and stop at
// the first `import` ("Cannot use import statement outside a module").
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function markModuleScope(directory) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2];
  if (!directory) throw new Error("Usage: node scripts/mark-module-scope.mjs DIRECTORY");
  markModuleScope(resolve(directory));
}
