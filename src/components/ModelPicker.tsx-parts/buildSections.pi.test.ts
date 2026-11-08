// #2963: pi's Perspicax model servers (px-org-*, px-own-*) are offered in the
// chat bar menu, on an organization server and when pi itself is signed out.
import { describe, expect, it } from "vitest";
import { buildModelPickerSections, type ModelPickerSectionsInput } from "./buildSections";
import { modelUsable } from "@/lib/model-health";
import type { InstanceInfo } from "@/state/store";

const pi = (authenticated: boolean): InstanceInfo => ({
  instanceId: "pi",
  displayName: "pi",
  driverKind: "piAgent",
  access: "custom",
  cliDefault: "pi",
  snapshot: { state: "available", authenticated },
  models: {
    default: "px-org-lab/qwen-35b",
    options: [
      { id: "px-org-lab/qwen-35b", label: "Qwen 35B", custom: true, provider: "px-org-lab", server: "Lab GPU" },
      { id: "px-own-mac/ornith-122b", label: "Ornith 122B", custom: true, provider: "px-own-mac", server: "My Mac" },
      { id: "typed-here", label: "Typed here", custom: true },
    ],
  },
  capabilities: { effortLevels: ["low", "medium", "high"] },
} as InstanceInfo);

function input(instance: InstanceInfo, orgMode: boolean): ModelPickerSectionsInput {
  const bot = { id: "b", name: "Scout", threadId: "t", modelSelection: { instanceId: "other", model: "x" } };
  return {
    orgMode,
    accountModels: new Map(),
    selection: bot.modelSelection,
    switches: {},
    autoOn: false,
    follows: undefined,
    selectedVariantLabel: undefined,
    fallback: undefined,
    instances: [instance],
    selectable: [instance],
    viewerLocal: false,
    autoPreview: null,
    autoRecord: null,
    profile: bot as ModelPickerSectionsInput["profile"],
    botModelInstance: undefined,
    botModelName: "",
    health: { orgMode, myEngines: null },
    myEngines: null,
    ranOnName: () => "",
  };
}

describe("pi model servers in the picker (#2963)", () => {
  it("offers px-org and px-own models on an organization server, labelled by server", () => {
    const { menuSections } = buildModelPickerSections(input(pi(true), true));
    const section = menuSections.find((candidate) => candidate.key === "pi");
    expect(section?.rows.map((row) => row.modelId)).toEqual(["px-org-lab/qwen-35b", "px-own-mac/ornith-122b"]);
    expect(section?.rows[0]?.detail).toContain("Lab GPU");
    expect(section?.rows[0]?.detail).not.toContain("px-org-lab");
  });

  it("offers them when pi has no sign-in of its own (solo)", () => {
    const { menuSections } = buildModelPickerSections(input(pi(false), false));
    const ids = menuSections.find((candidate) => candidate.key === "pi")?.rows.map((row) => row.modelId);
    expect(ids).toContain("px-own-mac/ornith-122b");
    expect(ids).not.toContain("typed-here");
  });

  it("counts them usable, a typed custom model still not on an organization server", () => {
    const health = { orgMode: true, myEngines: null };
    expect(modelUsable(pi(true), "px-org-lab/qwen-35b", health)).toBe(true);
    expect(modelUsable(pi(true), "typed-here", health)).toBe(false);
  });
});
