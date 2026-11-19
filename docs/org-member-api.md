# Organization member API (`/api/org/member/*`)

What a person may do with their own Sagax bots from an AI client attached to
Perspicax (Claude Code, claude.ai, Cursor, any MCP client), under their own
identity. Perspicax serves it as its `sagax_*` tools. Plan: Perspicax
`docs/superpowers/plans/2026-10-09-master-implementation-plan.md`, lot C.1.
Code: `server/org/org-member-routes.ts`, wired in `server/index.ts`
(`createOrgMemberRoutes`, `performAsMember`).

## The gate

- Answered before the session gate and before loopback trust, like the
  admin API (`docs/org-admin-api.md`). The only credential is an assertion
  Perspicax signs per request (`Authorization: Bearer <assertion>`): the
  console assertion's format (`typ` `pulsabot-console+jwt`, ES256, `aud` this
  server's public origin, at most 120 s, single use `jti`, `server_id` equal
  to the link's, `role`, `teams`), with `act.sub` `perspicax-mcp` (an AI
  client) or `console`. The admin API keeps accepting `console` only: an AI
  client's assertion is refused there (`401 assertion_invalid`).
- The person is the assertion's `sub`. They must be known here (the
  directory lists them), active in Perspicax and not turned off in Sagax:
  else `403 unknown_person` or `403 person_disabled`. A person does not
  need to have signed in to Sagax.
- An admin is an organization admin both in the assertion (`role: admin`)
  and on this server.
- Each route needs one permission of the catalogue (`shared/permissions.ts`,
  group `clients`). Without it: `403 forbidden_permission` with
  `permission` naming the key. An admin holds every key.
- The route then performs the matching Sagax route **as the person**,
  through a 60 s session of theirs (`SessionRegistry.actAs`, memory only, not
  listed, not renewed, revoked after the call). Every rule the person meets
  in Sagax holds unchanged: which bots they see, private threads, who may
  answer a card, who may Run now. A refusal of that route passes through
  with its status, its sentence and its `permission` when it names one.
- A refusal is `{code, message, reason, error}` like the admin API. Every
  answer carries `X-Sagax-Member-Api: 1` and `Cache-Control: no-store`.
- Every write leaves one row of the admin activity log, category `client`,
  actor `{kind: "person", principalId, via: "perspicax-mcp"}` (`console`
  when the console signed it). No row carries a message text.

## Permissions

