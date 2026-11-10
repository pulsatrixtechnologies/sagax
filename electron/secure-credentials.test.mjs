// The rule this module exists to enforce: "I could not read the store" and
// "the store is empty" are DIFFERENT ANSWERS. Collapsing them is what made a
// keychain hiccup look like the user had never connected anything.
import { describe, expect, it, vi } from "vitest";

import { installCredentialStoreIpc, lastCredentialReset, readSecureCredentials, resetUnreadableCredentials } from "./secure-credentials.mjs";

const transient = () =>
  new Error("safeStorage.decryptStringAsync is temporarily unavailable. Please try again.");

/** deps with sane defaults; each test overrides the one thing it is about */
const deps = (over = {}) => ({
  exists: () => true,
  isAvailable: async () => true,
  readFile: () => Buffer.from("cipher"),
  decrypt: async () => JSON.stringify({ xaiApiKey: "ak_live" }),
  sleep: async () => {},
  ...over,
});

describe("readSecureCredentials", () => {
  it("reports an empty store when no file was ever written", async () => {
    const result = await readSecureCredentials(deps({ exists: () => false }));
    expect(result).toEqual({ status: "empty", credentials: {} });
  });

  it("returns the stored credentials when the store opens", async () => {
    const result = await readSecureCredentials(deps());
    expect(result.status).toBe("ok");
    expect(result.credentials).toEqual({ xaiApiKey: "ak_live" });
  });

  it("tries again when the OS says the store is temporarily unavailable", async () => {
    const decrypt = vi
      .fn()
      .mockRejectedValueOnce(transient())
      .mockRejectedValueOnce(transient())
      .mockResolvedValue(JSON.stringify({ xaiApiKey: "ak_live" }));
    const result = await readSecureCredentials(deps({ decrypt }));
    expect(decrypt).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("ok");
    expect(result.credentials).toEqual({ xaiApiKey: "ak_live" });
  });

  it("waits between attempts instead of hammering the keychain", async () => {
    const slept = [];
    const decrypt = vi.fn().mockRejectedValueOnce(transient()).mockResolvedValue("{}");
    await readSecureCredentials(deps({ decrypt, sleep: async (ms) => slept.push(ms) }));
    expect(slept).toEqual([100]);
  });

  it("says UNAVAILABLE — never empty — when every attempt fails", async () => {
    const decrypt = vi.fn().mockRejectedValue(transient());
    const result = await readSecureCredentials(deps({ decrypt }));
    expect(result.status).toBe("unavailable");
    expect(result.credentials).toEqual({});
    expect(result.error).toMatch(/temporarily unavailable/);
    expect(decrypt.mock.calls.length).toBeGreaterThan(1);
  });

  it("says UNAVAILABLE when the OS store itself is switched off", async () => {
    const result = await readSecureCredentials(deps({ isAvailable: async () => false }));
    expect(result.status).toBe("unavailable");
  });

  it("says UNAVAILABLE for a file it cannot parse, rather than pretending it is empty", async () => {
    // retrying cannot fix corruption, but calling it "empty" would invite the
    // caller to register a fresh identity over the top of it
    const decrypt = vi.fn().mockResolvedValue("not json");
    const result = await readSecureCredentials(deps({ decrypt }));
    expect(result.status).toBe("unavailable");
    expect(decrypt).toHaveBeenCalledTimes(1);
  });
});

// Issue #3320: an unreadable store refused every key save with no way out. "Reset saved keys" moves the file aside
// (kept) and restarts, on the person's click alone.
describe("resetUnreadableCredentials", () => {
  const resetDeps = (over = {}) => ({
    unreadable: true,
    quitting: () => false,
    moveAside: vi.fn(),
    log: vi.fn(),
    restart: vi.fn(),
    ...over,
  });

  it("moves the unreadable file aside and restarts on the click, with no second question", async () => {
    const d = resetDeps();
    await expect(resetUnreadableCredentials(d)).resolves.toEqual({ status: "reset" });
    expect(d.moveAside).toHaveBeenCalledTimes(1);
    expect(d.restart).toHaveBeenCalledTimes(1);
  });

  it("never touches a store that was read", async () => {
    const d = resetDeps({ unreadable: false });
    await expect(resetUnreadableCredentials(d)).resolves.toEqual({ status: "readable" });
    expect(d.moveAside).not.toHaveBeenCalled();
    expect(d.restart).not.toHaveBeenCalled();
  });

  it("moves nothing when the app is already quitting, since no restart would follow", async () => {
    const d = resetDeps({ quitting: () => true });
    await expect(resetUnreadableCredentials(d)).resolves.toEqual({ status: "quitting" });
    expect(d.moveAside).not.toHaveBeenCalled();
    expect(d.restart).not.toHaveBeenCalled();
  });

  it("returns the reason and does not restart when the file cannot be moved aside", async () => {
    const busy = Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    const d = resetDeps({ moveAside: vi.fn(() => { throw busy; }) });
    await expect(resetUnreadableCredentials(d)).resolves.toEqual({ status: "failed", error: busy.message });
    expect(d.restart).not.toHaveBeenCalled();
  });

  it("still restarts when the file is already gone", async () => {
    const gone = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
    const d = resetDeps({ moveAside: vi.fn(() => { throw gone; }) });
    await expect(resetUnreadableCredentials(d)).resolves.toEqual({ status: "reset" });
    expect(d.restart).toHaveBeenCalledTimes(1);
  });
});

describe("installCredentialStoreIpc", () => {
  const installed = (over = {}) => {
    const handlers = new Map();
    const deps = {
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      localOnly: vi.fn((_channel, handler) => handler),
      unreadable: () => true,
      quitting: () => false,
      moveAside: vi.fn(),
      log: vi.fn(),
      relaunch: vi.fn(),
      ...over,
    };
    installCredentialStoreIpc(deps);
    return { handlers, deps };
  };

  it("keeps both calls to this app's own page", () => {
    const { deps } = installed();
    expect(deps.localOnly.mock.calls.map(([channel]) => channel)).toEqual(["credential-store:unreadable", "credential-store:reset"]);
  });

  it("answers from the launch read's current result, not one captured at install", async () => {
    let unreadable = false;
    const { handlers, deps } = installed({ unreadable: () => unreadable });
    expect(handlers.get("credential-store:unreadable")()).toBe(false);
    await expect(handlers.get("credential-store:reset")({ sender: {} })).resolves.toEqual({ status: "readable" });
    expect(deps.moveAside).not.toHaveBeenCalled();
    unreadable = true;
    expect(handlers.get("credential-store:unreadable")()).toBe(true);
    await expect(handlers.get("credential-store:reset")({ sender: {} })).resolves.toEqual({ status: "reset" });
    expect(deps.moveAside).toHaveBeenCalledTimes(1);
    expect(deps.relaunch).toHaveBeenCalledTimes(1);
  });
});

describe("lastCredentialReset", () => {
  it("names the newest store moved aside, so the server sets aside what its key sealed", () => {
    expect(lastCredentialReset(["credentials.bin", "config.json"])).toBeNull();
    expect(lastCredentialReset([
      "credentials.bin",
      "credentials.bin.unreadable-1700000000000",
      "credentials.bin.unreadable-1800000000000",
      "credentials.bin.unreadable-999",
      "credentials.bin.unreadable-abc",
      "other.bin.unreadable-1900000000000",
    ])).toBe("1800000000000");
  });
});
