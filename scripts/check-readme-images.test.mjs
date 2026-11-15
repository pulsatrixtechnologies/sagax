import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { missingReadmeImages, readmeImagePaths } from "./check-readme-images.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("README images (#4358)", () => {
  it("finds img, source srcset and Markdown images, and skips web addresses", () => {
    const markdown = [
      '<img src="docs/readme/chat.png" alt="">',
      '<source media="(prefers-color-scheme: light)" srcset="docs/readme/a.png 1x, ./docs/readme/b.png 2x">',
      "![clip](docs/readme/send-message.webp)",
      '<img src="https://img.shields.io/badge/x" alt="">',
      '<img src="data:image/png;base64,AAAA" alt="">',
      '<img src="docs/readme/chat.png" alt="again">',
    ].join("\n");
    expect(readmeImagePaths(markdown)).toEqual(["docs/readme/chat.png", "docs/readme/a.png", "docs/readme/b.png", "docs/readme/send-message.webp"]);
  });

  it("names every image that is not there", () => {
    const markdown = '<img src="docs/readme/here.png"><img src="docs/readme/gone.webp">';
    const present = new Set([join("/repo", "docs/readme/here.png")]);
    expect(missingReadmeImages(markdown, "/repo", (path) => present.has(path))).toEqual(["docs/readme/gone.webp"]);
  });

  it("the repository README shows only files that exist", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(readmeImagePaths(readme).length).toBeGreaterThan(10);
    expect(missingReadmeImages(readme, ROOT, existsSync)).toEqual([]);
  });

  it("the README shows no light variant left behind: one dark Studio set", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(readmeImagePaths(readme).filter((path) => path.startsWith("docs/readme/") && /-light\./.test(path))).toEqual([]);
  });
});
