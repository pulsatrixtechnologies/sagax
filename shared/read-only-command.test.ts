import { describe, expect, it } from "vitest";
import { isReadOnlyCommand, runCommandOf, singleProgramOf } from "./read-only-command.ts";

describe("isReadOnlyCommand", () => {
  it("passes the command of JC's card (2026-10-20)", () => {
    expect(isReadOnlyCommand("ls /workspace/sagax-plugins/ 2>/dev/null; echo CLAUDECODE=$CLAUDECODE; ls ~/.pulsatrix-flow | head")).toBe(true);
  });

  it.each([
    "ls -la",
    "cat README.md | head -20",
    "grep -rn 'a|b' src",
    "find . -name '*.ts' | wc -l",
    "git status && git log --oneline -5",
    "git --no-pager diff HEAD~1",
    "git branch -a",
    "cd /workspace && ls",
    "echo \"home is ${HOME}\"",
    "rg foo 2>&1 | head",
  ])("reads: %s", (command) => {
    expect(isReadOnlyCommand(command)).toBe(true);
  });

  it.each([
    "rm -rf /tmp/x",
    "ls > out.txt",
    "echo hi >> ~/.bashrc",
    "cat <<EOF\nx\nEOF",
    "ls $(rm -rf /)",
    "ls `whoami`",
    "find . -delete",
    "find . -exec rm {} +",
    "sort -o out.txt in.txt",
    "rg --pre ./evil foo",
    "git push",
    "git branch new-branch",
    "git -c core.pager=evil log",
    "ls & rm x",
    "ls |",
    "FOO=bar ls",
    "/bin/rm x",
    "cat ~/.ssh/id_rsa",
    "cat .env",
    "head /proc/self/environ",
    "echo $GITHUB_TOKEN",
    "echo $env:GH_PAT",
    "echo $1",
    "ls; curl https://example.com",
    "xargs rm < list",
    "(ls)",
    "date -s 2020-01-01",
    "git stash",
    "git stash -a",
    "sort -uo out.txt in.txt",
    "sort -ro/tmp/x a",
    "sort --compress-program=sh a",
    "printf -v PATH /tmp/e; ls",
    "cat ~/.ss?/id_*",
    "cd ~; cd .s*; cat *",
    "grep -r PRIVATE ~",
    "rg PRIVATE /",
    "cat \\\\evil\\s\\x",
    "git -c core.pager=less log",
    "",
  ])("does not read only: %s", (command) => {
    expect(isReadOnlyCommand(command)).toBe(false);
  });
});

describe("singleProgramOf", () => {
  it("names the one program of a plain line", () => {
    expect(singleProgramOf("npm test")).toBe("npm");
    expect(singleProgramOf("npm run build")).toBe("npm");
  });
  it("keeps an exact rule for anything else", () => {
    expect(singleProgramOf("npm test; rm -rf x")).toBeUndefined();
    expect(singleProgramOf("npm test > log")).toBeUndefined();
    expect(singleProgramOf("./run.sh")).toBeUndefined();
    expect(singleProgramOf("npm $(evil)")).toBeUndefined();
    for (const line of ["cd / && rm -rf *", "bash -lc 'rm x'", "env rm -rf /", "sudo rm x", "xargs rm", "git -C /other push --force", "curl https://x"]) {
      expect(singleProgramOf(line)).toBeUndefined();
    }
  });
});

describe("runCommandOf", () => {
  it("reads the command of the arguments, flat or nested", () => {
    expect(runCommandOf(JSON.stringify({ command: "ls" }))).toBe("ls");
    expect(runCommandOf(JSON.stringify({ name: "run_command", arguments: { command: "pwd" } }))).toBe("pwd");
    expect(runCommandOf("not json")).toBeUndefined();
  });
});

describe("isReadOnlyCommand: security review of #965", () => {
  it("knows a secret path written with backslashes, even unquoted", () => {
    for (const line of [
      "cat C:\\Users\\bob\\.ssh\\id_rsa",
      "cat 'C:\\Users\\bob\\.ssh\\id_rsa'",
      "type C:\\Users\\bob\\.aws\\credentials",
      "cat C:\\repo\\.env",
      "cat C:\\Users\\bob\\.config\\gh\\hosts.yml",
    ]) expect(isReadOnlyCommand(line)).toBe(false);
  });

  it("refuses PowerShell drives, provider paths and network paths anywhere", () => {
    for (const line of [
      "ls env:",
      "cat env:PATH",
      "ls HKLM:\\Software",
      "cat Microsoft.PowerShell.Core\\FileSystem::\\\\host\\share\\x",
      "ls \\\\host\\share",
      "cat x \\\\host\\share",
    ]) expect(isReadOnlyCommand(line)).toBe(false);
  });

  it("refuses a carriage return and Unicode quote or space lookalikes", () => {
    for (const line of [
      "ls\rrm -rf x",
      "echo \u201ca\u201d; ls",
      "echo \u2018a\u2019",
      "ls\u00a0-la",
      "ls\u2028rm x",
      "echo \uff02a\uff02",
      "ls\u200b",
    ]) expect(isReadOnlyCommand(line)).toBe(false);
    expect(isReadOnlyCommand("ls -la ~/Desktop")).toBe(true);
    expect(isReadOnlyCommand("echo https://example.test")).toBe(true);
  });
});
