import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { disableMcpTables, fixAmbientMcp, forgetAmbientMcp, learnAmbientMcp, learnedAmbientMcp, resetAmbientMcpForTests } from "./ambient-mcp.ts";

afterEach(() => resetAmbientMcpForTests());

describe("ambient Codex MCP servers (#2013)", () => {
  it("learns each new name once per account and folder, and forgets on request", () => {
    expect(learnAmbientMcp("/h", "/w", ["notes", "bad name", "notes"])).toBe(true);
    expect(learnAmbientMcp("/h", "/w", ["notes"])).toBe(false);
    expect([...learnedAmbientMcp("/h", "/w")]).toEqual(["notes"]);
    expect(learnedAmbientMcp("/h", "/other").size).toBe(0);
    expect(forgetAmbientMcp("/h", "/w")).toBe(true);
    expect(learnedAmbientMcp("/h", "/w").size).toBe(0);
  });

  it("writes enabled = false into the named tables only, keeping comments and other keys", () => {
    const toml = [
      "# mine",
      "[mcp_servers.notes]",
      "command = \"notes\"",
      "enabled = true",
      "",
      "[mcp_servers.notes.env]",
      "A = \"1\"",
      "",
      "[mcp_servers.\"other one\"]",
      "url = \"https://example.test\"",
      "",
      "[mcp_servers.keep]",
      "command = \"keep\"",
      "",
      "[mcp_servers.last]",
      "command = \"last\"",
      "",
    ].join("\n");
    const out = disableMcpTables(toml, new Set(["notes", "other one", "last"]));
    expect(out.disabled.sort()).toEqual(["last", "notes", "other one"]);
    expect(out.text).toContain("# mine");
    expect(out.text).toMatch(/\[mcp_servers\.notes\]\ncommand = "notes"\nenabled = false\n/);
    expect(out.text).toMatch(/url = "https:\/\/example.test"\n\nenabled = false\n\[mcp_servers\.keep\]|url = "https:\/\/example.test"\nenabled = false/);
    expect(out.text).toMatch(/\[mcp_servers\.keep\]\ncommand = "keep"\n\n\[/);
    expect(out.text).toMatch(/\[mcp_servers\.last\]\ncommand = "last"\nenabled = false\n$/);
  });

  it("fixes the account's own config.toml and reports what it could not find", () => {
    const home = mkdtempSync(join(tmpdir(), "omb-ambient-"));
    writeFileSync(join(home, "config.toml"), "[mcp_servers.notes]\ncommand = \"notes\"\n");
    learnAmbientMcp(home, "/w", ["notes"]);
    const result = fixAmbientMcp({ codexHome: home, cwd: "/w", names: ["notes", "elsewhere"], at: 0 });
    expect(result).toEqual({ disabled: ["notes"], missing: ["elsewhere"] });
    expect(readFileSync(join(home, "config.toml"), "utf8")).toContain("enabled = false");
    expect(learnedAmbientMcp(home, "/w").size).toBe(0);
  });
});