| Key | Member default | What |
|---|---|---|
| `clients.botsRead` | on | list their bots, read their conversations, and read rules, documents, memory and connector names of bots they own |
| `clients.botsMessage` | on | send a message and wait for the answer |
| `clients.routinesRun` | on (always) | run a routine now, read a run |
| `clients.routinesRead` | on (always) | list their own routines and read one routine's full instructions |
| `clients.routinesWrite` | on (always) | enable, disable, rename, and edit schedule or instructions of routines they own |
| `clients.approvalsAnswer` | off (the bot's owner holds it for their own bots) | allow or deny a card |
| `clients.peopleNudge` | off | nudge a person |
| `clients.agentsCreate` | on (always) | create a bot with `agents/create_agent`; archive, restore or delete one for good with `agents/delete_agent` |

Keys have two segments (`group.name`): Perspicax refuses a catalogue with
any other shape, so the plan's `clients.bots.read` is written
`clients.botsRead`.

## Routes

| Method and path | Permission | What |
|---|---|---|
| `GET capabilities` | none | the version and the routes |
| `GET bots` | `clients.botsRead` | the bots the person can see, with status |
| `POST bots/{id}/messages` | `clients.botsMessage` | send, optionally wait up to 120 s |
| `POST surface-bot` | `clients.botsMessage` | the person's surface bot, made the first time (lot S1) |
| `POST threads/{id}/stop` | `clients.botsMessage` | stop the turn running in one of their conversations (lot S1) |
| `DELETE threads/{id}` | `clients.botsMessage` | delete one of their hidden conversations (lot S1) |
| `GET threads/{id}?since&limit` | `clients.botsRead` | messages since a cursor, steps, pending cards |
| `GET threads/{id}/stream?anchor&wait` | `clients.botsRead` | watch a running turn, streamed (lot C.3) |
| `GET routines` | `clients.routinesRead` | the person's own routines |
| `GET routines/{id}` | `clients.routinesRead` | one routine, full instructions |
| `PATCH routines/{id}` | `clients.routinesWrite` | enable/disable, rename, edit schedule or instructions |
| `POST routines/{id}/run` | `clients.routinesRun` | run now |
| `GET routines/runs/{id}` | `clients.routinesRun` | one run |
| `GET bots/{id}/rules` | `clients.botsRead` | rules of a bot the person owns |
| `GET bots/{id}/docs` | `clients.botsRead` | documents of a bot the person owns |
| `GET bots/{id}/memory` | `clients.botsRead` | memory of a bot the person owns |
| `GET bots/{id}/connectors` | `clients.botsRead` | connector names of a bot the person owns |
| `GET bots/{id}/files/roots\|list\|stat\|read\|download` | `clients.botsRead` | every file of a bot the person owns, for a host product's Library (#4625) |
| `GET approvals?status=pending` | `clients.botsRead` | the cards waiting on the person, across their conversations (2026-10-17) |
| `GET approvals/{id}?threadId` | `clients.botsRead` | may the person answer this card (lot C.3) |
| `POST approvals/{id}` | `clients.approvalsAnswer`, or owning the bot | allow, deny or pick an option |
| `POST people/{id}/nudge` | `clients.peopleNudge` | nudge |
| `POST agents/{tool}` | per tool (below) | the agent-to-agent tools |

### `GET capabilities`

```json
{ "api": 1, "version": "0.4.16", "routes": ["GET bots", "GET capabilities", "POST bots/{id}/messages", "POST bots/{id}/messages:files"] }
```

A `METHOD path:feature` entry says the route takes more than its first
contract: `POST bots/{id}/messages:files` (#4632), its `files`;
`POST bots/{id}/messages:toolScope`, its `toolScope`.

### `GET bots`

```json
{
  "bots": [{
    "id": "5e38e819-...", "name": "Orion", "title": "Operations", "description": "",
    "source": "mine",
    "owner": { "principalId": "pr_7c1e...", "sub": "01J9...", "name": "Bob" },
    "status": "idle", "canMessage": true, "threadId": "a5fe..."
  }]
}
```

- `source`: `mine`, `shared` (shared with them or their team) or
  `organization` (published to the organization's Browse Bots).
- `status`: `idle`, `working`, `waiting` (a card waits for someone) or
  `archived`, for the person's own conversations.
- `canMessage`: the person can use the bot. A published bot they cannot use
  is listed with `false`: they can copy it in Sagax.
- `threadId`: the person's own conversation with the bot.
- `owner.sub` is filled for the person's own bots only.

### `POST bots/{id}/messages`

```json
{ "text": "Count the open tickets of Acme", "wait": 60 }
```

- `text`: 1 to 32,000 characters. Sent as the person, in their own
  conversation with the bot (Sagax's rule on an organization server).
- `threadId`: one of their conversations with this bot; `newThread: true`
  starts a new one instead (not both).
- Without `threadId`, an AI client (any actor but the Sagax console) writes
  in its own **hidden** conversation with the bot (#291): the newest one it
  opened, or a new one. A hidden conversation belongs to the person and stays
  reachable (the bot's Activity panel, a link, `GET threads/{id}`), but it is
  never in their sidebar, previews, typing dots, unread count or
  notifications, and it never moves the conversation they have open.
  `newThread: true` starts a new hidden one. An explicit `threadId` is used
  as given, visibly. The task API takes the same flag (`POST
  /api/bots/{id}/tasks {"hidden": true}`).
- `wait`: 0 to 120 seconds (default 0). The request stays open until the bot
  has answered, a card waits, or the time is up.
- `sendId`: 16 to 80 of `[A-Za-z0-9_-]` (the message route's own rule); a retry with the same id is the same
  message. With `newThread: true`, a retry with the same `sendId` (same
  person and bot, for 24 h, kept as a durable receipt like `send_prompt`'s,
  so after a restart too) lands in the conversation the first send opened,
  never in another new one, and the work runs once (lot S1). The receipt
  (person, bot, `sendId`, conversation; no text) goes with its conversation
  when it is deleted, and with the person when they are erased.
- The conversation is opened before anything is sent, and its id comes
  with the answer: `threadId` in the JSON body, and for `stream: true` the
  `X-Sagax-Thread-Id` header with the status line, before the `started`
  event (lot S1).
- `stream`: `true` answers NDJSON instead (see "The streamed turn").
- `hidden`: `true` makes the console's send land in a hidden conversation,
  as an AI client's does (lot S1: a host product's chat answered by Sagax).
  Without it the console keeps the person's own chat (#1170). A send to a
  surface bot is always hidden.
- `modelSelection`: `{instanceId, model, effort?, auto?}`, the engine and
  model this send runs on (lot S1). It becomes the conversation's own model,
  set by the app's own model picker route as the person, with the checks of
  `update_agent_model` (a refusal passes through); left alone when the
  conversation already runs on it. Each conversation keeps its own model, so
  two sends on two conversations never mix. With no conversation named, the
  person's chat with the bot (or a new conversation) is used.
- Every send of this API (not the agent API's `send_prompt`) to one
  conversation, on any bot, goes one at a time, in arrival order; what
  happens to it does not change (queued, or joined to the running turn,
  never refused). A send that changes the conversation's model
  first waits, within its own `wait`, for the turns before it (running or
  queued) to finish on their own model: two models never cross in one
  conversation. Still busy at the end of its `wait` (at once with `wait` 0)
  answers `409 conversation_busy`; a card waiting in it answers `409
  card_waiting` (answer the card, then send again). Nothing is switched or
  sent then. A send that changes nothing waits only behind the sends before
  it, so at most their own `wait` (120 s each). A queued send left
  interrupted never counts as busy.
- `files` (#4632): the files the bot reads with this message (an image, a
  PDF, a document, any type), exactly as the agent API's `send_prompt` takes
  them, through its own parser and staging (one way to receive a file):
  `[{"path": "photo.png", "content_base64": "..."}]`, where `path` is the
  name the file is given (its last segment; no leading `/`, no `..`, at
  most 512 characters) and `content_base64` its bytes. At most 8 files of
  25 MiB each; the request body is then up to 64 MiB (64 KiB without
  `files`). `text` stays required.
  - Where it goes: the bot's workspace, `inbox/<sender>/<name>` (a name
    already there gets `-2`, `-3`, ...), and the line sent to the bot says
    so, with the paths the bot reads them at (its file tools read images and
    PDFs; `workspace_read` reads text). On the person's own bot and their
    surface bot the file is in that bot's workspace, so a host Library that
    reads the person's bot files (`GET bots/{id}/files/...`) lists it under
    `inbox/`. On a bot shared with them, it lands in that bot's workspace
    (its owner's), as with `send_prompt`.
  - Only into a bot the person reaches (`send_prompt`'s list, or their own
    surface bot): any other is `404 not_found`, and nothing is written. A
    send the message route then refuses (a conversation that is not
    theirs, for one) removes what it staged.
  - Deleted with its conversation (`DELETE threads/{id}` and the app's
    delete) and with the person when they are erased; deleting the bot
    deletes its workspace. The server records on the conversation the
    files it staged itself and erases only those, never a path read from a
    message's text; a file another conversation that stays still names is
    kept (the stored attachments' rule); a link is never followed. What the
    bot moved out of `inbox/` stays.
  - A retry with the same `sendId` in the same conversation reuses the
    first line and stages nothing again (no second copy).
  - Discovery: `GET capabilities` lists `POST bots/{id}/messages:files`
    in `routes` when this server takes files with a message; a host product
    reads it there (no other signal). A route announces what it takes
    beyond its first contract as `METHOD path:feature`; `api` stays 1 (an
    added field or route never changed it).
  - Errors (send_prompt's own): `400 bad_request` (`files` not a list or
    more than 8, an entry that is not a `path`, a path with a leading `/`
    or `..`, a file without `content_base64`), `413 file_too_large` (one file
    over 25 MiB), `413 too_large` (the body over 64 MiB), `404 not_found`
    (a bot the person does not reach).
- `toolScope` (optional, with `newThread: true` only): the tool selection
  of the conversation this send opens, in the bot editor's grammar
  (`{ "allow": ["mcp:<server>:<tool>", "native:<tool>"], "deny": [...] }`).
  The server applies it before the conversation's first turn, on top of the
  bot's own selection: the turn is offered only what both allow (never a
  widening; `allow: []` is no tool at all), and so is every later turn of
  that conversation. A host product uses it for a helper that may only read
  (its read tools, and nothing else). It is saved before anything is sent,
  again on a retry with the same `sendId`; never on an existing
  conversation, and clients never see it.
  - Discovery: `GET capabilities` lists `POST bots/{id}/messages:toolScope`
    when the server narrows a conversation's tools; a host product that does
    not find it sends no `toolScope` (and runs no helper).
  - Errors: `400 bad_request` (an invalid selection, or `toolScope` without
    `newThread: true`), `501 not_supported` (a server that cannot narrow),
    `502 not_started` (the narrowing could not be saved: nothing was sent).

```json
{
  "botId": "5e38...", "threadId": "a5fe...", "messageId": "m_81...",
  "status": "done", "pending": false,
  "reply": "Acme has 4 open tickets: ...",
  "approvals": [], "cursor": "m_83..."
}
```

`pending: true` (with `status` `working` or `waiting`) when the bot did not
finish within `wait`, or a card waits: read the thread later with
`GET threads/{threadId}?since={cursor}`. `reply` is every bot text after the
message, joined, at most 32,000 characters. Every answer also carries
`summary` (see "The turn summary"), null when the message has no thread.

### The surface bot (lot S1)

A host product (a gateway that serves a person a chat home) makes Sagax
answer in their name through one service bot of theirs, the **surface bot**:

- `POST surface-bot` `{"name": "..."}` (optional, 1 to 80 characters, one
  line, default `Assistant`, used only the first time) answers `201
  {bot: {id, name, approvalMode}, created: true}` the first time, then `200`
  with the same bot and `created: false`. One per person and server. The
  route's key is `clients.botsMessage`.
- It is made by the app's own creation as the person (their bot, in their
  environment, with their engines and the ones the organization gives
  them), as a temporary agent (`server/temporary-agents.ts`) marked
  `surface`: pinned (it never expires), outside the temporary agents' quota,
  its parallel conversations at the bot ceiling. Its level is Full access
  when the organization lets their bots have it, else the level a new bot of
  theirs gets. The organization's Deny and Ask first rules judge every tool
  call of its turns as for any bot: an Ask first card arrives on the stream
  (`approval`) and is answered with `POST approvals/{id}`.
- Every send to it lands in a hidden conversation; `newThread: true` opens
  one per host chat, then `threadId` continues it.
- It is the person's alone, by one rule (`server/bots/surface-bot-access.ts`):
  any app route naming it or one of its conversations from another session,
  an organization admin's included, answers `404`; the member API reaches it
  through those same routes as the person. One exception: a server command
  card the existing rule gives to an organization admin is answered by an
  admin where it shows (the app's Today included), and nothing else of the
  conversation. The admin is notified of it as for any bot, and its owner
  sees on Today that it waits on an admin.
- It is in no list: not `GET /api/bots`, the event stream, `GET bots`, the
  catalogue, the agent API (`list_agents`, `find_agents`, `send_prompt`),
  the organization admin's bots and files, admin approvals (but the server
  command card above), the decision history of the console, Today (but the
  waiting line above), a team manager's list, or search.
- It has the rights of any bot of its person, by its access level (#4920,
  liberty audit 2026-11-19): it reaches the person's other bots (`ask_bot`,
  `delegate_bot`, `send_to_bot` and the rest of the peer tools), joins a room
  the person places it in, and holds routines and automations of its own. It
  may also propose a routine for one of the person's bots (`for_bot_id`).
  Being in no list, no other bot reaches it.
- Notifications: as any outside agent's conversation, only what someone must
  act on (an approval, a question) is notified.
- Usage: the person reads every row in their own usage (`/api/me/usage...`).
  Anyone else (the ledger, its CSV, traces, stats, the console's usage) reads
  one row per person, calendar month (dated the 1st, as the ledger and the
  spend cap), engine and model, labelled `Chat`, with no conversation or bot
  id and no day, read over the whole calendar months the asked range
  touches (a one-day range gives the month); that row counts as one turn
  (costs and tokens are exact, the number of turns is not); the stats leave
  out its tool calls
  (`server/usage/surface-usage.ts`). No cap.
- Logs: every admin activity row and every decision about it is marked
  `surface` when written (whoever writes it: the member API, the agent API,
  an approval), so the mark outlives the bot; an administrator's logs
  (`GET audit`, `/api/admin-activity`, the console's decision history) never
  show one, before or after the person is erased.
- Erasing the person erases it with their other bots and its conversations;
  what the decision log kept of its conversations goes down to its
  metadata for the person's own rows (an administrator's answer to a server
  command card stays whole). Its usage rows stay, as every bot's (they hold
  no text, and the month's spend does not drop); others read them folded.

### `POST threads/{id}/stop`, `DELETE threads/{id}`

`stop` stops the turn running in a conversation the person may stop (the
app's own stop, as them): `{stopped: true, threadId, status}`.

`DELETE` deletes one hidden conversation of the person (an AI client's, or
any of their surface bot's) with its messages, after stopping a running
turn: `{deleted: true, threadId}`. Another person's conversation, a visible
one and a confidential one are `404`. A deleted conversation reads `404`
after, and what the decision log kept of the person's own rows of it goes
down to its metadata (an administrator's answer stays whole).

### `GET threads/{id}`

`since` is a message id (the `cursor` of the previous answer); `limit` 1 to
200 (default 50) keeps the newest.

```json
{
  "threadId": "a5fe...", "status": "working",
  "messages": [{ "id": "m_84...", "role": "bot", "kind": "text", "text": "Half way.", "at": 1791500000000, "sender": null }],
  "steps": { "count": 3, "recent": [{ "tool": "Bash", "ok": true }] },
  "approvals": [{ "id": "req_4", "threadId": "a5fe...", "title": "Run a command?", "subtitle": "uptime", "tool": "Bash", "options": ["Allow", "Deny"],
    "kind": "permission", "answerWith": "decision", "choices": [], "freeText": false, "createdAt": 1791500000000, "expiresAt": null }],
  "cursor": "m_84..."
}
```

Each card says how it is answered (2026-10-17): `kind` `permission` (a tool
call) or `request` (a card of Sagax's own: a routine, a skill, a terminal)
take `decision`; `kind` `question` (`ask_user`, `AskUserQuestion`) takes one
of its `choices` (`{id, label}`, `id` its position from 1), or `text` when
`freeText`. A card with several questions lists them in `questions`, each
with its own options. A turn that stops on a card (a send with a wait, the
stream's `final`, and `agents/send_prompt` or `agents/await_turn` with
`status: waiting_for_approval`) carries that card in line as `approval`.

- `messages`: text lines only (`text`, `nudge`, `access`), never a tool's
  input or output.
- `steps`: the tool calls after the cursor, counted, the last ten named.
- `approvals`: the cards of this conversation still open.
- `gap: true` when the cursor is no longer in the newest 200 messages.

### The streamed turn (lot C.3)

`POST bots/{id}/messages` with `"stream": true`, and
`GET threads/{id}/stream?anchor={messageId}&wait={1..120, default 30}`
(watch a turn already running, typically after an approval), answer
`200` with `Content-Type: application/x-ndjson`: one JSON object per line,
each with `event`. A refusal before the stream begins (permission, a thread
the person cannot read, a bad body) is the usual JSON refusal.

| `event` | Fields | When |
|---|---|---|
| `started` | `botId`, `threadId`, `messageId` | first line |
| `progress` | `status` (`working`, `waiting`, `idle`), `steps` (`count`, `recent` names and outcomes after the anchor), `partial` (the words being written now, at most 600 characters, the newest kept, or null), `elapsedMs` | at most every 2 s, only when something moved, and at least every 10 s |
| `approval` | `approval` (`id`, `threadId`, `title`, `subtitle`, `tool`, `options`) | a card waits; the stream then ends |
| `final` | the body of a non-streamed send (`status`, `pending`, `reply`, `approvals`, `cursor`, `summary`) | last line |
| `error` | `code`, `message` | the work failed after the stream began (last line) |

The stream ends at the first card on purpose: the client asks its person
(Perspicax: an MCP elicitation), answers with `POST approvals/{id}`, then
opens `GET threads/{id}/stream?anchor={messageId}` to follow the rest of the
turn. A waiting flag without an open card (a card just answered) does not
end a watch. A client that closes the connection stops the watch.

`partial` comes from the runtime's assistant text deltas
(`server/people/member-live-text.ts`, memory only, reasoning never kept). Tool
inputs and outputs never appear, only the tool's name and outcome.

### The turn summary

```json
{
  "text": "Build cleaned.",
  "toolCalls": [{ "tool": "Read", "ok": true }, { "tool": "Bash", "ok": true }],
  "toolCallCount": 2,
  "files": ["build/clean.log"],
  "cost": { "inputTokens": 1200, "outputTokens": 300, "costUsd": 0.0123, "turns": 1 },
  "approvals": [{ "id": "req_1", "tool": "Bash", "title": "Run Bash?", "decision": "allow", "by": "Alice", "via": "ai-client" }],
  "threadUrl": "https://sagax.example/#thread=a5fe...&bot=5e38..."
}
```

Everything after the anchor (the person's message): the bot's reply, the
tool calls (the last 50 named, `toolCallCount` all of them), the files the
successful calls wrote and the turn digests list as added or changed (at
most 50), the usage of the finished turns (`cost` null until a turn reported
one, `costUsd` null when the engine reports no price), every card with its
outcome (`allow`, `deny`, `answered`, `pending`, `dismissed`, `expired`) and
who answered it, and the link that opens the thread in Sagax.

### `GET routines`, `GET routines/{id}`

The person sees only routines they own. A shared routine, a redacted routine
and another person's routine (an admin's view included) are left out of the
list and answer `404` on the detail route. Reads are not written to the
activity log.

The list is `{routines: [{id, name, botId, enabled, suspended, schedule,
nextRunAt, lastRun}]}`. It never includes the instructions. `suspended` is
`false` or `{reason, at}`. `lastRun` is the newest run of that routine as
`{id, status, startedAt, endedAt}`, or `null`.

The detail adds `instructions`: the routine's full text, with secret-shaped
text replaced. There is no length cut. A schedule field whose name is a
secret (`token`, `signingSecret`, `webhookKey` and the same family) is
dropped, and a `whsec_` value in any kept text is masked.

### `GET bots/{id}/rules`, `GET bots/{id}/docs`, `GET bots/{id}/memory`, `GET bots/{id}/connectors`

These read a bot only when the catalogue says the caller owns it (`source`
`mine` and the owner is the caller). A shared bot, a published bot and
another person's bot are `404` before any file is opened, an admin's view
included. Without `clients.botsRead` the answer is `403`. Reads are not
audited.

- `rules`: `{rules, sets}`. `rules` is the text of `RULES.md`. Each set is
  `{id, name, enabled, text}`. Templates, hashes and file paths stay on the
  server.
- `docs`: `{docs: ["docs/<name>.md", ...]}`. `?path=docs/<name>.md` reads
  that one document as `{path, text}`. Any other path, including `RULES.md`,
  a memory path or a traversal such as `docs/../RULES.md`, is `400` and
  opens nothing.
- `memory`: `{text}` of `MEMORY.md`, empty when the bot has none.
- `connectors`: `{connectors: [{name, kind, enabled, scope}]}`. `kind` is
  `mcp` or `browser`. `scope` is `bot`. No address, token or credential is
  returned, and the bot's soul and memories are not part of this answer.

Text on every one of these routes is passed through the same secret mask as
a routine's instructions.

### `GET bots/{id}/files/...` (#4625)

Every file of a bot the person owns, read only, for a host product's
Library. The answers are the admin file browser's
(`server/org/org-admin-files.ts`, `docs/org-admin-api.md`), through the
same code, with the member view below.

Who: the bots the catalogue says the person owns (`source` `mine`, the
owner is the caller), and the person's own surface bot (lot S1), which no
catalogue lists. A shared bot, a published bot, another person's bot, a
surface bot that is not theirs and an unknown id are all `404`
`not_found` before any folder is opened, an organization admin's
assertion included: an admin reads another person's bot only through the
admin API. Without `clients.botsRead` the answer is `403`. Reads are not
audited.

Roots, never a host path on the wire: `workspace` (the bot's folder:
`MEMORY.md`, `memory/`, `docs/`, its own files), `tasks` (one folder per
conversation), `project` (the bot's working folder when it lies inside
the server's data folder), `attachments` (uploads and attached outputs of
its conversations, by opaque id); `sandbox` and `desktop` are listed as
unavailable. In `tasks` and `attachments` only the conversations the
person may read are there (the private threads rule: another person's
conversation with their bot is not). A confidential conversation is
there for its own person only (#4921), never for anyone else.

- `roots`: `{bot: {id, name}, roots: [{id, available, reason?}]}`.
- `list?root&path`: one folder, `{root, path, entries: [{name, path,
  type, size, modifiedAt}], truncated}`; `type` is `file`, `dir`, `link`
  or `other`.
- `list?recursive=1&root?&q?&type?&limit?&cursor?`: every file of one
  root, or of every readable root when `root` is left out, a page at a
  time, in a stable order: `{bot: {id, name}, recursive: true, root,
  entries: [{root, name, path, type: "file", size, modifiedAt, mime,
  kind}], nextCursor}`. `q` keeps the names that contain it (any case).
  `type` keeps one or more kinds, separated by commas: `image`, `pdf`,
  `text`, `document`, `spreadsheet`, `presentation`, `archive`, `other`
  (from the name, never the bytes). `limit` is 1 to 1,000 (200 by
  default). Pass the `nextCursor` of a page to get the next one; `null`
  is the end. A page also stops after looking at 20,000 entries, with a
  cursor, so a search over a large folder goes on over several pages. A
  link and a special file are neither listed nor followed; `path` is not
  taken here (`400`).
- `stat?root&path`: `{root, path, name, type, size, modifiedAt, mime}`.
- `read?root&path&offset&length`: at most 128 KiB, `{..., offset, length,
  eof, binary, text?}`. A file sealed at rest reads as its plaintext.
  `text` goes through the same secret mask as a routine's instructions;
  `length` counts the bytes read.
- `download?root&path`: the file as it is, at most 100 MiB, always
  `application/octet-stream` with `content-disposition: attachment`,
  `x-content-type-options: nosniff`, `x-sagax-file-type` (the type its
  name suggests) and `x-sagax-member-api: 1`.

Paths: relative to the root, `/` between names, at most 1,024 bytes; a
`..` or `.` segment, a leading `/`, a backslash, a NUL or an empty
segment is `400` `bad_path`. Every segment is walked without following a
link: a symbolic link anywhere is `403` `link_refused`, a real path
outside the root `403` `outside_root`. Reads open the file without
following a link.

Never listed nor served (they read as missing, `404`), whatever the
root: a path with a sensitive name anywhere in it, by the server's
central rule (`server/safety/sensitive-path.ts`): a dotfile or dot folder
(`.env`, `.mcp.json`, `.claude/`, `.git/`, `.ssh/`, `.npmrc`...), a
credential or key file name (`credentials.json`, `secrets.yaml` and a
`secrets/` folder, `token.txt`, `*.pem`, `*.key`, `*.p12`, `id_rsa`,
`known_hosts`, `kubeconfig`...), and a percent-encoded name. An
attachment is judged by its name.

Other refusals: `400` `bad_root`, `bad_range`, `bad_limit`, `bad_type`,
`bad_cursor`, `not_a_folder`, `not_a_file`; `404` `root_missing`;
`409` `root_<reason>` for an unavailable root; `413` `too_large`.

### `PATCH routines/{id}`

Change one of the person's own routines. Permission `clients.routinesWrite`.
Body is a partial object; send at least one field:

```json
{
  "enabled": false,
  "name": "Evening brief",
  "instructions": "Summarize the close of day.",
  "schedule": { "type": "cron", "expression": "0 18 * * 1-5", "timeZone": "America/Toronto" }
}
```

- `enabled`: turn the routine on or off (pause / resume).
- `name`: 1 to 80 characters.
- `instructions`: 1 to 20,000 characters (maps to Sagax `prompt`).
- `schedule`: same shapes as Sagax (`cron` with `expression` and usually
  `timeZone`, `daily` with `time` and `weekdays` for a weekly pattern,
  `interval` with `everyMinutes`, plus `once`, `webhook`, `event`). Sagax
  validates the schedule; a bad one returns Sagax's refusal.

Unknown fields are refused (`400`). Another person's routine is `404`
before Sagax is called (an admin's view included). The write is the person
acting as themselves through `performAsMember` (the same path as the
Automations editor). It does not open a bot Ask card: Ask and Auto still
apply only when a bot uses `propose_routine` / `propose_routine_action`.
One activity row, action `client.routine_update`, `after.fields` naming the
keys changed (never the instructions text). Answer:
`{ routine }` in the detail shape (with `instructions`).

Perspicax exposes this as `sagax_routine_update` (MCP permission
`routines:update`).

Follow-ups, not in this API yet: proposing a new routine from the member
API, delete, and an emergency pause of every routine at once.

### `POST routines/{id}/run`, `GET routines/runs/{id}`

Run now answers `201 {run: {id, routineId, routineName, botId, status,
threadId, startedAt, endedAt}}`. Sagax's Run now rule still applies (the
bot's owner, the person it runs as, an admin, or `routines.runNowAny`): its
refusal names `routines.runNowAny`. The run read adds `attention`, `error`
and `output` (at most 32,000 characters) for a run the person can see.

### `GET approvals/{id}?threadId=`

Whether the person may answer the card through this API, before anyone asks
them (Perspicax checks it before an elicitation):

```json
{ "id": "req_4", "threadId": "a5fe...", "open": true, "canAnswer": false,
  "reason": "Your profile does not include answering approvals of bots that are not yours.",
  "permission": "clients.approvalsAnswer",
  "whoCanApprove": { "kind": "owner", "principalId": "pr_7c1e...", "name": "Bob", "sentence": "The bot's owner, Bob." } }
```

`canAnswer` holds both gates: the permission (below) and Sagax's own rule (a
server command of a member's bot is an organization admin's, `kind: admin`;
any other card is its bot owner's, `kind: owner`). An answered card is
`open: false, canAnswer: false`; a card the thread does not hold is `404`;
a thread the person cannot read is Sagax's own refusal.

### `POST approvals/{id}`

`clients.approvalsAnswer` is derived per card, nothing stored: the owner of
the bot that raised the card holds it for the cards of their own bots; anyone
else needs it from a permission set (an admin holds every key). Without it:
`403 forbidden_permission`, `permission: clients.approvalsAnswer`.


`{"threadId": "a5fe...", "decision": "allow"}` or `"deny"`, plus `"option"`
(an option id or its exact label; a list of them, one per question, for a
card with several questions) or `"text"` (the person's own words, at most
2,000 characters) for a question. `{id}` is the card's request id
(`approvals[].id`). `decision` may be left out when `option` or `text` is
given.

- A question answered `allow` with no option takes its only option, or the
  yes of a yes/no pair (`Yes`/`No`, `Oui`/`Non`); otherwise `409
  option_required` with `options: [{id, label}]` (and `questions`). An option
  the card does not have is `409 option_unknown` with the same list.
- `deny` always closes the card: a question gets the no of a yes/no pair, or
  a sentence telling the bot the person declined.
- `200 {answered: true, closed: true, decision, state, option?}` only once
  the card is really closed (re-read after the answer, up to 3 s); `state` is
  `allowed`, `denied`, `answered`, `dismissed`, `expired` or `unavailable`
  (closed, but the turn had already ended). A card still open afterwards is
  `409 not_closed`.
- Idempotent: a card already closed answers `200 {closed: true,
  alreadyAnswered: true, state}`, and a second call while the first is still
  answering gets the first one's outcome (one answer per card id).
- A card in a confidential thread is `404` here, as are its reads (#683):
  only the person, in Sagax, answers it.

Who may answer is Sagax's rule (the bot's owner, an admin for a server
command). The card records its answerer as the person, by the name the
organization knows them by, with `via: "ai-client"` (the app shows "from an
AI client" beside the outcome), and the admin activity log keeps one
`client.approval` row naming the person and `via: perspicax-mcp` (with
`answer`: `decision`, `option` or `text`, never the words).

### `GET approvals?status=pending`

The cards waiting on the person across their conversations: each bot's
threads they see in Sagax and their hidden AI-client conversation with it,
read through the person's own read (a thread they cannot see stays out),
confidential threads never listed, at most 50 waiting threads read.

```json
{ "count": 1, "approvals": [{ "id": "req_4", "threadId": "a5fe...", "botId": "b_31...", "botName": "Nova",
  "title": "Your bot has a question", "subtitle": "Where should I deliver?", "kind": "question", "answerWith": "option",
  "choices": [{ "id": "1", "label": "Deliver here" }, { "id": "2", "label": "Deliver here and by the relay" }, { "id": "3", "label": "No" }],
  "freeText": true, "createdAt": 1791500000000, "expiresAt": null, "canAnswer": true,
  "whoCanApprove": { "kind": "owner", "principalId": "pr_7c1e...", "name": "Bob", "sentence": "The bot's owner, Bob." } }] }
```

### `POST people/{id}/nudge`

`{}`; `{id}` is a Sagax principal id or a Perspicax user id. Answers `{ok,
id, at}`. The nudge cooldown and refusals are Sagax's.

### `POST agents/{tool}`

The twelve agent-to-agent tools ([agent-api.md](agent-api.md)) for the person's
AI client. The body is the tool's arguments. Each tool checks its own scope:

| Permission | Tools |
|---|---|
| `clients.botsRead` | the read tools |
| `clients.botsMessage` | `send_prompt` |
| `clients.agentsCreate` | `create_agent`, `delete_agent` |

A missing scope answers 403 `forbidden_scope`. `send_prompt` accepts up to
64 MiB, so it can carry files as base64. Every other body stays capped at
64 KiB.

