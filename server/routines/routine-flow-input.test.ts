import { describe, expect, it } from "vitest";
import { routineFlowInput } from "./routine-flow-input.ts";

describe("Flow inputs from a routine prompt (#1991)", () => {
  it.each(["Flow routine: inbox-review.", "routine Flow `inbox-review`", "G run init --routine inbox-review", "Run routine `inbox-review` through Flow.", "Exécute la routine 'inbox-review' avec running-px-flow.", "Passe Pulsatrix Flow `inbox-review`."])("reads the explicit routine in %s", prompt => {
    expect(routineFlowInput(prompt)).toEqual({ routine: "inbox-review" });
  });
  it("keeps inline units and an inline plan in the server contract, including unknown arguments", () => {
    const args = { plan: { summary: 'Read {inbox} and "report".', subtasks: [{ id: "review", task: "Read." }] }, payload: true };
    const prompt = `flow_run ${JSON.stringify({ command: "run.init", args: { routine: "inbox-review" } })}\nflow_run ${JSON.stringify({ command: "plan", args })}`;
    expect(routineFlowInput(prompt)).toEqual({ routine: "inbox-review", plan: args });
  });
  it.each(["Use running-px-flow. Report {result}.", "Suis running-px-flow et la routine Flow jusqu'à `run close`.", "Run the Flow routine until it finishes."])("leaves recipe selection to the model for prose: %s", prompt => {
    expect(routineFlowInput(prompt)).toEqual({});
  });
  it.each(["daily-followup", "new-ticket-watch-offset", "morning-briefing"])("reads the scheduled prompt header before its later Flow prose (%s)", routine => {
    // The scheduled prompt form includes both the actual recipe header and
    // the prose that previously got misread as a recipe named "jusqu".
    const prompt = `Passe Pulsatrix Flow \`${routine}\`. Charge \`using-px-flow\`, puis \`running-px-flow\`.
4. Suis \`running-px-flow\` et la routine Flow jusqu'à \`run close\`, puis \`flow_run\` \`run.finish\`.`;
    expect(routineFlowInput(prompt)).toEqual({ routine });
  });
  it("distinguishes an explicit empty plan from no plan and preserves explicit init", () => {
    const init = 'flow_run {"command":"run.init","args":{"routine":"inbox-review"}}';
    expect(routineFlowInput(init)).toEqual({ routine: "inbox-review" });
    expect(routineFlowInput(`${init}\nflow_run {"command":"plan","args":{}}`)).toEqual({ routine: "inbox-review", plan: {} });
  });
});
