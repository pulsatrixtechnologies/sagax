/**
 * Perspicax person avatar bytes (#1388): GET /api/people/:id/avatar.
 * Pure move out of server/index.ts; behaviour unchanged.
 */
import { PASS, type RouteHandler } from "./table.ts";

export type PeopleAvatarRouteDeps = Record<string, any>;

export function createPeopleAvatarRoutes(deps: PeopleAvatarRouteDeps): RouteHandler {
  const { principals, issuer, perspicaxDirectory } = deps;
  return async ({ res, url, path, method, json }) => {
    const match = /^\/api\/people\/([\w-]{1,80})\/avatar$/.exec(path);
    if (!match || method !== "GET") return PASS;
    const person = principals.byId(match[1]!);
    if (!person?.subject || person.subject.iss !== issuer || !person.avatar || !perspicaxDirectory) return json(res, 404, { error: "no avatar" });
    const image = await perspicaxDirectory.avatar(person.subject.sub, person.avatar);
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
