// scripts/fast-gate.sh on a throwaway repository: what counts as touched,
// which checks it picks per language, the 4-at-a-time cap and the exit code.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "fast-gate.sh");

let repo: string;
let fakeBin: string;

function write(path: string, text: string, mode?: number) {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
  if (mode) chmodSync(full, mode);
}

function git(...args: string[]) {
  execFileSync("git", args, { cwd: repo, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
}

function gate(...args: string[]) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("GIT_") && !k.startsWith("FAST_GATE")) env[k] = v;
  env.PATH = `${fakeBin}:${env.PATH}`;
  env.FAST_GATE_LOG_DIR = join(repo, ".gate-logs");
  const r = spawnSync("bash", [SCRIPT, ...args], { cwd: repo, encoding: "utf8", env });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// A tool that records how many copies of the fake tools run at once.
const RECORDER = (name: string, exit = 0) => `#!/bin/sh
d="${"$"}FAKE_DIR"
echo "${name} $*" >> "$d/calls"
mkdir "$d/lock.${name}.$$" 2>/dev/null
n=$(ls -d "$d"/lock.* 2>/dev/null | wc -l | tr -d ' ')
echo "$n" >> "$d/concurrency"
sleep 0.4
rmdir "$d/lock.${name}.$$"
exit ${exit}
`;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "fast-gate-"));
  fakeBin = join(repo, ".fake-bin");
  mkdirSync(fakeBin);
  process.env.FAKE_DIR = fakeBin;
  git("init", "-q", "-b", "main");
  write(".gitignore", ".fake-bin/\n.gate-logs/\nnode_modules/\n");
  write("package.json", JSON.stringify({ scripts: { typecheck: `${join(fakeBin, "typecheck")}`, "check:terms": `${join(fakeBin, "terms")}` } }));
  write("src/a.ts", "export const a = 1;\n");
  write("src/a.test.ts", "// test\n");
  write("src/b.ts", "export const b = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "work");
  for (const tool of ["typecheck", "terms"]) write(`.fake-bin/${tool}`, RECORDER(tool), 0o755);
  for (const tool of ["oxlint", "vitest"]) write(`node_modules/.bin/${tool}`, RECORDER(tool), 0o755);
  // npm stands in for the package manager: runs the script by name.
  write(".fake-bin/npm", `#!/bin/sh\nshift; [ "$1" = "-s" ] && shift; exec "${"$"}FAKE_DIR/${"$"}{1#check:}"\n`, 0o755);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  delete process.env.FAKE_DIR;
});

