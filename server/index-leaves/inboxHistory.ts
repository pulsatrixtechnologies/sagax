// @ts-nocheck
/** inboxHistory (#1388). Pure move from server/index.ts. */
import { INBOX_HISTORY_MAX } from "../../shared/approvals-inbox.ts";
import { activityEntries } from "../activity/admin-activity.ts";
export type Host = Record<string, any>;

export function createInboxHistory(getHost: () => Host): any {
function inboxHistory(auth: RequestAuth, viewer: InboxViewer) {
  const host = getHost();
  const { DATA_DIR, readDecisionRange } = host;
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60_000);
  // an admin of this server only: never a chat-only guest of a solo server
  const admin = auth.kind === "loopback" || host.orgAdminCaller(auth) || (auth.kind === "session" && auth.scopes.includes("admin"));
  const rows = readDecisionRange(DATA_DIR, { from, to }).filter((row) => {
    // a person's answer only: what was shown, decided by a rule or left to expire is not an answer
    if (row.source !== "user" && row.source !== "question") return false;
    if (row.decision !== "user-approved" && row.decision !== "user-denied" && row.decision !== "user-undone") return false;
    if (row.actor?.kind === "session" && row.actor.userId === viewer.principalId) return true;
    const bot = row.botId ? host.store.bot(row.botId) : undefined;
    if (host.store.isConfidentialThread(row.threadId)) return Boolean(bot) && host.cardAnswererId(bot!, row.threadId, undefined) === viewer.principalId;
    if (admin) return true;
    return Boolean(bot) && host.cardAnswererId(bot!, row.threadId, undefined) === viewer.principalId;
  });
  return activityEntries(rows, [], { what: "decisions" }, (principalId) => (admin ? host.adminPerson(principalId).name : host.inboxPersonName(principalId) ?? "someone"))
    .slice(0, INBOX_HISTORY_MAX)
    .map((entry) => {
      const row = entry as Extract<typeof entry, { type: "approval" }>;
      const via = row.who.endsWith("(console)") ? "console" as const : undefined;
      // a member reads names, never someone's email address
      const who = admin ? row.who : row.who.replace(/[^\s@()]+@[^\s@()]+\.[^\s@()]+/g, "someone");
      return {
        at: row.at, decision: row.what, who,
        ...(row.source === "question" ? { question: true as const } : {}),
        ...(row.bot ? { botName: row.bot } : {}),
        ...(row.tool ? { tool: row.tool } : {}),
        ...(row.summary ? { summary: row.summary.slice(0, 300) } : {}),
        ...(via ? { via } : {}),
        threadId: row.threadId,
        ...(row.requestId ? { requestId: row.requestId } : {})
      };
    });

}
  return inboxHistory;
}
