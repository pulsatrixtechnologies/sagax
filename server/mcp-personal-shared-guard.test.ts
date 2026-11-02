import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { StoredMcpServer, StoredRemoteMcpServer } from "./mcp-registry.ts";
import { parsePersonalMcpInput, PersonConnections } from "./person-connections.ts";
import {
  AMBIGUOUS_PERSONAL_HEADERS_REFUSAL,
  ambiguousPersonalHeaderRefusal,
  blankHeaderValues,
  collectPersonalMcpNames,
  mcpConnectionScope,
  PERSONAL_HEADER_REFUSAL,
  PERSONAL_SHARED_NAME_REFUSAL,
  personalHeaderRefusal,
  personalSharedNameRefusal,
  SHARED_PERSONAL_NAME_REFUSAL,
  sharedPersonalNameRefusal,
  shouldLookupPersonalConnection,
  skipPersonalInSharedProbe,
} from "./mcp-personal-shared-guard.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const vaultKey = { kind: "key" as const, key: Buffer.alloc(32, 9) };

const remote = (headers: Record<string, string>): StoredRemoteMcpServer => ({
  type: "http",
  url: "https://mail.example.com/mcp",
  headers,
  enabled: true,
});

const stdio = (): StoredMcpServer => ({
  command: "npx",
  args: ["-y", "notes"],
  env: {},
  enabled: true,
});

describe("mcp personal / shared guard (Lot B only-me)", () => {
  it("marks person vs installation scope from the personal name set", () => {
    expect(mcpConnectionScope("mail", ["mail"])).toBe("person");
    expect(mcpConnectionScope("mail", new Set(["docs"]))).toBe("installation");
  });

  it("rejects non-empty personal header values for shared config writes", () => {
    const personal = new Set(["private"]);
    expect(personalHeaderRefusal("private", remote({ Authorization: "Bearer secret-token" }), personal))
      .toBe(PERSONAL_HEADER_REFUSAL);
    expect(personalHeaderRefusal("private", remote({ Authorization: "" }), personal)).toBeNull();
    expect(personalHeaderRefusal("public", remote({ Authorization: "Bearer team-secret" }), personal)).toBeNull();
    expect(personalHeaderRefusal("private", stdio(), personal)).toBeNull();
  });

  it("rejects ambiguous multi-header personal key edits", () => {
    const personal = ["mail"];
    expect(ambiguousPersonalHeaderRefusal("mail", remote({
      Authorization: "Bearer a",
      "X-Api-Key": "b",
    }), personal)).toBe(AMBIGUOUS_PERSONAL_HEADERS_REFUSAL);
    expect(ambiguousPersonalHeaderRefusal("mail", remote({ Authorization: "Bearer a" }), personal)).toBeNull();
    expect(ambiguousPersonalHeaderRefusal("team", remote({
      Authorization: "Bearer a",
      "X-Api-Key": "b",
    }), personal)).toBeNull();
  });

  it("refuses shared create when the name is already personal", () => {
    expect(personalSharedNameRefusal("mail", ["mail"])).toBe(PERSONAL_SHARED_NAME_REFUSAL);
    expect(personalSharedNameRefusal("docs", ["mail"])).toBeNull();
  });

  it("refuses personal create when the name is already shared", () => {
    expect(sharedPersonalNameRefusal("mail", ["mail", "docs"])).toBe(SHARED_PERSONAL_NAME_REFUSAL);
    expect(sharedPersonalNameRefusal("own", ["mail"])).toBeNull();
  });

  it("blanks header values while keeping names (defer until personal setup)", () => {
    expect(blankHeaderValues({ Authorization: "Bearer secret", "X-Tenant": "acme" }))
      .toEqual({ Authorization: "", "X-Tenant": "" });
  });

  it("skips personal servers in shared probes", () => {
    expect(skipPersonalInSharedProbe("mail", ["mail"])).toBe(true);
    expect(skipPersonalInSharedProbe("docs", ["mail"])).toBe(false);
  });

  it("skips personal lookups for known installation or team edits", () => {
    expect(shouldLookupPersonalConnection("installation")).toBe(false);
    expect(shouldLookupPersonalConnection("team")).toBe(false);
    expect(shouldLookupPersonalConnection("person")).toBe(true);
    expect(shouldLookupPersonalConnection(undefined)).toBe(true);
    expect(shouldLookupPersonalConnection("unknown")).toBe(true);
  });

  it("collects personal MCP names across people without leaking store errors", () => {
    const names = collectPersonalMcpNames(["pr_a", "pr_b", "pr_bad"], (id) => {
      if (id === "pr_bad") throw new Error("unreadable");
      if (id === "pr_a") return { mail: {}, notes: {} };
      return { docs: {} };
    });
    expect([...names].sort()).toEqual(["docs", "mail", "notes"]);
  });

  it("never echoes a personal secret in refusal text", () => {
    const secret = "Bearer private-secret-value-xyz";
    const refusal = personalHeaderRefusal("private", remote({ Authorization: secret }), ["private"]);
    expect(refusal).toBe(PERSONAL_HEADER_REFUSAL);
    expect(refusal).not.toContain(secret);
    expect(refusal).not.toContain("private-secret");
  });

  it("keeps a person store token out of a shared config map (isolation)", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-mcp-only-me-"));
    dirs.push(dir);
    const people = new PersonConnections(dir, () => vaultKey);
    const secret = "Bearer alice-only-token-never-shared";
    people.add("pr_alice", "mail", parsePersonalMcpInput({
      name: "mail", url: "https://mail.example.com/mcp", token: secret,
    }, 1).server);

    const shared: Record<string, StoredMcpServer> = {};
    const personalNames = collectPersonalMcpNames(["pr_alice", "pr_bob"], (id) => people.servers(id));
    expect(personalNames.has("mail")).toBe(true);

    const attempted = remote({ Authorization: secret });
    const refusal = personalSharedNameRefusal("mail", personalNames)
      ?? personalHeaderRefusal("mail", attempted, personalNames);
    expect(refusal).toBeTruthy();
    expect(JSON.stringify(refusal)).not.toContain(secret);
    // Shared config stays empty: the write was refused before persist.
    expect(shared).toEqual({});

    // A deferred shared row may keep header names with blank values only.
    const blanked = blankHeaderValues(attempted.headers);
    const deferred: StoredMcpServer = { ...attempted, headers: blanked };
    expect(personalHeaderRefusal("mail", deferred, personalNames)).toBeNull();
    expect(Object.values(blanked).every((value) => value === "")).toBe(true);

    // Bob's empty store never sees Alice's server.
    expect(Object.keys(people.servers("pr_bob"))).toEqual([]);
    expect(skipPersonalInSharedProbe("mail", personalNames)).toBe(true);
    expect(shouldLookupPersonalConnection("installation")).toBe(false);
  });
});
