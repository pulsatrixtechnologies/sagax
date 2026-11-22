import { describe, expect, it } from "vitest";

import { dockerCliInstallCommand, dockerCliMissing, dockerCliMissingProblem, dockerCliStartMessage } from "./vps-hints.ts";

describe("missing Docker CLI", () => {
  it("names the client install and leaves other failures alone", () => {
    expect(dockerCliMissing(Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" }))).toBe(true);
    expect(dockerCliMissing(new Error("connection refused"))).toBe(false);
    expect(dockerCliInstallCommand("darwin")).toBe("brew install docker");
    expect(dockerCliMissingProblem()).toMatch(/Docker CLI is not on PATH/);
    expect(dockerCliStartMessage(new Error("spawn docker ENOENT"))).toContain("Install the client only");
    expect(dockerCliStartMessage(new Error("connection refused"))).toBe("Docker-over-SSH could not start: connection refused");
  });
});
