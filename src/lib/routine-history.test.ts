import { afterEach, expect, it } from "vitest";
import { setLocale } from "./i18n";
import { historySteps, historySummary, runOutcome } from "./routine-history";
import type { RoutineRun } from "./routines";

const run = (fields: Partial<RoutineRun>) => ({ status: "completed", ...fields }) as RoutineRun;
afterEach(() => setLocale("en"));

it("reads the stored server messages in French and preserves bot-written words", () => {
  setLocale("fr");
  expect(historySummary(run({ status: "failed", error: "Stopped waiting: a new run of this routine started instead" }))).toContain("Une nouvelle passe");
  expect(historySummary(run({ problems: "7 tool steps failed and the run ended without a final message" }))).toBe("Terminée, 7 étapes en échec");
  expect(runOutcome(run({ output: "Nothing for you this time; nothing was posted." }))).toEqual(["Rien pour toi"]);
  expect(runOutcome(run({ output: "The second verification failed" }))).toEqual(["The second verification failed"]);
});

it("separates pre-checks, notes, completed quiet reports and structured outcomes", () => {
  setLocale("fr");
  expect(runOutcome(run({ status: "nothing_to_report", output: "No changes" }))).toEqual([]);
  expect(runOutcome(run({ quiet: true }))).toEqual(["Rien pour toi"]);
  expect(runOutcome(run({ output: '{"placed":2,"cards":1,"pending":10}' }))).toEqual(["2 placés", "1 carte pour toi", "10 en attente"]);
  const notes = "- Read failed: timeout";
  expect(runOutcome(run({ completionNotes: notes, output: notes + "\n\nRapport envoyé." }))).toEqual(["Rapport envoyé."]);
  expect(runOutcome(run({ redacted: true, output: "Private" }))).toEqual([]);
});

it("counts each recorded failed attempt and follows the latest declared stages", () => {
  setLocale("fr");
  expect(historySummary(run({ completionNotes: "- Read failed 6 times: timeout\n- Write failed" }))).toBe("Terminée, 7 étapes en échec");
  const input = JSON.stringify({ plan: [{ step: "Read", status: "completed" }, { step: "Place", status: "in_progress" }, { step: "Report", status: "pending" }] });
  expect(historySteps([{ id: "plan", at: 1, name: "update_plan", input }]).map(step => step.phase)).toEqual(["done", "running", "pending"]);
});
