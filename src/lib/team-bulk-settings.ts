// "Set for all bots in this team…": one approval level, or one model and
// effort, applied to every bot in a sidebar team. There is no bulk route on
// the server on purpose. Each bot goes through exactly the request its own
// settings panel sends (persistBotUpdate: PATCH /api/bots/:id, or the
// desktop's private approval channel where that panel uses it), one bot at a
// time, so every per-bot check — owner scope, busy bots, provider support,
// Custom leaving only through the desktop, the local-computer Auto consent —
// still applies and still has the last word. This module only decides, before
// anything is sent, which bots would be refused anyway and why, so the
// summary can say so instead of failing them one by one.
//
// Two scopes differ from a bot's own panel, because the person chose them
// for the team rather than for the thread they have open. A level reaches
// every thread of every bot, the same way for every level
// (applyToAllThreads). A model moves the threads that follow each bot and
// leaves a thread's own model alone, the selected thread included
// (keepThreadModels): the panel instead moves the selected thread with it.
import { t } from "@/lib/i18n";
import { threadApprovalModes, type Bot, type InstanceInfo } from "@/state/store";
import type { BotUpdatePatch } from "@/state/bot-patch-queue";
import { approvalModeFor, supportsApprovalMode, type ApprovalMode } from "../../shared/approval-mode";
import type { EffortLevel, ModelSelection } from "../../shared/wire";

/** The levels a whole team may be moved to. Custom is per bot: its rules
 * belong to one Codex bot's tool semantics, and it can only be granted
 * through the packaged desktop's confirmation for that one bot. */
// Full access is granted per bot, with its own warning and consent, never team-wide.
export const TEAM_APPROVAL_MODES = ["ask", "edits", "auto"] as const satisfies readonly ApprovalMode[];
export type TeamApprovalMode = (typeof TEAM_APPROVAL_MODES)[number];

export type TeamChange =
  | { kind: "approval"; mode: TeamApprovalMode }
  /** `model` undefined keeps each bot's model; `effort` undefined keeps each
   * bot's effort and null clears it (the engine decides). */
  | { kind: "model"; model?: string; effort?: EffortLevel | null };

export type TeamPlanRow =
  | { bot: Bot; status: "apply"; patch: BotUpdatePatch }
  | { bot: Bot; status: "unchanged" }
  | { bot: Bot; status: "skip"; reason: string };

export type TeamResultRow =
  | { bot: Bot; status: "applied" }
  | { bot: Bot; status: "unchanged" }
  | { bot: Bot; status: "skipped"; reason: string };

/** The bots a sidebar team holds, as the sidebar files them: General is "". */
export function teamBots(bots: readonly Bot[], team: string): Bot[] {
  const name = team.trim();
  return bots.filter((bot) => !bot.hidden && (bot.section?.trim() || "") === name);
}

const engineOf = (bot: Bot, instances: readonly InstanceInfo[]) =>
  instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId);

/** Whether this engine's own picker offers the level (approvalModeOptionsFor):
 * Antigravity's explicit grant replaces Auto there, so Auto is not offered. */
export function teamModeOffered(driverKind: string | undefined, mode: TeamApprovalMode): boolean {
  return supportsApprovalMode(driverKind, mode) && !(driverKind === "antigravityAgent" && mode === "auto");
}

/** Every model any of these bots' engines offers, each once, with the
 * engines that offer it (for the picker's hint). */
