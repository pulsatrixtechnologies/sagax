import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { APP_LICENSE_FOOTER_EN } from "@/lib/app-links";
import en from "@/locales/en.json";

const source = readFileSync(new URL("./AboutDialog.tsx", import.meta.url), "utf8");

describe("AboutDialog links", () => {
  it("has a single release notes link and no Releases link", () => {
    expect(source.match(/releaseNotes\.menu/g)).toHaveLength(1);
    expect(source).toContain('requestReleaseNotes("browse")');
    expect(source).not.toMatch(/RELEASES_URL|label="Releases"/);
    const links = [...source.matchAll(/<AboutLink href=\{(\w+)\}/g)].map((m) => m[1]);
    expect(links).toEqual(["APP_REPOSITORY", "DOCS_URL", "LICENSE_URL"]);
    // release notes first, then the links, all rows of one card
    expect(source.indexOf("releaseNotes.menu")).toBeLessThan(source.indexOf("<AboutLink"));
  });

  it("is a centred DialogLayer modal again", () => {
    expect(source).toContain("<DialogLayer");
    expect(source).toContain("data-about-dialog");
    expect(source).toContain("AboutPrompt");
  });

  it("keeps the About copyright line in sync with APP_LICENSE_FOOTER_EN (LICENSE)", () => {
    expect(en["about.copyright"]).toBe(APP_LICENSE_FOOTER_EN);
  });
});
