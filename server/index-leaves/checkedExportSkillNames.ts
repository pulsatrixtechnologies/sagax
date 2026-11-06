// @ts-nocheck
/** checkedExportSkillNames (#1388). Pure move from server/index.ts. */
import { BOT_PACKAGE_MAX_SKILLS } from "../bots/bot-package.ts";
import { isSkillName } from "../skills/skills.ts";
export type Host = Record<string, any>;

export function createCheckedExportSkillNames(getHost: () => Host): any {
function checkedExportSkillNames(
  value: unknown,
  bots: readonly BotRecord[],
): { ok: true; names: string[] } | { ok: false; error: string } {
  const host = getHost();

  // Sharing instructions is explicit: ordinary package exports include none.
  if (value === undefined) return { ok: true, names: [] };
  if (!Array.isArray(value) || value.some((name) => typeof name !== "string" || !isSkillName(name))) {
    return { ok: false, error: "skillIds must be a list of exact imported skill names" };
  }
  const names = [...value] as string[];
  if (new Set(names).size !== names.length) return { ok: false, error: "skillIds must not contain duplicates" };
  if (names.length > host.BOT_PACKAGE_MAX_SKILLS) return { ok: false, error: `skillIds must contain at most ${BOT_PACKAGE_MAX_SKILLS} names` };
  const available = new Set(bots.flatMap((bot) => host.listBotSkills(bot).map((skill) => skill.name)));
  const unknown = names.find((name) => !available.has(name));
  if (unknown) return { ok: false, error: `skillIds contains unknown imported skill "${unknown}"` };
  return { ok: true, names };

}
  return checkedExportSkillNames;
}
