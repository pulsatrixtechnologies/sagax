import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOC_COPIES, renderCopy, staleCopies } from "./docs-copies.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("docs-copies", () => {
  it("keeps every generated copy in step with its docs site source", () => {
    expect(staleCopies(root).map((entry) => entry.copy)).toEqual([]);
  });

  it("generates each copy from an .mdx the docs site builds", () => {
    for (const entry of DOC_COPIES) {
      expect(entry.source).toMatch(/^apps\/docs\/content\/docs\/.+\.mdx$/);
      expect(existsSync(join(root, entry.source))).toBe(true);
      expect(readFileSync(join(root, entry.copy), "utf8").startsWith(`<!-- Generated from ${entry.source} `)).toBe(true);
    }
  });

  it("turns site links and Callouts into Markdown GitHub renders", () => {
    const mdx = [
      "---", "title: Page", "---", "",
      '<Callout title="Heads up">', "  One line.", "</Callout>", "",
      "See [backups](/docs/self-hosting/data-and-backups#restore), [home](/docs) and",
      "[CLI](https://github.com/pulsatrixtechnologies/sagax/blob/main/docs/cli-onboarding.md).", "",
    ].join("\n");
    const out = renderCopy({ source: "apps/docs/content/docs/x/page.mdx", copy: "docs/page.md" }, mdx);
    expect(out).toContain("# Page\n");
    expect(out).toContain("> **Heads up**\n>\n> One line.");
    expect(out).toContain("](../apps/docs/content/docs/self-hosting/data-and-backups.mdx#restore)");
    expect(out).toContain("](../apps/docs/content/docs/index.mdx)");
    expect(out).toContain("](cli-onboarding.md)");
  });
});
