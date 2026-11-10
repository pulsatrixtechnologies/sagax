// GitHub's side of the Team board (#3409): one GraphQL read per repository,
// with the person's own GitHub account (their GitHub connection on an
// organization server, their own credential or `gh` sign-in on a solo one),
// at display time. Never the organization's shared credentials.
//
// Cache: in memory only, keyed by person AND repository, so one person's
// answer is never served to another, even for the same repository. A read is
// reused TEAM_BOARD_GITHUB_TTL_MS; `fresh` skips that; one read in flight per
// key; the last good snapshot is kept with its time and served, marked stale,
// when GitHub does not answer. Nothing on disk, no timer: nothing runs when
// nobody looks.
//
// The token is only ever sent to GitHub's API in a header. It never reaches
// an error, a log line or an answer.
//
// Release of a merged pull request (#3449, lot P2 of #3409): the GitHub
// release is the source. The same request brings the merge commit, the
// TEAM_BOARD_RELEASES newest releases (GitHub's largest page: Sagax cuts
// about 30 in 4 days, so 100 cover Merged's 7 days with no extra call;
// drafts and prereleases left out) and, for a repository without one, the
// newest tags. The release of a merge is the oldest one whose tag contains
// its merge commit. The candidate is the oldest release whose tag commit is
// not older than the merge commit (exact on a linear default branch); when
// the list read is full and no release read is older than the merge, the
// real one may be unread: the release stays unknown, never guessed. GitHub's
// compare (tag...merge: `behind` or `identical` means the tag contains it)
// confirms the candidate AND that the release just before does not contain
// the merge (when it does, the walk goes back). Those compares are bounded
// per repository read (TEAM_BOARD_RELEASE_CHECKS) and their answers cached
// per person, repository, tag commit and merge commit (immutable, so kept
// until the bounded cache drops them); a later read confirms what the budget
// left. When a compare cannot be asked, the release found by date is given
// with `confirmed: false`.
import type { GitExec } from "../code-branches.ts";
import { githubAccessFailure, type GithubAccessFailure, type GithubAccessFix } from "../github/github-access.ts";
import type { TeamBoardGithubReason } from "../../shared/team-board.ts";

/** A repository's read is reused this long (design note: 60 seconds). */
export const TEAM_BOARD_GITHUB_TTL_MS = 60_000;
/** To do reads the open issues of a repository newest first, in pages of
 * 100, up to this many (#3413 review); the true number of open issues
 * comes with them (RepoSnapshot.openIssues), so the page says how many more. */
export const TEAM_BOARD_OPEN_ISSUES = 300;
/** Pull requests read per repository, newest by update (open or merged). */
export const TEAM_BOARD_PULLS = 50;
/** Releases (else tags) read per repository, newest first, in the same
 * request: GitHub's largest page, a hard bound (review of #3450). */
export const TEAM_BOARD_RELEASES = 100;
/** GitHub compares one repository read may ask to confirm releases. */
export const TEAM_BOARD_RELEASE_CHECKS = 40;
/** Steps tried per merge, forward or back, before it stays unconfirmed. */
const RELEASE_STEPS = 3;
/** A label taken from a release's name (free text) is cut to this. */
export const TEAM_BOARD_RELEASE_LABEL_CHARS = 60;
/** Containment answers kept (per person, repository, tag and merge). */
const CONTAINS_CACHE_MAX = 5_000;
const ISSUE_PAGE = 100;
const API_URL = "https://api.github.com";
const GRAPHQL_URL = `${API_URL}/graphql`;
const READ_TIMEOUT_MS = 15_000;

export interface BoardIssue {
  number: number;
  title: string;
  url: string;
  open: boolean;
  createdAt?: number;
  /** Its milestone's title (what is planned). */
  milestone?: string;
}

/** A release (or, for a repository without one, a tag). */
export interface BoardRelease {
  tag: string;
  label: string;
  url?: string;
  /** Publication (a tag: its commit's date). */
  at: number;
  /** The tag commit. */
  oid?: string;
  tagAt?: number;
}

