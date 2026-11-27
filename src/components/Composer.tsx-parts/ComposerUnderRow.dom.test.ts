// The chat bar's shape (owner 2026-11-25, M-20261125-071, #5372; 2026-11-26,
// M-20261126-104): the message box holds the +, the field, the model chip and
// the voice button, the chip just before the voice button; the quiet row
// under the box keeps the context and usage meter only.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (name: string) => readFileSync(join(import.meta.dirname, name), "utf8");

describe("the chat bar: the model chip inside the box, the meter by placement", () => {
  it("M-20261126-104: the box's action bar can hold the model chip (orderable, D-20261126-014)", () => {
    const bar = read("ComposerActionBar.tsx");
    const chip = bar.indexOf("data-composer-model-chip");
    expect(chip).toBeGreaterThan(-1);
    expect(bar.slice(chip)).toMatch(/<ModelPicker inComposer/);
    // a narrow box folds it into the + menu's Model row, as before (#4093)
    expect(bar).toContain("COMPOSER_WIDE_ONLY");
    // D-20261127-001: the meter can sit in the action bar after the model
    expect(bar).toMatch(/meter|ComposerMeter/);
  });

  it("the row under the box holds no model picker; the meter only when placement is below", () => {
    const row = read("ComposerUnderRow.tsx");
    expect(row).toMatch(/data-composer-under-row/);
    expect(row).not.toMatch(/ModelPicker/);
    expect(row).not.toContain("data-composer-model-chip=");
    expect(row).toMatch(/ml-auto[^>]*>\{meter\}/);
  });

  it("the editor draws the row after the box, never inside it", () => {
    const editor = read("ComposerEditor.tsx");
    const box = editor.indexOf("COMPOSER_PILL,");
    const children = editor.indexOf("{children}", box);
    const below = editor.indexOf("{below}", box);
    expect(children).toBeGreaterThan(box);
    expect(below).toBeGreaterThan(children);
    // two closings (the row of the box, the box) stand between them
    expect(editor.slice(children, below).match(/<\/div>/g)).toHaveLength(2);
  });

  it("M-20261125-070: the chat bar's chip draws no limit dot", () => {
    const picker = read("../ModelPicker.tsx");
    expect(picker).toMatch(/\{!inComposer && <EngineLimitIndicator/);
  });

  it("M-20261126-104: one Effort everywhere: the bot working no longer swaps the chat bar's menu for a window of its own", () => {
    const picker = read("../ModelPicker.tsx");
    expect(picker).toMatch(/containedBusy && !modeMenu \? \(/);
  });
});
