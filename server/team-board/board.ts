// The Team board's pure builder (#3409): the person's teams, what their bots
// did (the bot activity entries, already narrowed to what the person may
// read) and GitHub's snapshots in, the lanes and cards out. No I/O.
//
// A team's repositories are the GitHub repositories its bots worked on in
// the window (their code work: repository, pull requests, branches, commits,
// issues). A card is one issue. Issue and pull request are joined by the
// pull request's `Closes #N`, then by a pull request number the bot's own
// calls saw, then by an issue number in a branch name. Every Sagax fact
// carries the conversation it came from (the holder's threadId, only when
// the person may read it).
import type { BotActivityItem, BotActivityStatus, BotCodeWork } from "../../shared/bot-activity.ts";
import { activityStatusActive } from "../../shared/bot-activity.ts";
import { pageOpenRef } from "../../shared/page-capabilities.ts";
import { cardStale, cardStatus, placeCard, type PlaceCardInput, type TeamBoardCard, type TeamBoardLane, type TeamBoardRelease, type TeamBoardWaitingCause } from "../../shared/team-board.ts";
import type { BoardIssue, BoardPull, RepoSnapshot } from "./github-board.ts";
import { waitingOnText } from "../approvals/waiting-on.ts";
import { liveCardKind } from "../../shared/live-approval.ts";
import type { WireMessage } from "../../shared/wire.ts";

/** The open card a waiting conversation waits on (#3449), read from its
 * newest messages: an approval (a tool or a proposal) or a question. Read
 * only; the card itself is never touched. Pure. */
export function waitingCardOf(messages: readonly WireMessage[]): BoardEntry["waitingOn"] | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    const card = message.kind === "options" ? message.card : undefined;
    const kind = liveCardKind(card);
    if (!card || !kind) continue;
    const what = waitingOnText(card);
    return kind === "question"
      ? { kind: "question", ...(what ? { what } : {}) }
      : { kind: "approval", ...(what ? { what } : {}), ...(card.tool ? { tool: card.tool } : {}) };
  }
  return undefined;
}

/** How far back a team's work names its repositories and links cards. */
export const TEAM_BOARD_WORK_WINDOW_MS = 30 * 24 * 60 * 60_000;
/** Activity entries read per bot. */
export const TEAM_BOARD_ENTRIES_PER_BOT = 50;

export interface BoardBot {
  id: string;
  name: string;
  managedSections?: readonly string[];
}

export interface BoardTeam {
  sectionId: string;
  name: string;
  bots: readonly BoardBot[];
}

/** One activity entry of a team bot, with what the board needs beyond it. */
export interface BoardEntry {
  botId: string;
  item: BotActivityItem;
  /** The cause its failed turn stored (first line), when it failed. */
  failure?: string;
  /** While it waits on the person: the open card it waits on (#3449), when
   * the reader may read the conversation. */
  waitingOn?: { kind: "approval" | "question"; what?: string; tool?: string };
}

export interface BoardInput {
  teams: readonly BoardTeam[];
  /** Every bot of the person, for the lane's lead (managedSections). */
  bots: readonly BoardBot[];
  entries: readonly BoardEntry[];
  /** Conversations a handoff queued work into (coordinator live edges). */
  queued?: ReadonlySet<string>;
  /** GitHub per repository; a repository missing here has no snapshot. */
  github: ReadonlyMap<string, RepoSnapshot>;
  now: number;
  /** The reader's language, for the one label the board writes ("Not cut yet"). */
  lang?: "fr" | "en";
}

/** The label of a merge no release contains yet (#3449). */
export const NOT_CUT_YET: Record<"fr" | "en", string> = { en: "Not cut yet", fr: "Pas encore coupé" };

interface Work {
  botId: string;
  entry: BoardEntry;
  status: BotActivityStatus;
  at: number;
}

interface IssueFacts {
  repo: string;
  number: number;
  touched: Work[];
  linked: Work[];
  /** Pull request numbers a team bot's own calls produced for it. */
  botPulls: Map<number, { at: number; title?: string; url?: string; action: string }>;
}

const sectionName = (name: string) => name.trim().toLowerCase();
const repoKey = (repo: string) => repo.toLowerCase();

