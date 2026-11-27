// @ts-nocheck
/** One place that builds the `current` of a model change: the conversation's
 * selection, whether it is busy, and the engines it (or its bot) is already
 * on. A hidden provider among those is no new choice (D-20261126-018, #5351).
 * Used by the three model-change routes and by checkedTaskModelSwitch. */
export type Host = Record<string, any>;

export type ModelChangeCurrent = {
  selection: ModelSelection;
  busy: boolean;
  alsoOn: string[];
};

/** `returning` / `target`: the engine a limit failover goes back to. */
export function modelChangeCurrent(
  host: Host,
  current: { id: string; threadId: string; modelSelection: ModelSelection },
  options: { busy?: boolean; alsoOn?: readonly string[]; returning?: boolean; target?: string } = {},
): ModelChangeCurrent {
  const profileEngine = host.store.bot(current.id)?.modelSelection.instanceId;
  const target = options.returning && typeof options.target === "string" ? options.target.trim() : "";
  return {
    selection: current.modelSelection,
    busy: options.busy ?? host.threadBusy(current.id, current.threadId),
    alsoOn: [profileEngine, ...(options.alsoOn ?? []), ...(target ? [target] : [])].filter(Boolean),
  };
}
