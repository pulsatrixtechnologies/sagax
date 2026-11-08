// @ts-nocheck
/** inboxPending (#1388). Pure move from server/index.ts. */
import { describeApproval } from "../../shared/approval-describe.ts";
import { inboxKey } from "../../shared/approvals-inbox.ts";
import { todayRows, type TodayDeps } from "../approvals/today-rows.ts";
export type Host = Record<string, any>;

/** The Today rows' view of the host for one viewer (#2689): their own
 * conversations only, as the conversation itself would show them. */
export function todayDepsFor(host: Host, auth: RequestAuth, viewer: InboxViewer): TodayDeps {
  const approvalViewer = host.viewerForApproval(auth);
  const viewerId = host.channelFilterViewerId(auth);
  return {
    bots: () => host.store.bots,
    bot: (id) => host.store.bot(id) ?? undefined,
    threads: (botId) => {
      const tasks = host.store.tasks(botId);
      const main = host.store.bot(botId)?.threadId;
      return main && !tasks.some((task) => task.threadId === main) ? [...tasks, { threadId: main }] : tasks;
    },
    messages: (threadId) => host.store.messagesFor(threadId),
    isViewers: (bot, threadId) => {
      if (viewerId && !host.botThreadReadable(bot, threadId, viewerId, "thread.read")) return false;
      if (!host.sharedMembership()) return true;
      return host.approvalOwnerId(bot, threadId) === viewer.principalId || host.threadStarters.get(threadId) === viewer.principalId;
    },
    proposals: () => host.proactiveProposals.open(),
    project: (threadId, message) => host.projectMessages(threadId, [message], approvalViewer)[0],
  };
}

