import { describe, expect, it } from "vitest";

import { githubServersAsPerson, githubWithheldPrompt, isGithubMcpServer, readsGithubToken, withGithubToken } from "./github-mcp-token.ts";

const PLUGIN = { type: "http" as const, url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" } };
const OTHER = { type: "http" as const, url: "https://mcp.example.test/mcp", headers: { Authorization: "Bearer fixed-value" } };
const COMMAND = { command: "github-mcp-server", args: ["stdio"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN:-}" } };

describe("the GitHub plugin's server reads the one GitHub connection", () => {
  it("knows a server that takes its token from the GitHub connection", () => {
    expect(readsGithubToken(PLUGIN)).toBe(true);
    expect(readsGithubToken(COMMAND)).toBe(true);
    expect(readsGithubToken(OTHER)).toBe(false);
    expect(readsGithubToken({ ...OTHER, headers: { Authorization: "Bearer ${SOMETHING_ELSE}" } })).toBe(false);
  });

  it("fills the placeholder with the person's token for the turn, and leaves every other server as it is", () => {
    const servers = { "github-github": PLUGIN, docs: OTHER, local: COMMAND };
    const filled = withGithubToken(servers, "person-token-1234");
    expect(filled["github-github"]).toEqual({ ...PLUGIN, headers: { Authorization: "Bearer person-token-1234" } });
    expect(filled.local).toEqual({ ...COMMAND, env: { GITHUB_PERSONAL_ACCESS_TOKEN: "person-token-1234" } });
    expect(filled.docs).toBe(OTHER);
    // the configuration itself never holds the token
    expect(JSON.stringify(servers)).not.toContain("person-token-1234");
  });

  it("without a connection the servers go as they are", () => {
    const servers = { "github-github": PLUGIN };
    expect(withGithubToken(servers, undefined)).toBe(servers);
  });
});

describe("organization server: a GitHub server acts as the person of the turn", () => {
  const SIGNED_IN = { type: "http" as const, url: "https://api.githubcopilot.com/mcp/", headers: { authorization: "Bearer saved-sign-in", "X-MCP-Toolsets": "issues" } };
  const ENTERPRISE = { type: "http" as const, url: "https://api.acme.ghe.com/mcp/", headers: {} };

  it("knows a GitHub server by its placeholder or its address", () => {
    expect(isGithubMcpServer(PLUGIN)).toBe(true);
    expect(isGithubMcpServer(SIGNED_IN)).toBe(true);
    expect(isGithubMcpServer(ENTERPRISE)).toBe(true);
    expect(isGithubMcpServer(COMMAND)).toBe(true);
    expect(isGithubMcpServer(OTHER)).toBe(false);
    expect(isGithubMcpServer({ type: "http" as const, url: "https://notgithub.com.example.test/mcp", headers: {} })).toBe(false);
    expect(isGithubMcpServer({ type: "http" as const, url: "not a url", headers: {} })).toBe(false);
  });

  it("replaces the saved sign-in with the person's own connection", () => {
    const servers = { github: SIGNED_IN, "github-github": PLUGIN, docs: OTHER, local: COMMAND };
    const { servers: mounted, withheld } = githubServersAsPerson(servers, "person-token-1234");
    expect(withheld).toEqual([]);
    expect(mounted.github).toEqual({ ...SIGNED_IN, headers: { "X-MCP-Toolsets": "issues", Authorization: "Bearer person-token-1234" } });
    expect(mounted["github-github"]).toEqual({ ...PLUGIN, headers: { Authorization: "Bearer person-token-1234" } });
    expect(mounted.local).toEqual({ ...COMMAND, env: { GITHUB_PERSONAL_ACCESS_TOKEN: "person-token-1234" } });
    expect(mounted.docs).toBe(OTHER);
    expect(JSON.stringify(mounted)).not.toContain("saved-sign-in");
    expect(JSON.stringify(servers)).not.toContain("person-token-1234");
  });

  it("without a connection of their own the person gets no GitHub server, and the bot says so", () => {
    const { servers: mounted, withheld } = githubServersAsPerson({ github: SIGNED_IN, "github-github": PLUGIN, docs: OTHER }, undefined);
    expect(Object.keys(mounted)).toEqual(["docs"]);
    expect(withheld).toEqual(["github", "github-github"]);
    expect(JSON.stringify(mounted)).not.toContain("saved-sign-in");
    const prompt = githubWithheldPrompt(withheld);
    expect(prompt).toContain("Connect GitHub");
    expect(prompt).toContain("never use anyone else's GitHub access");
    expect(githubWithheldPrompt([])).toBe("");
  });
});
