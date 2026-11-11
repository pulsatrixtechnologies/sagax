// #3392: a remote MCP server a person adds in their own connections with an
// address on GitHub (api.githubcopilot.com) and auth "none" mounted with no
// Authorization header, so the remote server refused the handshake. It now
// follows the rule of a plugin's GitHub server (#3385): it carries the GitHub
// connection of the turn's person, and a person without one gets no server
// and the turn's line that says so (githubWithheldPrompt).
import { describe, expect, it } from "vitest";
import { createMountPersonalMcp } from "./mountPersonalMcp.ts";
import { personalMcpPrecheck } from "../turns/turn-mounts.ts";
import type { GithubConnection, PersonalMcpServer } from "../people/person-connections.ts";

const GITHUB_URL = "https://api.githubcopilot.com/mcp/";
const now = Date.now();
const connection = (token: string): GithubConnection => ({ token, login: "someone", via: "token", connectedAt: now });
const remote = (url: string, extra: Partial<PersonalMcpServer> = {}): PersonalMcpServer =>
  ({ kind: "remote", type: "http", url, auth: "none", enabled: true, addedAt: now, ...extra }) as PersonalMcpServer;

/** One shared bot; each person has their own servers and GitHub connection. */
function host(people: Record<string, { servers: Record<string, PersonalMcpServer>; github?: GithubConnection }>) {
  return {
    IDENTITY: { kind: "perspicax" },
    personConnections: { servers: (person: string) => people[person]?.servers ?? {} },
    personGithub: (person: string) => people[person]?.github,
    orgCapabilities: { claimedNames: () => new Set<string>() },
    userSandbox: {},
    personalHostRefusalCached: async () => false,
  };
}

async function mount(people: Parameters<typeof host>[0], principal: string) {
  const integrations: { custom?: Record<string, any> } = {};
  const result = await createMountPersonalMcp(() => host(people))(integrations, { botId: "b1", threadId: "t1", generation: "g1", customMcp: true, principal });
  return { custom: integrations.custom ?? {}, withheld: (result?.githubWithheld ?? []) as string[] };
}

describe("a person's own remote server on a GitHub address goes as the turn's person (#3392)", () => {
  it("auth none: the mount carries the person's GitHub connection", async () => {
    const { custom, withheld } = await mount({ a: { servers: { copilot: remote(GITHUB_URL) }, github: connection("gho_personA") } }, "a");
    expect(withheld).toEqual([]);
    expect(custom.copilot).toEqual({ type: "http", url: GITHUB_URL, headers: { Authorization: "Bearer gho_personA" } });
  });

  it("a person without a GitHub connection gets no server, and the turn says so", async () => {
    const { custom, withheld } = await mount({ a: { servers: { copilot: remote(GITHUB_URL) } } }, "a");
    expect(custom.copilot).toBeUndefined();
    expect(withheld).toEqual(["copilot"]);
  });

  it("isolation: a second person's turn on the same bot uses that person's connection or none, never the first one's", async () => {
    const people = {
      a: { servers: { copilot: remote(GITHUB_URL) }, github: connection("gho_personA") },
      b: { servers: { copilot: remote(GITHUB_URL) }, github: connection("gho_personB") },
      c: { servers: { copilot: remote(GITHUB_URL) } },
    };
    expect((await mount(people, "b")).custom.copilot.headers).toEqual({ Authorization: "Bearer gho_personB" });
    const third = await mount(people, "c");
    expect(third.custom.copilot).toBeUndefined();
    expect(JSON.stringify(third)).not.toContain("gho_person");
  });

  it("an address off GitHub with auth none goes as it was saved", async () => {
    const { custom } = await mount({ a: { servers: { tools: remote("https://tools.example.com/mcp") }, github: connection("gho_personA") } }, "a");
    expect(custom.tools.headers).toEqual({});
  });

  it("the capabilities list says the same: to connect GitHub without a connection", () => {
    const check = (github?: GithubConnection) => personalMcpPrecheck("copilot", remote(GITHUB_URL), { taken: () => false, hasEnvironment: true, github });
    expect(check(undefined)).toEqual({ skip: "needs_github" });
    expect(check(connection("gho_personA"))).toEqual({ mount: "remote", headers: { Authorization: "Bearer gho_personA" } });
  });
});
