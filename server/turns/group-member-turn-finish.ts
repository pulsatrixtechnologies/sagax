// @ts-nocheck
// #1388 wave 4 step 3: finish phase for runGroupMemberTurn.
// Catch/finally stay inside launch so try-locals stay in scope (behavior-preserving).
import type { GroupMemberTurnHost } from "./group-member-turn-types.ts";
import type { GroupMemberTurnCtx } from "./group-member-turn-ctx.ts";

export function createFinishGroupMemberTurn(_host: GroupMemberTurnHost) {
  return {
    finishCatch: async (_ctx: GroupMemberTurnCtx, error: any): Promise<boolean> => { throw error; },
    finishFinally: async (_ctx: GroupMemberTurnCtx): Promise<void> => {},
  };
}
