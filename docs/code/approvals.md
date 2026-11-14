# Approvals, cards and access levels

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

## Peer approvals return to the human chat (2026-11-04)

`server/approvals/origin-approvals.ts` links a delegated turn's actionable
cards to the proven human runtime root, through nested handoffs. Each view
has a unique request id and a durable backlink to the exact source thread,
message and provider request. Legacy grant keys have distinct view keys too,
so two peers asking for the same tool never share a grant. HTTP, Live and
security-key answers resolve that address before the source's existing
authorization and resolver gates.
Source patches mirror settlement; views create no inbox or journal decision
and never expire the source independently. Same answerer and current read
access are rechecked; confidential threads never relay. Background work
without a proven human root keeps the existing route.
Human room rounds retain their admitted message id on the runtime root,
including nested work. Their linked cards keep the source answerer's audience;
room membership grants no approval rights. This routing proof does not change
the room work's provenance or permission level. Deleting the destination
withdraws its notice and removes the source backlink. A late model review
re-reads the live address and falls back to the original execution thread.
Verification: `docs/verification/peer-approvals.md`.

## Blocking decisions are cards (#1984, 2026-11-04)

Every blocking decision uses ask_choice, a native question tool, or the write
tool's approval gate. `server/approvals/final-confirmation.ts` recognizes English and
French confirmation requests in a successful final routine/MCP reply. The main
runtime fold raises them through `raiseHarnessQuestion` before the routine
settles. Existing open cards, ordinary chats, quoted examples, failures and
stopped turns are left alone. The output is a question, never permission to
write; its answer resumes through the usual gates and person isolation.
`Store.setTaskActivity` keeps a settled question at `waiting-on-you` with
`settledQuestion: true` and `busy: false`, including after restart: iOS keeps
it in Needs you and the answer can start a fresh turn. Bot-wide busy reflects
occupied slots independently of that attention state.
MCP ask_choice uses this same persistent question path. Blocking MCP questions
and approvals reach phones and watches too. `send_prompt.prompt` carries an
already-given GO as `Operator GO (quoted):` (exact words), then `Scope:` (exact
writes). The system prompt honors that scope without re-asking or overriding a
gate; untrusted event data cannot supply consent. Format: `docs/agent-api.md`.
Tests and isolated verification: `server/approvals/final-confirmation*.test.ts`,
`docs/verification/decisions-as-cards.md`.

## Full access, one decision (#1065, #1819, #1905; 2026-11-02)

`server/approvals/full-access-gate.ts` is the one place that says whether a turn at
Full access acts without a card, and the only holds that stand under it:
an organization or personal Refuse or Ask first rule, isolation between
people, a sensitive path or the shared server, a real question. Every code
path that emits an approval or a choice card carries `// full-access:
<surface>` on its line, with the surface in `FULL_ACCESS_SURFACES`;
`server/approvals/full-access-gate.guard.test.ts` (merge gate) fails a new emitter
without one. The safety review reads the level through
`setSafetyFullAccess` and never holds a Full turn; `autoVerdict` reads
`fullAccessDecision` before the safety hold; a may-I `ask_choice` or
question under Full is answered with its recommended option
(`shared/permission-question.ts`). Never fix a Full access card on one
surface alone: add the surface to the gate and its regression to
`server/approvals/full-access-gate.regressions.test.ts`. `docs/approval-levels.md`,
"Full access: one decision".

## Every turn knows its approval level; Full never asks for a typed GO (2026-10-28)

A bot in Full access answered "no sends without your typed GO": nothing in
its prompt said it ran in Full, and a loaded instruction (a plugin skill
asking for the operator's GO before a send) filled the gap. Every direct
and room turn now gets an "Approval level" section
(server/approvals/approval-level-prompt.ts) with the level it really runs at
(`approvalModeForTurn`, `roomTurnApprovalMode`). Full: act without asking,
never ask for a typed GO or a confirmation; only Refuse and Ask first rules
and recipients outside the allowed list hold a call, and Sagax shows that
itself. Below Full the card asks, never a typed word. The connectors
section says the same for mail, Teams and calendar (`outwardRule`).

## Approve for me and ask-before-contact: no invented may-I cards (#1819, 2026-10-30)

Under Approve for me (and Full / Auto-accept edits), bots still posed
`ask_choice` for next steps already covered by the person's request, and
asked before contacting teammates when Ask before contacting bots was off.
The approval-level section now says not to invent a second person gate for
in-scope work; a Peer contact section states the effective flag
(`peerReviewRequired`: `approvePeerComms` and not Full). `VERIFY_FIRST_PROMPT`
and the `ask_choice` tool description match. Fleet merge/release/deploy GO
in chat is unchanged. Tests: `server/approvals/approval-level-prompt.test.ts`,
`server/system-prompt.test.ts`, `server/bots/bot-overview.test.ts`.

## Always allow on every card (2026-10-19)

Decision: "On doit avoir des cartes, mais avoir la possibilité de faire TOUJOURS
le Toujours permettre." Every approval card offers Always allow to the
person who answers it, with the exact scope written on the card
(`approval.always.scopeLine`): this bot, this tool or kind of action, this
target. The rule is an owner rule (`server/approvals/owner-approval.ts`, store
`owner-approvals.json`), the person's own, listed and revocable in
Settings > Security (`MyApprovalRules`, also `rules.owner` and
`rules.ownerDelete` in sagax_settings). Rules:

- Scope: an exact shell line (`command`, argv joined), an exact path
  (`path`, `file_path`...), compared case included; a native shell line is
  bound to its folder (a folder Sagax made for the bot by its kind,
  `sagax:conversation`). A value too long to keep offers no rule, never a
  wider one. Non-engine cards match the whole scope key for key
  (`ruleCoversExactScope`).
- Situations (`OwnerRule.from`): a held card (safety hold, sandbox
  widening) and a turn that is not the person's own words (routine,
  webhook, another bot, their real computer) are answered only by a rule
  saved on that same kind of card. An admin's card of a member's bot
  (`from: admin`) is the answering admin's (or host.shell holder's, or the
  owner holding host.commands for a holder's card) own rule for that bot,
  Always allow only, checked again at each use (`strictCardRule`).
