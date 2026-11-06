// #2436: static guard on the leaf host order in server/index.ts (which runs
// under @ts-nocheck, so the compiler sees none of this). Every binding a leaf
// in server/index-leaves reads through `host` is bound in the bindLeafHost
// table, which sits before the first top-level await and before any boot code
// can call a leaf. 0.8.58 attached most of the host at the very end of the
// file and died at start when a recovered routine run reached a leaf. The
// running proof is server/boot-host-order.e2e.test.ts.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const IDENT = "[A-Za-z_$][\\w$]*";
const source = readFileSync(join(ROOT, "server/index.ts"), "utf8");
const lines = source.split("\n");

/** Comments and string bodies blanked, so `host.x` in prose is not a read. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, "\"\"");
}

function tableBounds(): { start: number; end: number } {
  const start = lines.findIndex((line) => line === "bindLeafHost({");
  const end = lines.findIndex((line, index) => index > start && line === "});");
  return { start, end };
}

function tableNames(): Set<string> {
  const { start, end } = tableBounds();
  const names = new Set<string>();
  for (const line of lines.slice(start + 1, end)) {
    const match = new RegExp(`^  get (${IDENT})\\(\\) \\{ return \\1; \\},`).exec(line);
    expect(match, `unexpected bindLeafHost line: ${line}`).not.toBeNull();
    names.add(match![1]!);
  }
  return names;
}

/** Leaf-owned state seeded with literal values (Object.assign of `key: value`). */
function literalStateNames(): Map<string, number> {
  const names = new Map<string, number>();
  const pattern = /Object\.assign\(leafHostBindings, \{([\s\S]*?)\}\);/g;
  for (const match of source.matchAll(pattern)) {
    const line = source.slice(0, match.index).split("\n").length - 1;
    for (const key of match[1]!.matchAll(new RegExp(`(${IDENT})\\s*:`, "g"))) names.set(key[1]!, line);
  }
  return names;
}

function firstTopLevelAwait(): number {
  return lines.findIndex((line) => /^[^\s/*]/.test(line) && /\bawait\b/.test(line));
}

function leafReads(): Map<string, string> {
  const reads = new Map<string, string>();
  const dir = join(ROOT, "server/index-leaves");
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
    const code = codeOnly(readFileSync(join(dir, file), "utf8"));
    for (const match of code.matchAll(new RegExp(`(?<![\\w$.])host\\.(${IDENT})`, "g"))) reads.set(match[1]!, file);
    for (const match of code.matchAll(/(?:const|let) \{([^}]*)\} = host;/g)) {
      for (const part of match[1]!.split(",")) {
        const name = part.trim().split(/[:=\s]/)[0];
        if (name) reads.set(name, file);
      }
    }
  }
  return reads;
}

it("binds the leaf host before the first top-level await of the boot", () => {
  const { start, end } = tableBounds();
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const firstAwait = firstTopLevelAwait();
  expect(firstAwait).toBeGreaterThan(0);
  expect(end).toBeLessThan(firstAwait);
  for (const [name, line] of literalStateNames()) expect(line, `${name} seeded after the first top-level await`).toBeLessThan(firstAwait);
});

it("binds every name a leaf reads through host in that table", () => {
  const bound = new Set([...tableNames(), ...literalStateNames().keys()]);
  const unbound = [...leafReads()].filter(([name]) => !bound.has(name)).map(([name, file]) => `${name} (${file})`);
  expect(unbound).toEqual([]);
});

it("attaches nothing else to the leaf host further down", () => {
  const { start, end } = tableBounds();
  const late = lines.flatMap((line, index) =>
    (index < start || index > end) && /(?:Object\.(?:assign|defineProperty|defineProperties)\(leafHostBindings\b)/.test(line) &&
    !/^\s*Object\.defineProperty\(leafHostBindings, name, /.test(line) && !/^Object\.assign\(leafHostBindings, \{$/.test(line)
      ? [`${index + 1}: ${line.trim()}`] : []);
  expect(late).toEqual([]);
  // The one literal Object.assign left seeds leaf-owned state, never a binding.
  for (const match of source.matchAll(/Object\.assign\(leafHostBindings, \{([\s\S]*?)\}\);/g)) {
    for (const part of match[1]!.split(",").map((entry) => entry.trim()).filter(Boolean)) {
      expect(part, "a binding goes in bindLeafHost, not in Object.assign").toMatch(new RegExp(`^${IDENT}\\s*:`));
    }
  }
});

it("binds only names declared at the top level of server/index.ts", () => {
  const declared = new Set<string>();
  const code = codeOnly(source);
  for (const match of code.matchAll(/^import\s+(?!type\b)([\s\S]*?)\s+from\s/gm)) {
    const clause = match[1]!;
    const named = /\{([\s\S]*)\}/.exec(clause)?.[1] ?? "";
    for (const part of named.split(",")) {
      const spec = part.trim().replace(/^type\s+/, "");
      if (!spec || part.trim().startsWith("type ")) continue;
      const local = spec.split(/\s+as\s+/).pop()!.trim();
      declared.add(local);
    }
    const head = clause.replace(/\{[\s\S]*\}/, "").replace(/,/g, " ").trim();
    for (const word of head.split(/\s+/)) {
      if (word === "*" || word === "as" || !word) continue;
      declared.add(word);
    }
  }
  for (const match of code.matchAll(new RegExp(`^(?:export\\s+)?(?:async\\s+)?(?:function\\*?|class|const|let|var)\\s+(${IDENT})`, "gm"))) declared.add(match[1]!);
  for (const match of code.matchAll(/^(?:export\s+)?(?:const|let|var)\s+\{([^}]*)\}\s*=/gm)) {
    for (const part of match[1]!.split(",")) {
      const local = part.split(":").pop()!.split("=")[0]!.trim();
      if (local) declared.add(local);
    }
  }
  const undeclared = [...tableNames()].filter((name) => !declared.has(name));
  expect(undeclared).toEqual([]);
});
