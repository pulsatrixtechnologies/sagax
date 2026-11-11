// @ts-nocheck
/** limitFailoverRow (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLimitFailoverRow(getHost: () => Host): any {
function limitFailoverRow(threadId: string, line: LimitFailoverLine) {
  const host = getHost();
  const { newId } = host;
  // #3315: a turn that carried on past a signed-out engine is quiet too; the stretch's one notice reads in the chat.
  const quiet = line.kind === "switched" || line.kind === "back" || line.kind === "signedOut";
  // #1942: consecutive limits with nothing left is a failed turn, not a soft recovery.
  const failed = line.kind === "exhausted" || line.kind === "credits";
  const words = line.kind === "switched" && line.to === "Auto" && line.reason !== "model"
    ? line.estimated
      ? `${line.from} reached its usage limit during this turn and gave no reset time: Auto continued the same turn on another model that works, with the steps already taken; ${line.from} is tried again around ${host.limitClockText(line.resetsAt)}.`
      : `${line.from} reached its usage limit during this turn: Auto continued the same turn on another model that works, with the steps already taken; ${line.from} is picked again once its limit resets (around ${host.limitClockText(line.resetsAt)}).`
    : host.limitFailoverText(line, host.limitClockText);
  if (quiet) {
    console.info(`[limit-failover] ${threadId}: ${words}`);
    host.bus.publish({ eventId: newId(), provider: "harness" as RuntimeEvent["provider"], threadId, createdAt: new Date().toISOString(), type: "runtime.notice", message: words });
  } else if (failed) {
    console.warn(`[limit-failover] ${threadId}: ${words}`);
    host.bus.publish({ eventId: newId(), provider: "harness" as RuntimeEvent["provider"], threadId, createdAt: new Date().toISOString(), type: "runtime.notice", message: words });
  }
  return {
    name: `${failed ? "error:" : quiet ? "notice:" : "recovery:"} ${words}`,
    ok: !failed,
    limitFailover: line,
  };

}
  return limitFailoverRow;
}
