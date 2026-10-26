import { describe, expect, it } from "vitest";

import { APP_LIMITS, appExcerpt, appToText, parseAppInput } from "./app.ts";

describe("parseAppInput", () => {
  it("accepts a non-empty html string and trims it", () => {
    const parsed = parseAppInput({ html: "  <p>Bonjour</p>  " });
    expect(parsed).toEqual({ ok: true, html: "<p>Bonjour</p>" });
  });

  it("keeps a trimmed title when the bot gives one", () => {
    const parsed = parseAppInput({ html: "<p>x</p>", title: "  Tableau de bord  " });
    expect(parsed).toEqual({ ok: true, html: "<p>x</p>", title: "Tableau de bord" });
  });

  it("drops an empty or blank title instead of storing it", () => {
    expect(parseAppInput({ html: "<p>x</p>", title: "   " })).toEqual({ ok: true, html: "<p>x</p>" });
    expect(parseAppInput({ html: "<p>x</p>", title: null })).toEqual({ ok: true, html: "<p>x</p>" });
  });

  it("refuses empty or whitespace-only html", () => {
    expect(parseAppInput({ html: "" }).ok).toBe(false);
    expect(parseAppInput({ html: "   \n  " }).ok).toBe(false);
  });

  it("refuses malformed input: a missing or non-string html", () => {
    expect(parseAppInput({}).ok).toBe(false);
    expect(parseAppInput({ html: 42 }).ok).toBe(false);
    expect(parseAppInput(null).ok).toBe(false);
    expect(parseAppInput("<p>x</p>").ok).toBe(false);
  });

  it("refuses html past the byte limit", () => {
    const big = "a".repeat(APP_LIMITS.htmlBytes + 1);
    const parsed = parseAppInput({ html: big });
    expect(parsed.ok).toBe(false);
  });

  it("refuses a title past its limit", () => {
    const parsed = parseAppInput({ html: "<p>x</p>", title: "t".repeat(APP_LIMITS.title + 1) });
    expect(parsed.ok).toBe(false);
  });

  it("refuses a non-string title", () => {
    expect(parseAppInput({ html: "<p>x</p>", title: 5 }).ok).toBe(false);
  });
});

describe("appExcerpt", () => {
  it("strips tags, script and style to visible text", () => {
    const html = "<style>.a{color:red}</style><h1>Titre</h1><script>alert(1)</script><p>Corps</p>";
    expect(appExcerpt(html)).toBe("Titre Corps");
  });
});

describe("appToText", () => {
  it("prefers the title, prefixed as an app", () => {
    expect(appToText({ html: "<p>Corps</p>", title: "Mon app" })).toBe("[app] Mon app");
  });

  it("falls back to the page excerpt when there is no title", () => {
    expect(appToText({ html: "<h1>Rapport</h1>" })).toBe("[app] Rapport");
  });

  it("falls back to a marker when nothing is readable", () => {
    expect(appToText({ html: "<script>1</script>" })).toBe("[app]");
  });
});
