// The bot panel's Coding branches, acted on by the person (Details >
// Coding): read a branch now, commit, push, open a pull request, read its
// diff, delete the local branch, archive it in the person's own list.
//
//   GET  /api/bots/:id/code/branch?threadId=&branch=        state, place, proposed message
//   GET  /api/bots/:id/code/branch/diff?threadId=&branch=   its diff against its base
//   GET  /api/bots/:id/code/branch/pull?threadId=&branch=   its pull request on GitHub, if any
//   POST /api/bots/:id/code/branch/(commit|push|pr|delete)  { threadId, branch, ... }
//   GET  /api/bots/:id/code/branches/archived               the person's archived keys
//   POST /api/bots/:id/code/branches/archived               { key, archived }
//
// Where: the computer and folder the thread's own git ran in for that branch
// (server/remote-support/branch-place.ts). On the person's cloud computer
// (their server environment), their own computer or its Local VM through
// their desktop app, a solo server's Local VM, or a computer reached through
// a remote session, the same actions run there, through the channel the
// bot's commands used (`place: "remote"`, `computer` says which). Else the
// thread's own folder (`cwd`) when it is a git repository on this server
// (`place: "server"`). A branch no channel reaches reads `place:
// "elsewhere"`: nothing runs, and the panel offers to ask the bot.
//
// Who: the person whose panel it is. The thread must be one they may post
// in (thread.post; not theirs reads exactly like not there), and the branch
// must be one that thread worked on. Their own work on their own branch
// asks no approval. Push and pull requests use their own credentials: on a
// solo server the server is their computer (their git and gh sign-in); on
// an organization server only their own GitHub connection, never the
// server's or the organization's (`credentials` returns none and the
// action is refused with `github_not_connected`). On the person's cloud
// computer only their own credentials are there too: their GitHub
// connection signs the push and the pull request when they connected one,
// else that environment's own sign-in, which only they made (Sagax puts
// nothing else there; when GitHub refuses it, `github_not_connected`), and
// a commit there is authored by them when their name and email are known
// (server/remote-support/remote-code-branches.ts). Their own computer, its
// Local VM and a client's computer use that computer's own sign-in; no
// token is sent there. Only the viewer's own cloud computer and own desktop
// are ever reached, never the bot owner's or anyone else's. On an
// organization server a request with no person is refused (`no_person`),
// never run with the server's identity, and no answer carries a full server
// path.
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";
import { CodeWorkCollector, type CodeWorkToolCall, type RepositoryInfo } from "../activity-code-work.ts";
import { BranchActionError, BranchArchive, BranchGit, BranchPulls, folderName, githubRepo, hostGit, proposedMessage, redactPaths, validBranchName, type GitExec } from "../code-branches.ts";
import { branchWorkPlace, type BranchComputer, type BranchWorkPlace } from "../remote-support/branch-place.ts";
import { locateBranchFolder, RemoteBranchGit, type RemoteBranchCredentials, type RemoteExec } from "../remote-support/remote-code-branches.ts";
import type { BotBranchActionBody, BotBranchInfo, BotBranchState } from "../../shared/bot-code-branches.ts";

/** The bot's computer that holds a branch (read off the thread: where its
 * git ran), as its channel sees it now. */
export interface RemoteBranchReach {
  /** That computer is one this person has (a channel to it exists). */
  computer: boolean;
  /** It can be reached right now (a cloud computer that runs, a desktop app
   * that is connected, a remote session that is up). */
  online: boolean;
  /** Its name, never an address. */
  host?: string;
  /** Its OS is known to be macOS or Linux (git runs on a POSIX shell only). */
  osKnown: boolean;
  /** Windows: no command runs there from the panel yet (review of #965). */
  windows?: boolean;
}

export interface RemoteBranchDeps {
  /** The computer `place` names, for this viewer (their own cloud computer,
   * their own desktop, this bot's remote session), or null when there is no
   * channel to it (then the branch stays "elsewhere"). */
  reach(botId: string, threadId: string, viewerId: string | undefined, place: BranchWorkPlace): RemoteBranchReach | null | Promise<RemoteBranchReach | null>;
  /** One shell command on that computer, through the channel the bot's own
   * commands used, bound to this bot, conversation and acting person
   * (never another person's computer). */
  exec(botId: string, threadId: string, viewerId: string | undefined, place: BranchWorkPlace): RemoteExec;
}

