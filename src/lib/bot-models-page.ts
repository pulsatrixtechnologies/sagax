// Settings > Models > Bot models (#1675): the person's own bots, grouped by
// sidebar section, with one place to change models without a model turn.
// Pure helpers only: the page mounts them; the server still enforces ownership
// and allowed engines on each PATCH.
import { viewerOwnsBot } from "@/lib/bot-capabilities";
import { orgEngineState, type OrgEngineState } from "@/lib/model-payers";
import type { MyEngine } from "@/lib/perspicax-org";
import { withPersonalSections, type PersonalSections } from "@/lib/personal-sections";
import type { Bot, ConfigStatus, InstanceInfo, ModelSelection } from "@/state/store";

/** A bot row the page can edit: owned, visible, not a machine host. */
export type BotModelsRow = Pick<Bot, "id" | "name" | "section" | "hidden" | "ownerUserId" | "modelSelection" | "fallback" | "turnPayer" | "turnPayerDefault" | "threadId" | "busy" | "host">;

export type BotModelWarningKind = "signedOut" | "expired" | "notResponding" | "noAccess";

export interface BotModelsSectionGroup {
  /** Sidebar section name, or "" for Unassigned. */
  section: string;
  bots: BotModelsRow[];
}

export interface BulkModelSummaryLine {
  botId: string;
  name: string;
  from: string;
  to: string;
}

/** Own bots only: no admin overview of other people's bots. */
export function ownBotsForModelsPage(
  bots: readonly BotModelsRow[],
  config: ConfigStatus | null | undefined,
): BotModelsRow[] {
  return bots.filter((bot) => {
    if (bot.hidden) return false;
    if (bot.host?.kind === "machine") return false;
    return viewerOwnsBot(config, bot);
  });
}

/** Apply the person's sidebar sections when present (organization server). */
export function botsWithSidebarSections(
  bots: readonly BotModelsRow[],
  personal: PersonalSections | null,
): BotModelsRow[] {
  if (!personal) return bots.map((bot) => ({ ...bot }));
  return withPersonalSections(bots, [], personal).bots;
}

/** Group by sidebar section; Unassigned first, then sections in first-seen order. */
export function groupBotsBySidebarSection(bots: readonly BotModelsRow[]): BotModelsSectionGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, BotModelsRow[]>();
  for (const bot of bots) {
    const section = bot.section?.trim() ?? "";
    if (!buckets.has(section)) {
      buckets.set(section, []);
      order.push(section);
    }
    buckets.get(section)!.push(bot);
  }
  const unassigned = order.filter((name) => name === "");
  const named = order.filter((name) => name !== "");
  return [...unassigned, ...named].map((section) => ({
    section,
    bots: buckets.get(section) ?? [],
  }));
}

function modelLabel(instance: InstanceInfo | undefined, model: string): string {
  return instance?.models.options.find((option) => option.id === model)?.label ?? model;
}

/** One line for the table and for the bulk confirmation. */
export function formatBotModelSelection(
  selection: ModelSelection,
  instances: readonly InstanceInfo[],
): string {
  if (selection.auto === true) {
    const engine = instances.find((candidate) => candidate.instanceId === selection.instanceId);
    const last = selection.model
      ? [engine?.displayName, modelLabel(engine, selection.model)].filter(Boolean).join(" · ")
      : "";
    return last ? `Auto (${last})` : "Auto";
  }
  const engine = instances.find((candidate) => candidate.instanceId === selection.instanceId);
  return [engine?.displayName ?? selection.instanceId, modelLabel(engine, selection.model)]
    .filter(Boolean)
    .join(" · ");
}

export function formatBotBackups(
  fallback: BotModelsRow["fallback"],
  instances: readonly InstanceInfo[],
): string {
  if (!fallback?.length) return "";
  return fallback
    .map((entry) => {
      const engine = instances.find((candidate) => candidate.instanceId === entry.instanceId);
      return [engine?.displayName ?? entry.instanceId, modelLabel(engine, entry.model)]
        .filter(Boolean)
        .join(" · ");
    })
    .join(", ");
}

/** Warning for the bot's current engine: signed out, expired, or not usable. */
export function botModelWarning(
  bot: Pick<BotModelsRow, "modelSelection">,
  instances: readonly InstanceInfo[],
  options?: {
    orgMode?: boolean;
    myEngines?: readonly MyEngine[] | null;
  },
): BotModelWarningKind | null {
  const instance = instances.find((candidate) => candidate.instanceId === bot.modelSelection.instanceId);
  if (!instance) return "notResponding";
  if (options?.orgMode) {
    const engine = options.myEngines?.find((candidate) => candidate.instanceId === instance.instanceId);
    if (engine) {
      if (engine.subscription.expired === true || engine.myTurns === "expired") return "expired";
      const state: OrgEngineState = orgEngineState(engine);
      if (state === "signInRequired") return "signedOut";
      if (state === "noAccess" || state === "notInstalled" || state === "notAvailable") return "noAccess";
    }
  } else if (instance.snapshot.state === "available" && instance.snapshot.authenticated === false) {
    return "signedOut";
  }
  if (instance.snapshot.state !== "available" || instance.policy) return "notResponding";
  return null;
}

/** Confirmation lines before a bulk model write. */
export function bulkModelChangeSummary(
  bots: readonly BotModelsRow[],
  selection: ModelSelection,
  instances: readonly InstanceInfo[],
): BulkModelSummaryLine[] {
  const to = formatBotModelSelection(selection, instances);
  return bots.map((bot) => ({
    botId: bot.id,
    name: bot.name,
    from: formatBotModelSelection(bot.modelSelection, instances),
    to,
  }));
}

/** Toggle one id in a selection set. */
export function toggleBotSelection(selected: ReadonlySet<string>, botId: string): Set<string> {
  const next = new Set(selected);
  if (next.has(botId)) next.delete(botId);
  else next.add(botId);
  return next;
}

/** Select or clear every bot in a section. */
export function setSectionSelection(
  selected: ReadonlySet<string>,
  botIds: readonly string[],
  on: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const id of botIds) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}
