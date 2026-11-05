import type { CoordinatorOptions, Coordinator } from "./runtime/coordinator-types.ts";
export type { HandoffStatus, HandoffView, HandedOutOutcome, RoomAddress, ComposedTurn, LiveHandoffEdge, CoordinatorHost, Coordinator, CoordinatorOptions } from "./runtime/coordinator-types.ts";
// The seam between the server and the coordinator that runs teammate work:
// the job runtime (server/runtime/, docs/runtime-contract.md), reached
// through RuntimeCoordinator. index.ts talks to this interface only; the
// room-handoff tree it replaced is gone, and its node shape survives here
// as the read model (HandoffView) the server's call sites were written
// against. The view goes once those sites read Assignment rows directly.
import { RuntimeCoordinator } from "./runtime-coordinator.ts";

export function createCoordinator(options: CoordinatorOptions): Coordinator {
  return new RuntimeCoordinator(options);
}
