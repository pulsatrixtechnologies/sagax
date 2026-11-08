// Geist is the interface face and Geist Mono the code face (the owner, 2026-10-28).
// Three contracts: the "Skin default" stack starts with Geist, the files ship
// with the app (no network at run time), and iOS lists them in UIAppFonts.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const css = read("src/styles.css");

// Skins that impose their own face keep it (Hibou 98 sets Tahoma).
const IMPOSED = new Set(["retro98"]);

describe("Geist as the Skin default", () => {
  it("starts the default sans stack with Geist, system faces behind", () => {
    const theme = css.match(/@theme\s*\{[\s\S]*?--font-sans:\s*([^;]+);/)?.[1] ?? "";
    expect(theme.trim().startsWith('"Geist Variable"')).toBe(true);
    expect(theme).toMatch(/-apple-system/);
    expect(theme).toMatch(/sans-serif/);
  });

  it("starts every non-imposing skin's stack with Geist", () => {
    const skins = [...css.matchAll(/^[^\n{}]*\[data-skin="([a-z0-9-]+)"\][^{}]*\{([^}]*)\}/gm)];
    let checked = 0;
    for (const [, id, body] of skins) {
      const stack = body.match(/--font-sans:\s*([^;]+);/)?.[1];
      if (!stack || IMPOSED.has(id)) continue;
      checked += 1;
      expect(stack.trim().toLowerCase(), id).toMatch(/^"geist variable"/);
    }
    expect(checked).toBeGreaterThan(5);
    expect(css).toMatch(/\[data-skin="retro98"\][^{]*\{[^}]*--font-sans:\s*Tahoma/);
  });

  it("keeps the other Interface font choices", () => {
    expect(css).toMatch(/:root\[data-font="system"\]/);
    expect(css).toMatch(/:root\[data-font="inter"\]/);
    expect(css).toMatch(/:root\[data-font="poppins"\]/);
    expect(css).toMatch(/:root\[data-font="serif"\]/);
  });

  it("starts the monospace stack with Geist Mono", () => {
    const mono = css.match(/@theme\s*\{[\s\S]*?--font-mono:\s*([^;]+);/)?.[1] ?? "";
    expect(mono.trim().startsWith('"Geist Mono Variable"')).toBe(true);
    expect(mono).toMatch(/monospace/);
  });
});

describe("Geist files ship with the app", () => {
  it("imports both families from bundled packages pinned to one version", () => {
    expect(css).toContain('@import "@fontsource-variable/geist/wght.css"');
    expect(css).toContain('@import "@fontsource-variable/geist-mono/wght.css"');
    const pkg = JSON.parse(read("package.json")).dependencies as Record<string, string>;
    expect(pkg["@fontsource-variable/geist"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg["@fontsource-variable/geist-mono"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("has the woff2 files the stylesheet points to", () => {
    for (const f of [
      "geist/files/geist-latin-wght-normal.woff2",
      "geist/files/geist-latin-ext-wght-normal.woff2",
      "geist-mono/files/geist-mono-latin-wght-normal.woff2",
      "geist-mono/files/geist-mono-latin-ext-wght-normal.woff2",
    ]) expect(existsSync(join(root, "node_modules/@fontsource-variable", f)), f).toBe(true);
  });

  it("ships the OFL licences and the notice", () => {
    for (const f of ["third_party/geist/OFL.txt", "third_party/geist/OFL-Mono.txt"]) {
      expect(read(f)).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
    }
    expect(read("NOTICE")).toMatch(/Geist Mono/);
    expect(read("electron-builder.yml")).toContain("licenses/Geist-Mono-OFL.txt");
  });
});

describe("iOS embeds Geist", () => {
  it("bundles the TrueType files and lists them in UIAppFonts", () => {
    for (const f of ["Geist-Variable.ttf", "GeistMono-Variable.ttf"]) {
      expect(existsSync(join(root, "ios/App/Desktop/Fonts", f)), f).toBe(true);
    }
    const yml = read("ios/project.yml");
    const block = yml.match(/UIAppFonts:\s*\n((?:\s+- .*\n)+)/)?.[1] ?? "";
    expect(block).toContain("Geist-Variable.ttf");
    expect(block).toContain("GeistMono-Variable.ttf");
  });
});
