# Organization member API (`/api/org/member/*`)

What a person may do with their own Sagax bots from an AI client attached to
Perspicax (Claude Code, claude.ai, Cursor, any MCP client), under their own
identity. Perspicax serves it as its `sagax_*` tools. Plan: Perspicax
`docs/superpowers/plans/2026-10-09-master-implementation-plan.md`, lot C.1.
Code: `server/org-member-routes.ts`, wired in `server/index.ts`
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
| `clients.agentsCreate` | off | create a temporary agent with `agents/create_agent`, delete one with `agents/delete_agent` |

Keys have two segments (`group.name`): Perspicax refuses a catalogue with
any other shape, so the plan's `clients.bots.read` is written
`clients.botsRead`.

## Routes

| Method and path | Permission | What |
|---|---|---|
| `GET capabilities` | none | the version and the routes |
| `GET bots` | `clients.botsRead` | the bots the person can see, with status |
| `POST bots/{id}/messages` | `clients.botsMessage` | send, optionally wait up to 120 s |
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
| `GET approvals?status=pending` | `clients.botsRead` | the cards waiting on the person, across their conversations (2026-10-17) |
| `GET approvals/{id}?threadId` | `clients.botsRead` | may the person answer this card (lot C.3) |
| `POST approvals/{id}` | `clients.approvalsAnswer`, or owning the bot | allow, deny or pick an option |
| `POST people/{id}/nudge` | `clients.peopleNudge` | nudge |
| `POST agents/{tool}` | per tool (below) | the agent-to-agent tools |

### `GET capabilities`

```json
{ "api": 1, "version": "0.4.16", "routes": ["GET bots", "GET capabilities", "POST bots/{id}/messages"] }
```

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
- `sendId`: 8 to 80 of `[A-Za-z0-9_-]`; a retry with the same id is the same
  message.
- `stream`: `true` answers NDJSON instead (see "The streamed turn").

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
(`server/member-live-text.ts`, memory only, reasoning never kept). Tool
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

