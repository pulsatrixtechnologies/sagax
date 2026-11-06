// #2106: at turn time, remap a bot's model onto the subscription account
// that can run it (credits, managed MCP plugins). Pure over the facts the
// host passes; shared/model-account-pool.ts does the ranking.
import type { ModelSelection } from "../../shared/model-selection.ts";
import {
  pickAccountForModel,
  type AccountCreditState,
  type PoolAccount,
} from "../../shared/model-account-pool.ts";

export type { AccountCreditState, PoolAccount };

/** Sibling subscription accounts that offer the same models as the pick. */
export interface ResolveModelAccountInput {
  selection: ModelSelection;
  accounts: readonly PoolAccount[];
  /** Plugin ids the turn needs from a managed MCP account. */
  neededPlugins?: readonly string[];
  /** Instance ids already refused for this turn (rate limit / credits). */
  skip?: readonly string[];
}

/**
 * When several accounts of one provider offer the picked model, choose which
 * one runs the turn. Leaves API-key engines and single-account picks alone.
 * Returns the same selection object when nothing changes.
 */
export function resolveModelAccount(input: ResolveModelAccountInput): ModelSelection {
  const { selection, accounts } = input;
  if (accounts.length <= 1) return selection;
  const picked = pickAccountForModel({
    model: selection.model,
    accounts,
    preferredInstanceId: selection.instanceId,
    neededPlugins: input.neededPlugins,
    skip: input.skip,
  });
  if (!picked || picked === selection.instanceId) return selection;
  return { ...selection, instanceId: picked };
}

/** After a credit or rate-limit refusal, the next sibling account for the
 * same model, or null when the pool is spent. */
export function nextAccountAfterFailure(input: ResolveModelAccountInput & {
  failedInstanceId: string;
}): ModelSelection | null {
  const skip = [...(input.skip ?? []), input.failedInstanceId];
  const next = resolveModelAccount({ ...input, skip });
  if (next.instanceId === input.selection.instanceId || next.instanceId === input.failedInstanceId) return null;
  if (skip.includes(next.instanceId)) return null;
  return next;
}
