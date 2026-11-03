# Approval levels

Approval levels belong to a bot and apply to its next provider turn, including
when that provider resumes an existing native thread. Each level is one of the
provider's own permission modes, passed through. Sagax does not judge an
action itself: there is no app-side allowlist, classifier, or pattern rule. A
native tool request that reaches you is one the provider left for you. In Full
Access, OMB also applies its own configuration tools without another approval.

| Level | Behavior |
| --- | --- |
| **Ask for approval** | Requests approval for commands and file changes, the way the provider's supervised mode does. |
| **Auto-accept edits** | Approves file edits automatically; other actions can still require approval. Offered where the provider has such a mode (Claude, Grok, Antigravity). |
| **Approve for me** | Uses the provider's automatic review on Codex, Claude, Cursor, and Grok to approve routine actions and ask about others. Providers without an equivalent fall back to asking. |
| **Full access** | Enables the provider's permissive mode for commands, edits, and selected-computer actions, including potentially destructive or sensitive work. Residual native permission prompts are answered for you, the safety review's safer path and confirmation too, and a may-I the model poses (`ask_choice` or its question tool) is answered with its recommended option (#1905). OMB profile changes, routine actions, team setup, bot deletion, and enabled skill authoring apply without a second approval. Peer-review prompts are skipped within the bot's authorized scope. Delegation uses the receiving bot's setting, never the sender's, except from a Primary Bot, whose level flows down (below). Actual questions and missing credentials still need your input. |
| **Custom (`config.toml`)** | Codex only. Sagax reads and reapplies the effective approval and sandbox settings from your Codex configuration. |

The composer is the same in Simple and Advanced mode (Settings, Appearance,
"Advanced mode"): the level is the icon left of the message field (a warning
sign for Full access), and it opens the full menu above. A pick applies at
once, with the warnings below; the level cannot change while the bot works. Only
bot settings differ: in Simple mode they stack two choices, **Ask me first**
(Ask for approval) and **Decide for me** (Approve for me), and another saved
level stays until one of the two is picked.

Advanced is the default for everyone, solo or organization, owner, admin or
member. A person who had Simple saved was moved to Advanced once, the first
time the version with this default started; a marker
(`sagax.advancedModeMigratedAt.v1`, kept per person on an organization
server) stops it from happening again, so Simple chosen afterwards stays.

Full access is an elevated-risk standing approval. Full and Custom can only be
enabled from a packaged local desktop app, where the choice crosses a private
process channel rather than the bot-accessible HTTP API. They are hidden in
development, standalone web, and remote pages. Full access does not bypass operating
system privacy controls, authentication, CAPTCHA or MFA, service permissions,
or workspace/team ownership and computer-sharing grants. Full Access controls
approval prompts; it does not sign in for you, enable a feature you disabled,
or grant another bot access to a different workspace.

### The level a new bot starts on

On a solo server a new bot and its first thread start on **Approve for me**
(a bot on This computer starts on Ask until its own warning).

On an organization server the organization decides (2026-10-11). The
console's New bot default (`defaults.approvalMode` of the admin API's
`POST settings`, the same value as Settings > New bot defaults) sets it:
**Approve for me** when it says `auto`, **Ask for approval** otherwise,
including when no policy was ever saved. `full` and `custom` start on Ask
too: they need the owner's own confirmation for that bot, which a bot that
does not exist yet cannot have. New bot, the API and a Primary Bot creating
a teammate follow it; a level the request names still wins, and imports and
team backups still start on Ask. Existing bots and threads never move: the
one-time switch of older bots from Ask to Approve for me does not run where
new bots start on Ask.

An organization admin can move existing bots to Approve for me from the
console, bot by bot with a confirmation (admin API `POST bots/bulk`,
`action: "approvalMode"`, docs/org-admin-api.md): Ask or Approve for me
only, never Full or Custom, one admin activity row per bot. A bot's
conversations that saved their own level keep it unless the admin also
moves the conversations on Ask (`threads: true`).

