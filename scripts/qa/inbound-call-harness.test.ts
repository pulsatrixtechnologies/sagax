// Synthetic inbound call harness (#5535): V-1..V-4 on fixtures, loopback only.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  FIXTURE_TIMING,
  SCENARIO_IDS,
  checkSpokenRegister,
  parseInboundCallHarnessArgs,
  renderInboundCallHarnessMarkdown,
  runInboundCallHarness,
} from "./inbound-call-harness.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("checkSpokenRegister", () => {
  it("accepts short spoken Quebec French and refuses links, lists and long answers", () => {
    expect(checkSpokenRegister("Le billet est ouvert. Je te rappelle demain.")).toEqual({ ok: true, reasons: [] });
    expect(checkSpokenRegister("Vois https://example.test/x").reasons).toContain("url");
    expect(checkSpokenRegister("Points:\n- un\n- deux").reasons).toContain("list");
    expect(checkSpokenRegister("Un. Deux. Trois. Quatre. Cinq.").reasons.some((r) => r.startsWith("too_many_sentences"))).toBe(true);
  });
});

describe("parseInboundCallHarnessArgs", () => {
  it("reads --out and refuses unknown flags", () => {
    expect(parseInboundCallHarnessArgs(["--out", "/tmp/report"])).toEqual({ out: "/tmp/report" });
    expect(() => parseInboundCallHarnessArgs(["--real"])).toThrow(/unknown argument/);
    expect(() => parseInboundCallHarnessArgs(["--out"])).toThrow(/needs a directory/);
  });
});

describe("runInboundCallHarness", () => {
  it("passes V-1 through V-4 on fixtures and writes the report", async () => {
    const out = mkdtempSync(join(tmpdir(), "sagax-inbound-call-harness-test-"));
    dirs.push(out);
    const report = await runInboundCallHarness({ out });
    expect(report.version).toBe(1);
    expect(report.scenarios.map((s) => s.id)).toEqual([...SCENARIO_IDS]);
    expect(report.scenarios.every((s) => s.passed), report.scenarios.filter((s) => !s.passed).map((s) => `${s.id}: ${s.details.join("; ")}`).join(" | ")).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.notes.some((n) => /loopback|127\.0\.0\.1/i.test(n))).toBe(true);
    expect(report.notes.some((n) => /Twilio|real person|STT/i.test(n))).toBe(true);

    const v1 = report.scenarios.find((s) => s.id === "V-1")!;
    expect(v1.evidence).toMatchObject({ via: "call", callerMasked: "***0100" });

    const v3 = report.scenarios.find((s) => s.id === "V-3")!;
    expect(Number(v3.evidence.firstSpeechPathMs)).toBeLessThanOrEqual(FIXTURE_TIMING.firstSpeechBudgetMs);
    expect(v3.evidence.interruptNotePresent).toBe(true);

    const v4 = report.scenarios.find((s) => s.id === "V-4")!;
    expect(v4.evidence).toMatchObject({
      thirdPartyCall: "card",
      telephonyRulesRequireCard: true,
      outboundCardPending: true,
      deniedStatus: true,
      callNeverPlaced: true,
    });

    const json = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    expect(json.passed).toBe(true);
    const md = readFileSync(join(out, "report.md"), "utf8");
    expect(md).toContain("V-1");
    expect(md).toContain("pass");
    expect(renderInboundCallHarnessMarkdown(report)).toContain("Inbound call harness report");
    expect(JSON.stringify(report)).not.toMatch(/5145550100/);
  }, 30_000);
});
