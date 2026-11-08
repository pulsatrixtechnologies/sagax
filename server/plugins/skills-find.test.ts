import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { officialCatalogFor } from "../../shared/skill-catalogs.ts";
import { createSkillsFindInternalRoutes } from "../routes/skills-find-internal.ts";
import { catalogNameFor, findSkillFolders, synthesizeSkillsCatalog } from "./skills-catalog.ts";
import { findReport, missingCatalogs, rankLocal, searchClawHub, type FindListing } from "./skills-find.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function skill(root: string, path: string, name: string, description: string) {
  mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, path, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
}

describe("official catalogs (#2613)", () => {
  it("names Hermes Agent and OpenClaw by their GitHub source, in any spelling", () => {
    expect(officialCatalogFor("NousResearch/hermes-agent")?.id).toBe("hermes-agent");
    expect(officialCatalogFor("https://github.com/openclaw/openclaw.git")?.skillDirs).toEqual(["skills"]);
    expect(officialCatalogFor("someone/else")).toBeUndefined();
    expect(catalogNameFor("https://github.com/acme/My Skills.git")).toBe("my-skills");
  });

  it("reads a skills folder as a marketplace, one plugin per skill, with its category", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-cat-"));
    dirs.push(root);
    skill(root, "skills/devops/docker-compose", "docker-compose", "Run compose stacks");
    skill(root, "optional-skills/code-review", "code-review", "Review a diff");
    expect(findSkillFolders(root).map((found) => found.name)).toEqual(["docker-compose", "code-review"]);
    expect(synthesizeSkillsCatalog(root, { name: "hermes-agent" })).toBe(2);
    const manifest = JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"));
    expect(manifest.name).toBe("hermes-agent");
    expect(manifest.plugins[0]).toMatchObject({ name: "docker-compose", category: "devops", source: "./sagax-skills/docker-compose" });
    expect(readFileSync(join(root, "sagax-skills", "code-review", "skills", "code-review", "SKILL.md"), "utf8")).toContain("Review a diff");
  });
});

const LISTINGS: FindListing[] = [{
  name: "hermes-agent", source: "NousResearch/hermes-agent",
  plugins: [
    { name: "code-review", description: "Review a TypeScript diff for bugs", category: "software-development", installed: false },
    { name: "docker-compose", description: "Run compose stacks", category: "devops", installed: true },
  ],
}];

describe("skills_find ranking", () => {
  it("ranks what covers the task first and offers the catalogs not added yet", () => {
    const hits = rankLocal("TypeScript code review", LISTINGS, 5);
    expect(hits.map((hit) => hit.name)).toEqual(["code-review"]);
    const missing = missingCatalogs(LISTINGS).map((hit) => hit.source);
    expect(missing).toContain("openclaw/openclaw");
    expect(missing).not.toContain("NousResearch/hermes-agent");
    const text = findReport("TypeScript code review", hits, missingCatalogs(LISTINGS), { hits: [] });
    expect(text).toContain("code-review @ hermes-agent");
    expect(text).toContain("act plugins action install");
  });

  it("reads ClawHub results and backs off on 429", async () => {
    const ok = (async () => new Response(JSON.stringify({ results: [{ slug: "typescript", displayName: "TypeScript", summary: "Type-safe TS", ownerHandle: "dev", canonicalUrl: "/dev/skills/typescript", score: 9 }] }), { status: 200 })) as unknown as typeof fetch;
    const found = await searchClawHub("typescript unique-a", 3, ok, 1_000);
    expect(found.hits[0]).toMatchObject({ kind: "clawhub", name: "TypeScript", url: "https://clawhub.ai/dev/skills/typescript" });
    const limited = (async () => new Response("", { status: 429, headers: { "retry-after": "30" } })) as unknown as typeof fetch;
    expect((await searchClawHub("unique-b", 3, limited, 2_000)).note).toMatch(/slow down/);
    expect((await searchClawHub("unique-c", 3, ok, 3_000)).hits).toEqual([]);
  });

  it("answers the bot through the internal route, for the capability's bot only", async () => {
    const asked: string[] = [];
    const route = createSkillsFindInternalRoutes({ listings: (botId) => { asked.push(botId); return LISTINGS; } });
    let answer: { status: number; body: Record<string, unknown> } | undefined;
    await route({
      res: {} as never, path: "/api/internal/skills-find", method: "POST",
      json: ((_res: unknown, status: number, body: Record<string, unknown>) => { answer = { status, body }; }) as never,
      capability: { botId: "bot-1", threadId: "t", generation: "g" },
      readBody: async () => ({ fromBotId: "other", query: "code review", clawhub: false }),
    } as never);
    expect(asked).toEqual(["bot-1"]);
    expect(answer?.status).toBe(200);
    expect(String(answer?.body.text)).toContain("code-review @ hermes-agent");
  });
});
