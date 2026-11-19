# What a member needs an admin for (audit, 2026-10-19)

On an organization server (Perspicax sign-in), this is everything that can
send a member, or a member's bot, to an organization admin. The rule it is
measured against (2026-10-19):

- **Own destinations and own data: the person's normal level, never an
  admin.** Their cloud computer (server environment, `sagax-environment`),
  their own computer and its Local VM (`sagax-desktop`), their own bots,
  threads, memory, vault and devices.
- **Reserved, but delegable in Perspicax** (a person or a team, through a
  permission set or "Who has what"): the shared server host, the
  organization's secrets, organization-wide data and settings, creating or
  deleting shared objects.
- **Admin only, not delegable:** only what would change admin rights
  themselves.

The other guardrails stay whatever the rule: the approval level of each
call, security keys (step-up), confidential conversations, the safety review,
the person's own deny and ask rules, and the audit log.

Where: **own** = the person's own destination or data; **host** = the shared
server host; **org** = organization data, settings or secrets;
**rights** = admin rights themselves.

## 1. Bot tool calls (approval cards)

| Tool or action | Where it runs | Before | After | Why |
|---|---|---|---|---|
| `sagax-desktop` `run_command`, `write_file`, `browse`, `fetch_url`, ... on the owner's own computer | own | admin card | the owner's card; their permission mode never answers it; since 2026-10-19 their own Always allow made on such a card (`from: origin`, the exact command or path) does | It is their own machine. It is not isolated, so no automatic answer (security review). |
| `sagax-desktop` `read_file`, `list_files`, `search_files` inside the Sagax attachments folder of their own computer | own | admin card | no card, at any level, owner's own turn only, after the safety hold, their rules and their key | The files they sent the bot. Paths normalized (backslashes, `\\?\`, 8.3 short names, case); `..` refused; the folder must look like `<temp>/Sagax/attachments`. |
| `sagax-desktop` `local_vm` | own | owner card at Auto only while autonomy is on, otherwise admin | owner card; unasked at Auto while autonomy is on (unchanged) | The Local VM on their machine is isolated. |
| `sagax-environment` tools (their cloud computer) | own | unasked at Auto while autonomy is on; **admin card when autonomy is off** | unasked at Auto while autonomy is on; otherwise the owner's card | Their own isolated sandbox. |
| `sagax-environment` `read_file`, `list_files` in `/workspace/attachments` | own | as above | no card, owner's own turn | The files they sent. |
| `sagax-computer` `computer_select` (the bot picks where it works: the person's cloud computer, their own computer, its Local VM or the built-in browser), mounted by Sagax for this turn, for the person it is for (who answers its cards, or the speaker in their own conversation with someone else's bot) | own | **admin card** on engines that ask first (prod 0.5.27: "Computer select dans Sagax Computer"): the server was in the host-level list | **no card**, at any approval level, on every engine (Claude already pre-allows it); the safety hold, the person's own deny and ask rules and their security key still come first | There is no menu for the person any more: the bot decides where it works. The commands it runs next keep their own rules (on their real computer, always a card). A computer the organization shares stays `agents` `shared_computer` (admin, delegable). Someone else's places, or a turn for another person: an admin's card. Since 2026-11-19 (M-20261119-008), not mounted this turn, nobody decided or a guest-driven turn in the person's own places: the person's card, never an admin's. |
| A shell or file tool of the engine itself (Bash, Read, Write, Edit, Glob, Grep, WebFetch...) | host | withheld on every organization turn (admins too); a stray one was an admin card | 2026-11-16 (#4449): on a member's own turn it never opens an admin card and never runs on the shared host (a shell, a web fetch, a file outside the bot's own folders alike). If the bot has a computer of its own this turn (the person's sandbox, created on demand, their own computer, its Local VM), it is told to run there; if none can be had, it gets a plain refusal that says why and what to do. The card stays only when an admin, or a person holding `host.commands`, drives the turn | A member's bot works in the person's own place. |
| A plugin's MCP server mounted for the person's turn (for example a code host plugin, with the person's own sign-in: run remotely as the person, or relayed into their sandbox), and the person's Mac apps | own | **admin card** ("This command runs on the organization's server: waiting for an admin"): they were not counted as the person's own and fell to `foreign-tool` | 2026-11-16 (#4449): the person's own card, judged before the shell name pattern, so a tool named `..._exec`, `..._shell` or `..._bash` on such a server is theirs too; the list is cleared when the turn ends | It runs as the person, in their place. |
| A file tool (Read, Write, Edit...) inside the bot's own task workspace, on a hidden name | own | admin card for every hidden name (`.gitignore`, `.github`, `.vscode`...); a read only of skill revisions and plugin manifests | **2026-10-28 (#1098)**: the owner's card, except the names that run a command or hold a credential on the shared server (`engine-access.ts` `sensitiveHiddenSegment`: `.git`, `.claude`, `.mcp.json`, `.codex`, `.grok`, `.cursor`, `.husky`, `.githooks`, `.env` but its templates, `.npmrc`, `.envrc`, shell start files, `.ssh`, `.config`...), which stay an admin's. `attach_file` follows the same list | Their own project files; the sensitive names would act on every bot of the container. |
| Same, owner holds `host.commands` | host | admin card | owner's card; no mode or saved command answers it; since 2026-10-19 their own Always allow made on it (`from: admin`; since 2026-10-21 the program of the engine's shell line in its folder, as on a solo bot) does while they still hold the right; checked again at the answer and at each use | Delegable right to the shared host. |
| `agents` `offer_shell_terminal` (the terminal card) | own | **admin card** on engines that ask first: the shell name pattern read `_shell_` in its name as a server command | the owner's card (judged by its exact name first) | It only stages a card the person approves; the terminal opens on their own destination. |
| Built-in `agents` tools in the member's own scope (`member-tool-scope.ts`: reads, conversation, memory, own setup, terminal offer) | own | owner card | unchanged | Already the owner's. |
| `agents` `choose_page_target` (pick which surface hosts a new page or artifact the member asked for: Sagax page, Sagax artifact, Claude artifact, ...) | own | **admin card** on engines that ask first (#2199): the tool reached the catalog (#2048) without a class, so the shared-host gate treated it as a server command | the owner's card (or none at their level); same family as `ask_choice` / `propose_page` / `save_artifact` | It only chooses a surface in the member's own conversation; publishing stays with those tools and their own cards. |
| `agents` host-level tools: `add_mcp_server`, `attach_file`, `vm_exec`, `api_reload`, `review_write`, cloud-agent tools | host / org | admin card (pre-allowed on Claude, see note) | unchanged when they would touch the shared server; delegable through `host.commands` for the owner's own turn. Since 2026-10-28 the owner's card at their own level when the call stays in their own environment (`engine-access.ts` `memberOwnHostToolCall`): `vm_exec` in the bot's own Local VM (per-bot mode), `attach_file` of the bot's own folders (no sensitive hidden name) or its own VM's workspace, `add_mcp_server` into the person's own servers. `api_reload` and `review_write` stay admin | A shared or pooled VM, another path, the server's shared list and the organization settings stay an admin's. |
| `agents` `act` when it only reads the member's own bot (GET or HEAD, no body, `/api/bots/<that bot>`; a plugin `list` of that bot) | own | admin card, even though the card says Read-only (#1269) | the owner's card, or none (#1269). The route still checks the person | A read changes nothing. |
| `agents` `act` write on the member's own bots and on routes of their own environment (`member-tool-scope.ts` `ownAct`: `/api/bots/<their bot>`, their plugins, a screen action on their bot, any route whose area is outside `shared/grant-reach.ts` `ORG_REACH_AREAS`) | own | admin card (#1269); refused outright in a confidential thread | **2026-10-28 (#1098)**: never an admin's card; act runs as the person and holds the write for their own Allow (`bot-act.ts`) unless their level runs it, also in their confidential thread | It runs as them and the route checks their rights. |
| `agents` `act` on someone else's bot, or on a route that reaches the organization (`ORG_REACH_AREAS`: org, people, config, engines, keys, billing, grants...), or an unprovable path (`..`, an encoding, a query in the path) | host / org | admin card | admin card, not removed (#1098) | Its effect reaches past the person's environment. |
| `agents` `manage_settings` | own (the person's own rights) | admin card | own scope (#1269): no admin card. It runs with the speaking person's own session | Nothing beyond what the person can do in their own app. |
| `agents` `shared_computer` | own (organization: the speaker's own desktop) | admin card | 2026-10-28: the owner's card when the owner speaks in their own turn (their own desktop); otherwise unchanged | When someone else speaks, the desktop is theirs but the card is the owner's: it stays an admin's until the card goes to the speaker. |
| `agents` `manage_pairing` | own | admin card | own (2026-10-26): no admin card for the person's own devices | Own devices. |
| MCP servers acting through the owner's identity (their remote servers, personal connections, claude.ai connectors on their own subscription) | own | owner card | unchanged | Already the owner's. |
| Other MCP servers (`browser`, `computer`, `files`, `shell`, `terminal`, a server's own MCP server) | host | admin card | unchanged; delegable through `host.commands` | Run on the shared host. |
| Always allow, session allow, remembered command on a member's bot | rights | stripped or refused for every card | session allow and the installation's saved command list unchanged (refused). Always allow (an owner rule) offered on every card since 2026-10-19, an admin's card included (`from: admin`). **Decided 2026-10-21: it remembers.** On an admin's card (or the owner's card under `host.commands`) the engine's shell line is kept as its one program in its folder (`git`, `npm`; a chain or a `cd` keeps the exact line), for that bot only, never workspace-wide; another program asks again. The bot's owner and a workspace admin see it in the bot's Approval rules, with who saved it (by name, never an id or the real folder), and may remove it (never edit someone else's); a holder of `host.shell` who is neither sees and removes only their own. A held card (safety hold, sandbox widening, Codex additional permissions or network) keeps the whole request; a call with no readable arguments offers no rule (see Accepted risks). Since 2026-10-27 (#1098), a call in the person's own sandbox (their cloud computer or Local VM, card `ownSandbox`) offers its owner the session allow, the Always allow key and the saved command too (`cardStandingGrants`, `sandboxCommandCandidate`); the shared host keeps this rule. | A standing grant on one bot, removable by its owner and the admins. |
| Custom approval level (`config.toml`) | host | runs as Ask, cannot be set | unchanged | The file lives on the shared server. |
| Full access on a member's bot | own | `bots.fullAccess` + the organization's Full policy + consent | unchanged | Already delegable. |
| Auto levels while the admin turned `memberAutoApproval` off | org | Ask | unchanged | An organization policy. |

Note on `agents` tools: Claude pre-allows the whole `agents` server, so most
of these never reach a card on Claude; the rule above bites on engines that
ask first (Grok and the other ACP engines, Codex).

## 2. In-chat terminal

| Destination | Before | After |
|---|---|---|
| Their cloud computer, Local VM, own computer, from a conversation with their own bot | allowed | allowed |
| Same, from their own conversation with a bot someone shared with them | refused (not their bot) | allowed (the shell is theirs; answering someone else's card opens nothing) |
| A host of the organization's server (the Sagax server, SSH, unRAID) | admin only, not delegable | admin, or `host.commands` given in Perspicax |

## 3. MCP permission catalogue (`server/mcp/mcp-permissions.ts`)

Mode in production: `shadow` (unset): a denial is audited (`mcp.shadow`), nothing is
refused. The tiers matter once a server runs `SAGAX_MCP_PERMISSIONS=enforce`.

A turn no person speaks in (a routine, a webhook: role `service`) never gets
`manage_pairing`, `request_login`, `propose_team_setup`, `rules_update` or
`docs_update`, whatever their tier: they need the person, could create bots
under Full access, or would write lasting instructions from untrusted text.

| Tool | Where | Before (member) | After (member) | Why |
|---|---|---|---|---|
| `rules_update`, `docs_update` | own (the bot's own RULES.md and docs) | admin tier (denied) | own | Own data. |
| `request_login` | own (their own vault; the value never reaches the bot) | admin tier | own | Own data. |
| `select_computer` | own (picks among their own places) | admin tier | own | Own destination. |
| `manage_pairing` | own (create: a code bound to the speaking person and capped to their scopes, on an organization server; list stays an admin route) | admin tier | own, self scope (2026-10-26: no longer host level) | Own devices. |
| `propose_team_setup` | own (a card for their own team of bots) | admin tier | own, self scope | A proposal they confirm. |
| `save_team_memory` (old name `propose_team_memory`) | own (the memory its person may write: the bot owner's own on a server several people use) | admin tier | own, self scope; the bot saves it at once, no card (#4439); an organization Refuse or Ask first rule on the tool still holds it | Their own memory. |
| `create_bot`, `propose_bot_deletion`, `create_room`, `manage_room` | own (self scope override) | allowed at self | unchanged | Already. |
| `create_agent`, `delete_agent`, `archive_bot` | own (a temporary agent or a bot of theirs) | admin tier | own, self scope (2026-10-26); `delete_agent` on their own agent needs no grant (tool guard `ownerScoped`) | Own bots. |
| `add_mcp_server` | own (2026-10-28: the person's own servers, Settings > Connections; a command runs in their own environment) | admin tier | own, self scope; the route adds to the speaking person's own list on an organization server and refuses a person whose integrations an admin manages | Their own list. The server's shared list stays an admin's screen. |
| `request_credential` | org (server keys) | admin tier | unchanged | Organization secrets. |
| `shared_computer`, `vm_exec` | the person's own computers, the bot's own Local VM | admin tier | own, self scope (2026-10-27/28); the admin card stays for a shared VM or someone else's desktop (section 1) | See section 1. |
| `act`, `manage_settings` | any route, under the person's own rights | admin tier | own, self scope (#1269); never for a turn no person speaks in. The permission tier stays own so the call is not refused outright; since 2026-10-28 (#1098) a write through `act` on their own bots and routes is theirs; `act` on someone else's bot or a route that reaches the organization still waits for an admin card (section 1) | The route checks the person. |
| `api_reload` | org settings | admin tier | unchanged | Organization settings. |
| `review_write` | org (an approval decision) | admin tier | unchanged | Perspicax applies the person's own grants. |
| `memory_promote`, `memory_review` | org (Perspicax) | admin tier | unchanged | Organization memory. |

## 4. Permission keys (`shared/permissions.ts`)

| Key | Where | Before | After |
|---|---|---|---|
| `host.commands` (new) "Run commands on the organization's server" | host | did not exist | grantable, off by default; label says it is admin-equivalent on the server machine |
| `host.shell` "Change the server's own setup" | host | admin only | **given in Perspicax** (2026-10-19): the server's own MCP servers, an engine's program path, its computers, command rules, the admin approvals queue and answering admin cards. The label says it is admin-equivalent on the server machine. |
| `folders.botWorkingFolder`, `folders.roomWorkingFolder` (working folder of their own bots and groups) | own | off for a member | **2026-10-28 (#1098)**: every member by default. Isolation on the shared server: a member's folder stays in their own roots (`server/people/member-folders.ts`): their person folder on the server, the workspaces of their own bots, and the folders an admin opened to them (`organization.memberFolders`, by principal id or `*`). Symlinks and `..` are resolved first; another member's folder or a system folder is 403 `folder_outside_own_space`. A folder on the bot's own connected computer is checked there; an admin keeps any existing folder. |
| `backup.workspace` "Back up the server" | org | admin only | **given in Perspicax**: status, export and download. Upload, preview and restore stay admin (a restore brings back sign-in, people and sessions). |
| `server.settings` | org | admin only | **given in Perspicax**: settings, keys, webhooks, connected apps, bot defaults, organization policies, marketplace tokens, voice engine, claude.ai connectors switch. Never the sign-in lists, the operator's profile, the `organization` block of the config, a provider's endpoint (`*.url`), the OpenAI-compatible engines, the maintainer switches `features.sharedComputers` and `features.claudeUserMcp`, the custom domain (pairing links), a webhook on an admin's bot or a Microsoft Graph trigger, the interim attach window or tool grants. |
| `people.manage` | org (other people's accounts) | admin only | **given in Perspicax**: sessions, pairing codes, a person's connections, force stop or delete of a bot, published pages. Never on an organization admin (or the operator), and attaching an interim person stays admin. |
| `server.link` | rights (who may sign in at all) | admin only | admin only, by rule |

Note for the maintainer: `host.shell` runs programs as the server (an engine's program
path, the server's Local VM, command rules on any bot), so its holder can in
practice make themselves admin on that machine; its label says to give it
only to people you would trust as admins of the server. `server.settings`
can turn on the organization's Full access policy, which members still need
`bots.fullAccess` to use.

Admin only, not delegable, because each changes admin rights themselves:
`server.link`, a backup restore (upload, preview, restore), tool grants
(`/api/tool-grants`), the sign-in lists and the operator's profile in
`/api/config`, the interim attach window and attaching an interim person,
and acting on an organization admin's sessions, codes, connections, bots or
pages. A few installation screens also stay admin scope for now: a bot's
own installation computer (`/api/bots/:id/computer*`,
`/api/bots/:id/local-computer*`) and the desktop viewer of the server's own
Local VM or VPS.

## Accepted risks

1. **2026-10-21, decision (told the risk): Always allow on a member's
   server command keeps the program, as on a solo bot ("Programme comme en
   solo").** Finding 1 of the review of #938: on the organization's shared
   server, a rule kept for `npm` (or `git`, `python`) on an admin's card lets
   that bot run any other line of that one program in that folder with no
   card (`npm run deploy` after `npm test`, a script the bot wrote and runs
   with `node`), with the server's rights, until the bot's owner or an admin
   removes it. Accepted as is, not narrowed. What still holds: it is for
   that one bot (never workspace-wide, never another bot of the member), in
   that one folder; a chain, a substitution or a redirect keeps the exact
   line; a held card (safety hold, `dangerouslyDisableSandbox`, Codex
   `additionalPermissions` or network, `requiresExplicitApproval`) keeps the
   whole request; the saver's right (admin, `host.shell`, or the owner's
   `host.commands`) is checked again at each use, and a security key of
   theirs still asks; an engine that reports its shell line beside no input
   (Codex, the ACP engines) is read by that line, and a card with no
   readable arguments offers no rule, so a rule never covers every command.

## Open points

1. Done 2026-10-19: the four admin keys are delegable (section 4); a
   shared bot's speaker answers their own destination's card; Always allow
   rules on one's own cloud computer and Local VM, listed and revocable in
   Settings > Computer. Done 2026-10-21: permanent grants on a member's bot
   (Always allow on its server command keeps the program for that bot;
   owner and admin see and remove it in the bot's rules).
2. **`shared_computer`** on an organization server acts on the speaker's own
   desktop: still an admin card.
3. Hardening noted by the security review, not blocking: a link inside the
   attachments folder on the person's computer (only they can create one,
   with a command they approved), case folding on a case-sensitive macOS
   volume, matching a late request to the turn generation.


## What still waits for an admin (2026-11-16, #4449)

For a member's bot on an organization server, a card can wait for an admin for one of six reasons (`memberBotAdminReason`, `server/engines/engine-access.ts`; the list is held by `server/member-own-place.test.ts`, so a new one cannot slip in unnoticed). Everything else is the person's own card or needs no card.

**2026-11-19 (M-20261119-006, M-20261119-008): a reason needs positive evidence.** A reason is given only when identity proves that the call leaves the person's own environment: whose place Sagax mounted, whose server list, whose bot, whose account. A tool nobody classified (a new engine tool, a port, a plugin, a rename, an invented name) is the person's own card at their own level. A call on the person's cloud computer (`sagax-environment`), their own computer (`sagax-desktop`) or their choice of place (`sagax-computer`) is theirs even when the record of the mount is gone (the turn ended, a restart, another bot's turn in the same thread): Sagax binds each of those mounts to one person by the turn's capability, and none runs on the shared host. Only a mount for another person than the card's answerer is `foreign-tool`. `server/member-admin-default.test.ts` enumerates every tool of the catalogs (agents, Perspicax, Data, the person places, each engine's organization tools, invented names) and fails the merge gate if one of them gives a reason.

Three of them are work that would run on the shared host itself (`HOST_RUN_REASONS`). A member's own turn never waits for an admin on them: if the bot has a computer of its own this turn (the person's sandbox, created on demand, their own computer, its Local VM), it is told to do the work there; if none can be had, it gets a plain refusal that says why and what to do. Their card stays only when an admin, or a person holding `host.commands`, drives the turn.

| Reason | When | On a member's own turn |
|---|---|---|
| `host-shell` | a shell on the shared host | Sent to the bot's own computer, or refused in plain words. Never an admin wait. |
| `host-engine-tool` | an engine built-in classified as acting on the shared host (the deny lists of `server/drivers/host-tools.ts` `ORG_ENGINE_TOOLS`: a web fetch, a background command) and offered on an organization turn by no engine, or a tool of the host's own computer, browser, files, shell or terminal server | Sent to the bot's own computer, or refused in plain words. Never an admin wait. |
| `outside-own-folders` | a file tool (Read, Grep, Glob, Write, Edit...) on a path of the shared host outside the bot's own folders, or a sensitive hidden name | Sent to the bot's own computer, or refused in plain words. Never an admin wait. |

The other three reach past the person's own place, so an admin answers them whoever drives the turn. The member's waiting line names the true reason (the card's `adminReason`).

| Reason | When | Why it is an admin's |
|---|---|---|
| `other-bot-act` | an action on a bot that belongs to another person, or on a route that reaches the organization | It reaches another person or the whole organization. |
| `host-tool` | a host-level Sagax tool (`HOST_LEVEL_AGENT_TOOLS`) that leaves the person's place: a pooled Local VM, someone else's computer, the server's shared MCP list, a file outside the bot's folders, the Perspicax admin tools. Every other Sagax tool, classified or not, is the person's card | The shared server and other people. |
| `foreign-tool` | provably not the person's: a cloud computer, computer or choice of place Sagax mounted for another person than the card's answerer, a server of the organization server's own list not mounted for this person, a claude.ai or Grok connector of an account that is not the speaker's own | It is not the person's. |

A bot never tells a member to ask an admin for a command that stays in the person's own place.