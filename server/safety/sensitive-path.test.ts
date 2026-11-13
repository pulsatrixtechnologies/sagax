import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ownEnvironmentSensitiveRead } from "../people/member-environment.ts";
import { credentialLocation, procSecretPath, resolvedReadRefusal, sensitiveEnvironmentPath } from "./sensitive-path.ts";
import { callUserSandboxTool, type ToolExec } from "../sandbox/user-sandbox-tools.ts";

const hasPython = spawnSync("python3", ["-c", "print(1)"]).status === 0;
// The environment these tools reach is a Linux machine (USER_SANDBOX_TOOLS:
// sh, head, ls, /proc, O_NOFOLLOW on a POSIX path). The cases below run it
// here, on this host's own folders; a Windows host cannot stand in for it:
// its paths do not start at "/", so the resolution fails closed on every
// path and no case of a link, a hard link or a swap can be built (#3569).
const NOT_A_POSIX_HOST = "a Windows host cannot stand in for the Linux environment these tools reach (no sh, no /proc, no POSIX paths)";

describe("process secrets and credential locations (2026-10-17)", () => {
  it("names every /proc environ, cmdline and mem, with or without a task", () => {
    for (const path of [
      "/proc/self/environ", "/proc/1/environ", "/proc/4242/cmdline", "/proc/thread-self/mem", "/proc/self/task/7/environ",
      "/proc/12/task/12/cmdline", "//proc//self/environ", "/proc/self/fd/3", "/proc/1/root/etc/shadow", "/dev/fd/3", "/proc/self/cwd",
    ]) {
      expect(procSecretPath(path), path).toBe(true);
      expect(sensitiveEnvironmentPath(path), path).toBe(true);
      expect(ownEnvironmentSensitiveRead(JSON.stringify({ path })), path).toBe(true);
    }
    for (const path of ["/proc/cpuinfo", "/proc/meminfo", "/workspace/proc/self/environ", "proc/self/environ"]) expect(procSecretPath(path), path).toBe(false);
  });

  it("knows credential locations by folder and by name", () => {
    for (const path of ["/workspace/.ssh/config", "/workspace/.git-credentials", "/workspace/.config/gh/hosts.yml", "/root/.aws/config", "/x/.kube/config", "/x/server.pem", "/x/id_ed25519", "/x/.env.local", "/proc/9/environ"]) {
      expect(credentialLocation(path), path).toBe(true);
    }
    for (const path of ["/workspace/notes.txt", "/workspace/.cache/x", "/workspace/.config/Code/settings.json", "/tmp"]) expect(credentialLocation(path), path).toBe(false);
  });

  it("refuses a read whose links lead somewhere its name did not say", () => {
    expect(resolvedReadRefusal("/workspace/notes.txt", { real: "/workspace/notes.txt", links: [] })).toBeNull();
    expect(resolvedReadRefusal("/workspace/notes.txt", { real: "/workspace/.git-credentials", links: ["/workspace/.git-credentials"] })).toMatch(/credential location/);
    expect(resolvedReadRefusal("/workspace/env", { real: "/proc/77/environ", links: ["/proc/77"] })).toMatch(/\/proc/);
    expect(resolvedReadRefusal("/workspace/rc", { real: "/workspace/.bashrc", links: ["/workspace/.bashrc"] })).toMatch(/dotfile/);
    // a dotfile named outright keeps its card upstream; no link, no refusal here
    expect(resolvedReadRefusal("/workspace/.bashrc", { real: "/workspace/.bashrc", links: [] })).toBeNull();
    // a link to an ordinary folder is fine
    expect(resolvedReadRefusal("/workspace/docs/a.txt", { real: "/workspace/real-docs/a.txt", links: ["/workspace/real-docs"] })).toBeNull();
  });

  it("refuses an ordinary name whose other hard links are a credential file or a dotfile, or could not all be found", () => {
    const plain = { real: "/workspace/notes.txt", links: [] };
    expect(resolvedReadRefusal("notes.txt", { ...plain, aliases: ["/workspace/.git-credentials"], aliasesComplete: true })).toMatch(/hard link/);
    expect(resolvedReadRefusal("notes.txt", { ...plain, aliases: ["/workspace/.ssh/id_ed25519"], aliasesComplete: true })).toMatch(/hard link/);
    expect(resolvedReadRefusal("notes.txt", { ...plain, aliases: ["/workspace/.bashrc"], aliasesComplete: true })).toMatch(/hard link/);
    expect(resolvedReadRefusal("notes.txt", { ...plain, aliases: ["/workspace/proj/deploy.pem"], aliasesComplete: true })).toMatch(/hard link/);
    expect(resolvedReadRefusal("notes.txt", { ...plain, aliases: [], aliasesComplete: false })).toMatch(/could not all be checked/);
    // a package store (pnpm, uv) is fine, even under a dot folder
    expect(resolvedReadRefusal("node_modules/x/package.json", { real: "/workspace/node_modules/x/package.json", links: [], aliases: ["/workspace/.local/share/pnpm/store/v3/files/ab/cdef"], aliasesComplete: true })).toBeNull();
    // a name that is already sensitive got its card on that name
    expect(resolvedReadRefusal(".git-credentials", { real: "/workspace/.git-credentials", links: [], aliases: ["/workspace/.git-credentials.bak"], aliasesComplete: false })).toBeNull();
  });
});