export interface BoardPull {
  number: number;
  url: string;
  title: string;
  state: "open" | "merged" | "closed";
  draft: boolean;
  mergedAt?: number;
  headRefName?: string;
  baseRefName?: string;
  /** Issues of the same repository it closes (`Closes #N`). */
  closes: BoardIssue[];
  reviewDecision?: "approved" | "changes_requested" | "required";
  /** The newest review asking for changes, when no commit came after it. */
  changesRequestedBy?: string;
  checks?: "failing" | "pending" | "passing";
  failingCheck?: string;
  conflicting: boolean;
  createdAt?: number;
  updatedAt?: number;
  lastCommitAt?: number;
  lastReviewAt?: number;
  mergeCommit?: { oid: string; at?: number };
  milestone?: string;
  /** A merge's release (#3449): the release (`confirmed` by GitHub's
   * compare, else found by date), null when none contains it yet (not cut
   * yet), absent when it could not be told. */
  release?: (BoardRelease & { confirmed: boolean }) | null;
}

export interface RepoSnapshot {
  issues: BoardIssue[];
  pulls: BoardPull[];
  /** GitHub's count of open issues (beyond the ones read). */
  openIssues: number;
  /** Newest first, drafts left out; the newest tags when it has none. */
  releases?: BoardRelease[];
}

export type GithubBoardState = "ok" | "stale" | "unavailable" | "not_connected";

export interface GithubBoardRead {
  /** The snapshot of each repository that has one (fresh or stale). */
  snapshots: Map<string, RepoSnapshot>;
  state: GithubBoardState;
  /** The time of the oldest snapshot served. */
  at?: number;
  fix?: GithubAccessFix;
  /** The stable cause (#3449), whenever `state` is not "ok". */
  reason?: TeamBoardGithubReason;
}

export type GraphqlAnswer = { ok: true; data: unknown } | { ok: false; status?: number; headers?: Headers };
export type RestAnswer = { ok: true; data: unknown } | { ok: false };

export interface GithubBoardDeps {
  /** The person's own GitHub token; undefined when they have none. */
  token(person: string): string | undefined;
  /** A solo server without a stored credential: the host's own `gh`
   * sign-in (`gh api graphql`), which is the person's. Absent on an
   * organization server. */
  ghGraphql?(query: string, variables: Record<string, unknown>): Promise<GraphqlAnswer>;
  /** The same sign-in for one REST read (`gh api <path>`): the compare that
   * confirms a release. Absent: the date rule stands. */
  ghRest?(path: string): Promise<RestAnswer>;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface GithubBoardReader {
  read(person: string, repos: readonly string[], options?: { fresh?: boolean }): Promise<GithubBoardRead>;
}

interface Entry {
  at: number;
  snapshot: RepoSnapshot;
}

type RepoRead = { ok: true; snapshot: RepoSnapshot } | { ok: false; fix?: GithubAccessFix; reason: TeamBoardGithubReason };

const PULL_FIELDS = `number url title state isDraft mergedAt createdAt updatedAt headRefName baseRefName reviewDecision mergeable
  mergeCommit { oid committedDate } milestone { title }
  closingIssuesReferences(first: 10) { nodes { number title url state createdAt repository { nameWithOwner } } }
  latestReviews(first: 20) { nodes { state submittedAt author { login } } }
  commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state contexts(first: 50) { nodes {
    __typename ... on CheckRun { name conclusion status } ... on StatusContext { context state } } } } } } }`;

export const BOARD_QUERY = `query($owner: String!, $name: String!, $after: String, $pulls: Int!, $withPulls: Boolean!) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN, first: ${ISSUE_PAGE}, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { number title url createdAt milestone { title } }
    }
    pullRequests(states: [OPEN, MERGED], first: $pulls, orderBy: { field: UPDATED_AT, direction: DESC }) @include(if: $withPulls) {
      nodes { ${PULL_FIELDS} }
    }
    releases(first: ${TEAM_BOARD_RELEASES}, orderBy: { field: CREATED_AT, direction: DESC }) @include(if: $withPulls) {
      nodes { tagName name url publishedAt isDraft isPrerelease tagCommit { oid committedDate } }
    }
    refs(refPrefix: "refs/tags/", first: ${TEAM_BOARD_RELEASES}, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) @include(if: $withPulls) {
      nodes { name target { __typename ... on Commit { oid committedDate } ... on Tag { target { ... on Commit { oid committedDate } } } } }
    }
  }
}`;

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const list = (value: unknown): Json[] => (Array.isArray(obj(value).nodes) ? (obj(value).nodes as unknown[]).map(obj) : []);
const str = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);
const time = (value: unknown): number | undefined => {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

const FAILED_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);

