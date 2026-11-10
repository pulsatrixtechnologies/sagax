// Team board (#3409): the per person kanban of the coding teams, computed by
// the server on demand from the bots' code work and GitHub. Read only.

export type TeamBoardColumn = "todo" | "design" | "code" | "review" | "merged" | "blocked";
export interface TeamBoardCard {
  key: string;                 // "owner/repo#123", never shown
  repo: string; number: number; title: string; issueUrl: string;
  column: TeamBoardColumn;
  stage?: Exclude<TeamBoardColumn, "merged" | "blocked" | "todo">; // when blocked
  holder?: { botId: string; name: string; threadId?: string; ref?: string };
  since?: number;
  pull?: { number: number; url: string; draft?: true; review?: "approved" | "changes_requested" | "required"; checks?: "failing" | "pending" | "passing" };
  blocked?: { source: "approval" | "turn" | "review" | "checks" | "conflict"; reason: string };
  // Addendum P1 (project manager view). Additive: "approval" above is no
  // longer sent (waiting for the person is `waiting.on = "you"`), kept so
  // clients built on lot 1 still compile.
  /** The lane the card was built in, so the client can regroup. */
  sectionId: string;
  /** What is happening to the card now, beside its column. */
  status: TeamBoardStatus;
  waiting?: { on: "you" | "review" | "release"; reason?: string; since?: number };
  /** The issue's creation (else the first work seen on it). */
  createdAt: number;
  /** The newest movement: the holder's last turn on it, the last commit, the last review, the pull request's update. */
  movedAt?: number;
  stale?: { why: "no_movement" | "no_review"; days: number; hours?: number };
}
export type TeamBoardStatus = "free" | "taken" | "running" | "waiting_you" | "waiting_review" | "waiting_release" | "released" | "blocked";
export interface TeamBoardSummary { inProgress: number; waitingYou: number; blocked: number; mergedThisWeek: number; oldestInProgress?: { key: string; days: number } }
export interface TeamBoardLane { sectionId: string; name: string; lead?: { botId: string; name: string }; repos: string[]; cards: TeamBoardCard[] }
export interface TeamBoard { lanes: TeamBoardLane[]; at: number; github: { state: "ok" | "stale" | "unavailable" | "not_connected"; at?: number; fix?: string }; summary: TeamBoardSummary }
