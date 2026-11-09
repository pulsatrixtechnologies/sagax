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

describe("feedback report structure (attachments, title, summary)", () => {
  const text = 'Le bouton ne répond plus après la mise à jour. Rien ne se passe quand je clique.\n<attached-image path="/Users/alex/.sagax/att/shot.png" name="shot.png" />';
  it("never leaks the raw attachment tag and lists attachments by name", () => {
    const report = buildReport(
      { kind: "bug", steps: `Ouvrir les réglages\n<attached-image path="/tmp/a.png" name="a.png" />\nCliquer`, expected: "Ça sauvegarde", actual: text, followups: [] },
      { source: "slash", platform: "desktop", page: "settings" },
      {},
    );
    expect(report.body).not.toContain("attached-image");
    expect(report.body).not.toContain("/tmp/a.png");
    expect(report.body).not.toContain("/.sagax/");
    expect(report.body).toContain("## Attachments");
    expect(report.body).toContain("2 images attached");
    expect(report.body).toContain("1. Ouvrir les réglages\n2. Cliquer");
  });
  it("makes a short descriptive title and a reworded summary, not the verbatim answer", () => {
    const long = "Le bouton ne répond plus après la mise à jour de l'application sur mon ordinateur et je dois tout redémarrer chaque fois que ça arrive, c'est pénible. Autre phrase.";
    const report = buildReport({ kind: "bug", actual: long, followups: [] }, { source: "slash", page: "settings" }, {});
    expect(report.title.length).toBeLessThanOrEqual(100);
    expect(report.title).toMatch(/^\[Feedback\] Bug: .+ \(settings\)$/);
    expect(report.title).not.toContain("Autre phrase");
    const summary = report.body.split("## Summary")[1]!.split("##")[0]!;
    expect(summary).toContain("The person reported a bug from the settings page.");
    expect(summary).not.toContain(long);
    expect(summary).not.toContain(">");
  });
  it("handles an answer made only of an image", () => {
    const report = buildReport({ kind: "idea", describe: '<attached-image path="/x.png" />', followups: [] }, { source: "slash" }, {});
    expect(report.body).toContain("_No summary given._");
    expect(report.body).toContain("1 image attached");
    expect(report.body).not.toContain("<attached");
  });
});
