// The organization library shelf (server/org/org-library.ts).
//
// Admin scope, like every route not opened in server/auth/request-auth.ts: one
// install per server that the organization keeps up to date, its skills and
// connections server-wide (unlike a person's own team file import,
// /api/teams/import). With no organization every read answers
// {organization: null} and nothing else changes.
//
//   GET  /api/org-library
//   GET  /api/org-library/packages/:packageId
//   POST /api/org-library/add
//   GET  /api/org-library/skills
//   POST /api/org-library/skills
import { z } from "zod";

import type { OrgLibrary } from "../org/org-library.ts";
import type { PackageImportDeps } from "../package-import.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { BotRecord, GroupRecord } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

const PACKAGE_ID = /^[a-f0-9-]{36}$/;
const NOT_LISTED = "This package is not in your organization's library.";

const skillBody = z.object({
  botId: z.string().min(1).max(128),
  installId: z.string().regex(/^[a-f0-9]{32}$/),
  name: z.string().min(1).max(64),
});

type Library = Pick<OrgLibrary, "list" | "preview" | "add" | "offeredSkills" | "addOfferedSkill">;

export interface OrgLibraryRouteDeps {
  /** Null when this server has no organization library. */
  library(): Library | null;
  /** The importer's view of this installation, built only when an add runs. */
  importDeps(): Promise<PackageImportDeps>;
  /** Each imported bot, as the inline route projected it. */
  projectBot(bot: BotRecord, auth: RequestAuth): unknown;
  /** Each imported group, messages cleared, as the inline route projected it. */
  projectGroup(group: GroupRecord): object;
}

export function createOrgLibraryRoutes(deps: OrgLibraryRouteDeps): RouteHandler {
  return async ({ res, req, url, path, method, auth, json, readBody }) => {
    if (method === "GET" && path === "/api/org-library") {
      return json(res, 200, deps.library()?.list() ?? { organization: null, packages: [] });
    }
    // Method guard and pattern share a line so scripts/tool-policy/route-inventory.ts reads GET.
    const preview = method === "GET" ? path.match(/^\/api\/org-library\/packages\/([a-f0-9-]{36})$/) : null;
    if (preview) {
      const outcome = deps.library()?.preview(preview[1]!);
      if (!outcome) return json(res, 404, { error: NOT_LISTED, code: "not_listed" });
      return outcome.ok ? json(res, 200, outcome.value) : json(res, outcome.status, { error: outcome.error, code: outcome.code });
    }
    if (method === "POST" && path === "/api/org-library/add") {
      // One click, no confirmation: the person's click is the decision.
      const body = await readBody(req);
      const packageId = typeof body?.packageId === "string" && PACKAGE_ID.test(body.packageId) ? body.packageId : null;
      if (!packageId) return json(res, 400, { error: "Choose a package from your organization's library." });
      const library = deps.library();
      if (!library) return json(res, 404, { error: NOT_LISTED, code: "not_listed" });
      const outcome = library.add(packageId, await deps.importDeps());
      if (!outcome.ok) return json(res, outcome.status, { error: outcome.error, code: outcome.code });
      if (outcome.value.alreadyAdded) return json(res, 200, outcome.value);
      const imported = outcome.value.result;
      return json(res, 201, {
        alreadyAdded: false,
        installId: imported.installId,
        name: imported.name,
        section: imported.section,
        bots: imported.bots.map((bot) => deps.projectBot(bot, auth)),
        groups: imported.groups.map((created) => deps.projectGroup(created)),
        routines: imported.routines,
        offeredSkills: imported.offeredSkills,
        connections: imported.connections,
        skipped: imported.skipped,
        brief: imported.brief,
        notes: imported.notes,
        presets: imported.presets ?? [],
      });
    }
    if (method === "GET" && path === "/api/org-library/skills") {
      const botId = url.searchParams.get("botId") ?? undefined;
      return json(res, 200, deps.library()?.offeredSkills(botId) ?? { organization: null, skills: [] });
    }
    if (method === "POST" && path === "/api/org-library/skills") {
      const body = await readBody(req);
      const parsed = skillBody.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "Choose a bot and a skill from your organization's library." });
      const library = deps.library();
      if (!library) return json(res, 404, { error: NOT_LISTED, code: "not_listed" });
      const outcome = library.addOfferedSkill(parsed.data.botId, parsed.data.installId, parsed.data.name);
      return outcome.ok ? json(res, 201, { skill: outcome.value }) : json(res, outcome.status, { error: outcome.error, code: outcome.code });
    }
    return PASS;
  };
}
