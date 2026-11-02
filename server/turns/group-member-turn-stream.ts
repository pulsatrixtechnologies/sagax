// @ts-nocheck
// #1388 wave 4 step 3: runGroupMemberTurn phase. Never imports server/index.ts.
import type { GroupMemberTurnHost } from "./group-member-turn-types.ts";
import type { GroupMemberTurnCtx } from "./group-member-turn-ctx.ts";

/** Room post-dispatch stream bookkeeping lives in launch's guardTurnDispatch().then(...). */
export function createStreamGroupMemberTurn(_host: GroupMemberTurnHost) {
  return async function streamGroupMemberTurn(_ctx: GroupMemberTurnCtx): Promise<void> {};
}