- Never: someone else's environment (`crossPerson`), a guest's turn, a
  question, a meeting's consent (legal consent stays per meeting).
- A security key the person chose for one of the call's classes is still
  asked each time; the rule never answers it (step-up wins). Saving the
  rule itself is always-grant.
- Families: engine cards (all engines, the broker decides), act and
  sagax_settings cards (`server/bots/bot-act.ts`: setting + target, exact value
  digest when more than a simple change; #1098: a change to rules,
  permissions, tools, MCP or secrets keeps its card at every level and offers
  Always allow too, always bound to its exact value), the ConnectWise widget
  (`cw_widget:cw_psa_write`, apart from the bot's own calls), native
  safety holds (exact fingerprint), "Send on your behalf?" (one call, its
  targets), routine, profile and model proposals, skills (exact content),
  terminal offers (destination). Always deny only on engine tool cards
  (`shared/approval-rule-card.ts`).
- Bulk (Approvals screen): `rule: "allow"` keeps each card's own rule;
  a card needing a key or with no rule is skipped.
- Every automatic answer writes a decision row `source: owner-rule` (or
  `admin-rule`) with the rule id.
- The person's own sandbox (#1098, 2026-10-27): a call of a member's bot in
  its owner's cloud computer or Local VM, mounted for this turn (card
  `ownSandbox`), offers the session allow, the Always allow key and the saved
  command (`sandboxCommandCandidate`: the exact line, `/workspace`, the engine
  marked `@sagax-environment`, so it never answers the same text elsewhere)
  to the owner (`cardStandingGrants`); the shared host keeps admin or
  `host.shell`. The organization's "Toujours permettre" off never takes the
  person's Allow rules away there (`standingGrantsAllowed({ ownSandbox })`).
- The person's own lineage (#1098): a hop between their own bots from their
  own scheduled or manual routine counts as their own turn
  (`ownerLineageOrigin`, the trigger the hop carries); a webhook keeps its card.
- By voice (#1098): a Live call decides a proposal (routine, profile, default
  model, team setup, meeting) through its own resolver (`liveProposal`,
  `resolveLiveProposal`); a card the person protects with a key, and a skill
  (its content is reviewed on screen), stay on screen.
- Not covered yet: email draft send, team memory, confidential memory,
  team setup cards.
- Tests: `server/always-allow.e2e.test.ts` (engine card, key, bulk, act,
  proposal, Codex and ACP engines), `server/member-own-destinations.e2e.test.ts`
  (real computer, admin card), `server/cw-widgets.e2e.test.ts`,
  `server/approvals/owner-approval.test.ts`.

## Advanced approvals: one app, 1Password per request, card photos (2026-10-21, parité R10)

