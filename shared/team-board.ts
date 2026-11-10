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
  /** `reason` is English prose, kept for clients built before #3449; `code`
   * and `params` say the same thing in a stable form a page translates
   * (TeamBoardBlockedCause). */
  blocked?: { source: "approval" | "turn" | "review" | "checks" | "conflict"; reason: string } & TeamBoardBlockedCause;
  // Addendum P1 (project manager view). Additive: "approval" above is no
  // longer sent (waiting for the person is `waiting.on = "you"`), kept so
  // clients built on lot 1 still compile.
  /** The lane the card was built in, so the client can regroup. */
  sectionId: string;
  /** What is happening to the card now, beside its column. */
  status: TeamBoardStatus;
  /** `reason` is the line the chat shows (English or the bot's own words),
   * kept as is; `code` and `params` are its stable form (TeamBoardWaitingCause). */
  waiting?: { on: "you" | "review" | "release"; reason?: string; since?: number } & TeamBoardWaitingCause;
  /** The issue's creation (else the first work seen on it). */
  createdAt: number;
  /** The newest movement: the holder's last turn on it, the last commit, the last review, the pull request's update. */
  movedAt?: number;
  stale?: { why: "no_movement" | "no_review"; days: number; hours?: number };
  // Lot P2 of #3409 (#3449).
  /** When its pull request was merged (Merged column only). */
  mergedAt?: number;
  /** Where the card ships. Merged: `shipped` (the oldest GitHub release whose
   * tag contains the merge commit; `label` its version, else its name cut
   * to 60 characters, `tag` as GitHub has it, `url` the release page, `at`
   * its publication, `confirmed` true when GitHub's compare showed that the
   * release contains the merge and the one before it does not, false when
   * it was found by date only (compare not answered or out of budget this
   * read)) or `unreleased` (no release contains it yet: `label` "Not cut
   * yet", in the reader's language). Drafts and prereleases never count.
   * Absent on a merged card: the release could not be told (the merge is
   * older than every release read, or no release contains it within the
   * steps tried); never a guess. Open: `planned` with the milestone's
   * title, when the issue (else its pull request) has one. Absent on an
   * open card: not scheduled (or GitHub was not read). */
  release?: TeamBoardRelease;
}
export interface TeamBoardRelease { kind: "shipped" | "unreleased" | "planned"; label: string; tag?: string; url?: string; at?: number; confirmed?: boolean }

/** Why a card is Blocked, stable (#3449). `turn_failed`: the holder's newest
 * turn failed; `turn_blocked`: it was refused or stalled (a routine run);
 * `detail` is the first line of the cause the chat shows, free text from the
 * run, absent when none was stored. `changes_requested`: `by` is the
 * reviewer's GitHub login. `check_failed`: `name` is the check without its
 * matrix suffix ("test" for "test (ubuntu-latest, 20)"), `check` the full
 * name. `conflict`: `base` is the base branch, absent when GitHub did not
 * name it. */
export type TeamBoardBlockedCause =
  | { code: "turn_failed"; params: { detail?: string } }
  | { code: "turn_blocked"; params: { detail?: string } }
  | { code: "changes_requested"; params: { by: string } }
  | { code: "check_failed"; params: { name: string; check: string } }
  | { code: "conflict"; params: { base?: string } };
export type TeamBoardBlockedCode = TeamBoardBlockedCause["code"];

/** Why a card waits, stable (#3449). On `you`: `approval` (an approval card
 * is open in the holder's conversation; `what` its line, `tool` the tool it
 * asks for, when it names one), `question` (a question card, or a routine
 * run's question; `what` the question), or `waiting_you` when the server
 * could not read which card (the conversation is not readable by this
 * reader, or the card was already gone; `what` the step the chat shows, when
 * known). On `review`: `review_required` (ready, no verdict yet). On
 * `release`: `not_released` (merged, no release contains it yet; the card's
 * release is `unreleased`) or `release_unknown` (merged, its release could
 * not be told; the card has no `release`). */
export type TeamBoardWaitingCause =
  | { code: "approval"; params: { what?: string; tool?: string } }
  | { code: "question"; params: { what?: string } }
  | { code: "waiting_you"; params: { what?: string } }
  | { code: "review_required"; params: Record<string, never> }
  | { code: "not_released"; params: Record<string, never> }
  | { code: "release_unknown"; params: Record<string, never> };
export type TeamBoardWaitingCode = TeamBoardWaitingCause["code"];

/** Why GitHub was not read, stable (#3449), beside `github.fix` (the prose
 * hint kept for older clients). `not_connected`: the reader has no GitHub
 * account here (no token, no `gh` sign-in); `bad_token`: GitHub refused the
 * token (wrong, expired, revoked); `sso`: the organization's SAML sign-on
 * has not authorized it; `token_scope`: GitHub refused the read for lack of
 * a scope or permission; `no_access`: GitHub answered not found (private and
 * not readable with this account, or gone); `rate_limited`: GitHub's rate
 * limit, primary or secondary; `outage`: GitHub did not answer, timed out
 * or failed (5xx, network); `unknown`: another refusal. */
