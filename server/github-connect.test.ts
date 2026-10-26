import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { GithubConnect, githubAuthorizedFetch, githubGitEnvironment, githubOrigins, githubSandboxArgv, githubTokenKind } from "./github-connect.ts";
import type { GithubConnection } from "./person-connections.ts";

function fakeGithub(options: { pendingPolls?: number; deny?: boolean } = {}) {
  let polls = 0;
  const calls: Array<{ url: string; body?: string; auth?: string | null }> = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined, auth: new Headers(init?.headers).get("authorization") });
    if (url === "https://github.com/login/device/code") {
      return Response.json({ device_code: "dev-123", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 1 });
    }
    if (url === "https://github.com/login/oauth/access_token") {
      polls += 1;
      if (options.deny) return Response.json({ error: "access_denied" });
      if (polls <= (options.pendingPolls ?? 1)) return Response.json({ error: "authorization_pending" });
      return Response.json({ access_token: "gho_from_device", token_type: "bearer", scope: "repo,read:org" });
    }
    if (url === "https://api.github.com/user") {
      const auth = new Headers(init?.headers).get("authorization");
      if (auth === "Bearer bad") return new Response("{}", { status: 401 });
      return new Response(JSON.stringify({ login: auth === "Bearer gho_from_device" ? "octo-device" : "octo-pat", name: "Octo" }), { headers: { "x-oauth-scopes": "repo, gist" } });
    }
    return new Response("not found", { status: 404 });
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

