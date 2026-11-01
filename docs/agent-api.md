# The agent-to-agent API

Twelve tools let one agent find, prompt and read another agent, with the same
names, parameters and limits as the reference design's agent tools, plus `get_agent` and
`delete_agent` (Perspicax #321). One core
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
| `list_agents` | read | `agents.read` | every agent the caller can reach, with status `running`/`idle` |
| `find_agents` | read | `agents.read` | `query`, optional `status` (`running`/`idle`), `limit` ≤ 64 (default 8) |
| `get_agent` | read | `agents.read` | `agent_id`: the full profile for an audit (see below) |
| `create_agent` | admin | `agents.create` | one temporary agent per call (see below), `name` (≤ 80 chars, one line), optional `description` and `idle_hours` (1 to 720, default 24); it greets the person itself. Only on the person's explicit ask |
| `delete_agent` | admin | `agents.create` | `agent_id` of a temporary agent: archives it (see below). A lasting agent answers 409 `not_temporary` |
| `send_prompt` | write | `agents.send` | `agent_id`, `prompt` (≤ 32,000 chars), `mode` `fire_and_forget` (default) / `blocking` / `async`, `timeout_ms` (1 s to 10 min, default 120 s; the live blocking wait is capped at 55 s so the handle returns as `still_working`), `on_busy` `queue` (default since 2026-10-17: waits its turn) / `reject` (409 `busy`, `retryable: true`, with `details.turn_state` and options) / `supersede` (stops the running turn this caller started and the approval it waits on; never the person's own turn or another caller's), optional `priority` `now` or `normal` (default `normal`), up to 8 `files` (workspace-relative, 25 MiB each), optional `thread_id` (one of the caller's own conversations, 404 `unknown_thread` otherwise). A bot's send lands in the agent's single chat with the person the caller works for (#1170); a person's AI client's send lands in its own conversation with the agent (2026-10-29, see Guarantees); `thread_id` continues one of the caller's conversations instead. Answers a `handle`, its `expires_at` (unix ms) and a short `label` (the agent's name and the prompt's first words). `now` wakes an idle agent at once or moves the prompt to the front of its queue, and never interrupts a running turn. Past 10 `now` sends an hour the answer is `priority: "normal"` with `downgraded: true` and `priority_note`. Refusals keep the unified envelope and set `retryable` |
| `await_turn` | read | `agents.read` | `agent_id`, `handle`, `timeout_ms` (0 to 55 s, default 45 s), optional `cursor` (a prior `wait_cursor`). The handle is the one `send_prompt` returned, or the `{threadId, handle}` a one-way `send_to_bot` included (copy it exactly). Never send the prompt again: wait again with the same handle. When the wait ends and the turn is not done, the answer is `still_working` (HTTP 200) with `thread_id`, `progress.summary`, `progress.steps`, `wait_cursor` and `recommended_wait_ms`; pass `wait_cursor` as `cursor` on the next call so steps are not repeated. Without a handle, waits the in-flight turn of your conversation, else its last message. An expired handle, or one of another session, on a conversation the caller reads answers that turn (`handle: null`, `recovered_from`). Else a 400 `handle_expired`, `handle_session_mismatch`, `handle_agent_mismatch` or `bad_handle` (altered), `details.reason` and `details.family: bad_handle`, and a `hint` to read `read_latest_page` with the `thread_id` `send_prompt` returned (see Handle lifecycle) |
| `read_transcript` | read | `agents.read` | the whole transcript (the newest 2,000 entries; `truncated` says when there were more) |
| `read_transcript_page` | read | `agents.read` | one bounded page: `limit` (1 to 200) and `before_ms` required, `after_ms` optional (inclusive unix ms), `cursor` for the next older page |
| `read_latest_page` | read | `agents.read` | the newest page: `limit` ≤ 200 (default 20), `cursor`, optional `thread_id` (one of the caller's conversations, 404 `unknown_thread` otherwise) |
| `read_latest_page_with_threads` | read | `agents.read` | the newest page and the conversations it spans, with their status; optional `thread_id` like `read_latest_page` |
| `read_transcript_cold` | read | `agents.read` | the stored transcript only: pages of 50 by `cursor`; never reads live state, never wakes a computer or sandbox |

`list_agents`, `find_agents` and `create_agent` answer each agent as `{id,
name, description, status, temporary, owner}`. `owner` is
`{principal_id, name}` or `null` (same source as `get_agent`, with no
per-agent profile call). Pass `owner.principal_id` to `sagax_nudge` to
reach that agent's owner.

`get_agent` answers `agent` (the summary and its `title`), `owner`
(`principal_id`, `name`), `profile`, `temporary` and `profile_url` (the
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

## Temporary agents

Every agent `create_agent` makes is temporary (`server/temporary-agents.ts`,
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
- **Rights**: only its owner or an organization admin deletes it; a bot only
  an agent it created itself, for the same owner. Anyone else gets 403
  `forbidden_owner`.
- **Audit**: `agents.create_agent` records `temporary` and `idleHours`,
  `agents.delete_agent` records `archived` and `purgeAt`; the server adds
  `agents.temporary.expired`, `agents.temporary.purged`,
  `agents.temporary.pinned` and `agents.temporary.unpinned`.

Every answer that carries entries stays under 800 KB of JSON. A page that
would be larger keeps its newest entries and continues with `next_cursor`.
A truncated `read_transcript` says so in `next`. Each entry's text is capped
at 16,000 characters, and a reply at 32,000.

Results: `await_turn` and a `blocking` send answer `{finished, reply,
status}`. An empty `reply` with `finished: true` means the turn ended without
text. When the wait ends and the turn is still going, `status` is
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
  typing. Its sends go to its own conversation with the agent, one per
  agent, person and client, reused until `thread_id` names another or
  `newThread` asks for a fresh one (`shared/agent-conversation.ts`). The
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
  `send_prompt` (and `await_turn`) answer `expires_at`, the expiry in unix
  milliseconds, beside `thread_id`. A one-way `send_to_bot` answer includes
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

  `details.family` is `bad_handle` on all four, for a client that matched the
  old single code. A refusal never returns the handle, nor the agent,
  conversation or person it was issued for. The handle-free result is
  `read_latest_page` with `agent_id` and `thread_id` (one conversation, no
  handle needed); `await_turn` without a handle waits the newest turn of the
  caller's conversation. There is no separate handle-free tool: those two
  are it.
- **Handle opacity**: a handle is opaque by contract. Its body is signed
  (never forged) and stays base64url readable, because nothing in it is
  secret (the agent, the conversation, the caller's own key); its layout is
  not an interface and may change. Every value a caller needs is a result
  field: `agent_id`, `thread_id`, `expires_at`.
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
  | reads | 240 per minute |
  | `send_prompt` | 30 per minute |
  | `create_agent` | 5 per hour |
  | `delete_agent` | 30 per hour |

  Going over answers 429 with `retry_after_ms`. A separate cap of 10
  `priority: "now"` sends per sender per hour is kept in memory and forgotten
  on restart. Past that cap the send is delivered as normal; it is not a 429.
- **Audit**: every call is written to the admin activity log (`category:
  client`, action `agents.<tool>`). Each entry records the outcome, the
  agent and the mode, but never the prompt, the reply or a file.
- **Deleting**: `delete_agent` archives temporary agents only; a lasting
  agent is deleted by its owner in Sagax.

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

