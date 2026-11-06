// @ts-nocheck
/** personSendsReadReceipts (#1388). Pure move from server/index.ts. */
import { READ_RECEIPTS_PREFERENCE, sendsReadReceipts } from "../messages/read-receipts.ts";
export type Host = Record<string, any>;

export function createPersonSendsReadReceipts(getHost: () => Host): any {
function personSendsReadReceipts(personId: string) {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax") return true;
  try {
    return sendsReadReceipts(host.userPreferenceStore.get(personId).preferences[READ_RECEIPTS_PREFERENCE]);
  } catch {
    return true;
  }

}
  return personSendsReadReceipts;
}
