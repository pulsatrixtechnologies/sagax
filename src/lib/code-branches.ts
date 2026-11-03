// The bot panel's Coding branches as the person acts on them (Details >
// Coding): the calls (server/routes/bot-code-branches.ts) and the pure
// helpers the card draws from (status, subtitle, which actions apply).
import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { BotCodeBranch, BotCodePullRequest } from "../../shared/bot-activity.ts";
import { branchArchiveKey, type BotBranchActionBody, type BotBranchActionResult, type BotBranchComputer, type BotBranchDiff, type BotBranchInfo, type BotBranchPull, type BotBranchState } from "../../shared/bot-code-branches.ts";

export type { BotBranchInfo, BotBranchState, BotBranchPull, BotBranchDiff };

/** A branch of the Coding list: where it came from (the coding thread and
 * its repository folder) and the pull request the bot opened from it. */
export interface CodingBranch extends BotCodeBranch {
  threadId?: string;
  folder?: string;
  pull?: BotCodePullRequest;
}

export function codingBranchKey(branch: Pick<CodingBranch, "repo" | "folder" | "name">): string {
  return branchArchiveKey(branch.repo ?? branch.folder, branch.name);
}

const base = (botId: string) => `/api/bots/${encodeURIComponent(botId)}/code`;
const query = (threadId: string, branch: string) => `threadId=${encodeURIComponent(threadId)}&branch=${encodeURIComponent(branch)}`;

export const loadBranchInfo = (botId: string, threadId: string, branch: string) => api<BotBranchInfo>(`${base(botId)}/branch?${query(threadId, branch)}`);
export const loadBranchDiff = (botId: string, threadId: string, branch: string) => api<BotBranchDiff>(`${base(botId)}/branch/diff?${query(threadId, branch)}`);
export const loadBranchPull = async (botId: string, threadId: string, branch: string) => (await api<{ pull: BotBranchPull | null }>(`${base(botId)}/branch/pull?${query(threadId, branch)}`)).pull;
export const loadArchivedBranches = async (botId: string) => (await api<{ keys: string[] }>(`${base(botId)}/branches/archived`)).keys;
export const setBranchArchived = async (botId: string, key: string, archived: boolean) => (await api<{ keys: string[] }>(`${base(botId)}/branches/archived`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ key, archived }),
})).keys;