describe("fast-gate.sh", () => {
  it("measures touched files from the merge base plus the working tree", () => {
    write("src/b.ts", "export const b = 2;\n");
    git("commit", "-qam", "b");
    write("src/new.ts", "export {};\n");
    const { code, out } = gate("--base", "main", "--list");
    expect(code).toBe(0);
    expect(out).toContain("2 touched file(s) since main");
    expect(out).toContain("src/b.ts");
    expect(out).toContain("src/new.ts");
    expect(out).not.toContain("src/a.ts");
  });

  it("runs the tests beside a touched source and lints only the touched files", () => {
    write("src/a.ts", "export const a = 2;\n");
    const { code, out } = gate("--base", "main", "--dry-run");
    expect(code).toBe(0);
    expect(out).toMatch(/\[tests\] .*vitest' run --reporter=dot 'src\/a\.test\.ts'/);
    expect(out).toMatch(/\[lint\] .*oxlint' --deny-warnings 'src\/a\.ts'/);
    expect(out).toContain("[typecheck] npm run -s typecheck");
    expect(out).toContain("[terms] npm run -s check:terms");
  });

  // A touched source brings the tests of its stem and the tests that import
  // it, never its whole folder: the two largest folders hold over 400 and 500
  // test files, and one touched file there ran nearly the whole suite on the
  // author's machine. A test that reaches the source through other files
  // (#3587 to #3596: a prompt change left ten cases of a driver's test red)
  // is caught by the run of every test after the merge, which names the
  // pull request.
  it("runs the tests of a touched source's stem and its importers, not its whole folder", () => {
    write("server/drivers/acp/turn-prompt-build.test.ts", "// same stem\n");
    write("server/drivers/acp/turn-prompt-build.fit.test.ts", "// same stem, a second file\n");
    write("server/drivers/acp/turn-prompt-builder.test.ts", "// a longer name, not this source\n");
    write("server/drivers/acp/acp.test.ts", 'import { x } from "./turn-prompt-build.ts";\n');
    write("server/drivers/acp/prompt-fit.test.ts", "// same folder, another source\n");
    write("server/drivers/other.test.ts", "// another folder\n");
    git("add", "-A");
    git("commit", "-q", "-m", "tests");
    write("server/drivers/acp/turn-prompt-build.ts", "export const x = 1;\n");
    const { out } = gate("--base", "HEAD", "--only", "tests", "--dry-run");
    expect(out).toMatch(/\[tests\] .*vitest' run --reporter=dot 'server\/drivers\/acp\/acp\.test\.ts' 'server\/drivers\/acp\/turn-prompt-build\.fit\.test\.ts' 'server\/drivers\/acp\/turn-prompt-build\.test\.ts'$/m);
    expect(out).not.toContain("prompt-fit.test.ts");
    expect(out).not.toContain("turn-prompt-builder.test.ts");
    expect(out).not.toContain("other.test.ts");
  });

  it("runs every test that imports a touched source, wherever it lives", () => {
    write("tests/imports-b.test.ts", 'import { b } from "../src/b.ts";\n');
    write("tests/mocks-b.test.ts", 'vi.mock("../src/b", () => ({}));\nconst m = await import("../src/b.js");\n');
    write("tests/deep/requires-b.test.ts", 'const { b } = require("../../src/b");\n');
    write("tests/near-name.test.ts", 'import { bb } from "../src/bb.ts";\nimport x from "./b.ts";\n');
    git("add", "-A");
    git("commit", "-q", "-m", "tests");
    write("src/b.ts", "export const b = 2;\n");
    const { out } = gate("--base", "HEAD", "--only", "tests", "--dry-run");
    const line = out.split("\n").find((l) => l.startsWith("[tests]")) ?? "";
    expect(line).toContain("'tests/imports-b.test.ts'");
    expect(line).toContain("'tests/mocks-b.test.ts'");
    expect(line).toContain("'tests/deep/requires-b.test.ts'");
    // the test of another source of the same folder is not this change's
    expect(line).not.toContain("'src/a.test.ts'");
    expect(line).not.toContain("near-name");
  });

  // Most interface tests import through the "@/" alias, and a folder's index
  // is imported by the folder's name: both import the touched source.
  it("counts an import through a tsconfig path alias or a folder's index", () => {
    write("tsconfig.json", JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }));
    write("src/lib/x.ts", "export const x = 1;\n");
    write("src/idx/index.ts", "export const y = 1;\n");
    write("tests/alias.test.ts", 'import { x } from "@/lib/x";\n');
    write("tests/alias-mock.test.ts", 'vi.mock("@/lib/x", () => ({}));\n');
    write("tests/via-index.test.ts", 'import { y } from "../src/idx";\n');
    write("tests/package.test.ts", 'import x from "x";\nimport idx from "idx";\n');
    write("tests/other-alias.test.ts", 'import { z } from "@/lib/xx";\n');
    git("add", "-A");
    git("commit", "-q", "-m", "tests");
    write("src/lib/x.ts", "export const x = 2;\n");
    write("src/idx/index.ts", "export const y = 2;\n");
    const { out } = gate("--base", "HEAD", "--only", "tests", "--dry-run");
    const line = out.split("\n").find((l) => l.startsWith("[tests]")) ?? "";
    expect(line).toContain("'tests/alias.test.ts'");
    expect(line).toContain("'tests/alias-mock.test.ts'");
    expect(line).toContain("'tests/via-index.test.ts'");
    expect(line).not.toContain("package.test.ts");
    expect(line).not.toContain("other-alias.test.ts");
  });

  // A store or a test helper is imported by hundreds of tests: its importers
  // wait for the run after the merge, and the gate says how many they are.
  it("leaves the importers of a source that more than 25 tests import to the run after the merge, and says so", () => {
    for (let i = 1; i <= 26; i++) write(`tests/many/i${i}.test.ts`, 'import { b } from "../../src/b.ts";\n');
    for (let i = 1; i <= 25; i++) write(`tests/few/i${i}.test.ts`, 'import { a } from "../../src/a.ts";\n');
    write("src/b.test.ts", "// its own test\n");
    git("add", "-A");
    git("commit", "-q", "-m", "tests");
    write("src/a.ts", "export const a = 2;\n");
    write("src/b.ts", "export const b = 2;\n");
    const { out } = gate("--base", "HEAD", "--only", "tests", "--dry-run");
    const line = out.split("\n").find((l) => l.startsWith("[tests]")) ?? "";
    expect(line).toContain("'src/a.test.ts'");
    expect(line).toContain("'src/b.test.ts'");
    expect(line).toContain("'tests/few/i1.test.ts'");
    expect(line).toContain("'tests/few/i25.test.ts'");
    expect(line).not.toContain("tests/many/");
    expect(out).toContain("fast-gate: src/b.ts is imported by 26 test files: only the tests of its own name run here, the others run after the merge");
    expect(out).not.toContain("src/a.ts is imported by");
  });

  // #4138: four tests went red on main because they reach the changed file
  // through other files (a chat test renders a bar that renders the touched
  // pill), and lots ran only the tests beside their files.
  it("runs the tests that reach a touched source through other files as the related check, nearest first", () => {
    write("tsconfig.json", JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }));
    write("src/pill.tsx", "export const Pill = 1;\n");
    write("src/bar.tsx", 'import { Pill } from "./pill";\nexport const Bar = Pill;\n');
    write("src/chat/index.tsx", 'import { Bar } from "@/bar";\nexport const Chat = Bar;\n');
    write("src/window.tsx", 'import { Chat } from "./chat";\nexport const Win = Chat;\n');
    write("src/types-only.ts", 'import type { Pill } from "./pill";\nexport type P = typeof Pill;\n');
    write("src/pill.dom.test.ts", "// its own name: the tests check\n");
    write("tests/direct.test.ts", 'import { Pill } from "../src/pill";\n');
    write("tests/bar.test.ts", 'import { Bar } from "../src/bar.tsx";\n');
    write("src/chat/chat.dom.test.ts", 'const { Chat } = await import("@/chat");\n');
    write("src/window.dom.test.ts", 'vi.mock("./chat", () => ({}));\n');
    write("src/far.test.ts", 'import { Win } from "./window";\n');
    write("src/types-only.test.ts", 'import { P } from "./types-only";\n');
    write("src/known.test.ts", 'import { Chat } from "./chat";\n');
    write("scripts/testing/known-failures.json", JSON.stringify({ tests: [{ file: "src/known.test.ts", test: "red on main" }] }));
    git("add", "-A");
    git("commit", "-q", "-m", "tests");
    write("src/pill.tsx", "export const Pill = 2;\n");
    const { out } = gate("--base", "HEAD", "--only", "tests,related", "--dry-run");
    const tests = out.split("\n").find((l) => l.startsWith("[tests]")) ?? "";
    const related = out.split("\n").find((l) => l.startsWith("[related]")) ?? "";
    expect(tests).toContain("'src/pill.dom.test.ts'");
    expect(tests).toContain("'tests/direct.test.ts'");
    expect(related).toMatch(/vitest' run --reporter=dot --passWithNoTests 'src\/chat\/chat\.dom\.test\.ts' 'src\/window\.dom\.test\.ts' 'tests\/bar\.test\.ts'$/);
    // four files away, a type-only import, a known failure: not this lot's
    expect(out).not.toContain("far.test.ts");
    expect(out).not.toContain("types-only.test.ts");
    expect(out).not.toContain("known.test.ts");
    expect(out).toContain("fast-gate: related: 3 test file(s) reach the touched sources through imports");
  });

  it("bounds the related check, keeps the nearest and the touched folder's tests, and says how many wait", () => {
    write("src/ui/pill.tsx", "export const Pill = 1;\n");
    write("src/ui/bar.tsx", 'import { Pill } from "./pill";\nexport const Bar = Pill;\n');
    write("src/ui/bar.test.ts", 'import { Bar } from "./bar";\n');
    write("tests/a-bar.test.ts", 'import { Bar } from "../src/ui/bar";\n');
    write("src/ui/deeper.tsx", 'import { Bar } from "./bar";\nexport const D = Bar;\n');
    write("src/ui/deeper.dom.test.ts", 'import { D } from "./deeper";\n');
    git("add", "-A");
    git("commit", "-q", "-m", "tests");
    write("src/ui/pill.tsx", "export const Pill = 2;\n");
    const env = { FAST_GATE_RELATED_MAX: "1" };
    const r = spawnSync("bash", [SCRIPT, "--base", "HEAD", "--only", "related", "--dry-run"], { cwd: repo, encoding: "utf8", env: { ...process.env, ...env, PATH: `${fakeBin}:${process.env.PATH}`, FAST_GATE_LOG_DIR: join(repo, ".gate-logs") } });
    const out = `${r.stdout}${r.stderr}`;
    const related = out.split("\n").find((l) => l.startsWith("[related]")) ?? "";
    expect(related).toMatch(/--passWithNoTests 'src\/ui\/bar\.test\.ts'$/);
    expect(out).toContain("fast-gate: related: 1 test file(s) reach the touched sources through imports, 2 more wait for the run after the merge");
  });

  it("runs the checks in parallel, never more than the cap, and is green", () => {
    write("src/a.ts", "export const a = 2;\n");
    const { code, out } = gate("--base", "main", "--jobs", "2");
    expect(code, out).toBe(0);
    expect(out).toContain("fast-gate: green");
    const calls = readFileSync(join(fakeBin, "calls"), "utf8").trim().split("\n");
    expect(calls).toHaveLength(4);
    const peaks = readFileSync(join(fakeBin, "concurrency"), "utf8").trim().split("\n").map(Number);
    expect(Math.max(...peaks)).toBeGreaterThan(1);
    expect(Math.max(...peaks)).toBeLessThanOrEqual(2);
  });

  it("caps --jobs at 4", () => {
    write("src/a.ts", "export const a = 2;\n");
    expect(gate("--base", "main", "--jobs", "16", "--list").out).toContain("4 at a time");
  });

  it("fails with the failing check's log when one check fails", () => {
    write(".fake-bin/terms", RECORDER("terms", 3), 0o755);
    write("src/a.ts", "export const a = 2;\n");
    const { code, out } = gate("--base", "main");
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL\s+terms .*exit 3/);
    expect(out).toContain("fast-gate: red: terms");
  });

  it("keeps only the checks named by --only", () => {
    write("src/a.ts", "export const a = 2;\n");
    const { out } = gate("--base", "main", "--only", "lint,terms", "--dry-run");
    expect(out).toContain("checks: lint terms");
    expect(out).not.toContain("[typecheck]");
  });

  it("picks the touched Rust crates by their own Cargo.toml", () => {
    write(".fake-bin/cargo", "#!/bin/sh\nexit 0\n", 0o755);
    write("Cargo.toml", "[workspace]\nmembers = [\"crates/*\"]\n");
    write("crates/core-x/Cargo.toml", "[package]\nname = \"core-x\"\nversion = \"0.1.0\"\n\n[dependencies]\nname = \"not-this\"\n");
    write("crates/core-x/src/deep/mod.rs", "pub fn f() {}\n");
    write("crates/other/Cargo.toml", "[package]\nname = \"other\"\n");
    const { out } = gate("--base", "main", "--dry-run");
    expect(out).toContain("[rust-fmt] cargo fmt --check -p 'core-x' -p 'other'");
    expect(out).toContain("[rust] cargo clippy --all-targets -p 'core-x' -p 'other' -- -D warnings && cargo test -p 'core-x' -p 'other'");
  });

  it("compiles touched Python and runs the test beside it", () => {
    write("tools/thing.py", "X = 1\n");
    write("tools/test_thing.py", "import unittest\n");
    const { out } = gate("--base", "main", "--only", "py", "--dry-run");
    expect(out).toContain("[py] python3 -m py_compile 'tools/test_thing.py' 'tools/thing.py'");
    expect(out).toContain("(cd 'tools' && python3 -m unittest -q 'test_thing')");
  });

  it("runs the repository's extra checks from .fast-gate with the touched files", () => {
    write(".fast-gate", "# extra\nguard: printf '%s\\n' \"$FAST_GATE_FILES\" | grep -q fast-gate\n");
    const { code, out } = gate("--base", "main", "--only", "extra-guard");
    expect(code, out).toBe(0);
    expect(out).toMatch(/ok\s+extra-guard/);
  });

  // #3406: adding connectors and call_connector to the catalog left the
  // pinned tool lists of agents-proxy.test.ts red, as no lot touched it.
  it("runs agents-proxy.test.ts when a tool of the agents server changes", () => {
    write(".fast-gate", readFileSync(resolve(__dirname, "..", ".fast-gate"), "utf8"));
    const touches = (path: string) => {
      git("checkout", "-q", "--", ".");
      git("clean", "-qfd", "--", "server", "src");
      write(path, "export {};\n");
      rmSync(join(fakeBin, "calls"), { force: true });
      const { code, out } = gate("--base", "main", "--only", "extra-agents-proxy");
      expect(code, out).toBe(0);
      let calls = "";
      try { calls = readFileSync(join(fakeBin, "calls"), "utf8"); } catch { /* no call */ }
      return calls.includes("vitest run --reporter=dot server/drivers/agents-proxy.test.ts");
    };
    for (const path of [
      "server/drivers/agents-catalog.ts",
      "server/drivers/agents-tools/connectors.ts",
      "server/drivers/agents-call-connectors.ts",
      "server/drivers/agents-settings-tools.ts",
      "server/tools/agent-tool-policy.ts",
    ]) expect(touches(path), path).toBe(true);
    expect(touches("src/b.ts")).toBe(false);
    expect(touches("server/drivers/agents-catalog-goldens/x.json")).toBe(false);
  });

  // #4164: two type imports closed cycles in shared/ and its cycle ceiling
  // went red on main unseen; a lot that touches shared/ runs that case.
  it("runs the cycle ceiling of shared/ when a file of shared/ changes", () => {
    write(".fast-gate", readFileSync(resolve(__dirname, "..", ".fast-gate"), "utf8"));
    const touches = (path: string) => {
      git("checkout", "-q", "--", ".");
      git("clean", "-qfd", "--", "server", "src", "shared");
      write(path, "export {};\n");
      rmSync(join(fakeBin, "calls"), { force: true });
      const { code, out } = gate("--base", "main", "--only", "extra-shared-cycles");
      expect(code, out).toBe(0);
      let calls = "";
      try { calls = readFileSync(join(fakeBin, "calls"), "utf8"); } catch { /* no call */ }
      return calls.includes("vitest run --reporter=dot scripts/testing/madge-cycles.guard.test.ts -t shared stays at its ceiling");
    };
    expect(touches("shared/waiting-item.ts")).toBe(true);
    expect(touches("shared/sub/page.tsx")).toBe(true);
    expect(touches("src/b.ts")).toBe(false);
    expect(touches("server/x.ts")).toBe(false);
  });

  // #3509: the guard tests ran only in verify:merge, which authors skipped,
  // so a route without a policy row and three unread locale keys kept main
  // red. The fast gate runs every guard test on every lot.
  it("runs every guard test of verify:merge on a lot that touches none of them", () => {
    write(".fast-gate", readFileSync(resolve(__dirname, "..", ".fast-gate"), "utf8"));
    write("scripts/verify/release/guard-tests.mjs", readFileSync(resolve(__dirname, "verify/release/guard-tests.mjs"), "utf8"));
    for (const file of ["scripts/tool-policy/tool-policy-coverage.test.ts", "src/locales/unused-keys.test.ts"]) write(file, "// guard\n");
    write("src/b.ts", "export const b = 2;\n");
    const { code, out } = gate("--base", "main", "--only", "extra-guard-tests");
    expect(code, out).toBe(0);
    const calls = readFileSync(join(fakeBin, "calls"), "utf8");
    expect(calls).toContain("vitest run --reporter=dot --testTimeout=60000 scripts/tool-policy/tool-policy-coverage.test.ts src/locales/unused-keys.test.ts");
  });

  // #3538: routine effort at admission and the agent API end to end went red
  // on main unseen; every lot runs them now.
  it("lists the admission and agent API files among the tests every lot runs", async () => {
    const { GUARD_TESTS } = await import("./verify/release/guard-tests.mjs");
    expect(GUARD_TESTS).toEqual(expect.arrayContaining(["server/turns/start-turn-prepare-admit.test.ts", "server/agent-api.e2e.test.ts"]));
  });

  // #4131: the UI guards that scan the whole of src (motion tokens, touch
  // actions, window drag, settings placement and the like) went red on main
  // unseen after three UI lots; every lot runs them now, from the one list.
  it("lists the repository-wide UI guards among the tests every lot runs", async () => {
    const { GUARD_TESTS, UI_GUARD_TESTS } = await import("./verify/release/guard-tests.mjs");
    expect(UI_GUARD_TESTS).toEqual(expect.arrayContaining([
      "src/lib/motion.test.ts",
      "src/components/touch-actions.test.ts",
      "src/components/window-drag.layout.test.ts",
      "src/components/settings/settingsPlacement.test.ts",
    ]));
    expect(GUARD_TESTS).toEqual(expect.arrayContaining(UI_GUARD_TESTS));
    for (const file of UI_GUARD_TESTS) expect(existsSync(resolve(__dirname, "..", file)), file).toBe(true);
  });

  // #4186: eight tests that read the app's sources or its catalogs as text
  // went red on the 0.8.100 release commit, since the import graph links no
  // file read as text. A lot that touches a file they read (src/, the
  // phone's catalog, the providers docs page, two scripts/testing files) runs
  // them all, two files at a time; a lot elsewhere does not, and the
  // guard-tests line leaves them to this one.
  it("runs the source-text tests on a lot that touches a file they read as text, and only there", () => {
    write(".fast-gate", readFileSync(resolve(__dirname, "..", ".fast-gate"), "utf8"));
    write("scripts/verify/release/guard-tests.mjs", readFileSync(resolve(__dirname, "verify/release/guard-tests.mjs"), "utf8"));
    for (const file of ["src/locales/words.test.ts", "src/components/bot-settings/RoutinesSection.test.ts", "src/locales/unused-keys.test.ts"]) write(file, "// guard\n");
    git("add", "-A");
    git("commit", "-qm", "guards");
    git("branch", "-f", "main");
    const runs = (touched: string) => {
      write(touched, "export const touched = 1;\n");
      try { rmSync(join(fakeBin, "calls")); } catch { /* first run */ }
      const { code, out } = gate("--base", "main", "--only", "extra-source-text,extra-guard-tests");
      expect(code, out).toBe(0);
      rmSync(join(repo, touched));
      return readFileSync(join(fakeBin, "calls"), "utf8");
    };
    const ui = runs("src/b.ts");
    expect(ui).toContain("vitest run --reporter=dot --fileParallelism --maxWorkers=2 --testTimeout=60000 src/components/bot-settings/RoutinesSection.test.ts src/locales/words.test.ts");
    // the guard-tests line leaves the source-text tests to their own line
    expect(ui).toContain("vitest run --reporter=dot --testTimeout=60000 src/locales/unused-keys.test.ts\n");
    expect(runs("ios/App/Localizable.xcstrings")).toContain("--fileParallelism --maxWorkers=2");
    // the other files a listed test reads as text
    expect(runs("apps/docs/content/docs/providers/model-providers.mdx")).toContain("--fileParallelism --maxWorkers=2");
    expect(runs("scripts/testing/compose-flow.ts")).toContain("--fileParallelism --maxWorkers=2");
    expect(runs("server/x.ts")).not.toContain("--fileParallelism");
  });

  it("lists every test the rail found red for reading sources as text, and none with a known failure", async () => {
    const { GUARD_TESTS, SOURCE_TEXT_TESTS } = await import("./verify/release/guard-tests.mjs");
    expect(SOURCE_TEXT_TESTS).toEqual(expect.arrayContaining([
      "src/locales/words.test.ts",
      "src/components/bot-settings/RoutinesSection.test.ts",
      "src/components/settings/toggle-consumers.test.ts",
      "electron/skin-overlay.test.mjs",
      "shared/approval-describe.test.ts",
      "src/components/bot-settings/ActivitySection.test.ts",
      "src/components/bot-settings/CodeBranchList.test.ts",
      "src/components/widget/WidgetMessage.test.ts",
      // read src/styles.css, ChatViewBanners.tsx and today-box.{tsx,html} as text
      "src/components/SidebarPopoverMenu.measures.test.ts",
      "src/components/TurnTimingLine.test.ts",
      "src/gallery/today-box.test.ts",
    ]));
    expect(GUARD_TESTS).toEqual(expect.arrayContaining([...SOURCE_TEXT_TESTS, "scripts/stability/portable-paths.test.ts"]));
    expect(new Set(GUARD_TESTS).size).toBe(GUARD_TESTS.length);
    const known = new Set((JSON.parse(readFileSync(resolve(__dirname, "testing/known-failures.json"), "utf8")) as { tests: { file: string }[] }).tests.map((entry) => entry.file));
    for (const file of SOURCE_TEXT_TESTS) {
      expect(existsSync(resolve(__dirname, "..", file)), file).toBe(true);
      expect(known.has(file), file).toBe(false);
    }
  });

  it("has nothing to check on a clean branch", () => {
    const { code, out } = gate("--base", "main");
    expect(code).toBe(0);
    expect(out).toContain("nothing to check");
  });
});
