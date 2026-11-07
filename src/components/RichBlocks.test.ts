// Rendered output of the chat's rich blocks, through ChatMarkdown exactly as
// a bot message reaches it. Model text is hostile by default here.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatMarkdown, CODE_COLLAPSE_LINES } from "./ChatMarkdown";
import { EmailCard } from "./EmailCard";
import { widgetFrameAttributes } from "./WidgetFrame";
import { ChartBlock, chartTableModel, CHART_PALETTE } from "./ChartBlock";
import { RichTable, tableModelFromDelimited, FILTER_THRESHOLD } from "./RichTable";
import { parseChartSpec, parseEmailBlock, WIDGET_CSP } from "@/lib/rich-blocks";

const render = (text: string) => renderToStaticMarkup(createElement(ChatMarkdown, { text }));

describe("email card", () => {
  const email = "Here is the draft:\n\n```email\nTo: ana@example.com\nCc: bo@example.com\nSubject: Renewal & next steps\n\nHi Ana,\n\n**Thanks** for today. Details at [our site](https://example.com).\n```";

  it("renders header rows, a formatted body and the three actions", () => {
    const html = render(email);
    expect(html).toContain("<article");
    expect(html).toContain("Email draft");
    expect(html).toContain(">ana@example.com</dd>");
    expect(html).toContain(">bo@example.com</dd>");
    expect(html).toContain("Renewal &amp; next steps");
    expect(html).toContain("<strong>Thanks</strong>");
    expect(html).toContain(">Copy</button>");
    expect(html).toContain(">Copy as rich text</button>");
    expect(html).toContain('href="mailto:ana@example.com?cc=bo@example.com&amp;subject=Renewal%20%26%20next%20steps&amp;body=');
    expect(html).toContain("Open in mail app");
    // no invented backend: there is no send or create-draft action
    expect(html).not.toMatch(/>Send<|Create draft/);
    expect(html).not.toContain("<pre");
  });

  it("detects a draft in a plain text fence with mail headers", () => {
    const html = render("```\nTo: a@b.c\nSubject: Hi\n\nBody\n```");
    expect(html).toContain("<article");
    // an ordinary snippet stays a code block
    expect(render("```\nconst subject = 1;\n```")).not.toContain("<article");
  });

  it("keeps a hostile body inert", () => {
    const draft = parseEmailBlock('Subject: x\n\n<img src=x onerror="alert(1)"><script>alert(2)</script> [click](javascript:alert(3)) ![p](https://tracker.test/p.png)', "email")!;
    const html = renderToStaticMarkup(createElement(EmailCard, { draft }));
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("tracker.test");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("widget", () => {
  it("renders a sandboxed iframe with only allow-scripts and the CSP first", () => {
    const html = render("```widget\n<button onclick=\"n++\">+</button><script>let n=0</script>\n```");
    const iframe = /<iframe[^>]*>/.exec(html)?.[0] ?? "";
    expect(iframe).toContain('sandbox="allow-scripts"');
    expect(iframe).not.toContain("allow-same-origin");
    expect(iframe).not.toContain("allow-popups");
    expect(iframe).not.toContain("allow-forms");
    expect(iframe).not.toContain("allow-top-navigation");
    expect(iframe).toMatch(/referrerpolicy="no-referrer"/i);
    const srcdoc = /srcdoc="([^"]*)"/i.exec(iframe)?.[1] ?? "";
    expect(srcdoc).not.toBe("");
    expect(srcdoc.indexOf("Content-Security-Policy")).toBeLessThan(srcdoc.indexOf("onclick"));
    expect(html).toContain("View source");
    expect(html).toContain("Full screen");
  });

  it("exposes the exact frame attributes", () => {
    expect(widgetFrameAttributes("<p>x</p>", "Widget")).toMatchObject({ sandbox: "allow-scripts", referrerPolicy: "no-referrer", allow: "" });
    expect(WIDGET_CSP).toContain("connect-src 'none'");
  });

  it("waits for an unclosed widget fence instead of running half a document", () => {
    const html = render("Building it:\n\n```widget\n<div id=app></div>\n<script>");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("still being written");
  });

  it("lifts a Claude antArtifact HTML tag into the sandboxed widget", () => {
    const html = render('Here:\n<antArtifact type="text/html" title="Box"><button>Go</button></antArtifact>');
    expect(html).toContain("<iframe");
    expect(html).toContain("Interactive widget");
    expect(html).not.toContain("&lt;antArtifact");
  });
});

describe("artifact page card", () => {
  it("renders a title and Open for a real URL, and never invents a link", () => {
    const html = render('```artifact\n{"title":"Quarterly review","url":"https://claude.ai/code/artifact/abc"}\n```');
    expect(html).toContain("Quarterly review");
    expect(html).toContain("Open");
    expect(html).toContain('href="https://claude.ai/code/artifact/abc"');
    expect(html).not.toContain("<iframe");
    expect(render('```artifact\n{"title":"Nope","url":"javascript:alert(1)"}\n```')).not.toContain("javascript:");
  });
});

describe("chart", () => {
  it("draws an SVG with a legend for several series and no model markup", () => {
    const html = render('```chart\n{"type":"bar","title":"Tickets <b>","labels":["Mon","Tue"],"series":[{"name":"Opened","data":[4,7]},{"name":"Closed","data":[3,6]}]}\n```');
    expect(html).toContain("<svg");
    expect(html).toContain('role="img"');
    expect(html).toContain("Tickets &lt;b&gt;");
    expect(html).not.toContain("<b>");
    expect(html).toContain(">Opened</li>");
    expect(html).toContain(">Closed</li>");
    expect(html).toContain(CHART_PALETTE.dark[0]);
  });

  it("explains a chart it cannot draw and shows the source", () => {
    const html = renderToStaticMarkup(createElement(ChartBlock, { code: "{oops" }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("{oops");
  });

  it("offers the same numbers as a table", () => {
    const spec = parseChartSpec("x,a\nq1,1\nq2,2");
    if ("error" in spec) throw new Error(spec.error);
    const model = chartTableModel(spec);
    expect(model.header.map((cell) => cell.text)).toEqual(["x", "a"]);
    expect(model.rows[1]!.text).toEqual(["q2", "2"]);
  });
});

describe("tables", () => {
  it("right-aligns numeric columns, sticks the header and offers copy", () => {
    const html = render("| Item | Cost |\n| --- | --- |\n| Disk | $1,200 |\n| RAM | $300 |");
    expect(html).toMatch(/<th scope="col" class="sticky top-0[^"]*text-end/);
    // the cell's text sits in a dir="auto" box (mixed-script cells, 2318f17368)
    expect(html).toMatch(/<td class="[^"]*tabular-nums[^"]*text-end"><div dir="auto"[^>]*>\$1,200<\/div><\/td>/);
    expect(html).toContain("overflow-auto");
    expect(html).toContain('aria-label="Copy as CSV"');
    expect(html).toContain('aria-label="Copy as Markdown"');
    expect(html).toContain("2 rows");
    // small tables get no filter box
    expect(html).not.toContain('type="search"');
  });

  it("keeps rendered Markdown inside cells", () => {
    const html = render("| Link | Code |\n| --- | --- |\n| [docs](https://example.com) | `x()` |");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<code");
  });

  it("adds a filter once a table is large", () => {
    const rows = Array.from({ length: FILTER_THRESHOLD + 1 }, (_unused, index) => `| r${index} | ${index} |`).join("\n");
    expect(render(`| a | b |\n| --- | --- |\n${rows}`)).toContain('type="search"');
  });

  it("turns a csv fence into a sortable table", () => {
    const html = render("```csv\nname,qty\nbolt,12\nnut,3\n```");
    expect(html).toContain("<table");
    expect(html).toContain("Sort by qty");
    expect(html).not.toContain("<pre");
    const model = tableModelFromDelimited('a,b\n"<img src=x onerror=alert(1)>",2')!;
    const cell = renderToStaticMarkup(createElement(RichTable, { model }));
    expect(cell).not.toContain("<img");
  });
});

describe("markdown extras", () => {
  it("renders GitHub callouts with their icon and title", () => {
    const html = render("> [!WARNING]\n> Back up first.\n\n> [!TIP] Faster way\n> Use the flag.");
    expect(html).toContain('data-callout="warning"');
    expect(html).toContain(">Warning</span>");
    expect(html).toContain("Back up first.");
    expect(html).not.toContain("[!WARNING]");
    expect(html).toContain(">Faster way</span>");
    // an ordinary quote stays a quote
    expect(render("> just a quote")).toContain("<blockquote");
  });

  it("draws task list checkboxes", () => {
    const html = render("- [x] done\n- [ ] todo");
    expect(html).toContain('role="checkbox" aria-checked="true"');
    expect(html).toContain('role="checkbox" aria-checked="false"');
    expect(html).not.toContain("list-disc");
  });

  it("renders footnotes as in-message links with message-scoped ids", () => {
    const html = render("Claim.[^1]\n\n[^1]: Source.");
    expect(html).toContain('aria-label="Footnotes"');
    expect(html).toMatch(/href="#m[a-zA-Z0-9]+-fn-1"/);
    expect(html).not.toMatch(/href="#[^"]*"[^>]*target="_blank"/);
    expect(html).toContain('class="sr-only"');
  });

  it("gives headings unique anchors", () => {
    const html = render("## Setup\n\ntext\n\n## Setup");
    const ids = [...html.matchAll(/role="heading"[^>]*/g)].length;
    expect(ids).toBe(2);
    expect(html).toMatch(/id="m[a-zA-Z0-9]+-setup"/);
    expect(html).toMatch(/id="m[a-zA-Z0-9]+-setup-1"/);
    expect(html).toContain('aria-label="Link to this section"');
  });

  it("folds long code behind a button, but not short code", () => {
    const long = Array.from({ length: CODE_COLLAPSE_LINES + 5 }, (_unused, index) => `line ${index}`).join("\n");
    const html = render(`\`\`\`text\n${long}\n\`\`\``);
    expect(html).toContain(`Show all ${CODE_COLLAPSE_LINES + 5} lines`);
    expect(html).toContain('aria-expanded="false"');
    expect(render("```text\nshort\n```")).not.toContain("Show all");
  });

  it("shows raster data images but never SVG or HTML data URLs", () => {
    const png = render("![dot](data:image/png;base64,iVBORw0KGgo=)");
    expect(png).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    const svg = render("![x](data:image/svg+xml;base64,PHN2Zz4=)");
    expect(svg).not.toContain("data:image/svg");
    const link = render("[x](data:image/png;base64,iVBORw0KGgo=)");
    expect(link).not.toContain("data:image/png");
  });

  it("keeps raw HTML and script URLs inert everywhere", () => {
    const html = render('<iframe src="https://evil.test"></iframe><script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n| a |\n| --- |\n| <img src=x onerror=alert(1)> |');
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(html).not.toMatch(/<img[^>]*onerror/);
  });
});
