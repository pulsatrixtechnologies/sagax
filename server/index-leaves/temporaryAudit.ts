// @ts-nocheck
/** temporaryAudit (#1388). Pure move from server/index.ts. */
import { DATA_DIR } from "../config.ts";
export type Host = Record<string, any>;

export function createTemporaryAudit(getHost: () => Host): any {
function temporaryAudit(action: "agents.temporary.expired" | "agents.temporary.purged" | "agents.temporary.pinned" | "agents.temporary.unpinned", bot: BotRecord, after: Record<string, unknown>, actor?: { principalId: string }) {
  void getHost();

  host.appendAdminAction(DATA_DIR, {
    category: "client",
    action,
    target: { kind: "bot", id: bot.id, name: bot.name },
    after: { ownerPrincipalId: bot.temporary?.ownerPrincipalId ?? null, ...after },
    actor: actor ? { kind: "person", principalId: actor.principalId, via: "console" } : { kind: "worker" }
  });

}
  return temporaryAudit;
}
