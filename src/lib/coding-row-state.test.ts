import { beforeEach, describe, expect, it } from "vitest";
import { codingRowState, pullOfItem, type CodingRowPull } from "./coding-row-state";
import { setLocale } from "./i18n";

const pull = (extra: Partial<CodingRowPull> = {}): CodingRowPull => ({ number: 40, url: "https://github.com/acme/web/pull/40", state: "open", ...extra });

describe("codingRowState", () => {
  beforeEach(() => setLocale("en"));

  it("maps a pull request to its icon kind and label", () => {
    const cases: Array<[CodingRowPull, string, string]> = [
      [pull(), "ready", "Ready for review"],
      [pull({ draft: true }), "draft", "Draft"],
      [pull({ review: "changes_requested" }), "changes", "Changes requested"],
      [pull({ checks: "failing" }), "checks", "Checks failing"],
      [pull({ state: "merged" }), "merged", "Merged"],
      [pull({ state: "closed" }), "closed", "Closed"],
    ];
    for (const [p, kind, label] of cases) {
      const state = codingRowState("finished", p);
      expect({ kind: state.kind, label: state.label }).toEqual({ kind, label });
    }
  });

  it("failing checks outrank changes requested and draft", () => {
    expect(codingRowState("finished", pull({ draft: true, review: "changes_requested", checks: "failing" })).kind).toBe("checks");
    expect(codingRowState("finished", pull({ draft: true, review: "changes_requested" })).kind).toBe("changes");
  });

  it("live and failed work say what they are, still with the link", () => {
    expect(codingRowState("running").kind).toBe("running");
    expect(codingRowState("running", pull()).label).toBe("Running");
    expect(codingRowState("running", pull()).pr?.number).toBe(40);
    expect(codingRowState("failed", pull({ state: "merged" })).kind).toBe("failed");
    expect(codingRowState("waiting").kind).toBe("waiting");
  });

  it("without a pull request the subtitle is the state alone and there is no link", () => {
    for (const status of ["finished", "stopped", "blocked", "running", "failed"] as const) {
      expect(codingRowState(status).pr).toBeUndefined();
    }
    expect(codingRowState("finished").label).toBe("Finished");
    expect(codingRowState("stopped").label).toBe("Stopped");
    expect(codingRowState("finished", pull({ url: undefined })).pr).toBeUndefined();
  });

  it("speaks French", () => {
    setLocale("fr");
    expect(codingRowState("finished", pull({ state: "merged" })).label).toBe("Fusionnée");
    expect(codingRowState("finished", pull({ draft: true })).label).toBe("Brouillon");
  });

  it("reads the newest pull request off the job's own calls", () => {
    const at = 1;
    const code = { pullRequests: [
      { number: 3, url: "u3", action: "opened" as const, at },
      { number: 3, url: "u3", action: "merged" as const, at },
    ], branches: [], commits: [] };
    expect(pullOfItem({ code })).toMatchObject({ number: 3, state: "merged" });
    expect(pullOfItem({ code: { ...code, pullRequests: [{ number: 5, action: "updated", at }] } })).toMatchObject({ number: 5, state: "open" });
    expect(pullOfItem({})).toBeUndefined();
  });
});
