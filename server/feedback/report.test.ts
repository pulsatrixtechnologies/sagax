import { describe, expect, it } from "vitest";
import { buildReport, reportShape, reportTitle } from "./report.ts";

const NAMES = { people: ["Ada Lovelace"], orgs: ["Nimbus Plumbing"], bots: ["Nova"] };

describe("feedback report (#3299)", () => {
  it("builds a precise, anonymized body from the words, the chat and the context", () => {
    const report = buildReport(
      { said: "Nova never saves my profile, I expected the new name to stay but the spinner turns forever. Mail ada@nimbus-plumbing.ca", detail: undefined },
      {
        source: "slash",
        platform: "desktop",
        appVersion: "0.8.63",
        serverVersion: "0.8.63",
        os: "macOS 27.0",
        page: "settings",
        engine: "claude",
        model: "claude-test-model",
        chat: {
          asks: ["Rename me to Ada Lovelace in Nimbus Plumbing"],
          error: "fetch failed for 10.0.0.4 thread 3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b (request id: req_01ABCDEFGHJK)",
          turnId: "turn-1",
          requestIds: ["req_01ABCDEFGHJK"],
          failedTools: ["profile_save"],
        },
        serverLines: ["warn [bots] retry for /Users/ada/.sagax/data"],
        clientLogs: ["console error token=ghp_abcdefghijklmnopqrstuvwxyz0123456789AB"],
        spans: [{ name: "tool.call", ms: 1200, ok: false }],
      },
      NAMES,
    );
    expect(report.labels).toEqual(["feedback", "feedback:untriaged", "bug"]);
    expect(report.title.startsWith("[Feedback] Bug: ")).toBe(true);
    for (const heading of ["## Summary", "## Steps to reproduce", "## Expected", "## Actual", "## What the person was doing", "## In their words", "## Context", "## Error", "## Server log", "## App log", "## Recent spans"]) {
      expect(report.body).toContain(heading);
    }
    expect(report.body).toContain("## Expected\n\nThe new name to stay");
    expect(report.body).toContain("## Actual\n\n[bot] never saves my profile. the spinner turns forever. The turn ends with the error below.");
    expect(report.body).toContain("2. Open a chat with a bot on the claude engine, model claude-test-model.");
    expect(report.body).toContain('3. Send: "Rename me to [person] in [org]"');
    for (const row of ["| Surface | desktop |", "| Engine | claude |", "| Turn id | turn-1 |", "| Request ids | req_01ABCDEFGHJK |", "| Failed tool calls | profile_save |"]) expect(report.body).toContain(row);
    for (const leak of ["Ada", "Nimbus", "Nova", "ada@", "10.0.0.4", "3f2a9c1e", "/Users/ada", "ghp_abcdefghij"]) {
      expect(report.body).not.toContain(leak);
      expect(report.title).not.toContain(leak);
    }
  });

  it("maps an idea to enhancement and a question to question, and caps the title", () => {
    expect(buildReport({ said: "idea: pin a conversation to the top" }, { source: "slash", platform: "ios" }, {}).labels).toContain("enhancement");
    expect(buildReport({ said: "How do I share a bot?" }, { source: "slash", platform: "web" }, {}).labels).toContain("question");
    expect(reportTitle("bug", "x".repeat(300)).length).toBeLessThanOrEqual(100);
  });

  it("keeps steps the person numbered", () => {
    expect(reportShape("1. Open settings\n2. Click Save\nnothing happens", {}).steps).toEqual(["Open settings", "Click Save"]);
  });

  it("never leaks the raw attachment tag and lists attachments by name", () => {
    const report = buildReport(
      { said: 'Le bouton ne répond plus après la mise à jour.\n<attached-image path="/Users/ada/.sagax/att/shot.png" name="shot.png" />', detail: '<attached-image path="/tmp/a.png" name="a.png" />' },
      { source: "slash", platform: "desktop", page: "settings" },
      {},
    );
    expect(report.body).not.toContain("attached-image");
    expect(report.body).not.toContain("/tmp/a.png");
    expect(report.body).not.toContain("/.sagax/");
    expect(report.body).toContain("## Attachments");
    expect(report.body).toContain("2 images attached");
  });

  it("handles a report made only of an image", () => {
    const report = buildReport({ said: '<attached-image path="/x.png" />' }, { source: "slash" }, {});
    expect(report.body).toContain("_No summary given._");
    expect(report.body).toContain("1 image attached");
    expect(report.body).not.toContain("<attached");
  });

  it("never lets a person or company the server does not know reach the issue, from the words or the chat requests (#3299)", () => {
    const report = buildReport(
      { said: "Bob Tremblay de Fabrikam m'a demandé pourquoi la facture ne part pas, je m'attendais à un envoi mais rien", detail: "Northwind Traders a le même problème", extra: ["Kenji Watanabe from WINGTIP confirmed"] },
      {
        source: "slash",
        platform: "desktop",
        appVersion: "0.8.80",
        chat: {
          asks: ["Envoie la facture de Fabrikam à Bob Tremblay", "Check the open tickets for client wingtip and Northwind Traders"],
          error: "Company \"Northwind Traders\" not found",
          requestIds: [],
          failedTools: [],
        },
      },
      { people: ["Alice Martin"], orgs: ["Contoso"] },
    );
    const published = `${report.title}\n${report.body}`;
    for (const leak of ["Bob", "Tremblay", "Fabrikam", "Northwind", "Traders", "Kenji", "Watanabe", "wingtip", "WINGTIP"]) {
      expect(published, leak).not.toContain(leak);
    }
    // the report still says what the person was doing and what failed
    expect(report.body).toContain("> Envoie la facture de [name] à [name]");
    expect(report.body).toContain("> Check the open tickets for client [name] and [name]");
    expect(report.body).toContain('Company "[name]" not found');
  });
});
