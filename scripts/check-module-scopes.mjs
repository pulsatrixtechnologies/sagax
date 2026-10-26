// Release gate (port of OpenMausBot #2800): the packaged server and companion
// folders each carry a package.json that says "module", and their top-level
// .js files parse beneath a CommonJS parent. Usage:
//   node scripts/check-module-scopes.mjs [SERVER_DIR [COMPANION_DIR]]
// Defaults to dist-server and dist-companion in the repository.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function moduleScopeProblems(directory, label) {
  const problems = [];
  let type;
  try { type = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).type; }
  catch { problems.push(`${label}: package.json is missing or unreadable`); return problems; }
  if (type !== "module") problems.push(`${label}: package.json type is ${JSON.stringify(type)}, expected "module"`);
  return problems;
}

/** Copies the folder under a CommonJS parent and syntax-checks each top-level .js there. */
export function parseBeneathCommonJs(directory, label) {
  const parent = mkdtempSync(join(tmpdir(), "sagax-module-scope-"));
  const problems = [];
  try {
    writeFileSync(join(parent, "package.json"), '{"type":"commonjs"}\n');
    const copy = join(parent, label);
    cpSync(directory, copy, { recursive: true });
    for (const name of readdirSync(copy)) {
      if (!name.endsWith(".js")) continue;
      const result = spawnSync(process.execPath, ["--check", join(copy, name)], { encoding: "utf8" });
      if (result.status !== 0) problems.push(`${label}/${name} does not parse beneath a CommonJS parent: ${result.stderr.split("\n").find((line) => line.includes("Error")) ?? result.status}`);
    }
  } finally { rmSync(parent, { recursive: true, force: true }); }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = resolve(process.argv[2] ?? join(root, "dist-server"));
  const companion = resolve(process.argv[3] ?? join(root, "dist-companion"));
  const problems = [
    ...moduleScopeProblems(server, "server"), ...moduleScopeProblems(companion, "companion"),
    ...parseBeneathCommonJs(server, "server"), ...parseBeneathCommonJs(companion, "companion"),
  ];
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  console.log("module scopes ok: server and companion are ES modules beneath a CommonJS parent");
}
