import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import type { RoutineRunCardData } from "../../shared/routine-run";
import { routineResultFolded, routineResultNeedsPerson, routineRunWidgetRow, routineWidgetsAtRuns } from "./routine-result-stack";

const result = (id: string, run: Partial<RoutineRunCardData> = {}, extra: Partial<Message> = {}): Message => ({
  id, role: "bot", kind: "routine.run", at: 1,
  routineRun: { runId: `run-${id}`, routineId: run.routineId ?? `routine-${id}`, routineName: "Check", status: "completed", summary: "All good.", ...run },
  ...extra,
}) as Message;
const person = (id: string): Message => ({ id, role: "user", kind: "text", at: 1, text: "Thanks" }) as Message;
const answer = (id: string): Message => ({ id, role: "bot", kind: "text", at: 1, text: "Here it is." }) as Message;
const step = (id: string): Message => ({ id, role: "bot", kind: "activity", at: 1, text: "", tool: { name: "read" } }) as Message;

describe("#3581 a stack of routine results", () => {
  it("a result followed by a newer result folds to its row; the newest stays the card", () => {
    const rows = [result("a"), step("s"), result("b"), result("c")];
    expect(routineResultFolded(rows, "a")).toBe(true);
    expect(routineResultFolded(rows, "b")).toBe(true);
    expect(routineResultFolded(rows, "c")).toBe(false);
  });

  it("a message of the person or an answer of the bot between them keeps the card", () => {
    expect(routineResultFolded([result("a"), person("p"), result("b")], "a")).toBe(false);
    expect(routineResultFolded([result("a"), answer("x"), result("b")], "a")).toBe(false);
  });

  it("a run still going below a result does not fold it", () => {
    expect(routineResultFolded([result("a"), result("b", { status: "running", summary: undefined })], "a")).toBe(false);
  });

  it("a result with problems stays a card until a later run of its routine works again", () => {
    const problem = result("a", { routineId: "backup", problems: "The host did not answer." });
    expect(routineResultNeedsPerson(problem)).toBe(true);
    expect(routineResultFolded([problem, result("b"), result("c")], "a")).toBe(false);
    expect(routineResultFolded([problem, result("b", { routineId: "backup", status: "completed", recovered: { afterRuns: 1, since: 1 } })], "a")).toBe(true);
  });

  it("a result with items for the person stays a card until they are answered", () => {
    const items = { kind: "human", items: [{ text: "Sign the quote" }], botId: "b", botName: "Bot B", threadId: "t", sourceMessageId: "m" } as NonNullable<Message["attention"]>;
    expect(routineResultFolded([result("a", {}, { attention: items }), result("b")], "a")).toBe(false);
    expect(routineResultFolded([result("a", {}, { attention: { ...items, handledAt: 2 } }), result("b")], "a")).toBe(true);
  });

  it("a 17 results burst in one hour: one card, sixteen rows", () => {
    const rows = Array.from({ length: 17 }, (_, index) => result(`r${index}`));
    expect(rows.filter((row) => !routineResultFolded(rows, row.id))).toHaveLength(1);
  });
});

// #4234: a routine run's widget is drawn at the run's row, never listed twice
describe("routineWidgetsAtRuns", () => {
  const run = (id: string, widgetId?: string) => ({ id, role: "bot" as const, kind: "routine.run" as const, routineRun: { runId: `run-${id}`, routineId: "r", routineName: "Drafts", status: "completed" as const, ...(widgetId ? { widgetId } : {}) } });
  const widget = (id: string) => ({ id, role: "bot" as const, kind: "widget" as const });
  it("names the widget rows the shown routine rows draw, found in the same transcript", () => {
    const rows = [run("a", "w-1"), widget("w-1"), run("b"), run("c", "w-2"), widget("w-2"), widget("w-3")];
    expect([...routineWidgetsAtRuns(rows, rows)]).toEqual(["w-1", "w-2"]);
    // a run's row that is not shown draws nothing: its widget stays a row
    expect([...routineWidgetsAtRuns(rows.filter((row) => row.id !== "c"), rows)]).toEqual(["w-1"]);
    expect(routineRunWidgetRow(rows, rows[0]!)?.id).toBe("w-1");
  });
  // a side pane or a preview draws its own transcript: a widget its row
  // cannot find there is never hidden, so the form is never in no place
  it("hides nothing its row cannot find in that transcript", () => {
    const pane = [run("a", "w-1")];
    expect(routineWidgetsAtRuns(pane, pane).size).toBe(0);
    expect(routineRunWidgetRow(pane, pane[0]!)).toBeUndefined();
  });
});
