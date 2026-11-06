// A coding job launched from a bot's chat stays in that chat as a card, like
// a routine run (#2148, JC 2026-11-06): running with Stop, then finished with
// its branch, a short result and the PR link. It never opens a thread.
import type { BotActivityItem, BotActivityStatus } from "../../shared/bot-activity";

export interface CodingJobView {
  state: BotActivityStatus;
  title: string;
  branch?: string;
  /** The short repo name ("marketplace"), never the full URL. */
  repo?: string;
  pr?: { number?: number; url: string };
  result?: string;
  currentStep?: string;
  startedAt: number;
  endedAt?: number;
}

/** A job is a coding job once it did code work (edits, branch, commits). */
export function isCodingJob(item: Pick<BotActivityItem, "coding" | "code"> | undefined | null): boolean {
  return Boolean(item && (item.coding || item.code));
}

/** The short repo name: "owner/marketplace" or ".../marketplace.git" -> "marketplace". */
export function shortRepoName(repo: string | undefined): string | undefined {
  const name = repo?.trim().replace(/\.git$/, "").replace(/[\\/]+$/, "").split(/[\\/]/).pop()?.trim();
  return name || undefined;
}

/** One short line of the bot's last words: whitespace folded, cut at `max`. */
export function shortResult(text: string | undefined, max = 280): string | undefined {
  const plain = text
    ?.replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return undefined;
  return plain.length <= max ? plain : `${plain.slice(0, max - 1).trimEnd()}…`;
}

/** The last text the bot wrote in the job's conversation. */
export function lastBotText(messages: ReadonlyArray<{ role?: string; kind?: string; text?: string }>): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "bot" && (!message.kind || message.kind === "text") && message.text?.trim()) return message.text;
  }
  return undefined;
}

export function codingJobView(item: BotActivityItem, result?: string): CodingJobView {
  const code = item.code;
  const branchEntry = code?.branches?.at(-1);
  const pull = code?.pullRequests?.at(-1);
  return {
    state: item.status,
    title: item.title,
    branch: branchEntry?.name ?? code?.branch,
    repo: shortRepoName(branchEntry?.repo ?? code?.repo ?? code?.folder),
    pr: pull?.url ? { number: pull.number, url: pull.url } : undefined,
    result: shortResult(result),
    currentStep: item.currentStep,
    startedAt: item.startedAt,
    endedAt: item.endedAt,
  };
}
