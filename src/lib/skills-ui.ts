// Pure helpers for the bot Skills list and skill editor (person UI).

/** Human label for a skill source path shown behind a disclosure. */
export function skillSourceLabel(source: string): string {
  if (!source) return "Source";
  if (source.startsWith("learn:inbox/")) return "Learned from inbox";
  if (source.startsWith("learn:")) return "Learned";
  if (source.startsWith("org:")) return "Organization library";
  if (source === "local-import") return "Imported";
  if (source.startsWith("upload:")) return "Uploaded";
  if (source.startsWith("github:") || source.includes("github.com")) return "GitHub";
  if (source.includes("skills.sh")) return "skills.sh";
  return "Source";
}

export type SkillEditorOrigin = "private" | "library" | "me" | "native";

export function skillEditorApiPath(botId: string, name: string, origin: SkillEditorOrigin | undefined): string {
  if (origin === "library") return `/api/skills-library/${encodeURIComponent(name)}`;
  if (origin === "me") return `/api/me/skills-library/${encodeURIComponent(name)}`;
  // native skills are read through the bot skills route (readBotSkillFile falls back).
  return `/api/bots/${encodeURIComponent(botId)}/skills/${encodeURIComponent(name)}`;
}

export interface SkillEditorFile {
  path: string;
  bytes: number;
  kind: "text" | "image" | "pdf" | "other";
}

export interface SkillEditorPayload {
  name: string;
  text: string;
  description: string;
  source: string;
  enabled: boolean;
  changedAfterReview: boolean;
  reviewedText: string | null;
  warnings: string[];
  files: SkillEditorFile[];
  editable: boolean;
  origin: SkillEditorOrigin;
}
