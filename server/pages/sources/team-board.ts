// The `team-board` page source (#3413, from #3409): the Team board of the
// reader, computed on demand. Read only: nothing is written, no bot turn is
// spent, no message is posted, nothing runs when nobody asks.
//
// Per person: the lanes are the reader's own teams with their own bots
// (`teams`), the entries are what those bots did as the reader may read it
// (`entries`, the bot activity list behind threadReadable), and GitHub is
// read with the reader's own account, cached per person AND repository
// (server/team-board/github-board.ts). Never the page owner's: the source
// only ever gets the reader's `auth`. `fresh` skips the GitHub cache.
//
// Filter (#3449), so a `too_large` answer can be asked again on a smaller
// scope: `team` (one of the reader's own lanes, by its sectionId) reads
// GitHub for that lane's repositories only; `column` keeps one column. Both
// are checked against the reader's own teams and the known columns; anything
// else is refused (400 bad_request) before anything is read. The GitHub
// cache stays keyed by person and repository: a repository's snapshot does
// not depend on the filter, and a filtered read of one person never serves
// another.
import type { RequestAuth } from "../../auth/request-auth.ts";
import { boardSummary, TEAM_BOARD_COLUMNS, type TeamBoard, type TeamBoardColumn } from "../../../shared/team-board.ts";
import { buildTeamBoard, type BoardBot, type BoardEntry, type BoardTeam } from "../../team-board/board.ts";
import type { GithubBoardRead, GithubBoardReader } from "../../team-board/github-board.ts";
import { pageGithubExit, parsePageOpenRef } from "../../../shared/page-capabilities.ts";
import { PageSourceError, type PageSource } from "../page-sources.ts";

export interface TeamBoardSourceDeps {
  /** The signed-in reader (the GitHub cache key); undefined: nobody. */
  person(auth: RequestAuth): string | undefined;
  /** Who reads the bots' conversations (channelFilterViewerId). */
  viewerId(auth: RequestAuth): string | undefined;
  /** The reader's own teams, each with the reader's own bots in it. */
  teams(auth: RequestAuth): readonly BoardTeam[];
  /** Every bot of the reader (the lane's lead is one of them). */
  bots(auth: RequestAuth): readonly BoardBot[];
  /** A bot's activity entries with code work, as this viewer may read them. */
  entries(bot: BoardBot, viewerId: string | undefined): BoardEntry[];
  /** Conversations a live handoff queued work into. */
  queued?(): Iterable<string>;
  github: GithubBoardReader;
  now?: () => number;
}

export const TEAM_BOARD_SOURCE_LABEL = "The work of your coding teams";

export type TeamBoardFilter = NonNullable<TeamBoard["filter"]>;

/** The filter a page asked for, checked against the reader's own teams, or
 * a PageSourceError (bad_request). Pure. */
export function teamBoardFilter(params: Record<string, unknown>, teams: readonly BoardTeam[]): TeamBoardFilter {
  const refuse = () => new PageSourceError("This filter is not valid.", "bad_request", 400);
  const filter: TeamBoardFilter = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (key === "team") {
      if (typeof value !== "string" || !teams.some((team) => team.sectionId === value)) throw refuse();
      filter.team = value;
    } else if (key === "column") {
      if (typeof value !== "string" || !(TEAM_BOARD_COLUMNS as readonly string[]).includes(value)) throw refuse();
      filter.column = value as TeamBoardColumn;
    } else {
      throw refuse();
    }
  }
  return filter;
}

