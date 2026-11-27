// The engines the app offers this person, from shared/offered-engines.ts
// (the server's answer too). Every list of providers or models reads it:
// the model menu and window, New bot, a bot's backups and recovery, and
// Settings > Models and voice ("settings": also the engines the
// organization did not give the person, so they can connect their own).
// Solo: every engine, unchanged.
import { useMemo } from "react";
import { useStore, type ConfigStatus, type InstanceInfo } from "@/state/store";
import type { EngineOfferContext } from "../../shared/offered-engines";
import { offeredModels, type ModelSwitches } from "../../shared/offered-models";
import { useMyEngines, usePerspicaxOrg, type MyEngine } from "@/lib/perspicax-org";

/** The offer context for this viewer: an organization server once its
 * card has loaded (usePerspicaxOrg); the server already leaves out what
 * the organization does not allow before that. */
export function engineOfferContext(config: ConfigStatus | null | undefined, organization: boolean, mine: readonly MyEngine[] | null): EngineOfferContext {
  return { organization, allowedEngines: config?.allowedEngines ?? null, ownAccountsOutsideList: config?.ownAccountsOutsideList === true, mine, hiddenEngines: config?.hiddenEngines ?? null };
}

/** 2026-10-30 (lot 2): the models turned off, by the organization and by the person. */
export function modelSwitches(config: ConfigStatus | null | undefined): ModelSwitches {
  return { org: config?.disabledModels ?? null, mine: config?.myDisabledModels ?? null };
}

/** `state.instances` as offered to this person: the engines, then on each
 * only the models still on ("pick"; "settings" keeps every model). A
 * provider the organization hid is left out unless `keep` names it (the
 * engine a bot is already on, D-20261126-018). */
export function useOfferedInstances(purpose: "pick" | "settings" = "pick", keep?: string | readonly string[]): InstanceInfo[] {
  const { state } = useStore();
  const org = usePerspicaxOrg();
  const mine = useMyEngines();
  const context = engineOfferContext(state.config, org !== null, mine);
  const disabledOrg = state.config?.disabledModels;
  const disabledMine = state.config?.myDisabledModels;
  return useMemo(
    () => offeredModels(state.instances, context, { org: disabledOrg, mine: disabledMine }, purpose, keep),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.instances, context.organization, context.allowedEngines, context.ownAccountsOutsideList, context.hiddenEngines, mine, purpose, disabledOrg, disabledMine, keep],
  );
}
