// #4152: the message bar as the reference draws it: the placeholder in the
// reference's faint quaternary ink on one line cut with an ellipsis, and the
// + and mic circles on a faint fill with a faint hairline (no visible ring)
// and a 16 px glyph, 8 px apart.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SECONDARY_CIRCLE, SECONDARY_GLYPH } from "./ComposerControls";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const actionBar = readFileSync(new URL("./Composer.tsx-parts/ComposerActionBar.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("./Composer.tsx-parts/ComposerEditor.tsx", import.meta.url), "utf8");

/** The declarations of the first rule whose selector ends with `selector`. */
function rule(selector: RegExp): string {
  return css.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("the message bar's look (#4152)", () => {
  it("paints the visible placeholder, the mirror's hint, in the bar's own ink on one line with an ellipsis", () => {
    // the textarea's own placeholder is transparent under the mirror: the
    // span MentionTextarea draws is the one a person sees
    const mirror = readFileSync(new URL("./MentionTextarea.tsx", import.meta.url), "utf8");
    expect(mirror).toMatch(/className="mention-editor-placeholder"/);
    expect(rule(/\.mention-editor > textarea:placeholder-shown::placeholder/)).toMatch(/color:\s*transparent/);
    const hint = rule(/\n\.mention-editor-placeholder/);
    expect(hint).toMatch(/color:\s*var\(--composer-placeholder\)/);
    expect(hint).toMatch(/white-space:\s*nowrap/);
    expect(hint).toMatch(/text-overflow:\s*ellipsis/);
    // one rule says it: no second placeholder colour on the native field
    expect(css).not.toMatch(/\.chat-input-text::placeholder/);
    expect(editor).not.toMatch(/placeholder:text-ink/);
  });

  it("mixes the reference's alphas from the skin's ink, light skins at the light values", () => {
    const dark = rule(/:root,\s*\[data-skin\]/);
    expect(dark).toMatch(/--composer-placeholder:\s*color-mix\(in srgb, var\(--color-ink\) 38%, transparent\)/);
    expect(dark).toMatch(/--composer-control-fill:\s*color-mix\(in srgb, var\(--color-ink\) 4%, transparent\)/);
    expect(dark).toMatch(/--composer-control-ring:\s*color-mix\(in srgb, var\(--color-ink\) 6%, transparent\)/);
    const lightSelector = css.match(/(:is\((?:\[data-skin="[a-z0-9-]+"\],\s*)+\[data-skin="[a-z0-9-]+"\]\))\s*\{\s*--composer-placeholder:/)?.[1] ?? "";
    const listed = [...lightSelector.matchAll(/data-skin="([a-z0-9-]+)"/g)].map((match) => match[1]).sort();
    // every skin whose block says it is light, and only those
    const light = [...css.matchAll(/^\[data-skin="([a-z0-9-]+)"\]\s*\{[^}]*?--code-color-scheme:\s*light;/gms)].map((match) => match[1]).sort();
    expect(light.length).toBeGreaterThan(0);
    expect(listed).toEqual(light);
    const lightRule = css.slice(css.indexOf(lightSelector) + lightSelector.length).match(/\{([^}]*)\}/)?.[1] ?? "";
    expect(lightRule).toMatch(/--composer-placeholder:\s*color-mix\(in srgb, var\(--color-ink\) 40%, transparent\)/);
    expect(lightRule).toMatch(/--composer-control-fill:\s*color-mix\(in srgb, var\(--color-ink\) 6%, transparent\)/);
    expect(lightRule).toMatch(/--composer-control-ring:\s*color-mix\(in srgb, var\(--color-ink\) 8%, transparent\)/);
  });

  it("draws the quiet circles without the field border's ring, glyphs at 16 px", () => {
    expect(SECONDARY_CIRCLE).toContain("shadow-[inset_0_0_0_0.5px_var(--composer-control-ring)]");
    expect(SECONDARY_CIRCLE).not.toContain("var(--color-border)");
    expect(SECONDARY_CIRCLE).toContain("bg-[var(--composer-control-fill)]");
    expect(SECONDARY_CIRCLE).toContain("size-7");
    expect(SECONDARY_GLYPH).toBe(16);
  });

  it("keeps the trailing controls 8 px apart", () => {
    expect(actionBar).toMatch(/data-composer-actions className="composer-band flex items-center gap-2\b/);
  });

  it("keeps one line of the bar at the reference's 44 px: 32 px band, 5 px above and below", () => {
    expect(editor).toMatch(/min-h-11 rounded-\[22px\] border-\[0\.5px\][^"]*\bpx-2 py-\[5px\]/);
  });
});
