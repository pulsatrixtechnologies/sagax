// Artifacts over HTTP (docs/superpowers/specs/2026-10-16-artifacts-design.md).
//
// The person's routes (member scope, request-auth.ts CLIENT_ALLOW):
//   GET    /api/artifacts                       { artifacts: summary[] } every bot this viewer sees
//   GET    /api/bots/:id/artifacts              { artifacts: summary[] }
//   GET    /api/bots/:id/artifacts/:aid         { artifact }  with its document and last data
//   GET    ...?versions=1                       also { versions } of earlier documents
//   POST   /api/bots/:id/artifacts/:aid         { restoreRev } puts that document back
//   PATCH  /api/bots/:id/artifacts/:aid         { favorite?, popped? }  nothing else
//   DELETE /api/bots/:id/artifacts/:aid
//   POST   /api/bots/:id/artifacts/:aid/refresh run its source now (artifact-refresh.ts)
//   POST   /api/artifacts/watch                 { ids } these are on screen (artifact-refresh.ts)
//
// The bot's tools (server/drivers/agents-call-artifacts.ts), behind the
// per-turn capability, so in INTERNAL_ROUTES:
//   POST   /api/internal/artifacts              { tool, args }
// The bot is always the capability's, never the body's.
import { z } from "zod";

import type { ArtifactStore } from "../artifacts/artifacts.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { isArtifactId, sortArtifacts, summarizeArtifact, type Artifact } from "../../shared/artifacts.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ArtifactRouteDeps {
  artifacts: () => ArtifactStore;
  /** The bot exists and this viewer may use it. */
  mayUseBot(auth: RequestAuth, botId: string): boolean;
  /** This viewer may see this artifact (on a shared server: the person who
   * asked for it, or an admin). */
  mayView(auth: RequestAuth, artifact: Artifact): boolean;
  /** Run the source now; absent until the refresher is wired. */
  refreshNow?(artifact: Artifact, auth: RequestAuth): Promise<Artifact | null>;
  /** The viewer has these artifacts on screen (refresh while visible). */
  watch?(ids: readonly string[], auth: RequestAuth): void;
  /** The person's own changes, for the admin activity log. */
  audit?(auth: RequestAuth, action: "artifact.delete" | "artifact.flags", artifact: Artifact): void;
}

const ONE = /^\/api\/bots\/([\w-]+)\/artifacts(?:\/([\w-]+)(\/refresh)?)?$/;
const flagsBody = z.object({ favorite: z.boolean().optional(), popped: z.boolean().optional() }).strict();
const watchBody = z.object({ ids: z.array(z.string().max(80)).max(100) }).strict();

