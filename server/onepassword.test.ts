import { describe, expect, it, vi } from "vitest";

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { fieldValue, locateOp, OnePassword, safeBinaryPath, type ExecFileFn, type FetchFn } from "./onepassword.ts";
import { onePasswordCanAdd, onePasswordImportKind } from "../shared/credential-vault.ts";

const FAKE_OP = "/opt/fake-1password/bin/op";
const located = async () => FAKE_OP;

// safeBinaryPath checks every folder up to the root. On Linux tmpdir() is
// /tmp, which everyone may write (1777), and the test setup points HOME
// below it: a binary there is rightly refused. The fixtures go under the
// first base whose whole chain belongs to root or to this user and is not
// writable by group or others (the checkout's node_modules/.cache on Linux).
function chainIsPrivate(folder: string): boolean {
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  for (let at = folder; ; at = dirname(at)) {
    const stats = statSync(at);
    if ((stats.mode & 0o022) !== 0 || (stats.uid !== 0 && stats.uid !== uid)) return false;
    if (dirname(at) === at) return true;
  }
}
function privateBase(): string | null {
  for (const base of [tmpdir(), homedir(), join(process.cwd(), "node_modules", ".cache")]) {
    try {
      mkdirSync(base, { recursive: true });
      const real = realpathSync(base);
      if (chainIsPrivate(real)) return real;
    } catch {
      // try the next base
    }
  }
  return null;
}
// POSIX mode bits and owners: Windows has neither, and safeBinaryPath is
// always null there.
const posixBase = process.platform === "win32" ? null : privateBase();
const posixOnly = it.skipIf(posixBase === null);

// Fake 1Password answers; no real account or secret is involved.
const ITEM = {
  id: "abc123",
  fields: [
    { id: "username", purpose: "USERNAME", value: "ada.fake@example.test" },
    { id: "password", purpose: "PASSWORD", value: "fake-1p-password" },
    { id: "otp1", type: "OTP", value: "otpauth://totp/x?secret=GEZDGNBV", totp: "123456" },
  ],
};

