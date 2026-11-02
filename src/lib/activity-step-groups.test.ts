import { describe, expect, it } from "vitest";

import type { BotActivityStep } from "../../shared/bot-activity";
import { countFailedSteps, currentTaskStep, groupActivitySteps } from "./activity-step-groups";

const NOW = 1_800_000_000_000;
const routine = (id: string, ok: boolean | undefined, where: "server" | "computer" = "server", summary = "Next routine action"): BotActivityStep => ({
  id, name: "mcp__agents__run_routine_action", at: NOW, where, summary, ...(ok === undefined ? {} : { ok }),
});

describe("groupActivitySteps", () => {
  it("merges the same step repeated back to back and keeps a failure apart", () => {
    const groups = groupActivitySteps([
      routine("r1", true), routine("r2", true), routine("r3", true),
      routine("rf", false),
      routine("r4", true), routine("r5", true),
    ]);
    expect(groups.map((group) => [group.count, group.phase])).toEqual([[3, "done"], [1, "failed"], [2, "done"]]);
    expect(groups[0]!.id).toBe("r1");
    expect(groups[0]!.summary).toBe("Next routine action");
    expect(countFailedSteps(groups)).toBe(1);
  });

  it("never merges a running step or a sub-agent; same words from another place fold like ActivityRun", () => {
    const groups = groupActivitySteps([
      routine("r1", true), routine("r2", true, "computer"),
      { id: "a1", name: "Agent", at: NOW, ok: true, subagent: { description: "check the logs" } },
      { id: "a1s1", name: "Bash", at: NOW, ok: true, parentId: "a1", summary: "tail app.log" },
      { id: "a1s2", name: "Bash", at: NOW, ok: true, parentId: "a1", summary: "tail app.log" },
      routine("r3", true, "computer"), routine("rx", undefined, "computer"),
    ]);
    // r1 and r2 share a label, so mergeSteps folds them (place mark stays on the first)
    expect(groups.map((group) => group.id)).toEqual(["r1", "a1", "r3", "rx"]);
    expect(groups[0]!.count).toBe(2);
    expect(groups[3]!.phase).toBe("running");
    expect(groups[1]!.subagent).toBe(true);
    expect(groups[1]!.substeps!.map((group) => group.count)).toEqual([2]);
  });

  it("folds finished tool searches so the calls between them merge", () => {
    const groups = groupActivitySteps([
      { id: "s1", name: "search_tool", at: NOW, ok: true, input: JSON.stringify({ query: "perspicax" }) },
      { id: "u1", name: "use_tool", at: NOW, ok: true, input: JSON.stringify({ tool_name: "perspicax__acme_desk__query", tool_input: { resource: "service.tickets" } }) },
      { id: "s2", name: "search_tool", at: NOW, ok: true, input: JSON.stringify({ query: "remote" }) },
      { id: "u2", name: "use_tool", at: NOW, ok: true, input: JSON.stringify({ tool_name: "perspicax__acme_desk__query", tool_input: { resource: "service.tickets" } }) },
      { id: "s3", name: "ToolSearch", at: NOW, ok: true, input: JSON.stringify({ query: "select:Read" }) },
    ]);
    expect(groups.map((group) => [group.label, group.count])).toEqual([
      ["Looked for a tool", 3],
      ["Viewed tickets in Acme Desk", 2],
    ]);
  });

  it("marks the place once, then only when it changes", () => {
    const groups = groupActivitySteps([
      routine("r1", true), { id: "s1", name: "Read", at: NOW, ok: true, where: "server" },
      routine("r2", true, "computer"), { id: "s2", name: "Read", at: NOW, ok: true, where: "computer" },
      routine("r3", true), { id: "s3", name: "Read", at: NOW, ok: true },
    ]);
    expect(groups.map((group) => group.whereChanged)).toEqual([true, false, true, false, true, false]);
  });

  it("drops a summary that differs inside a group", () => {
    const groups = groupActivitySteps([routine("r1", true, "server", "one"), routine("r2", true, "server", "two")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.summary).toBeUndefined();
  });
});

describe("currentTaskStep", () => {
  it("names the newest call in flight the way the working line does, else by its plain name", () => {
    const steps: BotActivityStep[] = [
      routine("r1", true),
      { id: "s1", name: "Read", at: NOW - 5_000, ok: true, input: JSON.stringify({ file_path: "a.txt" }) },
      { id: "s2", name: "Read", at: NOW - 1_000, input: JSON.stringify({ file_path: "clients.csv" }) },
    ];
    expect(currentTaskStep(steps)).toEqual({ step: { key: "readFile", detail: "clients.csv" }, label: "Reading a file", since: NOW - 1_000 });
    expect(currentTaskStep([routine("rx", undefined)])).toMatchObject({ step: null, label: expect.stringMatching(/run routine action|Agents/i) });
    expect(currentTaskStep([routine("r1", true)])).toBeNull();
  });
});
