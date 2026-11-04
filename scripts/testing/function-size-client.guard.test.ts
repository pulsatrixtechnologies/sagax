// Client function-size ratchet (#1383).
//
// Fails when any non-test function in src/ exceeds MAX_LINES (babel AST
// loc span). Uses the pinned @babel/parser from node_modules/.pnpm.
// Lower MAX_LINES only when the whole tree is under a tighter budget;
// this guard is a hard ceiling, not a count ratchet.
//
// Pathspec note: `src/**` alone misses top-level files such as src/App.tsx
// on some git pathspec implementations, so list both `src/*` and `src/**`.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hostTimeout } from "../../server/testing/host-timeout.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(`${ROOT}/package.json`);
const parser = require(`${ROOT}/node_modules/.pnpm/@babel+parser@7.29.9/node_modules/@babel/parser`);

const MAX_LINES = 400;
const FN_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassMethod",
  "ObjectMethod",
]);

type Oversized = { lines: number; file: string; name: string; line: number };

function listSrcFiles(): string[] {
  const listed = execSync("git ls-files 'src/*.ts' 'src/*.tsx' 'src/**/*.ts' 'src/**/*.tsx'", {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => f && !/\.test\.|\.spec\.|\.d\.ts$/.test(f));
  return [...new Set(listed)].sort();
}

function functionName(node: { id?: { name?: string }; key?: { name?: string }; _nm?: string }): string {
  return node.id?.name || node.key?.name || node._nm || "(anon)";
}

function oversizedIn(file: string): Oversized[] {
  const source = readFileSync(`${ROOT}/${file}`, "utf8");
  let ast: { program: unknown };
  try {
    ast = parser.parse(source, {
      sourceType: "module",
      plugins: ["typescript", ...(file.endsWith("x") ? ["jsx"] : [])],
      errorRecovery: true,
    });
  } catch {
    return [];
  }
  const found: Oversized[] = [];
  const stack: Array<Record<string, unknown>> = [ast.program as Record<string, unknown>];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n.type !== "string") continue;
    if (FN_TYPES.has(n.type)) {
      const loc = n.loc as { start: { line: number }; end: { line: number } } | undefined;
      if (loc) {
        const lines = loc.end.line - loc.start.line + 1;
        if (lines > MAX_LINES) {
          found.push({
            lines,
            file,
            name: functionName(n as { id?: { name?: string }; key?: { name?: string }; _nm?: string }),
            line: loc.start.line,
          });
        }
      }
    }
    for (const key of Object.keys(n)) {
      if (key === "loc") continue;
      const v = n[key];
      if (Array.isArray(v)) {
        for (const child of v) {
          if (child && typeof (child as { type?: string }).type === "string") {
            if (n.type === "VariableDeclarator") {
              (child as { _nm?: string })._nm = (n.id as { name?: string } | undefined)?.name;
            }
            stack.push(child as Record<string, unknown>);
          }
        }
      } else if (v && typeof (v as { type?: string }).type === "string") {
        if (n.type === "VariableDeclarator" && key === "init") {
          (v as { _nm?: string })._nm = (n.id as { name?: string } | undefined)?.name;
        }
        if ((n.type === "ObjectProperty" || n.type === "ClassProperty") && key === "value") {
          (v as { _nm?: string })._nm = (n.key as { name?: string } | undefined)?.name;
        }
        if (n.type === "CallExpression") {
          (v as { _nm?: string })._nm = (n as { _nm?: string })._nm;
        }
        stack.push(v as Record<string, unknown>);
      }
    }
  }
  return found;
}

describe("src function size (#1383)", () => {
  it(
    `no non-test function in src/ exceeds ${MAX_LINES} lines`,
    { timeout: hostTimeout(120_000) },
    () => {
      const files = listSrcFiles();
      expect(files.some((f) => f === "src/App.tsx"), "guard must include top-level src/App.tsx").toBe(true);
      const oversized: Oversized[] = [];
      for (const file of files) oversized.push(...oversizedIn(file));
      oversized.sort((a, b) => b.lines - a.lines);
      const report = oversized
        .map((o) => `${o.lines}  ${o.file}:${o.line}  ${o.name}`)
        .join("\n");
      expect(report, report || "ok").toBe("");
    },
  );
});