describe.skipIf(!hasPython)("reads in the environment follow no link into a credential location (real folders)", () => {
  const windowsHost = process.platform === "win32";
  let root: string;
  let workspace: string;
  let home: string;
  let ran: string[][];

  /** Runs each exec here, in `workspace`, as the sandbox would. */
  const local = (before?: (argv: string[]) => void): ToolExec => ({
    exec: async (input) => {
      ran.push(input.argv);
      before?.(input.argv);
      const [bin, ...rest] = input.argv;
      const out = spawnSync(bin!, rest, { cwd: workspace, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: root, ...input.env }, encoding: "utf8" });
      return { exitCode: out.status, stdout: out.stdout ?? "", stderr: out.stderr ?? "", truncated: false, timedOut: false };
    },
    overQuota: async () => false,
  });
  const body = (result: { content: Array<{ type: string; text?: string }> }) => result.content.map((part) => part.text ?? "").join("");

  beforeEach((context) => context.skip(windowsHost, NOT_A_POSIX_HOST));

  beforeAll(() => {
    if (windowsHost) return;
    root = realpathSync(mkdtempSync(join(tmpdir(), "sagax-sensitive-path-")));
    workspace = join(root, "workspace");
    home = join(root, "home");
    mkdirSync(join(home, ".ssh"), { recursive: true });
    mkdirSync(join(workspace, "real-docs"), { recursive: true });
    writeFileSync(join(home, ".ssh", "id_rsa"), "PRIVATE KEY\n");
    writeFileSync(join(home, ".ssh", "config"), "Host x\n");
    writeFileSync(join(home, ".git-credentials"), "https://user:ghp_secret@github.com\n");
    writeFileSync(join(home, ".bashrc"), "export TOKEN=1\n");
    writeFileSync(join(workspace, "real-docs", "a.txt"), "plain words\n");
    symlinkSync(join(home, ".git-credentials"), join(workspace, "notes.txt"));
    symlinkSync(join(home, ".ssh"), join(workspace, "keys"));
    symlinkSync(join(home, ".bashrc"), join(workspace, "rc"));
    symlinkSync(join(workspace, "real-docs"), join(workspace, "docs"));
    symlinkSync("/proc/self", join(workspace, "me"));
  });
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("refuses a file link to .git-credentials, a folder link to .ssh and a link to a dotfile", async () => {
    for (const path of ["notes.txt", `${workspace}/notes.txt`, "keys/config", "keys/id_rsa", "keys/not-there-yet", "docs/../keys/config", "rc"]) {
      ran = [];
      const result = await callUserSandboxTool("read_file", { path }, local());
      expect(result.isError, path).toBe(true);
      expect(body(result), path).not.toMatch(/ghp_secret|PRIVATE KEY|TOKEN/);
      // only the resolution ran, never the read
      expect(ran.map((argv) => argv[0]), path).toEqual(["python3"]);
    }
    ran = [];
    const listed = await callUserSandboxTool("list_files", { path: "keys" }, local());
    expect(listed.isError).toBe(true);
    expect(body(listed)).not.toContain("id_rsa");
  });

  it("refuses /proc secrets named outright or reached through a link", async () => {
    for (const path of ["/proc/self/environ", "/proc/1/cmdline", "/proc/thread-self/mem", "/proc/self/task/1/environ", "/dev/fd/0"]) {
      ran = [];
      const result = await callUserSandboxTool("read_file", { path }, local());
      expect(result.isError, path).toBe(true);
      expect(ran, path).toEqual([]);
    }
    ran = [];
    const linked = await callUserSandboxTool("read_file", { path: "me/environ" }, local());
    expect(linked.isError).toBe(true);
    expect(body(linked)).toMatch(/\/proc/);
  });

  it("reads through an ordinary link, on the resolved path", async () => {
    ran = [];
    const result = await callUserSandboxTool("read_file", { path: "docs/a.txt" }, local());
    expect(result.isError).not.toBe(true);
    expect(body(result)).toContain("plain words");
    const listed = await callUserSandboxTool("list_files", { path: "docs" }, local());
    expect(body(listed)).toContain("a.txt");
  });

  it("a link swapped in the asked path after the resolution changes nothing: the checked file is what is read", async () => {
    const swap = join(workspace, "swap");
    symlinkSync(join(workspace, "real-docs"), swap);
    const result = await callUserSandboxTool("read_file", { path: "swap/a.txt" }, local((argv) => {
      if (argv[0] !== "sh") return;
      unlinkSync(swap);
      symlinkSync(home, swap);
    }));
    expect(body(result)).toContain("plain words");
  });

  // Leftovers of #694/#701: hard links and the race between check and use.
  it("refuses an ordinary name that is a hard link to a credential file or a dotfile", async () => {
    linkSync(join(home, ".git-credentials"), join(workspace, "plain.txt"));
    linkSync(join(home, ".ssh", "id_rsa"), join(workspace, "key-copy"));
    linkSync(join(home, ".bashrc"), join(workspace, "shell-notes"));
    try {
      for (const path of ["plain.txt", "key-copy", "shell-notes"]) {
        ran = [];
        const read = await callUserSandboxTool("read_file", { path }, local());
        expect(read.isError, path).toBe(true);
        expect(body(read), path).toMatch(/hard link/);
        expect(body(read), path).not.toMatch(/ghp_secret|PRIVATE KEY|TOKEN/);
        expect(ran.map((argv) => argv[0]), path).toEqual(["python3"]);
        const wrote = await callUserSandboxTool("write_file", { path, content: "overwritten" }, local());
        expect(wrote.isError, path).toBe(true);
      }
      expect(readFileSync(join(home, ".git-credentials"), "utf8")).toContain("ghp_secret");
      expect(readFileSync(join(home, ".ssh", "id_rsa"), "utf8")).toBe("PRIVATE KEY\n");
    } finally {
      for (const name of ["plain.txt", "key-copy", "shell-notes"]) rmSync(join(workspace, name), { force: true });
    }
  });

  it("reads and writes an ordinary file with an ordinary second hard link (a package store)", async () => {
    mkdirSync(join(root, "store"), { recursive: true });
    writeFileSync(join(root, "store", "pkg.json"), "{\"name\":\"x\"}");
    linkSync(join(root, "store", "pkg.json"), join(workspace, "pkg.json"));
    const read = await callUserSandboxTool("read_file", { path: "pkg.json" }, local());
    expect(read.isError, body(read)).not.toBe(true);
    expect(body(read)).toContain("\"name\"");
    const wrote = await callUserSandboxTool("write_file", { path: "pkg.json", content: "{}" }, local());
    expect(wrote.isError, body(wrote)).toBeFalsy();
    expect(readFileSync(join(root, "store", "pkg.json"), "utf8")).toBe("{}");
  });

  it.skipIf(process.getuid?.() === 0)("fails closed when a hard link's other names cannot all be found", async () => {
    writeFileSync(join(workspace, "odd.txt"), "odd\n");
    mkdirSync(join(root, "locked"));
    linkSync(join(workspace, "odd.txt"), join(root, "locked", "x"));
    chmodSync(join(root, "locked"), 0o000);
    try {
      const read = await callUserSandboxTool("read_file", { path: "odd.txt" }, local());
      expect(read.isError).toBe(true);
      expect(body(read)).toMatch(/could not all be checked/);
    } finally {
      chmodSync(join(root, "locked"), 0o700);
    }
  });

  it("refuses when the checked file is swapped for a link or a hard link before it is opened", async () => {
    const target = join(workspace, "real-docs", "swapped.txt");
    for (const swapIn of [
      () => symlinkSync(join(home, ".git-credentials"), target),
      () => linkSync(join(home, ".git-credentials"), target),
    ]) {
      writeFileSync(target, "fine\n");
      const result = await callUserSandboxTool("read_file", { path: "real-docs/swapped.txt" }, local((argv) => {
        if (argv[0] !== "sh") return;
        unlinkSync(target);
        swapIn();
      }));
      expect(result.isError).toBe(true);
      expect(body(result)).toMatch(/changed/);
      expect(body(result)).not.toContain("ghp_secret");
      unlinkSync(target);
    }
  });

  it("refuses when a folder of the checked path becomes a link before it is opened", async () => {
    const folder = join(workspace, "moving");
    mkdirSync(folder);
    writeFileSync(join(folder, "a.txt"), "fine\n");
    mkdirSync(join(home, "secret-dir"));
    writeFileSync(join(home, "secret-dir", "a.txt"), "SECRET\n");
    const result = await callUserSandboxTool("read_file", { path: "moving/a.txt" }, local((argv) => {
      if (argv[0] !== "sh") return;
      renameSync(folder, `${folder}-old`);
      symlinkSync(join(home, "secret-dir"), folder);
    }));
    expect(result.isError).toBe(true);
    expect(body(result)).toMatch(/changed/);
    expect(body(result)).not.toContain("SECRET");
  });

  it("write_file: a target swapped for a hard link to a credential file, or a folder swapped for a link into .ssh, is refused and left alone", async () => {
    const target = join(workspace, "real-docs", "out.txt");
    writeFileSync(target, "before\n");
    const swapped = await callUserSandboxTool("write_file", { path: "real-docs/out.txt", content: "attacker" }, local((argv) => {
      if (argv[0] !== "sh") return;
      unlinkSync(target);
      linkSync(join(home, ".git-credentials"), target);
    }));
    expect(swapped.isError).toBe(true);
    expect(body(swapped)).toMatch(/changed/);
    expect(readFileSync(join(home, ".git-credentials"), "utf8")).toContain("ghp_secret");
    unlinkSync(target);

    const folder = join(workspace, "drop");
    mkdirSync(folder);
    const created = await callUserSandboxTool("write_file", { path: "drop/authorized_keys", content: "ssh-ed25519 AAAA attacker" }, local((argv) => {
      if (argv[0] !== "sh") return;
      renameSync(folder, `${folder}-old`);
      symlinkSync(join(home, ".ssh"), folder);
    }));
    expect(created.isError).toBe(true);
    expect(body(created)).toMatch(/changed/);
    expect(existsSync(join(home, ".ssh", "authorized_keys"))).toBe(false);
  });

  it("write_file keeps the target's mode and writes the exact contents through the guard", async () => {
    const target = join(workspace, "real-docs", "mode.sh");
    writeFileSync(target, "old", { mode: 0o750 });
    const content = "#!/bin/sh\necho 'q' \"d\" $(id) é\n";
    const wrote = await callUserSandboxTool("write_file", { path: "real-docs/mode.sh", content }, local());
    expect(wrote.isError, body(wrote)).toBeFalsy();
    expect(readFileSync(target, "utf8")).toBe(content);
    expect(spawnSync("sh", ["-c", `test -x "${target}"`]).status).toBe(0);
  });
});
