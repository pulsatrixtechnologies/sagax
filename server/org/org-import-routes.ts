// "Bring bots from a solo Sagax" (slice 8): `POST /api/org/import` on an
// organization server. The caller is a person signed in with Pulsatrix; the
// copy lands as theirs (owner, room person, routine runner), private, with
// every other person ref dropped and counted, never turned into a right.
// All or nothing: a refusal writes nothing, a failure midway is rolled back.
import { MAX_ORG_IMPORT_BYTES, parseOrgImportDocument, type OrgImportDocument } from "../../shared/org-import.ts";
import { rewritePeopleForImport, type ImportPeopleResult } from "../identity-migration.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";

export interface OrgImportReport {
  bots: { sourceKey: string; id: string; name: string; section: string; tasks: number; messages: number; memoryFiles: number }[];
  groups: { sourceKey: string; id: string; name: string }[];
  routines: { id: string; name: string; enabled: false }[];
  removedPeople: ImportPeopleResult["removed"];
  subject: { iss: string; sub: string };
  warnings: string[];
}

export interface OrgImportRouteDeps {
  /** False on a solo server: the route answers 403 identity_perspicax. */
  organization: boolean;
  /** Whether this caller may create bots. */
  mayCreateBots(auth: RequestAuth): boolean;
  /** Write the copy as `importer`'s; throws (after its own rollback) when it
   * could not be written. Returns the created records, in backup order. */
  importCopy(input: { document: OrgImportDocument; importer: string; people: ImportPeopleResult; auth: RequestAuth }): Promise<{
    bots: { id: string; name: string; section?: string }[];
    groups: { id: string; name: string }[];
    routines: { id: string; name: string }[];
  }>;
  /** One `org.import` audit row, counts only. */
  audit(auth: RequestAuth, details: { bots: number; rooms: number; routines: number; messages: number; memoryFiles: number; removedRefs: number }): void;
}

const refuse = (code: string, error: string) => ({ code, error });

export function createOrgImportRoute(deps: OrgImportRouteDeps): RouteHandler {
  const inFlight = new Set<string>();
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/org/import") return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    res.setHeader("cache-control", "no-store");
    if (!deps.organization) {
      return json(res, 403, refuse("identity_perspicax", "Copy into an organization server signed in with Pulsatrix."));
    }
    const principalId = auth.kind === "session" && auth.session.idp ? auth.session.principalId?.trim() : undefined;
    const subject = auth.kind === "session" ? auth.session.idp : undefined;
    if (!principalId || !subject) return json(res, 401, refuse("session_required", "Sign in with Pulsatrix to copy bots into this organization."));
    if (!deps.mayCreateBots(auth)) return json(res, 403, refuse("forbidden", "You cannot create bots on this server."));
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      return json(res, 415, refuse("unsupported_media_type", "Send the copy as JSON (content-type: application/json)."));
    }
    if (inFlight.has(principalId)) return json(res, 409, refuse("import_in_progress", "Another copy of yours is being imported. Wait for it to finish."));
    inFlight.add(principalId);
    try {
      let body: unknown;
      try {
        body = await readBody(req, MAX_ORG_IMPORT_BYTES);
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 413) return json(res, 413, refuse("too_large", "This copy is too large."));
        return json(res, 400, refuse("invalid_document", "This file is not an organization copy."));
      }
      let document: OrgImportDocument;
      try {
        document = parseOrgImportDocument(body);
      } catch (error) {
        return json(res, 400, refuse("invalid_document", error instanceof Error ? error.message : "This file is not an organization copy."));
      }
      const people = rewritePeopleForImport({
        self: document.self,
        importer: principalId,
        people: document.people,
        names: {
          bots: Object.fromEntries(document.backup.bots.map((bot) => [bot.key, bot.name])),
          groups: Object.fromEntries(document.backup.groups.map((group) => [group.key, group.name])),
          routines: document.backup.routines.map((routine) => routine.name),
        },
      });
      if (!people.ok) {
        const text = {
          foreign_owner: "A bot in this copy belongs to someone else.",
          foreign_room: "A room in this copy has other people in it.",
          foreign_routine: "A routine in this copy runs as someone else.",
        }[people.code];
        return json(res, 400, refuse(people.code, text));
      }
      let created: Awaited<ReturnType<OrgImportRouteDeps["importCopy"]>>;
      try {
        created = await deps.importCopy({ document, importer: principalId, people, auth });
      } catch (error) {
        console.error(`org import failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`);
        return json(res, 500, refuse("import_failed", "The copy could not be written. Nothing was changed."));
      }
      const backup = document.backup;
      const report: OrgImportReport = {
        bots: backup.bots.map((source, index) => ({
          sourceKey: source.key,
          id: created.bots[index]!.id,
          name: created.bots[index]!.name,
          section: created.bots[index]!.section ?? "",
          tasks: source.tasks.length,
          messages: source.tasks.reduce((sum, task) => sum + task.messages.length, 0),
          memoryFiles: source.memory ? (source.memory.file ? 1 : 0) + source.memory.topics.length + source.memory.logs.length : 0,
        })),
        groups: backup.groups.map((source, index) => ({ sourceKey: source.key, id: created.groups[index]!.id, name: created.groups[index]!.name })),
        routines: created.routines.map((routine) => ({ id: routine.id, name: routine.name, enabled: false as const })),
        removedPeople: people.removed,
        subject: { iss: subject.iss, sub: subject.sub },
        warnings: backup.warnings,
      };
      deps.audit(auth, {
        bots: report.bots.length,
        rooms: report.groups.length,
        routines: report.routines.length,
        messages: report.bots.reduce((sum, bot) => sum + bot.messages, 0),
        memoryFiles: report.bots.reduce((sum, bot) => sum + bot.memoryFiles, 0),
        removedRefs: people.removed.reduce((sum, entry) => sum + entry.refs, 0),
      });
      return json(res, 201, report);
    } finally {
      inFlight.delete(principalId);
    }
  };
}
