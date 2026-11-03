// Characterization of the B2 bots-content routes moved out of server/index.ts
// (#1388): bot skills, skills-library, and bot skills-library assignment.
// Auth gate already ran; fake deps cover PASS, refusals, and happy paths.
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { BotRecord } from "../store.ts";
import {
  createBotsContentRoutes,
  type BotsContentRouteDeps,
  type BotsContentStore,
} from "./bots-content.ts";
import { PASS, type RouteContext } from "./table.ts";

const bot = {
  id: "b1",
  name: "Ada",
  ownerUserId: "pr_owner",
  assignedSkills: ["order-audit"],
} as unknown as BotRecord;

const sessionOwner: RequestAuth = {
  kind: "session",
  via: "cookie",
  scopes: ["client"],
  session: {
    id: "s1",
    label: "web",
    scopes: ["client"],
    createdAt: 0,
    expiresAt: 0,
    lastUsedAt: 0,
    principalId: "pr_owner",
  } as never,
};

const sessionOther: RequestAuth = {
  ...sessionOwner,
  session: { ...sessionOwner.session!, principalId: "pr_other" } as never,
};

function storeStub(over: Partial<BotsContentStore> = {}): BotsContentStore {
  return {
    bots: [bot],
    bot: (id) => (id === "b1" ? bot : null),
    patchBot: vi.fn(() => bot),
    ...over,
  };
}

function baseDeps(over: Partial<BotsContentRouteDeps> = {}): BotsContentRouteDeps {
  return {
    store: storeStub(),
    identity: { kind: "solo" },
    skillsLibraryEnabled: () => true,
    botSkillsRefusal: () => null,
    sessionPrincipal: (auth) => (auth.kind === "session" ? auth.session.principalId ?? null : null),
    effectiveBotOwner: (b) => String(b.ownerUserId ?? ""),
    localPrincipalId: () => "pr_owner",
    samePerson: (a, b) => a === b,
    personalSkillsList: () => [],
    listBotSkills: () => [{ name: "private-one", description: "d", source: "local", enabled: false, warnings: [] } as never],
    listStagedSkillWrites: () => [],
    stagedSkillListing: (staged) => {
      const row = staged as unknown as Record<string, unknown>;
      const { files: _files, baseSha256: _base, baseAppliedStageId: _baseApplied, ...listing } = row;
      return listing;
    },
    githubCredentialsFor: () => [],
    computerOwner: () => true,
    callerCan: () => false,
    pluginSkillSource: () => null,
    ...over,
  };
}

function context(path: string, method = "GET", auth: RequestAuth = sessionOwner, body: unknown = {}, query = "") {
  const json = vi.fn();
  const readBody = vi.fn(async () => body);
  const res = {
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn(),
    headersSent: false,
    writableEnded: false,
  };
  return {
    json,
    res,
    ctx: {
      req: { headers: {} },
      res,
      url: new URL(`http://x${path}${query}`),
      path,
      method,
      auth,
      json,
      readBody,
    } as unknown as RouteContext,
  };
}

describe("bots-content foreign paths", () => {
  it("passes messages, profile, plugins, zip, rules, and workspace", async () => {
    const handler = createBotsContentRoutes(baseDeps());
    expect(await handler(context("/api/bots/b1/messages").ctx)).toBe(PASS);
    expect(await handler(context("/api/bots/b1/profile").ctx)).toBe(PASS);
    expect(await handler(context("/api/bots/b1/plugins").ctx)).toBe(PASS);
    expect(await handler(context("/api/bots/b1/zip").ctx)).toBe(PASS);
    expect(await handler(context("/api/bots/b1/rules").ctx)).toBe(PASS);
    expect(await handler(context("/api/bots/b1/workspace").ctx)).toBe(PASS);
    expect(await handler(context("/api/bots/b1/skills/s1/share", "POST").ctx)).toBe(PASS);
  });

  it("passes when the method is wrong for an owned path", async () => {
    const handler = createBotsContentRoutes(baseDeps());
    expect(await handler(context("/api/skills-library", "DELETE").ctx)).toBe(PASS);
    expect(await handler(context("/api/bots/b1/skill-template", "GET").ctx)).toBe(PASS);
  });
});

describe("bots-content auth refusals", () => {
  it("refuses bot skill changes when botSkillsRefusal says so", async () => {
    const handler = createBotsContentRoutes(baseDeps({
      identity: { kind: "perspicax" },
      botSkillsRefusal: () => ({
        status: 403,
        body: { error: "Only the bot's owner, or someone who manages it, can change its skills.", code: "skills_owner_only" },
      }),
    }));
    const { ctx, json } = context("/api/bots/b1/skills", "POST", sessionOther, { source: "acme/tools" });
    await handler(ctx);
    expect(json).toHaveBeenCalledWith(expect.anything(), 403, expect.objectContaining({ code: "skills_owner_only" }));
  });

  it("refuses library mutation when neither computer owner nor skills.library", async () => {
    const handler = createBotsContentRoutes(baseDeps({
      identity: { kind: "perspicax" },
      computerOwner: () => false,
      callerCan: () => false,
    }));
    const { ctx, json } = context("/api/skills-library/order-audit/review", "POST", sessionOther, { action: "accept" });
    await handler(ctx);
    expect(json).toHaveBeenCalledWith(expect.anything(), 403, expect.objectContaining({}));
  });

  it("returns 404 when skills library is disabled", async () => {
    const handler = createBotsContentRoutes(baseDeps({ skillsLibraryEnabled: () => false }));
    const { ctx, json } = context("/api/skills-library", "GET");
    await handler(ctx);
    expect(json).toHaveBeenCalledWith(expect.anything(), 404, { error: "skills library is not enabled" });
  });

  it("returns 404 for an unknown bot on skills GET", async () => {
    const handler = createBotsContentRoutes(baseDeps({
      store: storeStub({ bot: () => null }),
    }));
    const { ctx, json } = context("/api/bots/missing/skills", "GET");
    await handler(ctx);
    expect(json).toHaveBeenCalledWith(expect.anything(), 404, { error: "no such bot" });
  });
});

describe("bots-content happy paths", () => {
  it("lists legacy bot skills when the library feature is off", async () => {
    const handler = createBotsContentRoutes(baseDeps({ skillsLibraryEnabled: () => false }));
    const { ctx, json } = context("/api/bots/b1/skills", "GET");
    await handler(ctx);
    expect(json).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      skills: [expect.objectContaining({ name: "private-one" })],
      staged: [],
    }));
  });

  it("refuses skill-template body that is not a skill", async () => {
    const handler = createBotsContentRoutes(baseDeps());
    const { ctx, json } = context("/api/bots/b1/skill-template", "POST", sessionOwner, {
      name: "follow-up",
      source: "conversation",
      text: "not a skill",
      enabled: false,
    });
    await handler(ctx);
    expect(json).toHaveBeenCalledWith(expect.anything(), 400, expect.objectContaining({ error: expect.any(String) }));
  });
});
