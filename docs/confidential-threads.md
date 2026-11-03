# Confidential threads (Fil confidentiel)

A confidential thread is a 1:1 conversation with a bot that stays with the
person who owns it. Nothing of it is remembered by the bot, exported, logged
or shown to anyone else through Sagax, including the bot's owner and the
organization's admins. It exists for the work a person would not want to
land in a shared bot's memory, an export or an admin console.

Code: `server/threads/confidential-threads.ts` (the rules), with the enforcement in
`server/index.ts`, `server/bot-zip.ts`, `server/org/org-admin-files.ts`,
`server/decision-log.ts`, `server/workspace-backup.ts`,
`server/turns/turn-log.ts`, `server/sandbox/user-sandbox-routing.ts`,
`server/runtime/store.ts` (`forgetThread`), `server/messages/message-db.ts`,
`server/engines/engine-transcripts.ts` (the engines' own session files) and
`server/routes/perspicax-tool-internal.ts`. Clients:
`src/components/ConfidentialBanner.tsx`, `src/lib/confidential-thread.ts`,
`ios/Sources/CompanionCore/ConfidentialThread.swift`,
`ios/App/Features/Chat/ConfidentialBannerView.swift`.

## Turning it on

- **At creation**: New thread menu, « Nouveau fil confidentiel » / "New
  confidential thread" (`POST /api/bots/:id/tasks` with
  `confidential: true`).
- **Later**: « Rendre confidentiel » / "Make confidential" in the thread
  menu, after a confirmation that says it is permanent
  (`PATCH /api/bots/:id/tasks/:threadId` with
  `{ "confidential": true, "confirmConfidential": true }`; without the
  confirmation the server answers 400 `confirm_confidential`).
- **By default**: on an organization server an admin can make every new
  thread a person opens (the New thread menu, their first thread on a
  bot) confidential (Settings > Organisation, « Nouveaux fils
  confidentiels par défaut »; `PATCH /api/org/settings`
  `{ "confidentialThreadsByDefault": true }`, audited as `org.settings`).
  The person can still open an ordinary thread explicitly
  (`confidential: false`).

A thread that already works in a shared folder (the bot's project folder,
or one chosen when it was opened) is not converted (409
`confidential_shared_folder`): its files and checkpoints already live with
that folder. The person opens a new confidential thread instead. On an
OMB Cloud home only its owner opens confidential threads: the owner holds
the disk and every conversation on it, so a guest's could never be kept
from them.

**It is permanent.** The server refuses any change back
(`confidential: false` on a confidential thread is 409
`confidential_permanent`, confirmed or not). To work normally the person
opens a new thread; deleting the thread is the only way to end it.

