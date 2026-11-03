// The organization library routes that left server/index.ts. The shelf
// itself stays covered by server/org/org-library.e2e.test.ts.
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { OrgLibrary } from "../org/org-library.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { createOrgLibraryRoutes } from "./org-library.ts";
import { PASS, type RouteContext } from "./table.ts";

const PACKAGE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const INSTALL_ID = "a".repeat(32);
const auth = { kind: "loopback", trust: "owner" } as unknown as RequestAuth;

type Library = Pick<OrgLibrary, "list" | "preview" | "add" | "offeredSkills" | "addOfferedSkill">;

function ctx(path: string, method: string, body: unknown = null, query = "") {
  const sent: Array<{ status: number; body: unknown }> = [];
  const context = {
    req: {} as IncomingMessage,
    res: { setHeader: () => undefined } as unknown as ServerResponse,
    url: new URL(`http://x${path}${query}`),
    path,
    method,
    auth,
    json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
    readBody: (async () => body) as RouteContext["readBody"],
  } satisfies RouteContext;
  return { context, sent };
}

function routes(library: Library | null, extras?: Partial<{ importDeps: ReturnType<typeof vi.fn>; projectBot: ReturnType<typeof vi.fn>; projectGroup: ReturnType<typeof vi.fn> }>) {
  const importDeps = extras?.importDeps ?? vi.fn(async () => ({ kind: "deps" }));
  const projectBot = extras?.projectBot ?? vi.fn((bot: { id: string }) => ({ id: bot.id, projected: true }));
  const projectGroup = extras?.projectGroup ?? vi.fn((group: { id: string }) => ({ id: group.id, messages: [] }));
  return {
    importDeps,
    projectBot,
    projectGroup,
    handler: createOrgLibraryRoutes({
      library: () => library,
      importDeps: importDeps as never,
      projectBot: projectBot as never,
      projectGroup: projectGroup as never,
    }),
  };
}

