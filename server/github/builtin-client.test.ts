import { describe, expect, it } from "vitest";

import { BUILTIN_GITHUB_CLIENT_ID, resolveGithubClientId } from "./builtin-client.ts";

// the owner, 2026-11-08: every GitHub connection is a link and a code. With no
// organization setting and no environment, the built-in app is used.
describe("resolveGithubClientId", () => {
  it("uses the built-in client id with no organization setting and no environment", () => {
    expect(BUILTIN_GITHUB_CLIENT_ID).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(resolveGithubClientId(undefined, {})).toBe(BUILTIN_GITHUB_CLIENT_ID);
    expect(resolveGithubClientId("  ", { SAGAX_GITHUB_CLIENT_ID: "" })).toBe(BUILTIN_GITHUB_CLIENT_ID);
  });

  it("organization first, then the environment, then the built-in one", () => {
    expect(resolveGithubClientId("Iv1.org", { SAGAX_GITHUB_CLIENT_ID: "Iv1.env" })).toBe("Iv1.org");
    expect(resolveGithubClientId(null, { SAGAX_GITHUB_CLIENT_ID: "Iv1.env" })).toBe("Iv1.env");
    expect(resolveGithubClientId(null, {}, "")).toBeUndefined();
  });
});
