// The chat bar's shape (owner 2026-11-25, M-20261125-071, M-20261125-074,
// #5372): the message box holds the +, the field and the voice button only;
// the model chip sits in a quiet row under the box, at its left.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (name: string) => readFileSync(join(import.meta.dirname, name), "utf8");

describe("the chat bar: one box, a quiet row under it", () => {
  it("the box's action bar holds no model picker", () => {
    const bar = read("ComposerActionBar.tsx");
    expect(bar).not.toMatch(/ModelPicker/);
    expect(bar).not.toContain("data-composer-model-chip");
  });

  it("the row under the box holds the chip at its left and the meter at its end", () => {
    const row = read("ComposerUnderRow.tsx");
    expect(row).toMatch(/data-composer-under-row/);
    expect(row.indexOf("data-composer-model-chip")).toBeGreaterThan(-1);
    expect(row.indexOf("data-composer-model-chip")).toBeLessThan(row.indexOf("{meter"));
    expect(row).toMatch(/ml-auto/);
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
});
