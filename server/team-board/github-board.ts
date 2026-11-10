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
import type { GitExec } from "../code-branches.ts";
import { githubAccessFailure, type GithubAccessFix } from "../github/github-access.ts";

/** A repository's read is reused this long (design note: 60 seconds). */
export const TEAM_BOARD_GITHUB_TTL_MS = 60_000;
/** To do reads the open issues of a repository newest first, in pages of
 * 100, up to this many (#3413 review); the true number of open issues
 * comes with them (RepoSnapshot.openIssues), so the page says how many more. */
export const TEAM_BOARD_OPEN_ISSUES = 300;
/** Pull requests read per repository, newest by update (open or merged). */
export const TEAM_BOARD_PULLS = 50;
const ISSUE_PAGE = 100;
const GRAPHQL_URL = "https://api.github.com/graphql";
const READ_TIMEOUT_MS = 15_000;

export interface BoardIssue {
  number: number;
  title: string;
  url: string;
  open: boolean;
  createdAt?: number;
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
}

export interface RepoSnapshot {
  issues: BoardIssue[];
  pulls: BoardPull[];
  /** GitHub's count of open issues (beyond the ones read). */
  openIssues: number;
}

export type GithubBoardState = "ok" | "stale" | "unavailable" | "not_connected";

export interface GithubBoardRead {
  /** The snapshot of each repository that has one (fresh or stale). */
  snapshots: Map<string, RepoSnapshot>;
  state: GithubBoardState;
  /** The time of the oldest snapshot served. */
  at?: number;
  fix?: GithubAccessFix;
}

export type GraphqlAnswer = { ok: true; data: unknown } | { ok: false; status?: number; headers?: Headers };

export interface GithubBoardDeps {
  /** The person's own GitHub token; undefined when they have none. */
  token(person: string): string | undefined;
  /** A solo server without a stored credential: the host's own `gh`
   * sign-in (`gh api graphql`), which is the person's. Absent on an
   * organization server. */
  ghGraphql?(query: string, variables: Record<string, unknown>): Promise<GraphqlAnswer>;
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

type RepoRead = { ok: true; snapshot: RepoSnapshot } | { ok: false; fix?: GithubAccessFix };

const PULL_FIELDS = `number url title state isDraft mergedAt createdAt updatedAt headRefName baseRefName reviewDecision mergeable
  closingIssuesReferences(first: 10) { nodes { number title url state createdAt repository { nameWithOwner } } }
  latestReviews(first: 20) { nodes { state submittedAt author { login } } }
  commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state contexts(first: 50) { nodes {
    __typename ... on CheckRun { name conclusion status } ... on StatusContext { context state } } } } } } }`;

export const BOARD_QUERY = `query($owner: String!, $name: String!, $after: String, $pulls: Int!, $withPulls: Boolean!) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN, first: ${ISSUE_PAGE}, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { number title url createdAt }
    }
    pullRequests(states: [OPEN, MERGED], first: $pulls, orderBy: { field: UPDATED_AT, direction: DESC }) @include(if: $withPulls) {
      nodes { ${PULL_FIELDS} }
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
  };
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
    if (result.code !== 0) return { ok: false, ...(/gh auth login|not logged in|authentication/i.test(result.stderr) ? { status: 401 } : {}) };
    try {
      const body = obj(JSON.parse(result.stdout));
      if (Array.isArray(body.errors) && body.errors.length && !obj(body.data).repository) return { ok: false, status: 404 };
      return { ok: true, data: body.data };
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
      if (Array.isArray(body.errors) && body.errors.length && !obj(body.data).repository) return { ok: false, status: 404 };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false };
    }
  }

  async function readRepo(token: string | undefined, repo: string): Promise<RepoRead> {
    const [owner, name] = repo.split("/");
    const issues: BoardIssue[] = [];
    let pulls: BoardPull[] = [];
    let after: string | undefined;
    let openIssues = 0;
    for (let page = 0; ; page++) {
      const answer = await graphql(token, { owner, name, after: after ?? null, pulls: TEAM_BOARD_PULLS, withPulls: page === 0 });
      if (!answer.ok) {
        const failure = answer.status ? githubAccessFailure({ status: answer.status, headers: answer.headers ?? new Headers() }, repo, token ? { token, via: "person" } : null) : null;
        return { ok: false, ...(failure ? { fix: failure.fix } : {}) };
      }
      const repository = obj(obj(answer.data).repository);
      if (page === 0) pulls = list(repository.pullRequests).flatMap((node) => boardPull(node, repo) ?? []);
      const block = obj(repository.issues);
      if (typeof block.totalCount === "number") openIssues = block.totalCount;
      for (const node of list(block)) {
        const number = Number(node.number);
        const url = str(node.url);
        const createdAt = time(node.createdAt);
        if (Number.isSafeInteger(number) && url && issues.length < TEAM_BOARD_OPEN_ISSUES) issues.push({ number, title: str(node.title) ?? "", url, open: true, ...(createdAt !== undefined ? { createdAt } : {}) });
      }
      const info = obj(block.pageInfo);
      after = str(info.endCursor);
      if (info.hasNextPage !== true || !after || issues.length >= TEAM_BOARD_OPEN_ISSUES) break;
    }
    return { ok: true, snapshot: { issues, pulls, openIssues: Math.max(openIssues, issues.length) } };
  }

  function readOnce(person: string, token: string | undefined, repo: string): Promise<RepoRead> {
    const key = keyOf(person, repo);
    const running = inflight.get(key);
    if (running) return running;
    const work = readRepo(token, repo)
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
      if (!token && !deps.ghGraphql) return { snapshots, state: "not_connected", fix: "connect_or_token" };
      let stale = false;
      let missing = false;
      let fix: GithubAccessFix | undefined;
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
      return { snapshots, state, ...(oldest !== undefined ? { at: oldest } : {}), ...(fix && state !== "ok" ? { fix } : {}) };
    },
  };
}
