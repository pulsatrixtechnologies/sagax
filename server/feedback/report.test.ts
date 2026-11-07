import { describe, expect, it } from "vitest";
import { buildReport, reportTitle } from "./report.ts";

const NAMES = { people: ["Alexandra Tremblay"], orgs: ["Acme Plomberie"], bots: ["Nova"] };

describe("feedback report", () => {
  it("builds a detailed, anonymized body from named fields with the filing labels", () => {
    const report = buildReport(
      {
        kind: "bug",
        steps: "Open Nova settings as Alexandra Tremblay\nClick Save",
        expected: "The change is kept",
        actual: "Spinner forever, error mailed to alex@acme-plomberie.ca",
        impact: "Blocking",
        followups: [{ field: "steps", question: "Which page?", answer: "Settings of Acme Plomberie" }],
      },
      {
        source: "error",
        platform: "desktop",
        appVersion: "0.8.63",
        os: "macOS 27.0",
        page: "settings",
        error: "fetch failed for 10.0.0.4 thread 3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b",
        serverLines: ["warn [bots] retry for /Users/alex/.sagax/data"],
        clientLogs: ["console error token=ghp_abcdefghijklmnopqrstuvwxyz0123456789AB"],
        spans: [{ name: "tool.call", ms: 1200, ok: false }],
        screenshot: true,
      },
      NAMES,
    );
    expect(report.labels).toEqual(["feedback", "feedback:untriaged", "bug"]);
    expect(report.title.startsWith("[Feedback] Bug: ")).toBe(true);
    for (const heading of ["## Summary", "## Steps to reproduce", "## Expected", "## Actual", "## Impact", "## Follow-up", "## Context", "## Error", "## Server log", "## App log", "## Recent spans"]) {
      expect(report.body).toContain(heading);
    }
    for (const leak of ["Alexandra", "Acme", "Nova", "alex@", "10.0.0.4", "3f2a9c1e", "/Users/alex", "ghp_abcdefghij"]) {
      expect(report.body).not.toContain(leak);
      expect(report.title).not.toContain(leak);
    }
    expect(report.body).toContain("| App version | 0.8.63 |");
    expect(report.body).toContain("tool.call");
  });

  it("maps an idea to enhancement and a question to question, and caps the title", () => {
    expect(buildReport({ kind: "idea", describe: "Pin a conversation", followups: [] }, { source: "sidebar", platform: "ios" }, {}).labels).toContain("enhancement");
    expect(buildReport({ kind: "question", describe: "How to share?", followups: [] }, { source: "slash", platform: "web" }, {}).labels).toContain("question");
    expect(reportTitle("bug", "x".repeat(300)).length).toBeLessThanOrEqual(100);
  });
});
