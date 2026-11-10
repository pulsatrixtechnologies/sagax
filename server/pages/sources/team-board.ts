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
import type { RequestAuth } from "../../auth/request-auth.ts";
import { boardSummary, type TeamBoard } from "../../../shared/team-board.ts";
import { buildTeamBoard, type BoardBot, type BoardEntry, type BoardTeam } from "../../team-board/board.ts";
import type { GithubBoardReader } from "../../team-board/github-board.ts";
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

/** The board of the reader `auth` is. */
export async function readTeamBoard(deps: TeamBoardSourceDeps, auth: RequestAuth, fresh: boolean): Promise<{ board: TeamBoard; topics: string[] }> {
  const person = deps.person(auth);
  if (!person) throw new PageSourceError("Sign in to see your Team board.", "sign_in", 401);
  const viewerId = deps.viewerId(auth);
  const teams = deps.teams(auth);
  const bots = deps.bots(auth);
  const members = new Map<string, BoardBot>();
  for (const team of teams) for (const bot of team.bots) members.set(bot.id, bot);
  const entries = [...members.values()].flatMap((bot) => deps.entries(bot, viewerId));
  const queued = new Set(deps.queued?.() ?? []);
  const at = (deps.now ?? Date.now)();
  // first the lanes from Sagax alone: they name the repositories to read
  const local = buildTeamBoard({ teams, bots, entries, queued, github: new Map(), now: at });
  const repos = [...new Set(local.flatMap((lane) => lane.repos))];
  const github = repos.length
    ? await deps.github.read(person, repos, { fresh })
    : { snapshots: new Map(), state: "ok" as const };
  const lanes = github.snapshots.size ? buildTeamBoard({ teams, bots, entries, queued, github: github.snapshots, now: at }) : local;
  const board: TeamBoard = {
    lanes,
    at,
    github: {
      state: github.state,
      ...("at" in github && github.at !== undefined ? { at: github.at } : {}),
      ...("fix" in github && github.fix ? { fix: github.fix } : {}),
    },
    summary: boardSummary(lanes.flatMap((lane) => lane.cards), at),
    todoTotal: Object.fromEntries([...github.snapshots].map(([repo, snapshot]) => [repo, snapshot.openIssues])),
  };
  return { board, topics: [...new Set([...members.keys(), ...bots.map((bot) => bot.id)])] };
}

/** The exits a board names (#3413 review): each card's issue and pull
 * request address, on https://github.com/, of a repository the board shows;
 * and each holder's open reference. Never a title, a reason or any other
 * free text. Pure. */
export function teamBoardExits(board: TeamBoard): { links: string[]; refs: string[] } {
  const repos = new Set(board.lanes.flatMap((lane) => lane.repos));
  const links = new Set<string>();
  const refs = new Set<string>();
  for (const card of board.lanes.flatMap((lane) => lane.cards)) {
    for (const url of [card.issueUrl, card.pull?.url]) {
      const exit = pageGithubExit(url, repos);
      if (exit) links.add(exit);
    }
    if (card.holder?.ref && parsePageOpenRef(card.holder.ref)) refs.add(card.holder.ref);
  }
  return { links: [...links], refs: [...refs] };
}

export function createTeamBoardSource(deps: TeamBoardSourceDeps): PageSource {
  return {
    name: "team-board",
    label: TEAM_BOARD_SOURCE_LABEL,
    async read(auth, { fresh }) {
      const { board, topics } = await readTeamBoard(deps, auth, fresh);
      return { value: board, topics, ...teamBoardExits(board) };
    },
  };
}
