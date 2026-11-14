import { describe, expect, it } from "vitest";

import { createMcpServerResponse } from "./mcpServerResponse.ts";

// The GitHub plugin's server reads the viewer's GitHub account. #4155: a saved
// account this launch cannot read is "unreadable" on its row, never "missing"
// (the plugin detail would say "not connected yet" over a kept account).
function listing(viewerGithub: { token?: string; unreadable?: boolean }) {
  const spec = { type: "http", url: "https://api.example.test/mcp", headers: { Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" }, enabled: true };
  const host = {
    cfg: { mcpServers: { "github-github": spec } },
    managedPolicy: { current: () => null, mcpAllowed: () => true },
    remoteMcpServers: () => ({ "github-github": spec }),
    personalMcpNamesForGuard: () => new Set<string>(),
    mcpOAuth: { status: () => ({ auth: "none" }), accounts: () => [], pendingFor: () => false },
    mcpServersHost: { listing: (row: unknown) => row },
    githubAccountToken: () => viewerGithub.token,
    githubAccountUnreadable: () => viewerGithub.unreadable === true,
  };
  const response = createMcpServerResponse(() => host)("pr_viewer") as { servers: Array<{ name: string; github?: string }> };
  return response.servers.find((server) => server.name === "github-github")?.github;
}

describe("the GitHub plugin's server row (#4155)", () => {
  it("says connected, missing or unreadable, one verdict per viewer", () => {
    expect(listing({ token: "github-fixture" })).toBe("connected");
    expect(listing({})).toBe("missing");
    expect(listing({ unreadable: true })).toBe("unreadable");
  });
});
