// @ts-nocheck
/** saveOrgInterimAttachDays (#1388). Pure move from server/index.ts. */
import { windowWithDays } from "../interim-attach-routes.ts";
export type Host = Record<string, any>;

export function createSaveOrgInterimAttachDays(getHost: () => Host): any {
function saveOrgInterimAttachDays(days: number, actor: AdminActor) {
  const host = getHost();
  const { cfg, saveConfig } = host;
  const before = host.cfg.organization?.interimAttach;
  const next = windowWithDays(before, days, Date.now());
  saveConfig({ organization: { ...cfg.organization, interimAttach: next } });
  host.cfg.organization = { ...cfg.organization, interimAttach: next };
  host.orgAudit({
    category: "org", action: "org.settings", target: { kind: "organization" }, changed: ["interimAttachDays"],
    before: { interimAttachDays: before?.days ?? null }, after: { interimAttachDays: days }, actor
  });

}
  return saveOrgInterimAttachDays;
}
