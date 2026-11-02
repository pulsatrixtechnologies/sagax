// Team memory HTTP: the section's shared people, places, decisions, terms
// (#1388 slice P1). The person's view and their edits. Same section rule as
// the brief: the query parameter is required even for General.
import type { RequestAuth } from "../request-auth.ts";
import { sectionContextKey, sectionContextLabel } from "../section-context.ts";
import {
  TEAM_MEMORY_KINDS,
  type TeamMemoryEntry,
  type TeamMemoryKind,
} from "../team-memory.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function teamMemoryWriteRefusal(auth: RequestAuth, method: string): string | null {
  if (method === "GET") return null;
  return auth.kind === "loopback" && auth.trust === "service"
    ? "A local service cannot change shared team memory. Propose it and let a person confirm the card."
    : null;
}

export interface TeamMemoryHttpDeps {
  list(section: string): readonly TeamMemoryEntry[];
  propose(
    section: string,
    entry: { kind: TeamMemoryKind; name: string; detail: string; aliases?: string[] },
    meta: { botId: string; botName: string; threadId: string; at: number },
  ): { entry: TeamMemoryEntry; status: "proposed" };
  resolve(section: string, entryId: string, decision: "accept" | "reject"): { claimed: boolean; state?: string };
  remove(section: string, entryId: string): boolean;
  update(
    section: string,
    entryId: string,
    patch: { name?: string; detail?: string; aliases?: string[]; kind?: TeamMemoryKind },
  ): TeamMemoryEntry | null;
  /** Close matching proposal cards when the person accepts or deletes. */
  settleCards(auth: RequestAuth, section: string, entryId: string, answer: "allow" | "deny", sourceThreadId?: string): void;
}

export function createTeamMemoryHttpRoutes(deps: TeamMemoryHttpDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (path === "/api/team-memory" && (method === "GET" || method === "POST")) {
      if (!url.searchParams.has("section")) return json(res, 400, { error: "section is required" });
      const section = sectionContextKey(url.searchParams.get("section") ?? "");
      if (section.length > 60) return json(res, 400, { error: "section must be at most 60 characters" });
      const refusal = teamMemoryWriteRefusal(auth, method);
      if (refusal) return json(res, 403, { error: refusal });
      if (method === "GET") {
        return json(res, 200, { section, label: sectionContextLabel(section), entries: deps.list(section) });
      }
      const body = await readBody(req);
      if (!body || typeof body !== "object" || !(TEAM_MEMORY_KINDS as readonly string[]).includes(String((body as { kind?: unknown }).kind))) {
        return json(res, 400, { error: `kind must be one of ${TEAM_MEMORY_KINDS.join(", ")}` });
      }
      try {
        const proposed = deps.propose(
          section,
          {
            kind: (body as { kind: TeamMemoryKind }).kind,
            name: String((body as { name?: unknown }).name ?? ""),
            detail: String((body as { detail?: unknown }).detail ?? ""),
            aliases: Array.isArray((body as { aliases?: unknown }).aliases)
              ? (body as { aliases: unknown[] }).aliases.map(String)
              : undefined,
          },
          { botId: "", botName: "you", threadId: "", at: Date.now() },
        );
        // the person's own entry never waits on the person
        if (proposed.status === "proposed") deps.resolve(section, proposed.entry.id, "accept");
        return json(res, 201, { entries: deps.list(section) });
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    let m = path.match(/^\/api\/team-memory\/([\w-]+)$/);
    if (m && (method === "PATCH" || method === "DELETE")) {
      if (!url.searchParams.has("section")) return json(res, 400, { error: "section is required" });
      const section = sectionContextKey(url.searchParams.get("section") ?? "");
      const refusal = teamMemoryWriteRefusal(auth, method);
      if (refusal) return json(res, 403, { error: refusal });
      const before = deps.list(section).find((entry) => entry.id === m![1]);
      if (method === "DELETE") {
        if (!deps.remove(section, m[1]!)) return json(res, 404, { error: "no such entry" });
        // a proposal deleted here is declined on its cards too
        if (before?.status === "proposed") deps.settleCards(auth, section, m[1]!, "deny", before.source.threadId);
        return json(res, 200, { entries: deps.list(section) });
      }
      const body = await readBody(req);
      if (!body || typeof body !== "object") return json(res, 400, { error: "body must be a JSON object" });
      if ((body as { accept?: unknown }).accept === true) {
        const result = deps.resolve(section, m[1]!, "accept");
        if (!result.claimed) return json(res, 404, { error: "no such entry" });
        if (result.state === "accepted") deps.settleCards(auth, section, m[1]!, "allow", before?.source.threadId);
        return json(res, 200, { entries: deps.list(section) });
      }
      const patch: { name?: string; detail?: string; aliases?: string[]; kind?: TeamMemoryKind } = {};
      if (typeof (body as { name?: unknown }).name === "string") patch.name = (body as { name: string }).name;
      if (typeof (body as { detail?: unknown }).detail === "string") patch.detail = (body as { detail: string }).detail;
      if (Array.isArray((body as { aliases?: unknown }).aliases)) patch.aliases = (body as { aliases: unknown[] }).aliases.map(String);
      if (typeof (body as { kind?: unknown }).kind === "string" && (TEAM_MEMORY_KINDS as readonly string[]).includes((body as { kind: string }).kind)) {
        patch.kind = (body as { kind: TeamMemoryKind }).kind;
      }
      try {
        const updated = deps.update(section, m[1]!, patch);
        if (!updated) return json(res, 404, { error: "no such entry" });
        // editing a proposal accepts it: its cards close as accepted
        if (before?.status === "proposed") deps.settleCards(auth, section, m[1]!, "allow", before.source.threadId);
        return json(res, 200, { entry: updated, entries: deps.list(section) });
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    return PASS;
  };
}
