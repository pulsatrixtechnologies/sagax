// scripts/fast-gate.sh on a throwaway repository: what counts as touched,
// which checks it picks per language, the 4-at-a-time cap and the exit code.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("has nothing to check on a clean branch", () => {
    const { code, out } = gate("--base", "main");
    expect(code).toBe(0);
    expect(out).toContain("nothing to check");
  });
});
