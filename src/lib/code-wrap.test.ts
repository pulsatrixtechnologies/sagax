import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { breakableCodeText, wrapCodeChildren } from "./code-wrap";

describe("code-wrap", () => {
  it("inserts break opportunities after path separators", () => {
    const text = breakableCodeText("/Users/workspace/bots/disk-saver/scripts/cleanup.sh");
    expect(text).toContain("/\u200B");
    expect(text.replace(/\u200B/g, "")).toBe("/Users/workspace/bots/disk-saver/scripts/cleanup.sh");
  });

  it("leaves LaTeX-style escapes unbroken", () => {
    expect(breakableCodeText("\\(a\\)")).toBe("\\(a\\)");
    expect(breakableCodeText("\\[b\\]")).toBe("\\[b\\]");
  });

  it("breaks Windows path backslashes", () => {
    expect(breakableCodeText("C:\\Users\\bot\\file")).toBe("C:\\\u200BUsers\\\u200Bbot\\\u200Bfile");
  });

  it("wraps string children of inline code", () => {
    const html = renderToStaticMarkup(createElement("code", null, wrapCodeChildren("a/b/c")));
    expect(html).toContain("a/\u200Bb/\u200Bc");
  });
});
