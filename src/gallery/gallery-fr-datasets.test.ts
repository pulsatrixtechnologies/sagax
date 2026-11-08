import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { galleryPagePreview } from "../../vite.gallery.config";

// QA 0.8.67 G10: with lang=fr the needs-you and chat-busy gallery pages showed
// English data. Every English dataset line now sits behind a French branch or
// an existing i18n key. The headless fr captures are scripts/capture/needs-you-card.mjs
// and scripts/capture/page-chat-real.mjs.
const source = (name: string) => readFileSync(join(__dirname, name), "utf8");
const behindFrench = (src: string, english: string) => {
  const at = src.indexOf(english);
  expect(at, english).toBeGreaterThan(-1);
  // the string literal that holds it is the else branch of a fr ternary
  const open = english.startsWith('"') ? at : src.lastIndexOf('"', at);
  return /\bfr\s*\?\s*(?:"[^"\n]*"|`[^`\n]*`|t\([^)\n]*\))\s*:\s*$/.test(src.slice(Math.max(0, open - 600), open));
};

describe("gallery datasets in French (QA 0.8.67 G10)", () => {
  it("needs-you card: every English sentence has a French twin", () => {
    const src = source("needs-you-card.tsx");
    for (const english of ["the client asks for an on-site visit", "Do we open the ConnectWise ticket", "security notice forwarded", "third advertising reminder", "Import the dispatch routines.", "Board 1: two tickets need you", "Hourly new tickets", "@Nova · work", '"Main"']) {
      expect(behindFrench(src, english), english).toBe(true);
    }
    expect(src).toContain('t("needsYou.title", { bot: "Atlas" })');
    expect(src).toContain('t("needsYou.titleQuestion", { bot: "Atlas" })');
    expect(src).not.toContain('"Atlas needs you"');
  });

  it("chat-busy: the wait chip uses the presence key, with no dash", () => {
    const src = source("page-chat-real.tsx");
    expect(src).toContain('t("chat.presence.busyElsewhere", { name: "Scout" })');
    expect(src).not.toContain("will reply here when free");
    expect(behindFrench(src, '"Gallery model"')).toBe(true);
  });

  it("the page preview stub answers in the language of the gallery page", () => {
    const plugin = galleryPagePreview();
    let handler: ((req: unknown, res: unknown, next: () => void) => void) | undefined;
    (plugin.configureServer as (server: unknown) => void)({ middlewares: { use: (fn: typeof handler) => { handler = fn; } } });
    const render = (url: string, cookie?: string) => {
      let body = "";
      handler!({ url, headers: cookie ? { cookie } : {} }, { setHeader() {}, end: (text: string) => { body = text; } }, () => {});
      return body;
    };
    expect(render("/pages/preview/p/1?theme=dark", "theme=x; sagax-gallery-lang=fr")).toContain("Rapport mensuel synthétique");
    expect(render("/pages/preview/p/1?theme=dark&lang=fr")).toContain("Chiffres et notes synthétiques.");
    const english = render("/pages/preview/p/1?theme=light");
    expect(english).toContain("Synthetic monthly report");
    expect(english).not.toContain("synthétique");
  });
});