**Full access** on an organization server is off until an admin turns it on
(Settings > Organization > Allow full access, or `allowFullAccess` in the
admin API's `POST settings`). A saved choice, on or off, is kept. An
organization that never saved it and whose bots already ran on Full keeps
Full allowed: the first start of this version writes `allowFullAccess:
true` once (an `org.settings` row in the admin activity log), so no bot
changes level.

The approval level belongs to the bot (#1169/#1170, 2026-10-26: "that
setting is the bot's, every thread always inherits"). Every thread, hidden or
visible, started by a person, `send_prompt`, delegation or a routine, reads
the bot's current level at the start of each turn: nothing is copied when a
thread is made, and setting the bot's level reaches every thread at once.
A thread keeps a level of its own only as a stated exception
(`approvalOwn`): a level a person chose in that thread (`thread`), a
Primary Bot's delegated level (`delegated`), Ask again after an engine
change (`engine`), or a safety revocation (`safety`). The thread's chip
shows it, Refresh permissions ends it, and any change of the bot's level
ends every one. Threads saved before this version kept a copy of the bot's
level from the day they were made; that copy is dropped on start, and they
follow their bot. Ask, Auto, and Custom retain
their existing OMB configuration review cards. Full actions return an applied
result and leave a settled receipt, so the bot continues in the same turn.
Invalid input, unavailable services, or failed writes return errors, not a
request to approve again. An expired native permission request is not turned
into another Allow/Deny card.

A turn a webhook, a routine, or another bot started runs in the bot's level
like any other turn. The decision log records that nobody was at the keyboard
when such a turn asked.

### A member's bot on an organization server

A bot whose owner is a member (not an organization admin) runs Ask as Ask.
Its Auto-accept edits and Approve for me pass through to the provider
unless an organization admin turned them off: **Settings > Organization >
Automatic approval levels for members' bots**, or `memberAutoApproval` in
the admin API's `POST settings` (on unless an admin turns it off; each
change is an `org.settings` row; `server/approvals/member-auto-approval.ts`). While it
is on, a looser level still needs the person's security key when they
chose the rule-change class. While it is off those levels run as Ask, and a
change of a member's bot (or one of its threads) to one of them is refused
with 403 `member_auto_not_allowed`. The first time it is turned off, every
saved Auto-accept edits or Approve for me level of a member's bot (the
bot's own and each thread's) is set back to Ask, once
(`organization.memberAutoResetAt` records the pass), so turning the setting
on again brings no earlier level back. The same holds for a room turn: a
Primary Bot's handoff (`roomTurnApprovalMode`) never lifts a member's bot
past what this setting allows (`memberRoomTurnLevel`), and a Primary Bot
never saves its Auto or Auto-accept edits on a member's thread it opens
(`applyDelegatedLevel`). No other path stores one either (re-review of
2026-10-17): the admin console's `approvalMode` action on a member's bot
answers `member_auto_not_allowed` for that bot, a member's new bot (or one
a Primary Bot makes for them) starts on Ask whatever the New bot defaults
say, and a bot that becomes a member's (a console copy, import or
transfer, a solo backup brought in) has its automatic levels set back to
Ask. A bot whose owner stops being an organization admin is a member's bot
from then on: its saved automatic levels go back to Ask when that change
reaches the server (a sign-in or the directory), and every start checks all
bots again, so no saved Auto outlives the setting (2026-10-17,
`memberAutoSettle`). Custom stays Ask (a
`config.toml` on the shared server is not the member's), and Full keeps the
organization rules above.

It also governs the owner's own **permission mode** of a member's bot
(Automatic, Bypass, `server/approvals/owner-approval.ts`): while the setting is off
the mode runs as Approval, and choosing Automatic or Bypass is refused with
`member_auto_not_allowed` (re-review of 2026-10-17).

What this setting does not govern: a bot an organization admin owns (its
Auto stays the admin's choice), and the owner's own environment below (a
bot working in its owner's environment without a card,
`memberEnvironmentAutonomy`), which has its own switch. Turning
`memberAutoApproval` off does not stop owner-environment autonomy; turn
`memberEnvironmentAutonomy` off for that. Every organization turn withholds the engines' own tools that act on
the server (shell, files, fetch: `docs/user-sandbox.md`), so what reaches
Sagax is a Sagax tool, routed per tool: a card that would act on the shared
server or beyond the owner's own rights still goes to an organization admin
(an admin card, whatever the level; since 2026-10-21 its Always allow keeps
the program of a shell line for that bot only, which the bot's owner or an
admin removes in the bot's Approval rules: `docs/member-admin-audit.md`).

### Organization rules and "Always allow" off (2026-10-21)

An organization admin can, in the Perspicax console (`org-approvals`,
`docs/org-admin-api.md`), write rules in plain words for every person and
bot of the server, and turn "Always allow" off for everyone
(`server/custom-rules-org.ts`). An organization rule asks first or refuses,
never allows; it wins over a person's own rule of the same behavior, shows
in each bot's Rules card and on the card it decides as "Required by your
administrator", and nobody else can change or remove it. With "Always
allow" off, every card offers Deny and Allow once only and says that the
organization requires an approval each time; every answer path refuses an
answer that would save a standing grant (403 `org_always_allow_off`, in
`server/step-up-gate.ts`), and the grants people saved before (allow rules
in their words, saved commands, a gate's Always allow key, owner allow
rules) stop answering (`autoVerdict`, `matchOwnerRule`, the custom rule
store) until it is on again. An organization Refuse rule refuses even an email
draft the person approved on its card. Not yet covered (read in
`server/index.ts`): a My Chrome site grant and a published page's tool
grant saved before; a bot's Always allow keys added through its settings
while off (saved, unused until it is on again); and organization rules
apply to the engines' tool calls only, not to a bot act, a proposal or a
kept send. Approval levels are not grants: Auto and Full keep their meaning
(`memberAutoApproval` and `allowFullAccess` govern them).

### The owner's own environment

On an organization server each person has their own isolated environment:
their server environment (`sagax-environment`: one sandbox per person, no
capability, no host mount, no private-network egress) and, on their own
computer, their Local VM (the `local_vm` tool of `sagax-desktop`). A bot
working for its owner in that owner's own environment runs the commands it
needs there without a card, while the organization allows it: **Settings >
Organization > Bots work freely in their owner's environment**, or
`memberEnvironmentAutonomy` in the admin API's `POST settings` (on unless an
admin turns it off; each change is an `org.settings` row). The environment
still holds the owner's own credentials (a git credential store, a GitHub
CLI login) and reaches the internet, so this is bounded
(`server/member-environment.ts`, security review of 2026-10-16):

- only at a level that already runs work unasked: **Approve for me** or
  **Auto-accept edits**. At **Ask** the person asked to see every call, so
  each one is a card (the owner's, never an admin's);
- never when the call falls in a class the person (the bot's owner, or the
  person the turn speaks for) protects with a security key (Settings >
  Security). Any shell command that is not a plain read is destructive and
  irreversible, and so is the Local VM's `run` (`sagax-desktop__local_vm`
  with `action: "run"`), so with that class chosen every such command is a
  card and its Allow needs the key. Since 2026-10-17 the action tools are in
  a class too (`shared/step-up.ts` `actionToolClasses`): a file write
  (`write_file`, `Write`, `Edit`, `apply_patch`...) is irreversible, and
  destructive when it may replace a file outside the thread's own folder (a
  write on another machine, the person's environment or computer, always
  may). One write is in no class: a new file in the thread's own folder
  (`task-workspaces/<bot>/<thread>`), checked on this server's disk (nothing
  at the path, not even a broken link, and inside the folder after links
  and `..`), neither a dot path (`.claude/`, `.mcp.json`, `.git/`,
  `.envrc`...) nor an engine's instruction file (`CLAUDE.md`, `AGENTS.md`,
  `GEMINI.md`), and not a move, a patch or a server's write: removing the
  file undoes it. Replacing or editing a file there stays irreversible (that
  folder has no checkpoint). `computer_use` and the Local VM's screen
  (`local_vm` with `action: "use"`) are irreversible unless they only look
  (screenshot, screen size, apps), and destructive for a delete key, a key
  with a command modifier (cmd, ctrl, alt, super), or typed text a shell
  reads as a deletion (`rm -rf ~`, `find . -delete`; any line, and text
  too long to read); `browse`, `fetch_url` or `open_url` with a
  method other than GET or HEAD, a body, form fields or a submit is
  external-send;