describe("1Password", () => {
  it("is off when op is absent, signed out, or on an organization server", async () => {
    const absent: ExecFileFn = vi.fn(async () => { throw new Error("ENOENT"); });
    await expect(new OnePassword({ env: {}, exec: absent, organization: () => false, locate: located }).status()).resolves.toEqual({ available: false, reason: "absent" });
    // No trusted install path: op is never run, whatever PATH says.
    const neverRun = vi.fn<ExecFileFn>(async () => "2.30.0");
    await expect(new OnePassword({ env: { PATH: "/tmp/evil" }, exec: neverRun, organization: () => false, locate: async () => null }).status()).resolves.toEqual({ available: false, reason: "absent" });
    expect(neverRun).not.toHaveBeenCalled();
    const signedOut: ExecFileFn = vi.fn(async (_command, args) => args[0] === "--version" ? "2.30.0\n" : "[]");
    await expect(new OnePassword({ env: {}, exec: signedOut, organization: () => false, locate: located }).status()).resolves.toMatchObject({ available: false, reason: "signed_out" });
    const exec = vi.fn<ExecFileFn>(async () => "[]");
    await expect(new OnePassword({ env: {}, exec, organization: () => true }).status()).resolves.toEqual({ available: false, reason: "organization" });
    expect(exec).not.toHaveBeenCalled();
  });

  it("BLOCKER 3: runs op only from its absolute path, with a short environment that carries no Sagax or provider key", async () => {
    const exec = vi.fn<ExecFileFn>(async (_command, args) => {
      if (args[0] === "--version") return "2.30.0";
      if (args[0] === "account") return JSON.stringify([{ account_uuid: "x" }]);
      if (args[0] === "item" && args[1] === "list") return JSON.stringify([
        { id: "abc123", title: "Example", category: "LOGIN", vault: { id: "v1", name: "Private" }, urls: [{ href: "https://login.example.test/x" }] },
        { id: "bad id!", title: "Skipped", vault: { id: "v1" } },
      ]);
      return JSON.stringify(ITEM);
    });
    const op = new OnePassword({
      env: { PATH: "/Users/someone/writable/bin", HOME: "/Users/someone", OP_SESSION_x: "must-not-pass", OP_ACCOUNT: "fake.1password.test", SAGAX_MCP_OAUTH_KEY: "ab".repeat(32), ANTHROPIC_API_KEY: "fake-provider-key", XAI_API_KEY: "fake-xai-key" },
      exec, organization: () => false, locate: located,
    });
    await expect(op.listItems()).resolves.toEqual([{ id: "abc123", vaultId: "v1", vaultName: "Private", title: "Example", category: "LOGIN", domains: ["login.example.test"] }]);
    await expect(op.readField({ via: "cli", vaultId: "v1", itemId: "abc123" }, "password")).resolves.toBe("fake-1p-password");
    const get = exec.mock.calls.find(([, args]) => args[1] === "get")!;
    expect(get[0]).toBe(FAKE_OP);
    expect(exec.mock.calls.every(([command]) => command === FAKE_OP)).toBe(true);
    expect(get[2].env.PATH).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
    expect(get[2].env.HOME).toBe("/Users/someone");
    expect(Object.keys(get[2].env).filter((key) => /KEY|TOKEN|SECRET/.test(key))).toEqual([]);
    expect(get[1]).toEqual(["item", "get", "abc123", "--vault", "v1", "--reveal", "--format=json"]);
    expect(get[2].env.OP_SESSION_x).toBeUndefined();
    expect(get[2].env.OP_ACCOUNT).toBe("fake.1password.test");
    expect(get[2].env.OP_CACHE).toBe("false");
    // An id that is not one is never passed to the command.
    await expect(op.readField({ via: "cli", vaultId: "v1", itemId: "--help" }, "password")).resolves.toBeNull();
  });

  it("never accepts a binary on Windows, where mode bits and owners say nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-op-win-"));
    try {
      const file = join(dir, "op");
      writeFileSync(file, "#!/bin/sh\n");
      expect(safeBinaryPath(file, "win32")).toBeNull();
      if (process.platform === "win32") expect(safeBinaryPath(file)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    await expect(locateOp("win32")).resolves.toBeNull();
  });

  // Linux: /tmp is 1777, so a binary below it never runs, whatever its own mode.
  it.skipIf(process.platform === "win32" || posixBase === realpathSync(tmpdir()))("refuses a binary below a temp folder everyone may write", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-op-shared-"));
    try {
      chmodSync(dir, 0o755);
      const file = join(dir, "op");
      writeFileSync(file, "#!/bin/sh\n");
      chmodSync(file, 0o755);
      expect(safeBinaryPath(file)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  posixOnly("accepts a binary only when neither it nor its folder is writable by others", async () => {
    const dir = mkdtempSync(join(posixBase!, "sagax-op-"));
    try {
      chmodSync(dir, 0o755);
      const file = join(dir, "op");
      writeFileSync(file, "#!/bin/sh\n");
      chmodSync(file, 0o755);
      expect(safeBinaryPath(file)).not.toBeNull();
      chmodSync(file, 0o777);
      expect(safeBinaryPath(file)).toBeNull();
      chmodSync(file, 0o755);
      chmodSync(dir, 0o777);
      expect(safeBinaryPath(file)).toBeNull();
      expect(safeBinaryPath(join(dir, "missing"))).toBeNull();
    } finally {
      chmodSync(dir, 0o755);
      rmSync(dir, { recursive: true, force: true });
    }
    await expect(locateOp("win32")).resolves.toBeNull();
  });

  posixOnly("refuses a binary under any folder others can write", async () => {
    const dir = mkdtempSync(join(posixBase!, "sagax-op-up-"));
    const middle = join(dir, "open");
    const inner = join(middle, "bin");
    try {
      mkdirSync(inner, { recursive: true });
      for (const folder of [dir, inner]) chmodSync(folder, 0o755);
      chmodSync(middle, 0o777);
      const file = join(inner, "op");
      writeFileSync(file, "#!/bin/sh\n");
      chmodSync(file, 0o755);
      expect(safeBinaryPath(file)).toBeNull();
      chmodSync(middle, 0o755);
      expect(safeBinaryPath(file)).not.toBeNull();
    } finally {
      chmodSync(middle, 0o755);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("locates op again before every run", async () => {
    const locate = vi.fn(located);
    const exec = vi.fn<ExecFileFn>(async (_command, args) => args[0] === "account" ? JSON.stringify([{ account_uuid: "x" }]) : args[0] === "item" ? "[]" : "2.30.0");
    const op = new OnePassword({ env: {}, exec, organization: () => false, locate });
    await op.status(true);
    await op.listItems();
    expect(locate.mock.calls.length).toBeGreaterThanOrEqual(exec.mock.calls.length);
  });

  it("uses Connect when it is configured", async () => {
    const fetch = vi.fn<FetchFn>(async (url) => ({
      ok: true,
      status: 200,
      json: async () => url.endsWith("/v1/vaults") ? [{ id: "v1", name: "Ops" }]
        : url.endsWith("/items") ? [{ id: "abc123", title: "Example", category: "LOGIN", urls: [{ href: "https://example.test" }] }]
          : ITEM,
    }));
    const op = new OnePassword({ env: { OP_CONNECT_HOST: "https://connect.example.test", OP_CONNECT_TOKEN: "fake-connect-token" }, fetch, organization: () => false });
    await expect(op.status()).resolves.toEqual({ available: true, via: "connect" });
    await expect(op.listItems()).resolves.toMatchObject([{ id: "abc123", vaultName: "Ops", domains: ["example.test"] }]);
    await expect(op.readField({ via: "connect", vaultId: "v1", itemId: "abc123" }, "totp")).resolves.toBe("123456");
    expect(fetch.mock.calls[0]![1].headers.Authorization).toBe("Bearer fake-connect-token");
  });

  it("reads each field by its purpose", () => {
    expect(fieldValue(ITEM, "username")).toBe("ada.fake@example.test");
    expect(fieldValue(ITEM, "password")).toBe("fake-1p-password");
    expect(fieldValue(ITEM, "totp")).toBe("123456");
    expect(fieldValue({ fields: [{ id: "credential", value: "fake-api-credential" }] }, "apiKey")).toBe("fake-api-credential");
    expect(fieldValue({}, "password")).toBeNull();
  });

  it("offers a login's extra fields and a text-only item as secrets", () => {
    expect(fieldValue({
      category: "LOGIN",
      fields: [
        { id: "password", purpose: "PASSWORD", value: "fake-1p-password" },
        { id: "client", label: "Client Secret", type: "CONCEALED", value: "fake-client-secret" },
      ],
    }, "apiKey")).toBe("fake-client-secret");
    expect(fieldValue({ category: "SECURE_NOTE", notesPlain: "fake-note-text", fields: [] }, "apiKey")).toBe("fake-note-text");
    expect(onePasswordImportKind("LOGIN", [])).toBe("apiKey");
    expect(onePasswordImportKind("SECURE_NOTE", [])).toBe("note");
    expect(onePasswordImportKind("Login", ["example.test"])).toBe("login");
    expect(onePasswordCanAdd({ category: "LOGIN", domains: [] })).toBe(true);
    expect(onePasswordCanAdd({ category: "LOGIN", domains: ["example.test"] })).toBe(true);
  });
});
