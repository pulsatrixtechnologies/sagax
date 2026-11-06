// @ts-nocheck
/** settingsStepUpGate (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSettingsStepUpGate(getHost: () => Host): any {
function settingsStepUpGate(person: string | null, action: StepUpSettingsAction, detail: Record<string, unknown>, stepUp: unknown, policyPerson?: string | null): { status: number; body: StepUpRefusal } | null {
  const host = getHost();
  const { SETTINGS_ACTION_CLASS } = host;

  const protectedBy = SETTINGS_ACTION_CLASS[action];
  if (!protectedBy) return null;
  if (host.actConfirmedCovers([protectedBy])) return null;
  const required = host.securityKeys.required(person, [protectedBy], policyPerson);
  if (!required.length) return null;
  if (!person) return { status: 403, body: { error: "This change needs the person's security key.", code: "step_up_required", classes: required } };
  return host.settingsStepUp(host.securityKeys, person, action, detail, stepUp, required);

}
  return settingsStepUpGate;
}
