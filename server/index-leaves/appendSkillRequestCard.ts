// @ts-nocheck
/** appendSkillRequestCard (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAppendSkillRequestCard(getHost: () => Host): any {
function appendSkillRequestCard(args: {
  /** What Always allow keeps on this card (skillRuleCandidate). */
  ownerRule?: { tool: string; scope: Record<string, string>; description: string };
  botId: string;
  threadId: string;
  /** Applied without a person: a one-line receipt with Undo. */
  applied?: boolean;
  previous?: SkillRequestCardData["previous"];
  staged: {
    id: string;
    action: "create" | "update";
    name: string;
    gist: string;
    source: string;
    files: Array<{ path: string; content: string }>;
    sha256: string;
    warnings: string[];
  };
}): { requestId: string; summary: string } {
  const host = getHost();
  const { randomUUID } = host;

  const requestId = randomUUID();
  const copy = host.skillCardCopy(args.staged);
  const payload: SkillRequestCardData = {
    version: 1,
    requestId,
    botId: args.botId,
    threadId: args.threadId,
    stagedId: args.staged.id,
    action: args.staged.action,
    name: args.staged.name,
    gist: args.staged.gist,
    source: args.staged.source,
    preview: args.staged.files.find((file) => file.path === "SKILL.md")?.content ?? "",
    sha256: args.staged.sha256,
    warnings: args.staged.warnings,
    createdAt: Date.now(),
    ...(args.applied && args.previous ? { previous: args.previous } : {})
  };
  const from = host.store.bot(args.botId);
  // a skill proposal, applied at Full (args.applied); full-access: proposal
  host.store.appendMessage(args.threadId, {
    role: "bot",
    kind: "options",
    from: from ? { botId: from.id, name: from.name, color: from.color } : undefined,
    card: {
      title: copy.title,
      subtitle: copy.subtitle,
      options: args.applied ? [] : [args.staged.action === "create" ? "Enable" : "Update", "Deny"],
      ...(args.applied ? { answered: "allow", autoApplied: true, title: `Skill "${args.staged.name}" ${args.staged.action === "create" ? "enabled" : "updated"}` } : {}),
      requestId,
      tool: copy.tool,
      skillRequest: payload,
      ...(args.ownerRule && !args.applied ? { ownerRule: args.ownerRule } : {})
    }
  });
  return {
    requestId,
    summary: `${copy.title} ${args.staged.gist}`.trim()
  };

}
  return appendSkillRequestCard;
}
