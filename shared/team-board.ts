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
export interface TeamBoard { lanes: TeamBoardLane[]; at: number; github: { state: "ok" | "stale" | "unavailable" | "not_connected"; at?: number; fix?: string }; summary: TeamBoardSummary;
  /** Per repository (owner/name), the true count of open issues: To do
   * holds at most the 300 newest of them (#3413 review). */
  todoTotal: Record<string, number> }

/** Merged cards stay on the board this long after the merge (decided 2026-11-10). */
export const TEAM_BOARD_MERGED_DAYS = 7;
export const TEAM_BOARD_MERGED_MS = TEAM_BOARD_MERGED_DAYS * 24 * 60 * 60_000;
/** Aging (decided 2026-11-10): a card in Design, Code or Gate and review with no
 * movement this long, and a ready pull request with no verdict this long. */
export const TEAM_BOARD_NO_MOVEMENT_MS = 4 * 60 * 60_000;
export const TEAM_BOARD_NO_REVIEW_MS = 2 * 60 * 60_000;
/** How many cards a lane shows before "Show N more". */
export const TEAM_BOARD_TODO_VISIBLE = 10;
export const TEAM_BOARD_MERGED_VISIBLE = 5;

/** The facts one card is placed from: GitHub's (the pull request) and
 * Sagax's (the holder's newest turn, whether a team bot touched the issue
 * or produced work for it). */
export interface PlaceCardInput {
  issueOpen: boolean;
  /** A team bot read, commented, created or edited the issue. */
  touched: boolean;
  /** A branch, commit or pull request a team bot produced for this issue. */
  linkedWork: boolean;
  pull?: {
    state: "open" | "merged" | "closed";
    draft?: boolean;
    mergedAt?: number;
    /** GitHub's review decision. */
    review?: "approved" | "changes_requested" | "required";
    /** Changes requested and no commit came after that review. */
    changesRequestedBy?: string;
    /** A check failed on the last commit: its name. */
    failingCheck?: string;
    /** The pull request conflicts with its base. */
    conflictsWith?: string;
  };
  holder?: {
    status: "running" | "waiting" | "queued" | "finished" | "failed" | "stopped" | "blocked";
    /** What a waiting turn asks (the approval or question the chat shows). */
    waitingFor?: string;
    /** The cause a failed turn stored, first line. */
    failure?: string;
  };
  now: number;
}

export interface CardPlace {
  column: TeamBoardColumn;
  stage?: TeamBoardCard["stage"];
  blocked?: TeamBoardCard["blocked"];
}

/** Where a card goes (#3409 design note, section 3, and addendum P1: a
 * card waiting for the person stays in its stage column), first match wins:
 * Merged, Blocked, Gate and review, Code, Design, To do. null: the card
 * leaves the board (closed without a merged pull request, or merged more
 * than TEAM_BOARD_MERGED_DAYS ago). A card whose holder's turn runs is never
 * Blocked: the bot is already on it. */
export function placeCard(input: PlaceCardInput): CardPlace | null {
  const { pull, holder } = input;
  if (pull?.state === "merged") {
    return pull.mergedAt !== undefined && input.now - pull.mergedAt > TEAM_BOARD_MERGED_MS ? null : { column: "merged" };
  }
  if (!input.issueOpen) return null;
  const openPull = pull?.state === "open" ? pull : undefined;
  const stage: Exclude<TeamBoardColumn, "merged" | "blocked" | "todo"> | "todo" = openPull && !openPull.draft ? "review"
    : input.linkedWork || openPull ? "code"
    : input.touched ? "design"
    : "todo";
  if (holder?.status !== "running") {
    const blocked = blockedBy(input, openPull);
    if (blocked) return { column: "blocked", stage: stage === "todo" ? "design" : stage, blocked };
  }
  return { column: stage };
}

