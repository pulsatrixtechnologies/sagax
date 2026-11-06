import { describe, expect, it } from "vitest";
import { buildModelPickerSections, type ModelPickerSectionsInput } from "./buildSections";
import type { InstanceInfo } from "@/state/store";

const claude = (id: string, name: string): InstanceInfo => ({
  instanceId: id,
  displayName: name,
  driverKind: "claudeAgent",
  access: "subscription",
  cliDefault: "claude",
  snapshot: { state: "available", authenticated: true },
  models: {
    default: "claude-sonnet-5",
    options: [
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "claude-opus-5", label: "Claude Opus 5" },
    ],
  },
  capabilities: { effortLevels: ["low", "medium", "high"] },
} as InstanceInfo);

const api: InstanceInfo = {
  instanceId: "claudeApi",
  displayName: "Anthropic",
  driverKind: "claudeAgent",
  access: "api",
  cliDefault: "claude",
  snapshot: { state: "available", authenticated: true },
  models: {
    default: "claude-sonnet-5",
    options: [{ id: "claude-sonnet-5", label: "Claude Sonnet 5" }],
  },
  capabilities: { effortLevels: ["low", "medium", "high"] },
} as InstanceInfo;

const bot = {
  id: "bot-1",
  name: "Scout",
  threadId: "t1",
  modelSelection: { instanceId: "claude-a", model: "claude-sonnet-5", effort: "high" as const },
};

function input(over: Partial<ModelPickerSectionsInput> = {}): ModelPickerSectionsInput {
  const selectable = [claude("claude-a", "Work"), claude("claude-b", "Personal"), api];
  return {
    orgMode: false,
    accountModels: new Map(),
    selection: bot.modelSelection,
    switches: {},
    autoOn: false,
    follows: undefined,
    selectedVariantLabel: undefined,
    fallback: undefined,
    instances: selectable,
    selectable,
    viewerLocal: false,
    autoPreview: null,
    autoRecord: null,
    profile: bot as ModelPickerSectionsInput["profile"],
    botModelInstance: selectable[0],
    botModelName: "Claude · Claude Sonnet 5",
    health: { orgMode: false, myEngines: null },
    myEngines: null,
    ranOnName: () => "",
    favoriteKeys: ["claude-a\u0000claude-opus-5"],
    ...over,
  };
}

describe("buildModelPickerSections (#2106)", () => {
  it("orders Auto, Favorites, then Providers with one row per model across accounts", () => {
    const { menuSections } = buildModelPickerSections(input());
    expect(menuSections.map((section) => section.key)).toEqual([
      "top", "favorites", "claude-a", "claudeApi",
    ]);
    expect(menuSections[0]?.rows.some((row) => row.kind === "auto")).toBe(true);
    expect(menuSections[1]?.label).toMatch(/favorite/i);
    expect(menuSections[1]?.rows.map((row) => row.modelId)).toEqual(["claude-opus-5"]);
    const claudeSection = menuSections[2]!;
    expect(claudeSection.label).toBe("Claude");
    expect(claudeSection.access).toBe("subscription");
    expect(claudeSection.note).toMatch(/account/i);
    expect(claudeSection.rows.map((row) => row.modelId).sort()).toEqual([
      "claude-opus-5", "claude-sonnet-5",
    ]);
    expect(menuSections[3]?.access).toBe("api");
    expect(menuSections[3]?.note).toMatch(/api/i);
  });
});