The clients show it everywhere the thread appears: a classification banner
(solid band, « CONFIDENTIEL », lock icon, `role="note"`, read as « Fil
confidentiel : ce fil n'est ni mémorisé, ni exporté, ni partagé ») at the top
of the conversation and above the composer, not dismissible, with its height
reserved; a lock and « Confidentiel » on the sidebar row and in the window
title; a stamp on a Markdown export the person makes of their own thread.

## What the server does while a thread is confidential

| Path | Ordinary thread | Confidential thread |
|---|---|---|
| Automatic memory capture (upkeep) | queued after each turn | never queued; turns already waiting are dropped when the thread turns confidential |
| Daily log line (`memory/log/<day>.md`) | one per turn | none |
| `memory_update`, `memory_log`, group and team memory, rules, docs, skill staging | allowed | refused (403 `confidential_thread`) |
| Perspicax `memory_write` to a team or `org`, `memory_propose`, `memory_promote` | allowed | refused |
| Perspicax `memory_write` to the person's own tier (`me`) | allowed | `scope: "me"` is written in (an omitted scope never falls to Perspicax's own default); then it waits for the owner's Allow on a card; on Allow the bot is asked to repeat that exact write (scope, topic, title, body, tags, directory title, searchable), which a one-shot pass lets through |
| Any other Perspicax call | allowed | fail closed: only known reads pass (`api_list`, `api_search`, `api_describe`, `api_lookup`, `identity`, `memory_recall`, `memory_search`, `work_search`, `claim_list`, Perspicax's own unprefixed `find_*`, `get_*`, `read_*`, `list_*`; of a profile's tools only `<profile>_query` and `read_action`; `api_plan` only when every step passes); every other call waits for the owner's card showing the server, the tool and every argument, whole (a call too long to show whole is refused); a JSON-RPC batch is refused. The file-style `memory` tool reads freely and changes only plain paths under `/memories/me/`, with the card |
| Other MCP servers (connected apps, personal servers, the workplace, the bot's data tools) | by approval mode | a read verb with something after it passes; a read verb followed by a write verb is refused; a bare verb and anything else waits for the owner's card, whatever the approval mode (Full and always-allow included); the one-time Allow is bound to the server, the tool and the arguments |
| A bot acting as its person (`act`) from an ordinary thread | the person's routes | a request naming a confidential thread is refused (any method, Full included); lists and search hits come back without confidential threads; screen commands never open one |
| Routine results, the bot's main thread, Retry thread, pages (`propose_page`) | allowed | never into or from a confidential thread |
| Peers, rooms and channels (`ask_bot`, `delegate_bot`, `coordinate_bots`, `post_to_room`, `create_room`, `manage_room`, `act`, `start_thread` on another bot, the agent API) | allowed | refused |
| Turns that name no thread (peer asks, asides, delegations, automation) | the bot's selected thread | never a confidential thread, even its owner's selected one: the bot owner's newest ordinary conversation, else a new one |
| Threads it opens (`start_thread` on itself, parallel tasks) | ordinary | confidential, same owner |
| The follow-up of a card its owner allowed in Sagax | posted as before | posted into exactly that thread, once (a one-shot token minted only for a confidential thread), never as an on-behalf request |
| AI clients (member API and agent API: `sagax_send`, `sagax_thread`, `sagax_approve`, `read_transcript`, `send_prompt`, ...) and a bot acting as the person (`act`) | the person's threads | never listed, read, streamed or written; a request naming one is 404; one without a thread never lands in one; a card in a confidential thread is answered only by its owner in Sagax, never on their behalf |
| Recall: auto-recall, recent-work brief, `session_search`, `session_read`, `list_threads` from any other thread | narrowed per person | the thread never feeds another thread, its owner's included |
| Bot zip (owner route and console package), team backup (`POST /api/teams/export` `backup`), organization copy (`POST /api/org/export`) | included with conversations | left out: messages, files, task record, id; an import that ever carries the flag restores it confidential |
| Console file browser (`tasks`, `attachments` roots) | listed | left out of listings, reads as 404 |
| Workspace backup (an admin export) | full | task record kept as an empty "Confidential thread" (id, dates, flag); messages, read marks, follow-ups and its turns' idempotency receipts (copies of its digest rows) removed from the message database snapshot (search index rebuilt, vacuumed); every teammate-work tree it asked or did work in removed from the runtime database snapshot (vacuumed); after a confidential thread was deleted (a `confidential-forgotten` note in the data folder, cleared by the next backup) both snapshots are rebuilt and vacuumed even when no confidential thread is left, so it leaves nothing in a free page or the search index; the legacy `room-handoffs.json.migrated` is never backed up; event and native logs, legacy transcript, work folder, its own attachments and its whole Data folder (`data-scopes/<bot>/t-<hash>`: sheet, database, downloads) left out; a restore never installs that Data folder, even from an archive an older release made with it (`confidentialDataScopePath`, `server/workspace-backup-policy.ts`); the engines' own transcripts of it in the engine homes of the data folder (`principals/<person>/<engine>`, `org/<engine>-key`, `engine-policies/*`) left out, prompt histories and logs without its lines, engine databases copied as a snapshot without its rows (`confidentialEngineKeys`, `server/engines/engine-transcripts.ts`), and a restore never installs any of them, even from an archive an older release made with them |
| Engine transcripts (each engine's own copy of the conversation: Claude Code `projects/*.jsonl` and `history.jsonl`, Codex rollouts and `state_*.sqlite`, Hermes `state.db`, Grok, pi, Cursor, Gemini, Qwen, OpenCode session files) | kept by the engine in its home, backed up when that home is in the data folder | resumed across turns as for any thread; left out of the workspace backup and never installed by a restore; purged when the thread is deleted, when a thread turns confidential (its sessions so far: the next turn starts a new session with the thread's own transcript replayed), and once at start for the threads already confidential (see « Engine transcripts » below) |
| Approval cards and their notifications | bot owner | the thread owner only; a card they could not answer (an organization admin card, another person's machine) is refused instead of shown to anyone else; never in the console's organization queue |
| Incidents and refused turns | Primary Bot report with 300 characters of the request and reply; problem log row with title and notice | no text: the console's problem log and the owner's notification say only « un tour d'un fil confidentiel a échoué »; no Primary Bot report |
| Notifications (in app, push relay, iOS banners, Live Activities, widgets, share sheet) | the reply's first words | « Fil confidentiel » only; widgets leave the thread out |
| MCP permission audit rows | tool, permission, decision, resource | no resource |
| `[omb-turn]` server log line | char count only (`text=chars=N`); never the prompt (Loi 25) | `text=(confidential)` |
| Perspicax work log row | metadata row per turn | none |
| Built-in browser | the bot's persistent profile (`bot-<id>`) or a shared one | a throwaway guest session of that thread (`conf-<thread>-<random>`), never saved, discarded at the end of each turn and when the thread is deleted |
| Where it works | the speaker's or, for a routine, the bot owner's environment; the bot's project folder | always the thread owner's environment, and the thread's own folder (`task-workspaces/<bot>/<thread>`); a new confidential thread may not take another working folder |
| Data (DuckDB tables and the Data tab's sheet) | the bot's database, or on an organization server the speaker's own on a shared bot | a database and sheet of that thread only (`<data>/data-scopes/<bot>/t-<hash>`, `server/data/scope.ts`), its owner's alone (the Data tab names it with `?thread=`); no other scope of the bot reaches the thread's folder or this database; its exports and chart files land in the thread's own folder only, on solo servers too (`dataExportRootsFor`), never the bot's workspace |
| Routines | can be proposed or created with results in the thread | refused (`propose_routine` and `POST /api/routines` with that `resultsThreadId`) |
| Artifacts (`save_artifact`, ...) | saved | refused: an artifact outlives the thread and an admin may open it |
| Teammate work record (`runtime.db`: briefs, results, questions, answers of `coordinate_bots` work) | kept, pruned only with its tree | none written from it (peers refused); a thread turns confidential only when no work it asks or does is under way (409 `confidential_live_work`), and then every settled tree it asked is removed, and its rows in any other tree (another conversation's, or one still live) keep ids and status only; threads made confidential by an older release are forgotten the same way when the server starts; a confidential work thread takes no more work (the next request opens a new one) and no result of it reaches the asker |
| Decision log | rows with the call's summary | rows with ids, time, tool name, decision and who answered only; rows written before the thread turned confidential are stripped the same way, and so are rows that land after it was deleted |

## Deleting a confidential thread

`DELETE /api/bots/:id/tasks/:threadId` removes, beyond what any deleted
thread loses (messages, event and native logs):

- its work folder `task-workspaces/<bot>/<thread>` and its kept tool
  results `tool-results/<thread>`;
- its own Data database and sheet (`data-scopes/<bot>/t-<hash>`);
- the stored attachments its messages point at that no other thread points
  at;
- its waiting memory capture, its browser session, its pending memory
  passes;
- the summaries of its decision-log rows (ids, times, tool names and
  decisions stay, for the audit).
- the teammate work it asked or did (`runtime.db`): a settled tree it asked
  goes whole (rows, events, inbox); in any other tree its rows keep only ids
  and status;
- its turns' idempotency receipts in the message database (any deleted
  thread loses those);
- its own content key (`docs/content-encryption.md`): a confidential thread
  is sealed under a key of its own, wrapped under its owner's, and that key
  is destroyed with the thread (its row zeroed, the write-ahead log
  truncated), so nothing left in the live database (a row, an index entry,
  a free page) opens again (cryptographic erasure);
- the engines' own transcripts of it (below): its idle engine processes are
  asked to close (an engine whose driver keeps no warm process, or a turn
  still running elsewhere, is not waited for), the purge runs right after
  the response, again a few seconds later and once more at the next start,
  for what an engine still wrote on exit; its event and native logs are
  never written again after the deletion. Deleting a bot, or a person's
  data (Loi 25), does the same for each of their confidential threads, in
  one pass.

## Engine transcripts

Every engine that resumes a conversation keeps its own copy of it on disk,
in its home: under the data folder on a server (a person's subscription
`principals/<person>/<engine>`, a key home `principals/<person>/<engine>-key`
or `org/<engine>-key`, Hermes's `engine-policies/hermes-*`, the managed
`providers/`) and in the server user's home (`~/.claude`, `~/.codex`,
`~/.grok`, …, or the folder an engine's variable names: `CLAUDE_CONFIG_DIR`,
`CODEX_HOME`, `HERMES_HOME`, …). `server/engines/engine-transcripts.ts` finds a
thread's files by keys, never by guessing:

- the thread id: an engine that files sessions by working folder writes it
  in the folder's name, since a confidential thread always works in
  `task-workspaces/<bot>/<thread>` (Claude Code `projects/<folder>/`, Grok
  `sessions/<folder>/`, pi `sessions/--<folder>--/`, Cursor `projects/`);
- the md5 and sha256 of that folder (engines that hash it: Gemini and Qwen
  `tmp/<hash>/`, Cursor `chats/<hash>/`);
- every session id an engine announced for the thread (`session.started`),
  kept on the task as `engineSessions` (ids only, never on the wire), with
  its resume cursors and its event log for older threads.

The keys are widened from what the homes say, by structure only: the
session ids filed under a folder named by a key, the rows of an engine
database whose folder column holds one (Codex's `threads.cwd`), the
prompt-history lines whose folder (`project`, `cwd`) holds one or whose
session field is one. A prompt's text is never read for this: a person who
pasted a thread's id in another conversation keeps that conversation.
Then, in each home, an entry whose name holds a key (whatever its case)
goes whole; prompt histories (`history.jsonl`) lose the lines whose folder
or session field names a key, engine logs (`logs/*.jsonl`) the lines that
name one; Claude Code's `.claude.json` loses the `projects` entries of the
thread's folder; Gemini's `logs.json` loses its entries; a chat record
whose `sessionId` is a key goes; an engine database (`*.sqlite`, `*.db`)
loses the rows whose id column is a key or whose folder column holds one
(foreign keys not enforced while it does, full-text indexes rebuilt or
merged, then VACUUM with `secure_delete` and the WAL truncated). A
database whose bytes hold no key is never opened. Another thread's
transcript that mentions a key (a `list_threads` result) stays whole, so
its own session still resumes. A folder named after another session or
thread (a UUID in its name) is not entered, and the homes are walked once
per purge; a purge costs from a few milliseconds on a server to a second or
two on a computer whose engine homes hold tens of thousands of entries. A
variable that names a whole user home or the data folder is never taken for
an engine home. What a purge cannot finish (a database an engine holds, a
file that keeps changing) is kept (`confidential-engine-purge.json`, ids
and paths only) and retried with the next purge and at start, at most five
times, then logged for the operator.

When a thread turns confidential, and once at start for every thread
already confidential (`confidential-engine-sessions-v1` marks it done), its
cursors and kept ids are forgotten (`store.forgetEngineSessions`) and the
task is marked `rewound`: its next turn starts a new session with the
thread's own transcript replayed, never a resume of a session whose files
are gone.

By engine, what is matched (verified on disk against Claude Code 2.1.302,
Codex 0.153, Grok Build, Cursor Agent and pi; the others follow their
documented layouts and are covered by the same rules, not verified against
a real CLI here):

| Engine | Session files | Found by |
|---|---|---|
| Claude Code | `projects/<folder>/<session>.jsonl` and `<session>/`, `todos/<session>-*`, `file-history/<session>/`, `session-env/<session>/`, `debug/<session>.txt`, `history.jsonl` lines, the folder's `memory/` | folder name (thread id), session ids |
| Codex | `sessions/YYYY/MM/DD/rollout-…-<id>.jsonl`, `archived_sessions/`, `history.jsonl` lines, rows of `state_*.sqlite`, `logs_*.sqlite`, `memories_*.sqlite`, `goals_*.sqlite`, `queue_*.sqlite` | session ids, `threads.cwd` holding the thread id |
| Hermes | `sessions/` files, rows of `state.db` (sessions, messages, full-text index) | session ids |
| Grok Build | `sessions/<folder>/<session>/`, `memory-v2/workspaces/<folder>-…`, `logs/*.jsonl` lines | folder name, session ids |
| pi | `sessions/--<folder>--/…_<session>.jsonl` | folder name |
| Cursor Agent | `acp-sessions/<session>/`, `chats/<hash>/<session>/`, `projects/<folder>/` | session ids, folder name and hash |
| Gemini, Qwen | `tmp/<hash>/chats/*.json` by its `sessionId`, `tmp/<hash>/logs.json` entries | folder hash, session ids |
| Kimi, Droid, Cline, Antigravity | files and folders named by the session id | session ids |
| OpenCode | `storage/session/…/<ses_…>.json`, `storage/message/<ses_…>/`, and `storage/part/<msg_…>/` of the messages found there | session ids, then message ids |

## Honest limits

Confidential means kept from the other people **using Sagax**. It is not
end-to-end encryption, and it does not hide the thread from:

- **The server operator, and anyone with administrator access to the VM or
  cluster and its disk.** Messages are encrypted at rest under the thread's
  own key (`docs/content-encryption.md`), but the running server holds the
  keys, and whoever holds the key-encryption key (the server's key file, or
  access to the Key Vault key) can open them until the thread is deleted;
  `bots.json` holds its task record.
- **Backups made outside Sagax.** Disk and cluster backups (for example
  Velero, kept 30 days) contain whatever was on disk when they ran, deleted
  threads included until those backups expire. A thread's messages there are
  sealed, but such a copy also holds the thread's wrapped key of that time:
  with the key-encryption key, which a deletion does not change, it still
  opens. Its attachments and event logs are sealed at rest too, but an
  attachment is plain in place while a turn reads it (and for a few
  minutes after); its folder and the engines' transcripts are not
  encrypted by Sagax.
- **The model provider.** Every turn is sent to the engine the bot runs on,
  as any turn is.
- **Perspicax.** A call the person allows (a card) or a read through a
  Perspicax profile is seen by Perspicax and the outside system behind it,
  and Perspicax keeps its own audit and journal of those calls.
- **Engines with host access.** On a solo server, a bot whose engine has
  a shell on the host can call this server's own loopback API directly,
  outside the tools the rules above judge. Confidential mode does not
  sandbox an engine that has host access.
- **Tools that read by sending.** A tool named like a read that sends its
  arguments to a third party (a web fetch or search, the built-in browser
  opening a page, a connected app's search) still works from a confidential
  thread, with whatever the bot puts in its arguments: the words of the
  thread can leave that way, in a URL or a query.
- **Automation threads.** The organization default does not make a
  routine's run, a webhook's thread or a teammate's work thread
  confidential: their results are delivered elsewhere by design. A
  confidential thread cannot start any of them.
- **The person's own environment and tools.** The bot's file tools run on
  the host or the person's environment, which is directory organization,
  not a sandbox between threads: the prompt tells a confidential turn to
  keep its files in its own folder, but an engine with host file access
  could still read or write elsewhere. Files staged into the person's server
  environment stay there.
- **What happened before it turned confidential.** A thread made
  confidential later keeps where it worked so far (its folder pin), and
  memory captured or daily log lines written from it before the change stay
  in the bot's memory until edited. Its decision rows are stripped at the
  change.
- **Engine memories that mix sessions.** An engine's own memory, when its
  operator turned it on, consolidates several sessions into one file:
  Codex's `memories/` (its memory feature, off by default; its per-thread
  rows are purged), Grok's `memory-v2/global`, Hermes's `memories/` on a
  solo server (its memory tools are withheld on an organization server).
  Those files cannot be split by thread and stay until edited.
- **Engine transcripts Sagax cannot tie to the thread.** A session id an
  engine never announced, a file an engine names only by a hash of something
  else than the thread's folder, a row an engine database files under no
  session (Codex `logs_*.sqlite` rows without a `thread_id`), a session kept
  outside the homes above (a custom location in an engine's own settings, a
  home inside a container computer such as `vm-home/`), or a history or log
  file over 64 MB (a backup then leaves it out, a purge retries it) is not
  found or cleaned. A thread deleted by a release before this one left its
  transcripts on disk: their ids are gone with the thread. An archive made
  by an older release carries no event log and no resume cursor of a
  confidential thread, so a restore removes what its folder name, its
  folder's hashes and the archive's engine databases tie to it, not a
  session only those would have named (Hermes, a key home's sessions).
- **Its owner.** The person can still copy, export or forward what they
  wrote; push notifications of their own thread go to their own devices.

For the most sensitive work, use a local (solo) Sagax on your own computer:
nobody else has the disk, the backups or the server log.
