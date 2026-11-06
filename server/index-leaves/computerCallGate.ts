// @ts-nocheck
/** computerCallGate (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createComputerCallGate(getHost: () => Host): any {
async function computerCallGate(internalCapability: InternalCapability, signal?: AbortSignal) {
  const host = getHost();

  const { botId, threadId, generation } = internalCapability;
  const askedAt = Date.now();
  const deadline = askedAt + host.COMPUTER_CALL_WAIT_MS;
  let personHeld = false;
  for (;;) {
    const snapshot = host.botComputerControlSnapshot(botId, internalCapability.teamComputerId);
    const helpOpen = snapshot.helpReason !== null;
    const slot = host.autoVmClaims.get(threadId);
    const lazyClaim = slot && slot.owner.generation === generation ? slot : undefined;
    let held: ControlState;
    if (snapshot.held && snapshot.heldSinceMs !== null && Date.now() - snapshot.heldSinceMs >= host.COMPUTER_WAIT_MAX_MS) {
      return { held: true, helpOpen, blockedReason: computerPersonAwayText(host.COMPUTER_WAIT_MAX_MS) };
    } else if (snapshot.held) {
      personHeld = true;
      held = { held: true, helpOpen, reason: "person" };
    } else if (lazyClaim?.failed) {
      // A rejected lazy claim (gate finding F1, issue #1361): the computer
      // MCP mounted at dispatch is still live, and the claim may even have
      // left a turn-computer entry behind (it can reject after
      // bindTurnComputer succeeded — lease lost to a person, lifecycle busy,
      // boot failure). Either way this turn owns no usable desktop, so keep
      // refusing every screen call for the rest of the generation; the
      // bridge must never forward one onto a desktop this turn never
      // claimed. Turn settle GC clears the slot. Say why, and say not to
      // retry: there is nothing left to wait for.
      return {
        held: true, helpOpen: false,
        blockedReason: `This turn could not claim ${lazyClaim.label ?? "this computer"}${lazyClaim.failure ? ` (${lazyClaim.failure})` : ""}. This call was not performed. Do not retry computer work in this turn; tell the person what you could not do.`
      };
    } else if (lazyClaim?.lazy && !lazyClaim.claimed) {
      host.startAutoVmClaim(host.autoVmClaims, threadId, generation);
      if (lazyClaim.begin && Date.now() < deadline && !signal?.aborted) {
        await host.settledWithinOrStop(lazyClaim.begin, deadline - Date.now(), signal);
        // Landed or failed: read everything again, a person included.
        if (lazyClaim.claimed || lazyClaim.failed) continue;
      }
      held = { held: true, helpOpen: false, blockedReason: lazyClaim.pendingReason ?? CONTROL_BUSY };
    } else {
      const computer = host.turnComputerResources.get(threadId);
      if (computer && computer.owner.generation === generation && !host.claimTurnResource(computer.owner, computer.resource)) {
        held = { held: true, helpOpen: false, blockedReason: CONTROL_BUSY };
      } else if (!host.internalCapabilityIsActive(internalCapability)) {
        // The turn ended or switched computers while this call waited, and
        // settling it cleared the slot and seat this pass found free: a
        // call from a turn that is over never reaches the screen.
        return { held: true, helpOpen, blockedReason: "This turn no longer has this computer, so this call was not performed." };
      } else if (personHeld) {
        return { held: true, helpOpen, blockedReason: CONTROL_HANDED_BACK };
      } else {
        return Date.now() - askedAt > host.COMPUTER_CALL_ACT_WITHIN_MS ? { held: true, helpOpen, blockedReason: CONTROL_WAITED } : { held: false, helpOpen };
      }
    }
    if (Date.now() >= deadline || signal?.aborted || !host.internalCapabilityIsActive(internalCapability)) return held;
    await host.settledWithinOrStop(null, Math.min(host.COMPUTER_CALL_POLL_MS, deadline - Date.now()), signal);
  }

}
  return computerCallGate;
}
