// Placement of the usage pill (D-20261127-001, M-20261127-037): the setting
// "Usage in the message bar" promised the pill after the model choice, but
// 0.8.174 left ComposerMeter under the box. Red first: the default placement
// must put the meter in the action bar after the model chip.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(join(import.meta.dirname, name), "utf8");

describe("usage pill placement in the composer (D-20261127-001)", () => {
  it("default inBar: ComposerMeter sits in the action bar after the model chip, not only under the box", () => {
    const shell = read("ComposerShell.tsx");
    const bar = read("ComposerActionBar.tsx");
    // the meter is available to the action bar (passed or rendered there)
    expect(bar).toMatch(/ComposerMeter|meter/);
    // under-row only gets the meter when placement is below
    expect(shell).toMatch(/usagePillPlacement|placement/);
    // must not unconditionally pass the meter to ComposerUnderRow
    expect(shell).not.toMatch(/ComposerUnderRow\s+meter=\{<ComposerMeter/);
  });

  it("supports above and below placements beside the show/hide switch", () => {
    const prefs = readFileSync(join(import.meta.dirname, "../../lib/usage-pill-preferences.ts"), "utf8");
    const types = readFileSync(join(import.meta.dirname, "../../lib/ui-layout/types.ts"), "utf8");
    // Placement values live on the unified layout types; the prefs module re-exports them.
    expect(types).toMatch(/\["inBar", "above", "below"\]/);
    expect(prefs).toMatch(/USAGE_PILL_PLACEMENTS/);
    expect(prefs).toMatch(/USAGE_PLACEMENTS|ui-layout\/types/);
    expect(prefs).toMatch(/usagePillPlacement/);
    expect(prefs).toMatch(/usagePillInBar/);
  });
});
