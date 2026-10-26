// @vitest-environment happy-dom
// The bundled data-dashboards skill (parity adoption of OpenMausBot #3279,
// adapted to our fork): a grouped guide plus a self-contained dashboard.html
// the bot copies into a save_artifact or propose_page. Our artifact sandbox
// has no network, so the template draws its charts with inline SVG, not a
// chart library, and loads nothing from a URL. Here: the skill mounts on the
// right turns, the guide points at the template, the template stays
// self-contained, and the template actually renders KPIs, charts and tables.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { ARTIFACT_LIMITS } from "../shared/artifacts.ts";
import { loadBundledSkills, selectBundledSkills } from "./skill-library.ts";

// The server's TypeScript has no DOM library: the happy-dom globals are read
// loosely, the same way server/published-pages-prelude.test.ts does.
const document = (globalThis as any).document;
const windowAny = globalThis as any;

const SKILLS_DIR = join(process.cwd(), "skills");
const skills = loadBundledSkills(SKILLS_DIR);
const skill = skills.find((each) => each.manifest.id === "data-dashboards");
const template = readFileSync(join(SKILLS_DIR, "data-dashboards", "dashboard.html"), "utf8");
const ids = (text: string) => selectBundledSkills(text, [], skills).map((each) => each.manifest.id);

describe("the data-dashboards skill is present and well-formed", () => {
  it("loads with an empty capability list, so a plain dashboard turn can reach it", () => {
    expect(skill).toBeTruthy();
    expect(skill!.manifest.requiredCapabilities).toEqual([]);
    expect(skill!.manifest.defaultEnabled).toBe(true);
  });

  it("mounts for dashboards, charts and KPIs, and stays out of unrelated turns", () => {
    for (const text of ["Build me a sales dashboard", "Chart revenue by month", "can you visualise this?", "Show our KPIs on a page", "make a graph of signups", "graph it by week"]) {
      expect(ids(text), text).toContain("data-dashboards");
    }
    for (const text of ["Write a paragraph about photography", "fix the typo in my biography", "summarize this email", "book a call for Friday"]) {
      expect(ids(text), text).not.toContain("data-dashboards");
    }
  });

  it("keeps the guide short, in plain words, and pointing at its template and our tools", () => {
    const guide = skill!.instructions;
    expect(guide.split("\n").length).toBeLessThanOrEqual(150);
    expect(guide).toContain("dashboard.html");
    for (const tool of ["save_artifact", "propose_page", "data_sql"]) expect(guide).toContain(tool);
    for (const upstream of ["mausbot", "openmaus", "ECharts", "DuckDB", "show_html", "publish_page"]) {
      expect(guide.toLowerCase(), upstream).not.toContain(upstream.toLowerCase());
    }
  });

  it("ships a self-contained template: no network, our sandbox bridge, room for embedded data", () => {
    expect(/https?:\/\//.test(template), "the template must not load anything from a URL").toBe(false);
    expect(template).not.toMatch(/<script[^>]+\bsrc=/i);
    expect(template).not.toMatch(/<link[^>]+\bhref=/i);
    expect(template).toContain('id="embedded-data"');
    expect(template).toContain("window.sagax");
    expect(Buffer.byteLength(template)).toBeLessThan(ARTIFACT_LIMITS.html / 2);
  });
});

/** Mount the template into the happy-dom document and run its app script, the
 * way the artifact frame would. innerHTML never runs scripts, so the app
 * script is pulled out and run on its own after the markup (with the embedded
 * data) is in place. */
function mountTemplate(withSagax?: { data: unknown }) {
  const body = /<body>([\s\S]*)<\/body>/.exec(template)![1]!;
  const appScript = /<script>\s*\(function \(\) \{[\s\S]*?\}\)\(\);\s*<\/script>/.exec(body)![0];
  const inner = appScript.replace(/^<script>/, "").replace(/<\/script>$/, "");
  if (withSagax) {
    windowAny.sagax = { data: withSagax.data, onData: (fn: (value: unknown) => void) => fn(withSagax.data) };
  } else {
    delete windowAny.sagax;
  }
  document.body.innerHTML = body.replace(appScript, "");
  new Function(inner)();
}

describe("the dashboard template renders", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("draws KPI tiles, a bar chart, a line chart and a detail table from the embedded rows", () => {
    mountTemplate();
    expect(document.querySelectorAll(".kpi").length).toBe(4);
    expect(document.getElementById("kpis")!.textContent).toContain("Regions");
    const bar = document.getElementById("bar")!;
    expect(bar.innerHTML).toContain("<rect");
    const line = document.getElementById("line")!;
    expect(line.innerHTML).toContain("<path");
    expect(document.querySelectorAll("#detail tbody tr").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("#bar-table tbody tr").length).toBeGreaterThan(0);
    // The loading line clears once the data is in.
    expect(document.getElementById("status")!.style.display).toBe("none");
    // The region filter is populated beyond the "All" option.
    expect(document.querySelectorAll("#region-filter option").length).toBeGreaterThan(1);
  });

  it("reads its rows from the refresh bridge when the artifact has a source", () => {
    mountTemplate({ data: [
      { date: "2026-10-01", region: "Solo", category: "Service", units: 10, revenue: 1000 },
    ] });
    expect(document.querySelectorAll("#region-filter option").length).toBe(2); // All + Solo
    expect(document.querySelectorAll("#detail tbody tr").length).toBe(1);
  });

  it("shows a plain error, not a blank page, when the data has the wrong shape", () => {
    delete windowAny.sagax;
    const body = /<body>([\s\S]*)<\/body>/.exec(template)![1]!;
    const appScript = /<script>\s*\(function \(\) \{[\s\S]*?\}\)\(\);\s*<\/script>/.exec(body)![0];
    const inner = appScript.replace(/^<script>/, "").replace(/<\/script>$/, "");
    document.body.innerHTML = body.replace(appScript, "").replace(/<script id="embedded-data"[^>]*>[\s\S]*?<\/script>/, '<script id="embedded-data" type="application/json">{"unexpected":true}</script>');
    new Function(inner)();
    const status = document.getElementById("status")!;
    expect(status.style.display).not.toBe("none");
    expect(status.getAttribute("data-tone")).toBe("error");
  });
});
