import { describe, expect, it } from "vitest";
import { parseWorkspaceLine, workspaceLineName, type WorkspaceLine } from "./workspace-line.ts";

describe("workspace line reasons", () => {
  it("keeps routine-default and routine-not-allowed as distinct names", () => {
    const byDefault: WorkspaceLine = {
      target: "cloud",
      fallback: { wanted: "this_computer", reason: "routine-default" },
    };
    const notAllowed: WorkspaceLine = {
      target: "cloud",
      fallback: { wanted: "this_computer", reason: "routine-not-allowed" },
    };
    const offline: WorkspaceLine = {
      target: "cloud",
      fallback: { wanted: "this_computer", reason: "offline" },
    };

    expect(workspaceLineName(byDefault)).toBe(
      "notice: Workspace: moved to the cloud: routines start in the cloud by default",
    );
    expect(workspaceLineName(notAllowed)).toBe(
      "notice: Workspace: moved to the cloud: routines are not allowed on your computer",
    );
    expect(workspaceLineName(offline)).toBe(
      "notice: Workspace: moved to the cloud: your computer is offline",
    );

    expect(workspaceLineName(byDefault)).not.toBe(workspaceLineName(notAllowed));
    expect(workspaceLineName(byDefault)).not.toBe(workspaceLineName(offline));
    expect(workspaceLineName(notAllowed)).not.toBe(workspaceLineName(offline));

    expect(parseWorkspaceLine(workspaceLineName(byDefault))).toEqual(byDefault);
    expect(parseWorkspaceLine(workspaceLineName(notAllowed))).toEqual(notAllowed);
    expect(parseWorkspaceLine(workspaceLineName(offline))).toEqual(offline);
  });

  it("round-trips a plain place and an unavailable fallback", () => {
    expect(parseWorkspaceLine(workspaceLineName({ target: "browser" }))).toEqual({ target: "browser" });
    const unavailable: WorkspaceLine = {
      target: "this_computer",
      fallback: { wanted: "browser", reason: "unavailable" },
    };
    expect(parseWorkspaceLine(workspaceLineName(unavailable))).toEqual(unavailable);
  });
});
