// Which models can run a turn right now (2026-10-14: "check in the
// background that the model is set up and works, pick one that works, hide
// the ones that do not").
//
// No new probe: the answer comes from what the server already checks and
// keeps, `/api/instances` (the engine installed and started, its sign-in or
// saved API key; the startup probes that #460 runs two at a time), and on
// an organization server from the person's engines (`/api/me/engines`: what
// pays for their turns). Nothing here sends a billed request. The store
// refreshes that list on focus and on Check again; `refreshModelHealth`
// asks for it at most once per HEALTH_TTL_MS so a form that opens and
// closes never adds a burst of probes.
//
// A model is usable when its engine is installed and not blocked by a
// policy, something pays for its turns (signed in, a valid key, or on an
// organization server a connected engine), and, for a local model, the
// engine can run it. A signed-out engine keeps its local models.
import { isModelServerOption } from "../../shared/model-server-option";
import { orgEngineState } from "@/lib/model-payers";
import type { MyEngine } from "@/lib/perspicax-org";
import { localModelRows, localRowUnavailable } from "@/lib/local-models";
import type { InstanceInfo, ModelSelection } from "@/state/store";

type Option = InstanceInfo["models"]["options"][number];

export interface HealthContext {
  /** An organization server: the person's own engines decide what pays. */
  orgMode: boolean;
  /** The person's engines (organization server); null while loading. */
  myEngines?: readonly MyEngine[] | null;
}

/** The engine runs turns: installed, allowed, and (organization) paid for.
 * Signed in or not is per model (a local model needs no sign-in). */
export function engineRuns(instance: InstanceInfo, context: HealthContext): boolean {
  if (instance.policy || instance.snapshot.state !== "available") return false;
  if (!context.orgMode) return true;
  const engine = context.myEngines?.find((candidate) => candidate.instanceId === instance.instanceId);
  // engines not loaded yet, or an engine the person's list does not carry:
  // the server's own answer stands
  return !engine || orgEngineState(engine) === "connected";
}

function isLocalOption(option: Option, orgMode: boolean, localIds: ReadonlySet<string>): boolean {
  return localIds.has(option.id) || Boolean(option.custom && option.id.includes("::") && !orgMode);
}

/** Whether this model of this engine can run a turn now. */
export function modelUsable(instance: InstanceInfo, modelId: string, context: HealthContext): boolean {
  if (!engineRuns(instance, context)) return false;
  const option = instance.models.options.find((candidate) => candidate.id === modelId);
  if (!option) return false;
  const localRows = localModelRows(instance.models.options, context.orgMode);
  const localIds = new Set(localRows.map((row) => row.id));
  // #2963: a Perspicax model server's model (pi) runs with that server's
  // key, resolved per turn: no sign-in, never a model typed on this machine
  if (isModelServerOption(option)) return true;
  // #3085: a pi model the payer's key (or the organization's) pays for
  if (option.keyPaid === true) return true;
  // an organization server never offers its own custom models
  if (context.orgMode && option.custom && !localIds.has(option.id) && instance.access !== "api") return false;
  if (isLocalOption(option, context.orgMode, localIds)) {
    return !localIds.has(option.id) || localRowUnavailable(instance.driverKind, option.id, option.anthropic) === null;
  }
  // a cloud model needs a sign-in or a key (an organization's connected
  // engine pays with the person's or the organization's credentials)
  return context.orgMode || instance.snapshot.authenticated !== false;
}

/** Every usable model, engines in the server's order, each engine's
 * default first. */
export function usableModels(instances: readonly InstanceInfo[], context: HealthContext): Array<{ instance: InstanceInfo; modelId: string }> {
  return instances.flatMap((instance) => {
    const ids = instance.models.options.map((option) => option.id);
    const ordered = [instance.models.default, ...ids.filter((id) => id !== instance.models.default)];
    return ordered.filter((id) => modelUsable(instance, id, context)).map((modelId) => ({ instance, modelId }));
  });
}

export type StartingModel =
  | { kind: "default"; selection: ModelSelection }
  | { kind: "auto"; selection: ModelSelection }
  | { kind: "first"; selection: ModelSelection }
  | { kind: "none"; selection: ModelSelection };

/**
 * The model a new bot starts on: the configured default when it works,
 * else Auto when at least one model works (and Auto is offered), else the
 * first model that works. None working keeps the default and says so.
 */
export function startingModel(configured: ModelSelection, instances: readonly InstanceInfo[], context: HealthContext & { autoOffered?: boolean }): StartingModel {
  const own = instances.find((instance) => instance.instanceId === configured.instanceId);
  const usable = usableModels(instances, context);
  if (own && modelUsable(own, configured.model, context)) return { kind: "default", selection: configured };
  if (usable.length === 0) return { kind: "none", selection: configured };
  const first = usable[0]!;
  const base = { instanceId: first.instance.instanceId, model: first.modelId };
  if (context.autoOffered !== false) return { kind: "auto", selection: { ...base, auto: true } };
  return { kind: "first", selection: base };
}

/** How long the engines' state counts as fresh for a background check. */
export const HEALTH_TTL_MS = 60_000;
let lastHealthCheck = 0;

/** Asks the store for the engines' state again unless it was asked within
 * HEALTH_TTL_MS. The store shares one request among callers. */
export function refreshModelHealth(refresh: () => Promise<void>, now: number = Date.now()): Promise<void> | null {
  if (now - lastHealthCheck < HEALTH_TTL_MS) return null;
  lastHealthCheck = now;
  return refresh().catch(() => {});
}

/** Tests only: forget the last check. */
export function resetModelHealthClock(): void {
  lastHealthCheck = 0;
}
