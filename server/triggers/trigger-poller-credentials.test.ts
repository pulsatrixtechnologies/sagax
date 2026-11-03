// Poller credentials: sealed with the vault key, mode 0600, write only.
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { TRIGGER_POLLER_CREDENTIALS_FILE, TriggerPollerCredentials } from "./trigger-poller-credentials.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function store(key = randomBytes(32)) {
  const dir = mkdtempSync(join(tmpdir(), "omb-poller-creds-"));
  dirs.push(dir);
  return { dir, key, credentials: new TriggerPollerCredentials(dir, () => ({ kind: "key" as const, key })) };
}

describe("TriggerPollerCredentials", () => {
  it("seals the password and ICS link, 0600, and reads them back", () => {
    const { dir, key, credentials } = store();
    credentials.set("w1", { password: "pa55-SECRET" });
    credentials.set("w2", { url: "webcal://cal.example.com/private-abc123/basic.ics" });
    const raw = readFileSync(join(dir, TRIGGER_POLLER_CREDENTIALS_FILE), "utf8");
    expect(raw).not.toContain("pa55-SECRET");
    expect(raw).not.toContain("private-abc123");
    if (process.platform !== "win32") expect(statSync(join(dir, TRIGGER_POLLER_CREDENTIALS_FILE)).mode & 0o777).toBe(0o600);
    const reopened = new TriggerPollerCredentials(dir, () => ({ kind: "key" as const, key }));
    expect(reopened.get("w1")).toEqual({ password: "pa55-SECRET" });
    expect(reopened.get("w2")).toEqual({ url: "https://cal.example.com/private-abc123/basic.ics" });
    expect(reopened.has("w1", "password")).toBe(true);
    expect(reopened.has("w1", "url")).toBe(false);
  });

  it("refuses a link that is not https, clears a field with an empty string, forgets a trigger", () => {
    const { credentials } = store();
    expect(() => credentials.set("w1", { url: "http://cal.example.com/x.ics" })).toThrow(/https/);
    credentials.set("w1", { password: "one" });
    credentials.set("w1", { password: "" });
    expect(credentials.get("w1")).toBeUndefined();
    credentials.set("w1", { password: "two" });
    credentials.remove("w1");
    expect(credentials.get("w1")).toBeUndefined();
  });

  it("reads nothing with another key, without saying what the file held", () => {
    const { dir, credentials } = store();
    credentials.set("w1", { password: "pa55-SECRET" });
    const other = new TriggerPollerCredentials(dir, () => ({ kind: "key" as const, key: randomBytes(32) }));
    expect(other.get("w1")).toBeUndefined();
    expect(() => other.set("w2", { password: "x" })).toThrow(/could not be read/);
  });
});
