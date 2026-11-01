import { describe, expect, it } from "vitest";

import {
  ROUTINE_QUIET_MARKER,
  routineReportOutcome,
  routineRunReportable,
} from "./routine-report.ts";

describe("routineReportOutcome", () => {
  it("is quiet when the bot ends with the marker, and keeps the note for the logs", () => {
    expect(routineReportOutcome(`Checked 12 invoices, all have a PO.\n\n${ROUTINE_QUIET_MARKER}`))
      .toEqual({ quiet: true, report: "Checked 12 invoices, all have a PO." });
    expect(routineReportOutcome("NOTHING_TO_REPORT")).toEqual({ quiet: true, report: "" });
    // the shapes a model actually writes it in
    for (const marker of ["`NOTHING_TO_REPORT`", "**nothing_to_report**", "[NOTHING_TO_REPORT]", "nothing_to_report."]) {
      expect(routineReportOutcome(`Done.\n${marker}`).quiet, marker).toBe(true);
    }
  });

  it("is quiet only when the WHOLE message is a no-op (Owner review 2026-10-22)", () => {
    for (const quiet of ["Nothing to report.", "Rien à signaler.", "Nothing to flag.", "Done. Nothing to report.", "ok — nothing to do", "No change needed."]) {
      expect(routineReportOutcome(quiet).quiet, quiet).toBe(true);
    }
    // a real finding that merely contains a no-op phrase must still reach the person
    for (const report of [
      "DB01 is down. Nothing to flag on the others.",
      "The 8:40 run is the invoicing-days boost. October 22 is outside days 1-5, so this pass ends with nothing to report.",
      "No new tickets. Nothing to do.",
      "Aucune nouvelle facture, rien à faire aujourd'hui.",
    ]) {
      expect(routineReportOutcome(report).quiet, report).toBe(false);
    }
  });

  it("is quiet when nothing was said at all", () => {
    expect(routineReportOutcome(undefined).quiet).toBe(true);
    expect(routineReportOutcome("   ").quiet).toBe(true);
  });

  it("reports a result, a question or a long report even when it mentions nothing to report", () => {
    expect(routineReportOutcome("3 invoices without a PO: #1201, #1207, #1210. I drafted the reminders.")).toEqual({
      quiet: false,
      report: "3 invoices without a PO: #1201, #1207, #1210. I drafted the reminders.",
    });
    // a question needs the person, even a bare one
    expect(routineReportOutcome("Nothing to report on Acme, but should I also check Globex?").quiet).toBe(false);
    // a long report that happens to end with the words is still a report
    const long = `${"Ticket #4410 moved to Waiting on client; ".repeat(12)}nothing to report otherwise.`;
    expect(routineReportOutcome(long).quiet).toBe(false);
    // the marker in the middle of a sentence is not the marker
    expect(routineReportOutcome("Found 2 issues. I did not write NOTHING_TO_REPORT because there is work.").quiet).toBe(false);
  });
});

describe("routineRunReportable", () => {
  it("never posts while a run is queued or running, nor when it ends with nothing to report", () => {
    for (const status of ["queued", "running", "cancelled", "missed", "nothing_to_report"] as const) {
      expect(routineRunReportable({ status, postResults: true }), status).toBe(false);
    }
    expect(routineRunReportable({ status: "completed", quiet: true, postResults: true })).toBe(false);
    expect(routineRunReportable({ status: "completed", goalStatus: "completed", quiet: true, postResults: true })).toBe(false);
  });

  it("posts a completed result only when the routine posts results (Owner 2026-10-22)", () => {
    expect(routineRunReportable({ status: "completed", postResults: true })).toBe(true);
    expect(routineRunReportable({ status: "completed", postResults: false })).toBe(false);
    expect(routineRunReportable({ status: "completed" })).toBe(false);
  });

  it("an error, a question or an approval surfaces whichever way postResults is set", () => {
    for (const postResults of [true, false, undefined]) {
      expect(routineRunReportable({ status: "failed", postResults })).toBe(true);
      expect(routineRunReportable({ status: "waiting", needsPerson: true, postResults })).toBe(true);
      expect(routineRunReportable({ status: "waiting", goalStatus: "needs-input", postResults })).toBe(true);
    }
  });

  it("a wait on delegated work or a usage limit is not the person's", () => {
    expect(routineRunReportable({ status: "waiting", postResults: true })).toBe(false);
    expect(routineRunReportable({ status: "waiting", goalStatus: "paused", postResults: true })).toBe(false);
  });
});

describe("the bot's own run status (2026-11-01)", () => {
  it("reads RUN_STATUS failed or partial on a line of its own, never quiet", () => {
    expect(routineReportOutcome("RUN_STATUS: failed: the CRM refused the login\nNothing was read."))
      .toEqual({ quiet: false, report: "Nothing was read.", declared: { status: "failed", reason: "the CRM refused the login" } });
    expect(routineReportOutcome("Read 10 of 12.\n**RUN_STATUS: partial** — two PDFs unreadable\nNOTHING_TO_REPORT"))
      .toEqual({ quiet: false, report: "Read 10 of 12.", declared: { status: "partial", reason: "two PDFs unreadable" } });
    expect(routineReportOutcome("RUN_STATUS: partial").declared?.reason).toBe("The bot reported that only part of the work was done");
    // Only the line itself: a sentence that mentions it is a report.
    expect(routineReportOutcome("The status was partial today.").declared).toBeUndefined();
  });

  it("a run with problems tells the person; a person's own start shows from the start", () => {
    expect(routineRunReportable({ status: "completed", problems: "x", postResults: false })).toBe(true);
    expect(routineRunReportable({ status: "completed", quiet: true, problems: "x" })).toBe(true);
    for (const status of ["queued", "running", "waiting"] as const) {
      expect(routineRunReportable({ status, startedBy: "person" }), status).toBe(true);
    }
    expect(routineRunReportable({ status: "nothing_to_report", startedBy: "person" })).toBe(false);
  });
});
