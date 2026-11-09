import { describe, expect, it } from "vitest";

import {
  ROUTINE_QUIET_MARKER,
  flowRunBlockedReason,
  routineReportOutcome,
  routineReportProse,
  routineRunReportable,
} from "./routine-report.ts";

describe("routineReportOutcome", () => {
  it("is quiet when the final message is only control tokens, and strips one after a report", () => {
    expect(routineReportOutcome("<|eos|>")).toEqual({ quiet: true, report: "" });
    expect(routineReportOutcome("  <|im_end|>\n<|endoftext|> ")).toEqual({ quiet: true, report: "" });
    expect(routineReportOutcome("Deux courriels classés.<|eos|>")).toEqual({ quiet: false, report: "Deux courriels classés." });
    // No bubble, no unread, no notification: the run has nothing to post.
    expect(routineRunReportable({ status: "completed", quiet: routineReportOutcome("<|eos|>").quiet, postResults: true })).toBe(false);
  });

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

describe("flowRunBlockedReason", () => {
  it("names Flow refusals that must end a Sagax routine run as blocked", () => {
    expect(flowRunBlockedReason("Blocking run: previous has not been closed: one routine run at a time"))
      .toMatch(/earlier run of this Flow routine is still open/i);
    expect(flowRunBlockedReason("unknown routine: hourly-qc1-tunnel-watch")).toMatch(/does not know the routine "hourly-qc1-tunnel-watch"/);
    expect(flowRunBlockedReason("run_exists: lease still held")).toMatch(/already holds a run/i);
    expect(flowRunBlockedReason("previous_unclosed")).toMatch(/never closed/i);
  });

  // 2026-11-03 production (Monday billing pass): a JSON refusal reads in
  // plain words, never as its first line "{".
  it("reads a JSON refusal, split across lines, in plain words", () => {
    const refusal = `<<<UNTRUSTED source="tool">>>\n{\n  "ok": false,\n  "error": "run_exists",\n  "message": "PX_FLOW_RUN_DIR already holds a run"\n}`;
    const reason = flowRunBlockedReason(refusal)!;
    expect(reason).toMatch(/already holds a run/i);
    expect(reason).not.toBe("{");
    expect(flowRunBlockedReason(JSON.stringify({ ok: false, error: "a run of routine x (r1) started at t, last event none, has not been closed: one routine run at a time" })))
      .toMatch(/still open/i);
  });

  it("never blocks on a document or a successful result that only names a refusal code", () => {
    // read_file of SKILL.md, the false positive that blocked the run
    const skill = JSON.stringify({ path: "/workspace/skills/running-px-flow/SKILL.md", content: `${"Flow runs. ".repeat(200)}\n\`run init\` reports an earlier run as \`previous_unclosed\` (an anomaly)` }, null, 2);
    expect(flowRunBlockedReason(skill)).toBeUndefined();
    expect(flowRunBlockedReason(`# Running\n${"Prose. ".repeat(200)}\nrun init reports previous_unclosed`)).toBeUndefined();
    // run init succeeded and noted an earlier unclosed run: not a refusal
    expect(flowRunBlockedReason(JSON.stringify({ run_id: "r2", routine: "x", previous_unclosed: { run_id: "r1" } }))).toBeUndefined();
  });

  it("ignores ordinary tool output so a healthy Flow run stays completed", () => {
    expect(flowRunBlockedReason(undefined)).toBeUndefined();
    expect(flowRunBlockedReason("")).toBeUndefined();
    expect(flowRunBlockedReason("Checked 12 invoices, all have a PO.")).toBeUndefined();
    expect(flowRunBlockedReason("run init ok; units dispatched")).toBeUndefined();
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
      expect(routineRunReportable({ status: "blocked", postResults })).toBe(true);
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

describe("a wake on teammates' messages is never quiet (production, 2026-11-02)", async () => {
  const { peerWakeOutcome } = await import("./routines.ts");
  const { routineReportOutcome } = await import("./routine-report.ts");
  const peer = { proactive: { mode: "proactive" as const, hops: 1, sources: ["peer"], peerDigest: "Messages from teammates:\n- Osprey: Urgent 100200" } };

  it("keeps the bot's words without the marker", () => {
    const outcome = peerWakeOutcome(peer, routineReportOutcome("Already told you at 1:32 p.m. ET. Nothing new.\n\nNOTHING_TO_REPORT"));
    expect(outcome).toMatchObject({ quiet: false, report: "Already told you at 1:32 p.m. ET. Nothing new." });
  });

  it("falls back to the digest when the bot said nothing else", () => {
    expect(peerWakeOutcome(peer, routineReportOutcome("NOTHING_TO_REPORT")).report).toBe(peer.proactive.peerDigest);
    expect(peerWakeOutcome(peer, routineReportOutcome("")).quiet).toBe(false);
  });

  it("a wake on a post in a two-bot DM (alwaysReport) is never quiet either", () => {
    const dm = { proactive: { mode: "proactive" as const, hops: 1, sources: ["bot"], alwaysReport: true as const, peerDigest: "Messages from teammates:\n- Post by Osprey in K and M" } };
    expect(peerWakeOutcome(dm, routineReportOutcome("NOTHING_TO_REPORT"))).toMatchObject({ quiet: false, report: dm.proactive.peerDigest });
    const room = { proactive: { mode: "proactive" as const, hops: 1, sources: ["bot"] } };
    expect(peerWakeOutcome(room, routineReportOutcome("NOTHING_TO_REPORT")).quiet).toBe(true);
  });

  it("leaves other wakes and routines as they were", () => {
    const mail = { proactive: { mode: "proactive" as const, hops: 0, sources: ["mail"] } };
    expect(peerWakeOutcome(mail, routineReportOutcome("NOTHING_TO_REPORT")).quiet).toBe(true);
    expect(peerWakeOutcome({}, routineReportOutcome("NOTHING_TO_REPORT")).quiet).toBe(true);
  });
});

describe("items only the person can do (2026-11-05)", () => {
  it("are never quiet and always post, whatever postResults says", () => {
    const outcome = routineReportOutcome("- [HUMAIN] **100201**: decide which client it belongs to.\nNOTHING_TO_REPORT");
    expect(outcome.quiet).toBe(false);
    expect(outcome.report).toBe("- [HUMAIN] **100201**: decide which client it belongs to.");
    expect(routineRunReportable({ status: "completed", postResults: false, attention: true })).toBe(true);
    expect(routineRunReportable({ status: "completed", postResults: false })).toBe(false);
  });
});

describe("routineReportProse (#3152)", () => {
  it("drops the status line and turns a markdown table into a short list", () => {
    const outcome = routineReportOutcome([
      "RUN_STATUS: partial: lecture refusée.",
      "",
      "| Point | État | GO |",
      "|:---|---|---:|",
      "| Sagax 0.8.76 | à surveiller | GO requis |",
      "| Jeton GitHub |  | GO requis |",
      "",
      "Deux GO attendent.",
    ].join("\n"));
    expect(outcome.declared).toEqual({ status: "partial", reason: "lecture refusée." });
    expect(outcome.report).toBe("- Sagax 0.8.76: à surveiller, GO requis\n- Jeton GitHub: GO requis\n\nDeux GO attendent.");
  });

  it("leaves pipes that are not a table as written", () => {
    expect(routineReportProse("a | b\n| only one row |\nend")).toBe("a | b\n| only one row |\nend");
  });
});
