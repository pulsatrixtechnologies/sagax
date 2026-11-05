/**
 * Organization bots list (#1388): GET /api/org/bots.
 * Pure move out of server/index.ts; behaviour unchanged.
 */
import { PASS, type RouteHandler } from "./table.ts";

export type OrgBotsRouteDeps = Record<string, any>;

export function createOrgBotsRoutes(deps: OrgBotsRouteDeps): RouteHandler {
  const {
    authzViewerFor,
    store,
    botFacts,
    visibleGrants,
    principalTeams,
    principals,
    describeGrantTarget,
    wireGrants,
    engineOfBot,
    botPublicProfile,
    botRunning,
  } = deps;
  return async ({ res, path, method, auth, json }) => {
    if (path !== "/api/org/bots") return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    const viewer = authzViewerFor(auth);
    const bots = store.bots.flatMap((bot: any) => {
      const facts = botFacts(bot);
      const shown = visibleGrants(viewer, facts, principalTeams);
      if (!viewer || viewer.orgAdmin) {
        // everything
      } else if (!shown) {
        return [];
      }
      const owner = principals.byId(facts.ownerPrincipalId);
      return [{
        id: bot.id,
        name: bot.name,
        ownerPrincipalId: facts.ownerPrincipalId,
        ownerName: owner ? describeGrantTarget(`user:${owner.id}`).label : "",
        ...(bot.section ? { section: bot.section } : {}),
        engine: engineOfBot(bot),
        grants: wireGrants(shown ?? facts.grants, describeGrantTarget),
        // Its public look (as a group shows it) and whether it is working
        // now, so the list draws the avatar and the force-stop state.
        look: botPublicProfile(bot),
        running: botRunning(bot.id)
      }];
    });
    res.setHeader("cache-control", "no-store");
    return json(res, 200, { bots });
  };
}
