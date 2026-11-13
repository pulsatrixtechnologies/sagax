import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { APP_LICENSE_FOOTER_EN, appVersion, baseVersion, buildDate } from "@/lib/app-links";
import en from "@/locales/en.json";
import { AboutCard, versionInfoText } from "./AboutDialog";

const source = readFileSync(new URL("./AboutDialog.tsx", import.meta.url), "utf8");

describe("AboutDialog links", () => {
  it("has a single release notes link and no Releases link", () => {
    expect(source.match(/releaseNotes\.menu/g)).toHaveLength(1);
    expect(source).toContain('requestReleaseNotes("browse")');
    expect(source).not.toMatch(/RELEASES_URL|label="Releases"/);
    const links = [...source.matchAll(/<AboutLink href=\{(\w+)\}/g)].map((m) => m[1]);
    expect(links).toEqual(["APP_REPOSITORY", "DOCS_URL", "LICENSE_URL"]);
    // release notes first, then the links
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

describe("About, the reference's dialog (#4097)", () => {
  it("is the reference's small dialog: 320px wide", () => {
    expect(source).toContain("DIALOG.width.xs");
  });

  it("reads mark, name, version, build date, copyright, Copy version info, then the quiet links and the upstream line", () => {
    {
      const html = renderToStaticMarkup(createElement(AboutCard));
      const order = ["data-about-mark", "id=\"about-dialog-title\"", "data-about-version", "data-about-built", "data-about-copyright", "data-about-copy", "data-about-links", "data-about-based-on"];
      const at = order.map((marker) => html.indexOf(marker));
      expect(at.every((index) => index >= 0), JSON.stringify(at)).toBe(true);
      expect(at).toEqual([...at].sort((a, b) => a - b));
      expect(html).toContain(">Copy version info<");
      // the build stamps its day (vite.config.ts define)
      expect(buildDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(html).toMatch(/Built [A-Z][a-z]{2} \d{1,2}, \d{4}/);
      // the links are text links now, not a bordered list of rows
      expect(html).not.toContain("divide-y");
      expect(html).toContain(">GitHub<");
      expect(html).toContain(">Release notes<");
    }
  });

  it("copies the version, the build date, the platform and the upstream base", () => {
    const lines = versionInfoText("macOS").split("\n");
    expect(lines[0]).toBe(`Version ${appVersion()}`);
    expect(lines[1]).toMatch(/^Built /);
    expect(lines.slice(2)).toEqual(["macOS", `Based on OpenMausBot ${baseVersion()}`]);
    expect(versionInfoText(null).split("\n")).toHaveLength(3);
  });
});
