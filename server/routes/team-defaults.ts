// I2: GET/PUT /api/team-defaults?section=: a team's model and computer.
// PUT merges: a field left out keeps its value, null clears it.
// Same team lookup and storage key as the team instructions
// (section-context.ts). The bots that follow the team are updated by the
// client through PATCH /api/bots/:id with teamApply, so every bot keeps its
// own checks (busy, model available, computer permission).
// Never imports server/index.ts.
import { z } from "zod";
import type { RequestAuth } from "../auth/request-auth.ts";
import {
  parseTeamDefaultsRecord,
  sectionContextKey,
  sectionContextLabel,
  type TeamComputer,
  type TeamDefaultsRecord,
} from "../rooms/section-context.ts";
import type { ModelSelection } from "../../shared/model-selection.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface TeamDefaultsRouteDeps {
  sections(): readonly string[];
  bots(): readonly { hidden?: boolean; section?: string }[];
  groups(): readonly { section?: string }[];
  sectionKey(section: string | undefined): string;
  storageKey?(auth: RequestAuth, sectionName: string): string;
  /** Organization server: only the caller's own teams (#2045). */
  sectionsFor?(auth: RequestAuth): readonly string[];
  read(key: string): TeamDefaultsRecord | null;
  write(key: string, value: { model?: ModelSelection; computer?: TeamComputer }): TeamDefaultsRecord | null;
}

const bodySchema = z.object({
  model: z.unknown().optional(),
  computer: z.enum(["auto", "cloud", "local", "off"]).nullable().optional(),
});

function payload(section: string, record: TeamDefaultsRecord | null) {
  return {
    section,
    label: sectionContextLabel(section),
    model: record?.model ?? null,
    computer: record?.computer ?? null,
    updatedAt: record?.updatedAt ?? null,
  };
}

export function createTeamDefaultsRoutes(deps: TeamDefaultsRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (!(path === "/api/team-defaults" && (method === "GET" || method === "PUT"))) return PASS;
    const section = sectionContextKey(url.searchParams.get("section"));
    if (!section) return json(res, 400, { error: "section is required" });
    if (section.length > 60) return json(res, 400, { error: "section must be at most 60 characters" });
    const own = deps.sectionsFor?.(auth);
    const exists = own ? own.includes(section) :
      deps.sections().includes(section) ||
      deps.bots().some((bot) => !bot.hidden && deps.sectionKey(bot.section) === section) ||
      deps.groups().some((group) => deps.sectionKey(group.section) === section);
    if (!exists) return json(res, 404, { error: "no such team" });
    const key = deps.storageKey?.(auth, section) ?? section;
    if (method === "GET") return json(res, 200, payload(section, deps.read(key)));

    const parsed = bodySchema.safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: "computer must be auto, cloud, local, off or null" });
    // A field left out keeps the team's value; null clears it.
    const current = deps.read(key);
    let model: ModelSelection | undefined = current?.model;
    if (parsed.data.model === null) model = undefined;
    else if (parsed.data.model !== undefined) {
      model = parseTeamDefaultsRecord({ model: parsed.data.model, updatedAt: 0 })?.model;
      if (!model) return json(res, 400, { error: "model must be a model selection (instanceId and model)" });
    }
    const computer = parsed.data.computer === undefined ? current?.computer : parsed.data.computer ?? undefined;
    return json(res, 200, { ok: true, ...payload(section, deps.write(key, { ...(model ? { model } : {}), ...(computer ? { computer } : {}) })) });
  };
}
