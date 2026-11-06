// The GitHub sign-in cards connect_github posts in a bot's chat (#2109,
// shared/github-connect-card.ts). One card per chat and code: the bot asking
// again in the same chat while the code still works reuses its card. When
// the device flow ends (GitHub hands the token over, the person refuses, the
// code expires, a newer code replaces it) every card of that person's flow
// is patched in place, so the chat itself says "GitHub connected as @login".
import { githubConnectCardText, type GithubConnectCard } from "../../shared/github-connect-card.ts";

export interface GithubConnectCardsDeps {
  appendMessage: (threadId: string, message: Record<string, unknown>) => { id: string };
  patchMessage: (threadId: string, messageId: string, patch: Record<string, unknown>) => void;
}

export interface GithubConnectCardStart {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
}

export type GithubConnectOutcome = { state: "connected"; login: string } | { state: "failed"; error: string } | { state: "cancelled" };

interface Posted {
  threadId: string;
  messageId: string;
  userCode: string;
}

/** At most this many live cards per person (one per chat that asked). */
const MAX_CARDS = 20;

export class GithubConnectCards {
  private readonly deps: GithubConnectCardsDeps;
  private readonly posted = new Map<string, Posted[]>();

  constructor(deps: GithubConnectCardsDeps) {
    this.deps = deps;
  }

  /** Post (or reuse) the card for this code in this chat. */
  post(principalId: string, threadId: string, start: GithubConnectCardStart, from?: Record<string, unknown>): { messageId: string; reused: boolean } {
    const mine = this.posted.get(principalId) ?? [];
    const same = mine.find((entry) => entry.threadId === threadId && entry.userCode === start.userCode);
    if (same) return { messageId: same.messageId, reused: true };
    // An older code's cards: that code no longer works.
    const stale = mine.filter((entry) => entry.userCode !== start.userCode);
    for (const entry of stale) this.patch(entry, { state: "cancelled" });
    const card: GithubConnectCard = { state: "pending", userCode: start.userCode, verificationUri: start.verificationUri, expiresAt: start.expiresAt };
    const message = this.deps.appendMessage(threadId, {
      role: "bot",
      kind: "text",
      text: githubConnectCardText(card),
      githubConnect: card,
      ...(from ? { from } : {}),
    });
    const kept = mine.filter((entry) => entry.userCode === start.userCode);
    kept.push({ threadId, messageId: message.id, userCode: start.userCode });
    this.posted.set(principalId, kept.slice(-MAX_CARDS));
    return { messageId: message.id, reused: false };
  }

  /** The person's flow ended: every card of it says how. */
  settle(principalId: string, outcome: GithubConnectOutcome): void {
    const mine = this.posted.get(principalId);
    if (!mine?.length) return;
    this.posted.delete(principalId);
    for (const entry of mine) this.patch(entry, outcome);
  }

  private patch(entry: Posted, outcome: GithubConnectOutcome): void {
    const card: GithubConnectCard = outcome.state === "connected"
      ? { state: "connected", login: outcome.login }
      : outcome.state === "failed" ? { state: "failed", error: outcome.error } : { state: "cancelled" };
    try {
      this.deps.patchMessage(entry.threadId, entry.messageId, { text: githubConnectCardText(card), githubConnect: card });
    } catch {
      // the chat or the row is gone: nothing left to update
    }
  }
}
