// #4410: where a turn lands when the vendor refused a person's Claude account
// under pi (server/drivers/pi-claude-refusal.ts): on the Claude engine, the
// sign-in the account came from, with the same model. One engine, named by
// the data: the first enabled Claude engine of the subscription kind (the
// person's own sign-in is the one pi borrowed), whose model list has the
// pi model's own id (pi names it `anthropic/<id>`). No match, no landing:
// the turn then fails as any other engine refusal does.
export interface LandingEngine { instanceId: string; driverKind: string; enabled?: boolean; models?: { options: ReadonlyArray<{ id: string }> } }

export function claudeLanding(
  engines: readonly LandingEngine[],
  from: { instanceId: string; model: string },
): { instanceId: string; model: string } | null {
  const model = from.model.replace(/^anthropic\//, "");
  if (!model) return null;
  const claude = engines.filter((engine) => engine.driverKind === "claudeAgent" && engine.enabled !== false && engine.instanceId !== from.instanceId);
  const target = claude.find((engine) => engine.models?.options.some((option) => option.id === model));
  return target ? { instanceId: target.instanceId, model } : null;
}
