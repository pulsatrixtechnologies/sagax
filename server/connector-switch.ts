// A request that needs a mail, calendar, Teams or SharePoint connector the
// bot's engine lacks runs, for that request only, on another engine of the
// same person that has it (JC 2026-10-21, review of #943): same bot, same
// thread, one line "Passé à Claude pour Gmail". The candidates are the
// engines this turn's payer may use (index.ts autoEnginesFor: allowed
// engines and models, approval level), never a model that costs more than
// the bot's own (catalogue prices), and each engine's reach counts only on
// the person's own sign-in and only when it is known (harness-connectors.ts
// accountConnectorsForTurn; a cold inventory is unknown, Grok's connected
// connectors are never known to Sagax). The switch reads only the person's
// own message, never the context composed around it. Approval cards are
// unchanged. Pure: the server passes the facts.
import { claudeAiConnectorCapabilities, type ConnectorCapability, GROK_CONNECTOR_CAPABILITY_BY_NAME } from "../shared/engine-connectors.ts";
import { effortAcceptedByEngine } from "../shared/ultracode-effort.ts";
import type { EffortLevel } from "../shared/wire.ts";

export interface SwitchEngine {
  instanceId: string;
  engineLabel: string;
  /** Its models, with their catalogue price when known (input + output). */
  models: ReadonlyArray<{ id: string; price?: number }>;
  defaultModel?: string;
  effortLevels?: readonly EffortLevel[];
  /** The connectors this engine reaches for this person, by name; null
   * when that is not known (never a reason to switch, either way). */
  reach: ReadonlyArray<{ connector: string }> | null;
}

export interface ConnectorSwitch {
  instanceId: string;
  model: string;
  effort?: EffortLevel;
  engineLabel: string;
  connector: string;
}

/** What a connector reaches, from its name (claude.ai or Grok catalog). */
function capabilitiesOf(connector: string): ConnectorCapability[] {
  return GROK_CONNECTOR_CAPABILITY_BY_NAME.get(connector) ?? claudeAiConnectorCapabilities(connector);
}

/** The services a named one is served by: Microsoft 365 answers Outlook,
 * Teams, SharePoint and OneDrive; Gmail only Gmail. */
const HINT_SERVED_BY: Record<string, RegExp> = {
  Gmail: /gmail/i,
  Outlook: /outlook|exchange|microsoft\s*365/i,
  Teams: /teams|microsoft\s*365/i,
  SharePoint: /sharepoint|microsoft\s*365/i,
  OneDrive: /onedrive|microsoft\s*365/i,
  "Google Calendar": /google\s*calendar/i,
};

function reaches(engine: SwitchEngine, need: { capability: ConnectorCapability; hint?: string }): string | undefined {
  const served = need.hint ? HINT_SERVED_BY[need.hint] : undefined;
  return engine.reach?.find(({ connector }) => capabilitiesOf(connector).includes(need.capability) && (!served || served.test(connector)))?.connector;
}

/** The model to run on: never one that costs more than the bot's own.
 * With the bot's price known: the engine's default when it fits, else the
 * dearest one at or under it. With no price known on either side: the
 * engine's default. Otherwise none (cost cannot be shown to stay put). */
function affordableModel(engine: SwitchEngine, base: { price?: number }): string | undefined {
  const listed = (id: string | undefined) => engine.models.find((model) => model.id === id);
  const fallback = listed(engine.defaultModel) ?? engine.models[0];
  if (!fallback) return undefined;
  const priced = engine.models.filter((model) => model.price !== undefined);
  if (base.price === undefined) return priced.length ? undefined : fallback.id;
  if (!priced.length) return undefined;
  if (fallback.price !== undefined && fallback.price <= base.price) return fallback.id;
  return priced.filter((model) => model.price! <= base.price!).toSorted((a, b) => b.price! - a.price!)[0]?.id;
}

export function pickConnectorSwitch(input: {
  need: { capability: ConnectorCapability; hint?: string } | null;
  current: SwitchEngine;
  /** The bot's own model this turn would have run: its price and effort. */
  base: { model: string; price?: number; effort?: EffortLevel };
  candidates: readonly SwitchEngine[];
}): ConnectorSwitch | null {
  const { need } = input;
  if (!need || input.current.reach === null || reaches(input.current, need)) return null;
  for (const engine of input.candidates) {
    if (engine.instanceId === input.current.instanceId) continue;
    const connector = reaches(engine, need);
    if (!connector) continue;
    const model = affordableModel(engine, input.base);
    if (!model) continue;
    const effort = input.base.effort && engine.effortLevels && effortAcceptedByEngine(input.base.effort, engine.effortLevels) ? input.base.effort : undefined;
    return { instanceId: engine.instanceId, model, ...(effort ? { effort } : {}), engineLabel: engine.engineLabel, connector };
  }
  return null;
}

/** The English line, for clients that do not draw `tool.connectorSwitch`. */
export function connectorSwitchText(line: { engine: string; connector: string }): string {
  return `Switched to ${line.engine} for ${line.connector}.`;
}
