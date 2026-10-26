# What a member needs an admin for (audit, 2026-10-19)

On an organization server (Perspicax sign-in), this is everything that can
send a member, or a member's bot, to an organization admin. The rule it is
measured against (JC, 2026-10-19):

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
| `sagax-computer` `computer_select` (the bot picks where it works: the person's cloud computer, their own computer, its Local VM or the built-in browser), mounted by Sagax for this turn, for the person it is for (who answers its cards, or the speaker in their own conversation with someone else's bot) | own | **admin card** on engines that ask first (prod 0.5.27: "Computer select dans Sagax Computer"): the server was in the host-level list | **no card**, at any approval level, on every engine (Claude already pre-allows it); the safety hold, the person's own deny and ask rules and their security key still come first | There is no menu for the person any more: the bot decides where it works. The commands it runs next keep their own rules (on their real computer, always a card). A computer the organization shares stays `agents` `shared_computer` (admin, delegable). Not mounted this turn, someone else's places, a guest-driven turn or another server's spelling: an admin's card, unchanged. |
| A shell or file tool of the engine itself (Bash, Read, Write, Edit, Glob, Grep, WebFetch...) | host | withheld on every organization turn (admins too); a stray one is an admin card | unchanged; the card goes to the owner by hand if they hold `host.commands`, for their own turn only | It would run in the Sagax server's container. |
| Same, owner holds `host.commands` | host | admin card | owner's card; no mode or saved command answers it; since 2026-10-19 their own Always allow made on it (`from: admin`; since 2026-10-21 the program of the engine's shell line in its folder, as on a solo bot) does while they still hold the right; checked again at the answer and at each use | Delegable right to the shared host. |
| `agents` `offer_shell_terminal` (the terminal card) | own | **admin card** on engines that ask first: the shell name pattern read `_shell_` in its name as a server command | the owner's card (judged by its exact name first) | It only stages a card the person approves; the terminal opens on their own destination. |
| Built-in `agents` tools in the member's own scope (`member-tool-scope.ts`: reads, conversation, memory, own setup, terminal offer) | own | owner card | unchanged | Already the owner's. |
| `agents` host-level tools: `act`, `add_mcp_server`, `attach_file`, `vm_exec`, `manage_settings`, `api_reload`, `review_write`, cloud-agent tools | host / org | admin card (pre-allowed on Claude, see note) | unchanged; delegable through `host.commands` for the owner's own turn | Each reaches the server or organization settings (`member-tool-scope.ts` lists why). |
| `agents` `shared_computer` | own (organization: the speaker's own desktop) | admin card | unchanged in this pass | The card's answerer is the bot owner while the desktop is the speaker's; moving it needs the card to go to the speaker (see Open points). |
| `agents` `manage_pairing` | own | admin card | unchanged in this pass | The route itself is open to members; to reclassify with the tool scope list. |
| MCP servers acting through the owner's identity (their remote servers, personal connections, claude.ai connectors on their own subscription) | own | owner card | unchanged | Already the owner's. |
| Other MCP servers (`browser`, `computer`, `files`, `shell`, `terminal`, a server's own MCP server) | host | admin card | unchanged; delegable through `host.commands` | Run on the shared host. |
| Always allow, session allow, remembered command on a member's bot | rights | stripped or refused for every card | session allow and the installation's saved command list unchanged (refused). Always allow (an owner rule) offered on every card since 2026-10-19, an admin's card included (`from: admin`). **Decided 2026-10-21 (JC): it remembers.** On an admin's card (or the owner's card under `host.commands`) the engine's shell line is kept as its one program in its folder (`git`, `npm`; a chain or a `cd` keeps the exact line), for that bot only, never workspace-wide; another program asks again. The bot's owner and a workspace admin see it in the bot's Approval rules, with who saved it (by name, never an id or the real folder), and may remove it (never edit someone else's); a holder of `host.shell` who is neither sees and removes only their own. A held card (safety hold, sandbox widening, Codex additional permissions or network) keeps the whole request; a call with no readable arguments offers no rule (see Accepted risks). | A standing grant on one bot, removable by its owner and the admins. |
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

## 3. MCP permission catalogue (`server/mcp-permissions.ts`)

Mode on GOX: `shadow` (unset): a denial is audited (`mcp.shadow`), nothing is
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
| `manage_pairing` | own (create: a code bound to the speaking person and capped to their scopes, on an organization server; list stays an admin route) | admin tier | own; the engine gate still treats it as host level (section 1) | Own devices. |
| `propose_team_setup` | own (a card for their own team of bots) | admin tier | own, self scope | A proposal they confirm. |
| `propose_team_memory` | org (memory the section reads) | admin tier | a member of that section, or an admin, confirms the card | The section's own people. |
| `create_bot`, `propose_bot_deletion`, `create_room`, `manage_room` | own (self scope override) | allowed at self | unchanged | Already. |
| `create_agent`, `delete_agent` | own (a temporary agent of theirs) | admin tier | unchanged; gated by `clients.agentsCreate` on the client side | Already delegable there. |
| `add_mcp_server` | host (a program on the server) | admin tier | unchanged | Shared host. |
| `request_credential` | org (server keys) | admin tier | unchanged | Organization secrets. |
| `shared_computer`, `vm_exec` | host or another person's machine | admin tier | unchanged | See section 1. |
| `act` | any route, under the person's own rights | admin tier | unchanged | Mixed; the route checks the person. |
| `manage_settings`, `api_reload` | org settings | admin tier | unchanged | Organization settings. |
| `review_write` | org (an approval decision) | admin tier | unchanged | Perspicax applies the person's own grants. |
| `memory_promote`, `memory_review` | org (Perspicax) | admin tier | unchanged | Organization memory. |

## 4. Permission keys (`shared/permissions.ts`)

| Key | Where | Before | After |
|---|---|---|---|
| `host.commands` (new) "Run commands on the organization's server" | host | did not exist | grantable, off by default; label says it is admin-equivalent on the server machine |
| `host.shell` "Change the server's own setup" | host | admin only | **given in Perspicax** (2026-10-19): the server's own MCP servers, an engine's program path, its computers, command rules, the admin approvals queue and answering admin cards. The label says it is admin-equivalent on the server machine. |
| `backup.workspace` "Back up the server" | org | admin only | **given in Perspicax**: status, export and download. Upload, preview and restore stay admin (a restore brings back sign-in, people and sessions). |
| `server.settings` | org | admin only | **given in Perspicax**: settings, keys, webhooks, connected apps, bot defaults, organization policies, marketplace tokens, voice engine, claude.ai connectors switch. Never the sign-in lists, the operator's profile, the `organization` block of the config, a provider's endpoint (`*.url`), the OpenAI-compatible engines, the maintainer switches `features.sharedComputers` and `features.claudeUserMcp`, the custom domain (pairing links), a webhook on an admin's bot or a Microsoft Graph trigger, the interim attach window or tool grants. |
| `people.manage` | org (other people's accounts) | admin only | **given in Perspicax**: sessions, pairing codes, a person's connections, force stop or delete of a bot, published pages. Never on an organization admin (or the operator), and attaching an interim person stays admin. |
| `server.link` | rights (who may sign in at all) | admin only | admin only, by rule |

Note for JC: `host.shell` runs programs as the server (an engine's program
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

1. **2026-10-21, decision JC (told the risk): Always allow on a member's
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