/** Issue numbers a branch name carries: `feat/3409-team-board`, `issue-12`. */
export function branchIssueNumbers(branch: string): number[] {
  const out: number[] = [];
  for (const match of branch.matchAll(/(?:^|[/_#-])(\d{1,7})(?=$|[/_-])/g)) {
    const number = Number(match[1]);
    if (number > 0 && !out.includes(number)) out.push(number);
  }
  return out;
}

/** The GitHub repositories a code work names, owner/name. */
function workRepos(code: BotCodeWork): string[] {
  const repos = new Set<string>();
  const add = (repo: string | undefined) => { if (repo && /^[\w.-]+\/[\w.-]+$/.test(repo)) repos.add(repo); };
  add(code.repo);
  for (const pull of code.pullRequests) add(pull.repo);
  for (const branch of code.branches) add(branch.repo);
  for (const commit of code.commits) add(commit.repo);
  for (const issue of code.issues ?? []) add(issue.repo);
  return [...repos];
}

function statusOf(entry: BoardEntry, queued: ReadonlySet<string> | undefined): BotActivityStatus {
  const { item } = entry;
  if (!activityStatusActive(item.status) && item.threadId && queued?.has(item.threadId)) return "queued";
  return item.status;
}

export function buildTeamBoard(input: BoardInput): TeamBoardLane[] {
  const since = input.now - TEAM_BOARD_WORK_WINDOW_MS;
  const botById = new Map(input.bots.map((bot) => [bot.id, bot]));
  for (const team of input.teams) for (const bot of team.bots) if (!botById.has(bot.id)) botById.set(bot.id, bot);
  // repo -> its GitHub snapshot (case-insensitive)
  const snapshots = new Map([...input.github].map(([repo, snapshot]) => [repoKey(repo), snapshot]));

  const lanes: Array<{ team: BoardTeam; repos: Map<string, string>; lastAt: Map<string, number>; facts: Map<string, IssueFacts> }> = [];
  for (const team of input.teams) {
    const members = new Set(team.bots.map((bot) => bot.id));
    const repos = new Map<string, string>();
    const lastAt = new Map<string, number>();
    const facts = new Map<string, IssueFacts>();
    const factsOf = (repo: string, number: number): IssueFacts => {
      const key = `${repoKey(repo)}#${number}`;
      let found = facts.get(key);
      if (!found) {
        found = { repo: repos.get(repoKey(repo)) ?? repo, number, touched: [], linked: [], botPulls: new Map() };
        facts.set(key, found);
      }
      return found;
    };
    for (const entry of input.entries) {
      const code = entry.item.code;
      if (!members.has(entry.botId) || !code || entry.item.updatedAt < since && !activityStatusActive(entry.item.status)) continue;
      const work: Work = { botId: entry.botId, entry, status: statusOf(entry, input.queued), at: entry.item.updatedAt };
      for (const repo of workRepos(code)) {
        if (!repos.has(repoKey(repo))) repos.set(repoKey(repo), repo);
        lastAt.set(repoKey(repo), Math.max(lastAt.get(repoKey(repo)) ?? 0, work.at));
      }
      const fallback = code.repo;
      for (const issue of code.issues ?? []) {
        const repo = issue.repo ?? fallback;
        if (repo) factsOf(repo, issue.number).touched.push(work);
      }
      const snapshotOf = (repo: string) => snapshots.get(repoKey(repo));
      // pull requests the bot produced: joined to issues by GitHub's Closes,
      // then by an issue number in their branch
      for (const pull of code.pullRequests) {
        const repo = pull.repo ?? fallback;
        if (!repo) continue;
        const github = pull.number !== undefined ? snapshotOf(repo)?.pulls.find((candidate) => candidate.number === pull.number) : undefined;
        const issues = github?.closes.length ? github.closes.map((issue) => issue.number)
          : branchIssueNumbers(pull.branch ?? github?.headRefName ?? "");
        for (const number of issues) {
          const facts = factsOf(repo, number);
          facts.linked.push(work);
          if (pull.number !== undefined) facts.botPulls.set(pull.number, { at: pull.at, action: pull.action, ...(pull.title ? { title: pull.title } : {}), ...(pull.url ? { url: pull.url } : {}) });
        }
      }
      for (const branch of code.branches) {
        const repo = branch.repo ?? fallback;
        if (repo) for (const number of branchIssueNumbers(branch.name)) factsOf(repo, number).linked.push(work);
      }
      for (const commit of code.commits) {
        const repo = commit.repo ?? fallback;
        if (repo && commit.branch) for (const number of branchIssueNumbers(commit.branch)) factsOf(repo, number).linked.push(work);
      }
    }
    lanes.push({ team, repos, lastAt, facts });
  }

  // An issue nobody touched goes to the lane with the newest work on its repository.
  const ownerOfRepo = new Map<string, number>();
  lanes.forEach((lane, index) => {
    for (const [repo, at] of lane.lastAt) {
      const current = ownerOfRepo.get(repo);
      if (current === undefined || (lanes[current]!.lastAt.get(repo) ?? 0) < at) ownerOfRepo.set(repo, index);
    }
  });
  // An issue a lane works on is drawn in that lane only once: the newest work wins.
  const claimed = new Map<string, { lane: number; at: number }>();
  lanes.forEach((lane, index) => {
    for (const [key, facts] of lane.facts) {
      const at = Math.max(0, ...facts.touched.map((work) => work.at), ...facts.linked.map((work) => work.at));
      const before = claimed.get(key);
      if (!before || before.at < at) claimed.set(key, { lane: index, at });
    }
  });

  return lanes.flatMap((lane, index): TeamBoardLane[] => {
    if (!lane.repos.size) return [];
    const cards: Array<{ card: TeamBoardCard; order: number }> = [];
    const seen = new Set<string>();
    const place = (repo: string, number: number, issue: BoardIssue | undefined, facts: IssueFacts | undefined) => {
      const key = `${repoKey(repo)}#${number}`;
      if (seen.has(key)) return;
      seen.add(key);
      const snapshot = snapshots.get(repoKey(repo));
      const card = cardFor(repo, number, issue, facts, snapshot, botById, input.now, lane.team.sectionId, input.lang ?? "en");
      if (card) cards.push(card);
    };
    for (const [key, facts] of lane.facts) {
      if (claimed.get(key)?.lane !== index) continue;
      const snapshot = snapshots.get(repoKey(facts.repo));
      const issue = snapshot ? findIssue(snapshot, facts.number) : undefined;
      // with GitHub, a number that is not an issue it knows (a branch's
      // "v2", a pull request) is no card; without it, only issues a bot touched
      if (snapshot ? !issue : !facts.touched.length) continue;
      place(facts.repo, facts.number, issue, facts);
    }
    for (const [key, repo] of lane.repos) {
      if (ownerOfRepo.get(key) !== index) continue;
      const snapshot = snapshots.get(key);
      for (const issue of snapshot?.issues ?? []) {
        if (claimed.has(`${key}#${issue.number}`)) continue;
        place(repo, issue.number, issue, undefined);
      }
    }
    const lead = input.bots.find((bot) => bot.managedSections?.some((section) => sectionName(section) === sectionName(lane.team.name)));
    // the open issues of its To do repositories the read did not load
    let todoNotLoaded = 0;
    for (const key of lane.repos.keys()) {
      if (ownerOfRepo.get(key) !== index) continue;
      const snapshot = snapshots.get(key);
      if (snapshot) todoNotLoaded += Math.max(0, snapshot.openIssues - snapshot.issues.length);
    }
    return [{
      sectionId: lane.team.sectionId,
      name: lane.team.name,
      ...(lead ? { lead: { botId: lead.id, name: lead.name } } : {}),
      repos: [...lane.repos.values()].sort((a, b) => a.localeCompare(b)),
      cards: cards.sort((a, b) => b.order - a.order).map(({ card }) => card),
      todoNotLoaded,
    }];
  });
}

function findIssue(snapshot: RepoSnapshot, number: number): BoardIssue | undefined {
  return snapshot.issues.find((issue) => issue.number === number)
    ?? snapshot.pulls.flatMap((pull) => pull.closes).find((issue) => issue.number === number);
}

/** The pull request of an issue: GitHub's that closes it, else one a team
 * bot's calls produced for it, else one whose branch names it. An open one
 * first, then the newest merge. */
function pullFor(number: number, snapshot: RepoSnapshot | undefined, facts: IssueFacts | undefined): BoardPull | undefined {
  if (!snapshot) return undefined;
  const linked = snapshot.pulls.filter((pull) => pull.closes.some((issue) => issue.number === number)
    || facts?.botPulls.has(pull.number)
    || (pull.headRefName ? branchIssueNumbers(pull.headRefName).includes(number) : false));
  return linked.find((pull) => pull.state === "open")
    ?? linked.filter((pull) => pull.state === "merged").sort((a, b) => (b.mergedAt ?? 0) - (a.mergedAt ?? 0))[0];
}

function holderOf(facts: IssueFacts | undefined): Work | undefined {
  if (!facts) return undefined;
  const all = [...facts.linked, ...facts.touched];
  const active = all.filter((work) => activityStatusActive(work.status)).sort((a, b) => b.at - a.at)[0];
  if (active) return active;
  return (facts.linked.length ? facts.linked : facts.touched).slice().sort((a, b) => b.at - a.at)[0];
}

function cardFor(
  repo: string,
  number: number,
  issue: BoardIssue | undefined,
  facts: IssueFacts | undefined,
  snapshot: RepoSnapshot | undefined,
  bots: ReadonlyMap<string, BoardBot>,
  now: number,
  sectionId: string,
  lang: "fr" | "en",
): { card: TeamBoardCard; order: number } | undefined {
  const github = pullFor(number, snapshot, facts);
  // without GitHub, what the bot did to its pull request
  const botPull = !snapshot && facts ? [...facts.botPulls.entries()].sort((a, b) => b[1].at - a[1].at)[0] : undefined;
  const holder = holderOf(facts);
  const pullState = github ? github.state
    : botPull ? (botPull[1].action === "merged" ? "merged" : botPull[1].action === "closed" ? "closed" : "open")
    : undefined;
  const mergedAt = github?.mergedAt ?? (botPull && pullState === "merged" ? botPull[1].at : undefined);
  const placeInput: PlaceCardInput = {
    // without GitHub an issue is read as open
    issueOpen: issue ? issue.open : true,
    touched: Boolean(facts?.touched.length),
    linkedWork: Boolean(facts?.linked.length) || Boolean(github),
    ...(pullState ? {
      pull: {
        state: pullState,
        ...(github?.draft ? { draft: true } : {}),
        ...(mergedAt !== undefined ? { mergedAt } : {}),
        ...(github?.reviewDecision ? { review: github.reviewDecision } : {}),
        ...(github?.changesRequestedBy ? { changesRequestedBy: github.changesRequestedBy } : {}),
        ...(github?.failingCheck ? { failingCheck: github.failingCheck } : {}),
        ...(github?.conflicting ? { conflictsWith: github.baseRefName ?? "" } : {}),
      },
    } : {}),
    ...(holder ? {
      holder: {
        status: holder.status,
        ...(holder.status === "waiting" && holder.entry.item.currentStep ? { waitingFor: holder.entry.item.currentStep } : {}),
        ...(holder.entry.failure ? { failure: holder.entry.failure } : {}),
      },
    } : {}),
    now,
  };
  const place = placeCard(placeInput);
  if (!place) return undefined;
  // the release (lot P2): a merge's from GitHub's releases, an open card's milestone
  const release: TeamBoardRelease | undefined = place.column === "merged"
    ? github?.release ? { kind: "shipped", label: github.release.label, tag: github.release.tag, ...(github.release.url ? { url: github.release.url } : {}), at: github.release.at }
      : github?.release === null ? { kind: "unreleased", label: NOT_CUT_YET[lang] }
      : undefined
    : (issue?.milestone ?? github?.milestone) ? { kind: "planned", label: (issue?.milestone ?? github?.milestone)! }
    : undefined;
  const status = cardStatus({ ...placeInput, column: place.column, released: release?.kind === "shipped" });
  const work = [...(facts?.linked ?? []), ...(facts?.touched ?? [])];
  const firstWork = work.length ? Math.min(...work.map((entry) => entry.entry.item.startedAt)) : undefined;
  const createdAt = issue?.createdAt ?? firstWork ?? github?.createdAt ?? now;
  // movement: the holder's last turn on it, the last commit, the last review, the pull request's update
  const moves = [holder?.at, github?.lastCommitAt, github?.lastReviewAt, github?.updatedAt].filter((at): at is number => typeof at === "number");
  const movedAt = moves.length ? Math.max(...moves) : undefined;
  const reviewSince = github && github.state === "open" && !github.draft ? Math.max(github.createdAt ?? 0, github.lastCommitAt ?? 0) || undefined : undefined;
  const stale = cardStale({ column: place.column, status, ...(movedAt !== undefined ? { movedAt } : {}), ...(reviewSince !== undefined ? { reviewSince } : {}), ...(place.stage ? { stage: place.stage } : {}), now });
  const step = holder?.entry.item.currentStep;
  const open = holder?.entry.waitingOn;
  const what = open?.what ?? step;
  // the card it waits on when the reader may read it, else only the step
  const youCause: Extract<TeamBoardWaitingCause, { code: "approval" | "question" | "waiting_you" }> = open?.kind === "approval"
    ? { code: "approval", params: { ...(what ? { what } : {}), ...(open.tool ? { tool: open.tool } : {}) } }
    : { code: open?.kind === "question" ? "question" : "waiting_you", params: what ? { what } : {} };
  const waiting: TeamBoardCard["waiting"] | undefined = status === "waiting_you"
    ? { on: "you", ...(step ? { reason: step } : {}), ...(holder ? { since: holder.entry.item.startedAt } : {}), ...youCause }
    : status === "waiting_review" ? { on: "review", ...(reviewSince !== undefined ? { since: reviewSince } : {}), code: "review_required", params: {} }
    : status === "waiting_release" ? { on: "release", ...(mergedAt !== undefined ? { since: mergedAt } : {}), code: "not_released", params: {} }
    : undefined;
  const bot = holder ? bots.get(holder.botId) : undefined;
  const since = holder ? (activityStatusActive(holder.status) ? holder.entry.item.startedAt : holder.at) : undefined;
  const pullUrl = github?.url ?? botPull?.[1].url;
  const pullNumber = github?.number ?? botPull?.[0];
  const card: TeamBoardCard = {
    key: `${repo}#${number}`,
    repo,
    number,
    title: issue?.title || botPull?.[1].title || `#${number}`,
    issueUrl: issue?.url ?? `https://github.com/${repo}/issues/${number}`,
    column: place.column,
    ...(place.stage ? { stage: place.stage } : {}),
    ...(holder && place.column !== "todo" ? {
      holder: {
        botId: holder.botId,
        name: bot?.name ?? holder.entry.item.botName ?? "",
        ...(holder.entry.item.threadId ? { threadId: holder.entry.item.threadId } : {}),
        // the opaque reference sagax.open accepts (a conversation only when readable)
        ref: pageOpenRef(holder.botId, holder.entry.item.threadId),
      },
    } : {}),
    ...(since !== undefined && place.column !== "todo" ? { since } : {}),
    ...(pullNumber !== undefined && pullUrl ? {
      pull: {
        number: pullNumber,
        url: pullUrl,
        ...(github?.draft ? { draft: true as const } : {}),
        ...(github?.reviewDecision ? { review: github.reviewDecision } : {}),
        ...(github?.checks ? { checks: github.checks } : {}),
      },
    } : {}),
    ...(place.blocked ? { blocked: place.blocked } : {}),
    sectionId,
    status,
    ...(waiting ? { waiting } : {}),
    createdAt,
    ...(movedAt !== undefined ? { movedAt } : {}),
    ...(stale ? { stale } : {}),
    ...(place.column === "merged" && mergedAt !== undefined ? { mergedAt } : {}),
    ...(release ? { release } : {}),
  };
  const order = place.column === "merged" ? mergedAt ?? 0 : since ?? 0;
  return { card, order };
}

