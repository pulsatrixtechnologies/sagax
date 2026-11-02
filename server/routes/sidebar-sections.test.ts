import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { RequestAuth } from "../request-auth.ts";
import type { BotRecord } from "../store.ts";
import { createSidebarSectionsRoutes, type SidebarSectionsRouteDeps } from "./sidebar-sections.ts";
import { PASS, type RouteContext } from "./table.ts";

const auth = { kind: "loopback", trust: "owner", scopes: ["admin"] } as unknown as RequestAuth;
const bot = { id: "b1", name: "Ada", section: "Ops" } as BotRecord;

function deps(over: Partial<SidebarSectionsRouteDeps> = {}): SidebarSectionsRouteDeps {
  return {
    sections: () => ["Ops"],
    bot: (id) => (id === "b1" ? bot : undefined),
    assertTeamComputerChangeIdle: () => undefined,
    teamComputerForSection: () => undefined,
    deleteSection: () => null,
    renameSection: () => null,
    updateTeamMembers: () => ({ ok: true, bots: [bot] }),
    setBotsSection: () => ({ ok: true, bots: [bot] }),
    wireBot: (row) => ({ id: row.id, wired: true }),
    ...over,
  };
}

function ctx(path: string, method: string, body: unknown = null, query = "") {
  const sent: Array<{ status: number; body: unknown }> = [];
  const context = {
    req: { headers: {} } as IncomingMessage,
    res: {} as ServerResponse,
    url: new URL(`http://x${path}${query}`),
    path,
    method,
    auth,
    json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
    readBody: (async () => body) as RouteContext["readBody"],
  } satisfies RouteContext;
  return { context, sent };
}

describe("createSidebarSectionsRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createSidebarSectionsRoutes(deps());
    expect(await route(ctx("/api/bot-defaults", "GET").context)).toBe(PASS);
  });

  it("lists sections", async () => {
    const route = createSidebarSectionsRoutes(deps());
    const call = ctx("/api/sidebar-sections", "GET");
    await route(call.context);
    expect(call.sent).toEqual([{ status: 200, body: { sections: ["Ops"] } }]);
  });

  it("refuses delete while a team computer is assigned", async () => {
    const route = createSidebarSectionsRoutes(deps({
      teamComputerForSection: () => ({ id: "c1" }),
    }));
    const call = ctx("/api/sidebar-sections", "DELETE", null, "?section=Ops");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(409);
  });

  it("renames a section", async () => {
    const renameSection = vi.fn(() => null);
    const onSectionRenamed = vi.fn();
    const route = createSidebarSectionsRoutes(deps({ renameSection, onSectionRenamed }));
    const call = ctx("/api/sidebar-sections", "PATCH", { name: "Studio" }, "?section=Ops");
    await route(call.context);
    expect(renameSection).toHaveBeenCalledWith("Ops", "Studio");
    expect(onSectionRenamed).toHaveBeenCalledWith("Ops", "Studio");
    expect(call.sent[0]?.status).toBe(200);
  });

  it("updates membership and wires bots", async () => {
    const assertTeamComputerChangeIdle = vi.fn();
    const route = createSidebarSectionsRoutes(deps({ assertTeamComputerChangeIdle }));
    const call = ctx("/api/sidebar-sections", "PUT", { addBotIds: ["b1"], removeBotIds: [] }, "?section=Ops");
    await route(call.context);
    expect(assertTeamComputerChangeIdle).toHaveBeenCalled();
    expect(call.sent[0]).toEqual({
      status: 200,
      body: { sections: ["Ops"], bots: [{ id: "b1", wired: true }] },
    });
  });

  it("creates a section", async () => {
    const route = createSidebarSectionsRoutes(deps());
    const bad = ctx("/api/sidebar-sections", "POST", { name: "", botIds: [] });
    await route(bad.context);
    expect(bad.sent[0]?.status).toBe(400);

    const ok = ctx("/api/sidebar-sections", "POST", { name: "New", botIds: ["b1"] });
    await route(ok.context);
    expect(ok.sent[0]?.status).toBe(200);
    expect((ok.sent[0]?.body as { section: string } | undefined)?.section).toBe("New");
  });
});