/** One pull request as the board reads it. */
export function boardPull(node: Json, repo: string): BoardPull | undefined {
  const number = Number(node.number);
  const url = str(node.url);
  if (!Number.isSafeInteger(number) || !url) return undefined;
  const state = node.state === "MERGED" ? "merged" : node.state === "OPEN" ? "open" : "closed";
  const commit = obj(list(node.commits)[0]?.commit);
  const lastCommitAt = time(commit.committedDate);
  const rollup = obj(commit.statusCheckRollup);
  const failing = list(rollup.contexts).find((context) => (context.__typename === "StatusContext"
    ? context.state === "FAILURE" || context.state === "ERROR"
    : FAILED_CONCLUSIONS.has(String(context.conclusion ?? ""))));
  const checks = rollup.state === "SUCCESS" ? "passing"
    : rollup.state === "FAILURE" || rollup.state === "ERROR" ? "failing"
    : rollup.state === "PENDING" || rollup.state === "EXPECTED" ? "pending"
    : undefined;
  const decision = node.reviewDecision === "APPROVED" ? "approved"
    : node.reviewDecision === "CHANGES_REQUESTED" ? "changes_requested"
    : node.reviewDecision === "REVIEW_REQUIRED" ? "required"
    : undefined;
  const reviewTimes = list(node.latestReviews).map((review) => time(review.submittedAt) ?? 0);
  const lastReviewAt = reviewTimes.length ? Math.max(...reviewTimes) : undefined;
  const createdAt = time(node.createdAt);
  const updatedAt = time(node.updatedAt);
  const asking = list(node.latestReviews)
    .filter((review) => review.state === "CHANGES_REQUESTED")
    .map((review) => ({ login: str(obj(review.author).login), at: time(review.submittedAt) ?? 0 }))
    .sort((a, b) => b.at - a.at)[0];
  const changesRequestedBy = decision === "changes_requested" && asking?.login && (lastCommitAt === undefined || lastCommitAt <= asking.at) ? asking.login : undefined;
  const closes = list(node.closingIssuesReferences).flatMap((issue): BoardIssue[] => {
    const issueNumber = Number(issue.number);
    const issueUrl = str(issue.url);
    if (str(obj(issue.repository).nameWithOwner)?.toLowerCase() !== repo.toLowerCase() || !Number.isSafeInteger(issueNumber) || !issueUrl) return [];
    const issueCreated = time(issue.createdAt);
    return [{ number: issueNumber, title: str(issue.title) ?? "", url: issueUrl, open: issue.state === "OPEN", ...(issueCreated !== undefined ? { createdAt: issueCreated } : {}) }];
  });
  const mergedAt = time(node.mergedAt);
  const merge = obj(node.mergeCommit);
  const mergeOid = str(merge.oid);
  const mergeCommitAt = time(merge.committedDate);
  const milestone = str(obj(node.milestone).title);
  const failingName = failing ? str(failing.name) ?? str(failing.context) : undefined;
  return {
    number,
    url,
    title: str(node.title) ?? "",
    state,
    draft: node.isDraft === true,
    ...(mergedAt !== undefined ? { mergedAt } : {}),
    ...(str(node.headRefName) ? { headRefName: str(node.headRefName) } : {}),
    ...(str(node.baseRefName) ? { baseRefName: str(node.baseRefName) } : {}),
    closes,
    ...(decision ? { reviewDecision: decision } : {}),
    ...(changesRequestedBy ? { changesRequestedBy } : {}),
    ...(checks ? { checks } : {}),
    ...(checks === "failing" && failingName ? { failingCheck: failingName } : {}),
    conflicting: node.mergeable === "CONFLICTING",
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    ...(lastCommitAt !== undefined ? { lastCommitAt } : {}),
    ...(lastReviewAt ? { lastReviewAt } : {}),
    ...(mergeOid && /^[0-9a-f]{40}$/i.test(mergeOid) ? { mergeCommit: { oid: mergeOid, ...(mergeCommitAt !== undefined ? { at: mergeCommitAt } : {}) } } : {}),
    ...(milestone ? { milestone } : {}),
  };
}

