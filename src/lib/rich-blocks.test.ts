import { describe, expect, it } from "vitest";

import {
  buildWidgetDocument,
  clampWidgetHeight,
  compareCells,
  emailMailtoUrl,
  emailPlainBody,
  emailPlainText,
  formatTick,
  headingSlug,
  isInlineRasterDataUrl,
  MAILTO_MAX_LENGTH,
  nextSort,
  niceTicks,
  numericColumns,
  parseCalloutMarker,
  parseChartSpec,
  parseDelimited,
  parseEmailBlock,
  parseNumeric,
  prefersWideBubble,
  richFenceKind,
  splitAddresses,
  tableToCsv,
  tableToMarkdown,
  unclosedFenceOffset,
  visibleRowOrder,
  WIDGET_CSP,
  WIDGET_MAX_HEIGHT,
  WIDGET_MIN_HEIGHT,
  WIDGET_SANDBOX,
  type ChartSpec,
} from "./rich-blocks";

describe("fence kinds", () => {
  it("maps the documented fence languages, case-insensitively", () => {
    expect(richFenceKind("email")).toBe("email");
    expect(richFenceKind("Mail")).toBe("email");
    expect(richFenceKind("widget")).toBe("widget");
    expect(richFenceKind("widget-imperfect")).toBe("widget");
    expect(richFenceKind("artifact")).toBe("widget");
    expect(richFenceKind("chart")).toBe("chart");
    expect(richFenceKind("TSV")).toBe("csv");
    expect(richFenceKind("ts")).toBeNull();
    expect(richFenceKind("")).toBeNull();
  });
});

describe("email drafts", () => {
  const block = "To: Ana <ana@example.com>, bo@example.com\nCc: \"Lee, Sam\" <sam@example.com>\nSubject: Q3 renewal\n\nHi Ana,\n\n**Thanks** for the call.\n\n- Item one\n";

  it("reads headers, recipients and the body of an email fence", () => {
    const draft = parseEmailBlock(block, "email")!;
    expect(draft.to).toEqual(["Ana <ana@example.com>", "bo@example.com"]);
    expect(draft.cc).toEqual(['"Lee, Sam" <sam@example.com>']);
    expect(draft.subject).toBe("Q3 renewal");
    expect(draft.body).toBe("Hi Ana,\n\n**Thanks** for the call.\n\n- Item one");
  });

  it("treats a header-less email fence as a body-only draft", () => {
    const draft = parseEmailBlock("Hello team,\nSee you soon.", "email")!;
    expect(draft.subject).toBe("");
    expect(draft.to).toEqual([]);
    expect(draft.body).toBe("Hello team,\nSee you soon.");
  });

  it("detects an email in a plain text fence only with Subject plus another header", () => {
    expect(parseEmailBlock(block, "text")?.subject).toBe("Q3 renewal");
    expect(parseEmailBlock(block, "")?.subject).toBe("Q3 renewal");
    expect(parseEmailBlock("Subject: only a subject\n\nbody", "text")).toBeNull();
    expect(parseEmailBlock("To: a@b.c\n\nno subject", "")).toBeNull();
    expect(parseEmailBlock(block, "python")).toBeNull();
    expect(parseEmailBlock("const to = 1;\nSubject: x", "")).toBeNull();
  });

  it("splits address lists on commas and semicolons outside quotes and brackets", () => {
    expect(splitAddresses("a@b.c; \"Doe, J\" <j@d.e>,, x@y.z")).toEqual(["a@b.c", '"Doe, J" <j@d.e>', "x@y.z"]);
  });

  it("builds a mailto URL with encoded fields and bare addresses", () => {
    const draft = parseEmailBlock(block, "email")!;
    const { url, bodyIncluded } = emailMailtoUrl(draft);
    expect(bodyIncluded).toBe(true);
    expect(url.startsWith("mailto:ana@example.com,bo@example.com?")).toBe(true);
    expect(url).toContain("cc=sam@example.com");
    expect(url).toContain("subject=Q3%20renewal");
    expect(url).toContain("body=Hi%20Ana%2C%0D%0A%0D%0AThanks%20for%20the%20call.");
    // header injection: a newline or & in a field never escapes its parameter
    const hostile = emailMailtoUrl({ to: ["a@b.c?bcc=evil@x.y"], cc: [], bcc: [], subject: "x&bcc=evil@x.y\r\nBcc: e@x.y", body: "" }).url;
    expect(hostile).not.toMatch(/[\r\n]/);
    expect(hostile).not.toContain("&bcc=");
    expect(hostile).toContain("a@b.c%3Fbcc%3Devil@x.y");
  });

  it("leaves a long body out of the mailto URL", () => {
    const { url, bodyIncluded } = emailMailtoUrl({ to: ["a@b.c"], cc: [], bcc: [], subject: "Long", body: "word ".repeat(2000) });
    expect(bodyIncluded).toBe(false);
    expect(url.length).toBeLessThanOrEqual(MAILTO_MAX_LENGTH);
    expect(url).not.toContain("body=");
  });

  it("strips Markdown for the plain text copy", () => {
    expect(emailPlainBody("**Bold** and _it_ [site](https://x.y) `code`\n## Head")).toBe("Bold and _it_ site (https://x.y) code\nHead");
    expect(emailPlainText({ to: ["a@b.c"], cc: [], bcc: [], subject: "Hi", body: "Body" })).toBe("To: a@b.c\nSubject: Hi\n\nBody");
  });
});