- **One app of this computer** (`shared/computer-app.ts`,
  `server/computer/computer-app.ts`, `server/approvals/owner-approval.ts` `APP_RULE_TOOL`): a
  screen action of the host Mac ("this computer", server mount `computer`,
  a desktop or a solo server on macOS, the person's own turn, the same bot
  and live turn generation, never an admin's, a held or an origin card)
  carries the app the SERVER read: `lsof -d txt` (the kernel's executable),
  the outermost `.app` under /Applications, /System/Applications, the
  Safari cryptex, CoreServices/Applications or ~/Applications, then the
  RUNNING process's code signature (`codesign --verify <pid>`, Identifier
  and team, cached 3 s; Apple's own apps are team `apple`). A gate that
  throws publishes the event as it was (the card asks). The read is asynchronous: the bus holds that one
  permission event (and the thread's later ones behind it) while it runs
  (`EventBus.setPublishGate`, at most 3 s), and drops any `screenApp` an
  adapter wrote. "Toujours permettre" keeps `{ app, bundle, team }` under
  `computer_app`; a rule missing one of them matches nothing.
- An app rule covers only input that lands in that app: background
  delivery (never `delivery_mode: foreground`), no hotkey, no key with a
  modifier other than shift, no argument outside the reviewed list (so
  never `screenshot_out_file` or `debug_image_out`), a `window_id` only
  when CoreGraphics says it is the pid's own window, and typing only into
  the focused element once Accessibility says it is not a password field
  (`FOCUS_SCRIPT`: attribute names as `$('AXRole')`, never bare JS strings;
  with a `window_id`, that window must be the pid's frontmost), never into
  an element picked by index or position, never a key combo written in
  `key` ("cmd+q"). `launch_app` is
  never covered. Unsigned apps, Sagax itself and the denied bundle ids and
  names (`NO_APP_RULE_BUNDLES`, `NO_APP_RULE`: shells, editors, launchers
  and automation, Finder and system tools, remote desktops, VMs and
  containers, Tailscale, password managers, AI agents, Mail, Messages,
  Slack, Teams) never get one. The card says "<bot> peut voir <app>, y
  cliquer et y saisir du texte sur cet ordinateur". The desktop bridge of
  an organization server, a Local VM and a cloud computer read no app.
- **1Password on iPhone**: Settings > Vault shows the same connection as
  the desktop (`OnePasswordSettings`, `POST /api/me/credentials/onepassword/items`
  and `.../import`). The CLI stays on the computer. The phone stores a
  reference, never a secret. Shop Pay and Link are the one-time card
  switches (`POST /api/me/credentials/wallets`, contract in #1322). Turning
  one on does not charge anything and does not send a saved number.
- **1Password per request**: the sign-in card (`VaultRequestCard`, iOS
  `VaultLoginCardView`) lists the person's 1Password items of the card's
  site (`POST /api/bots/:id/vault-cards/:msg/onepassword`, names, vault and
  sites only, listing kept 30 s per person). A pick is checked again
  against 1Password's own listing and saved once as a reference
  (`findOnePassword`). A 1Password item is allowed once or always, like
  any login (#3294: the card and Settings offer Always allow; the value is
  still read from 1Password at fill time only), and once is one
  sign-in: the grant ends `VAULT_SINGLE_USE_MS` (60 s) after its first
  fill. The bot is never told the item's title ("a login from their
  1Password"), in the note, the fill result or a refusal. The value is read from 1Password only at fill time; the
  conversation shows "En attente de 1Password" (`ONE_PASSWORD_WAITING`).
  iOS preselects only an item of the exact host. Never on an organization
  server. Settings > Credentials guides the setup (CLI, integration, check
  again).
- **Card photos** (iOS, Settings > Vault > New card): one or two photos,
  read on the phone (Vision); `CardScanReading` picks a Luhn-valid number
  of ASCII digits, the latest expiry and the name. Nothing is uploaded,
  kept or logged; the security code is typed. Desktop has no on-device
  text reader yet.
- **One-time card** (Shop Pay or Link, a wallet the person already has):
  Settings > Credentials stores the choice (`POST /api/me/credentials/wallets`,
  the person's own vault, client scope, not an admin gate) and shows
  whether the wallet is live here (`walletLinksLive`: its CLI installed and
  signed in as the person). `request_purchase` may pass `wallet`
  `shop_pay` or `link` instead of a saved card. The existing purchase
  approval (or the Primary Bot at the person's request) stays the only
  barrier. 2026-10-29: once approved, the bot gets the purchase's card
  handle `cred_w<16 hex>` (`walletCardHandle`) and calls `fill_credential`
  with cardNumber, cardExpiry, cardCvc, cardholder; at the first field
  `server/wallet-issuer.ts` runs the wallet's own CLI (`link-cli` for Link,
  `shop` for Shop Pay, same spend-request commands): `spend-request create
  --request-approval` (the wallet may ask the person on their phone; the
  fill then says so and the bot calls again, same request), `retrieve
  --interval`, then `retrieve --include card --output-file <0600 temp>`
  read and deleted at once. The card lives in memory for that purchase's
  one form (each field once, PURCHASE_FORM_MS), never on disk, in the
  prompt, a result or the journal; `record_purchase` closes a wallet
  purchase whose card was typed. The desktop's person uses the CLI's own
  session; a person on an organization server their own
  `<principal>/<wallet>-wallet-auth.json` (`--auth`). Not installed:
  `provider_unconfigured`, nothing charged. The CLI flags follow
  `@stripe/link-cli` 0.30 (README); Shop Pay's CLI is assumed to take the
  same commands. Tests (fake CLI only, nothing charged):
  `shared/single-use-card.test.ts`, `server/wallet-issuer.test.ts`,
  `server/vault/credential-vault.coffre.test.ts`, `server/vault/credential-vault.payment.test.ts`.
- **Show a password or key** (2026-10-29): Settings > Vault shows a local
  item's password or API key to its owner (desktop "Show password"/"Show
  key", iOS behind `VaultRevealGate`), so a secret a bot made with
  `{"$secret": "generate"}` (#1603) can be read by the person.
- **A login for this turn only** (2026-10-29): on the request card a typed
  login can be lent with "This turn only" (`turnOnly` on the card's grant,
  `CredentialVault.lend`): never written to the vault file, held in memory,
  granted once to that bot in that conversation. `turnPhase` (index.ts,
  from the bus) forgets it at the end (`turn.completed`, ok or not, or
  `session.exited`) of the first turn that started after it was lent, or
  after VAULT_TURN_LEND_MS (15 min) at most. The bot is told "for this turn
  only". Tests: `server/vault/credential-vault.coffre.test.ts`,
  `server/routes/credential-vault.test.ts`.
- Not done: a device tool on the phone (row 81): Sagax has no phone tools.
- Tests: `shared/computer-app.test.ts`, `server/computer/computer-app.test.ts`,
  `server/harness/bus.test.ts` (publish gate), `server/approvals/owner-approval.test.ts`
  (app rules), `server/routes/credential-vault.test.ts` (1Password per
  request, once only, single use), `ios/Tests/CompanionCoreTests/VaultLoginCardTests.swift`.

## Bot quality: approvals and tools where the bot works (2026-10-19)

The maintainer's GO on points 1 and 2 of the bot quality diagnostic. Rules:

- Claude's Approve for me never launches `--permission-mode auto`: its
  classifier refused external writes in silence. It is `acceptEdits` plus
  `CLAUDE_AUTO_ALLOWED_TOOLS` (`server/drivers/claude.ts`: web search, task
  list, ToolSearch, Task, `pwd`; no git, Skill, ls or wc rule); every other
  call reaches the broker and is a real card (`autoVerdict` decides, as
  before). Tests read the level with `server/testing/claude-level.ts`.
- Owner setup (2026-10-19, `server/approvals/owner-autonomy.ts`): at Approve for me
  or Full access, the owner mode `approval` reads as `auto` for the owner's
  own work (`ownerLineageOrigin`: the owner's words signed in, their
  scheduled or manual routine, a hop from their own bot speaking for them;
  never the operator, a webhook, another person or a routine hop):
  destructive calls, ask rules, security keys and holds keep their card.
  Perspicax reads on Sagax's fixed `perspicax` mount (`perspicaxSelfAnswer`)
  run unasked for the owner's own work at Auto/Edits/Full; leases (`claim`,
  `claim_renew`, `claim_release`) never ask; the owner's deny and ask rules
  come first. A lineage hop runs in the owner's cloud computer unasked only
  when it reaches no credential (`lineageEnvironmentCall`); the Mac and the
  Local VM keep the direct-turn rule. The ordinary-bot roster shows the
  description of the owner's own teammates; a person's AI client
  conversation never reuses a bot-opened thread and carries `aiClientPrompt`.
- A parked question (NEEDS INPUT) waits: reminder then daily
  (`TurnRunner.remind`), expiry after 7 days as status `expired` (never
  `failed`). Room / own question: first remind at `inputRemindMs` (30 min).
  Delegation (child outside a room): first remind at half of
  `delegationInputWaitMs` (120 of 240 min, R6). Optional
  `coordinate_bots` `default_answer` resumes with that answer and a harness
  note when the wait would expire. The card (`WireMessage.inputRequest`,
  `src/components/InputRequestCard.tsx`) holds the whole question and
  answers in place; it goes to the requester's conversation and, when that
  is bot-to-bot, to the root conversation too.
- `workspace_read` reads the bot's own `skills/.revisions` and
  `.claude-plugin` (`shared/readable-hidden.ts`) and its installed plugins as
  `plugins/<name>/...`; every other hidden name stays refused, nothing hidden
  is writable. The member-bot file rule (`memberBotAdminApproval`) admits the
  same two folders for reads only.
- The bot's enabled plugins are copied into its owner's own cloud computer
  (`server/sandbox/sandbox-plugins.ts`, `/workspace/sagax-plugins/<plugin>`), once
  per change, never into another person's environment. GitHub there stays
  the environment owner's own connection (`syncGithubForTurn`), never an
  organization or another person's token.
- `RUN_YOURSELF_PROMPT` sits above every persona: run commands yourself,
  never ask the person to run or paste, approvals through the card.

## Security keys for sensitive approvals (2026-10-16)

A person may ask that some kinds of approval need one of their security keys
or passkeys (WebAuthn) on top of the tap: Settings > Security
(`src/components/SecurityKeySettings.tsx`). Classes and classifier in
`shared/step-up.ts`; keys, ceremonies and verification (`@simplewebauthn/server`)
in `server/auth/security-keys.ts`; the decision in `server/auth/step-up-gate.ts`; routes
in `server/routes/security-keys.ts`. Rules, covered by
`server/auth/security-keys.test.ts`, `server/routes/security-keys.test.ts`,
`server/auth/security-keys.e2e.test.ts`, `shared/step-up.test.ts` and
`src/state/store.step-up.test.ts`:

- Classes: destructive, irreversible, money, external-send (the risk classes
  custom rules read from the call; any shell command that is not a plain
  read, an opaque one included, is destructive and irreversible),
  always-grant (Always allow, remember a command, a saved command, an owner
  rule that allows, a routine created or changed), publish-page, rule-change
  (an owner rule from a card, a tool that edits rules; in Settings, a rule
  that allows, a deny or ask rule removed, turned off or softened, a looser
  permission mode, and any looser approval level of a bot or a thread). A
  terminal is destructive and irreversible. File writes, screen actions and
  pages opened to send are classed by `actionToolClasses`: a write is
  irreversible, except a new file in the thread's own folder (fresh on this
  disk, no broken link, no dot path or engine instruction file, not a move,
  a patch or a server's write), which is in no class; typed text a shell
  reads as a deletion (`rm -rf ~`) is destructive
  (`server/auth/step-up-action-classes.test.ts`). A bot act card is classed by its
  route (DELETE destructive, any write irreversible, gone fails closed) and
  its step-up is bound to that route. Each person's own, on an organization
  server too: the answering person's choice applies; a caller with no person
  (a bot acting for its person) gets the bot owner's classes, and with no
  owner anyone's on the server, and is refused (it cannot sign).
- Every answer path asks `stepUpGate` before an Allow, before anything that
  settles a card (a bot act included): both `/respond` routes, `/always-allow`, a bot PATCH adding an `alwaysAllow` key, a Live
  call (`respondToCard`) and the console (`answerCardFromConsole`). Paths
  that cannot carry a step-up (voice, console, AI clients through
  `sagax_approve`) are refused for a card that needs one, never let through.
  Declining never needs a key.
- A step-up is a ceremony (32 random bytes, 2 minutes to answer, 60 seconds
  to use once verified) bound to the person and to grants the server
  computes: the card's thread, request id, a SHA-256 of its content
  (`cardContentText`) and the answer's widening parts; an Always allow is its
  own grant (bot and key). Each grant is used once; any mismatch (another
  person, another card, a changed card) burns the ceremony. A replayed
  WebAuthn answer fails on its challenge, a cloned key on its counter.
- User verification is required (a PIN or biometrics, not a touch alone).
  The signature counter never goes back, even for two answers verified at
  once. The ceremony page shows the card's title, what it does and an
  8-character fingerprint of what the key signs.
- No key for this address (RP ID), a removed key, or an unreadable
  `security-keys.json` (0600): refused. Removing a key, removing a class or
  adding a second key (bound to its name and address) needs an existing
  key; the first key needs a sign-in younger than 15 minutes (or this
  computer's own person in the desktop app); every addition is audited.
- "A sign-in younger than 15 minutes" (`server/auth/recent-sign-in.ts`,
  2026-10-18) is the session's `authAt`, never its `createdAt`: a bot that
  can create a pairing code (`manage_pairing`, act on
  `POST /api/auth/pairing`) redeems it into a brand new session. Only
  "Sign in with Pulsatrix" stamps `authAt` (web, or handed to the desktop
  or a phone through its one-time pairing window), and only from the
  id_token's verified `auth_time` when that moment is itself within the
  15 minutes (no more than 60 s ahead of this clock, dated now then;
  `authAtFromAuthTime`, 2026-10-19): a silent single sign-on or an old
  sign-in at the provider gives a valid session that is not recent. An
  email code is a valid sign-in but never a recent one (a bot that reads
  the person's mailbox can type it). A pairing code, the phone's
  `/api/pair`, an invite link, a renewal, a bot-act copy and an act-as
  session stamp nothing, and a session stored before this change has none
  (sign in again). "Sign in again" (Settings > Security for the first key,
  the vault export's refusal) is `/auth/oidc/start?fresh=1`
  (`src/lib/sign-in-again.ts`; the desktop app carries `fresh` to the
  system browser): Perspicax gets `prompt=login` and `max_age=0` and asks
  for the factors even with a console session there (Perspicax keeps no
  sign-in session at `/oauth/authorize` and answers `prompt=none` with
  `login_required`). A server without the Pulsatrix sign-in has no path to
  a recent sign-in: the row says so, with no button, and a first key or an
  export in clear there needs the desktop app. A headless server's
  loopback never counts (a bot's shell is a loopback caller there); the
  desktop app's own person does. The same rule gates the vault export for a
  person without a key. Tests: `server/auth/recent-sign-in.test.ts`,
  `server/auth/recent-sign-in.e2e.test.ts`, `server/auth/oidc-login.test.ts` (the
  auth_time and `fresh` cases), `server/mail/email-signin.test.ts`, C5 in
  `server/org/org-admin-console.e2e.test.ts`. The last key removed
  clears the classes.
- Recovery when every key is lost: stop the server, remove the person's
  entry from `security-keys.json`, start it again. The file's digest
  (`security-keys.json.sha256`) no longer matches, so the start logs a
  warning and writes a `security_keys.file_edited` audit row.
- A bot never reaches these settings through act: `shared/bot-act.ts`
  refuses `/always-allow`, `/command-allowlist`, `/permission-mode`,
  `/tool-grants`, `/api/security-keys`, `/api/custom-rules`,
  `/api/approval-rules`, the `refreshTaskPermissions` command and any
  `alwaysAllow`, `autoApprove`, `refreshPermissions` or `stepUp` field, at
  any depth (deeper than it reads is refused). An act path the URL parser
  would change (`/./`, an empty or dot segment, an encoded character, a
  backslash) is refused, so the guard reads the path the server routes.
  Routines written or run through act are always-grant, deleted ones
  destructive.
- An Allow with no live card is refused for a person who chose any class.
- A looser approval level covers a thread, a bot, a new Full thread, a
  permission refresh (with always-grant when it brings Always allow keys)
  and "all threads to Full" (every thread's own level counts). The desktop's
  trusted approval channel carries no step-up: the app asks
  `POST /api/security-keys/approval-mode` first (`op`: bot, thread, refresh,
  all-threads), which uses the step-up and returns a one-time allowance id
  (60 seconds) for that operation, bot, thread and level; the channel's
  request carries it (`stepUpAllowance`) and the server spends it on any
  try.
- Removing `security-keys.json` (and its digest) is noticed at start
  (`.security-keys-used`) and audited as `security_keys.file_removed`.
- Follow-ups, not covered yet: New bot defaults, bot creation and a bot zip
  import can give standing permissions without a key; the classes that apply are the answerer's only, not
  the bot owner's combined with them.
- RP ID: the https host the request came through (`x-forwarded-proto`), or
  `SAGAX_WEBAUTHN_RP_ID` (with `SAGAX_WEBAUTHN_ORIGINS`); never an IP address.
  The desktop app runs every ceremony in the system browser
  (`electron/security-key-browser.mjs`, 2026-10-18): Electron has no
  WebAuthn interface (no Touch ID, no iCloud Keychain passkey, no PIN for a
  hardware key; `isUserVerifyingPlatformAuthenticatorAvailable` is false),
  so a ceremony needing user verification never ended in an app window. The
  local page (127.0.0.1) opens it on `http://localhost:<port>` (RP ID
  `localhost`), this app's bundle on an organization server on that
  server's origin. The page polls `GET /api/security-keys/ceremony/:id/status`
  (waiting, done, failed, expired; the id is the authorization) and main
  brings the app back (`security-key:open`, `security-key:returned`,
  `desktopUiOnly`).
- The first key's fresh sign-in is said before the person tries:
  `GET /api/security-keys` carries `needsSignIn`, and Settings > Security
  shows a "Sign in again" row (the server's Pulsatrix sign-in, else `/pair`;
  the desktop opens it in the system browser) and comes back to that page
  after it (`src/lib/settings-return.ts`, sessionStorage, 15 minutes). The phone opens the same ceremony page in an
  AuthenticationServices sheet (`ios/App/SecurityKeyStepUp.swift`), https
  servers only. Keys are per RP ID: a key made on one address does not
  answer on another.
- The public ceremony routes (`/api/security-keys/ceremony/:id`, its page,
  its answer) run before the auth gate, as the MCP sign-in callback does;
  the id is the authorization and the answer must be signed by the
  person's own key. JSON only, `no-store`, a nonce CSP on the page.
- Not covered: provider-native auto modes, Full access and rules that
  already allow run without a card, so without a key.

## Default approval mode (2026-10-05, organizations 2026-10-11)

Approve for me (`approvalMode: "auto"`) is the mode a bot starts on, on a
solo server. On an organization server the organization's policy decides.
Keep these rules, covered by `server/independent-task-store.test.ts` ("moves
Ask bots and threads to Approve for me once"), `server/org/org-full-access.test.ts`
and `server/store.org-approval-default.test.ts`:

- `createBot` writes the Store's `newBotApprovalMode()` on the bot and its
  first thread (`auto` on a solo server; index.ts `newBotApprovalMode`).
  `POST /api/bots` keeps a level the request names. This computer
  (`computer: "local"`) stays Ask until its own warning. `GET
  /api/bot-defaults` answers `approvalMode` (that level) and the New bot
  dialog starts on it when the saved template names no mode
  (`newBotStartMode`).
- Organization server (`orgNewBotApprovalMode`, #1098 2026-10-27): Approve
  for me, as on a solo server; only an explicit `ask` as
  `defaults.approvalMode` (`newBotDefaults.profile.approvalMode`, what the
  console's `POST settings` writes) starts on Ask (`full` and `custom` need
  the owner's consent, which a new bot cannot have, so they start on Approve
  for me). Existing bots are never moved.
- The first start of a data directory moves bots and threads still on Ask, or
  with no mode, onto Approve for me, then writes `approval-default-auto.v1`.
  Where new bots start on Ask (an organization not set to `auto`) nothing
  moves and the marker is written all the same, so a later policy change
  never moves existing bots. A later choice of Ask stays. Edits, Full and
  Custom stay. A grant revoked at that start stays Ask, threads included.
  Import and team backup still force Ask.

## Bot owner permissions: owner route, modes, rules per person (2026-10-14)

A bot acts with its owner's rights (spec
`docs/superpowers/specs/2026-10-14-bot-owner-permissions.md`). Keep these
rules, covered by `server/approvals/owner-approval.test.ts`,
`server/engines/engine-access.test.ts` and `server/org/org-sharing.e2e.test.ts` (S3-7d):

- Only what goes beyond the owner's rights is an admin card
  (`memberBotAdminApproval`): a server command, a file outside the bot's
  workspace, a host-level `agents` tool or built-in MCP server (`computer`,
  `browser`, `shell`...), an unknown server or tool. A remote or personal MCP
  server, Sagax's fixed `perspicax` mount and a web search are
  the owner's (`ownerScopedTool`, `ownerScopedMcpServerFor`).
- On the owner route, the owner's rules then the bot's mode answer before a
  card (`ownerDecision`): deny wins, then ask, then allow. A rule is one
  tool plus a target read from the arguments, kept per person
  (`owner-approvals.json`, never shared between people). A destructive call
  (delete, bulk change, external email or SMS) is allowed only by an allow
  rule made for that kind, in every mode.
- Modes (2026-10-26, one approval level): no setting of their own any
  more. The bot's approval level is the only one (Ask for approval,
  Auto-accept edits, Approve for me, Full access; Custom on Codex) and the
  owner route reads it (`owner-autonomy.ts` `ownerModeForLevel`): Ask,
  Edits and Custom are Approval, Approve for me is Automatic approval, Full
  access is Bypass (`bots.fullAccess` and the org Full access policy, else
  Automatic; journaled as `owner-bypass`). Rules come first at every level:
  org Refuse/Ask first, then the person's and the bot's rules (a deny
  refuses, an ask keeps its card even in Full access, an allow goes without
  a card even at Ask), then the level for what no rule covers
  (`ownerVerdictOver`, matrix in `server/approvals/owner-approval-levels.test.ts`).
  At Full with an Ask or Deny rule in force, the engine runs at Ask so the
  rule sees every call (`engineApprovalMode`); Sagax answers the rest as
  Full. The old `GET/PUT /api/bots/:id/permission-mode` is gone; stored
  modes were carried into the level once (`approval-level-migration.ts`).
  No level or rule answers an admin card, a safety hold, a sandbox
  widening, a question, a guest's turn or a teammate tool.
- Routes live in `server/routes/owner-approvals.ts`, the owner's only;
  `act` cannot reach their writes (`tool-policy.generated.ts`), and a bot-act
  session copy (`isBotActSession`) is never the rule manager, so a bot
  cannot save a rule while answering a card through `act`.
- Rule scopes read `api`, `resource` and `verb` / `action` like the MCP
  permission registry's per-resource key (PR #508, `resourceKeyForCall`):
  #508 is the role guard before the call, this is the approval after it.

## Custom auto-review rules and sendable email drafts (2026-10-16)

Custom rules are a person's approval rules in their own words
(`shared/custom-rules.ts`, store `custom-approval-rules.json` 0600 in
`server/rules/custom-rules-store.ts`, routes `server/routes/custom-rules.ts`,
editor `src/components/bot-settings/CustomRulesCard.tsx`). Keep these rules,
covered by `shared/custom-rules.test.ts`, `server/approvals/auto-approve.custom-rules.test.ts`,
`server/routes/custom-rules.test.ts` and `src/components/CustomRuleNotice.test.ts`:

- A rule is "Quand <bot> veut :" a phrase plus Autoriser automatiquement,
  Demander d'abord or Refuser, for one bot or all of the person's bots. The
  phrase is compiled into a narrow matcher (actions, objects, folders, tools
  in backticks, products); a phrase it cannot read allows nothing.
- Precedence: deny > ask > allow, a bot's own rule before one for all bots.
  A deny refuses at `request.opened` before any grant; an ask keeps the card
  even under Full access, a saved command or an owner allow; an allow
  answers only what nothing else answered and never an admin card, a
  guest's turn, a safety hold, a sandbox widening or a question
  (`autoVerdict` sources `custom-rule`, `custom-rule-ask`, `custom-rule-deny`;
  owner deny and ask rules still win over a custom allow).
- An allow never covers a destructive, irreversible, money or external-send
  call unless the person ticked that class on the rule (`riskScope`).
  Tool arguments are untrusted: they only narrow a match (chained shell,
  `..`, relative paths never match a folder rule).
- Every automatic decision writes a decision row with the rule id; the
  transcript step and the card carry a rule notice with Edit rule. "Toujours
  permettre ceci" saves a rule from a card only when it covers that card
  (409 `rule_not_covering` otherwise); the check runs before anything is
  saved, so a refusal never changes or removes a rule the person had.
- The shell (decided after four security reviews, 2026-10-16): an allow
  rule never names a family of commands. "exécuter des commandes",
  "commandes dans <dossier>" and the like are refused as allow rules
  (route 400 `shell_family_allow`, the editor says "Pour le shell, seules
  des commandes exactes peuvent être permises automatiquement"); they stay
  valid as Refuser or Demander d'abord. A shell line is allowed only by
  "la commande exacte `...`" made from its card with "Toujours permettre
  ceci" (route 400 `exact_command_from_card` otherwise), bound to that exact
  line (outer spaces and tabs trimmed, nothing else), that bot (never all
  bots; its bot cannot be changed), that tool and server, the session's
  launch folder the engine reports (the shell may `cd` between calls; a card
  without one cannot be allowed, 409 `exact_command_no_cwd`) and that engine
  instance, risk classes still ticked
  (any git is irreversible: hooks and repository settings run code); or by
  a folder read rule when the engine's own shell (never an MCP shell tool,
  which may run on another machine) runs a plain read: cat, head, tail, wc, ls or stat, their own short
  flags only (no long flag, no `=`, no attached value, no `-L`/`-H`), every
  operand an absolute path inside the folder, no link on the way, no
  `,`, `%`, `^` or `@` (PowerShell and cmd read them). A folder allow never
  covers an MCP tool at all: this server's disk says nothing about another
  machine's folders. git, fd,
  rg, sort, uniq, tree, less, more, file and the grep family are never
  covered by a family rule. Chaining, redirection, substitution, quotes,
  control characters, `!` or a wildcard make a line opaque.
- Deny and ask rules match broadly and fail closed: words are read
  anywhere in the line (`/bin/rm`, `env rm`, `sudo`, `xargs rm`, `fd -x`,
  `rg --pre`, `sort -o`, `tree -o`, `git --output`, `git -c`, `git push`
  after global options); a relative path, a flag value, an operand-less
  reader, a path under any MCP key that names a place (path, uri, file,
  dir, src, dest, target), a `file:` URL in any case (tabs and line breaks
  inside dropped first), a JSON string, `~user`, `$HOME`/`${HOME}`, a UNC or an
  encoded or Windows path, or a scan cut short by depth or count leaves the
  paths unknown, which a folder deny catches. A cwd is never taken from the
  engine or the tool's arguments for an allow.
- Paths: only this person's home is `~` (`~user`, `~+`, `~-` refused); rule
  folders and call paths are both resolved; an allow needs every path
  inside as written and as resolved and none through a symbolic link; a
  deny or ask catches either, case-insensitively and in one Unicode form.
  A server's readOnlyHint never makes a call a read. Tools are named whole,
  server included; products match known server ids (or a Perspicax
  gateway's tool prefix).
- Model reviewer (examen automatique, 2026-10-21, the reference design parity A1, Decision:
  "OUI, comme Grok"; `server/rules/custom-rules-model.ts`, contract
  `customRulesJudgePrompt` / `modelCustomDecision` in shared/custom-rules.ts):
  a card the matcher left to the person (`none`, no risk-blocked allow) is
  judged after it opens by the bot engine's isolated `reviewPermission`
  (Haiku on Claude; Codex, Grok and ACP use their own isolated tool-free
  call, prompt never in argv; no reviewer on the engine = no review) against the
  person's rules and the organization's (R1..Rn, organization first, exact
  command rules left out; the call between untrusted delimiters). The same
  cards a custom allow may answer, including a routine, a webhook and
  another bot (lot A1b, Decision: comme Grok). Still never an admin card, a hold,
  a sandbox widening, a question, a guest, a security key, an owner ask
  rule or an email draft. The card shows "Examen en cours" and the
  notification waits until the verdict. Allow or deny only when it names a
  rule of that behavior; an organization rule never allows; an allow covers
  a shell line only when it is one plain line (no chaining, redirection,
  substitution, quoting or control character), never a risk class the rule
  does not tick, never a local path it cannot read; ask keeps the card
  with the notice. Unsure, failed, timed out (30 s) or answered meanwhile:
  the card stays. The engine gets the answer, the card `answeredBy.via:
  auto-review` and `customRule` (`reviewer: model`, `reason`), the journal
  `source: auto-review` with the rule and the reason (dropped in a
  confidential thread). Cache: one call per prompt in flight, 10 minutes.
  Tests: `shared/custom-rules.test.ts`, `server/rules/custom-rules-model.test.ts`,
  `server/rules/custom-rules-model.e2e.test.ts`. `tightenCustomDecision` and
  `safetyReviewPrompt(call, policy)` stay the tighten-only contract of the
  safety review.
- Tests: `server/rules/custom-rules.security.test.ts` holds every probe input of
  the four reviews; add each new bypass there.

Email drafts (`src/components/EmailCard.tsx`, `shared/email-draft-send.ts`,
`server/mail/email-draft-send.ts`), covered by `server/mail/email-draft-send.test.ts`
and `server/mail/email-draft-send.e2e.test.ts`: To, Cc, Subject and body are
editable (no invisible or direction character; a non-ASCII domain is shown
as punycode); Envoyer writes an approval card (`POST
/api/threads/:id/email-drafts`) and never sends. Allow sends once: through
the bot's own mail connector (Microsoft 365, Outlook or Gmail MCP server or
app) with a 10-minute one-shot pass bound to that bot, that connector's
server and a plain send tool (no forward or reply), the exact To, Cc, Bcc
(every recipient part parsed, IDN and IP literals included; no display
name; no other mailbox through `userId`), subject and exact approved body (HTML only if the draft was that
HTML), and no other field (no attachment, reply-to, from or header); or
through the
server's mail settings. The pass is consumed before the safety review is
relaxed for it, and the person's deny rules still apply. Bcc is refused in
a room and never shown in a card's arguments. A partial send records who
already received it, and Retry of the same draft skips them. Deny sends nothing. The
draft shows the status and a send error inline; Retry asks again.

## Settled approvals in the chat (2026-10-05)

A permission ask stays in the chat only while it is still waiting. Once it
is allowed, denied, dismissed or expired, `ChatView` and `GroupView` leave
it out (`approvalCardStaysInChat`). The message stays stored. A question
and a quiz are unchanged. The phone and iPad drop the same rows
(`settledPermissionLeavesChat` in `transcriptRows`). Covered on the phone
and iPad by `ios/Tests/CompanionCoreTests/ChatPreferencesTests.swift`; no
web test covers `approvalCardStaysInChat` yet.

Since #3681 (2026-11-11) the web chat and the rooms draw a waiting ask once:
while the pinned card over the composer holds it (a permission ask, a
question, a question in words, an offer), the conversation leaves its card
out, and its record comes back at its place once it is settled. The one rule
is `pinnedHeldIds` in `src/lib/pinned-waiting.ts`: the composer publishes
what its pinned card holds (`usePublishPinnedHold`) and the transcript of the
same view reads it (`usePinnedHeld`, `MessagesList`, the room `Transcript`,
`ParallelTaskCard`). A view without a pinned card provides no hold and draws
every card. Covered by `src/components/ChatView.pinned-once.dom.test.ts`
(a guard test) and `src/components/GroupView.pinned-once.test.ts`.