/** A release's version as the board shows it: the version its tag carries
 * ("0.8.83" for `pulsa-v0.8.83`), else its name, else the tag. Pure. */
export function releaseLabel(tag: string, name?: string): string {
  const version = /\d+(?:\.\d+)+(?:-[\w.]+)?/.exec(tag)?.[0];
  const label = version ?? (name?.replace(/\s+/g, " ").trim() || tag);
  return label.length > TEAM_BOARD_RELEASE_LABEL_CHARS ? `${label.slice(0, TEAM_BOARD_RELEASE_LABEL_CHARS - 1).trimEnd()}…` : label;
}

/** The release address the board names, built here (never GitHub's own
 * string): on https://github.com/, of `repo`, for a plain tag name. */
function releaseUrl(repo: string, tag: string): string | undefined {
  return /^[\w.+-]{1,100}$/.test(tag) ? `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}` : undefined;
}

/** The releases a repository's answer names, newest first, drafts and
 * prereleases left out; its tags when it has no release. `complete`: GitHub
 * gave fewer than TEAM_BOARD_RELEASES, so nothing older is unread. Pure. */
export function boardReleases(repository: Json, repo: string): { releases: BoardRelease[]; complete: boolean } {
  const read = list(repository.releases);
  const releases = read.flatMap((node): BoardRelease[] => {
    const tag = str(node.tagName);
    const at = time(node.publishedAt);
    if (!tag || node.isDraft === true || node.isPrerelease === true || at === undefined) return [];
    const commit = obj(node.tagCommit);
    const oid = str(commit.oid);
    const tagAt = time(commit.committedDate);
    const url = releaseUrl(repo, tag);
    return [{ tag, label: releaseLabel(tag, str(node.name)), at, ...(url ? { url } : {}), ...(oid ? { oid } : {}), ...(tagAt !== undefined ? { tagAt } : {}) }];
  });
  const tags = list(repository.refs);
  const out = releases.length ? releases : tags.flatMap((node): BoardRelease[] => {
    const tag = str(node.name);
    const target = obj(node.target);
    const commit = target.__typename === "Tag" ? obj(target.target) : target;
    const oid = str(commit.oid);
    const at = time(commit.committedDate);
    if (!tag || at === undefined) return [];
    const url = releaseUrl(repo, tag);
    return [{ tag, label: releaseLabel(tag), at, tagAt: at, ...(url ? { url } : {}), ...(oid ? { oid } : {}) }];
  });
  const complete = (releases.length ? read : tags).length < TEAM_BOARD_RELEASES;
  return { releases: out.sort((a, b) => b.at - a.at).slice(0, TEAM_BOARD_RELEASES), complete };
}

/** A failed GraphQL answer's stable cause (#3449). */
export function githubBoardReason(answer: Extract<GraphqlAnswer, { ok: false }>, failure: GithubAccessFailure | null, hasToken: boolean): TeamBoardGithubReason {
  const status = answer.status;
  if (!status || status >= 500) return "outage";
  // GitHub's secondary rate limit: a 403 or 429 with retry-after
  if ((status === 403 || status === 429) && answer.headers?.get("retry-after")) return "rate_limited";
  if (status === 429) return "rate_limited";
  switch (failure?.code) {
    case "rate_limited": return "rate_limited";
    case "sso_required": return "sso";
    case "bad_token": return hasToken ? "bad_token" : "not_connected";
    case "forbidden": return "token_scope";
    case "org_not_covered": return "token_scope";
    case "not_found_or_no_access":
    case "private_needs_token": return "no_access";
    default: return "unknown";
  }
}

