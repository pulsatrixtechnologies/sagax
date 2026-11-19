// The read-only soul audit (#5019): finds what is not identity, persona or
// voice, and never flags a voice rule.
import { describe, expect, it } from "vitest";

import { auditSoul } from "./soul-audit.ts";

describe("soul audit", () => {
  it("a persona and its voice are clean, the voice rule included", () => {
    expect(auditSoul([
      "Tu es Melonie, l'adjointe de l'équipe.",
      "",
      "## Voix",
      "",
      "- Never open the way you opened the previous reply.",
      "- Court, chaleureux, en français du Québec.",
      "- Jamais de jargon.",
      "- Toujours tutoyer.",
      "- Ne jamais signer.",
    ].join("\n"))).toEqual([]);
  });

  it("flags rules, a procedure, a fleet table and a decision log", () => {
    const findings = auditSoul([
      "You are Marc, the dispatcher.",
      "",
      "## Rules",
      "",
      "- Never assign a ticket without checking the schedule.",
      "",
      "## Triage",
      "",
      "1. Read the ticket.",
      "2. Check the schedule.",
      "3. Assign.",
      "",
      "## Fleet",
      "",
      "| Bot | Role |",
      "|---|---|",
      "| Ada | QA |",
      "",
      "Decided on 2026-11-02: tickets close on Fridays.",
    ].join("\n"));
    expect(findings.map((finding) => finding.kind).sort()).toEqual(["decisions", "procedure", "reference", "rules"]);
  });

  it("flags a run of never and always lines outside a voice section", () => {
    const findings = auditSoul(["You are Ada.", "", "- Never send.", "- Always ask.", "- Never delete.", "- Always copy the client."].join("\n"));
    expect(findings).toEqual([expect.objectContaining({ kind: "rules", why: "4 never/always lines" })]);
  });
});
