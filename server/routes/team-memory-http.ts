// Team memory HTTP: the section's shared people, places, decisions, terms
// (#1388 slice P1). The person's view and their edits. Same section rule as
// the brief: the query parameter is required even for General.
import type { RequestAuth } from "../auth/request-auth.ts";
import { sectionContextKey, sectionContextLabel } from "../rooms/section-context.ts";
import {
  TEAM_MEMORY_KINDS,
  type TeamMemoryEntry,
  type TeamMemoryKind,
} from "../memory/team-memory.ts";
import type { NotesCallResult } from "../memory/perspicax-memory-notes.ts";
import { mapNotesResult } from "./me-memory-notes.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** #4460: the console folder an entry of each kind lands in when the person
 * publishes it to a tier of the organization console. */
export const PUBLISH_TOPICS: Record<TeamMemoryKind, string> = { person: "people", place: "places", decision: "decisions", term: "terms" };

/** #4460: one entry of a person's own memory as a note of the console. */
export function publishedNote(entry: Pick<TeamMemoryEntry, "kind" | "name" | "detail" | "aliases">, scope: string, topic?: string): { scope: string; topic: string; title: string; body: string; tags: string[] } {
  const also = entry.aliases.length ? `\n\nAlso: ${entry.aliases.join(", ")}` : "";
  return { scope, topic: topic?.trim() || PUBLISH_TOPICS[entry.kind], title: entry.name, body: `${entry.detail}${also}`, tags: [] };
}

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
  /** #4460: whether this caller may use these routes: anyone on an
   * organization server (the key is their own memory), an admin elsewhere.
   * Absent: everyone the route table lets through. */
  mayUse?(auth: RequestAuth): boolean;
  /** #2045: storage key for this caller's team (owner/id on org servers). */
  storageKey?(auth: RequestAuth, sectionName: string): string;
  /** #4460: an organization server puts an entry into a tier of the
   * organization console (`team:<id>`, `org` or `me`) as the signed-in
   * person; the console's own rules decide whether it lands or waits for a
   * review there. Absent on a server with no console. */
  publish?(auth: RequestAuth, note: ReturnType<typeof publishedNote>): Promise<NotesCallResult>;
  /** Close matching proposal cards when the person accepts or deletes. */
  settleCards(auth: RequestAuth, section: string, entryId: string, answer: "allow" | "deny", sourceThreadId?: string): void;
}

