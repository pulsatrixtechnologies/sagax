// @ts-nocheck
/** skillCardCopy (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSkillCardCopy(getHost: () => Host): any {
function skillCardCopy(staged: { action: "create" | "update"; name: string; gist: string; warnings: string[] }): {
  title: string;
  subtitle: string;
  tool: string;
} {
  void getHost();

  const warnings = staged.warnings.length ? `\n\nWarnings:\n- ${staged.warnings.join("\n- ")}` : "";
  return {
    title: staged.action === "create"
      ? `Enable skill "${staged.name}"?`
      : `Update skill "${staged.name}"?`,
    subtitle: `${staged.gist || staged.name}\n\nAdds one line to the prompt index; the body is read only when used.${warnings}`,
    tool: "stage_skill"
  };

}
  return skillCardCopy;
}