export interface BranchTask {
  threadId: string;
  title: string;
  cwd?: string | null;
}

/** What the person's git work runs with. */
export interface BranchCredentials {
  /** An organization server: git and gh see no home, ssh agent or config
   * of the server's. */
  isolated?: boolean;
  /** Every git call (never a token). */
  git: Record<string, string>;
  /** The commit's author: the person. Required on an organization server. */
  author?: { name: string; email: string };
  /** Their GitHub token: `push` for the push call only, `gh` for gh. Absent:
   * not connected, and push and pull requests are refused. */
  publish?: { push: Record<string, string>; gh: Record<string, string> };
}

export interface BotCodeBranchRouteDeps {
  bot(id: string): { id: string; name: string } | null | undefined;
  tasks(botId: string): BranchTask[];
  /** undefined on a solo server or for the operator. */
  viewerId(auth: RequestAuth): string | undefined;
  /** The viewer may post in that thread (thread.post). */
  threadWritable(botId: string, threadId: string, viewerId: string | undefined): boolean;
  messages(threadId: string, limit: number): { messages: Array<{ at: number; tool?: CodeWorkToolCall }> };
  repository(cwd: string): RepositoryInfo | undefined;
  organization(): boolean;
  credentials(viewerId: string | undefined): BranchCredentials;
  archive: BranchArchive;
  /** One line in the admin activity log (who, what, which branch). */
  audit(auth: RequestAuth, action: string, target: { botId: string; branch: string; repo?: string }, after?: Record<string, unknown>): void;
  exec?: GitExec;
  /** How a branch whose repository is on the bot's own computer is reached
   * and acted on. Absent: no such transport (the branch stays "elsewhere"). */
  remote?: RemoteBranchDeps;
  /** The bot's own folder in the person's cloud computer, where its
   * commands start there (server/sandbox-bot-folder.ts), when known. */
  sandboxFolder?(botId: string): string | null;
  /** The viewer's own GitHub connection token, for a push or a pull request
   * from their cloud computer; undefined when they connected none. */
  githubToken?(viewerId: string | undefined): string | undefined;
}

const SCAN = 500;
const ACTIONS = new Set(["commit", "push", "pr", "delete"]);

/** Why a branch on the bot's own computer cannot be acted on right now. The
 * UI words these by code (and offers to ask the bot); these are the
 * fallback when it does not. */
const REMOTE_BLOCKED: Record<"offline" | "no_path" | "unknown_os", string> = {
  offline: "The computer that holds this branch cannot be reached right now. Ask the bot to do it.",
  no_path: "The folder where the bot worked on this branch is not known. Ask the bot to do it.",
  unknown_os: "That computer's operating system is not known yet, or it runs Windows, so no command runs there. Ask the bot to do it.",
};

