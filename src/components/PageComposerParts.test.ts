// The line over the floating composer while a page is open: the bot working,
// or its newest answer since the page was opened, in one line.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";
import { ComposerPageCiteStrip, pageBotStatusLine, PageSelectionQuote } from "./PageComposerParts";

const bot = (text: string, at: number) => ({ role: "bot" as const, kind: "text" as const, text, at });
const user = (text: string, at: number) => ({ role: "user" as const, kind: "text" as const, text, at });

describe("pageBotStatusLine", () => {
  it("says the bot is on it while it works", () => {
    expect(pageBotStatusLine([bot("old", 1)], true, 5)).toEqual({ kind: "working" });
  });

  it("shows the newest answer after the page was opened, in one line, words kept whole", () => {
    expect(pageBotStatusLine([user("x", 6), bot("**Got it**, the `summary_table`\nis shorter", 7)], false, 5)).toEqual({ kind: "reply", text: "Got it, the summary_table is shorter" });
  });

  it("shows nothing for an answer from before the page was opened", () => {
    expect(pageBotStatusLine([bot("earlier", 1)], false, 5)).toBeNull();
    expect(pageBotStatusLine([], false, 5)).toBeNull();
  });

  it("cuts a long answer", () => {
    const line = pageBotStatusLine([bot("x".repeat(400), 9)], false, 5);
    expect(line?.kind === "reply" && line.text.length).toBe(160);
  });
});

describe("the passage a message is about (#4099)", () => {
  it("is drawn under the page chip in the reply's quote strip, on one line", () => {
    const html = renderToStaticMarkup(createElement(PageSelectionQuote, { selection: { kind: "text", quote: "Le volume\n a augmenté", prefix: "", suffix: "", path: "body > p", tag: "p" } }));
    expect(html).toContain("data-page-ref-quote");
    expect(html).toContain("rounded-2xl bg-ink/[0.06]");
    expect(html).toContain(`${t("pages.selection.tag")}: `);
    expect(html).toContain(">Le volume a augmenté<");
  });

  it("a part of the page without words is named by its tag", () => {
    const html = renderToStaticMarkup(createElement(PageSelectionQuote, { selection: { kind: "element", quote: " ", prefix: "", suffix: "", path: "body > table", tag: "table" } }));
    expect(html).toContain("&lt;table&gt;");
  });
});

describe("composer page cite strip (#5464)", () => {
  it("shows the parked passage above the message field", () => {
    const html = renderToStaticMarkup(createElement(ComposerPageCiteStrip, {
      cite: { pageId: "p1", title: "Rapport Q3", selection: { kind: "text", quote: "Le volume\n a augmente", prefix: "", suffix: "", path: "body > p", tag: "p" } },
      onClear: () => {},
    }));
    expect(html).toContain("data-composer-page-cite");
    expect(html).toContain("Le volume a augmente");
    expect(html).toContain(t("pages.selection.citeStrip", { title: "Rapport Q3" }));
    expect(html).toContain(t("pages.selection.clearCite"));
  });
});
