#!/usr/bin/env node
// Print the six path-guard counts that scripts/testing/index-route-ratchet.test.ts
// pins for server/index.ts. Wave 0b of #1388: workers use this to see the
// numbers before lowering the ratchet in the same PR as a moved route.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX = readFileSync(join(root, "server/index.ts"), "utf8");

const NEEDLES = [
  'path === "/',
  "path.match(",
  "path.startsWith(",
  ".exec(path)",
  ".test(path)",
  ".includes(path)",
];

const count = (needle) => INDEX.split(needle).length - 1;

for (const needle of NEEDLES) {
  console.log(`${count(needle)}\t${needle}`);
}
