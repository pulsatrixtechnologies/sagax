import { describe, expect, it } from "vitest";
import { unifyProviderSections } from "./model-provider-unify.ts";

describe("unifyProviderSections (#2106)", () => {
  it("shows one row per model across several Claude subscription accounts", () => {
    const sections = unifyProviderSections([
      { key: "top", rows: [{ key: "auto" }] },
      {
        key: "claude-a", label: "Work", access: "subscription" as const, family: "claude",
        rows: [
          { key: "a-sonnet", modelId: "claude-sonnet-5", instanceId: "claude-a", current: true },
          { key: "a-opus", modelId: "claude-opus-5", instanceId: "claude-a" },
        ],
      },
      {
        key: "claude-b", label: "Personal", access: "subscription" as const, family: "claude",
        rows: [
          { key: "b-sonnet", modelId: "claude-sonnet-5", instanceId: "claude-b" },
          { key: "b-haiku", modelId: "claude-haiku-5", instanceId: "claude-b" },
        ],
      },
      {
        key: "claudeApi", label: "Anthropic", access: "api" as const,
        rows: [{ key: "api-sonnet", modelId: "claude-sonnet-5", instanceId: "claudeApi" }],
      },
    ]);
    expect(sections.map((section) => section.key)).toEqual(["top", "claude-a", "claudeApi"]);
    const claude = sections[1]!;
    expect(claude.rows.map((row) => row.modelId)).toEqual([
      "claude-sonnet-5", "claude-opus-5", "claude-haiku-5",
    ]);
    expect(claude.rows.find((row) => row.modelId === "claude-sonnet-5")?.instanceId).toBe("claude-a");
    expect(claude.access).toBe("subscription");
    expect(sections[2]?.access).toBe("api");
  });
});