export function createArtifactRoutes(deps: ArtifactRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (path === "/api/artifacts") {
      if (method !== "GET") return json(res, 405, { error: "GET only" });
      res.setHeader("cache-control", "private, no-store");
      const shown = deps.artifacts().all().filter((artifact) => deps.mayUseBot(auth, artifact.botId) && deps.mayView(auth, artifact));
      return json(res, 200, { artifacts: sortArtifacts(shown.map(summarizeArtifact)) });
    }
    if (path === "/api/artifacts/watch") {
      if (method !== "POST") return json(res, 405, { error: "POST only" });
      const parsed = watchBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "send { ids }" });
      const store = deps.artifacts();
      const ids = parsed.data.ids.filter((id) => {
        const artifact = isArtifactId(id) ? store.get(id) : null;
        return Boolean(artifact && deps.mayUseBot(auth, artifact.botId) && deps.mayView(auth, artifact));
      });
      deps.watch?.(ids, auth);
      return json(res, 200, { ok: true, watching: ids.length });
    }
    const m = ONE.exec(path);
    if (!m) return PASS;
    const [, botId, artifactId, refresh] = m;
    if (!deps.mayUseBot(auth, botId!)) return json(res, 404, { error: "no such bot" });
    res.setHeader("cache-control", "private, no-store");
    const store = deps.artifacts();
    if (!artifactId) {
      if (method !== "GET") return json(res, 405, { error: "GET only" });
      const shown = store.list(botId!).filter((artifact) => deps.mayView(auth, artifact));
      return json(res, 200, { artifacts: sortArtifacts(shown.map(summarizeArtifact)) });
    }
    const artifact = isArtifactId(artifactId) ? store.get(artifactId) : null;
    if (!artifact || artifact.botId !== botId || !deps.mayView(auth, artifact)) return json(res, 404, { error: "no such artifact" });
    if (refresh) {
      if (method !== "POST") return json(res, 405, { error: "POST only" });
      if (!deps.refreshNow) return json(res, 409, { error: "This artifact has no refresh." });
      if (!artifact.source) return json(res, 409, { error: "This artifact has no source to refresh. Ask the bot to add one." });
      const next = await deps.refreshNow(artifact, auth);
      return json(res, 200, { artifact: next ?? artifact });
    }
    if (method === "GET") {
      const versions = url.searchParams.get("versions") === "1" ? store.versions(artifact.id) : undefined;
      return json(res, 200, versions ? { artifact, versions } : { artifact });
    }
    if (method === "POST") {
      const parsed = z.object({ restoreRev: z.number().int() }).strict().safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "Send { restoreRev } to put that version back." });
      const result = store.restore(botId!, artifact.id, parsed.data.restoreRev);
      if (!result.ok) return json(res, result.status, { error: result.error });
      return json(res, 200, { artifact: result.artifact });
    }
    if (method === "PATCH") {
      const parsed = flagsBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "Only favorite and popped can be changed here. Ask the bot for anything else." });
      const result = store.setFlags(artifact.id, parsed.data);
      if (!result.ok) return json(res, result.status, { error: result.error });
      deps.audit?.(auth, "artifact.flags", result.artifact);
      return json(res, 200, { artifact: summarizeArtifact(result.artifact) });
    }
    if (method === "DELETE") {
      store.remove(artifact.id);
      deps.audit?.(auth, "artifact.delete", artifact);
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: "method not allowed" });
  };
}

const internalBody = z.object({
  tool: z.enum(["save_artifact", "update_artifact", "list_artifacts", "delete_artifact"]),
  args: z.record(z.string(), z.unknown()).default({}),
}).strict();

/** What a bot sees of its artifacts: every setting, never the document. */
function forBot(artifact: Artifact) {
  return {
    id: artifact.id,
    title: artifact.title,
    ...(artifact.source ? { source: artifact.source } : {}),
    ...(artifact.intervalSeconds ? { interval_seconds: artifact.intervalSeconds } : {}),
    favorite: artifact.favorite,
    popped: artifact.popped,
    ...(artifact.bounds ? { bounds: artifact.bounds } : {}),
    refresh: artifact.refresh,
    updated_at: new Date(artifact.updatedAt).toISOString(),
  };
}

export function createArtifactInternalRoutes(deps: {
  artifacts: () => ArtifactStore;
  /** The conversation belongs to this bot (connectorThread in index.ts). */
  ownsThread(botId: string, threadId: string): boolean;
  /** Who is speaking in this conversation: the artifact's owner on a shared server. */
  speaker?(threadId: string): string | undefined;
}): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== "/api/internal/artifacts") return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!deps.ownsThread(capability.botId, capability.threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const parsed = internalBody.safeParse(await readBody());
    if (!parsed.success) return json(res, 400, { error: "Send { tool, args }." });
    const { tool, args } = parsed.data;
    const store = deps.artifacts();
    const botId = capability.botId;
    if (tool === "list_artifacts") return json(res, 200, { artifacts: store.list(botId).map(forBot) });
    if (tool === "save_artifact") {
      const owner = deps.speaker?.(capability.threadId);
      const result = store.create(botId, capability.threadId, args, owner);
      if (!result.ok) return json(res, result.status, { error: result.error });
      return json(res, 201, { artifact: forBot(result.artifact) });
    }
    const id = typeof args.artifact_id === "string" ? args.artifact_id.trim() : "";
    if (!isArtifactId(id)) return json(res, 400, { error: "artifact_id: the id save_artifact or list_artifacts gave." });
    if (tool === "delete_artifact") {
      return store.remove(id, botId) ? json(res, 200, { ok: true }) : json(res, 404, { error: "No artifact with that id for this bot." });
    }
    const { artifact_id: _id, ...fields } = args;
    const result = store.update(botId, id, fields);
    if (!result.ok) return json(res, result.status, { error: result.error });
    return json(res, 200, { artifact: forBot(result.artifact) });
  };
}
