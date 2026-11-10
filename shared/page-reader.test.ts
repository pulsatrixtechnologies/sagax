// The reader's bar (shared/page-reader.ts): what its script accepts from the
// wrapper, and its words in both languages.
import { describe, expect, it } from "vitest";

import { parseReaderBoot, readerBotColor, readerByline, READER_STRING_KEYS, READER_STRINGS_FR_KEYS, readerNotice, readerText } from "./page-reader.ts";

const BOOT = { v: 1, lang: "fr", title: "Rapport", kind: "html", version: 2, pageId: "page_12345678", me: { id: "pr_x", name: "X" }, owner: { name: "X" }, can: { share: true, annotate: true } };

describe("parseReaderBoot", () => {
  it("keeps a well-formed block", () => {
    expect(parseReaderBoot(BOOT)).toEqual(BOOT);
  });

  it("a right without the page's id is no right", () => {
    const { pageId: _gone, ...rest } = BOOT;
    expect(parseReaderBoot(rest)!.can).toEqual({ share: false, annotate: false });
    expect(parseReaderBoot({ ...BOOT, pageId: "../x" })!.can.share).toBe(false);
  });

  it("refuses anything else", () => {
    for (const bad of [null, [], "x", { ...BOOT, v: 2 }, { ...BOOT, lang: "de" }, { ...BOOT, kind: "pdf" }, { ...BOOT, version: 0 }, { ...BOOT, title: 3 }]) {
      expect(parseReaderBoot(bad)).toBeNull();
    }
  });
});

describe("the publishing bot in the bar (2026-10-29)", () => {
  it("keeps a mascot color name or #rrggbb and its character, drops anything else", () => {
    const look = { character: "shape", shape: "star" };
    expect(parseReaderBoot({ ...BOOT, bot: { name: "Scout", color: "green", look } })!.bot).toEqual({ name: "Scout", color: "green", look });
    expect(parseReaderBoot({ ...BOOT, bot: { name: "Scout", color: "#A1B2C3" } })!.bot).toEqual({ name: "Scout", color: "#a1b2c3" });
    for (const color of ["red;x", "url(x)", "#fff", "", 3]) {
      expect(parseReaderBoot({ ...BOOT, bot: { name: "Scout", color } })!.bot).toBeUndefined();
      expect(readerBotColor(color)).toBeNull();
    }
    expect(parseReaderBoot({ ...BOOT, bot: { name: "Scout", color: "green", look: [1] } })!.bot).toEqual({ name: "Scout", color: "green" });
  });
});

describe("the bar's words", () => {
  it("the byline sets the bot's name apart and keeps the notice's words", () => {
    for (const lang of ["fr", "en"] as const) {
      const line = readerByline({ bot: "Scout", person: "P", lang });
      const notice = readerNotice({ bot: "Scout", person: "P", lang });
      expect(`${line.before}${line.bot}${line.after}`).toBe(notice.who);
      expect(line.bot).toBe("Scout");
      expect(line.warning).toBe(notice.warning);
    }
  });

  it("the notice keeps every word of the old banner", () => {
    expect(readerNotice({ bot: "Scout", person: "P", lang: "en" })).toEqual({ who: "Page published by Scout for P", warning: "This is not a Sagax screen, never enter a password here." });
    expect(readerNotice({ bot: "Scout", person: "P", lang: "fr" }).warning).toBe("Ceci n'est pas un écran Sagax, n'y entre jamais de mot de passe.");
  });

  it("every key has French and English, with the same placeholders", () => {
    // #3413 lot 1b: English first, the Quebec French is lot 1c (readerText falls
    // back to English meanwhile); empty this list when 1c lands
    const FRENCH_PENDING = new Set(["capReads", "capReadsHint", "capTitle", "capScope", "capViewer", "capOpen", "capAsk", "capAskWhat", "capAllow", "capAlways", "capLinkTitle", "capLinkNote", "capLinkOpen", "capLinkAlways", "capLinkAlwaysHint", "capLinkMore", "capLinkLess"]);
    expect([...READER_STRINGS_FR_KEYS].sort()).toEqual(READER_STRING_KEYS.filter((key) => !FRENCH_PENDING.has(key)).sort());
    for (const key of READER_STRING_KEYS.filter((entry) => !FRENCH_PENDING.has(entry))) {
      const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(names(readerText("fr", key))).toEqual(names(readerText("en", key)));
    }
    expect(readerText("en", "shareTitle", { title: "R" })).toBe("Share “R”");
  });
});
