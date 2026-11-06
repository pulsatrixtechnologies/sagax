// @ts-nocheck
/** recordAdminConfigChange (#1388). Pure move from server/index.ts. */
import { configChangeRows, signInListsOf } from "../activity/admin-activity.ts";
export type Host = Record<string, any>;

export function createRecordAdminConfigChange(getHost: () => Host): any {
function recordAdminConfigChange(before: unknown, after: unknown) {
  const host = getHost();
  const { DATA_DIR, appendAdminAction, sharedSignIn } = host;
  const scope = host.adminActorScope.getStore();
  if (!scope || host.DESKTOP_MANAGED) return;
  // Shared when the request began, or now: the change that makes a server
  // shared, or stops it being, is kept.
  if (!scope.sharedAtStart && !host.adminActivityRecording() && !sharedSignIn(signInListsOf(before)) && !sharedSignIn(signInListsOf(after))) return;
  for (const row of configChangeRows(before, after)) appendAdminAction(DATA_DIR, { ...row, actor: scope.actor });

}
  return recordAdminConfigChange;
}
