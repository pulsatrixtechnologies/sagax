// #3294: a local model the engine cannot run is left out of the picker
// (modelUsable), never listed greyed; the model in use stays and says why.
import { describe, expect, it } from "vitest";
import { buildModelPickerSections, type ModelPickerSectionsInput } from "./buildSections";
import type { InstanceInfo } from "@/state/store";

const claude: InstanceInfo = {
  instanceId: "claude",
  displayName: "Claude Code",
  driverKind: "claudeAgent",
  access: "subscription",
  cliDefault: "claude",
  snapshot: { state: "available", authenticated: true },
  models: {
    default: "claude-big",
    options: [
      { id: "claude-big", label: "Claude Big" },
      { id: "deskabc123::qwen", label: "Qwen (desktop)", custom: true, local: true },
      { id: "deskabc123::llama", label: "Llama (desktop)", custom: true, local: true, anthropic: true },
    ],
  },
  capabilities: { effortLevels: ["low", "medium", "high"] },
} as InstanceInfo;

function input(selection: { instanceId: string; model: string }): ModelPickerSectionsInput {
  const bot = { id: "b", name: "Scout", threadId: "t", modelSelection: selection };
  return {
    orgMode: false,
    accountModels: new Map(),
    selection,
    switches: {},
    autoOn: false,
    follows: undefined,
    selectedVariantLabel: undefined,
    fallback: undefined,
    instances: [claude],
    selectable: [claude],
    viewerLocal: true,
    autoPreview: null,
    autoRecord: null,
    profile: bot as ModelPickerSectionsInput["profile"],
    botModelInstance: undefined,
    botModelName: "",
    health: { orgMode: false, myEngines: null },
    myEngines: null,
    ranOnName: () => "",
  };
}

const modelRows = (sections: ReturnType<typeof buildModelPickerSections>["menuSections"]) =>
  sections.flatMap((section) => section.rows).filter((row) => row.kind === "model");

describe("local rows the engine cannot run (#3294)", () => {
  it("are left out, never listed greyed", () => {
    const { menuSections } = buildModelPickerSections(input({ instanceId: "claude", model: "claude-big" }));
    const rows = modelRows(menuSections);
    expect(rows.map((row) => row.modelId)).not.toContain("deskabc123::qwen");
    expect(rows.map((row) => row.modelId)).toContain("deskabc123::llama");
    expect(rows.some((row) => row.unavailable)).toBe(false);
  });

  it("keep the one in use, saying why", () => {
    const { menuSections } = buildModelPickerSections(input({ instanceId: "claude", model: "deskabc123::qwen" }));
    const row = modelRows(menuSections).find((candidate) => candidate.modelId === "deskabc123::qwen");
    expect(row?.unavailable).toBe("This local server does not speak the Anthropic protocol.");
  });
});