export function createTeamMemoryHttpRoutes(deps: TeamMemoryHttpDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if ((path === "/api/team-memory" || path.startsWith("/api/team-memory/")) && deps.mayUse && !deps.mayUse(auth)) {
      return json(res, 403, { error: "Only the owner of this installation can manage its team memory." });
    }
    if (path === "/api/team-memory" && (method === "GET" || method === "POST")) {
      if (!url.searchParams.has("section")) return json(res, 400, { error: "section is required" });
      const section = sectionContextKey(url.searchParams.get("section") ?? "");
      if (section.length > 60) return json(res, 400, { error: "section must be at most 60 characters" });
      const key = deps.storageKey?.(auth, section) ?? section;
      const refusal = teamMemoryWriteRefusal(auth, method);
      if (refusal) return json(res, 403, { error: refusal });
      if (method === "GET") {
        return json(res, 200, { section, label: sectionContextLabel(section), entries: deps.list(key) });
      }
      const body = await readBody(req);
      if (!body || typeof body !== "object" || !(TEAM_MEMORY_KINDS as readonly string[]).includes(String((body as { kind?: unknown }).kind))) {
        return json(res, 400, { error: `kind must be one of ${TEAM_MEMORY_KINDS.join(", ")}` });
      }
      try {
        const proposed = deps.propose(
          key,
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
        if (proposed.status === "proposed") deps.resolve(key, proposed.entry.id, "accept");
        return json(res, 201, { entries: deps.list(key) });
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    // #4460: the person moves one entry of their own memory to a tier of
    // the organization console (a team of theirs): it lives there from
    // then on, visible and editable in the console, and leaves this server
    const published = path.match(/^\/api\/team-memory\/([\w-]+)\/publish$/);
    if (published && method === "POST") {
      if (!deps.publish) return json(res, 404, { error: "This server has no organization console to publish to." });
      if (!url.searchParams.has("section")) return json(res, 400, { error: "section is required" });
      const section = sectionContextKey(url.searchParams.get("section") ?? "");
      const key = deps.storageKey?.(auth, section) ?? section;
      const refusal = teamMemoryWriteRefusal(auth, method);
      if (refusal) return json(res, 403, { error: refusal });
      const entry = deps.list(key).find((candidate) => candidate.id === published[1]);
      if (!entry) return json(res, 404, { error: "no such entry" });
      const body = await readBody(req);
      const scope = body && typeof body === "object" && typeof (body as { scope?: unknown }).scope === "string" ? (body as { scope: string }).scope.trim() : "";
      if (!scope || scope.length > 80) return json(res, 400, { error: "scope is required: team:<id>, org or me" });
      const topic = body && typeof body === "object" && typeof (body as { topic?: unknown }).topic === "string" ? (body as { topic: string }).topic.slice(0, 120) : undefined;
      const result = await deps.publish(auth, publishedNote(entry, scope, topic));
      if (!result.ok) {
        mapNotesResult(result, json, res);
        return;
      }
      deps.remove(key, entry.id);
      if (entry.status === "proposed") deps.settleCards(auth, key, entry.id, "allow", entry.source.threadId);
      const saved = result.body && typeof result.body === "object" ? result.body as Record<string, unknown> : {};
      return json(res, 201, { published: { state: saved.state, scope: saved.scope ?? scope, id: saved.id }, entries: deps.list(key) });
    }

    let m = path.match(/^\/api\/team-memory\/([\w-]+)$/);
    if (m && (method === "PATCH" || method === "DELETE")) {
      if (!url.searchParams.has("section")) return json(res, 400, { error: "section is required" });
      const section = sectionContextKey(url.searchParams.get("section") ?? "");
      const key = deps.storageKey?.(auth, section) ?? section;
      const refusal = teamMemoryWriteRefusal(auth, method);
      if (refusal) return json(res, 403, { error: refusal });
      const before = deps.list(key).find((entry) => entry.id === m![1]);
      if (method === "DELETE") {
        if (!deps.remove(key, m[1]!)) return json(res, 404, { error: "no such entry" });
        // a proposal deleted here is declined on its cards too
        if (before?.status === "proposed") deps.settleCards(auth, key, m[1]!, "deny", before.source.threadId);
        return json(res, 200, { entries: deps.list(key) });
      }
      const body = await readBody(req);
      if (!body || typeof body !== "object") return json(res, 400, { error: "body must be a JSON object" });
      if ((body as { accept?: unknown }).accept === true) {
        const result = deps.resolve(key, m[1]!, "accept");
        if (!result.claimed) return json(res, 404, { error: "no such entry" });
        if (result.state === "accepted") deps.settleCards(auth, key, m[1]!, "allow", before?.source.threadId);
        return json(res, 200, { entries: deps.list(key) });
      }
      const patch: { name?: string; detail?: string; aliases?: string[]; kind?: TeamMemoryKind } = {};
      if (typeof (body as { name?: unknown }).name === "string") patch.name = (body as { name: string }).name;
      if (typeof (body as { detail?: unknown }).detail === "string") patch.detail = (body as { detail: string }).detail;
      if (Array.isArray((body as { aliases?: unknown }).aliases)) patch.aliases = (body as { aliases: unknown[] }).aliases.map(String);
      if (typeof (body as { kind?: unknown }).kind === "string" && (TEAM_MEMORY_KINDS as readonly string[]).includes((body as { kind: string }).kind)) {
        patch.kind = (body as { kind: TeamMemoryKind }).kind;
      }
      try {
        const updated = deps.update(key, m[1]!, patch);
        if (!updated) return json(res, 404, { error: "no such entry" });
        // editing a proposal accepts it: its cards close as accepted
        if (before?.status === "proposed") deps.settleCards(auth, key, m[1]!, "allow", before.source.threadId);
        return json(res, 200, { entry: updated, entries: deps.list(key) });
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    return PASS;
  };
}
