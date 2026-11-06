// @ts-nocheck
/** applyAutoReviewDefault (#1388). Pure move from server/index.ts. */
import { hasNativeAutoReview } from "../../shared/approval-mode.ts";
import { autoReviewThreadMode } from "../bots/bot-settings.ts";
export type Host = Record<string, any>;

export function createApplyAutoReviewDefault(getHost: () => Host): any {
function applyAutoReviewDefault(auth: RequestAuth, botId: string, threadId: string) {
  const host = getHost();
  const { approvalModeFor, isPrincipalId } = host;

  const principalId = host.IDENTITY.kind === "perspicax" && auth.kind === "session" ? auth.session.principalId : undefined;
  const settings = principalId && isPrincipalId(principalId) ? host.botSettings.person(principalId) : host.botSettings.server();
  if (!settings.autoReviewDefault) return;
  const thread = host.store.projectBotForTask(botId, threadId);
  if (!thread || thread.approvalGrant) return;
  const mode = autoReviewThreadMode({
    current: approvalModeFor(thread),
    nativeReviewer: hasNativeAutoReview(host.registry.cliTarget(thread.modelSelection.instanceId)?.driverKind),
    supportsAuto: host.supportsApprovalMode(thread.modelSelection, "auto"),
    thisComputer: thread.computer === "local"
  });
  // never an automatic level the organization refuses for a member's bot
  if (mode && !host.memberAutoRefused(thread, [approvalModeFor(thread)], mode)) host.store.patchTask(botId, threadId, { approvalMode: mode, autoApprove: mode === "auto" });

}
  return applyAutoReviewDefault;
}
