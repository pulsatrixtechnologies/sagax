/**
 * Perspicax person avatar bytes (#1388): GET /api/people/:id/avatar.
 * Pure move out of server/index.ts; behaviour unchanged.
 * Deps are read per request so a late-bound Perspicax directory stays valid (#2056).
 */
import { PASS, type RouteHandler } from "./table.ts";

export type PeopleAvatarRouteDeps = Record<string, any>;

export function createPeopleAvatarRoutes(deps: PeopleAvatarRouteDeps): RouteHandler {
  return async ({ res, url, path, method, json }) => {
    const match = /^\/api\/people\/([\w-]{1,80})\/avatar$/.exec(path);
    if (!match || method !== "GET") return PASS;
    const person = deps.principals.byId(match[1]!);
    const directory = deps.perspicaxDirectory;
    if (!person?.subject || person.subject.iss !== deps.issuer || !person.avatar || !directory) return json(res, 404, { error: "no avatar" });
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
