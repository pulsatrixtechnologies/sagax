// @ts-nocheck
/** approvalModeStepUpGate (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createApprovalModeStepUpGate(getHost: () => Host): any {
function approvalModeStepUpGate(input: {   person: string | null; botId: string; op: string; thread: string; froms: Array<string | undefined>; to: string;   stepUp?: unknown; allowance?: unknown; widensAllow?: boolean; }) {
  const host = getHost();
  const { STEP_UP_CLASSES, approvalModeLoosens } = host;
  const classes: StepUpClass[] = [];
  const loosens = input.froms.some((from) => approvalModeLoosens(from, input.to));
  if (loosens) classes.push("rule-change");
  // Full answers every call, whatever its class (2026-10-17, re-review of
  // #690): entering it needs the key when the person protects any class.
  if (loosens && input.to === "full") for (const name of STEP_UP_CLASSES) if (!classes.includes(name)) classes.push(name);
  if (input.widensAllow) classes.push("always-grant");
  if (!classes.length) return null;
  if (host.actConfirmedCovers(classes)) return null;
  const bot = host.store.bot(input.botId);
  const required = host.securityKeys.required(input.person, classes, bot ? host.approvalOwnerId(bot) || null : null);
  if (!required.length) return null;
  if (!input.person) return { status: 403, body: { error: "A looser approval level needs the person's security key.", code: "step_up_required", classes: required } };
  if (input.allowance !== undefined && host.securityKeys.takeAllowance(input.allowance, input.person, host.approvalModeAllowanceKey(input.op, input.botId, input.thread, input.to))) return null;
  return host.settingsStepUp(host.securityKeys, input.person, "approval-mode", { op: input.op, botId: input.botId, thread: input.thread, mode: input.to }, input.stepUp, required);

}
  return approvalModeStepUpGate;
}