export function teamModelChoices(bots: readonly Bot[], instances: readonly InstanceInfo[]): Array<{ id: string; label: string; engines: string[] }> {
  const choices = new Map<string, { id: string; label: string; engines: string[] }>();
  const seen = new Set<string>();
  for (const bot of bots) {
    const engine = engineOf(bot, instances);
    if (!engine || seen.has(engine.instanceId)) continue;
    seen.add(engine.instanceId);
    const ids = [engine.models.default, ...engine.models.options.map((option) => option.id)].filter((id) => id.trim());
    for (const id of new Set(ids)) {
      const label = engine.models.options.find((option) => option.id === id)?.label ?? id;
      const entry = choices.get(id) ?? { id, label, engines: [] };
      if (!entry.engines.includes(engine.displayName)) entry.engines.push(engine.displayName);
      choices.set(id, entry);
    }
  }
  return [...choices.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Every effort level any of these bots' engines offers, in the canonical order. */
export function teamEffortChoices(bots: readonly Bot[], instances: readonly InstanceInfo[], order: readonly EffortLevel[]): EffortLevel[] {
  const offered = new Set<EffortLevel>();
  for (const bot of bots) {
    const engine = engineOf(bot, instances);
    if (engine?.capabilities?.modelVariants) continue;
    for (const level of engine?.capabilities?.effortLevels ?? []) offered.add(level);
  }
  return order.filter((level) => offered.has(level));
}

/** What each bot would get, before anything is sent. Mirrors the server's
 * refusals so the summary can name them; the server still re-checks. */
export function planTeamChange(bots: readonly Bot[], instances: readonly InstanceInfo[], change: TeamChange): TeamPlanRow[] {
  return bots.map((bot): TeamPlanRow => {
    const engine = engineOf(bot, instances);
    const engineName = engine?.displayName ?? bot.modelSelection.instanceId;
    if (change.kind === "approval") {
      // Already set only when the bot and every one of its threads are.
      if ([approvalModeFor(bot), ...threadApprovalModes(bot)].every((mode) => mode === change.mode)) return { bot, status: "unchanged" };
      if (bot.busy || bot.tasks?.some((task) => task.busy)) return { bot, status: "skip", reason: t("teamSettings.skip.busy") };
      if (!teamModeOffered(engine?.driverKind, change.mode)) {
        return { bot, status: "skip", reason: t("teamSettings.skip.modeUnsupported", { engine: engineName }) };
      }
      return { bot, status: "apply", patch: { approvalMode: change.mode, applyToAllThreads: true } };
    }
    const current = bot.modelSelection;
    if (!engine) return { bot, status: "skip", reason: t("teamSettings.skip.engineMissing") };
    const model = change.model ?? current.model;
    const offered = model === engine.models.default || engine.models.options.some((option) => option.id === model);
    if (!offered) return { bot, status: "skip", reason: t("teamSettings.skip.modelUnsupported", { engine: engineName, model }) };
    const next: ModelSelection = { instanceId: current.instanceId, model };
    // A variant belongs to its model: a different model starts without one.
    if (current.variant && model === current.model) next.variant = current.variant;
    if (change.effort === undefined) {
      if (current.effort) next.effort = current.effort;
    } else if (change.effort !== null) {
      if (engine.capabilities?.modelVariants) {
        return { bot, status: "skip", reason: t("teamSettings.skip.variantsOnly", { engine: engineName }) };
      }
      if (!(engine.capabilities?.effortLevels ?? []).includes(change.effort)) {
        return { bot, status: "skip", reason: t("teamSettings.skip.effortUnsupported", { engine: engineName }) };
      }
      next.effort = change.effort;
      delete next.variant;
    }
    if (next.model === current.model && next.effort === current.effort && next.variant === current.variant) {
      return { bot, status: "unchanged" };
    }
    if (bot.busy) return { bot, status: "skip", reason: t("teamSettings.skip.busy") };
    return { bot, status: "apply", patch: { modelSelection: next, keepThreadModels: true } };
  });
}

/** Whether applying this plan needs the local-computer Auto consent first:
 * the same warning the bot's own panel shows before Auto on this computer. */
export function planNeedsLocalAutoConsent(plan: readonly TeamPlanRow[]): boolean {
  return plan.some((row) => row.status === "apply" && row.patch.approvalMode === "auto" && row.bot.computer === "local");
}

/** Send the planned changes one bot at a time through `persist` (the bot
 * panel's own request), never in parallel: a refusal on one bot must not
 * race the next, and the order of the summary is the order of the team. */
export async function applyTeamPlan(
  plan: readonly TeamPlanRow[],
  persist: (bot: Bot, patch: BotUpdatePatch) => Promise<unknown>,
  options: { acknowledgeLocalAuto?: boolean; onProgress?: (done: number) => void } = {},
): Promise<TeamResultRow[]> {
  const results: TeamResultRow[] = [];
  for (const row of plan) {
    if (row.status === "unchanged") results.push({ bot: row.bot, status: "unchanged" });
    else if (row.status === "skip") results.push({ bot: row.bot, status: "skipped", reason: row.reason });
    else {
      const patch = options.acknowledgeLocalAuto && row.patch.approvalMode === "auto" && row.bot.computer === "local"
        ? { ...row.patch, acknowledgeLocalAuto: true } : row.patch;
      try {
        await persist(row.bot, patch);
        results.push({ bot: row.bot, status: "applied" });
      } catch (cause) {
        results.push({ bot: row.bot, status: "skipped", reason: cause instanceof Error ? cause.message : String(cause) });
      }
    }
    options.onProgress?.(results.length);
  }
  return results;
}

export function teamResultCounts(results: readonly TeamResultRow[]): { applied: number; unchanged: number; skipped: number } {
  return {
    applied: results.filter((row) => row.status === "applied").length,
    unchanged: results.filter((row) => row.status === "unchanged").length,
    skipped: results.filter((row) => row.status === "skipped").length,
  };
}