export function createBotCodeBranchRoutes(deps: BotCodeBranchRouteDeps): RouteHandler {
  const exec = deps.exec ?? hostGit;

  /** The branch's repository on this server (the thread's own folder), and
   * where the thread's git ran for it, if the thread worked on that branch. */
  function resolve(botId: string, threadId: string, branch: string, viewerId: string | undefined): { task: BranchTask; repository?: RepositoryInfo; place?: BranchWorkPlace } | null {
    const task = deps.tasks(botId).find((entry) => entry.threadId === threadId);
    if (!task || !deps.threadWritable(botId, threadId, viewerId)) return null;
    const repository = task.cwd ? deps.repository(task.cwd) : undefined;
    const messages = deps.messages(threadId, SCAN).messages;
    const collector = new CodeWorkCollector(repository?.origin);
    for (const message of messages) if (message.tool) collector.add(message.tool, message.at);
    const work = collector.result();
    // Only a branch the thread itself worked on (never the folder's
    // checked-out branch just because it is there: often the default one).
    const known = work.branches.some((entry) => entry.name === branch)
      || work.commits.some((entry) => entry.branch === branch);
    if (!known) return null;
    const place = branchWorkPlace(messages, branch, { sandboxFolder: deps.sandboxFolder?.(botId) ?? null, threadFolder: task.cwd ?? null });
    return { task, repository, ...(place ? { place } : {}) };
  }

  /** On an organization server, a state with the worktree's folder name only. */
  function shown(state: BotBranchState): BotBranchState {
    return deps.organization() && state.worktree ? { ...state, worktree: folderName(state.worktree) } : state;
  }

  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const archived = path.match(/^\/api\/bots\/([\w-]+)\/code\/branches\/archived$/);
    const single = path.match(/^\/api\/bots\/([\w-]+)\/code\/branch(?:\/(diff|pull|commit|push|pr|delete))?$/);
    if (!archived && !single) return PASS;
    const bot = deps.bot((archived ?? single)![1]!);
    if (!bot) return json(res, 404, { error: "no such bot" });
    const viewerId = deps.viewerId(auth);
    // An organization server acts only for a known person, never as itself.
    if (deps.organization() && !viewerId) return json(res, 403, { error: "Sign in as yourself to act on a branch here.", code: "no_person" });
    const person = viewerId ?? "owner";

    if (archived) {
      if (method === "GET") return json(res, 200, { keys: deps.archive.list(person, bot.id) });
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const body = await readBody(req) as { key?: unknown; archived?: unknown } | undefined;
      const key = typeof body?.key === "string" ? body.key : "";
      if (!key || key.length > 600) return json(res, 400, { error: "key is required" });
      const keys = deps.archive.set(person, bot.id, key, body?.archived !== false);
      deps.audit(auth, body?.archived === false ? "code.branch.unarchive" : "code.branch.archive", { botId: bot.id, branch: key });
      return json(res, 200, { keys });
    }

    const action = single![2];
    const reading = !action || action === "diff" || action === "pull";
    if (reading ? method !== "GET" : method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body: Partial<BotBranchActionBody> = reading
      ? { threadId: url.searchParams.get("threadId") ?? "", branch: url.searchParams.get("branch") ?? "" }
      : (await readBody(req) as Partial<BotBranchActionBody> | undefined) ?? {};
    const threadId = typeof body.threadId === "string" ? body.threadId : "";
    const branch = typeof body.branch === "string" ? body.branch : "";
    if (!threadId || !validBranchName(branch)) return json(res, 400, { error: "threadId and a valid branch are required" });
    const found = resolve(bot.id, threadId, branch, viewerId);
    if (!found) return json(res, 404, { error: "no such branch" });
    const { task, repository, place } = found;

    // The thread's git ran on one of the bot's computers: act there. A
    // branch with no recorded place whose repository is not here either may
    // still be on this bot's remote session, in the thread's own folder
    // there (how a remote session's thread works).
    const onComputer = place && place.computer !== "host" ? place : undefined;
    const elsewhere = onComputer ?? (repository ? undefined : { computer: "remote_session" as const, ...(task.cwd?.trim() ? { folder: task.cwd.trim() } : {}), others: [] });
    const reach = elsewhere && deps.remote ? await deps.remote.reach(bot.id, threadId, viewerId, elsewhere) : null;
    // A computer no channel reaches, while the thread's own folder is a
    // repository here: this server's, as before (a solo server's own shell
    // can carry a computer tool's name).
    if (elsewhere && (!repository || reach?.computer)) {
      const target: BranchWorkPlace = elsewhere;
      if (!reach || !reach.computer) {
        // No computer this person has: nothing this server can act on.
        if (!action) return json(res, 200, { branch, place: "elsewhere", canPublish: false, publishBlocked: "elsewhere" } satisfies BotBranchInfo);
        return json(res, 409, { error: "Sagax cannot tell which computer holds this branch, so its actions run where the bot worked. Ask the bot to do it.", code: "elsewhere" });
      }
      const computer = target.computer as BranchComputer;
      const where: Pick<BotBranchInfo, "place" | "computer" | "host"> = { place: "remote", computer, ...(reach.host ? { host: reach.host } : {}) };
      /** The computer is there but the panel cannot act on it: one plain reason. */
      const blocked = (code: "offline" | "no_path" | "unknown_os") => {
        if (!action) {
          return json(res, 200, {
            branch,
            ...where,
            canPublish: false,
            ...(code === "offline" ? { offline: true, publishBlocked: "offline" as const } : {}),
            ...(code === "no_path" ? { noPath: true } : {}),
            ...(code === "unknown_os" ? { publishBlocked: "unknown_os" as const, ...(reach.windows ? { windows: true } : {}) } : {}),
          } satisfies BotBranchInfo);
        }
        return json(res, code === "offline" ? 502 : 409, { error: REMOTE_BLOCKED[code], code });
      };
      if (!reach.online) return blocked("offline");
      if (!reach.osKnown || reach.windows) return blocked("unknown_os");
      // "" is a folder too: where that computer's commands start (a git run
      // there with no cd)
      const folders = [target.folder, ...target.others].filter((folder): folder is string => typeof folder === "string");
      if (!folders.length) return blocked("no_path");
      const exec = deps.remote!.exec(bot.id, threadId, viewerId, target);
      // Their cloud computer: signed by the person (their GitHub connection,
      // else that environment's own sign-in, theirs) and authored by them.
      // Any other computer: its own sign-in, and no token is sent there.
      const token = computer === "sandbox" ? deps.githubToken?.(viewerId) : undefined;
      const credentials: RemoteBranchCredentials = computer === "sandbox" ? { mode: "person", ...(token ? { token } : {}) } : { mode: "computer" };
      const audited = { on: "bot_computer", computer };
      const targetRow = { botId: bot.id, branch };
      try {
        // Where the bot ran git for it, else another folder it ran git in
        // there (one round trip), as its real path on that computer.
        const located = await locateBranchFolder(exec, branch, folders);
        if (!located) return blocked("no_path");
        const cwd = located.folder;
        const git = new RemoteBranchGit(exec, cwd, branch, credentials);
        if (!action) {
          const state = await git.state();
          const repoName = await git.originRepo();
          // Every computer here has a sign-in of the person's own to try
          // (their cloud computer's falls back to its own when they connected
          // no GitHub account): a refusal comes back from the action itself.
          const info: BotBranchInfo = {
            branch,
            ...where,
            folderName: folderName(cwd),
            ...(repoName ? { repo: repoName } : {}),
            state,
            proposedMessage: proposedMessage(state.changes, task.title),
            canPublish: true,
          };
          return json(res, 200, info);
        }
        if (action === "diff") return json(res, 200, await git.diff(computer === "sandbox" ? 900 * 1024 : 2 * 1024 * 1024));
        // A live pull request read needs gh on the computer; the card keeps
        // what the bot's own calls said in the meantime.
        if (action === "pull") return json(res, 200, { pull: null });
        if (!ACTIONS.has(action)) return json(res, 404, { error: "no such action" });
        if (action === "commit") {
          const paths = Array.isArray(body.paths) ? body.paths.filter((entry): entry is string => typeof entry === "string").slice(0, 500) : undefined;
          const message = typeof body.message === "string" ? body.message : "";
          // their cloud computer: authored by the person when their name and
          // email are known, else that environment's own identity (none at
          // all: no_author)
          const author = computer === "sandbox" ? deps.credentials(viewerId).author : undefined;
          const { sha } = await git.commit(message, paths, author?.name.trim() && author.email.trim() ? author : undefined);
          deps.audit(auth, "code.branch.commit", targetRow, { sha: sha.slice(0, 12), files: paths?.length ?? "all", ...audited });
          return json(res, 200, { ok: true, sha, state: await git.state() });
        }
        if (action === "push") {
          const { remote } = await git.push();
          deps.audit(auth, "code.branch.push", targetRow, { remote, ...audited });
          return json(res, 200, { ok: true, remote, state: await git.state() });
        }
        if (action === "pr") {
          const out = await git.openPr(task.title);
          deps.audit(auth, "code.branch.pull_request", targetRow, out.pull ? { number: out.pull.number, url: out.pull.url, ...audited } : { compareUrl: out.compareUrl, ...audited });
          return json(res, 200, { ok: true, ...(out.pull ? { pull: out.pull } : {}), ...(out.compareUrl ? { compareUrl: out.compareUrl } : {}), state: await git.state() });
        }
        await git.deleteLocal(body.confirmUnpushed === true);
        deps.audit(auth, "code.branch.delete", targetRow, { confirmedUnpushed: body.confirmUnpushed === true, ...audited });
        return json(res, 200, { ok: true });
      } catch (error) {
        if (error instanceof BranchActionError) {
          // A read that finds the computer gone answers like an offline one;
          // one that finds it busy fails (the panel offers to ask the bot,
          // or to try again).
          if (!action && error.code === "offline") return blocked("offline");
          return json(res, error.status, { error: error.message, code: error.code });
        }
        return json(res, 500, { error: "git failed on this branch." });
      }
    }

    // (never reached: a branch with no repository here went the way above)
    if (!repository) return json(res, 404, { error: "no such branch" });
    const organization = deps.organization();
    const credentials = deps.credentials(viewerId);
    const isolated = organization || credentials.isolated === true;
    const git = new BranchGit(exec, { root: repository.root, branch }, { env: credentials.git, pushEnv: credentials.publish?.push, isolated });
    const origin = await git.originUrl();
    const repo = githubRepo(origin);
    const publish = credentials.publish;
    const publishBlocked: BotBranchInfo["publishBlocked"] = !publish ? "github_not_connected" : undefined;
    const target = { botId: bot.id, branch, ...(repository.origin?.repo ? { repo: repository.origin.repo } : {}) };

    try {
      if (!action) {
        // On an organization server a server path means nothing to the
        // person: the folder's name only.
        const state = shown(await git.state());
        const info: BotBranchInfo = {
          branch,
          place: "server",
          folderName: folderName(repository.root),
          ...(repository.origin?.repo ? { repo: repository.origin.repo } : {}),
          state,
          proposedMessage: proposedMessage(state.changes, task.title),
          canPublish: !publishBlocked,
          ...(publishBlocked ? { publishBlocked } : {}),
        };
        return json(res, 200, info);
      }
      if (action === "diff") return json(res, 200, await git.diff());
      if (action === "pull") {
        if (!repo) return json(res, 200, { pull: null, reason: "not_github" });
        if (!publish) return json(res, 200, { pull: null, reason: "github_not_connected" });
        const pull = await new BranchPulls(exec, repository.root, repo, { ...credentials.git, ...publish.gh }, isolated).find(branch);
        return json(res, 200, { pull: pull ?? null });
      }
      if (!ACTIONS.has(action)) return json(res, 404, { error: "no such action" });

      if (action === "commit") {
        const paths = Array.isArray(body.paths) ? body.paths.filter((entry): entry is string => typeof entry === "string").slice(0, 500) : undefined;
        const message = typeof body.message === "string" ? body.message : "";
        const author = credentials.author;
        if (organization && !(author?.name.trim() && author.email.trim())) return json(res, 403, { error: "Your name and email are needed to sign a commit here. Add them to your profile first.", code: "no_author" });
        const { sha } = await git.commit(message, paths, author);
        deps.audit(auth, "code.branch.commit", target, { sha: sha.slice(0, 12), files: paths?.length ?? "all" });
        return json(res, 200, { ok: true, sha, state: shown(await git.state()) });
      }
      if (action === "push") {
        if (!publish) return json(res, 403, { error: "Connect your own GitHub account to push from here (the GitHub plugin's page, Capabilities > Sources > GitHub connection). The server's credentials are never used for you.", code: "github_not_connected" });
        if (organization && !repo) return json(res, 409, { error: "On this server, a branch is pushed only to an https GitHub remote, with your own GitHub connection.", code: "not_github" });
        const { remote } = await git.push(organization ? repo : undefined);
        deps.audit(auth, "code.branch.push", target, { remote });
        return json(res, 200, { ok: true, remote, state: shown(await git.state()) });
      }
      if (action === "pr") {
        if (!repo) return json(res, 409, { error: "Pull requests are opened on GitHub only, and this repository's origin is not on GitHub.", code: "not_github" });
        if (!publish) return json(res, 403, { error: "Connect your own GitHub account to open a pull request from here (the GitHub plugin's page, Capabilities > Sources > GitHub connection).", code: "github_not_connected" });
        const state = await git.state();
        if (state.isDefault) return json(res, 409, { error: "The default branch is not proposed from here.", code: "default_branch" });
        if (!state.pushed) return json(res, 409, { error: "Push the branch first: GitHub has no commits for it yet.", code: "not_pushed" });
        const subjects = await git.subjects(await git.base());
        const pull = await new BranchPulls(exec, repository.root, repo, { ...credentials.git, ...publish.gh }, isolated).open(branch, subjects, task.title);
        deps.audit(auth, "code.branch.pull_request", target, { number: pull.number, url: pull.url });
        return json(res, 200, { ok: true, pull, state: shown(state) });
      }
      // delete
      await git.deleteLocal(body.confirmUnpushed === true);
      deps.audit(auth, "code.branch.delete", target, { confirmedUnpushed: body.confirmUnpushed === true });
      return json(res, 200, { ok: true });
    } catch (error) {
      if (error instanceof BranchActionError) return json(res, error.status, { error: organization ? redactPaths(error.message) : error.message, code: error.code });
      return json(res, 500, { error: "git failed on this branch." });
    }
  };
}