function blockedBy(input: PlaceCardInput, pull: PlaceCardInput["pull"] | undefined): TeamBoardCard["blocked"] | undefined {
  const { holder } = input;
  // waiting for the person is not broken (addendum P1): it is the status
  // waiting_you, in its stage column
  if (holder?.status === "failed" || holder?.status === "blocked") return { source: "turn", reason: holder.failure?.trim() || "The last turn failed" };
  if (!pull) return undefined;
  if (pull.changesRequestedBy) return { source: "review", reason: `Changes requested by ${pull.changesRequestedBy}` };
  if (pull.failingCheck) return { source: "checks", reason: `Check failed: ${pull.failingCheck}` };
  if (pull.conflictsWith) return { source: "conflict", reason: `Conflicts with ${pull.conflictsWith}` };
  return undefined;
}

const STAGE_COLUMNS: ReadonlySet<TeamBoardColumn> = new Set(["design", "code", "review"]);

/** What is happening to a card now (#3409 addendum P1), one status, first
 * match wins: blocked, waiting_you, running, waiting_review,
 * waiting_release, released, taken, free. No release is read yet (lot P2),
 * so a merge is waiting_release. Pure. */
export function cardStatus(input: PlaceCardInput & { column: TeamBoardColumn }): TeamBoardStatus {
  const { holder, pull } = input;
  if (input.column === "blocked") return "blocked";
  if (holder?.status === "waiting") return "waiting_you";
  if (holder?.status === "running") return "running";
  if (input.column === "review" && pull?.state === "open" && !pull.draft && pull.review !== "approved" && pull.review !== "changes_requested") return "waiting_review";
  if (input.column === "merged") return "waiting_release";
  if (holder) return "taken";
  return "free";
}

/** A card that ages badly (#3409 addendum P1): a ready pull request with no
 * verdict for TEAM_BOARD_NO_REVIEW_MS, else no movement for
 * TEAM_BOARD_NO_MOVEMENT_MS in Design, Code or Gate and review. To do and
 * Merged never age. Pure. */
export function cardStale(input: { column: TeamBoardColumn; status: TeamBoardStatus; movedAt?: number; reviewSince?: number; stage?: TeamBoardCard["stage"]; now: number }): TeamBoardCard["stale"] | undefined {
  const age = (since: number) => ({ days: Math.floor((input.now - since) / 86_400_000), hours: Math.floor((input.now - since) / 3_600_000) });
  if (input.status === "waiting_review" && input.reviewSince !== undefined && input.now - input.reviewSince > TEAM_BOARD_NO_REVIEW_MS) return { why: "no_review", ...age(input.reviewSince) };
  const column = input.column === "blocked" ? input.stage : input.column;
  if (column && STAGE_COLUMNS.has(column) && input.movedAt !== undefined && input.now - input.movedAt > TEAM_BOARD_NO_MOVEMENT_MS) return { why: "no_movement", ...age(input.movedAt) };
  return undefined;
}

/** The header figures (#3409 addendum P1). In progress: running or taken, in
 * Design, Code or Gate and review. Merged this week: the Merged column (it
 * keeps TEAM_BOARD_MERGED_DAYS). Oldest in progress: by its holder's since,
 * else its creation. Pure. */
export function boardSummary(cards: readonly TeamBoardCard[], now: number): TeamBoardSummary {
  const progress = cards.filter((card) => (card.status === "running" || card.status === "taken") && STAGE_COLUMNS.has(card.column));
  const oldest = progress
    .map((card) => ({ key: card.key, at: card.since ?? card.createdAt }))
    .sort((a, b) => a.at - b.at)[0];
  return {
    inProgress: progress.length,
    waitingYou: cards.filter((card) => card.status === "waiting_you").length,
    blocked: cards.filter((card) => card.column === "blocked").length,
    mergedThisWeek: cards.filter((card) => card.column === "merged").length,
    ...(oldest ? { oldestInProgress: { key: oldest.key, days: Math.floor((now - oldest.at) / 86_400_000) } } : {}),
  };
}
