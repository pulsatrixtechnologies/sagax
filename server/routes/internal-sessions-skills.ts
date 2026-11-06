// Skills list and stage for internal session routes (#1383).
import { learnSource } from "../skills/skill-learn.ts";
import { skillDiscoveryPage } from "../skills/skill-discovery.ts";
import {
  applySkillWriteWithReceipt,
  listSkills,
  listStagedSkillWrites,
  readSkillFile,
  rejectStagedSkillWrite,
  stageSkillWrite,
} from "../skills/skills.ts";
import type { InternalRouteContext } from "./internal-route.ts";
import type { InternalSessionsBot, InternalSessionsDeps } from "./internal-sessions-types.ts";
import { PASS } from "./table.ts";

function skillRuleCandidate(staged: { action: "create" | "update"; name: string; sha256: string }): {
  tool: string;
  scope: Record<string, string>;
  description: string;
} {
  return {
    tool: "sagax:skill",
    scope: { action: staged.action, skill: staged.name, content: staged.sha256 },
    description: `${staged.action === "create" ? "Enable" : "Update"} the skill "${staged.name}" with this exact content`,
  };
}

export async function handleInternalSessionsSkills(
  deps: InternalSessionsDeps,
  ctx: InternalRouteContext,
  internalSender: InternalSessionsBot,
): Promise<typeof PASS | void> {
  const { res, path, method, json, capability, readBody, url } = ctx;
  if (method === "GET" && path === "/api/internal/skills") {
    const from = internalSender;
    if (!deps.ownsThread(from.id, capability.threadId)) return json(res, 403, { error: "source conversation does not belong to sender" });
    const query = url!.searchParams.get("query") ?? "";
    const offset = Number(url!.searchParams.get("offset") ?? 0);
    if (query.length > 200 || !Number.isSafeInteger(offset) || offset < 0) return json(res, 400, { error: "query must be at most 200 characters and offset a nonnegative integer" });
    const person = deps.isPerspicax() ? deps.turnSpeaker(capability.threadId) ?? "" : deps.localPrincipalId();
    const instance = deps.runningTurnInstance(from, capability.threadId);
    const inventory = deps.scopedSkillInventory(from, instance, person);
    return json(res, 200, {
      ...skillDiscoveryPage(inventory.rows, query, offset),
      incomplete: inventory.incomplete,
      staged: listStagedSkillWrites(from.id).map((s) => deps.stagedSkillListing(s)),
    });
  }
  if (method === "POST" && path === "/api/internal/skills/stage") {
    if (!deps.personalFeatureOn("skillAuthoring", deps.skillAuthoringEnabled(), deps.vaultPrincipal(capability.threadId))) return json(res, 403, { error: "skill authoring is not enabled in Settings" });
    if (!capability.skillAuthoring) {
      return json(res, 403, { error: "skill authoring is not enabled for this turn" });
    }
    const body = await readBody();
    const from = internalSender;
    const fromThreadId = capability.threadId;
    if (!deps.ownsThread(from.id, fromThreadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    // Skills written here are always the sender's own, so they apply at
    // any level, with a one-line receipt and Undo (appliesDirectly).
    const direct = deps.appliesDirectly(from.id, fromThreadId, from.id);
    const persistence = deps.skillProposalPersistence(from.id, fromThreadId, !direct);
    if (!persistence.ok) return json(res, persistence.status, { error: persistence.error });
    const action = body.action === "create" || body.action === "update" ? body.action : "";
    if (!action) return json(res, 400, { error: 'action must be "create" or "update"' });
    const skillMd = typeof body.skill_md === "string" ? body.skill_md : "";
    if (!skillMd.trim()) {
      return json(res, 400, { error: 'skill_manage needs skill_md: the full SKILL.md including YAML frontmatter, for example ---\\nname: file-expense\\ndescription: Files an expense in the company portal.\\n---\\n\\n# File expense\\n' });
    }
    const source = typeof body.source === "string" ? body.source.trim() : "";
    if (!source) return json(res, 400, { error: 'source must be a URL, folder, or "conversation"' });
    const targetName = typeof body.skill_name === "string" ? body.skill_name.trim() : "";
    if (action === "update" && !targetName) {
      return json(res, 400, { error: "skill_name is required when action is update" });
    }
    const staged = stageSkillWrite(from.id, {
      action,
      targetName: targetName || undefined,
      files: [{ path: "SKILL.md", content: skillMd }],
      gist: typeof body.gist === "string" ? body.gist : undefined,
      source: learnSource(source),
    });
    if ("error" in staged) return json(res, 422, { error: staged.error });
    // a skill written from a conversation (/learn) counts its uses for Skill Smith
    if (staged.action === "create" && source === "conversation") deps.recordSkillLearned(fromThreadId, staged.name);
    // 2026-10-19 ("Toujours permettre" on every card): Always allow on
    // a skill card keeps this skill with this exact content (a skill is
    // instructions the bot reads: new content always shows its card)
    const skillRule = skillRuleCandidate(staged);
    const skillKept = direct ? undefined : deps.keptCardRule(from, fromThreadId, skillRule, ["always-grant"]);
    if (direct) {
      const applied = deps.applyOwnStagedSkill(from, fromThreadId, staged, direct);
      if ("error" in applied) return json(res, 422, { state: "failed", error: applied.error });
      return json(res, 201, { state: "applied", stagedId: staged.id, name: staged.name, action: staged.action,
        gist: staged.gist, warnings: staged.warnings, ...applied, summary: `Skill ${staged.name} ${staged.action === "create" ? "enabled" : "updated"}.` });
    }
    if (skillKept) {
      // Always allow on this skill: apply with a receipt, tagged as owner-rule.
      const previousSkillMd = staged.action === "update" ? readSkillFile(from.id, staged.name) : null;
      const previousSource = listSkills(from.id).find((skill) => skill.name === staged.name)?.source;
      const previous = previousSkillMd !== null && previousSource ? { preview: previousSkillMd, source: previousSource } : undefined;
      const applied = applySkillWriteWithReceipt(from.id, staged, () => {
        const receipt = deps.appendSkillRequestCard({ botId: from.id, threadId: fromThreadId, staged, applied: true, previous });
        deps.appendDecision({ threadId: fromThreadId, requestId: receipt.requestId, botId: from.id, botName: from.name,
          tool: "stage_skill", summary: receipt.summary, decision: "auto-approved", source: "owner-rule", rule: skillKept.id });
      });
      if ("error" in applied) {
        rejectStagedSkillWrite(from.id, staged.id);
        return json(res, 422, { state: "failed", error: applied.error });
      }
      return json(res, 201, { state: "applied", stagedId: staged.id, name: staged.name, action: staged.action,
        gist: staged.gist, warnings: staged.warnings, ...applied, summary: `Skill ${staged.name} ${staged.action === "create" ? "enabled" : "updated"}.` });
    }
    let card: { requestId: string; summary: string };
    try {
      card = deps.appendSkillRequestCard({ botId: from.id, threadId: fromThreadId, staged, ownerRule: { tool: skillRule.tool, scope: skillRule.scope, description: skillRule.description } });
    } catch (error) {
      rejectStagedSkillWrite(from.id, staged.id);
      throw error;
    }
    deps.appendDecision( {
      threadId: fromThreadId,
      requestId: card.requestId,
      botId: from.id,
      botName: from.name,
      tool: "stage_skill",
      summary: card.summary,
      decision: "card-shown",
      source: "skill",
    });
    return json(res, 201, {
      state: "pending",
      stagedId: staged.id,
      name: staged.name,
      action: staged.action,
      gist: staged.gist,
      warnings: staged.warnings,
      summary: card.summary,
    });
  }
  return PASS;
}
