// Shared mutable bag for runGroupMemberTurn phases.
export type GroupMemberTurnCtx = Record<string, any>;
export type GroupPrepareResult =
  | { kind: "return"; value: boolean }
  | { kind: "continue"; ctx: GroupMemberTurnCtx };
