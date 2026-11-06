// @ts-nocheck
/** defaultsPresetFor (#1388). Pure move from server/index.ts. */
import { picture as sharedPicture } from "../packages/package-export.ts";
import { presetFromDefaults, DEFAULTS_PRESET_KEY } from "../presets.ts";
export type Host = Record<string, any>;

export function createDefaultsPresetFor(getHost: () => Host): any {
function defaultsPresetFor(body: Record<string, unknown>, includeNotes: boolean) {
  const host = getHost();

  const skipped: TeamExportSkip[] = [];
  let avatar: Exclude<ReturnType<typeof sharedPicture>, string> | null = null;
  if (body.presetAvatar !== undefined && body.presetAvatar !== null && body.presetAvatar !== "") {
    const offered = sharedPicture(body.presetAvatar);
    if (typeof offered === "string") skipped.push({ part: `presets[${DEFAULTS_PRESET_KEY}].bot.appearance.avatar`, reason: offered });
    else avatar = offered;
  }
  const built = presetFromDefaults(host.cfg.newBotDefaults, {
    name: typeof body.presetName === "string" ? body.presetName : undefined,
    description: typeof body.presetDescription === "string" ? body.presetDescription : undefined,
    includeNotes,
    avatar
  });
  return { preset: built.value, skipped: [...skipped, ...built.skipped] };

}
  return defaultsPresetFor;
}