describe("organization library routes", () => {
  it("passes what is not its own", async () => {
    const { handler } = routes(null);
    expect(await handler(ctx("/api/teams/import", "POST").context)).toBe(PASS);
    expect(await handler(ctx("/api/org-library", "POST").context)).toBe(PASS);
    expect(await handler(ctx(`/api/org-library/packages/${PACKAGE_ID}`, "POST").context)).toBe(PASS);
    expect(await handler(ctx("/api/org-library/packages/not-an-id", "GET").context)).toBe(PASS);
  });

  it("lists an empty shelf when the server has no organization", async () => {
    const { handler } = routes(null);
    const call = ctx("/api/org-library", "GET");
    await handler(call.context);
    expect(call.sent).toEqual([{ status: 200, body: { organization: null, packages: [] } }]);
    const skills = ctx("/api/org-library/skills", "GET", null, "?botId=b1");
    await handler(skills.context);
    expect(skills.sent).toEqual([{ status: 200, body: { organization: null, skills: [] } }]);
  });

  it("reads the shelf and one package preview", async () => {
    const shelf = { organization: { id: "org", name: "Org" }, packages: [{ name: "Pack" }] };
    const preview = { package: { name: "Pack" }, document: { format: "package" } };
    const library = {
      list: vi.fn(() => shelf),
      preview: vi.fn(() => ({ ok: true, status: 200, value: preview })),
      add: vi.fn(),
      offeredSkills: vi.fn(),
      addOfferedSkill: vi.fn(),
    } as unknown as Library;
    const { handler } = routes(library);
    const listed = ctx("/api/org-library", "GET");
    await handler(listed.context);
    expect(listed.sent).toEqual([{ status: 200, body: shelf }]);
    const shown = ctx(`/api/org-library/packages/${PACKAGE_ID}`, "GET");
    await handler(shown.context);
    expect(library.preview).toHaveBeenCalledWith(PACKAGE_ID);
    expect(shown.sent).toEqual([{ status: 200, body: preview }]);
    const missing = {
      ...library,
      preview: vi.fn(() => ({ ok: false, status: 404, code: "not_listed", error: "gone" })),
    } as unknown as Library;
    const refused = ctx(`/api/org-library/packages/${PACKAGE_ID}`, "GET");
    await routes(missing).handler(refused.context);
    expect(refused.sent).toEqual([{ status: 404, body: { error: "gone", code: "not_listed" } }]);
  });

  it("refuses a preview when there is no library", async () => {
    const { handler } = routes(null);
    const call = ctx(`/api/org-library/packages/${PACKAGE_ID}`, "GET");
    await handler(call.context);
    expect(call.sent[0]).toEqual({ status: 404, body: { error: "This package is not in your organization's library.", code: "not_listed" } });
  });

  it("adds a package and projects the bots and groups it created", async () => {
    const imported = {
      alreadyAdded: false,
      installId: INSTALL_ID,
      name: "Pack",
      section: "Work",
      bots: [{ id: "b1" }],
      groups: [{ id: "g1" }],
      routines: [{ id: "r1" }],
      offeredSkills: ["note"],
      connections: [],
      skipped: [],
      brief: true,
      notes: 2,
    };
    const add = vi.fn(() => ({ ok: true, status: 201, value: { alreadyAdded: false, result: imported } }));
    const library = { list: vi.fn(), preview: vi.fn(), add, offeredSkills: vi.fn(), addOfferedSkill: vi.fn() } as unknown as Library;
    const projectBot = vi.fn((bot: { id: string }) => ({ wire: bot.id }));
    const projectGroup = vi.fn((group: { id: string }) => ({ wire: group.id, messages: [] }));
    const importDeps = vi.fn(async () => ({ kind: "deps" }));
    const { handler } = routes(library, { projectBot, projectGroup, importDeps });
    const call = ctx("/api/org-library/add", "POST", { packageId: PACKAGE_ID });
    await handler(call.context);
    expect(importDeps).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith(PACKAGE_ID, { kind: "deps" });
    expect(projectBot).toHaveBeenCalledWith({ id: "b1" }, auth);
    expect(projectGroup).toHaveBeenCalledWith({ id: "g1" });
    expect(call.sent).toEqual([{
      status: 201,
      body: {
        alreadyAdded: false,
        installId: INSTALL_ID,
        name: "Pack",
        section: "Work",
        bots: [{ wire: "b1" }],
        groups: [{ wire: "g1", messages: [] }],
        routines: [{ id: "r1" }],
        offeredSkills: ["note"],
        connections: [],
        skipped: [],
        brief: true,
        notes: 2,
        presets: [],
      },
    }]);
  });

  it("answers an add that was already on the shelf, and refuses the rest", async () => {
    const add = vi.fn(() => ({ ok: true, status: 200, value: { alreadyAdded: true, installId: INSTALL_ID } }));
    const library = { list: vi.fn(), preview: vi.fn(), add, offeredSkills: vi.fn(), addOfferedSkill: vi.fn() } as unknown as Library;
    const { handler, importDeps } = routes(library);
    const again = ctx("/api/org-library/add", "POST", { packageId: PACKAGE_ID });
    await handler(again.context);
    expect(again.sent).toEqual([{ status: 200, body: { alreadyAdded: true, installId: INSTALL_ID } }]);

    const badId = ctx("/api/org-library/add", "POST", { packageId: "nope" });
    await handler(badId.context);
    expect(badId.sent[0]!.status).toBe(400);
    expect(importDeps).toHaveBeenCalledOnce();

    const failed = {
      ...library,
      add: vi.fn(() => ({ ok: false, status: 422, code: "invalid_package", error: "no" })),
    } as unknown as Library;
    const refused = ctx("/api/org-library/add", "POST", { packageId: PACKAGE_ID });
    await routes(failed).handler(refused.context);
    expect(refused.sent).toEqual([{ status: 422, body: { error: "no", code: "invalid_package" } }]);

    const missing = ctx("/api/org-library/add", "POST", { packageId: PACKAGE_ID });
    await routes(null).handler(missing.context);
    expect(missing.sent[0]).toMatchObject({ status: 404, body: { code: "not_listed" } });
  });

  it("offers a skill and puts one on a bot", async () => {
    const offered = { organization: { id: "org", name: "Org" }, skills: [{ name: "note" }] };
    const offeredSkills = vi.fn(() => offered);
    const addOfferedSkill = vi.fn(() => ({ ok: true, status: 201, value: { name: "note" } }));
    const library = { list: vi.fn(), preview: vi.fn(), add: vi.fn(), offeredSkills, addOfferedSkill } as unknown as Library;
    const { handler } = routes(library);
    const listed = ctx("/api/org-library/skills", "GET", null, "?botId=b1");
    await handler(listed.context);
    expect(offeredSkills).toHaveBeenCalledWith("b1");
    expect(listed.sent).toEqual([{ status: 200, body: offered }]);

    const added = ctx("/api/org-library/skills", "POST", { botId: "b1", installId: INSTALL_ID, name: "note" });
    await handler(added.context);
    expect(addOfferedSkill).toHaveBeenCalledWith("b1", INSTALL_ID, "note");
    expect(added.sent).toEqual([{ status: 201, body: { skill: { name: "note" } } }]);

    const bad = ctx("/api/org-library/skills", "POST", { botId: "", installId: INSTALL_ID, name: "note" });
    await handler(bad.context);
    expect(bad.sent[0]!.status).toBe(400);

    const noLibrary = ctx("/api/org-library/skills", "POST", { botId: "b1", installId: INSTALL_ID, name: "note" });
    await routes(null).handler(noLibrary.context);
    expect(noLibrary.sent[0]).toMatchObject({ status: 404, body: { code: "not_listed" } });
  });
});
