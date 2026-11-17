// #4504 third review: the update check goes through the server's real GitHub
// wrapper (githubSkillFetch): its rate-limit throw, no bare retry, and one
// budget per credential really used.
import { describe, expect, it } from "vitest";

import { skillUpdateProvider, type InstalledSkillRecord } from "./capability-update-providers.ts";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const RESET = Math.floor(NOW / 1000) + 3600;
const record = (name: string, owner?: string): InstalledSkillRecord => ({
  scope: "me", target: "me", name, importedAt: "2026-11-01T00:00:00Z", ...(owner ? { owner } : {}),
  github: { owner: "acme", repo: "skills", ref: "main", path: name, commit: "a".repeat(40) },
});
const ok = (remaining: number) => new Response("[]", { status: 200, headers: { "x-ratelimit-remaining": String(remaining), "x-ratelimit-reset": String(RESET) } });

describe("the update check through githubSkillFetch", () => {
  it("GitHub's rate limit, thrown by the wrapper, stops the check until its reset", async () => {
    let now = NOW;
    const asked: string[] = [];
    const transport = (async (url: string) => {
      asked.push(String(url));
      return now < RESET * 1000 ? new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(RESET) } }) : ok(50);
    }) as unknown as typeof fetch;
    const records = [record("one"), record("two")];
    const provider = skillUpdateProvider({ records: () => records, allRecords: () => records, credentialsFor: () => [], transport, reimport: async () => undefined, now: () => now });
    await provider.check();
    expect(asked).toHaveLength(1);
    await provider.check();
    expect(asked).toHaveLength(1);
    now = (RESET + 1) * 1000;
    await provider.check();
    expect(asked).toHaveLength(3);
  });

  it("makes no bare retry without a token when the person's tokens are refused", async () => {
    const asked: Array<string | null> = [];
    const transport = (async (_url: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization");
      asked.push(auth);
      return auth ? new Response("{}", { status: 404 }) : ok(50);
    }) as unknown as typeof fetch;
    const records = [record("one", "pr_ada")];
    const provider = skillUpdateProvider({ records: () => records, allRecords: () => records, credentialsFor: () => [{ token: "t-ada", via: "person" }], transport, reimport: async () => undefined, now: () => NOW });
    await provider.check();
    expect(asked).toEqual(["Bearer t-ada"]);
  });

  it("two people without a token share one budget, and its reserve", async () => {
    const asked: string[] = [];
    const transport = (async (url: string) => {
      asked.push(new URL(String(url)).searchParams.get("path")!);
      return ok(10);
    }) as unknown as typeof fetch;
    const records = [record("ada-skill", "pr_ada"), record("bob-skill", "pr_bob")];
    const provider = skillUpdateProvider({ records: () => records, allRecords: () => records, credentialsFor: () => [], transport, reimport: async () => undefined, now: () => NOW });
    await provider.check();
    // the first answer leaves 10 of the shared hour, under the reserve: bob's waits
    expect(asked).toEqual(["ada-skill"]);
  });

  it("a token two people share (the organization's) is one budget", async () => {
    const asked: string[] = [];
    const transport = (async (url: string) => {
      asked.push(new URL(String(url)).searchParams.get("path")!);
      return new Response("{}", { status: 429, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(RESET) } });
    }) as unknown as typeof fetch;
    const records = [record("ada-skill", "pr_ada"), record("bob-skill", "pr_bob")];
    const org = { token: "t-org", via: "organization" as const, id: "cred-org" };
    const provider = skillUpdateProvider({ records: () => records, allRecords: () => records, credentialsFor: () => [org], transport, reimport: async () => undefined, now: () => NOW });
    await provider.check();
    expect(asked).toEqual(["ada-skill"]);
  });
});
