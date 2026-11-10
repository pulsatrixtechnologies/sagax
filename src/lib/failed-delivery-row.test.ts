import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { isFailedTeammateStep, localizedServerLine, readStep } from "./step-label";

afterEach(() => {
  setLocale("en");
});

const LONG_DASH = /[–—]/;
const FULL_ACCESS = "Full access could not deliver the answer to the engine; retry the task after reconnecting.";

// #3288: failed send and Full access delivery rows the server writes in
// English read in the person's language and stay visible with tool calls off.
describe("failed delivery rows (#3288)", () => {
  it("reads a failed send in French, with no long dash, its cause quiet after it", () => {
    setLocale("fr");
    for (const name of ["Send failed — The person stopped this turn.", "Send failed - The person stopped this turn."]) {
      const reading = readStep({ name, ok: false });
      expect(reading.label).toBe("Envoi échoué");
      expect(reading.target).toBe("The person stopped this turn.");
      expect(reading.label).not.toMatch(LONG_DASH);
    }
  });

  it("localizes a known cause of a failed send", () => {
    setLocale("fr");
    const reading = readStep({ name: "Send failed - Resuming after a restart", ok: false });
    expect(reading.target).toBe(localizedServerLine("Resuming after a restart"));
  });

  it("reads a send to a deleted thread in French", () => {
    setLocale("fr");
    const early = readStep({ name: "Send to Olive failed — its thread was deleted before it could start", ok: false }).label;
    expect(early).toBe("Envoi à Olive échoué : son fil a été supprimé avant de démarrer");
    const late = readStep({ name: "Send to Olive failed - its thread was deleted", ok: false }).label;
    expect(late).toBe("Envoi à Olive échoué : son fil a été supprimé");
    expect(early).not.toMatch(LONG_DASH);
    expect(late).not.toMatch(LONG_DASH);
  });

  it("reads the Full access delivery failure in French", () => {
    setLocale("fr");
    const label = readStep({ name: FULL_ACCESS, ok: false }).label;
    expect(label).not.toBe(FULL_ACCESS);
    expect(label).toBe("L'accès complet n'a pas pu transmettre la réponse au moteur. Reconnecte-toi, puis relance la tâche.");
    expect(localizedServerLine(FULL_ACCESS)).toBe(label);
  });

  it("reads the same rows in English with no long dash", () => {
    expect(readStep({ name: "Send failed — boom", ok: false })).toEqual({ label: "Send failed", target: "boom" });
    expect(readStep({ name: "Send to Olive failed — its thread was deleted", ok: false }).label).toBe("Send to Olive failed: its thread was deleted");
  });

  it("keeps a failed send and a failed Full access answer visible with tool calls off", () => {
    const row = (name: string) => ({ kind: "activity", tool: { name, ok: false } });
    expect(isFailedTeammateStep(row("Send failed — x"))).toBe(true);
    expect(isFailedTeammateStep(row("Send failed - x"))).toBe(true);
    expect(isFailedTeammateStep(row("Send to Olive failed - its thread was deleted before it could start"))).toBe(true);
    expect(isFailedTeammateStep(row(FULL_ACCESS))).toBe(true);
    // a plain failed step still goes with tool calls off
    expect(isFailedTeammateStep(row("Bash"))).toBe(false);
  });
});
