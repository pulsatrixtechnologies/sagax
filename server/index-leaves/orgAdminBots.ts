// @ts-nocheck
/** orgAdminBots (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOrgAdminBots(getHost: () => Host): any {
function orgAdminBots(): Array<{ bot: AdminBot; reach: AdminBotReach }> {
  const host = getHost();
  const { approvalModeFor, attachmentExists, resolveEngineAccess, sectionKey } = host;
  const routineCounts = new Map<string, number>();
  for (const routine of host.routines?.listRoutines() ?? []) routineCounts.set(routine.botId, (routineCounts.get(routine.botId) ?? 0) + 1);
  return host.store.bots.map((bot) => {
    const facts = host.botFacts(bot);
    const engine = host.engineOfBot(bot);
    const plan = host.IDENTITY.kind === "perspicax"
      // A turn by someone other than the owner: what it would resolve to now.
      ? resolveEngineAccess(host.orgEngineInput(bot, { instanceId: engine.instanceId, driverKind: engine.driver }, { origin: "person", principalId: "" }))
      : { ok: true as const, via: "server" as const };
    const access: AccessKind = plan.ok ? plan.via : "none";
    const sectionName = sectionKey(bot.section);
    const record = sectionName && host.sectionChannels ? host.sectionChannels.byName(sectionName) : undefined;
    const shared = record && facts.sections?.length ? record : undefined;
    const lastActivity = host.store.tasks(bot.id).reduce<number | null>((latest, task) => {
      const at = typeof task.updatedAt === "number" ? task.updatedAt : null;
      return at !== null && (latest === null || at > latest) ? at : latest;
    }, null);
    const ownerRole = host.botOwnerOrgRole(bot) ?? "member";
    return {
      bot: {
        id: bot.id,
        name: bot.name,
        owner: host.adminPerson(facts.ownerPrincipalId),
        ownerRole,
        engine: (() => {
          const live = host.registry.get(engine.instanceId);
          return host.adminBotEngine({
            instanceId: engine.instanceId,
            driverKind: engine.driver,
            installed: host.engineInstalled(engine.instanceId),
            displayName: live?.displayName,
            driverDisplayName: engine.driver ? host.driverDisplayName(engine.driver) : null,
          });
        })(),
        model: bot.modelSelection?.model || null,
        access,
        // Kept empty for the older console wire shape. Roles belong to the
        // account now, never to a bot.
        mcpProfiles: [],
        grants: host.wireGrants(facts.grants, host.describeGrantTarget).map((grant) => ({
          target: grant.target, kind: grant.kind, label: grant.label, level: grant.level, ...(grant.disabled ? { disabled: true as const } : {})
        })),
        sections: shared ? [{ id: shared.id, name: shared.name, defaultLevel: shared.defaultLevel, members: shared.members.length }] : [],
        routines: routineCounts.get(bot.id) ?? 0,
        createdAt: typeof bot.createdAt === "number" ? bot.createdAt : null,
        lastActivityAt: lastActivity,
        status: bot.hidden ? "archived" : "active",
        label: sectionName || null,
        threads: host.botThreadIds(bot).length,
        look: host.botLook(bot, attachmentExists),
        persona: host.botPersona(bot),
        approvalMode: approvalModeFor(bot)
      },
      reach: host.orgBotReach(bot)
    };
  });

}
  return orgAdminBots;
}