describe("widget documents", () => {
  it("allows scripts only: no same-origin, forms, popups or navigation", () => {
    expect(WIDGET_SANDBOX).toBe("allow-scripts");
    expect(WIDGET_SANDBOX).not.toContain("same-origin");
  });

  it("forbids every network request in the CSP", () => {
    for (const directive of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'", "img-src data: blob:"]) {
      expect(WIDGET_CSP).toContain(directive);
    }
    expect(WIDGET_CSP).not.toMatch(/https?:|\*/);
  });

  it("puts the CSP before any widget byte and keeps the widget in the body", () => {
    const doc = buildWidgetDocument('<meta http-equiv="refresh" content="0;url=https://evil.test"><script>fetch("https://evil.test")</script>', "light");
    const csp = doc.indexOf("Content-Security-Policy");
    expect(csp).toBeGreaterThan(0);
    expect(csp).toBeLessThan(doc.indexOf("evil.test"));
    expect(doc.indexOf("<body>")).toBeLessThan(doc.indexOf("evil.test"));
    expect(doc).toContain("color-scheme:light");
    expect(buildWidgetDocument("", "dark")).toContain("color-scheme:dark");
  });

  it("clamps reported heights and ignores garbage", () => {
    expect(clampWidgetHeight(10)).toBe(WIDGET_MIN_HEIGHT);
    expect(clampWidgetHeight(1e9)).toBe(WIDGET_MAX_HEIGHT);
    expect(clampWidgetHeight(321.4)).toBe(321);
    expect(clampWidgetHeight("400")).toBeNull();
    expect(clampWidgetHeight(Number.NaN)).toBeNull();
  });
});

