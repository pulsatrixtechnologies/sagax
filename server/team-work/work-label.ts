// #3463 (lot 3 of #3451): the name of the piece of work, the step and the
// plan an orchestrator gives when it hands work over (optional fields of
// coordinate_bots and send_to_bot), as the runtime row stores them. Each
// is one line, cut to its size, secrets redacted; a bot of the plan
// resolves like bot_ids, and one that does not is left out (the step
// stays). Nothing here refuses a call: what does not fit is cut.
import { redactSecretsInText } from "../redact.ts";
import {
  TEAM_PLAN_STEPS,
  TEAM_STEP_NAME_CHARS,
  TEAM_WORK_NAME_CHARS,
  teamWorkName,
  type TeamWorkLabel,
  type TeamWorkPlanned,
} from "../../shared/team-work.ts";

/** One line, redacted, cut to `max` characters. Empty: no words. */
function line(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const flat = redactSecretsInText(raw).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The label to store, or undefined when the call gave none. `resolveBot`
 * takes the bot a plan step names (an id or a unique name) and answers its
 * id, or undefined. A plan rides only with a name for the work. */
export function workLabel(raw: { work?: unknown; step?: unknown; plan?: unknown }, resolveBot: (raw: string) => string | undefined): TeamWorkLabel | undefined {
  const name = line(raw.work, TEAM_WORK_NAME_CHARS);
  const step = line(raw.step, TEAM_STEP_NAME_CHARS);
  const plan: TeamWorkPlanned[] = [];
  if (name && Array.isArray(raw.plan)) {
    const seen = new Set<string>();
    for (const entry of raw.plan) {
      if (plan.length >= TEAM_PLAN_STEPS) break;
      const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : undefined;
      const stepName = line(record ? (record.step ?? record.name) : entry, TEAM_STEP_NAME_CHARS);
      const key = teamWorkName(stepName);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const bot = typeof record?.bot === "string" && record.bot.trim() ? resolveBot(record.bot) : undefined;
      plan.push({ name: stepName, ...(bot ? { botId: bot } : {}) });
    }
  }
  if (!name && !step) return undefined;
  return { ...(name ? { name } : {}), ...(step ? { step } : {}), ...(plan.length ? { plan } : {}) };
}
