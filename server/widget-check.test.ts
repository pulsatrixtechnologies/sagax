import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { userInfo } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  checkWidgetForTurn,
  IMPERFECT_WIDGET_FENCE,
  resolveWidgetChrome,
  WidgetCheckAttempts,
  widgetCheckReport,
  widgetHostPage,
  WidgetRenderer,
  type WidgetCheckResult,
} from "./widget-check.ts";

const FIXTURES = join(import.meta.dirname, "testing", "widget-check-fixtures");
const fixture = (name: string) => readFileSync(join(FIXTURES, `${name}.html`), "utf8");

describe("widget check report", () => {
  const failed: WidgetCheckResult = {
    status: "failed",
    ms: 900,
    defects: [{ kind: "crushed", target: "label.checkbox \"Inclure\"", detail: "4 words on 13 lines", views: ["desktop light", "desktop dark", "phone light", "phone dark"] }],
  };

  it("asks for a fix and a new check while attempts remain", () => {
    const report = widgetCheckReport(failed, { attempt: 1, repeated: false, best: { attempt: 1, defects: 1 } });
    expect(report.isError).toBe(true);
    expect(report.text).toContain("attempt 1 of 3");
    expect(report.text).toContain("- crushed text [all views] label.checkbox");
    expect(report.text).toContain("call check_widget again");
  });

  it("after the last attempt, names the best version and the imperfect fence", () => {
    const report = widgetCheckReport(failed, { attempt: 3, repeated: false, best: { attempt: 2, defects: 1 } });
    expect(report.text).toContain("attempt 2, 1 defect(s)");
    expect(report.text).toContain(`\`\`\`${IMPERFECT_WIDGET_FENCE} fence`);
  });

  it("a pass says to show that exact HTML; no renderer is not an error", () => {
    expect(widgetCheckReport({ status: "passed", defects: [], ms: 800 }, { attempt: 2, repeated: false, best: null })).toMatchObject({ isError: false, text: expect.stringContaining("Show this exact HTML") });
    expect(widgetCheckReport({ status: "unavailable", defects: [], reason: "no headless browser on this server", ms: 0 }, { attempt: 0, repeated: false, best: null })).toMatchObject({ isError: false });
  });

  it("counts attempts per turn, a repeated HTML once, and keeps the best", () => {
    const attempts = new WidgetCheckAttempts();
    expect(attempts.record("t:1", "a", 4)).toMatchObject({ attempt: 1, repeated: false });
    expect(attempts.record("t:1", "b", 1)).toMatchObject({ attempt: 2, best: { attempt: 2, defects: 1 } });
    expect(attempts.record("t:1", "a", 4)).toMatchObject({ attempt: 2, repeated: true });
    expect(attempts.record("t:1", "c", 2)).toMatchObject({ attempt: 3, best: { attempt: 2, defects: 1 } });
    expect(attempts.record("t:2", "c", 2)).toMatchObject({ attempt: 1 });
  });
});

describe("widget check setup", () => {
  it("never picks the person's browser: explicit, the bots' Chrome, then nothing", () => {
    const exists = (path: string) => path === "/opt/chrome" || path === "/x/chrome";
    expect(resolveWidgetChrome({ SAGAX_WIDGET_CHECK_CHROME: "off", AGENT_BROWSER_EXECUTABLE_PATH: "/opt/chrome" }, exists)).toBeNull();
    expect(resolveWidgetChrome({ SAGAX_WIDGET_CHECK_CHROME: "/x/chrome" }, exists)).toBe("/x/chrome");
    expect(resolveWidgetChrome({ AGENT_BROWSER_EXECUTABLE_PATH: "/opt/chrome", PLAYWRIGHT_BROWSERS_PATH: "/nowhere" }, exists)).toBe("/opt/chrome");
    expect(resolveWidgetChrome({ PLAYWRIGHT_BROWSERS_PATH: "/nowhere" }, exists)).toBeNull();
  });

  it("draws the widget in the chat's sandboxed frame with its document", () => {
    const page = widgetHostPage("<p>Hi</p>", "dark", "");
    expect(page).toContain('sandbox="allow-scripts"');
    expect(page).toContain("background:#161616");
    expect(page).toContain("Content-Security-Policy");
    expect(page).not.toMatch(/srcdoc=[^;]*<\/script>/);
  });

  it("starts nothing while memory is short", async () => {
    let spawned = 0;
    const renderer = new WidgetRenderer({ chromePath: "/bin/false", memoryOk: () => false, onSpawn: () => { spawned += 1; } });
    const result = await renderer.check("<p>x</p>");
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("memory");
    expect(spawned).toBe(0);
  });

  it("refuses empty or oversized HTML before rendering", async () => {
    const renderer = new WidgetRenderer({ chromePath: null });
    const attempts = new WidgetCheckAttempts();
    expect((await checkWidgetForTurn(renderer, attempts, "t:1", { html: "" })).status).toBe(400);
    expect((await checkWidgetForTurn(renderer, attempts, "t:1", { html: "x".repeat(200_001) })).status).toBe(400);
    expect((await checkWidgetForTurn(renderer, attempts, "t:1", { html: "<p>x</p>" })).body.text).toContain("unavailable");
  });
});

