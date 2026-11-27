import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { foldedModelRowLabel } from "./ComposerControls";
import type { InstanceInfo } from "@/state/store";
import type { Bot } from "@/state/store";
import { setLocale } from "@/lib/i18n";

const instances = [{ instanceId: "claude", displayName: "Claude", models: { options: [{ id: "sonnet", label: "Claude Sonnet 5.5" }] } }] as unknown as InstanceInfo[];

beforeEach(() => setLocale("en"));

const selection = (patch: Record<string, unknown>) => patch as unknown as Bot["modelSelection"];

describe("folded Model row label (#5422)", () => {
  it("under Auto says Auto, and Auto · level when a level is chosen", () => {
    expect(foldedModelRowLabel(instances, selection({ auto: true, mode: "auto", instanceId: "claude", model: "sonnet" }))).toBe("Auto");
    expect(foldedModelRowLabel(instances, selection({ auto: true, mode: "auto", effort: "medium", instanceId: "claude", model: "sonnet" }))).toBe("Auto · Medium");
  });

  it("a pinned model keeps the model name, not Auto", () => {
    const label = foldedModelRowLabel(instances, selection({ auto: false, instanceId: "claude", model: "sonnet" }));
    expect(label).toContain("Claude Sonnet 5.5");
    expect(label).not.toMatch(/^Auto/);
  });
});

describe("folded Model row layout (#5422)", () => {
  it("does not cap the value at 140 px", () => {
    const src = readFileSync(new URL("./ComposerControls.tsx", import.meta.url), "utf8");
    expect(src).not.toContain("max-w-[140px]");
    expect(src).toContain("data-composer-model-value");
  });
});

describe("mode menu from the + row (#5422)", () => {
  it("opens beside the row with top, not only bottom at the window corner", () => {
    const src = readFileSync(new URL("./ModelPicker.tsx-parts/modelPickerActions.ts", import.meta.url), "utf8");
    expect(src).toContain("setMenuAt({ left, top })");
    expect(src).toContain("#5422");
  });
});
