export interface ManagedSkill {
  name: string;
  description: string;
  enabled: boolean;
  source: string;
  warnings: string[];
  /** Present under features.skillsLibrary (and for engine-native skills always):
   * where the bot reads this skill from. Private shadows me, library and native
   * on name collision. "native": loaded by the engine from a folder of its own. */
  origin?: "private" | "library" | "me" | "native";
  /** Shared skills: bots that still link to the one copy. */
  assignedBots?: Array<{ id: string; name: string }>;
}

/** What the extracted row and menu renderers need from SkillsSection. */
export interface SkillRowActions {
  libraryOn: boolean;
  skillWrites: boolean;
  working: string;
  openSkill: (skill: ManagedSkill, startEditing?: boolean) => void;
  toggle: (skill: ManagedSkill) => unknown;
  share: (skill: ManagedSkill, target: "me") => unknown;
  unshare: (skill: ManagedSkill) => unknown;
  remove: (skill: ManagedSkill) => unknown;
}