- only the owner's own turn: a turn another bot started (`ask_bot`,
  `delegate_bot`, `coordinate_bots`, a peer ask), a routine, a webhook, a
  typed trigger, an email or any other automation, a room without a known
  person, or someone else speaking gets the reads only (`read_file`,
  `list_files`, `computer_list_tools`), and never of a dotfile or a
  credential path (`.git-credentials`, `.config/gh/hosts.yml`, `.ssh`,
  `.netrc`, `.npmrc`, `.aws`, `.docker/config.json`, `.kube`, any name that
  starts with a dot, a `..` segment, a key or credentials file). Every other
  call keeps its card;
- the owner's own **permission mode** (Automatic, Bypass, Settings > the
  bot's permissions) and their **Always allow** rules follow the same two
  limits: a call in a class protected by a security key keeps its card
  (its Allow needs the key), and a call from a turn that is not the owner's
  own runs unasked only as such a read (`server/approvals/owner-approval.ts`
  `ownerDecision`, re-review of 2026-10-17). A deny rule still denies;
- the person's own deny and ask rules, the safety review and the grant
  guard decide first, on every engine. On a Grok turn under the approval
  gate (`docs/grok-approval-gate.md`) the gate holds these calls like any
  other and sends them to the same decision;
- only the server environment's tools (`run_command`, `read_file`,
  `write_file`, `list_files`, `browse`, `computer_list_tools`,
  `computer_use`) and `local_vm`, of the servers Sagax mounted for this turn
  as the owner's environment (never a server's name alone; both names are
  reserved, no person's server can take them);
