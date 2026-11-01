// Capabilities lot 4: the shared organization capability form (mirror of
// Perspicax console/src/lib/capability-form.ts).
import { describe, expect, it } from "vitest";

import { draftToInput, emptyDraft, isFlowMount, validateDraft, validMountName, validSkillPath } from "./org-capability-form.ts";

describe("org capability form", () => {
  it("accepts a marketplace plugin and refuses a Flow mount name", () => {
    const draft = emptyDraft("plugin");
    draft.mountName = "shipping-tools";
    draft.name = "Shipping tools";
    draft.mode = "imposed";
    draft.enabled = true;
    draft.marketplaceUrl = "https://example.com/catalog.git";
    draft.pluginValues = "region=north";
    expect(validateDraft(draft)).toEqual({});
    expect(draftToInput(draft)).toMatchObject({
      mount_name: "shipping-tools",
      form: "plugin",
      source: { kind: "marketplace", url: "https://example.com/catalog.git", plugin: "shipping-tools" },
      configuration: { type: "plugin", values: { region: "north" } },
    });
    draft.mountName = "pulsatrix-flow";
    expect(validateDraft(draft).mountName).toMatchObject({ key: "orgCapabilities.error.flow" });
    expect(isFlowMount("pulsatrix-flow-gox")).toBe(true);
    expect(validMountName("shipping-tools")).toBe(true);
    expect(validMountName("-bad")).toBe(false);
  });

  it("requires SKILL.md and relative skill paths", () => {
    const draft = emptyDraft("skill");
    draft.mountName = "packing";
    draft.name = "Packing";
    draft.skillFiles = [{ path: "notes.md", content: "x" }];
    expect(validateDraft(draft).skillFiles).toMatchObject({ key: "orgCapabilities.error.skill_md" });
    draft.skillFiles = [{ path: "SKILL.md", content: "---\nname: packing\n---\n" }, { path: "../x.md", content: "y" }];
    expect(validateDraft(draft).skillFiles).toMatchObject({ key: "orgCapabilities.error.skill_path" });
    expect(validSkillPath("a/b.md")).toBe(true);
    expect(validSkillPath("../x")).toBe(false);
  });
});