export function branchAction(botId: string, action: "commit" | "push" | "pr" | "delete", body: BotBranchActionBody): Promise<BotBranchActionResult> {
  return api<BotBranchActionResult>(`${base(botId)}/branch/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 150_000,
  });
}

export type BranchTone = "merged" | "open" | "closed" | "pushed" | "local" | "gone";

/** What the card says the branch is, newest truth first: the pull request
 * (live when read, else what the bot did), then the branch read now, then
 * what the bot's calls said. */
export function branchStatus(branch: CodingBranch, state?: BotBranchState, pull?: BotBranchPull | null): { tone: BranchTone; label: string } {
  const pr = pull ?? (branch.pull ? { state: branch.pull.action === "merged" ? "merged" : branch.pull.action === "closed" ? "closed" : "open", number: branch.pull.number } : undefined);
  if (pr?.state === "merged") return { tone: "merged", label: t("botPanel.branch.merged") };
  if (state && !state.exists) return { tone: "gone", label: t("botPanel.branch.gone") };
  if (pr?.state === "open") return { tone: "open", label: pr.number !== undefined ? t("botPanel.branch.prOpenNumbered", { number: pr.number }) : t("botPanel.branch.prOpen") };
  if (pr?.state === "closed") return { tone: "closed", label: t("botPanel.branch.prClosed") };
  const pushed = state ? state.pushed : branch.pushed;
  return pushed ? { tone: "pushed", label: t("botPanel.code.pushed") } : { tone: "local", label: t("botPanel.code.notPushed") };
}

/** "2 commits ahead · 3 changed files" from the branch read now. */
export function branchCounts(state?: BotBranchState): string[] {
  if (!state?.exists) return [];
  const out: string[] = [];
  if (state.ahead > 0) out.push(t(state.ahead === 1 ? "botPanel.branch.aheadOne" : "botPanel.branch.ahead", { count: state.ahead }));
  if (state.changes.length > 0) out.push(t(state.changes.length === 1 ? "botPanel.branch.changedOne" : "botPanel.branch.changed", { count: state.changes.length }));
  return out;
}

export interface BranchActions {
  commit: boolean;
  push: boolean;
  /** Open a new pull request (the branch is pushed, none is open). */
  openPr: boolean;
  /** The pull request's page, when there is one. */
  prUrl?: string;
  diff: boolean;
  remove: boolean;
}

/** Which actions the card offers, from the branch read now. A branch on the
 * bot's own computer (place "remote") acts just like one on this server when
 * it can be reached; when it cannot, its state is absent and nothing applies. */
export function branchActions(info: BotBranchInfo | undefined, pull: BotBranchPull | null | undefined, branch: CodingBranch): BranchActions {
  const state = info?.state;
  const here = (info?.place === "server" || info?.place === "remote") && state?.exists === true;
  const prUrl = pull?.url ?? branch.pull?.url;
  const prOpenOrMerged = pull ? pull.state !== "closed" : Boolean(branch.pull && branch.pull.action !== "closed");
  return {
    commit: here && Boolean(state!.worktree) && state!.changes.length > 0,
    push: here && !state!.isDefault && Boolean(info!.canPublish) && (!state!.pushed || state!.ahead > 0),
    openPr: here && !state!.isDefault && Boolean(info!.canPublish) && state!.pushed && !prOpenOrMerged && Boolean(branch.repo ?? info?.repo),
    ...(prUrl ? { prUrl } : {}),
    diff: here,
    remove: here && !state!.isDefault,
  };
}

/** Why the branch cannot be acted on at all (every action disabled), as a
 * locale key, or null when it can: it is not the person's conversation, or
 * it no longer exists. A branch the panel cannot reach is not this: it says
 * why and offers to ask the bot (branchAway). */
export function branchUnavailable(info: BotBranchInfo | undefined, branch: CodingBranch): LocaleKey | null {
  if (!branch.threadId) return "botPanel.branch.hint.noThread";
  if (info?.state && !info.state.exists) return "botPanel.branch.gone";
  return null;
}

const OFF_REASON: Record<BotBranchComputer, LocaleKey> = {
  sandbox: "botPanel.branch.away.sandboxOff",
  desktop: "botPanel.branch.away.desktopOff",
  local_vm: "botPanel.branch.away.vmOff",
  remote_session: "botPanel.branch.away.remoteOff",
};

/** Why the panel cannot run this branch's actions itself, in plain words
 * with what to do (its params: `{ bot }`), or null when it can: the
 * computer that holds it is off or not known, runs Windows, its folder is
 * not known, or the branch could not be read now. Each action then asks the
 * bot to do it, in the conversation the branch came from: never a silent
 * grey menu. A read that failed comes first, also over an earlier read the
 * row keeps (its place and counts): that read may no longer hold (the bot
 * ran git again, and the computer answered busy). */
export function branchAway(info: BotBranchInfo | undefined, readFailed = false): LocaleKey | null {
  if (readFailed) return "botPanel.branch.away.unread";
  if (!info) return null;
  if (info.place === "elsewhere") return "botPanel.branch.away.elsewhere";
  if (info.place !== "remote") return null;
  if (info.offline) return OFF_REASON[info.computer ?? "remote_session"];
  if (info.noPath) return "botPanel.branch.away.noPath";
  if (info.publishBlocked === "unknown_os") return info.windows ? "botPanel.branch.away.windows" : "botPanel.branch.away.unknownOs";
  return null;
}

/** Reading the branch again can change what the panel can do, so its menu
 * offers "Try again" (the reasons say to): its computer was off, its OS
 * not known yet, or the last read failed (busy, no answer), also over an
 * earlier read. Not where the computer or the folder is not known, nor on
 * Windows: reading again changes nothing there. */
export function branchCanReadAgain(info: BotBranchInfo | undefined, readFailed = false): boolean {
  if (readFailed) return true;
  if (!info) return false;
  if (info.place !== "remote") return false;
  return Boolean(info.offline) || (info.publishBlocked === "unknown_os" && !info.windows);
}

/** The actions the bot can be asked to do on a branch. */
export type BranchAskAction = "commit" | "push" | "pr" | "diff" | "delete";

const ASK_TEXT: Record<BranchAskAction, LocaleKey> = {
  commit: "botPanel.branch.ask.commit",
  push: "botPanel.branch.ask.push",
  pr: "botPanel.branch.ask.pr",
  diff: "botPanel.branch.ask.diff",
  delete: "botPanel.branch.ask.delete",
};

/** The request the bot gets for that action on that branch, in the
 * person's language (they send it as their own message). */
export function branchAskText(action: BranchAskAction, branch: string): string {
  return t(ASK_TEXT[action], { branch });
}

/** Where the branch is, for its row: the person's cloud computer, their own
 * computer (by its name when known), their Local VM, or a computer's name. */
export function branchWhere(info: BotBranchInfo | undefined): string | undefined {
  if (info?.place !== "remote") return undefined;
  if (info.computer === "sandbox") return t("botPanel.branch.onCloud");
  if (info.computer === "local_vm") return t("botPanel.branch.onLocalVm");
  if (info.host) return t("botPanel.branch.onComputer", { host: info.host });
  return info.computer === "desktop" ? t("botPanel.branch.onYourComputer") : undefined;
}

/** Push and open a pull request on a client's computer (a remote session,
 * or a server that does not say which computer) ask the person to confirm
 * first. Their own cloud computer, own computer and Local VM do not. */
export function remoteActionNeedsConfirm(info: BotBranchInfo | undefined, action: "push" | "pr"): boolean {
  return info?.place === "remote" && (info.computer === undefined || info.computer === "remote_session") && (action === "push" || action === "pr");
}

/** A commit message's first line is short; the rest stays. */
export function commitMessageProblem(message: string): LocaleKey | null {
  if (!message.trim()) return "botPanel.branch.commit.empty";
  return null;
}

/** The delete needs a second confirmation: work that is not on origin. */
export function deleteNeedsSecondConfirm(state?: BotBranchState): boolean {
  return Boolean(state && state.exists && (!state.pushed || state.ahead > 0));
}
