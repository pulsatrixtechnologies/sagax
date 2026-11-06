// @ts-nocheck
/** attachmentVmForTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAttachmentVmForTurn(getHost: () => Host): any {
async function attachmentVmForTurn(capability: InternalCapability) {
  const host = getHost();

  const slot = host.autoVmClaims.get(capability.threadId);
  if (!host.localVmThreadTargets.has(capability.threadId) &&
      !(slot?.localVm && slot.owner.generation === capability.generation)) return undefined;
  const gate = await host.computerCallGate(capability);
  if (gate.held) throw Object.assign(new Error(controlRefusal(gate)), { status: 409 });
  const vm = host.localVmThreadTargets.get(capability.threadId);
  if (!vm || !host.internalCapabilityIsActive({ ...capability, localVmTarget: vm })) {
    throw Object.assign(new Error("This turn no longer owns the Local VM."), { status: 409 });
  }
  return vm;

}
  return attachmentVmForTurn;
}
