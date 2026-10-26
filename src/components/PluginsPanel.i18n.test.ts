// Helpers and server rendering cover translated copy and identity preservation.
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { parseMcpEnvironment } from "./McpServersPanel";

afterEach(() => {
  setLocale("en");
});

describe("plugins modal translation", () => {
  it("translates an MCP environment parse error without touching the offending line", () => {
    setLocale("de");
    expect(parseMcpEnvironment("NOT A KEY=value")).toEqual({
      ok: false,
      error: { key: "mcp.env.invalidName", params: { key: "NOT A KEY" } },
    });
  });
});
