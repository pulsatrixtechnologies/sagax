import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ApprovalModeSelector,
  approvalModeOptions,
  approvalModeOptionsFor,
  approvalModeSelectionRequiresLocalDesktop,
} from "./ApprovalModeSelector";

describe("approval mode selector", () => {
  it("lists the approval levels with their plain-language copy", () => {
    expect(approvalModeOptions().map(({ mode, label, description }) => ({ mode, label, description }))).toEqual([
      {
        mode: "ask",
        label: "Ask for approval",
        description: "Asks you before each command, file change or tool call. Your rules come first: \"Allow automatically\" goes without a card, \"Deny\" refuses.",
      },
      {
        mode: "edits",
        label: "Auto-accept edits",
        description: "File edits go without asking; other actions ask you. Your rules come first: \"Ask every time\" shows a card, \"Deny\" refuses.",
      },
      {
        mode: "auto",
        label: "Approve for me",
        description: "Uses the engine's automatic review to approve routine actions, and asks about deletions, bulk changes and messages sent on your behalf. Your rules come first: \"Ask every time\" always shows a card, \"Deny\" always refuses.",
      },
      {
        mode: "full",
        label: "Full access",
        description: "Runs commands and edits files without asking. Your rules still apply: \"Ask every time\" shows a card and \"Deny\" refuses, even here. Use only with bots you trust.",
      },
      {
        mode: "custom",
        label: "Custom (config.toml)",
        description: "Uses permissions defined in config.toml",
      },
    ]);
  });

  it("offers provider-supported Full access but keeps config.toml Codex-only", () => {
    expect(approvalModeOptionsFor("codex").map((option) => option.mode)).toEqual([
      "ask",
      "auto",
      "full",
      "custom",
    ]);
    expect(approvalModeOptionsFor("claudeAgent").map((option) => option.mode)).toEqual([
      "ask",
      "edits",
      "auto",
      "full",
    ]);
  });

  it.each(["cursorAgent", "opencodeGo"])("offers Full access for %s, and no Edits level it cannot map", (kind) => {
    expect(approvalModeOptionsFor(kind).map((option) => option.mode)).toEqual(["ask", "auto", "full"]);
    expect(approvalModeOptionsFor(kind, false).map((option) => option.mode)).toEqual(["ask", "auto", "full"]);
  });

  it("offers Grok its native acceptEdits as Auto-accept edits", () => {
    expect(approvalModeOptionsFor("grokAgent").map((option) => option.mode)).toEqual(["ask", "edits", "auto", "full"]);
    expect(approvalModeOptionsFor("grokAgent", false).map((option) => option.mode)).toEqual(["ask", "edits", "auto", "full"]);
  });

  it("offers Antigravity Auto as the explicit full-access grant, not native review", () => {
    const options = approvalModeOptionsFor("antigravityAgent");
    expect(options.map(({ mode, label }) => ({ mode, label }))).toEqual([
      { mode: "ask", label: "Ask for approval" },
      { mode: "edits", label: "Auto-accept edits" },
      { mode: "full", label: "Auto (full access)" },
    ]);
    expect(options[2].chip).toBe("Auto");
    expect(options[2].description).toContain("Automatically approve tool requests");
    expect(approvalModeOptionsFor("antigravityAgent", false).map((option) => option.mode)).toEqual(["ask", "edits", "full"]);
  });

  it("shows the effective Antigravity mode without upgrading saved Auto settings", () => {
    const render = (mode: "ask" | "auto" | "full" | undefined, autoApprove = false, trustedModesAvailable = true) => renderToStaticMarkup(createElement(ApprovalModeSelector, {
      approvalMode: mode, autoApprove, trustedModesAvailable,
      providerName: "Antigravity", driverKind: "antigravityAgent", onSelect: () => {},
    }));
    for (const html of [render("ask"), render("auto"), render(undefined, true)]) {
      expect(html).toContain('aria-label="Ask for approval for Antigravity"');
      expect(html).not.toContain('aria-label="Auto (full access)');
    }
    expect(render("full")).toContain('aria-label="Auto (full access) for Antigravity"');
    expect(render("full", false, false)).toContain('aria-label="Auto (full access) for Antigravity"');
  });

  it("explains Auto fallbacks and does not elevate unknown providers", () => {
    expect(approvalModeOptionsFor("grokAgent").find((option) => option.mode === "auto")?.description).toContain("automatic review to approve routine actions");
    expect(approvalModeOptionsFor("customAgent").find((option) => option.mode === "auto")?.description).toContain("behaves like Ask");
    expect(approvalModeOptionsFor("customAgent").map((option) => option.mode)).toEqual(["ask", "auto"]);
  });

  it("offers Full without the packaged desktop bridge and hides only Custom", () => {
    expect(approvalModeOptionsFor("codex", false).map((option) => option.mode)).toEqual([
      "ask",
      "auto",
      "full",
    ]);
    expect(approvalModeOptionsFor("claudeAgent", false).map((option) => option.mode)).toEqual(["ask", "edits", "auto", "full"]);
  });

  it("keeps the composer trigger icon-only and the settings trigger labeled", () => {
    const compact = renderToStaticMarkup(createElement(ApprovalModeSelector, {
      approvalMode: "full", providerName: "Grok", driverKind: "grokAgent", onSelect: () => {},
    }));
    expect(compact).toContain('aria-label="Full access for Grok"');
    expect(compact).toContain('title="Full access"');
    expect(compact).not.toMatch(/<span class="truncate">Full access<\/span>/);
    const settings = renderToStaticMarkup(createElement(ApprovalModeSelector, {
      approvalMode: "full", providerName: "Grok", driverKind: "grokAgent", onSelect: () => {}, wide: true,
    }));
    expect(settings).toMatch(/<span class="truncate">Full access<\/span>/);
  });

  it("locks an existing Custom bot to the local packaged desktop", () => {
    expect(approvalModeSelectionRequiresLocalDesktop("custom", false)).toBe(true);
    expect(approvalModeSelectionRequiresLocalDesktop("ask", false)).toBe(false);
    expect(approvalModeSelectionRequiresLocalDesktop("custom", true)).toBe(false);
    const html = renderToStaticMarkup(createElement(ApprovalModeSelector, {
      approvalMode: "custom", trustedModesAvailable: false,
      providerName: "Missing provider", driverKind: "", onSelect: () => {},
    }));
    expect(html).toContain('aria-label="Custom (config.toml) for Missing provider"');
  });
});
