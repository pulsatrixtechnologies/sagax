import { describe, expect, it } from "vitest";

import { CODEX_AMBIENT_MCP_REFUSAL, isCodexAmbientMcpRefusal, preSendRefusalKind } from "./presend-refusal.ts";

describe("preSendRefusalKind (#2013)", () => {
  it("reads a configuration conflict, including the Codex selection refusal", () => {
    expect(preSendRefusalKind(`${CODEX_AMBIENT_MCP_REFUSAL} No prompt was sent.`)).toBe("config_conflict");
    expect(preSendRefusalKind("Grok has an MCP connection outside the bot's selection. Disable native MCP connections before using tool selection. No prompt was sent.")).toBe("config_conflict");
    expect(isCodexAmbientMcpRefusal(`${CODEX_AMBIENT_MCP_REFUSAL} No prompt was sent.`)).toBe(true);
  });

  it("reads an engine that was not ready", () => {
    expect(preSendRefusalKind("Codex could not confirm its shell environment policy. No prompt was sent.")).toBe("engine_not_ready");
    expect(preSendRefusalKind("Codex rejected its configuration as invalid. Check ~/.codex/config.toml (or CODEX_HOME) for a broken entry, then retry.")).toBe("engine_not_ready");
    expect(preSendRefusalKind("Claude Code is not installed", { setup: true })).toBe("engine_not_ready");
    expect(preSendRefusalKind("needs a newer Claude Code", { claudeUpdate: true })).toBe("engine_not_ready");
  });

  it("reads an expired sign-in only on a setup failure", () => {
    expect(preSendRefusalKind("Codex sign-in expired. Sign in again.", { setup: true })).toBe("signed_out");
    expect(preSendRefusalKind("401 Unauthorized", { setup: true })).toBe("signed_out");
  });

  it("reads limits and credit", () => {
    expect(preSendRefusalKind("You've hit your usage limit")).toBe("engine_limit");
    expect(preSendRefusalKind("whatever", { limitResetsAt: 1 })).toBe("engine_limit");
    expect(preSendRefusalKind("Payment required")).toBe("engine_limit");
  });

  it("leaves a failure after the model started as a row", () => {
    expect(preSendRefusalKind("The model stopped answering mid-reply")).toBeNull();
    expect(preSendRefusalKind("tool failed: permission denied")).toBeNull();
    expect(preSendRefusalKind("")).toBeNull();
  });
});
