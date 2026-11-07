// I2: a team's model and computer, inherited by its bots.
//
// The team default lives beside the team instructions
// (rooms/section-context.ts). A bot carries the value it runs with, so every
// existing path (turns, routines, the settings screen) keeps reading
// bot.modelSelection and bot.computer. What this module decides is which
// bots follow the team: a bot that set its own model or computer records
// that setting in teamOverrides and keeps it when the team changes.
// Never imports server/index.ts.
import type { ModelSelection } from "../../shared/model-selection.ts";
import type { TeamComputer, TeamDefaultsRecord } from "../rooms/section-context.ts";

export type TeamSetting = "model" | "computer";
export const TEAM_SETTINGS: readonly TeamSetting[] = ["model", "computer"];

const FIELD: Record<TeamSetting, "modelSelection" | "computer"> = {
  model: "modelSelection",
  computer: "computer",
};

export interface TeamPatchInput {
  bot: { section?: string; teamOverrides?: TeamSetting[] } | undefined;
  /** The PATCH body. teamApply and teamInherit are removed from it, and team
   * values are written into it before the usual validation runs. */
  body: Record<string, unknown>;
  defaultsFor(section: string): TeamDefaultsRecord | null;
  sectionKey(section: string | null | undefined): string;
}

export type TeamPatchResult =
  | { ok: true; teamOverrides?: TeamSetting[] }
  | { ok: false; error: string };

function teamValue(defaults: TeamDefaultsRecord | null, setting: TeamSetting): ModelSelection | TeamComputer | undefined {
  if (!defaults) return undefined;
  return setting === "model" ? defaults.model : defaults.computer;
}

function sameSettings(a: readonly TeamSetting[] | undefined, b: readonly TeamSetting[]): boolean {
  const left = [...(a ?? [])].sort();
  return left.length === b.length && left.every((value, index) => value === b[index]);
}

/**
 * Decides one bot PATCH against its team.
 * - `teamApply: true`: the change comes from the team settings; the bot keeps
 *   following the team.
 * - `teamInherit: ["model" | "computer"]`: the bot drops its own setting and
 *   takes the team's again.
 * - A model or computer sent otherwise, on a bot in a team, is the bot's own.
 * - Moving to another team takes that team's settings, except what the same
 *   request sets.
 * `teamOverrides` is returned only when it changes.
 */
export function teamPatchPlan(input: TeamPatchInput): TeamPatchResult {
  const { bot, body, defaultsFor, sectionKey } = input;
  const teamApply = body.teamApply;
  const inheritRaw = body.teamInherit;
  delete body.teamApply;
  delete body.teamInherit;
  if (teamApply !== undefined && typeof teamApply !== "boolean") return { ok: false, error: "teamApply must be a boolean" };
  if (inheritRaw !== undefined && (!Array.isArray(inheritRaw) || inheritRaw.some((value) => !TEAM_SETTINGS.includes(value as TeamSetting)))) {
    return { ok: false, error: "teamInherit must list model or computer" };
  }
  if (!bot) return { ok: true };
  const inherit = new Set((inheritRaw ?? []) as TeamSetting[]);
  const sectionSent = Object.hasOwn(body, "section");
  const nextSection = sectionSent
    ? (typeof body.section === "string" ? sectionKey(body.section) : "")
    : sectionKey(bot.section);
  const joining = sectionSent && nextSection !== sectionKey(bot.section);
  const overrides = new Set<TeamSetting>(joining ? [] : bot.teamOverrides ?? []);
  const defaults = nextSection ? defaultsFor(nextSection) : null;
  for (const setting of TEAM_SETTINGS) {
    const field = FIELD[setting];
    const value = teamValue(defaults, setting);
    if (inherit.has(setting)) {
      overrides.delete(setting);
      // The team dialog sends the value it planned for this bot (same
      // engine); a bare inherit takes the team's.
      if (value !== undefined && !Object.hasOwn(body, field)) body[field] = value;
    } else if (Object.hasOwn(body, field)) {
      if (teamApply === true) overrides.delete(setting);
      else if (nextSection) overrides.add(setting);
    } else if (joining && value !== undefined) {
      body[field] = value;
    }
  }
  const next = nextSection ? TEAM_SETTINGS.filter((setting) => overrides.has(setting)) : [];
  return sameSettings(bot.teamOverrides, next) ? { ok: true } : { ok: true, teamOverrides: next };
}

/** A new bot created in a team starts on the team's model and computer,
 * except what the request chose: that setting is the bot's own. */
export function withTeamDefaultsForCreate(
  body: Record<string, unknown>,
  defaults: TeamDefaultsRecord | null,
): { body: Record<string, unknown>; teamOverrides?: TeamSetting[] } {
  if (!defaults) return { body };
  const next = { ...body };
  const own: TeamSetting[] = [];
  if (next.modelSelection === undefined) {
    if (defaults.model) next.modelSelection = { ...defaults.model };
  } else if (defaults.model) own.push("model");
  if (next.computer === undefined) {
    if (defaults.computer && defaults.computer !== "auto") next.computer = defaults.computer;
  } else if (defaults.computer) own.push("computer");
  return own.length ? { body: next, teamOverrides: own } : { body: next };
}
