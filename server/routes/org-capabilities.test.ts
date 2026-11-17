// Capabilities lot 4: admin/me routes for organization declarations.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { LinkPostResult } from "../perspicax/perspicax-link.ts";
import {
  createOrgCapabilityRoutes,
  marketplaceNameFor,
  orgCapabilityLock,
  migrateMarketplaces,
  refusalOf,
  type OrgCapabilityRouteDeps,
} from "./org-capabilities.ts";

describe("marketplaceNameFor", () => {
  it("keeps owner/repo and shortens a public HTTPS address", () => {
    expect(marketplaceNameFor("pulsatrixtechnologies/marketplace")).toBe("pulsatrixtechnologies/marketplace");
    expect(marketplaceNameFor("https://example.com/owner/repo.git")).toBe("example.com/owner/repo");
  });
});

describe("refusalOf", () => {
  it("maps Perspicax refusals to the screen codes", () => {
    expect(refusalOf({ ok: false, status: 403, error: "refused", body: { code: "subject" } })).toMatchObject({
      status: 403, code: "org_capabilities_sign_in",
    });
    expect(refusalOf({ ok: false, status: 403, error: "refused", body: {} })).toMatchObject({
      status: 403, code: "org_capabilities_admin",
    });
    expect(refusalOf({ ok: false, error: "link" })).toMatchObject({
      status: 503, code: "org_capabilities_link",
    });
    expect(refusalOf({ ok: false, status: 422, error: "refused", body: { message: "mount_name taken" } })).toMatchObject({
      status: 400, code: "org_capabilities_invalid", message: "mount_name taken",
    });
  });
});

describe("migrateMarketplaces", () => {
  it("posts each historical entry then the policy last, and records the mark", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "org-cap-routes-"));
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const call = vi.fn(async (method: "GET" | "POST" | "PUT" | "DELETE", path: string, body: unknown): Promise<LinkPostResult> => {
      calls.push({ method, path, body });
      return { ok: true, status: 200, body: { value: body, changed: true } };
    });
    const deps: Pick<OrgCapabilityRouteDeps, "call" | "policy" | "historical" | "dataDir" | "log"> = {
      call,
      policy: () => null,
      historical: () => ({ mode: "list", allow: ["owner/one", "https://example.com/two.git", "owner/one"] }),
      dataDir,
      log: () => {},
    };
    const first = await migrateMarketplaces(deps, "subject-token");
    expect(first).toEqual({ ok: true, done: true, imported: 2 });
    expect(calls.map((row) => [row.method, row.path])).toEqual([
      ["POST", "/api/v1/pulsabot/capabilities/marketplaces"],
      ["POST", "/api/v1/pulsabot/capabilities/marketplaces"],
      ["PUT", "/api/v1/pulsabot/capabilities/marketplace-policy"],
    ]);
    expect(calls[2]?.body).toEqual({ mode: "list" });
    expect(JSON.parse(readFileSync(join(dataDir, "org-capabilities", "marketplace-migration.json"), "utf8"))).toMatchObject({ done: true });
    // a retry is a no-op once the mark is there
    calls.length = 0;
    const again = await migrateMarketplaces(deps, "subject-token");
    expect(again).toEqual({ ok: true, done: true, imported: 0 });
    expect(calls).toEqual([]);
  });

  it("marks migrated when Perspicax already has a policy, without rewriting it", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "org-cap-routes-"));
    const call = vi.fn(async (): Promise<LinkPostResult> => ({ ok: true, status: 200, body: {} }));
    const result = await migrateMarketplaces({
      call,
      policy: () => ({ mode: "any" }),
      historical: () => ({ mode: "list", allow: ["owner/one"] }),
      dataDir,
    }, "subject-token");
    expect(result).toEqual({ ok: true, done: true, imported: 0 });
    expect(call).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(join(dataDir, "org-capabilities", "marketplace-migration.json"), "utf8")).done).toBe(true);
  });
});

// #4504 review: one verdict on the organization's own items, the route's;
// a bot's sagax_settings capabilities.organization replays this route.
describe("a person's switch of an organization item", () => {
  const view = (id: string, mode: "imposed" | "offered", enabled = true) => ({
    id, mount: `mount-${id}`, form: "skill" as const, name: `item-${id}`, description: "", mode, enabled,
    source: { kind: "manual" as const }, state: "installed",
  }) as never;
  async function put(views: unknown[], id: string, enabled: boolean) {
    const choices: Array<[string, boolean]> = [];
    const route = createOrgCapabilityRoutes({
      owner: () => "perspicax", person: () => ({ principalId: "pr_ada" }), subjectToken: async () => null,
      call: async () => ({ ok: false, status: 500 }) as never, refreshed: () => undefined, views: () => views as never,
      isMember: () => true, activeFor: () => true, setChoice: (_p, decl, on) => { choices.push([decl, on]); },
      policy: () => undefined, historical: () => undefined, dataDir: mkdtempSync(join(tmpdir(), "sagax-org-cap-")),
    } as OrgCapabilityRouteDeps);
    const sent: Array<{ status: number; body: Record<string, unknown> }> = [];
    const url = new URL(`http://x/api/me/org-capabilities/${id}`);
    await route({
      req: {} as never, res: { setHeader: () => undefined } as never, url, path: url.pathname, method: "PUT", auth: {} as never,
      json: ((_: unknown, status: number, body: Record<string, unknown>) => { sent.push({ status, body }); }) as never,
      readBody: (async () => ({ enabled })) as never,
    });
    return { sent: sent[0]!, choices };
  }

  it("refuses to turn off an imposed item, and says why", async () => {
    const { sent, choices } = await put([view("d1", "imposed")], "d1", false);
    expect(sent).toMatchObject({ status: 409, body: { code: "org_capability_imposed", error: "The organization imposes this capability: it stays on." } });
    expect(choices).toEqual([]);
    expect(orgCapabilityLock(view("d1", "imposed"))).toBe("org_capability_imposed");
  });

  it("lets the person turn off an offered item they added", async () => {
    const { sent, choices } = await put([view("d2", "offered")], "d2", false);
    expect(sent.status).toBe(200);
    expect(choices).toEqual([["d2", false]]);
    expect(orgCapabilityLock(view("d2", "offered"))).toBeNull();
    expect(orgCapabilityLock(view("d3", "offered", false))).toBe("org_capability_off");
  });
});