- only when the environment this turn mounted belongs to the bot's owner. A
  bot shared with someone else, working in that person's environment, keeps
  the owner's card;
- never an admin card, and never answered for a sandbox widening, a send, a
  question or a guest's turn;
- each call answered this way leaves a decision-log row (`own-environment`)
  and a receipt in the conversation;
- This computer (every other `sagax-desktop` tool: the person's real files,
  apps and network) is not an isolated environment and keeps its cards.

Entering **Full access** answers every call, so it needs the person's
security key as soon as they protect any class (not only the rule-change
class), wherever the level is changed.

What Sagax does not see: on **Approve for me** with Claude, Claude's own
automatic reviewer (`--permission-mode auto`) decides inside the engine and
lets through what it judges safe without asking Sagax. Those calls never
reach Sagax's approval path, so neither the limits above, nor the security
keys, nor the person's own rules apply to them; only what that reviewer
leaves to Sagax does. Use **Ask** or **Auto-accept edits** to have every
such call go through Sagax.

The same holds for Codex (`approvalsReviewer: auto_review`), Qwen
(`--approval-mode auto`) and Cursor (`--auto-review`) on **Approve for me**:
their own reviewer decides first. The reference design has a single reviewer, so a bot
can be switched to one reviewer (the reference design parity A13,
`server/drivers/sagax-reviewer.ts`): with `DATA_DIR/sagax-reviewer.json`
`{"bots": ["<botId>"]}` (or `{"bots": "all"}`), Approve for me on those
engines starts Qwen at `auto-edit` and Codex and Cursor with the person as
reviewer, so every other call reaches Sagax's approval path, where the
person's rules and saved commands still answer without a card. Off by
default until each engine is benched; read at each turn, no deploy needed.

### A Primary Bot's level covers the work it delegates

