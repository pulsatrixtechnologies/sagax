import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "../../styles.css"), "utf8");
const src = readFileSync(join(import.meta.dirname, "ComposerCustomize.tsx"), "utf8");

describe("composer customize jiggle (D-20261126-014)", () => {
  it("trembles movable controls while customizing", () => {
    expect(css).toMatch(/@keyframes composer-movable-jiggle/);
    expect(css).toMatch(
      /\[data-composer-customize="1"\] \.composer-movable[\s\S]*?animation:\s*composer-movable-jiggle/,
    );
    expect(css).toMatch(/\[data-ui-customize="1"\] \.ui-movable/);
    expect(src).toMatch(/className=\{cn\(\s*"composer-movable/);
    expect(src).toMatch(/GripVertical/);
    expect(src).toMatch(/data-composer-movable-handle/);
  });

  it("stops the tremble under reduced motion and shows a dashed outline", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\[data-composer-customize="1"\] \.composer-movable[\s\S]*?animation:\s*none;/,
    );
    expect(css).toMatch(
      /:root\[data-reduced-motion="true"\] \[data-composer-customize="1"\] \.composer-movable[\s\S]*?animation:\s*none;/,
    );
    expect(css).toMatch(
      /:root\[data-reduced-motion="true"\] \[data-composer-customize="1"\] \.composer-movable[\s\S]*?outline:\s*1\.5px dashed/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\[data-composer-customize="1"\] \.composer-movable[\s\S]*?outline:\s*1\.5px dashed/,
    );
  });

  it("keeps the text field and Send outside the movable set", () => {
    expect(src).toMatch(/composer-movable/);
    // Send and the field are never wrapped by ComposerMovable in the shell/gallery.
    const shell = readFileSync(join(import.meta.dirname, "ComposerShell.tsx"), "utf8");
    expect(shell).not.toMatch(/ComposerMovable[^>]*>[\s\S]*data-composer-send/m);
    expect(shell).toMatch(/ComposerMovable key=\{id\} id=\{id\}/);
  });
});