export function createInboxPending(getHost: () => Host): any {
function inboxPending(auth: RequestAuth, viewer: InboxViewer) {
  const host = getHost();
  const { isPrincipalId } = host;

  const approvalViewer = host.viewerForApproval(auth);
  const viewerId = host.channelFilterViewerId(auth);
  const orgAdmin = host.IDENTITY.kind === "perspicax" && host.orgAdminCaller(auth);
  const teams = host.managedTeamIds(viewer.principalId);
  const out: InboxApproval[] = [];
  for (const { bot, threadId, message, card, question } of host.pendingInboxCards()) {
    const confidential = host.store.isConfidentialThread(threadId);
    // the person who answers this card (a destination's answerer included),
    // as approvalAnswerRefusal and the console read it
    const ownerId = host.cardAnswererId(bot, threadId, card);
    const group = host.store.groupByThread(threadId);
    const readable = !viewerId || host.botThreadReadable(bot, threadId, viewerId, "thread.read");
    let scope: InboxScope;
    let decidable: boolean;
    let waitingOn: InboxApproval["waitingOn"];
    let teamMemberRow = false;
    let rowReadable = readable;
    if (question) {
      // a question is the person's who asked it (its thread's starter or
      // requester), else the bot owner's; never an admin's by rank
      if (!readable) continue;
      const known = [host.threadStarters.get(threadId), host.cardRequesterKey(threadId, card.requestId!)].filter((person): person is string => Boolean(person));
      const asks = host.sharedMembership() && known.length
        ? known.includes(viewer.principalId) || (auth.kind === "session" && (known.includes(host.personKey(auth.session)) || known.includes(host.legacyPersonKey(auth.session))))
        : ownerId === viewer.principalId || !host.sharedMembership();
      if (!asks || host.cardAnswerRefusal(auth, threadId, card.requestId!, "answer")) continue;
      scope = "mine";
      decidable = true;
    } else if (card.adminApproval && host.IDENTITY.kind === "perspicax") {
      if (confidential) continue;
      if (orgAdmin) { scope = "org"; decidable = true; }
      else if (ownerId === viewer.principalId) { scope = "org"; decidable = false; waitingOn = "admin"; }
      else continue;
    } else if (ownerId !== viewer.principalId && host.teamMemoryMemberMayAnswer(threadId, card, viewer.principalId, bot.id)
      && !host.cardAnswerRefusal(auth, threadId, card.requestId!, "allow")) {
      // a team-memory card is also the team's: a member of its current
      // section who may confirm it finds it here, as in the conversation
      // (an organization server's private thread stays its person's; a
      // room's card reaches its people, as the conversation and SSE do)
      rowReadable = host.teamMemoryThreadReadable(bot, threadId, viewerId);
      if (!rowReadable) continue;
      scope = "mine";
      teamMemberRow = true;
      // shown, but answerable only where the respond route would take it
      decidable = host.viewerMayAnswerOnThread(threadId, viewerId);
      if (!decidable) waitingOn = "owner";
    } else if (ownerId === viewer.principalId) {
      // the same answerer rules as the card in the conversation
      scope = "mine";
      decidable = !host.cardAnswerRefusal(auth, threadId, card.requestId!, "allow") && !host.approvalAnswerRefusal(auth, threadId, card.requestId!);
      if (!decidable && !readable) continue;
    } else {
      // a team manager sees what waits on the people of their teams, never
      // its content, and never a confidential thread
      if (confidential || !teams.size || !isPrincipalId(ownerId)) continue;
      const ownerTeams = host.principals.byId(ownerId)?.teams ?? [];
      if (!ownerTeams.some((team) => teams.has(team.id))) continue;
      scope = "team";
      decidable = false;
      waitingOn = "owner";
    }
    // the card exactly as this person's conversation shows it
    const shown = (decidable || teamMemberRow) && (rowReadable || (card.adminApproval && orgAdmin)) ? host.projectMessages(threadId, [message], approvalViewer)[0] as Message | undefined : undefined;
    if (decidable && !question && !shown?.card?.requestId) continue;
    const type = host.approvalTypeOf(card);
    const kind: InboxKind = question ? "question"
      : type === "skill" || type === "routine" || type === "profile" || type === "model" || type === "team_setup" ? "proposal" : "permission";
    const tool = card.mcpTool ?? card.tool;
    const described = kind === "permission" && tool ? describeApproval(String(tool), card.toolInput ?? card.subtitle, card.toolHints) : undefined;
    const needsKey = decidable && kind !== "question" ? Boolean(host.stepUpGate(viewer.principalId, threadId, card.requestId!, "allow", {}, undefined)) : false;
    const owner = host.IDENTITY.kind === "perspicax" ? host.inboxPersonName(ownerId) : undefined;
    const title = group ? host.store.groupTasks(group.id).find((task) => task.threadId === threadId)?.title : host.store.taskByThread(bot.id, threadId)?.title;
    // 2026-11-04: a routine run's card names its routine (the run's hidden task)
    const routineName = !group && !confidential && scope !== "team" ? host.routineNameOfThread(bot.id, threadId) : undefined;
    out.push({
      key: inboxKey(threadId, card.requestId!),
      threadId,
      requestId: card.requestId!,
      botId: bot.id,
      botName: bot.name,
      ...(group && scope !== "team" ? { roomName: group.name } : {}),
      ...(title && !confidential && scope !== "team" ? { threadTitle: String(title).slice(0, 200) } : {}),
      ...(routineName ? { routineName: routineName.slice(0, 200) } : {}),
      scope,
      kind,
      at: message.at,
      ...(described?.risk ? { risk: described.risk } : card.plain?.risk ? { risk: card.plain.risk } : {}),
      ...(tool && kind === "permission" ? { tool: String(tool).slice(0, 200) } : {}),
      ...(card.toolHints ? { toolHints: card.toolHints } : {}),
      decidable,
      ...(waitingOn ? { waitingOn, waitingOnName: waitingOn === "owner" ? owner : host.orgAdminNames().filter(host.plainPersonName).join(", ") || undefined } : {}),
      ...(owner && scope !== "mine" ? { ownerName: owner } : {}),
      ...(needsKey ? { needsKey: true } : {}),
      bulk: decidable ? host.inboxBulkVerdict(threadId, card, kind, needsKey) : "not-yours",
      ...(decidable && card.ownerRule && card.ownerRule.from !== "admin" ? {
        alwaysRule: card.ownerRule.description,
        alwaysKind: [card.ownerRule.tool, Object.keys(card.ownerRule.scope ?? {}).sort().join(","), card.ownerRule.destructive ?? "", card.ownerRule.from ?? ""].join("|")
      } : {}),
      ...(confidential ? { confidential: true } : {}),
      ...(kind !== "question" ? { destination: host.inboxDestination(bot, card) } : {}),
      ...(shown ? { message: shown } : {})
    });
  }
  // #2689: the bots' "needs you" cards and proactive proposals, in the same box
  out.push(...todayRows(todayDepsFor(host, auth, viewer)));
  return out.sort((a, b) => a.at - b.at).slice(0, 500);

}
  return inboxPending;
}
