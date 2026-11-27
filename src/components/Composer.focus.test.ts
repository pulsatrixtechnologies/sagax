// #4526: after a send the composer puts the caret back with a programmatic
// focus(), which matches :focus-visible. The high-contrast outline rule
// (specificity 0,3,0) must not frame the composer text; the composer rule has
// to outrank it in the same stylesheet, later in source order and more
// specific (0,3,1). #5444 / M-20261127-059: #5435 renamed the DOM hook to
// data-surface and the CSS kept data-tour, so the rectangle came back.
// The CSS is checked as text (happy-dom has no :focus-visible).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const editor = readFileSync(
  new URL("./Composer.tsx-parts/ComposerEditor.tsx", import.meta.url),
  "utf8",
);

describe("composer focus ring after a send", () => {
  const highContrast = css.indexOf(':root[data-contrast="high"] :focus-visible:not([data-pointer-focus])');
  const composer = css.indexOf('[data-tour="composer"] textarea:focus-visible');

  it("has both rules", () => {
    expect(highContrast).toBeGreaterThan(0);
    expect(composer).toBeGreaterThan(0);
  });

  it("declares the composer rule after the high-contrast one so it wins ties", () => {
    expect(composer).toBeGreaterThan(highContrast);
  });

  it("covers high contrast explicitly and removes the outline", () => {
    const rule = css.slice(css.lastIndexOf("\n", composer), css.indexOf("}", composer) + 1);
    expect(rule).toContain(':root[data-contrast="high"]');
    expect(rule).toMatch(/outline:\s*none/);
    expect(rule).toMatch(/outline-offset:\s*0/);
  });

  it("keeps a visible focus on the pill in high contrast, drawn in the primary ink", () => {
    const start = css.indexOf(':root[data-contrast="high"] [data-tour="composer"]:focus-within');
    expect(start).toBeGreaterThan(composer);
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("border-color: var(--color-ink)");
    expect(rule).toMatch(/box-shadow:\s*0 0 0 1\.5px var\(--color-ink\)/);
  });

  it("keeps the DOM hook that the CSS selectors name (data-tour, not data-surface)", () => {
    expect(editor).toMatch(/data-tour=\{?"composer"?\}?/);
    expect(editor).not.toMatch(/data-surface=\{?"composer"?\}?/);
  });
});