describe("GithubConnect", () => {
  it("runs the device flow for one person and saves the token for that person only", async () => {
    const saved = new Map<string, GithubConnection | undefined>();
    const connected: string[] = [];
    const github = fakeGithub();
    const connect = new GithubConnect({
      clientId: () => "Iv1.client", fetch: github.fetcher, minIntervalMs: 5,
      save: (principalId, connection) => saved.set(principalId, connection),
      onConnected: (principalId) => connected.push(principalId),
    });
    const started = await connect.startDeviceFlow("pr_a");
    expect(started).toMatchObject({ userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" });
    expect(connect.status("pr_a", saved.get("pr_a"))).toMatchObject({ state: "pending", userCode: "ABCD-1234" });
    expect(connect.status("pr_b", undefined)).toMatchObject({ state: "none" });
    await vi.waitFor(() => expect(saved.get("pr_a")).toBeTruthy(), { timeout: 5_000, interval: 10 });
    expect(saved.get("pr_a")).toMatchObject({ token: "gho_from_device", login: "octo-device", via: "device", scopes: ["repo", "read:org"] });
    expect(saved.has("pr_b")).toBe(false);
    expect(connected).toEqual(["pr_a"]);
    expect(connect.status("pr_a", saved.get("pr_a"))).toMatchObject({ state: "connected", login: "octo-device" });
    expect(JSON.stringify(connect.status("pr_a", saved.get("pr_a")))).not.toContain("gho_from_device");
    // the client id went to GitHub, no secret
    expect(github.calls[0]!.body).toContain("client_id=Iv1.client");
  });

  it("reports a refusal on GitHub", async () => {
    const github = fakeGithub({ deny: true });
    const connect = new GithubConnect({ clientId: () => "Iv1.client", fetch: github.fetcher, minIntervalMs: 5, save: () => {} });
    await connect.startDeviceFlow("pr_a");
    await vi.waitFor(() => expect(connect.status("pr_a", undefined)).toMatchObject({ state: "error" }), { timeout: 5_000, interval: 10 });
  });

  it("explains that the device flow needs the organization's OAuth App, and takes a pasted token instead", async () => {
    const saved = new Map<string, GithubConnection | undefined>();
    const github = fakeGithub();
    const connect = new GithubConnect({ clientId: () => undefined, fetch: github.fetcher, save: (principalId, connection) => saved.set(principalId, connection) });
    expect(connect.status("pr_a", undefined)).toEqual({ state: "none", deviceFlow: false });
    await expect(connect.startDeviceFlow("pr_a")).rejects.toMatchObject({ code: "device_flow_unavailable" });
    await expect(connect.connectWithToken("pr_a", "bad")).rejects.toMatchObject({ code: "token_refused" });
    const connection = await connect.connectWithToken("pr_a", " github_pat_ok ");
    expect(connection).toMatchObject({ login: "octo-pat", via: "token", token: "github_pat_ok", scopes: ["repo", "gist"] });
    connect.disconnect("pr_a");
    expect(saved.get("pr_a")).toBeUndefined();
  });
});

describe("where the token goes", () => {
  it("adds the token for GitHub's hosts only", async () => {
    const seen: Array<[string, string | null]> = [];
    const base = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push([String(input), new Headers(init?.headers).get("authorization")]);
      return new Response("ok");
    }) as typeof fetch;
    const authorized = githubAuthorizedFetch("tok", base);
    await authorized("https://api.github.com/repos/a/b/contents/skills");
    await authorized("https://raw.githubusercontent.com/a/b/main/SKILL.md");
    await authorized("https://skills.sh/a/b");
    expect(seen).toEqual([
      ["https://api.github.com/repos/a/b/contents/skills", "Bearer tok"],
      ["https://raw.githubusercontent.com/a/b/main/SKILL.md", "Bearer tok"],
      ["https://skills.sh/a/b", null],
    ]);
  });

  it("gives git the token in an extra header, never prompting", () => {
    expect(githubGitEnvironment(undefined)).toEqual({ GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/false", GCM_INTERACTIVE: "never" });
    const env = githubGitEnvironment("tok");
    expect(env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    expect(Buffer.from(env.GIT_CONFIG_VALUE_0!.replace("AUTHORIZATION: basic ", ""), "base64").toString()).toBe("x-access-token:tok");
  });

  it("writes gh and git credentials in the environment from variables, never the argv", () => {
    const set = githubSandboxArgv({ token: "gho_secret", login: "octo" });
    expect(set.argv.join(" ")).not.toContain("gho_secret");
    expect(set.env).toEqual({ SAGAX_GH_MODE: "set", SAGAX_GH_TOKEN: "gho_secret", SAGAX_GH_LOGIN: "octo" });
    expect(set.argv[2]).toContain("$HOME/.config/gh\"; hosts=\"$dir/hosts.yml");
    expect(set.argv[2]).toContain("umask 077");
    expect(githubSandboxArgv(null).env).toEqual({ SAGAX_GH_MODE: "remove" });
    expect(githubSandboxArgv(null, { token: "gho_old", login: "octo" }).argv.join(" ")).not.toContain("gho_old");
    expect(() => githubSandboxArgv({ token: "t", login: "bad;rm" })).toThrow();
  });

  it("lets only a loopback stand-in replace github.com", () => {
    expect(githubOrigins({ SAGAX_GITHUB_WEB_ORIGIN: "http://127.0.0.1:9000" }).web).toBe("http://127.0.0.1:9000");
    expect(githubOrigins({ SAGAX_GITHUB_WEB_ORIGIN: "https://evil.example" }).web).toBe("https://github.com");
  });
});

// The script itself, run in a throwaway HOME: what gh and git find after.
describe("Sagax's GitHub sync in the server environment", () => {
  const run = (home: string, connection: { token: string; login: string } | null, previous?: { token: string; login: string }) => {
    const { argv, env } = githubSandboxArgv(connection, previous);
    const result = spawnSync(argv[0]!, argv.slice(1), { env: { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: "1", ...env }, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  const withHome = (body: (home: string, hosts: string, creds: string) => void) => {
    const home = mkdtempSync(join(tmpdir(), "sagax-gh-"));
    try { body(home, join(home, ".config/gh/hosts.yml"), join(home, ".git-credentials")); } finally { rmSync(home, { recursive: true, force: true }); }
  };
  // What gh auth login writes (gh 2.40 and later): the person's own sign-in.
  const personLogin = "github.com:\n    users:\n        jc:\n            oauth_token: gho_person\n    git_protocol: https\n    oauth_token: gho_person\n    user: jc\n";

  it("never overwrites a gh auth login the person made, and takes Sagax's git line out", () => withHome((home, hosts, creds) => {
    mkdirSync(join(home, ".config/gh"), { recursive: true });
    writeFileSync(hosts, personLogin);
    writeFileSync(creds, "https://jc:gho_sagax@github.com\nhttps://jc:own@gitlab.example\n");
    expect(run(home, { token: "gho_sagax", login: "jc" })).toBe("sagax-github-kept-person-login");
    expect(readFileSync(hosts, "utf8")).toBe(personLogin);
    expect(readFileSync(creds, "utf8")).toBe("https://jc:own@gitlab.example\n");
    // Every later turn too.
    expect(run(home, { token: "gho_sagax", login: "jc" })).toBe("sagax-github-kept-person-login");
    expect(readFileSync(hosts, "utf8")).toBe(personLogin);
  }));

  it("writes its own file when there is none, refreshes it, and yields once the person signs in", () => withHome((home, hosts) => {
    expect(run(home, { token: "gho_one", login: "jc" })).toBe("sagax-github-ready");
    expect(readFileSync(hosts, "utf8")).toContain("oauth_token: gho_one");
    expect(existsSync(join(home, ".config/gh/.sagax-managed"))).toBe(true);
    expect(run(home, { token: "gho_two", login: "jc" })).toBe("sagax-github-ready");
    expect(readFileSync(hosts, "utf8")).toContain("oauth_token: gho_two");
    writeFileSync(hosts, personLogin); // gh auth login, 32 seconds later
    expect(run(home, { token: "gho_two", login: "jc" })).toBe("sagax-github-kept-person-login");
    expect(readFileSync(hosts, "utf8")).toBe(personLogin);
    expect(existsSync(join(home, ".config/gh/.sagax-managed"))).toBe(false);
  }));

  it("adopts a file it wrote before the marker existed by its token, never another token", () => withHome((home, hosts) => {
    mkdirSync(join(home, ".config/gh"), { recursive: true });
    const legacy = "github.com:\n    oauth_token: gho_one\n    user: jc\n    git_protocol: https\n";
    writeFileSync(hosts, legacy);
    expect(run(home, { token: "gho_one", login: "jc" })).toBe("sagax-github-ready");
    writeFileSync(hosts, legacy.replace("gho_one", "gho_other"));
    rmSync(join(home, ".config/gh/.sagax-managed"));
    expect(run(home, { token: "gho_one", login: "jc" })).toBe("sagax-github-kept-person-login");
  }));

  it("still knows its own file after gh rewrote it into the multi-account layout", () => withHome((home, hosts, creds) => {
    run(home, { token: "gho_one", login: "jc" });
    const migrated = "github.com:\n    users:\n        jc:\n            oauth_token: gho_one\n    git_protocol: https\n    oauth_token: gho_one\n    user: jc\n";
    writeFileSync(hosts, migrated);
    // A new Sagax token (reconnect): the replaced one marks the file as Sagax's.
    expect(run(home, { token: "gho_two", login: "jc" }, { token: "gho_one", login: "jc" })).toBe("sagax-github-ready");
    writeFileSync(hosts, migrated.replaceAll("gho_one", "gho_two"));
    // Rotation without the replaced one at hand: the noted SHA-256 is enough.
    expect(run(home, { token: "gho_three", login: "jc" })).toBe("sagax-github-ready");
    expect(readFileSync(hosts, "utf8")).toContain("oauth_token: gho_three");
    expect(readFileSync(creds, "utf8")).toBe("https://jc:gho_three@github.com\n");
    writeFileSync(hosts, migrated.replaceAll("gho_one", "gho_three"));
    expect(run(home, null, { token: "gho_three", login: "jc" })).toBe("sagax-github-removed");
    expect(existsSync(hosts)).toBe(false);
    expect(readFileSync(creds, "utf8")).toBe("");
  }));

  it("keeps the person's own lines in git's credential store", () => withHome((home, _hosts, creds) => {
    writeFileSync(creds, "https://jc:gho_mine@github.com\nhttps://jc:own@gitlab.example\n");
    expect(run(home, null)).toBe("sagax-github-removed");
    expect(readFileSync(creds, "utf8")).toBe("https://jc:gho_mine@github.com\nhttps://jc:own@gitlab.example\n");
    run(home, { token: "gho_one", login: "jc" });
    expect(readFileSync(creds, "utf8")).toBe("https://jc:gho_mine@github.com\nhttps://jc:own@gitlab.example\nhttps://jc:gho_one@github.com\n");
  }));

  it("takes out only its own sign-in on disconnect", () => withHome((home, hosts) => {
    run(home, { token: "gho_one", login: "jc" });
    expect(run(home, null, { token: "gho_one", login: "jc" })).toBe("sagax-github-removed");
    expect(existsSync(hosts)).toBe(false);
    mkdirSync(join(home, ".config/gh"), { recursive: true });
    writeFileSync(hosts, personLogin);
    expect(run(home, null, { token: "gho_one", login: "jc" })).toBe("sagax-github-kept-person-login");
    expect(run(home, null)).toBe("sagax-github-kept-person-login");
    expect(readFileSync(hosts, "utf8")).toBe(personLogin);
  }));

  it("tells a fine-grained token, which reaches one owner only, from the others", () => {
    expect(githubTokenKind("github_pat_abc")).toBe("fine_grained");
    expect(githubTokenKind("ghp_abc")).toBe("classic");
    expect(githubTokenKind("gho_abc")).toBe("oauth");
    expect(githubTokenKind("ghu_abc")).toBe("app_user");
    const connect = new GithubConnect({ clientId: () => undefined, save: () => undefined });
    const base = { login: "jc", via: "token" as const, connectedAt: 1 };
    expect(connect.status("jc", { ...base, token: "github_pat_x" } as GithubConnection)).toMatchObject({ state: "connected", fineGrained: true });
    expect(connect.status("jc", { ...base, token: "gho_x" } as GithubConnection)).not.toHaveProperty("fineGrained");
    // Signed in through the OAuth App: GitHub's page to grant it each organization.
    const app = new GithubConnect({ clientId: () => "Iv1.abc", save: () => undefined });
    expect(app.status("jc", { ...base, via: "device", token: "gho_x" } as GithubConnection)).toMatchObject({ orgAccessUrl: "https://github.com/settings/connections/applications/Iv1.abc" });
    expect(app.status("jc", { ...base, token: "ghp_x" } as GithubConnection)).not.toHaveProperty("orgAccessUrl");
  });
});
