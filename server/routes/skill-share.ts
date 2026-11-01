// Share and unshare bot skills through the Me / Organisation libraries
// (issue #1654). Me is a personal action; Organisation changes the shared
// installation and needs skills.library (or the solo computer owner).
import { z } from "zod";

import type { RequestAuth } from "../request-auth.ts";
import {
  sharePrivateSkillToMe,
  sharePrivateSkillToOrganization,
  unshareSkillForBot,
  type ShareBotRef,
} from "../skill-share.ts";
import { PASS, type RouteHandler } from "./table.ts";

const shareBody = z.object({
  scope: z.enum(["me", "organization"]),
  assignBotIds: z.array(z.string().min(1).max(64)).max(200).optional(),
}).strict();

const unshareBody = z.object({
  scope: z.enum(["me", "organization"]),
}).strict();

export function createSkillShareRoutes(deps: {
  enabled: () => boolean;
  bot: (id: string) => ShareBotRef | null;
  botsOfPerson: (person: string | null) => ShareBotRef[];
  allBots: () => ShareBotRef[];
  person: (auth: RequestAuth) => string | null;
  meRoot: (person: string) => string;
  mayChangeBot: (auth: RequestAuth, botId: string) => { status: number; body: Record<string, unknown> } | null;
  mayShareOrganization: (auth: RequestAuth) => { status: number; body: Record<string, unknown> } | null;
  referenceMe: (person: string, before: string | null, after: string | null) => void;
  patchAssigned: (botId: string, assignedSkills: string[]) => void;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const shareMatch = path.match(/^\/api\/bots\/([\w-]+)\/skills\/([a-z0-9-]+)\/share$/);
    const unshareMatch = path.match(/^\/api\/bots\/([\w-]+)\/skills\/([a-z0-9-]+)\/unshare$/);
    if (!shareMatch && !unshareMatch) return PASS;
    res.setHeader("cache-control", "private, no-store");
    if (!deps.enabled()) return json(res, 404, { error: "skills library is not enabled" });
    const botId = (shareMatch ?? unshareMatch)![1]!;
    const name = (shareMatch ?? unshareMatch)![2]!;
    const refused = deps.mayChangeBot(auth, botId);
    if (refused) return json(res, refused.status, refused.body);
    const author = deps.bot(botId);
    if (!author) return json(res, 404, { error: "no such bot" });
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    const raw = await readBody(req) as unknown;
    try {
      if (shareMatch && method === "POST") {
        const parsed = shareBody.safeParse(raw);
        if (!parsed.success) return json(res, 400, { error: "scope must be me or organization" });
        if (parsed.data.scope === "me") {
          const person = deps.person(auth);
          if (!person) return json(res, 403, { error: "Sign in to share a skill into your own library." });
          const result = sharePrivateSkillToMe({
            author,
            bots: deps.botsOfPerson(person),
            name,
            meRoot: deps.meRoot(person),
            reference: (before, after) => deps.referenceMe(person, before, after),
          });
          return "error" in result ? json(res, 422, { error: result.error }) : json(res, 200, { share: result });
        }
        const orgRefusal = deps.mayShareOrganization(auth);
        if (orgRefusal) return json(res, orgRefusal.status, orgRefusal.body);
        const result = sharePrivateSkillToOrganization({
          author,
          bots: deps.allBots(),
          name,
          assignBotIds: parsed.data.assignBotIds,
          patchAssigned: deps.patchAssigned,
        });
        return "error" in result ? json(res, 422, { error: result.error }) : json(res, 200, { share: result });
      }
      if (unshareMatch && method === "POST") {
        const parsed = unshareBody.safeParse(raw);
        if (!parsed.success) return json(res, 400, { error: "scope must be me or organization" });
        if (parsed.data.scope === "me") {
          const person = deps.person(auth);
          if (!person) return json(res, 403, { error: "Sign in to stop sharing a skill from your own library." });
          const result = unshareSkillForBot({
            bot: author,
            name,
            scope: "me",
            meRoot: deps.meRoot(person),
          });
          return "error" in result ? json(res, 422, { error: result.error }) : json(res, 200, result);
        }
        const result = unshareSkillForBot({
          bot: author,
          name,
          scope: "organization",
          patchAssigned: deps.patchAssigned,
        });
        return "error" in result ? json(res, 422, { error: result.error }) : json(res, 200, result);
      }
      return json(res, 405, { error: "POST only" });
    } catch (error) {
      return json(res, 500, { error: error instanceof Error ? error.message : "The skill could not be shared." });
    }
  };
}