// The real renderer: a headless Chrome (the bots' Chrome on a server, a
// Playwright headless shell here). Skipped where none is installed.
// (server/testing/setup.ts moves HOME, so look in the real one)
const chrome = resolveWidgetChrome({
  ...process.env,
  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH
    || join(userInfo().homedir, ...(process.platform === "darwin" ? ["Library", "Caches"] : [".cache"]), "ms-playwright"),
});
describe.skipIf(!chrome)("widget check in a headless Chrome", () => {
  const renderer = new WidgetRenderer({ chromePath: chrome });
  afterAll(() => renderer.close());

  const kinds = async (name: string) => {
    const result = await renderer.check(fixture(name));
    return { result, kinds: new Set(result.defects.map((defect) => defect.kind)) };
  };

  it("passes healthy widgets with no false positive", async () => {
    for (const name of ["healthy-form", "healthy-calculator"]) {
      const { result } = await kinds(name);
      expect(result.defects, name).toEqual([]);
      expect(result.status).toBe("passed");
      expect(result.screenshot).toBeUndefined();
    }
  }, 60_000);

  it("catches the checkbox labels of before #809: crushed text and overlap", async () => {
    const { result, kinds: found } = await kinds("broken-checkbox-809");
    expect(result.status).toBe("failed");
    expect(found).toContain("crushed");
    expect(found).toContain("overlap");
    expect(result.defects.find((defect) => defect.kind === "crushed")?.target).toContain("label.checkbox");
    expect(result.screenshot?.length).toBeGreaterThan(100);
  }, 60_000);

  it("catches overflow, overlap, a script error, low contrast and small targets", async () => {
    expect((await kinds("broken-overflow")).kinds).toContain("clipped");
    expect((await kinds("broken-overlap")).kinds).toContain("overlap");
    const script = await kinds("broken-js");
    expect(script.kinds).toEqual(new Set(["script"]));
    expect(script.result.defects[0]!.detail).toContain("addEventListener");
    expect((await kinds("broken-contrast")).kinds).toContain("contrast");
    expect((await kinds("broken-targets")).kinds).toContain("target");
  }, 90_000);

  it("catches a document wider than the frame", async () => {
    const result = await renderer.check('<div style="width:900px">Large tableau sans retour</div>');
    expect(result.defects.map((defect) => defect.kind)).toContain("hscroll");
    expect(result.defects.find((defect) => defect.kind === "hscroll")?.views).toEqual(["desktop light", "desktop dark", "phone light", "phone dark"]);
  }, 60_000);

  it("names a box that scrolls sideways once, not every item hidden in it", async () => {
    const result = await renderer.check('<div class="card"><div style="display:flex;gap:8px;overflow-x:auto">' + Array.from({ length: 8 }, (_, n) => `<label style="white-space:nowrap;flex-shrink:0"><input type="checkbox"> Option de rapport numéro ${n}</label>`).join("") + "</div></div>");
    expect(result.defects.map((defect) => defect.kind)).toEqual(["hscroll"]);
  }, 60_000);

  it("stops after three failed checks in a turn", async () => {
    const attempts = new WidgetCheckAttempts();
    const broken = fixture("broken-overlap");
    let last = "";
    for (let n = 0; n < 3; n += 1) {
      last = (await checkWidgetForTurn(renderer, attempts, "thread:7", { html: `${broken}<!-- ${n} -->` })).body.text ?? "";
    }
    expect(last).toContain("attempt 3 of 3");
    expect(last).toContain("widget-imperfect");
  }, 90_000);

  it("never reaches the network, loopback included, even when the widget leaves its frame", async () => {
    let hits = 0;
    const server = createServer((_req, res) => { hits += 1; res.end("secret page"); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const result = await renderer.check(`<p>x</p><img src="http://127.0.0.1:${port}/img"><script>setTimeout(function(){location.href="http://127.0.0.1:${port}/admin"},0)</script>`);
      expect(hits).toBe(0);
      expect(JSON.stringify(result)).not.toContain("secret page");
      expect(result.status).toBe("failed");
    } finally {
      server.close();
    }
  }, 60_000);

  it("does not call text without spaces crushed", async () => {
    const result = await renderer.check('<div class="card"><p>这是一个健康的段落，用于测试中文文本在正常宽度的容器中换行时不会被误报为文字被压扁的问题，因为中文没有空格。这是一个健康的段落，用于测试中文文本。</p></div>');
    expect(result.defects).toEqual([]);
  }, 60_000);

  it("refuses a fourth check in the turn without drawing", async () => {
    const attempts = new WidgetCheckAttempts();
    for (let n = 0; n < 3; n += 1) attempts.record("thread:9", `v${n}`, 2);
    const refused = await checkWidgetForTurn(new WidgetRenderer({ chromePath: "/nonexistent" }), attempts, "thread:9", { html: "<p>v4</p>" });
    expect(refused.body.text).toContain("No check left");
  });

  it("gives up on a widget that never finishes drawing, and recovers", async () => {
    const slow = new WidgetRenderer({ chromePath: chrome, deadlineMs: 3_000 });
    try {
      const stuck = await slow.check("<p>x</p><script>while(true){}</script>");
      expect(stuck.status).toBe("unavailable");
      expect((await slow.check(fixture("healthy-form"))).status).toBe("passed");
    } finally {
      await slow.close();
    }
  }, 60_000);

  it("is quick once warm", async () => {
    await renderer.check(fixture("healthy-form"));
    const result = await renderer.check(fixture("healthy-calculator"));
    expect(result.ms).toBeLessThan(4_000);
  }, 60_000);
});