describe("table formatting", () => {
  it("parses CSV with quotes, TSV and semicolon files", () => {
    expect(parseDelimited('name,note\n"Doe, J","said ""hi"""\nx,y')).toEqual([["name", "note"], ["Doe, J", 'said "hi"'], ["x", "y"]]);
    expect(parseDelimited("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseDelimited("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseDelimited("a,b\n1,2\n3,4", undefined, 2)).toHaveLength(2);
  });

  it("reads numbers the way people write them in tables", () => {
    expect(parseNumeric("1,234.50")).toBe(1234.5);
    expect(parseNumeric("$12")).toBe(12);
    expect(parseNumeric("-3.5%")).toBe(-3.5);
    expect(parseNumeric("(40)")).toBe(-40);
    expect(parseNumeric("−2")).toBe(-2);
    expect(parseNumeric("12 CAD")).toBe(12);
    expect(parseNumeric("1e3")).toBe(1000);
    expect(parseNumeric("v1.2")).toBeNull();
    expect(parseNumeric("2024-01-02")).toBeNull();
    expect(parseNumeric("")).toBeNull();
  });

  it("finds numeric columns, ignoring empty cells", () => {
    expect(numericColumns([["a", "1", ""], ["b", "", "x"], ["c", "3", ""]], 3)).toEqual([false, true, false]);
  });

  it("sorts numbers numerically, text naturally, and sinks empties", () => {
    const rows = [["b", "10"], ["a", "9"], ["c", ""], ["item 10", "1"], ["item 2", "2"]];
    expect(visibleRowOrder(rows, { sort: { column: 1, direction: "asc" }, numeric: [false, true] })).toEqual([3, 4, 1, 0, 2]);
    expect(visibleRowOrder(rows, { sort: { column: 1, direction: "desc" }, numeric: [false, true] })).toEqual([0, 1, 4, 3, 2]);
    expect(visibleRowOrder(rows, { sort: { column: 0, direction: "asc" } })).toEqual([1, 0, 2, 4, 3]);
    expect(visibleRowOrder(rows, { query: "ITEM" })).toEqual([3, 4]);
    expect(compareCells("", "a", false)).toBe(1);
  });

  it("cycles a header click through ascending, descending and off", () => {
    expect(nextSort(null, 2)).toEqual({ column: 2, direction: "asc" });
    expect(nextSort({ column: 2, direction: "asc" }, 2)).toEqual({ column: 2, direction: "desc" });
    expect(nextSort({ column: 2, direction: "desc" }, 2)).toBeNull();
    expect(nextSort({ column: 1, direction: "desc" }, 2)).toEqual({ column: 2, direction: "asc" });
  });

  it("copies as RFC 4180 CSV and neutralizes spreadsheet formulas", () => {
    expect(tableToCsv(["a", "b"], [["x, y", 'q"t'], ["=HYPERLINK(\"http://e\")", "-5"]]))
      .toBe('a,b\r\n"x, y","q""t"\r\n"\'=HYPERLINK(""http://e"")",-5');
    expect(tableToCsv(["n"], [["@SUM(A1)"], ["+1"]])).toBe("n\r\n'@SUM(A1)\r\n+1");
  });

  it("copies as GFM Markdown with alignment and escaped pipes", () => {
    expect(tableToMarkdown(["Name", "Qty"], [["a|b", "3"]], [null, "right"])).toBe("| Name | Qty |\n| --- | ---: |\n| a\\|b | 3 |");
  });
});

describe("charts", () => {
  const ok = (value: ReturnType<typeof parseChartSpec>): ChartSpec => {
    if ("error" in value) throw new Error(value.error);
    return value;
  };

  it("reads labels plus series JSON", () => {
    const spec = ok(parseChartSpec('{"type":"line","title":"Load","labels":["a","b"],"series":[{"name":"cpu","data":[1,"2"]}]}'));
    expect(spec).toMatchObject({ type: "line", title: "Load", labels: ["a", "b"], series: [{ name: "cpu", values: [1, 2] }] });
  });

  it("reads row-object JSON and Chart.js datasets", () => {
    expect(ok(parseChartSpec('{"x":"m","y":["a"],"data":[{"m":"Jan","a":3},{"m":"Feb","a":null}]}')).series[0]!.values).toEqual([3, null]);
    expect(ok(parseChartSpec('{"type":"doughnut","labels":["x","y"],"datasets":[{"label":"n","data":[2,3]}]}')).type).toBe("pie");
  });

  it("reads CSV with an optional type line", () => {
    const spec = ok(parseChartSpec("type: area\nmonth,in,out\nJan,1,2\nFeb,3,4"));
    expect(spec.type).toBe("area");
    expect(spec.xLabel).toBe("month");
    expect(spec.series.map((series) => series.name)).toEqual(["in", "out"]);
  });

  it("caps series at eight and folds extra pie slices into Other", () => {
    const wide = { labels: ["a"], series: Array.from({ length: 10 }, (_unused, index) => ({ name: `s${index}`, data: [index + 1] })) };
    const spec = ok(parseChartSpec(JSON.stringify(wide)));
    expect(spec.series).toHaveLength(8);
    expect(spec.truncatedSeries).toBe(2);
    const pie = ok(parseChartSpec(JSON.stringify({ type: "pie", labels: "abcdefghij".split(""), series: [{ name: "n", data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }] })));
    expect(pie.labels).toHaveLength(8);
    expect(pie.labels.at(-1)).toBe("Other");
    expect(pie.series[0]!.values.at(-1)).toBe(1 + 2 + 3);
  });

  it("reports unusable input instead of drawing", () => {
    expect(parseChartSpec("{not json")).toHaveProperty("error");
    expect(parseChartSpec('{"labels":["a"],"series":[{"data":["x"]}]}')).toHaveProperty("error");
    expect(parseChartSpec("")).toHaveProperty("error");
    expect(parseChartSpec("[1,2]")).toHaveProperty("error");
  });

  it("makes round ticks and compact labels", () => {
    expect(niceTicks(0, 87)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(5, 5).length).toBeGreaterThan(1);
    expect(formatTick(12_500)).toBe("12.5k");
    expect(formatTick(3_000_000)).toBe("3M");
    expect(formatTick(0.25)).toBe("0.25");
  });
});

describe("markdown extras", () => {
  it("parses GitHub alert markers and aliases", () => {
    expect(parseCalloutMarker("[!WARNING] Heads up")).toEqual({ kind: "warning", title: "Heads up" });
    expect(parseCalloutMarker("[!note]\nbody")).toEqual({ kind: "note", title: "" });
    expect(parseCalloutMarker("[!danger]")).toEqual({ kind: "caution", title: "" });
    expect(parseCalloutMarker("[!UNKNOWN]")).toBeNull();
    expect(parseCalloutMarker("text [!NOTE]")).toBeNull();
  });

  it("slugs headings in any script", () => {
    expect(headingSlug("Set up: the *fast* way!")).toBe("set-up-the-fast-way");
    expect(headingSlug("مرحبا بالعالم")).toBe("مرحبا-بالعالم");
    expect(headingSlug("!!!")).toBe("section");
  });

  it("finds a fence the message has not closed yet", () => {
    expect(unclosedFenceOffset("a\n```js\nx\n```\nb")).toBe(-1);
    const text = "intro\n```widget\n<div>";
    expect(unclosedFenceOffset(text)).toBe(text.indexOf("```"));
    expect(unclosedFenceOffset("~~~\nx\n~~~\n````chart\n{")).toBe(10);
  });

  it("widens bubbles for tables and rich fences only", () => {
    expect(prefersWideBubble("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(true);
    expect(prefersWideBubble("```chart\n{}\n```")).toBe(true);
    expect(prefersWideBubble("```cw\n{}\n```")).toBe(true);
    expect(prefersWideBubble('<antArtifact type="text/html"><p>x</p></antArtifact>')).toBe(true);
    expect(prefersWideBubble("```js\nx\n```\nplain prose")).toBe(false);
  });

  it("accepts raster data URLs only", () => {
    expect(isInlineRasterDataUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isInlineRasterDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isInlineRasterDataUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isInlineRasterDataUrl("data:image/png,<svg onload=alert(1)>")).toBe(false);
  });
});
