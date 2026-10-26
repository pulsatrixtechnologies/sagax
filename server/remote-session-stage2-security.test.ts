// Stage-2 security re-review of #939: owner trust, Flow folder binding, the
// closed sentinel, the cached scan, pruning, and the engine read deny.
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { remoteSupportDenyRules } from "./drivers/claude.ts";
import { bindFlowOwner, flowOwner, pruneSupportSessions, readTunnel, supportOwnersOfId } from "./remote-session-probe.ts";
import { absorbStatus, forgetAddress, markSessionClosed, ownerOf, rememberSession } from "./remote-support-local.ts";

const ADDRESS = "tcABCDEFGHJKMNPQRSTUVWXYZ234567890abcd";
const ID = "0123456789ab";
const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
function temp(p: string): string { const d = mkdtempSync(path.join(tmpdir(), p)); roots.push(d); return d; }

describe("owner trust (finding b)", () => {
  it("takes the owner only from the server answer, never an env fallback", () => {
    expect(ownerOf({ owner: { principalId: "Person-A", botId: "bot-1" } })).toEqual({ principalId: "person-a", botId: "bot-1" });
    expect(ownerOf({})).toBeNull();
    expect(ownerOf({ owner: { principalId: "", botId: "bot-1" } })).toBeNull();
  });
});

describe("Flow folder binding (finding c)", () => {
  function flowFolder(home: string, id = ID) {
    const dir = path.join(home, "tailcat", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "client.private.json"), "{}\n");
    writeFileSync(path.join(dir, "address"), `${ADDRESS}\n`);
    return dir;
  }

  it("binds the folder to the first publisher and refuses another", () => {
    const home = temp("sagax-flow-");
    flowFolder(home);
    expect(bindFlowOwner(home, ID, { principalId: "person-a", botId: "bot-1" })).toBe("bound");
    expect(flowOwner(home, ID)).toEqual({ principalId: "person-a", botId: "bot-1" });
    expect(bindFlowOwner(home, ID, { principalId: "person-a", botId: "bot-1" })).toBe("match");
    expect(bindFlowOwner(home, ID, { principalId: "person-b", botId: "bot-2" })).toBe("other");
    expect(bindFlowOwner(temp("sagax-flow-empty-"), ID, { principalId: "person-a", botId: "bot-1" })).toBe("no-folder");
  });

  it("resolves the tunnel only for the bound owner", () => {
    const home = temp("sagax-flow-");
    flowFolder(home);
    bindFlowOwner(home, ID, { principalId: "person-a", botId: "bot-1" });
    expect(readTunnel(home, { id: ID, principalId: "person-a", botId: "bot-1" })).toEqual({ keyPath: path.join(home, "tailcat", ID, "client.private.json"), address: ADDRESS });
    expect(readTunnel(home, { id: ID, principalId: "person-b", botId: "bot-1" })).toBeNull();
    expect(readTunnel(home, { id: ID, principalId: "person-a", botId: "bot-2" })).toBeNull();
  });
});

describe("closed sentinel (finding e)", () => {
  it("a late status cannot write the address back after close", async () => {
    const dir = temp("sagax-support-");
    writeFileSync(path.join(dir, "technician.private.json"), "{}\n", { mode: 0o600 });
    await rememberSession(dir, "BQDHS7", ID, { principalId: "person-a", botId: "bot-1" });
    writeFileSync(path.join(dir, "sessions", "BQDHS7", "address"), `${ADDRESS}\n`);
    await markSessionClosed(dir, "BQDHS7");
    expect(existsSync(path.join(dir, "sessions", "BQDHS7", "address"))).toBe(false);
    // a late connected status tries to store the address again
    const run = async () => ({ code: 0, stdout: "", stderr: "", error: undefined }) as never;
    const absorbed = await absorbStatus({ dir, code: "BQDHS7", raw: { state: "connected", address: ADDRESS }, run, keyPath: null });
    expect(existsSync(path.join(dir, "sessions", "BQDHS7", "address"))).toBe(false);
    expect(absorbed.text).not.toContain(ADDRESS);
  });

  it("forgetAddress still removes the address file", async () => {
    const dir = temp("sagax-support-");
    await rememberSession(dir, "BQDHS7", ID, { principalId: "person-a", botId: "bot-1" });
    writeFileSync(path.join(dir, "sessions", "BQDHS7", "address"), `${ADDRESS}\n`);
    await forgetAddress(dir, "BQDHS7");
    expect(existsSync(path.join(dir, "sessions", "BQDHS7", "address"))).toBe(false);
  });
});

describe("scan cache and pruning (finding f)", () => {
  it("prunes support folders untouched for over 48 hours and keeps fresh ones", async () => {
    const dir = temp("sagax-support-");
    await rememberSession(dir, "QQQ222", ID, { principalId: "person-a", botId: "bot-1" });
    await rememberSession(dir, "RRR333", "0123456789ff", { principalId: "person-a", botId: "bot-1" });
    const old = path.join(dir, "sessions", "QQQ222");
    const longAgo = (Date.now() - 72 * 60 * 60 * 1000) / 1000;
    utimesSync(old, longAgo, longAgo);
    const removed = pruneSupportSessions(dir, Date.now());
    expect(removed).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(path.join(dir, "sessions", "RRR333"))).toBe(true);
  });

  it("the cached scan still answers the right owners after a change", async () => {
    const dir = temp("sagax-support-");
    await rememberSession(dir, "AAAQ22", ID, { principalId: "person-a", botId: "bot-1" });
    expect(supportOwnersOfId(dir, ID)).toEqual([{ code: "AAAQ22", principalId: "person-a", botId: "bot-1" }]);
    // a second folder for the same id by another bot: the directory mtime bumps, rescan
    await rememberSession(dir, "BBBQ33", ID, { principalId: "person-a", botId: "bot-2" });
    // touch the sessions dir so the mtime certainly differs from the cached one
    const now = Date.now() / 1000 + 5;
    utimesSync(path.join(dir, "sessions"), now, now);
    const owners = supportOwnersOfId(dir, ID).sort((a, b) => a.code.localeCompare(b.code));
    expect(owners).toEqual([
      { code: "AAAQ22", principalId: "person-a", botId: "bot-1" },
      { code: "BBBQ33", principalId: "person-a", botId: "bot-2" },
    ]);
    void statSync;
  });
});

describe("engine read deny (finding a)", () => {
  it("denies Read, Glob and Grep of the remote-support folder", () => {
    const rules = remoteSupportDenyRules();
    expect(rules.some((r) => r.startsWith("Read(") && r.includes("remote-support"))).toBe(true);
    expect(rules.some((r) => r.startsWith("Glob("))).toBe(true);
    expect(rules.some((r) => r.startsWith("Grep("))).toBe(true);
  });
});
