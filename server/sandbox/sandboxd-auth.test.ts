import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readSandboxdKey,
  readSandboxdKeys,
  SANDBOXD_KEY_RECHECK_MS,
  sandboxdKeySource,
  SandboxdVerifier,
  signSandboxdRequest,
} from "./sandboxd-auth.ts";

const OLD = "a".repeat(64);
const NEW = "b".repeat(64);
const OTHER = "c".repeat(64);

let dir = "";
function keyFile(content: string): string {
  dir ||= mkdtempSync(join(tmpdir(), "sandboxd-auth-"));
  const file = join(dir, "key");
  writeFileSync(file, content);
  return file;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
  vi.restoreAllMocks();
});

describe("sandboxd key rotation", () => {
  it("reads one key, or two during a rotation, and signs with the first", () => {
    expect(readSandboxdKeys(keyFile(`${OLD}\n`))).toEqual([OLD]);
    expect(readSandboxdKeys(keyFile(`${NEW}\n${OLD}\n`))).toEqual([NEW, OLD]);
    expect(readSandboxdKey(keyFile(`${NEW}\r\n${OLD}\r\n`))).toBe(NEW);
  });

  it("refuses an empty file, a third key, a duplicate or a malformed line", () => {
    expect(() => readSandboxdKeys(keyFile("\n"))).toThrow(/does not hold a sandboxd key/);
    expect(() => readSandboxdKeys(keyFile(`${OLD}\n${NEW}\n${OTHER}\n`))).toThrow();
    expect(() => readSandboxdKeys(keyFile(`${OLD}\n${OLD}\n`))).toThrow();
    expect(() => readSandboxdKeys(keyFile(`${OLD}\nnot-a-key\n`))).toThrow();
  });

  it("verifies a signature made with either key during the overlap, and no other", () => {
    const verifier = new SandboxdVerifier([OLD, NEW]);
    expect(verifier.verify(signSandboxdRequest(OLD, "POST", "/v1/x", "{}"), "POST", "/v1/x", "{}")).toBe(true);
    expect(verifier.verify(signSandboxdRequest(NEW, "POST", "/v1/x", "{}"), "POST", "/v1/x", "{}")).toBe(true);
    expect(verifier.verify(signSandboxdRequest(OTHER, "POST", "/v1/x", "{}"), "POST", "/v1/x", "{}")).toBe(false);
  });

  it("still refuses a replay when several keys are accepted", () => {
    const verifier = new SandboxdVerifier([OLD, NEW]);
    const header = signSandboxdRequest(NEW, "GET", "/v1/status", "");
    expect(verifier.verify(header, "GET", "/v1/status", "")).toBe(true);
    expect(verifier.verify(header, "GET", "/v1/status", "")).toBe(false);
  });

  it("keeps the single-key constructor", () => {
    const verifier = new SandboxdVerifier(OLD);
    expect(verifier.verify(signSandboxdRequest(OLD, "GET", "/v1/status", ""), "GET", "/v1/status", "")).toBe(true);
    expect(() => new SandboxdVerifier([OLD, NEW, OTHER])).toThrow();
    expect(() => new SandboxdVerifier([])).toThrow();
  });

  it("follows the key file through old, both, new without a restart", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    let now = 1_000_000;
    const file = keyFile(`${OLD}\n`);
    const source = sandboxdKeySource(file, () => now);
    const verifier = new SandboxdVerifier(source, () => now);
    const signed = (key: string) => verifier.verify(signSandboxdRequest(key, "GET", "/v1/status", "", now), "GET", "/v1/status", "");
    expect(signed(OLD)).toBe(true);
    expect(signed(NEW)).toBe(false);

    writeFileSync(file, `${OLD}\n${NEW}\n`);
    utimesSync(file, new Date(now + 1), new Date(now + 1));
    now += SANDBOXD_KEY_RECHECK_MS;
    expect(signed(OLD)).toBe(true);
    expect(signed(NEW)).toBe(true);

    writeFileSync(file, `${NEW}\n`);
    utimesSync(file, new Date(now + 2), new Date(now + 2));
    now += SANDBOXD_KEY_RECHECK_MS;
    expect(signed(NEW)).toBe(true);
    expect(signed(OLD)).toBe(false);
  });

  it("keeps the last good keys when the file is broken mid-rotation", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let now = 1_000_000;
    const file = keyFile(`${OLD}\n`);
    const source = sandboxdKeySource(file, () => now);
    writeFileSync(file, "garbage\n");
    utimesSync(file, new Date(now + 1), new Date(now + 1));
    now += SANDBOXD_KEY_RECHECK_MS;
    expect(source()).toEqual([OLD]);
    rmSync(file);
    now += SANDBOXD_KEY_RECHECK_MS;
    expect(source()).toEqual([OLD]);
  });

  it("does not reread the file before the recheck interval", () => {
    let now = 1_000_000;
    const file = keyFile(`${OLD}\n`);
    const source = sandboxdKeySource(file, () => now);
    writeFileSync(file, `${NEW}\n`);
    utimesSync(file, new Date(now + 1), new Date(now + 1));
    now += SANDBOXD_KEY_RECHECK_MS - 1;
    expect(source()).toEqual([OLD]);
  });
});
