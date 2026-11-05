/**
 * Perspicax person avatar bytes (#1388): GET /api/people/:id/avatar.
 * Moved out of server/index.ts.
 *
 * The route table is built before the Perspicax directory exists (it is
 * created once the link file and the OIDC client are ready), so the directory
 * is read per request through an accessor, never captured at build time
 * (#2056: captured as null, every avatar answered 404).
 */
import { PASS, type RouteHandler } from "./table.ts";

export type PeopleAvatarImage = { contentType: string; bytes: Buffer };

export type PeopleAvatarRouteDeps = {
  principals: { byId: (id: string) => { subject?: { iss: string; sub: string }; avatar?: string } | null | undefined };
  issuer: string;
  perspicaxDirectory: () => { avatar: (sub: string, version: string) => Promise<PeopleAvatarImage | null | undefined> } | null;
};

export function createPeopleAvatarRoutes(deps: PeopleAvatarRouteDeps): RouteHandler {
  const { principals, issuer } = deps;
  return async ({ res, url, path, method, json }) => {
    const match = /^\/api\/people\/([\w-]{1,80})\/avatar$/.exec(path);
    if (!match || method !== "GET") return PASS;
    const person = principals.byId(match[1]!);
    const directory = deps.perspicaxDirectory();
    if (!person?.subject || person.subject.iss !== issuer || !person.avatar || !directory) return json(res, 404, { error: "no avatar" });
    const image = await directory.avatar(person.subject.sub, person.avatar);
    if (!image) return json(res, 404, { error: "no avatar" });
    res.writeHead(200, {
      "content-type": image.contentType,
      "content-length": String(image.bytes.length),
      "x-content-type-options": "nosniff",
      "cache-control": url.searchParams.get("v") === person.avatar ? "private, max-age=86400" : "no-store"
    });
    res.end(image.bytes);
  };
}