/** A GraphQL answer that came back 200 with errors and no repository, as
 * the HTTP answer it means (#3449): the type GitHub gives. */
function graphqlErrorAnswer(errors: unknown[]): Extract<GraphqlAnswer, { ok: false }> {
  const types = errors.map((error) => String(obj(error).type ?? ""));
  if (types.includes("RATE_LIMITED")) return { ok: false, status: 403, headers: new Headers({ "x-ratelimit-remaining": "0" }) };
  if (types.includes("INSUFFICIENT_SCOPES") || types.includes("FORBIDDEN")) return { ok: false, status: 403, headers: new Headers() };
  return { ok: false, status: 404 };
}

/** A solo server's `gh api graphql` with the host's own `gh` sign-in (the
 * person's: a solo server is one person's computer). Strings go as `-f`,
 * numbers and booleans as typed `-F`; a null is left out. */
export function ghGraphqlVia(exec: GitExec, cwd: string): NonNullable<GithubBoardDeps["ghGraphql"]> {
  return async (query, variables) => {
    const args = ["api", "graphql", "-f", `query=${query}`];
    for (const [name, value] of Object.entries(variables)) {
      if (value === null || value === undefined) continue;
      args.push(typeof value === "string" ? "-f" : "-F", `${name}=${String(value)}`);
    }
    const result = await exec("gh", args, { cwd, timeoutMs: READ_TIMEOUT_MS, maxBytes: 16 * 1024 * 1024 });
    if (result.code !== 0) {
      if (/gh auth login|not logged in|authentication/i.test(result.stderr)) return { ok: false, status: 401 };
      if (/rate limit/i.test(result.stderr)) return { ok: false, status: 403, headers: new Headers({ "x-ratelimit-remaining": "0" }) };
      return { ok: false };
    }
    try {
      const body = obj(JSON.parse(result.stdout));
      if (Array.isArray(body.errors) && body.errors.length && !obj(body.data).repository) return graphqlErrorAnswer(body.errors);
      return { ok: true, data: body.data };
    } catch {
      return { ok: false };
    }
  };
}

/** The same `gh` sign-in for one REST read. */
export function ghRestVia(exec: GitExec, cwd: string): NonNullable<GithubBoardDeps["ghRest"]> {
  return async (path) => {
    const result = await exec("gh", ["api", path], { cwd, timeoutMs: READ_TIMEOUT_MS, maxBytes: 4 * 1024 * 1024 });
    if (result.code !== 0) return { ok: false };
    try {
      return { ok: true, data: JSON.parse(result.stdout) };
    } catch {
      return { ok: false };
    }
  };
}

const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;