/** The board of the reader `auth` is. */
export async function readTeamBoard(deps: TeamBoardSourceDeps, auth: RequestAuth, fresh: boolean, options: { params?: Record<string, unknown>; lang?: "fr" | "en" } = {}): Promise<{ board: TeamBoard; topics: string[] }> {
  const person = deps.person(auth);
  if (!person) throw new PageSourceError("Sign in to see your Team board.", "sign_in", 401);
  const viewerId = deps.viewerId(auth);
  const teams = deps.teams(auth);
  const filter = teamBoardFilter(options.params ?? {}, teams);
  const lang = options.lang ?? "en";
  const bots = deps.bots(auth);
  const members = new Map<string, BoardBot>();
  for (const team of teams) for (const bot of team.bots) members.set(bot.id, bot);
  const entries = [...members.values()].flatMap((bot) => deps.entries(bot, viewerId));
  const queued = new Set(deps.queued?.() ?? []);
  const at = (deps.now ?? Date.now)();
  // first the lanes from Sagax alone: they name the repositories to read
  const local = buildTeamBoard({ teams, bots, entries, queued, github: new Map(), now: at, lang });
  const inScope = (lanes: typeof local) => (filter.team ? lanes.filter((lane) => lane.sectionId === filter.team) : lanes);
  // only the repositories of the lanes asked for are read
  const repos = [...new Set(inScope(local).flatMap((lane) => lane.repos))];
  const github: GithubBoardRead = repos.length
    ? await deps.github.read(person, repos, { fresh })
    : { snapshots: new Map(), state: "ok" };
  const built = github.snapshots.size ? buildTeamBoard({ teams, bots, entries, queued, github: github.snapshots, now: at, lang }) : local;
  const lanes = inScope(built).map((lane) => (filter.column ? { ...lane, cards: lane.cards.filter((card) => card.column === filter.column) } : lane));
  const releases = [...github.snapshots].flatMap(([repo, snapshot]) => (snapshot.releases ?? []).map((release) => ({ repo, label: release.label, tag: release.tag, ...(release.url ? { url: release.url } : {}), at: release.at })))
    .sort((a, b) => b.at - a.at);
  const board: TeamBoard = {
    lanes,
    at,
    github: {
      state: github.state,
      ...(github.at !== undefined ? { at: github.at } : {}),
      ...(github.fix ? { fix: github.fix } : {}),
      ...(github.reason ? { reason: github.reason } : {}),
    },
    summary: boardSummary(lanes.flatMap((lane) => lane.cards), at),
    todoTotal: Object.fromEntries([...github.snapshots].map(([repo, snapshot]) => [repo, snapshot.openIssues])),
    releases,
    ...(filter.team || filter.column ? { filter } : {}),
  };
  return { board, topics: [...new Set([...members.keys(), ...bots.map((bot) => bot.id)])] };
}

/** The exits a board names (#3413 review): each card's issue and pull
 * request address, and each release page (#3449), on https://github.com/,
 * of a repository the board shows; and each holder's open reference. Never a
 * title, a reason or any other free text. Pure. */
export function teamBoardExits(board: TeamBoard): { links: string[]; refs: string[] } {
  const repos = new Set(board.lanes.flatMap((lane) => lane.repos));
  const links = new Set<string>();
  const refs = new Set<string>();
  for (const card of board.lanes.flatMap((lane) => lane.cards)) {
    for (const url of [card.issueUrl, card.pull?.url, card.release?.url]) {
      const exit = pageGithubExit(url, repos);
      if (exit) links.add(exit);
    }
    if (card.holder?.ref && parsePageOpenRef(card.holder.ref)) refs.add(card.holder.ref);
  }
  for (const release of board.releases ?? []) {
    const exit = pageGithubExit(release.url, repos);
    if (exit) links.add(exit);
  }
  return { links: [...links], refs: [...refs] };
}

export function createTeamBoardSource(deps: TeamBoardSourceDeps): PageSource {
  return {
    name: "team-board",
    label: TEAM_BOARD_SOURCE_LABEL,
    async read(auth, { params, fresh, lang }) {
      const { board, topics } = await readTeamBoard(deps, auth, fresh, { params, ...(lang ? { lang } : {}) });
      return { value: board, topics, ...teamBoardExits(board) };
    },
  };
}
