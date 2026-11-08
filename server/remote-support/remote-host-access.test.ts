import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hostAccessGate, RemoteHostAccess } from "./remote-host-access.ts";

const HOST = `h_${"ab".repeat(16)}`;
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const file = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "remote-host-access-"));
  dirs.push(dir);
  return path.join(dir, "access.json");
};

describe("RemoteHostAccess", () => {
  it("defaults to always, keeps each person's choice apart and persists it", () => {
    const where = file();
    const store = new RemoteHostAccess(where, () => 5);
    expect(store.get("Tech@Example.org", HOST)).toBe("always");
    store.set("Tech@Example.org", HOST, "ask");
    expect(store.get("tech@example.org", HOST)).toBe("ask");
    expect(store.get("other@example.org", HOST)).toBe("always");
    expect(new RemoteHostAccess(where).get("tech@example.org", HOST)).toBe("ask");
    store.set("tech@example.org", HOST, "always");
    expect(JSON.parse(readFileSync(where, "utf8")).hosts).toEqual([]);
  });

  it("reads a damaged file as the default", () => {
    const where = file();
    writeFileSync(where, "{nope");
    expect(new RemoteHostAccess(where).get("tech@example.org", HOST)).toBe("always");
  });
});

describe("hostAccessGate", () => {
  it("lets always through without asking", async () => {
    const ask = vi.fn(async () => true);
    expect(await hostAccessGate({ access: "always", hostName: "PC-A", ask })).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });

  it("refuses never without asking", async () => {
    const ask = vi.fn(async () => true);
    expect(await hostAccessGate({ access: "never", hostName: "PC-A", ask })).toMatch(/Never allow/);
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks on ask and follows the answer", async () => {
    expect(await hostAccessGate({ access: "ask", hostName: "PC-A", ask: async () => true })).toBeNull();
    expect(await hostAccessGate({ access: "ask", hostName: "PC-A", ask: async () => false })).toMatch(/did not allow/);
  });
});