export function createGithubBoardReader(deps: GithubBoardDeps): GithubBoardReader {
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetch ?? fetch;
  const cache = new Map<string, Entry>();
  const inflight = new Map<string, Promise<RepoRead>>();
  // whether a tag contains a merge: per person too, never shared
  const contained = new Map<string, boolean>();
  // the person and the repository, never one alone
  const keyOf = (person: string, repo: string) => `${person}\u0000${repo.toLowerCase()}`;

  async function graphql(token: string | undefined, variables: Record<string, unknown>): Promise<GraphqlAnswer> {
    if (!token) return deps.ghGraphql ? deps.ghGraphql(BOARD_QUERY, variables) : { ok: false };
    try {
      const response = await doFetch(GRAPHQL_URL, {
        method: "POST",
        headers: { authorization: `bearer ${token}`, "content-type": "application/json", accept: "application/vnd.github+json", "user-agent": "sagax-team-board" },
        body: JSON.stringify({ query: BOARD_QUERY, variables }),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
      if (!response.ok) return { ok: false, status: response.status, headers: response.headers };
      const body = obj(await response.json());
      // GraphQL answers 200 with errors when the repository is not readable
      if (Array.isArray(body.errors) && body.errors.length && !obj(body.data).repository) return graphqlErrorAnswer(body.errors);
      return { ok: true, data: body.data };
    } catch {
      return { ok: false };
    }
  }

  async function rest(token: string | undefined, path: string): Promise<RestAnswer> {
    if (!token) return deps.ghRest ? deps.ghRest(path) : { ok: false };
    try {
      const response = await doFetch(`${API_URL}/${path}`, {
        headers: { authorization: `bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "sagax-team-board" },
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
      if (!response.ok) return { ok: false };
      return { ok: true, data: await response.json() };
    } catch {
      return { ok: false };
    }
  }

  /** Whether `release`'s tag contains the merge commit: true, false, or
   * undefined when it could not be asked (no budget left, no answer). */
  async function contains(person: string, token: string | undefined, repo: string, release: BoardRelease, merge: string, budget: { left: number }): Promise<boolean | undefined> {
    const base = release.oid && /^[0-9a-f]{40}$/i.test(release.oid) ? release.oid : undefined;
    if (!base) return undefined;
    const key = `${keyOf(person, repo)}\u0000${base}\u0000${merge}`;
    const known = contained.get(key);
    if (known !== undefined) return known;
    if (budget.left <= 0) return undefined;
    budget.left -= 1;
    const [owner, name] = repo.split("/");
    // base the tag, head the merge: the merge is behind (or identical) when the tag contains it
    const answer = await rest(token, `repos/${encodeURIComponent(owner!)}/${encodeURIComponent(name!)}/compare/${base}...${merge}?per_page=1`);
    const status = answer.ok ? obj(answer.data).status : undefined;
    const verdict = status === "behind" || status === "identical" ? true : status === "ahead" || status === "diverged" ? false : undefined;
    if (verdict !== undefined) {
      if (contained.size >= CONTAINS_CACHE_MAX) contained.delete(contained.keys().next().value!);
      contained.set(key, verdict);
    }
    return verdict;
  }

  /** Each merge's release (#3449): the oldest release whose tag contains
   * the merge commit, found by date, then confirmed by bounded compares: the
   * release contains the merge and the one just before does not. */
  async function resolveReleases(person: string, token: string | undefined, repo: string, pulls: BoardPull[], releases: readonly BoardRelease[], complete: boolean): Promise<void> {
    const oldestFirst = [...releases].sort((a, b) => (a.tagAt ?? a.at) - (b.tagAt ?? b.at));
    const budget = { left: TEAM_BOARD_RELEASE_CHECKS };
    for (const pull of pulls) {
      if (pull.state !== "merged" || !releases.length) continue;
      const mergedAt = pull.mergeCommit?.at ?? pull.mergedAt;
      if (mergedAt === undefined) continue;
      let index = oldestFirst.findIndex((release) => (release.tagAt ?? release.at) >= mergedAt);
      if (index < 0) {
        // the newest releases are always read: none is that recent
        pull.release = null;
        continue;
      }
      // a full list with nothing read before the merge: the real release may be unread
      if (index === 0 && !complete) continue;
      if (!pull.mergeCommit) {
        pull.release = { ...oldestFirst[index]!, confirmed: false };
        continue;
      }
      const merge = pull.mergeCommit.oid;
      const has = (at: number) => contains(person, token, repo, oldestFirst[at]!, merge, budget);
      // forward: the first release by date that contains the merge
      let verdict = await has(index);
      for (let step = 1; verdict === false && step < RELEASE_STEPS && index + 1 < oldestFirst.length; step++) verdict = await has(++index);
      if (verdict === false) continue; // not found within the steps: unknown
      if (verdict === undefined) {
        pull.release = { ...oldestFirst[index]!, confirmed: false };
        continue;
      }
      // back: the release just before must not contain it
      let confirmed = false;
      for (let step = 0; step < RELEASE_STEPS; step++) {
        if (index === 0) {
          confirmed = complete;
          break;
        }
        const before = await has(index - 1);
        if (before === false) {
          confirmed = true;
          break;
        }
        if (before === undefined) break;
        index -= 1;
      }
      // walked back to the oldest read in a full list: it may be older still
      if (index === 0 && !complete) continue;
      pull.release = { ...oldestFirst[index]!, confirmed };
    }
  }

  async function readRepo(person: string, token: string | undefined, repo: string): Promise<RepoRead> {
    const [owner, name] = repo.split("/");
    const issues: BoardIssue[] = [];
    let pulls: BoardPull[] = [];
    let releases: BoardRelease[] = [];
    let releasesComplete = true;
    let after: string | undefined;
    let openIssues = 0;
    for (let page = 0; ; page++) {
      const answer = await graphql(token, { owner, name, after: after ?? null, pulls: TEAM_BOARD_PULLS, withPulls: page === 0 });
      if (!answer.ok) {
        const failure = answer.status ? githubAccessFailure({ status: answer.status, headers: answer.headers ?? new Headers() }, repo, token ? { token, via: "person" } : null) : null;
        return { ok: false, ...(failure ? { fix: failure.fix } : {}), reason: githubBoardReason(answer, failure, Boolean(token)) };
      }
      const repository = obj(obj(answer.data).repository);
      if (page === 0) {
        pulls = list(repository.pullRequests).flatMap((node) => boardPull(node, repo) ?? []);
        ({ releases, complete: releasesComplete } = boardReleases(repository, repo));
      }
      const block = obj(repository.issues);
      if (typeof block.totalCount === "number") openIssues = block.totalCount;
      for (const node of list(block)) {
        const number = Number(node.number);
        const url = str(node.url);
        const createdAt = time(node.createdAt);
        const milestone = str(obj(node.milestone).title);
        if (Number.isSafeInteger(number) && url && issues.length < TEAM_BOARD_OPEN_ISSUES) issues.push({ number, title: str(node.title) ?? "", url, open: true, ...(createdAt !== undefined ? { createdAt } : {}), ...(milestone ? { milestone } : {}) });
      }
      const info = obj(block.pageInfo);
      after = str(info.endCursor);
      if (info.hasNextPage !== true || !after || issues.length >= TEAM_BOARD_OPEN_ISSUES) break;
    }
    await resolveReleases(person, token, repo, pulls, releases, releasesComplete);
    return { ok: true, snapshot: { issues, pulls, openIssues: Math.max(openIssues, issues.length), releases } };
  }

  function readOnce(person: string, token: string | undefined, repo: string): Promise<RepoRead> {
    const key = keyOf(person, repo);
    const running = inflight.get(key);
    if (running) return running;
    const work = readRepo(person, token, repo)
      .then((result) => {
        if (result.ok) cache.set(key, { at: now(), snapshot: result.snapshot });
        return result;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, work);
    return work;
  }

  return {
    async read(person, repos, options = {}) {
      const snapshots = new Map<string, RepoSnapshot>();
      const wanted = [...new Set(repos.filter((repo) => REPO_NAME.test(repo)))];
      const token = deps.token(person);
      if (!token && !deps.ghGraphql) return { snapshots, state: "not_connected", fix: "connect_or_token", reason: "not_connected" };
      let stale = false;
      let missing = false;
      let fix: GithubAccessFix | undefined;
      let reason: TeamBoardGithubReason | undefined;
      let oldest: number | undefined;
      await Promise.all(wanted.map(async (repo) => {
        const key = keyOf(person, repo);
        const cached = cache.get(key);
        let entry = cached && !options.fresh && now() - cached.at < TEAM_BOARD_GITHUB_TTL_MS ? cached : undefined;
        if (!entry) {
          const result = await readOnce(person, token, repo);
          if (result.ok) entry = cache.get(key);
          else {
            fix ??= result.fix;
            reason ??= result.reason;
            entry = cache.get(key);
            if (entry) stale = true;
            else missing = true;
          }
        }
        if (!entry) return;
        snapshots.set(repo, entry.snapshot);
        oldest = oldest === undefined ? entry.at : Math.min(oldest, entry.at);
      }));
      const state: GithubBoardState = missing ? "unavailable" : stale ? "stale" : "ok";
      return { snapshots, state, ...(oldest !== undefined ? { at: oldest } : {}), ...(fix && state !== "ok" ? { fix } : {}), ...(reason && state !== "ok" ? { reason } : {}) };
    },
  };
}
