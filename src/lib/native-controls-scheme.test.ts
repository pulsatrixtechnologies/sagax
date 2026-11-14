// #1507: native controls follow the skin's light or dark, not the OS, and a
// disabled accent button on a gradient tint never keeps the gradient.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(src, "styles.css"), "utf8");

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
}

describe("native controls on a skin (#1507)", () => {
  it("draws native lists and pickers in the skin's scheme", () => {
    expect(rule("[data-skin]")).toMatch(/color-scheme:\s*var\(--code-color-scheme\)/);
  });

  it("keeps one [data-skin] block, so the scheme is found where it is set (#4198)", () => {
    // #4182 opened a second `[data-skin] {` block for the message bar's
    // inks; the lookup above then read that one and lost the scheme.
    expect(css.split("[data-skin] {").length - 1).toBe(1);
  });

  it("names a scheme in every skin", () => {
    const skins = [...css.matchAll(/^\[data-skin="([a-z0-9-]+)"\] \{([\s\S]*?)\n\}/gm)];
    expect(skins.length).toBeGreaterThan(5);
    for (const [, skin, body] of skins) expect(body, skin).toMatch(/--code-color-scheme:\s*(dark|light);/);
  });

  it("gives native options the popover's ground and ink", () => {
    const body = rule("select option:not(:checked),\nselect optgroup");
    expect(body).toMatch(/background-color:\s*var\(--color-popover\)/);
    expect(body).toMatch(/color:\s*var\(--color-popover-ink\)/);
  });

  it("drops a tint's gradient from a disabled accent button", () => {
    expect(rule("button:disabled.bg-accent,\nbutton:disabled.bg-danger")).toMatch(/background-image:\s*none/);
  });
});
