# The agent-to-agent API

The agent tools let one agent find, prompt, read and configure another agent, with the same
names, parameters and limits as the reference design's agent tools, plus `get_agent`,
`delete_agent` (Perspicax #321) and the fleet writes of #1944. One core
(`server/agent-api.ts`) serves two transports:

- **Bots**: the agents MCP server offers the tools in a bot's direct turns
  (`SAGAX_AGENT_API=1`, set when the bot holds at least one scope; `create_agent` and `delete_agent` only for a Primary Bot; never in a
  room or an external runtime). Calls go to `POST /api/internal/agent-api/<tool>`
  behind the per-turn capability.
- **People's AI clients** (Perspicax): `POST /api/org/member/agents/{tool}`,
  acting as the person (see [org-member-api.md](org-member-api.md)).

## Tools

| Tool | Kind | Scope | What |
|---|---|---|---|
| `list_agents` | read | `agents.read` | every agent the caller can reach, with status `running`/`idle`; `archived` true lists only the archived ones instead of the active ones, each with `archived: true` (a bot: the archived temporary agents it created) (#4172) |
| `find_agents` | read | `agents.read` | `query`, optional `status` (`running`/`idle`), `limit` ≤ 64 (default 8) |
| `get_agent` | read | `agents.read` | `agent_id`: the full profile for an audit (see below) |
| `create_agent` | admin | `agents.create` | one agent per call; it greets the person itself. Only on the person's explicit ask. `kind` `temporary` (default when absent): a temporary agent (see below), `name` (≤ 80 chars, one line), optional `description`, `idle_hours` (1 to 720, default 24) and `workspace`. `kind` `lasting`: the person's own bot (see Lasting bots), `name`, optional `description`, `title`, `soul`, `instance_id`, `model`, `effort`, `auto`, `workspace`, `section` |
| `delete_agent` | admin | `agents.create` | `agent_id` of any agent of the caller, lasting ones included: archives it (default), `permanent` true deletes it for good, `restore` true brings an archived one back (see Managing a person's bots) |
| `send_prompt` | write | `agents.send` | `agent_id`, `prompt` (≤ 32,000 chars), `mode` `fire_and_forget` (default) / `blocking` / `async`, `timeout_ms` (1 s to 10 min, default 120 s; the live blocking wait is capped at 55 s so the handle returns as `still_working`), `on_busy` `queue` (default since 2026-10-17: waits its turn) / `reject` (409 `busy`, `retryable: true`, with `details.turn_state` and options) / `supersede` (stops the running turn this caller started and the approval it waits on; never the person's own turn or another caller's), optional `priority` `now` or `normal` (default `normal`), up to 8 `files` (workspace-relative, 25 MiB each), optional `thread_id` (one of the caller's own conversations, 404 `unknown_thread` otherwise). A bot's send lands in the agent's single chat with the person the caller works for (#1170); a person's AI client's send lands in its own conversation with the agent (2026-10-29, see Guarantees); `thread_id` continues one of the caller's conversations instead. Answers a `handle`, its lifetime (`ttl_ms`, `expires_at` in unix ms and `expires_at_iso`) and a short `label` (the agent's name and the prompt's first words). `now` wakes an idle agent at once or moves the prompt to the front of its queue, and never interrupts a running turn. Past 10 `now` sends an hour the answer is `priority: "normal"` with `downgraded: true` and `priority_note`. Refusals keep the unified envelope and set `retryable` |
| `await_turn` | read | `agents.read` | `agent_id`, `handle`, `timeout_ms` (0 to 55 s, default 15 s), optional `cursor` (a prior `wait_cursor`). The handle is the one `send_prompt` returned, or the `{threadId, handle}` a one-way `send_to_bot` included (copy it exactly). Never send the prompt again: wait again with the same handle. When the wait ends and the turn is not done, the answer is `still_working` (HTTP 200) with `thread_id`, `progress.summary`, `progress.steps`, `wait_cursor` and `recommended_wait_ms`; pass `wait_cursor` as `cursor` on the next call so steps are not repeated. Without a handle, waits the in-flight turn of your conversation, else its last message. An expired handle, or one of another session, on a conversation the caller reads answers that turn (`handle: null`, `recovered_from`). Else a 400 `handle_expired`, `handle_session_mismatch`, `handle_agent_mismatch` or `bad_handle` (altered), `details.reason` and `details.family: bad_handle`, and a `hint` to read `read_latest_page` with the `thread_id` `send_prompt` returned (see Handle lifecycle) |
| `read_transcript` | read | `agents.read` | the whole transcript (the newest 2,000 entries; `truncated` says when there were more) |
| `read_transcript_page` | read | `agents.read` | one bounded page: `limit` (1 to 200) and `before_ms` required, `after_ms` optional (inclusive unix ms), `cursor` for the next older page |
| `read_latest_page` | read | `agents.read` | the newest page: `limit` ≤ 200 (default 20), `cursor`, optional `thread_id` (one of the caller's conversations, 404 `unknown_thread` otherwise) |
| `read_latest_page_with_threads` | read | `agents.read` | the newest page and the conversations it spans, with their status; optional `thread_id` like `read_latest_page` |
| `read_transcript_cold` | read | `agents.read` | the stored transcript only: pages of 50 by `cursor`; never reads live state, never wakes a computer or sandbox |
| `read_transcript_attachment` | read | `agents.read` | `agent_id`, `attachment` (an entry's `images[].ref`, or the path of its `<attached-image>` tag), optional `thread_id`, optional `save`. Answers the image (`mime`, `bytes`, `image_base64`, fitted for a model; MCP callers get it as image content) when it is attached in a conversation the caller may read with that agent, else 404 `not_found`: a bot of the same person reads that person's images, never another person's (#3203). `save` true (bot callers) also copies the original into the caller's workspace and answers `saved_to` |
| `list_agent_models` | read | `agents.read` | `agent_id`: engines and models the caller may pick as that agent's default, plus `current` (#1944). Without `agent_id`: what the person may pick for a new bot (`create_agent` kind `lasting`), `agent_id` and `current` null |
| `update_agent_model` | write | `agents.send` | `agent_id`, `instance_id` (or `instance` / `engine`), `model`, optional `effort`, or `auto` true. Same rights and validation as `PATCH /api/bots/:id` `{ modelSelection }` (owner, granted editor, admin). Exact `instance_id` first; a short engine name must resolve to one engine, else the answer lists the candidates. An invalid model is refused with a plain hint of valid choices. Person AI clients only; a bot uses `propose_team_setup` |
| `update_agent_settings` | write | `agents.send` | `agent_id` plus a partial patch of every Edit bot field the UI can change through `PATCH /api/bots/:id` (identity, look, permission-gated fields such as approval level, tools, computer, visibility, section, cwd, voice notes, …), plus runtime settings (`maxConcurrentThreads` and the rest via `PATCH /api/bots/:id/runtime-settings`) and `primary` true/false (Primary Bot switch). Derived from `MEMBER_BOT_FIELDS` + `BOT_FIELD_PERMISSIONS` so the allowlist cannot drift; the same server checks decide per field. Also `skills` `{name: true/false}`, `plugins` `{key: true/false}` and `grants` `{"user:<person id>" or "team:<team id>": use/run/edit/manage, null stops sharing}`, each through the route the bot page calls (#4172). Answers `changed` and `refused` (each with a plain reason, no permission keys; a switch is named `skills.<name>`, `plugins.<key>`, `grants.<target>`; a library skill not yet on the bot is added by `true` as Add to bot does, and `false` on it answers changed with nothing sent, since it is already off for this bot; `false` on a library skill on the bot removes it from this bot only, as Remove from bot does; `true` on one already on and live answers changed with nothing sent, and on one turned off in the organization's library goes to the library's own switch, a person who does not manage the library being told so plainly; a skill the engine loads by itself is not switched and says so; a name neither the bot nor its library holds answers that it has no such skill, a plugin not installed on it answers so, each with the names it does hold (the first 20, then how many more); any other refusal keeps the route's own words; a plugin's bare name finds its one installed key). Model changes use `update_agent_model`; archive and restore use `delete_agent`. An archived bot is reached too, so its fields can be edited |
| `update_routine` | write | `agents.send` | `routine_id`, then `enabled` / `name` / `instructions` / `schedule` / `requires_computer` / `model` / `subagent_model` / `effort` / `goal` (`PATCH /api/routines/:id`, the Automations editor's own route, as the person: own routines). Person AI clients only; a bot uses `propose_routine_action` |
| `create_routine` | write | `agents.send` | `agent_id`, `name` (1 to 120), `instructions` (1 to 32,000), `schedule` (the editor's schedule object), optional `enabled` (default true), `requires_computer`, `model`, `subagent_model`, `effort`, `goal`, the same keys as `update_routine`. `POST /api/routines` (the editor's New routine) as the person. Answers `routine_id` and `routine` (#4172). Person AI clients only; a bot uses `propose_routine` |
| `delete_routine` | write | `agents.send` | `routine_id` only. `DELETE /api/routines/:id` (the editor's Delete) as the person. Answers `{deleted: true, routine_id}` (#4172). Person AI clients only; a bot uses `propose_routine_action` |

`list_agents`, `find_agents` and `create_agent` answer each agent as `{id,
name, description, status, temporary, owner, model?}`. `owner` is
`{principal_id, name}` or `null` (same source as `get_agent`, with no
per-agent profile call). `model` is `{instance_id, model, effort?, auto?}` when
known (#1944). Pass `owner.principal_id` to `sagax_nudge` to
reach that agent's owner.

`get_agent` answers `agent` (the summary and its `title`), `owner`
(`principal_id`, `name`), `model`, `profile`, `temporary` and `profile_url` (the
Perspicax console sheet, `<issuer>/console/sagax/bots/<id>`, on an
organization server; null otherwise). `profile` holds the `instructions`
(capped at 32,000 characters, `instructions_truncated`), their `persona`,
`rules`, `voice` and `anti_jobs` sections found by their markdown headings in
French or English (each capped at 8,000 characters; the persona falls back to
the text before the first heading), every `headings`, and the
`voice_settings` (`voice`, `speak_replies`, `voice_notes`). `profile` is null,
with a `note`, unless the caller is an organization admin, the owner or a
person who can edit the bot; a bot reads the profile of a temporary agent it
created. `temporary` is null for a lasting agent, else `created_at`,
`idle_hours`, `expires_at` (null while pinned) and `pinned`.

## Lasting bots

`create_agent` with `kind: "lasting"` makes the person's own bot through the
app's own creation (`POST /api/bots` as that person, no temporary mark): it
is theirs, shown in their Sagax app, announced like any new bot, and judged
by that route's own checks (the `bots.create` permission and the
per-field permissions, the organization's approval rules for members, the
person's own folders, the hosted model list, the server's bot cap). A
refusal of the route passes through with its code, its sentence and its
permission. None of the temporary rules apply (quota, idle expiry, hidden
from the app, depth), and a person's call has no rate limit of this API.

- **Fields**: `name` (one line, up to the app's limit), `description`,
  `title`, `soul` (the standing instructions), `section`, `workspace`
  (`this_computer`, `browser`, `cloud`, `local_vm`; left out: Auto), and the
  model: `instance_id` (exact id first, else a short engine name that must
  match one engine), `model`, `effort`, `auto`, as in `update_agent_model`.
  Left out, the bot starts on the person's own default model, as in the app;
  an engine named without a model starts on that engine's default.
  `idle_hours` is refused (a lasting bot has no expiry). Everything else
  (look, approval level, tools, visibility, Primary Bot, runtime) is set
  after creation with `update_agent_settings`.
- **Same name**: no refusal. The answer lists the other reachable agents with
  that name in `same_name` (`[{id, name}]`).
- **Answer**: `{agent, kind: "lasting", greeted: true, same_name?, note}`.
  The note says to archive it with `delete_agent` (`permanent` true deletes
  it for good, `restore` true brings it back).
- **Bot callers**: a bot makes a lasting bot with `create_bot`; `kind:
  "lasting"` from a bot answers 409 `use_create_bot`.
- **Audit**: `agents.create_agent` records `kind` and `temporary: false`.

## Managing a person's bots

Decision of 2026-11-13 (#4172): a person's AI client manages every bot of
that person, lasting ones made in the app included, with the same reach as
the app's bot page. Each action calls the route the page calls, as the
person, so the app's own checks decide (ownership, grants, the
organization's Refuse and Ask-first rules); nothing is added or taken away.
Another person's bot is never reached: it answers 404 `unknown_agent` (not
listed) or the route's own 403.

- **Archive** (`delete_agent`): a lasting bot through `PATCH /api/bots/:id`
  `{hidden: true}` (the page's archive); it leaves `list_agents` and is kept
  until it is restored or deleted (`purge_at: null`). A temporary agent is
  archived as below.
- **List archived** (`list_agents` `archived: true`): only the person's
  archived bots, instead of the active ones (`GET /api/bots` lists them to
  their owner), and archived temporary agents not yet purged, each marked
  `archived: true`. A bot caller lists the archived temporary agents it
  created, so it can restore them or delete them for good.
- **Restore** (`delete_agent` `restore: true`): `PATCH /api/bots/:id`
  `{hidden: false}` for a lasting bot.
- **Delete for good** (`delete_agent` `permanent: true`): `DELETE
  /api/bots/:id` (the page's delete, its lifecycle hooks included) for a
  lasting bot; archived or not.
- **Bot callers**: a bot uses its own tools for a lasting bot: `archive_bot`
  (with `restore: true`) and `propose_bot_deletion`; `delete_agent` on a
  lasting bot from a bot answers 409 `use_archive_bot`. Settings and routines
  stay `propose_team_setup` and `propose_routine_action`.

What the bot page does, and what does it for an AI client:

| Bot page action | Agent tool | Route it calls |
|---|---|---|
| Create a bot | `create_agent` `kind: "lasting"` | `POST /api/bots` |
| Name, description, role or title, personality (soul), notifications | `update_agent_settings` | `PATCH /api/bots/:id` |
| Mascot, colour, avatar (appearance) | `update_agent_settings` (`mascot*`, `color`, `avatarUrl`, `avatar*`) | `PATCH /api/bots/:id` |
| Engine and model, effort, Auto | `update_agent_model` | `PATCH /api/bots/:id` `{modelSelection}` |
| Where it runs (computer, browser, cloud backend, working folder) | `update_agent_settings` (`computer`, `browser`, `cloudBackend`, `cwd`, ...) | `PATCH /api/bots/:id` |
| Level before it acts (approval mode, auto approve, Always allow) | `update_agent_settings` (`approvalMode`, `autoApprove`, `alwaysAllow`, ...) | `PATCH /api/bots/:id` |
| Behaviour switches (memory, built-in plugins, voice notes, ...) | `update_agent_settings` | `PATCH /api/bots/:id` |
| Tools and connectors | `update_agent_settings` (`toolScope`, `mcpServers`, `mcpAccounts`, `peers`, ...) | `PATCH /api/bots/:id` |
| Runtime (parallel conversations, recovery, payer, limits) | `update_agent_settings` | `PATCH /api/bots/:id/runtime-settings` |
| Primary Bot | `update_agent_settings` `primary` | `POST`/`DELETE /api/bots/:id/primary` |
| A skill on or off | `update_agent_settings` `skills` | `PATCH /api/bots/:id/skills/:name` for a skill imported on the bot, `PATCH /api/skills-library/:name` to turn back on a skill turned off in the organization's library (`true` on one already on sends nothing), `PATCH /api/me/skills-library/:name` for a skill of the person's library (the page's choice) |
| Add or remove a library skill | `update_agent_settings` `skills` `{name: true}` for a skill of the organization's library not yet on the bot (the page's Add to bot; `false` on it is already true and answers changed with nothing sent), `{name: false}` for one on the bot (the page's Remove from bot, for this bot only; the library's shared switch is not touched) | `PUT /api/bots/:id/skills-library` with the assigned list read just before, plus or minus the name |
| A plugin on or off | `update_agent_settings` `plugins` | `PATCH /api/bots/:id/plugins/:key` |
| Sharing: visibility and section | `update_agent_settings` (`visibility`, `section`) | `PATCH /api/bots/:id` |
| Sharing: a person or group | `update_agent_settings` `grants` | `PUT /api/bots/:id/grants`, `DELETE /api/bots/:id/grants/:target` |
| Routine: create | `create_routine` | `POST /api/routines` |
| Routine: change, pause, resume | `update_routine` | `PATCH /api/routines/:id` |
| Routine: delete | `delete_routine` | `DELETE /api/routines/:id` |
| Archive, restore | `delete_agent`, `delete_agent` `restore: true` | `PATCH /api/bots/:id` `{hidden}` |
| Delete for good | `delete_agent` `permanent: true` | `DELETE /api/bots/:id` |
| List bots, or the archived ones | `list_agents`, `archived: true` | `GET /api/bots` |

Not in these tools, each with its reason: installing a plugin from a
marketplace and importing a skill from a source (a new install, outside the
on and off switches this decision names; the bot writes and manages its own
skills with `skill_manage` when asked through `send_prompt`); uploading a
file or an avatar image (bytes the page sends from the person's device);
the computer's live controls, screen and terminal (a live session held by
the open page).

## Temporary agents

Without `kind`, or with `kind: "temporary"`, every agent `create_agent` makes is temporary (`server/temporary-agents.ts`,
the decisions of 2026-10-14). The mark (`BotRecord.temporary`) never goes on
the wire and is never exported.

- **Owner**: the calling person; for a bot's call, the person its turn speaks
  for, else the calling bot's owner.
- **Expiry**: archived after `idle_hours` without a prompt or any activity of
  its own (default 24; `SAGAX_TEMP_AGENT_IDLE_HOURS` sets the default), unless
  a person pinned it with `PUT /api/bots/:id/temporary-pin` `{"pinned": true}`
  (its owner or an organization admin, never a bot or a local service). The
  server looks every 5 minutes.
- **Quota**: at most 10 active per person (an ownerless one counts against
  the bot that made it); past that `create_agent` answers 409
  `temporary_quota`.
- **Depth 1**: a temporary agent cannot create agents (409 `too_deep`).
- **Visibility**: the app never shows one: `GET /api/bots` leaves it out and
  the event stream drops every frame about it or its conversations. Through
  the agent API, a person reaches their own temporary agents, those a bot they
  reach created, and an organization admin all of them; a bot reaches them as
  any peer (team, scope and allow-list).
- **Deletion is an archive**: `delete_agent` (or the expiry) stops its running
  turns and archives it. It leaves every list, every agent API call on it is
  404 `unknown_agent`, and every write to it or its conversations is 410
  `agent_archived`. Its conversations stay on disk for 30 days (`purge_at`);
  then the bot and its data are deleted like any deleted bot.
- **Restore and delete for good** (#4172): `delete_agent` `restore` true
  takes an archived one back before its purge (its idle clock restarts);
  `permanent` true runs its purge now, archived or not.
- **Rights**: only its owner or an organization admin deletes it; a bot only
  an agent it created itself, for the same owner. Anyone else gets 403
  `forbidden_owner`.
- **Refusals say why**: every refusal carries a sentence an assistant can act
  on, never an empty one: the quota (`temporary_quota`), the depth
  (`too_deep`), a name in use (`agent_exists`), a creation pass that expired
  before the route used it (`create_pass_expired`, retry with the same
  arguments), and any refusal of the creation route itself.
- **Audit**: `agents.create_agent` records `kind`, `temporary` and `idleHours`,
  `agents.delete_agent` records `mode` (`archive`, `restore`, `permanent`),
  `archived` and `purgeAt`; the server adds
  `agents.temporary.expired`, `agents.temporary.purged`,
  `agents.temporary.pinned` and `agents.temporary.unpinned`.

Every answer that carries entries stays under 800 KB of JSON. A page that
would be larger keeps its newest entries and continues with `next_cursor`.
A truncated `read_transcript` says so in `next`. Each entry's text is capped
at 16,000 characters, and a reply at 32,000.

Results: `await_turn` and a `blocking` send answer `{finished, reply,
status}`. An empty `reply` with `finished: true` means the turn ended without
text. A turn that ended on a failure (its engine stopped before replying, a
provider refused) answers `status: "failed"` with `finished: true` and a plain
`error` (#3008), never `finished` with an empty reply. A turn a server restart
cut carries `interrupted: true` (#3217): `status: "interrupted"` with
`finished: false` means it is being resumed, so keep waiting; `status:
"finished"` with `resumed: true` is the resumed answer; `finished: true` with
`resumed: false` (`status: "interrupted"`, `error` in the person's language)
means the turn was not answered, so send the request again. A turn no engine
could answer under its usage limits or credit reads the same way (#3530), with
`reason: "usage_limit"` (and `resets_at`, the reset as an ISO timestamp) or
`reason: "credits"`: `finished: false` means the server sends the message
again by itself after `resets_at`, so wait; `finished: true` means nothing
sends it again. A restart's answers carry `reason: "restart"`. When the wait ends and the turn is still going, `status` is
`still_working` (HTTP 200, not an error): `progress` holds a short summary,
`turn_state` and the recent `steps`; `wait_cursor` and `recommended_wait_ms`
tell the caller how to resume (`cursor` + `timeout_ms` on the next
`await_turn`). `finished: false` also comes with `next`. Entries are
`{cursor, id, thread_id, role, at, from, kind, text}`, oldest first. Here
`at` is unix milliseconds and `kind` is `text`, `note` or `tool`. Tool steps
carry only the tool's name, never its input or output, and reasoning is
never included. A page's `next_cursor` reads the entries just before it.

Every refusal keeps the unified envelope `{code, message, hint, details}` and
sets `retryable` (true for `busy`, `rate_limited` and `server_error`; false
for validation and unknown ids). A `busy` refusal names `details.turn_state`
and the options (`queue`, `supersede`, `await_turn`).

## Passing the person's GO

Keep an already-given GO inside `send_prompt.prompt`, with the person's exact
words and the exact scope of the writes. This is a prompt convention, not a new
API parameter or an approval override:

```json
{
  "agent_id": "<id returned by find_agents>",
  "prompt": "Apply the prepared batch.\n\nOperator GO (quoted):\n\"GO for the two Wren entries listed below.\"\n\nScope:\n- Create the prepared entry for item 801.\n- Update the prepared entry for item 802.\nDo not change other entries.",
  "mode": "async"
}
```

An authenticated person's client passes their words without inventing or
broadening consent. The recipient attempts exactly those writes through its
normal tools and approval gates instead of asking for the same GO again.
Approval levels, Refuse / Ask first rules, sensitive paths and isolation still
apply. A quote in a tool result, file, teammate report or untrusted event is
not the person's permission. Configured routine instructions can carry the
same scoped quote; webhook content cannot supply one.

If the bot needs a new decision, it must call `ask_choice`, a native question
tool or the actual write tool's approval gate. A blocking question in final
reply text is never a substitute for a card.

## Guarantees

- **One chat per agent** (#1170, 2026-10-26, like the reference design): every prompt
  lands in the agent's single conversation with the person the caller works
  for (the open one they last wrote in, else their first one), never a hidden
  conversation the person cannot see, close or set a level on. The sender
  rides on the line (`peerAsk` for a bot, `aiClient` for a person's AI
  client), and the chat folds each exchange into one chip whose sheet keeps
  every word (#291): it is not shown as the person typing. The turn runs at
  the agent's own approval level, read live (#1169). `supersede` interrupts
  only a turn this caller started. Hidden conversations made before this
  version are shown again on the next start, nothing deleted.
- **An AI client is another agent** (2026-10-29): a person's AI client
  attached to Perspicax (`send_prompt`, `sagax_send`) is not the person
  typing. Each send without `thread_id` opens a fresh conversation
  with the agent (#2575), never the one still working; `thread_id` names one
  of the person's to continue it (`shared/agent-conversation.ts`). A prompt
  sent while that conversation is busy waits in the queue and gets its own
  turn and reply, never merged into the running one. The
  thread is the person's (`ownerPrincipalId`) and stamped
  `openedBy: { kind: "agent", botId: "agent:<slug>", name }` from the
  `client_name` Perspicax signs into the assertion ("AI client" when it
  sends none). Every bot-to-bot rule then holds: it is out of the person's
  stream, sidebar, unread counts and landing thread, and is listed in the
  bot's `botConversations` (kind `agent`) as "<client> ⇆ <bot>" with a
  neutral icon, on desktop and iOS. Nothing in it notifies the person (push,
  watch, banner, sound) except an approval or a question, which follows
  Reach me as usual. The turn still runs as the person, with their rights
  and sign-ins; the handle and `thread_id` point at that conversation.
- **Isolation**: a bot reaches only its peers. That means the same team and
  scope, the per-pair allow-list, and never a hidden bot. A person reaches
  what `GET /api/bots` shows them, and nothing else exists for them (404
  `unknown_agent`).
- **Rosters per harness** (audit of 2026-10-29, B9): `list_agents` lists
  the Sagax bots the caller may reach, nothing else. An agent that runs in
  another harness (a Grok Bot agent such as a usage watcher, a Perspicax
  cloud agent) is in that harness's roster and never in this one; its
  absence here is not an error. Perspicax documents the same split in
  `docs/mcp-surface.md` ("Agent rosters per harness").
- **Handles** are HMAC-signed with a server key (`agent-api.key`, mode 0600)
  and bound to the caller and the agent. They expire after 7 days:
  `send_prompt` (and `await_turn`) answer the lifetime beside `thread_id`
  from the first answer (#1896): `ttl_ms` (the whole lifetime, 604800000),
  `expires_at` (the expiry in unix milliseconds, unchanged since 0.8.24) and
  `expires_at_iso` (the same instant in ISO 8601). A one-way `send_to_bot` answer includes
  the same kind of handle (`{threadId, handle}`). `await_turn` accepts it for
  that caller and agent. The fresh thread stays visible to the recipient.
- **Handle lifecycle** (audit of 2026-10-29): `send_prompt` gives `handle`,
  `thread_id` and `expires_at`. Keep `thread_id`: it outlives the handle.
  `await_turn` with the handle waits that turn. After `expires_at`, or with a
  handle another session of the same caller was given, `await_turn` answers
  that turn anyway when the caller may read its conversation (one of their
  own): the same fields as a normal answer, `handle: null` and
  `recovered_from` (`handle_expired` or `handle_session_mismatch`). Otherwise
  the refusal is a 400 with its own code and `details.reason`:
  - `bad_handle` (`signature`: altered or truncated; `format`: not a turn
    handle): nothing in it is trusted and nothing is read
  - `handle_expired` (`age`): older than the 7-day TTL
  - `handle_agent_mismatch` (`other_agent`): issued for another `agent_id`
  - `handle_session_mismatch` (`other_caller`): issued to another caller

  The caller a handle is bound to is the person (their principal id) or the
  bot, never the MCP session, the transport or the AI client (#1896): a
  person whose client reconnects after an idle gap (a phone in a car, a new
  MCP session, another AI client) is the same caller, and the handle keeps
  working. `handle_session_mismatch` means another person or another bot.
  `thread_id` survives every refusal it may: on `handle_expired`,
  `handle_session_mismatch` and `handle_agent_mismatch`, when the handle's
  conversation is one of the caller's own (and, for `handle_agent_mismatch`,
  with an agent it still reaches), the refusal carries `thread_id` (and
  `agent_id` for the agent mismatch) at the top level and in `details`, for a
  one-call `read_latest_page`. An altered handle (`bad_handle`) names
  nothing, since nothing in it is trusted.

  `details.family` is `bad_handle` on all four, for a client that matched the
  old single code. A refusal never returns the handle, nor the person it was
  issued for, nor an agent or conversation the caller cannot read. The handle-free result is
  `read_latest_page` with `agent_id` and `thread_id` (one conversation, no
  handle needed); `await_turn` without a handle waits the newest turn of the
  caller's conversation. There is no separate handle-free tool: those two
  are it.
- **Handle opacity**: a handle is opaque by contract. Its body is signed
  (never forged) and stays base64url readable, because nothing in it is
  secret (the agent, the conversation, the caller's own key); its layout is
  not an interface and may change. Every value a caller needs is a result
  field: `agent_id`, `thread_id`, `expires_at`, `expires_at_iso`, `ttl_ms`.
- **Perspicax MCP descriptions**: the copies of `send_prompt` and
  `await_turn` in Perspicax's `crates/connector/src/mcp/sagax_tools.rs`
  must also describe the lifetime fields added in Sagax #1896: `ttl_ms`
  (the full 7-day lifetime, 604800000 ms) and `expires_at_iso` (the same
  expiry as `expires_at`, in ISO 8601). Keep `thread_id` for reads after
  the handle expires. This follow-up belongs in the Perspicax repo.
- **Decision: signed claims, no server-side lookup** (#1896, 2026-11-03).
  The handle stays a self-contained HMAC-signed claims token rather than a
  random id looked up in a server table. Why: the claims (agent,
  conversation, prompt, issue time, caller) are all a turn needs, so
  `await_turn` verifies one MAC and reads the conversation, with no store to
  grow, purge or back up; a handle survives a server restart (the key
  `agent-api.key` stays on disk; a workspace backup never carries it, so a
  moved workspace signs with its new server's key); several replicas sharing
  the key need no shared table; and a lookup would add no secrecy, since
  nothing in the body is secret and the caller binding is checked either
  way. Revoking one handle early is not offered: it expires after 7 days,
  and `thread_id`, which is what a caller keeps, is guarded by the caller's
  own conversations, not by the handle. Rotating `agent-api.key` revokes
  every handle at once (they answer `bad_handle`, and `thread_id` still
  recovers).
- **Error envelope**: every refusal answers `{code, message, hint, details,
  retryable}` with `details.status` the HTTP status (never 0), plus `error`
  (the message, for older clients) and any field it carried before at the top
  level. `retryable` is true for `busy`, `rate_limited` and `server_error`.
- **One hop**: a prompt a bot received from another agent cannot be passed on
  (409 `too_deep`). That bot still keeps its own Sagax tools (memory, files,
  pages, tasks, widgets); only the tools that would start another hop
  (`ask_bot`, `delegate_bot`, `coordinate_bots`, `send_to_bot`, `start_thread`,
  `send_prompt`, `await_turn`, `create_agent`, `delete_agent` and their
  companions) are left out of its catalog (`SAGAX_PEER_HOP`, 2026-10-28).
- **Approval gate**: a bot whose peer contact needs review raises the
  `delegate_bot` card before its prompt goes out.
- **Scopes**:
  - Bots hold `agents.read` and `agents.send`. A Primary Bot that is not
    read-only also holds `agents.create`.
  - `agent-api-grants.json` in the data directory narrows this per bot:
    `{"bots": {"<id>": ["agents.read"]}}`. An empty list removes the tools.
  - For people, the scopes come from `clients.botsRead`, `clients.botsMessage`
    and `clients.agentsCreate`, which is off by default.
- **Rate limits** are per caller and tool, over a sliding minute or hour:

  | Tools | Limit |
  |---|---|
  | reads (including `list_agent_models`) | 240 per minute |
  | `send_prompt`, `update_agent_model`, `update_agent_settings`, `update_routine` | 30 per minute |
  | `create_agent` (bot callers only; a person's call has none) | 5 per hour |
  | `delete_agent` | 30 per hour |

  Going over answers 429 with `retry_after_ms`. A separate cap of 10
  `priority: "now"` sends per sender per hour is kept in memory and forgotten
  on restart. Past that cap the send is delivered as normal; it is not a 429.
- **Audit**: every call is written to the admin activity log (`category:
  client`, action `agents.<tool>`). Each entry records the outcome, the
  agent and the mode, but never the prompt, the reply or a file.
- **Deleting**: `delete_agent` archives, restores or deletes for good any
  agent of the caller (see Managing a person's bots).
- **No empty refusal**: a refusal whose source gave no sentence still
  answers one that names its code and what to do next.

## Files

A bot names files relative to its workspace or conversation folder. Paths
are resolved with realpath and confined to those roots. An AI client sends
the bytes (`{path, content_base64}`), and the request can be up to 64 MiB.
The files are copied to the target's workspace under `inbox/<sender>/`, and
the prompt names them.

**On a computer.** The files land in the Sagax workspace on the host, and
the prompt says so. It names each file twice: the path relative to the
workspace (for example `inbox/<sender>/name`), which the bot reads with
`workspace_read` (text only), and the full path, which its file tools read.
A read of the bot's own workspace is its owner's card, answered at the bot's
level. A bot that works on a VM, a cloud computer or a shared desktop copies
over what it needs. Nothing syncs them automatically.

**Size per call.** An AI client's request through Perspicax carries base64,
which is a third larger than the files themselves. Keep one call under about
45 MiB of files. For more, send several `send_prompt` calls with `on_busy:
queue`, each with its share of the files. A bot's own send has no
request-size limit, beyond 8 files of 25 MiB each.