Approvals were where a team's owner spent their day: every teammate a Primary
Bot brought in started at "Ask for approval", so the owner either answered a
card every few minutes or switched each new thread by hand. So **a Primary
Bot's level flows down**. Work it delegates (`coordinate_bots` into a
teammate's thread, and `delegate_bot`) starts at the level of the Primary Bot
conversation it came from: Auto-accept edits, Approve for me, or Full access.
The delegated thread is switched to that level, keeps it, and opens with a
line saying so ("Approve for me — delegated by Clive, a Primary Bot on Approve
for me"); you can still change it in that thread. Work a Primary Bot hands out
inside a room runs at its level for that turn.

It only ever raises: a teammate already on a higher level keeps it, a teammate
on Custom keeps its own configuration, and a Primary Bot delegating from an
Ask conversation passes nothing on. A teammate's engine caps the level: one
without Full access gets Approve for me, and one without Auto-accept edits
(Codex, whose Ask already writes the workspace) stays on its own level. On an
organization server, a teammate inherits a Primary Bot's Full only when its
own owner allowed Full for it and the organization allows Full; otherwise a
Full Primary Bot's work reaches it as Approve for me. The teammate's own default
and its other conversations do not change, and an ordinary bot's delegation
still uses the recipient's setting. Questions and missing credentials still
reach you.

## Full access: one decision (#1065, #1819, #1905; 2026-11-02)

Full access came back as a card three times, each time from a surface the
previous fix had not touched: the owner's own computer (#1065), a may-I
`ask_choice` the model invented (#1819, fixed in the prompt only), and the
safety review holding a send (`send_to_bot` is a send by its name) before
the level was read (#1905, a Grok turn in `default` mode because the
account's connectors were loaded, so every Sagax tool asked). Since
2026-11-02 one module decides: `server/approvals/full-access-gate.ts`
(`fullAccessDecision`). Under Full access the bot acts, and only these
holds stand, nothing else:

- an organization rule set to Refuse or Ask first, and the person's own
  Refuse or Ask first rule (their words, or one saved from a card; a
  security key class on a gate card counts as one);
- isolation between people: a guest's turn, someone else's environment or
  data, a confidential thread the answerer cannot answer, the team's memory,
  a meeting with other people;
- a sensitive path or the shared server itself (an organization admin's
  card on a member's bot);
- a real question: the model's own options about a decision the person did
  not make, or a fact only they can supply.

What this changes for a turn at Full access:

- the safety review (`docs/security/misuse-guardrails.md`) offers no safer
  path and holds no confirmation; a misuse block stays a refusal;
- a may-I the model still poses, through `ask_choice` or its own question
  tool ("May I continue?", "Should I contact the verifier?", "Puis-je
  envoyer?"), is answered for the person with the recommended option, the
  first one (`shared/permission-question.ts`): the card is drawn settled,
  the chip and the Journal say Full access answered it, and the turn goes
  on. A real decision, a form of several questions and a missing fact keep
  their card;
- the chat-completions engines answer their own tool gate through the same
  decision; the peer card, the proposals (profile, routine, team setup,
  model, rule, terminal) and the outbound guard read it as before.

Every code path that can put an approval or a choice card between the bot
and the person carries a marker comment, `// full-access: <surface>`, with
the surface listed in `FULL_ACCESS_SURFACES`;
`server/approvals/full-access-gate.guard.test.ts` (run by `pnpm verify:merge`) fails a
card without one, a marker naming no surface, and a deciding file that
stopped reading the gate. `server/approvals/full-access-gate.regressions.test.ts`
holds the three incidents as tests.

## Answering a request

Approve or deny requests in the conversation to let the bot continue. **Allow
once** answers this request only. **Always allow this session** hands the
provider its own remembered approval: Claude receives its suggested permission
rules, and ACP agents such as Grok receive their `allow_always` option, or the
driver repeats your answer for that exact operation until the native session
ends. API models (OpenAI-compatible, MiniMax, Mistral, Grok API) have no
native session, so their driver keeps the allow for that bot, that exact tool
and that exact server (as launched: a changed command, URL or credential is
another server, and a bridge into a VM or a Boat is new each turn) for the
rest of the conversation, in memory until the server restarts. Another bot in
the same room asks again. Sagax keeps no standing grant for a provider's tool. It is not
offered for computer control, for a sandbox change or on a guest's turn. The
harness's own agents tools (coordinating teammates, threads, memory) never
ask on Claude, Codex or API models: Sagax authorizes each of those
routes itself.

### Sagax's own tools never ask (2026-10-16)

Sagax's own person-scoped tools are answered by Sagax itself, without a
card, on any engine and at any level (`server/sagax-internal-tools.ts`, a
reviewed list of exact names):

- the **Data** tools (`data_load`, `data_describe`, `data_sql`, `data_show`,
  `data_export`): the bot's own DuckDB database, only where DuckDB itself
  cannot reach further. On an organization server the engine is confined to
  the scope's own folders with no network (`server/data/engine.ts`), and a
  call answers itself while it stays in the bot's own workspace (its
  workspace and task workspaces). In solo DuckDB runs on the person's own
  computer, unconfined: since #1098 (2026-10-27) the same rule answers there
  (no forced card on `data_sql`, `data_describe`, `data_show`, `data_export`
  or a public `https://` load; a relative load path still asks). Everywhere,
  a load of a file elsewhere, a database connection (`postgres://`, `mysql://`), plain
  `http://`, another remote scheme, an `https://` address on a private,
  loopback, link-local or metadata network (or a local name), and SQL that
  names a file or a URL (`'/...'`, `'../...'`, `'~/...'`, a scheme, built
  out of sight with `chr()` or `$$`) or uses `ATTACH`, `COPY`, `INSTALL`,
  `LOAD` keep their card, which the person may allow;
- the **agents** tools a bot runs in its own scope
  (`server/member-tool-scope.ts`: its teammates, threads, rooms, memory,
  skills and own setup). The host-level ones (`act`, `add_mcp_server`,
  `attach_file`, `vm_exec`, `shared_computer`, the cloud agent tools) keep
  their card.

Every engine sends these calls to the server's approval path (security
review of 2026-10-16): Claude mounts Data without pre-allowing it, Codex
mounts it with `prompt`, the chat engines ask, and the Grok gate holds Data
like any other server. The server answers (`sagax-internal` in the decision
log) only after the grant guard, the safety review and the person's own
rules, and never: a safety hold, a Deny or Ask rule, a sandbox widening, a
send (`send_to_bot`, `post_to_room`, `send_voice_note` keep the outbound
guard), a rule change (`rules_update`), or a call in a class the person
protects with a security key. On an organization server a member's Data
call is never an admin card. Claude still pre-allows the agents tools
(`mcp__agents`), whose routes check who the bot is.

On an organization server Data runs inside the Sagax server, so each bot's
database is **confined** (`server/data/engine.ts` `confineConnection`):
after loading `excel` and `sqlite`, it sets `allowed_directories` to the
scope's own folder, the bot's workspace and the task folder of each
ordinary thread of that scope's person (never the whole
`task-workspaces/<bot>` folder, which holds every person's threads,
confidential ones included; a confidential thread's scope reaches only its
own thread's folder; no remote prefix at all; when that list changes, for
instance when a thread becomes confidential, the database reopens under the
new list before its next statement), turns `enable_external_access` off and locks the
configuration. DuckDB then refuses every other file (the server's data,
another person's attachments) and every remote source from SQL, `https://`
included, as well as database connections (`postgres://`, `mysql://`), on
the bot's and the panel's connections alike; `data_load` says so first
(`confinedSourceCheck`). An https `data_load` (or a Google Sheet's CSV
export) is downloaded by the server instead (`server/data/download.ts`):
the media proxy's private-address guard with an empty allow list, every
hop checked and the socket pinned to the checked address, redirects by
hand (5 at most, https and public only), 200 MiB and 5 minutes at most,
into the scope's `data-downloads` folder, read from there and removed.
Loopback, private, link-local, cluster and cloud metadata addresses are
refused. Exports land in the bot's workspace for its owner; a person's
own Data (below) exports only into
`<data>/data-scopes/<botId>/p-<hash>/data-exports`, which their own Data
database alone reaches: never the shared workspace, nor their thread
folders, which the admin console's file browser lists. A confidential
thread's go into its own folder (2026-10-17). A solo server is unchanged.

Each person has their own Data on a shared bot (`server/data/scope.ts`):
on an organization server, a turn spoken by someone other than the bot's
owner, and the Data tab that person opens, use a database and sheet of
their own (`<botId>~p-<hash>`, stored in `<data>/data-scopes/<botId>/`,
never inside the bot folder, which the bot's own database may read), so
nobody reads the tables another person loaded. The owner, routines and a
solo server keep the bot's own database. A confidential thread
(`docs/confidential-threads.md`) gets one of its own (`<botId>~t-<hash>`,
the server wires `setConfidentialThreadResolver` to it), reachable by its
owner only, on a solo server too; the Data tab asks for it with
`?thread=<id>` and keeps its sheet apart, and deleting the thread deletes
it. Live `data`
frames carry an `audience` and reach only that person (the bot scope only
its owner). Files in the bot's workspace stay shared by everyone who uses
the bot. Deleting a person's account (`DELETE /api/me`, Loi 25) erases
their own Data on every bot, their confidential threads' Data and their
exports there, each database closed first (`server/data/erase.ts`), and the
files of their own ordinary threads on other people's bots: each thread's
own folder, its tool results and the stored files no thread that stays
points at. A folder another thread works in is kept, and nothing of anyone
else's goes (`server/person-thread-erase.ts`).

Auto-accept edits and Ask card whatever the provider asks about. Approve for
me cards whatever the provider's reviewer leaves for you, with the note "The
provider requires your approval for this action." A sandbox widening is held
in every level but Full.

### When the native reviewer never starts

Claude Code accepts `--permission-mode auto` for every model and, when auto
mode is unavailable to the session, starts in Manual without an error. On
Claude Code 2.1.266 that is the case for Claude Haiku 4.5 and Sonnet 4.5,
and for any organization that set `disableAutoMode`. In that session the bot
asks before each action. The Claude driver reads the mode the session actually
runs in from the CLI's `init` frame; when Approve for me was requested and the
session runs Manual, the chat shows one notice per session naming the model.
Choose a model the reviewer supports, Auto-accept edits, or Full access to
stop the prompts.

### Changing a bot's engine

A bot at **Full access** or **Custom** goes back to Ask before it changes
engine, and the new engine's Full access is turned on again through its own
confirmation. Switching to an engine that cannot run the bot's level (for
example Auto-accept edits on Codex) also asks to choose Ask first.

### Antigravity: Ask, Edits, or Auto (full access)

For Antigravity, the composer and bot settings offer **Ask for approval**,
**Auto-accept edits** (its native `auto_edit` mode), and **Auto (full access)**.
Auto enables native `yolo` mode and automatically approves remaining
tool-permission requests for commands, edits, and computer actions, without an
automatic reviewer. The composer chip reads **Auto**. This uses the existing
Full access grant and confirmation, not a separate permission setting, and
applies to every model in that Antigravity instance, including Gemini.

Choose Auto explicitly in the local packaged desktop app. Old Antigravity
`auto` / `autoApprove` settings still behave as Ask and are displayed as Ask;
they never become unrestricted access on upgrade. Switching back to Ask
restores prompts on the next turn. Questions and missing-credential forms
still require an answer. A Primary Bot or
teammate can delegate work to this bot without downgrading its explicit Auto
(full access) grant. It does not enable Auto on any other bot.

## Asking you questions

Every engine can stop and ask, and no approval level ever answers a question
for you: Ask, Auto-accept edits, Auto, and Full access all leave a question
card for a person. What differs per engine is only how the ask travels:

| Engine family | How an ask travels | Multiple questions at once |
| --- | --- | --- |
| Claude Code | Structured round-trip (its own `AskUserQuestion`) | Yes — capped at 4 by the CLI |
| Codex | Structured round-trip | Yes — up to 6 |
| Grok Build, Minimax, OpenAI-compatible endpoints | The injected `ask_user` tool | Yes — up to 6 |
| ACP engines (Cursor, Antigravity, Gemini CLI, Qwen Code, OpenCode, …) | Option-match round-trip on the ACP permission request | One at a time — the request carries one choice set |
| Pi | Free-text round-trip over `extension_ui_request` | One at a time |

Whatever the engine, a bot is told to ask through its interactive question
tool, with the recommended option first, and never to put a list of choices in
its reply text. An engine with no question tool of its own (Gemini CLI,
Hermes, OpenCode, Pi, Grok Build on an organization server) gets the Sagax
`ask_choice` tool from the agents server: a card with 2-6 clickable options
and an Other field, whose answer arrives as the next message.

Older conversations may still hold a question the removed Computer engine
parsed out of model-authored output rather than a real tool call. Those
cards keep their "Agent-composed question" badge, and their decision-log
rows keep `origin: output`. Flat clients (notifications, older companion builds)
see plain buttons only when a card asks a single choice question; a
multi-question card renders its structured form on current apps instead.

## Provider mappings

| Provider | Ask | Auto-accept edits | Auto | Full access |
| --- | --- | --- | --- | --- |
| Codex | `on-request` approvals, `workspace-write` sandbox, you review | not offered (Ask already writes in the workspace) | same sandbox, native `auto_review` reviewer | `never` approvals, `danger-full-access` sandbox |
| Claude | Native `default` | Native `acceptEdits` | Native `auto` | Native `bypassPermissions` |
| Cursor | Native default | not offered | Native `--auto-review` | Native `--force` |
| Antigravity | Native `default` | Native `auto_edit` | Legacy `auto` behaves as Ask; UI Auto selects Full access | Native `yolo` plus automatic approval of remaining tool-permission requests; shown as Auto |
| Grok Build | Native `default` | Native `acceptEdits` | Native `--permission-mode auto`; availability of Grok's reviewer depends on its feature rollout | Native `bypassPermissions` plus automatic approval of remaining tool-permission requests |
| OpenCode | Ask | not offered | Ask | Approve individual ACP permission requests, never task questions |
| Qwen Code | Native `default` | Native `--approval-mode auto-edit` | Native `--approval-mode auto` (Qwen's LLM classifier approves safe actions, blocks risky ones) | `--yolo`, plus automatic approval of remaining ACP permission requests |
| Gemini CLI | Native `default` | Native `--approval-mode auto_edit` | Ask (no reviewer) | `--yolo`, plus automatic approval of remaining ACP permission requests |
| Other/custom engines | Ask | not offered | Ask | Not offered until a provider mapping is implemented |

These settings apply on each turn, including resumed conversations. Switching
to a different provider while elevated requires leaving Full/Custom first;
choose Ask. Switching models within Antigravity keeps the selected level.
Native modes require a CLI version that supports them; Sagax does not
silently substitute unrestricted access when a mode is rejected.

### Read-only integration tools

Sagax's built-in agents MCP server describes nine scoped reads with
explicit read-only, non-destructive, idempotent, closed-world metadata:
`list_bots`, `list_rooms`, `list_threads`, `check_delegation`, `wait_delegation`,
`session_search`, `session_read`, `list_routines`, and `skills_list`.
Session recall still enforces own-bot access and records its existing room
disclosure audit. These hints do not grant access to another bot's conversations.
Writes, credential requests, proposals, and third-party tools do not inherit
these hints. The metadata is available to every engine using this integration;
whether an engine consumes it remains that engine's behavior. Arbitrary MCP
display titles or `readOnlyHint` claims from a third-party server are not
authorization to bypass a prompt.

The level set follows the provider-boundary approach in
[T3 Code's permission modes](https://github.com/pingdotgg/t3code/blob/e16b8b059c9f5ff6dfed1addecffb831c6aee043/docs/user/permission-modes.md):
Supervised, Auto-accept edits, Auto, and Full access, each a provider mode
rather than an app rule, with a remembered approval that belongs to the
provider's session. Its quieter default is Full access; Sagax keeps its
own opt-in desktop confirmation and Ask as the default.

## The Journal: what your bots did, and what decided it (2026-10-26)

Approvals > Journal lists every action of your own bots over the last 7 or
30 days: allowed, asked (a card), refused, failed or expired, with what
decided it: one of your rules in your words, an organization rule (Refuser,
Demander d'abord), an Always allow, the bot's approval level, Full access, a
tool access grant, your own answer, a timeout or an error. A tool the engine
ran without a card at its level is listed too. The History tab stays as it
was. On an organization server you see only your own bots and your own
confidential threads; views across people stay in Perspicax.

Nothing new is captured for it: `server/action-journal.ts` folds the
decision log (`server/decision-log.ts`), the tool runs of your threads
(`server/activity.ts`) and the agent tools' audit with the tool guard's
verdict. A decision row now keeps the call's arguments (bounded, redacted,
dropped in a confidential thread) so a rule can be replayed exactly.

"Tester une règle" (in the Journal, and in the rule editor before you
save): the rule, saved or a draft, is replayed with the real matcher among
your other rules on the last 7 days. The result counts what it would allow,
ask or refuse, and lists the actions, marking those whose outcome would
change. Nothing is saved. An older action whose arguments were not kept is
read from its one line and marked approximate.

Routes: `GET /api/approvals/journal?days=7|30`,
`POST /api/approvals/journal/test { rule }`.

## Verification for contributors

The [Full Access workflow recipe](verification/full-access.md) tests immediate
profile, routine, team, skill, and peer actions through the real server and MCP
proxy. Its fixture also verifies that explicit Ask sibling threads still wait.

Run `pnpm exec electron scripts/smoke-approval-modes.cjs` to exercise the real
private desktop-to-server grant protocol in a disposable fixture. It verifies
HTTP elevation rejection, Full → Auto → Ask on resumed Claude turns, and
Antigravity automatic tool approvals on new and resumed Full access turns across
multiple model variants. It also checks that Ask and legacy Auto still prompt,
peer-started Full turns auto-approve, switching the receiving bot back to Ask
restores prompts even for a Full-access sender, delegated Codex Custom uses the
native Auto reviewer consistently, and questions remain interactive. Provider
processes are scripted fakes; this does not verify live account eligibility or
the quality of a provider's automatic reviewer. No live user data is used.
Grok coverage exercises two model selections across fresh/resumed Auto turns,
real built-in MCP reads under a scripted native reviewer, returning to Ask,
and held deletion, credential, spoofed-title command, and question requests.
