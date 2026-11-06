// @ts-nocheck
/** pendingExpireDaysForPerson (#1388). Pure move from server/index.ts. */
import { pendingApprovalExpireDays } from "../approvals/pending-approval-expiry.ts";
export type Host = Record<string, any>;

export function createPendingExpireDaysForPerson(getHost: () => Host): any {
function pendingExpireDaysForPerson(principalId: string | null | undefined) {
  const host = getHost();

  const owner = host.personSettingsOwner(principalId);
  const personDays = owner ? host.personSettings.get(owner).pendingApprovalExpireDays : undefined;
  return pendingApprovalExpireDays({
    personDays: personDays ?? null,
    orgDays: host.cfg.organization?.pendingApprovalExpireDays ?? null,
  });

}
  return pendingExpireDaysForPerson;
}
