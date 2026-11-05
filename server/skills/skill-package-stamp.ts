
export interface SkillPackageStamp {
  installId: string;
  /** The skill's name in the package. */
  key: string;
  release: string;
  r: string;
  w: string;
  /** Additive to contract §3.2: "preset" when a bot made from one of the
   * install's presets got it (server/presets.ts). Absent: the install itself
   * put it there (a team's bot, or an offered skill). */
  via?: "preset";
}
