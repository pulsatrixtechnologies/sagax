import { describe, expect, it } from "vitest";
import { routineFlowInput } from "./routine-flow-input.ts";

describe("Flow inputs from a routine prompt (#1991)", () => {
  it.each(["Flow routine inbox-review.", "routine Flow `inbox-review`", "G run init --routine inbox-review", "Run routine `inbox-review` through Flow.", "Exécute la routine inbox-review avec running-px-flow."])("reads the explicit routine in %s", prompt => {
    expect(routineFlowInput(prompt)).toEqual({ routine: "inbox-review", plan: {} });
  });
  it("keeps inline units and an inline plan in the server contract, including unknown arguments", () => {
    const args = { plan: { summary: 'Read {inbox} and "report".', subtasks: [{ id: "review", task: "Read." }] }, payload: true };
    const prompt = `flow_run ${JSON.stringify({ command: "run.init", args: { routine: "inbox-review" } })}\nflow_run ${JSON.stringify({ command: "plan", args })}`;
    expect(routineFlowInput(prompt)).toEqual({ routine: "inbox-review", plan: args });
  });
  it("lets a bound profile supply its routine and never fabricates missing units or reads", () => {
    expect(routineFlowInput("Use running-px-flow. Report {result}." )).toEqual({ plan: {} });
  });
});