export type TeamBoardGithubReason = "not_connected" | "bad_token" | "sso" | "token_scope" | "no_access" | "rate_limited" | "outage" | "unknown";
export type TeamBoardStatus = "free" | "taken" | "running" | "waiting_you" | "waiting_review" | "waiting_release" | "released" | "blocked";
export interface TeamBoardSummary { inProgress: number; waitingYou: number; blocked: number; mergedThisWeek: number; oldestInProgress?: { key: string; days: number } }
export interface TeamBoardLane { sectionId: string; name: string; lead?: { botId: string; name: string }; repos: string[]; cards: TeamBoardCard[];
  /** (#3449) Open issues of the repositories whose untouched issues this
   * lane draws (its To do) that the read did not load: GitHub's count of
   * open issues minus the newest TEAM_BOARD_OPEN_ISSUES it read, per such
   * repository, summed. Each would be a To do card of this lane. The loaded
   * ones are the lane's cards in the `todo` column. 0 when all were read or
   * GitHub was not read. */
  todoNotLoaded: number }
export interface TeamBoard { lanes: TeamBoardLane[]; at: number;
  /** `fix`: the prose hint of lot 1 (kept); `reason`: its stable code
   * (#3449), present whenever `state` is not "ok". */
  github: { state: "ok" | "stale" | "unavailable" | "not_connected"; at?: number; fix?: string; reason?: TeamBoardGithubReason }; summary: TeamBoardSummary;
  /** Per repository (owner/name) read on GitHub, GitHub's count of its open
   * issues (pull requests excluded): every open issue, wherever its card is
   * (To do, Design, Code, Gate and review, Blocked) or not loaded. It is not
   * a count of To do cards: that is the `todo` cards plus each lane's
   * `todoNotLoaded`. */
  todoTotal: Record<string, number>;
  /** (#3449) The releases of the repositories read, newest first: `label`
   * the version, `tag` as GitHub has it, `url` the release page, `at` its
   * publication. Drafts are left out; a repository with no release gives
   * its newest tags instead. */
  releases: { repo: string; label: string; tag: string; url?: string; at: number }[];
  /** (#3449) The filter this answer was built for, as the source accepted
   * it: `team` a lane's sectionId, `column` a TeamBoardColumn. Absent: the
   * whole board. */
  filter?: { team?: string; column?: TeamBoardColumn } }

/** The filter a page may pass to the `team-board` source (#3449): `team`
 * one of the reader's lanes (its sectionId), `column` one column. */
export const TEAM_BOARD_COLUMNS: readonly TeamBoardColumn[] = ["todo", "design", "code", "review", "merged", "blocked"];

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
    /** The pull request conflicts with its base: the base branch's name
     * ("" when GitHub did not name it). */
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
  if (holder?.status === "failed" || holder?.status === "blocked") {
    const detail = holder.failure?.trim();
    return { source: "turn", reason: detail || "The last turn failed", code: holder.status === "failed" ? "turn_failed" : "turn_blocked", params: detail ? { detail } : {} };
  }
  if (!pull) return undefined;
  if (pull.changesRequestedBy) return { source: "review", reason: `Changes requested by ${pull.changesRequestedBy}`, code: "changes_requested", params: { by: pull.changesRequestedBy } };
  if (pull.failingCheck) return { source: "checks", reason: `Check failed: ${pull.failingCheck}`, code: "check_failed", params: { name: checkBaseName(pull.failingCheck), check: pull.failingCheck } };
  if (pull.conflictsWith !== undefined) {
    const base = pull.conflictsWith.trim();
    return { source: "conflict", reason: `Conflicts with ${base || "the base branch"}`, code: "conflict", params: base ? { base } : {} };
  }
  return undefined;
}

/** A check's name without its matrix suffix: GitHub names a matrix job
 * "test (ubuntu-latest, 20)"; the page shows "test". Pure. */
export function checkBaseName(check: string): string {
  const name = check.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return name || check;
}

const STAGE_COLUMNS: ReadonlySet<TeamBoardColumn> = new Set(["design", "code", "review"]);

/** What is happening to a card now (#3409 addendum P1), one status, first
 * match wins: blocked, waiting_you, running, waiting_review,
 * waiting_release, released, taken, free. A merge is `released` once a
 * release contains it (`released`, lot P2), else waiting_release. Pure. */
export function cardStatus(input: PlaceCardInput & { column: TeamBoardColumn; released?: boolean }): TeamBoardStatus {
  const { holder, pull } = input;
  if (input.column === "blocked") return "blocked";
  if (holder?.status === "waiting") return "waiting_you";
  if (holder?.status === "running") return "running";
  if (input.column === "review" && pull?.state === "open" && !pull.draft && pull.review !== "approved" && pull.review !== "changes_requested") return "waiting_review";
  if (input.column === "merged") return input.released ? "released" : "waiting_release";
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
