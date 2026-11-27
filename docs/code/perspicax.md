# Perspicax and Pulsatrix Flow

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

## Visible roles (#2016, corrected #2032/#2033, 2026-11-05)

Every engine `tools/call` on the account's Perspicax connection reports its
role (`PerspicaxMcp` options `onRole`, `turnRole`, `roleFallback`;
`shared/perspicax-roles.ts`). Chat has no role picker and shows
no role chip, "Agit comme" card or role notice (web and iOS). The role lives
only on a Pulsatrix Flow routine's "Au nom de" field (`RoutineActAsField`,
hidden when the routine has no Flow recipe); other routines save no role. A
read 403 under a role is read once more as "Moi" by the relay and the role is
put back; a write 403 of a chat turn looks for one held role that may write
it, by a saved rule or a card (rule d7-403-switch-role), and a refusal blocks that write only,
never the turn's role switches (#3694); a guard or policy refusal of the
connector and a dry run are passed as they are (`roleRefusalOf`); a lapsed role stops the
call. A routine that acts as a role writes under that role or not at all
(#5078, D-20261119-055): a write while the connection is not on it (the role
could not be taken, the bot cleared it or took another) stops with one line
(`routineRoleWriteStop`), and a write 403 under it is never sent again under
another role or as "Moi"; its reads keep the rule above. `server/perspicax/role-journal.ts`
keeps transitions, refusals and owner rules per principal for the bot panel's
Details > Permissions row (graph behind its disclosure; no Roles tab since 2026-11-05)
and routine coverage; `role-events.ts` writes the journal only and never
posts into the chat. Tests: `perspicax-roles-relay.test.ts`,
`role-journal.test.ts`, `shared/perspicax-roles.test.ts`,
`RoutineActAsField.dom.test.ts`, `RoleChip.test.ts`,
`StatusActivityRow.test.ts`; gallery `src/gallery/visible-roles.html`
(`?view=routine|tab`).

## Codex Perspicax discovery (2026-11-04)

Codex 0.166 uses incremental tools instead of hosted `tool_search`. Its
account Perspicax mount uses the private searched MCP gate with core tool
pins and `search_tools` / `describe_tool` / `call_tool` for live discovery.
The original mount keeps its existing approval mode. Gate configuration
accepts scope or search; upstream credentials stay in its private record.
Wrapped calls retain the target tool and arguments for grants and approval
rules, and role changes invalidate the catalogue before returning.
Verification: `server/drivers/codex.test.ts`, `server/mcp-gate.test.ts`.

## Flow routine shadow readiness (#1991, 2026-11-04)

Flow readiness calls `flow_run` on the account's main Perspicax connection
with the run-as person's routine delegation. It never selects a bot profile
or identity. A prompt without a named recipe checks the connection and
catalogue only, leaving the recipe choice to the model. Recipe names come
only from explicit JSON, a `--routine` flag, a quoted name or a marked
`routine: name`; prose such as "routine Flow jusqu'à" is not a name.
A named recipe checks shadow init and checks a plan only when the prompt
supplies an explicit plan command and arguments. It never fabricates units
or a plan check before the model discovers its inputs. Plan calls name both
the recipe and run id so concurrent probes cannot select another claim.
Each probe names a distinct MCP client with its bot, recipe and a fresh id,
separate from business turns and other probes on the same person's account.
Cleanup calls `release {routine, run_id}` only for a successful init with an
identified run, using an independent signal; it never finishes a business
run or releases an unnamed claim after an init timeout. An `already_running`
answer keeps the live lease and reports that the plan was not checked. Actual Flow refusals are `flow_plan`; transport errors and
timeouts remain `probe_error`, passing in run mode. The Flow probe runs
beside the fast probes with its own 45-second budget and a per-routine,
per-input cache. Tests: `perspicax-flow-readiness.test.ts`,
`routine-flow-input.test.ts`, `routine-readiness.test.ts`,
`routine-reliability.test.ts`.

## Local act and Perspicax assertions (#1993, 2026-11-04)

`act` delegates an opaque Sagax session, never a Perspicax console JWS.
`botActConsoleRouteError` (`shared/bot-act.ts`) explains `/api/org/admin`
and `/api/org/member` before scope checks or approval; `performBotActRoute`
also checks before delegating a session for a planned replay. Console calls
go through the person's Perspicax account connection; local bots and routines use
`/api/bots`, `/api/routines` and `/api/routines/runs` with the existing
person checks. Never accept a Sagax bearer at the assertion gate.
Regression: `server/member-own-act.e2e.test.ts` (isolated organization,
admin and member replays) and `shared/bot-act.test.ts`.

## Obsolete bot Flow tenant copies (#1993, 2026-11-04)

The capabilities resolver reports `supersededBy: { tenant, version }` on
an older bot tenant copy when the installed signed organization Flow pack
already supplies it. Use the loaded tenant version, not the declaration's
advertised version or the product version. Installed shows that replacement
in en/fr and offers Remove directly through the bot's existing plugin DELETE
route to anyone who may change that bot. Removal refreshes the resolved
inventory, keeps the organization pack, and reports failure in place.
Tests: `capabilities.test.ts`, `PluginsPanel.modal.dom.test.ts`.
Headless journey: `scripts/capture/flow-superseded.mjs`; recipe and limits:
`docs/verification/flow-superseded.md`.

## Perspicax account roles and shared Flow (2026-11-04)

The signed-in account holds roles. Every bot uses that account's main MCP;
no bot profile checkboxes, default `perspicaxActAs`, profile settings page or
Flow binding configures access. When a task or recipe calls for a role, use
live `identity_switch` to list held `profiles` and `can`, select a returned
slug and refresh discovery. No OAuth checkbox is needed. Actual vendor
permissions, organization Refuse/Ask first rules and isolation between people
still apply. A refused permission is reported, never bypassed through another
host or credential. Generic Flow recipes are shared; the tenant supplies
organization facts and schedules. Claims prevent overlap and follow the
owner and bot independently of the selected role. Legacy stored fields are
inert compatibility data and never restore configuration controls.

Before every merge (and before every push, through the pre-push hook), run
`pnpm verify:merge`: the local gate (lint, typecheck, locale catalogs, source
terms, contrast, unused files via `pnpm check:unused`, the guard tests that
break `main` silently, the tests beside the files of the diff, iOS when `ios/`
or `shared/` changed; when the `swift` binary is missing (and only then) that stage is
skipped; a `swift --version` that fails any other way fails the gate. The summary and the pull request comment say the Swift tests were not run there,
and they run after the merge), a few minutes;
no CI runs on a private PR. It writes its result on the branch's pull request
(a "verify:merge" comment with the commit it ran on): merge only a PR whose
head commit has that OK; one without it was pushed around the gate
(`--no-verify`). The full suite runs once, at the version cut.

While working, any role (and any repository: Node, Rust, Python) runs
`scripts/fast-gate.sh`: typecheck, lint, source terms and the tests of the
touched files, 4 at a time, from the merge base plus the working tree.
`--list` shows the files and checks, `--only lint,tests` narrows, a
`.fast-gate` file (`name: command`) adds a repository's own checks. The cloud
run image ships it as `fast-gate`.

Before claiming a server or conversation change works, follow
[`docs/verification/README.md`](docs/verification/README.md). Always launch an
isolated fixture; never verify mutations against the user's live app or data.

UI work: read docs/design/ux-reference-grokbot-cursor.md first; do not re-scan Grok Bot unless the doc lacks the surface, then extend the doc.

## Perspicax account MCP on Claude and Codex (#1935, 2026-11-03)

An MCP server name is at most 40 characters everywhere (`MCP_SERVER_NAME`,
`shared/tool-scope.ts`). Never narrow the general limit back to 32. Perspicax
itself is one fixed `perspicax` account mount; a role switch changes that
connection's live catalog, never its server name. On a compact prompt the
bridge lists its core whole (`compactGateSearch`,
`server/mcp/mcp-gate-search.ts`). A forwarded gateway answer names the same
account server (`PerspicaxMcp.toolHome`, set by `setMount` in
`perspicaxTurnIntegration`); the agents server sends its tool calls there
(`{ locate }` on `/api/internal/perspicax/tool`).
`docs/mcp-tool-names.md`, last section.

## Codex mounts the internal Perspicax bridge (2026-10-30)

The one Perspicax account bridge reaches Codex through
`integrations.custom`, but is harness-owned: identify the exact
`process.execPath` command and the single `SPAWNED_PROXIES.perspicax`
argument, never a server-name prefix alone. Its reserved routing variables
do not trigger the third-party env guard. Keep the normal mount rename,
`canUseMcpServer`, tool selection and approval path. The direct bridge gets
variables prefixed by the hash of its fixed mount name, with values only in
the child environment; it restores them before reading its URL and turn
token. A selected gate already holds the upstream env in its private
per-mount record and keeps that path. Never fix this by removing the
reserved-variable guard for custom servers or sharing plain
`SAGAX_PERSPICAX_*` values with another server.

## Perspicax GO requests as approval cards (2026-10-26)

A Perspicax server guard (the Flow guard: dry run, GO, read back) asks the
person for a GO during a `tools/call` with MCP elicitation
(`elicitation/create` on the call's SSE stream). The harness relay
(`server/perspicax/perspicax-mcp.ts`) declares the `elicitation` capability on every
Perspicax session (`withElicitation`), reads the call's stream as it comes
(`readBounded` with `onRequest`) and shows the GO as an approval card on the
turn's thread (`askGo`, `confirmHeldCard` in `server/index.ts`: Full access and
Approve for me never answer it). That GO is a guard the owner kept: a write,
a contact or a send through the organization's connector. The browser's held
card shares `confirmHeldCard` but reads the person's level (#3502,
docs/code/computers.md); `askGo` does not. Keep these rules, covered by
`server/perspicax/perspicax-mcp.test.ts` ("the Flow guard's GO"):

- Only the person's Allow is a GO (`accept` with `decision: allow`); Deny is
  `decline`, no answer in time is `cancel`. The model never answers it.
- Only the approval form (`decision` allow or deny, `isGoForm`) opens a card;
  any other form is declined unasked, any other server request but `ping`
  gets -32601.
- The answer goes on the same session with the speaker's own token.

## Pulsatrix Flow compute (signed pack, lot 3, 2026-10-30)

`flow`, `flow_action` and the eight compute tools (`flow_free_slots`,
`flow_time_block`, `flow_overlaps`, `flow_stats`, `flow_age_buckets`,
`flow_group_units`, `flow_filter`, `flow_member_load`) belong to Perspicax
and its signed Python pack. Sagax only relays the selected
`perspicax_<profile>` tools under the current speaker's turn capability.
There is no local `sagax-flow` server, copied schema or TypeScript arithmetic.
Older packs advertise no compute tools; no local fallback invents support.
Mapping: `docs/migration/flow-plugin-mapping.md`.

The pack's `flow_compute_tools.json` owns the schemas;
`px_flow_compute.py` owns the pure calculations, with arguments for time
zone, working hours, holidays, midnight split and data. The profile and
active pack determine availability. The host adds pack provenance to the
answer. Existing read-only treatment stays limited to harness-owned
Perspicax bridges (`PERSPICAX_FLOW_COMPUTE_TOOLS` is permission vocabulary,
not an implementation). No write tool receives that permission.
Tests: `server/org/org-mcp.e2e.test.ts` proves forwarding as the speaker and
absence of the old mount; Grok read-only/gate tests reject impostor proxies.
Python parity and runner tests live in the Flow and Perspicax repositories.

## Pulsatrix Flow installation (lot 3, 2026-10-30)

`server/org/org-flow-plugins.ts` downloads the private manifest and archives
with the installation's live link token (`PerspicaxDirectory.linkBearer`),
without a member sign-in or Claude CLI. The guard declaration remains
required: `enabled` and `guard: "enforce"`; off/shadow removes the copies.
Only the linked issuer's marketplace and archive paths receive the token,
redirects are refused, and the token is never written to disk or status.
Manifest name, declared plugin/version, SHA-256 and archive identity must
agree. `ZipReader` rejects traversal, links and oversized archives. Staged
sanitized copies keep executable scripts and replace the prior copy only
after validation; a failed download/update preserves the usable old copy.
Tests: `server/org/org-flow-plugins.test.ts` (real HTTP/ZIP, no CLI).

`RemoteMcpClient` discards a closed legacy SSE endpoint. The next operation
opens a stream and repeats initialize/initialized once, sharing concurrent
handshakes. An interrupted request fails once and is never replayed. The
opening request's signal stops controlling the persistent stream once its
endpoint has arrived. Tests: `server/mcp/mcp-http.test.ts`.

## Bot files for the Perspicax console (2026-10-08)

The Perspicax console's file browser reads a bot's files through the
organization admin API (`server/org/org-admin-files.ts`, under
`/api/org/admin/files/<bot>/*`, the console assertion as the only
credential; `docs/verification/perspicax-sign-in.md`). Slice 1 is read only:
roots, list, stat, read (128 KiB) and download (100 MiB). Keep these rules,
each covered by `server/org/org-admin-files.test.ts` or
`server/org/org-admin.e2e.test.ts` (S7-G):

- Managers in reach and admins only (the bots route's `botInReach`); a bot
  out of reach is 404, never 403.
- Never a host path on the wire: roots are ids (`workspace`, `tasks`,
  `project`, `attachments`, `sandbox`, `desktop`), paths are relative to
  them, attachments are named by their opaque thread-file id.
- The project folder is served only when it lies inside the data folder.
  The people's server environments and a person's own computer (desktop
  bridge) are listed as unavailable: the server never opens them for the
  console.
- No `.`, `..`, empty segment, backslash or NUL; every segment is walked
  with lstat and a link anywhere is refused; reads open with O_NOFOLLOW.
- Each read and download is a `bot.files.read` or `bot.files.download` row
  of the admin activity log (category `bot`, actor the console person).

## Computers, bot looks and the routines calendar for the Perspicax console (2026-10-11)

The organization admin API (`docs/org-admin-api.md`) also serves the
console's bots gallery, routines calendar and computers. Keep these rules:

- `look` (`server/org/org-admin-look.ts`) resolves a bot's appearance as
  `src/components/Avatar.tsx` does (a picture only when its crop is not
  `mascot`); `shared/mascot-catalog.ts` names each character's family and
  skins for `GET capabilities`, and
  `src/components/floating-bots/mascot-catalog.test.ts` fails when it
  disagrees with the registry: a new character is an entry in both.
  `GET bots/{id}/avatar` never names a file and opens it with O_NOFOLLOW.
- `GET routines/runs` (`server/org/org-admin-runs.ts`) joins the console reach
  with the Automations scope (`routines.viewTeam`, `routines.viewAll`); a
  run outside the caller's reach comes `redacted`, without its thread.
- `computers` (`server/org/org-admin-computers.ts`): a server environment is
  acted on only through `UserSandboxManager` (start, stop, pause, resume,
  update, reset, delete; reset and delete need `confirm: true`, stop,
  pause and update need it while a bot works there), each action one
  `computer` row of the admin activity log. A person's desktop is listed
  read only (name, platform, presence, last contact, `localVm`) through
  `DesktopBridges.inventory()`; no route acts on it, reads its files, its
  system facts or its Local VM. Tests: `server/org/org-admin-*.test.ts`,
  `server/org/org-admin-computers.e2e.test.ts`, C6 and C7 of
  `server/org/org-admin-console.e2e.test.ts`.

## Fast model and Perspicax conventions (2026-10-26, #1209)

`ModelSelection.fast` ({ instanceId, model }, kept only with Auto, set in the
Auto pane of the model window): a quick turn (`classifyTask` says quick) and
the work a bot hands out in the light classes (`FAST_CLASSES`: quick,
automation, general) run on that model, usually a local one; reasoning,
coding, long reading, large context and vision keep the tier's model. The
engine must list the model for this payer (`AutoEngine.fast`, set by
`autoEnginesFor`, custom and local rows included); otherwise Auto picks as
before. The pick's chain goes on to the larger model, so a refusal climbs.
A turn with Perspicax tools mounted also gets
`PERSPICAX_CONVENTIONS_PROMPT` (`server/perspicax/perspicax-conventions.ts`): fields in
`set` with `action`, `parent`/`id`, `expect`, dry run first, ids and flags,
local times without an offset, one projection for a big result, totals by
aggregate. The server's own instructions win if they differ.

## Direct reads, clean blocks and reply style (2026-11-07, QA c1 #2577/#2578/#2580/#2581)

- Prompt: `PERSPICAX_CONVENTIONS_PROMPT` says a simple read calls the vendor
  tool directly (no skills_list, workspace_read, sagax_help, flow_run or
  identity_switch before it), Flow is for routines and multi-step
  procedures, and an unserved product gets "X n'est pas servi ici" after at
  most one `api_list`, never "no X". The capability footer and
  `flowSkillsNote` say a single read is not matching work. `WORK_STYLE_PROMPT`
  says a 403 or an unserved product is a blocker, not a failure to route
  around, and carries the style rules (no anglicisms, no signature emoji,
  ticket by number, no id or UUID: cards by bot and subject).
- Relay (`relayFrame`, `server/perspicax/perspicax-mcp.ts`): role switches
  go back and forth in a turn, one per call (#2960, QA 0.8.67 G6; the old
  one-switch-per-turn limit is gone). A read 403 is a permission block, never "no data"
  (`blockWith`, which also turns a JSON-RPC 403 error into a tool error the
  model reads).
- #2581 rework (decided 2026-11-07: the bot's limited role is wanted, the 403 is
  taken into account, not a hard stop): under a role, the read is sent once
  as "Moi" (unchanged). Under "Moi", `switchCandidate` picks one held role
  from the live listing (reachable, reads, not refused for this path in the
  role journal: `knownReadRefusal`, explicit-only first). A rule
  (`roleFallback` "rule": a saved bot role rule for that target, or the
  card's "Toujours permettre", fingerprint
  `role-read-switch:<from>:<to>:<path>`) runs it once as that role with no
  card. Otherwise the answer carries a `REFUSED:` offer (`roleOffer`): the
  bot switches itself (`identity_switch` to that role) when the person
  already allowed it or named that role, and `oneCall` puts the role back
  after the next call; or it sends the same read again and `askRoleSwitch`
  shows the card (`readSwitchSummary`).
- #2960 (QA 0.8.67 G1/G2/G6): `tryHeldRoles` walks every held role that may
  read the path (`triedRoles` per path per turn, so no loop): a refused
  role leads to the next one, and only when none is left does the answer
  carry `STOP:`, naming each role and its API member (`refusedBy`, from
  `roleMembers` filled by the identity listing). A declined card records
  `declinedPaths`: that read is never sent under another role in the turn
  (resent under any role, it gets `STOP:`, no new card, rule or "Moi"),
  but other switches stay free. `cwPermissionFor` maps the dotted resource
  (`service.tickets`) to the slashed path, so tries, declines, rules and
  notes share one key. `visibilityNote` tells the model, once per turn on
  the first ticket or board list (never a single ticket), that the list
  covers only that role's boards and names the other held roles
  (explicit-only first), so a partial count is never given as complete. The prompt carries the week-time fast path (one
  time.entries read on member and week, server total, titles optional).
- #4838: a holiday calendar read (`schedule/holidays`, `schedule/holidayLists`)
  of a scheduled run that every held role refused does not stop the run:
  `tryHeldRoles` answers with a plain note (no `STOP:`) to continue without
  holiday data, told once per run (`holidayNoted`). Chat turns and every other
  refused read keep the `STOP:`.
- Rendering: `cleanReplyStyle` (`shared/reply-style.ts`), before
  `dashFreeReply` in `runtime-events/preamble.ts`, drops a trailing signature
  emoji and hearts in a multi-line report, turns a bare ConnectWise ticket
  link into `billet #N`, and removes UUIDs and "Carte c16f208c" id prefixes.
  Code, inline code and markdown links stay as they are.

## Scripts in the server environment reach the bot's connection (#4081)

A script the bot runs in its server environment speaks plain MCP over HTTP
to the bot's own Perspicax connection, with no Perspicax token there
(`server/perspicax/sandbox-bridge.ts`).

- Every `run_command` of a turn gets `SAGAX_BRIDGE_MCP_URL` (the server's
  `/api/bridge/perspicax/mcp`, from `SAGAX_SANDBOX_BRIDGE_URL`, else
  `SAGAX_PUBLIC_URL`) and `SAGAX_BRIDGE_TOKEN` (`sgx_brg_`), only when the
  turn's connection speaks for the person whose environment runs the
  command. The token is one per turn and person, held by hash in memory,
  and ends with the turn (12 h at most). A routine watch command gets a
  token of its own for the check, revoked after it.
- The route is public (`PRE_AUTH_ROUTES`): the environment reaches the
  server by its public address, never its loopback. Without a live token:
  401.
- `initialize` and notifications are answered by the bridge, so a script
  never replaces the engine's MCP session. A turn's `tools/call` is first a
  held request opened `asEngine` (`holdConnectorCall`): the event names
  `mcp__perspicax__<name>` as the engine does, with the engine's input
  shape and no connector fact, so `decideRequestOpened` reads it exactly as
  the engine's own ask (organization Refuse and Ask first rules, the
  person's rules and Always allow, the level, the reviewed Perspicax reads;
  never a connector read). One state: an Always allow saved on either card
  answers both. Calls still waiting share one card only when tool and complete arguments (a digest of their canonical JSON, never the preview) are the same. Refused: a
  tool error `Refused: ...`, nothing sent; a script that left while its
  card waited never gets its call sent. Then the frame goes through
  `runInternal` on `/api/internal/perspicax/mcp` under the turn's own
  Perspicax capability: the confidential, misuse, safety and role checks of
  the stdio bridge.
- A watch check has no turn: its frames go through the person's routine
  delegation (`prepareTurn` as `owner-routine`), reads only by the relay's
  own reading (`frameReads`), like the watch's own tool reads; a frame after
  the check ends is refused.
- The token is masked in any text (`shared/redact.ts`). The bridge needs an
  https address (http only on loopback); without one the server logs it
  once and the bridge stays off. Same-cluster servers: the sandboxes chart's
  `sagaxBridge` policy (`docs/self-hosting.md`).
- Isolation: a token answers only while the turn's connection speaks for
  its person (`wrong_person`); a turn without a connection is
  `profile_not_mounted`.
- The watch exec passes only `SAGAX_*` names (`EXEC_ENV_KEY_RE`); the image
  sets `LANG` itself.

## The person's products in Connect Apps and the product key card (#4185)

- `server/perspicax/person-products.ts`: the client of Perspicax's link routes for the signed-in person (`/api/v1/pulsabot/people/me/products`, `.../{id}`, `PUT .../{id}/key`, `POST .../{id}/test`, `DELETE .../{id}/key`), with the link token and the person's live sign-in token (`linkJson`). One tolerant parse of Perspicax's own shape (`shared/person-products.ts`, against `crates/gateway/openapi.json` PersonProduct and KeyOutcome): `base_url` is the address, `reason_code` the state code, `profiles` the access (a `personal` profile reads "Given to you directly", never by its name), the key's `source` `user`/`profile`/`default` reads own/role/shared with `auth_type` its kind and `last4`/`last4_slot` its ending, and `actions` is an object of booleans (a list is read too); a write sends KeyBody `{ sub, target, values }` (`target` `own` for `set_own_key`, `serving` for `replace_key`, the person's choice on the page); a 404 or 405 from an older Perspicax reads "unavailable"; the list is kept 30 s per person and dropped after any write; no body is logged.
- `server/routes/person-products.ts`: `GET /api/me/perspicax/products`, `GET .../:id`, `PUT .../:id/key`, `POST .../:id/test`, `DELETE .../:id/key`, all `no-store`, 404 on a server that is not linked. `createSetProductKey` checks the values against the product's current form, then sends them once; the window and the card share it. `createSaveProductKeyCard` answers the card's Save (`POST /api/bots/:id/secret-cards/:messageId/product-key`) for the bot's owner only, keeps only the test's outcome (`secret.result`) and resumes the bot on an accepted key.
- The card: target `perspicaxProduct` with `product: { id, name, icon?, reason }`, raised by `request_product_key` (Sagax's own tool in the Perspicax family, permission `perspicax:productkey`) through `/api/internal/request-credential` with `productId`; never in a routine or a bot-to-bot turn; a newer card for the same product supersedes the older. The bot is told only the outcome (`productKeyResumeText`).
- The app: `src/lib/person-products.ts` (client, words), `ProductRows.tsx` (rows of Installed's `personal` slot at the Me scope), `ProductDetailView.tsx` (the page), `ProductKeyForm.tsx` (the one form, from `form.fields`), `ProductKeyCard.tsx` (the card). Actions are exactly the product's `actions`; the web-session sign-in waits for its Perspicax routes and is not drawn.

## Record cards: the record a bot names, read as the person (#4507)

- `shared/record-cards.ts`: the contract. A record link is `[#481516](sagax://record/{product}/{kind}/{id})` (`recordLink`, `parseRecordLink`, `looksLikeRecordLink`): each segment percent-encoded; decoded, product and kind read `[a-z][a-z0-9_]{1,40}`, the id `[A-Za-z0-9._:-]{1,128}` and never only dots; anything else stays text. `parseRecordKinds` reads a product's `records` (the kinds it describes, `{ kind, name: { en, fr }, plural }`, at most 24) into `PersonProduct.records` (`shared/person-products.ts`). `parseRecordCard` reads the console's card again (unknown fields dropped, the caps enforced again: title 200, description 600, a note 400, a field value 120, a name 80, 4 people, 10 fields, 2 chips, 6 lines, 3 notes; `open_url` https only; a field keeps its `value` text and, when typed, its `type` and parts: money, date with `day`, ago, percent with `share`, person, ref, state, duration) and `parseRecordCardAnswer` the route's answer. Sagax names no product and no kind: every word of a card is the console's.
- `server/perspicax/record-cards.ts`: `GET /api/v1/pulsabot/people/me/products/{id}/records/{kind}/{record}?lang=fr|en[&fresh=1]` through the person products call (link token plus the person's sign-in token), 15 s, 64 KiB. The console's codes map to the page's states: `subject` sign_in, `product_unknown` and `record_forbidden` no_access, `kind_unknown` and `record_unknown` unknown, `product_not_connected` not_connected (`details.state`), `vendor_busy` busy (`details.retry_after`), `vendor_down` down, a 404 or 405 with no code unavailable (an older console). One read in flight per person, record and language, and no card kept on the server: the console keeps it 60 s and owns its staleness; `fresh` skips the console's cache; a card for another record than the one asked is refused; a card is never served to another person and never written anywhere.
- `server/routes/record-cards.ts`: `GET /api/me/records/:product/:kind/:id[?lang][&fresh=1]` answers `200 { card }` or `200 { state, code?, retryAfter?, productState?, rule? }`, `private, no-store`, for the session's person only (a member route, `server/auth/client-allow.ts`). No approval card and no administrator: only the organization's rules apply (`recordReadOrgRule`: the facts of a bot's read of that product, rules marked `org`): a Refuse rule answers `org_refused` with no read; an Ask first rule does not stop the read (a card reads at once, no button, #4566). Personal rules and a bot's rules are not read.
- The record window (M-20261127-101, #5458): the opened card is one window for every record of every plugin, `src/components/record-window/RecordWindow.tsx` (the frame: head, optional full-width tabs, body, foot; moved by its head, resized by its sides, bottom edge and bottom corners with the `.app-resize-handle` look, the right and bottom edges taking the arrow keys, a double-click returning to the default) inside `HoverCard` held at the app window's top left (`placeRecordWindow`). Its size, place, split and each table's columns are kept per person and per type of window (`<product>/<kind>`) in one synced preference, `sagax.recordWindows.v1` (`src/lib/record-window-layout.ts`, in `USER_PREFERENCE_KEYS`; at most 40 types and one preference's 8 KiB, the oldest dropped first); a type never sized starts at 1240 by the window's height less 48 (860 at most), or at the size the person gave the opened card before (`sagax.recordCard.width.v1` and `.height.v1`, read only). What is shown is bounded by the app's window, 16 px from each side, and a smaller window never overwrites what is kept. `RecordCard.tsx` draws the head and the foot of every kind and, between them, a kind's own body (`window` prop) or the facts and the text in `RecordSplit.tsx` (two sides, each scrolling on its own, the split dragged and kept; under 760 px one column whose right head sticks). The shared blocks for every kind: `RecordBlocks.tsx` (`RecordWindowTabs`, `RecordPod`, `RecordRowActions`, `RecordAddButton`, `RecordEntryForm`, `RecordAvatar`, `recordShown`), `RecordGrid.tsx` (`RecordGrid` with moving and resizing columns, `RecordList`, `RecordFilter`: the Data window's one `DataFilter`), `ScheduleCell.tsx`. Tests: `src/components/record-window/RecordWindow.dom.test.ts`, `src/lib/record-window-layout.test.ts`, `src/components/RecordLink.dom.test.ts` ("the record window's place and size"). Captures: `scripts/capture/record-window.mjs` of `src/gallery/record-window.html`.
- The ticket card's detail (M-20261119-084): `src/lib/record-detail.ts` reads a 404 or 405 as "no detail route" only when it carries no code of the console (`detailRouteMissing`); `server/routes/record-cards.ts` passes the console's code on (`{ state: "unavailable", code }`), so a section the product refused shows its error in that tab and never takes the card's tabs and fields away. A note and the opened card's description are drawn by the chat's renderer (`src/components/RecordMarkdown.tsx`: `ChatMarkdown` inert, the product's `\(`, `\[` and `$` read as characters, never math, an error boundary falling back to the plain text); an image of it reads through `section=image` (`readNoteImage`, the console reads it with the person's key, the browser never calls the product), one inside a link (a signature's icon) small and quiet; a hovered card shows the words only (`src/lib/markdown-preview.ts`). `MarkdownImageContext` (`src/components/markdown-image-context.ts`) is how a surface draws the images of `ChatMarkdown` itself. The title is written in place when the counts answer lists `summary` (`POST {field: "summary", value}`, one trimmed line of 1 to 100 characters, `fieldChange`), through the same organization rules as any field. The opened card always takes its kept height, and a step to another record shows the trail of the records opened (`trail` of `RecordCard`, built in `RecordLink.tsx`). The action of the foot reads "Open on the web". Tests: `src/components/RecordLink.detail.dom.test.ts`, `server/routes/record-cards.test.ts`, `src/lib/markdown-preview.test.ts`. Captures: `scripts/capture/record-window.mjs`.
- The ticket window (M-20261127-101, #5458): `src/components/record-window/ticket/`. The fields column at the left in every tab (`TicketSide.tsx`, version A of D-20261127-008: the company card, then Owner, Team, Location, Board, Type > Subtype > Item, Time with its billable share, Agreement, the dates small at the foot; a field takes its slot by its `editKey`, never by its words, and a field of no slot keeps its label), the tabs over the right side only, Notes first, then Schedule, Time & expenses, Configurations, Attachments (`TicketWindow.tsx`); an empty tab where nothing can be added is hidden. `useRecordDetail.ts` reads each section on demand (every page joined, kept for the card's time to live) and writes through `writeAction` (`src/lib/record-detail.ts`). A write is one action of `shared/record-actions.ts` (`note.*`, `time.*`, `expense.*`, `schedule.*` with `schedule.done`, `configuration.*`, `attachment.*`; `POST .../detail { action, id?, set }`, checked by `parseRecordAction`, held to the organization's Refuse rules as a write of that product, a file by its size, never its bytes, up to 25 MiB), handed to the console, which maps it to its product. The counts answer may list the `actions` the console takes; one that lists none is tried and a refusal (`action_unknown`, `detail_invalid`) reads "Your console does not take this change yet." The rows' optional fields (`id`, `author_ref`, `member_ref`, `kind` meeting or resource, `start`, `hours_value`, `amount_value`, `work_type`, `billing` B, NC or DNB, a time page's `totals`) turn on edit, remove, mark done, the billing tag and the day grouping. "Schedule me" and "Dispatch the ticket" send their request to the conversation's bot (in a room, the Primary Bot), which answers with cards (D-20261127-007). Tests: `src/components/RecordLink.detail.dom.test.ts`, `server/routes/record-cards.test.ts`.
- The company's and the contact's window (M-20261127-101, M-20261127-140): `src/components/record-window/account/`. Tabs across the window, out of what scrolls, each with its count (`account-model.ts`: a company's Profile, Notes, Contacts, Tickets, Activities, Projects, Opportunities, Agreements, Configurations, Attachments, Sites, Finance, Data; a contact's Contact, Tickets, Activities, Configurations, Attachments, Notes, History); `RecordLink.tsx` keeps the tab chosen per record of the way. The Profile (`AccountProfile.tsx`) draws the console's `sheet` and, for each part it does not send, the card's own facts: the card's `phone` and `email` fields (two field types the console already sends, read as text elsewhere) for the round buttons and the contact details, its `contact` people as key contacts, the others and its fields as Details, its open-ticket lines as the first figure and the Tickets tab. A console that answers `kind_unknown` for the detail of a company or a contact (`detailKindMissing`) leaves that window: the Profile and the Tickets from the card. The sections Sagax reads (`src/lib/record-detail.ts`, the console's to serve, Perspicax issue linked from the PR): `sheet` (`{ sheet: { context[], since, title, roles[], reach[{kind phone|fax|email|web|linkedin|address|site|id, value, detail}], tiles[{tab, label, value, detail, tone, share}], upcoming[{id, subject, start, date, type, assigned, assigned_ref}], feed[{kind, at, who, who_ref, text, ref, label, tone}], people[{name, ref, role, detail}], prefs[{label, value}] } }`), `contacts`, `tickets` (the board's row: `number`, `summary`, `status`, `tone`, `priority`, `level`, `type`, `next {start, date, who[]}`, `closed`, `owner`, `updated`), `activities` (plus `contact`, `type_kind`), `projects` (`share`, `period`, `hours`), `opportunities` (`step`, `steps`, `probability`), `agreements` (`used`, `of`, `share`, `left`, `pace`, `months[]`), `configurations` (plus `detail`, `site`, `seen`, `online`, `icon`), `attachments` (plus `author`), `sites`, `finance` (`{ finance: { tiles[], aging[{label, text, share, tone}] }, lines: invoices }`), `stats` (`{ stats: { hours[], types[], resolution, billable[{billing, share, text}] } }`), `history`. Every word is the console's; a number is a count or a share, never a sum made here. New writes: `contact.add|update|remove` (first and last name, title, phone, email) and `site.add|update|remove`; a company's note is `note.add` with its words only. The tickets grid is shared (`record-window/TicketGrid.tsx`, the board's columns, the next entry's people in its tooltip). The Call button opens `tel:` through the window's link policy (`externalTelUrl`, `electron/app-permissions.mjs`), Write a `mailto:` draft. Tests: `src/components/record-window/account/AccountWindow.dom.test.ts`, `account-model.test.ts`, `server/routes/record-cards.test.ts`, `src/lib/no-visible-ids.test.ts`. Captures: `scripts/capture/record-window.mjs --only account`.
- The board and invoice windows (M-20261127-101, M-20261127-140): `src/components/record-window/board/` and `invoice/`, chosen in `RecordLink.tsx` by the kind (`board`, `invoice`), their tabs across the window (`window.tabs`) and what the person set in them (a board's tab and filters) kept while the card is open. They read the detail route's own sections (`src/lib/record-detail.ts`): a board's `tickets` (rows with `number`, `summary`, `company` and `company_ref`, `status` and `status_tone`, `priority` and `priority_level`, `type`, `owner` and `owner_ref`, `mine`, `opened`, `next { state planned|ongoing|none, start, end, people [{ name, ref, start, end, seen }] }`) and `stats` (weeks `{ week, opened, closed }`, `closed_this_week`, `first_response { text, detail }`); an invoice's `document` (`issued`, `due`, `terms`, `billed_to { name, ref, attention, address }`, `links`, `subtotal`, `taxes [{ label, amount }]`, `total`, `paid`, `balance`, `owed`, `pdf`, `steps [{ step issued|sent|due|reminder|next_reminder, at, who, done }]`, `client { balance, late, pays_in }`, its `lines`), `payments` and `history`. Every amount is the console's text. The tiles and the Data tab count the board's rows (by owner, by age, urgent entered today); the weeks and the first response come from `stats` only. A console that answers `kind_unknown` on the detail route serves no detail for that kind (`detailRouteMissing`): a board stays the original card, an invoice draws its card's facts in its document (billed to, the records it names, its lines, its amounts under their own labels) and its lateness by the card's rule (`recordLateness`), also a pill of the head (`window.chips`, after the card's own). Payments, History and Record a payment wait for the counts (`ready`, bound to the record read). Record a payment is `payment.add { amount, date }` (`shared/record-actions.ts`); PDF is `section=download&field=pdf`; Send a reminder goes to the conversation's bot like "Schedule me". The shared pieces: `TicketGrid.tsx` (the ticket list of every record that lists tickets, `NextPlanCell` with its hover, `QuietRecordName`), `RecordTiles.tsx`, `ChartPlot` of `ChartBlock.tsx`. Fixtures: `src/lib/record-board-invoice-fixtures.ts`. Tests: `board/BoardWindow.dom.test.ts`, `invoice/InvoiceWindow.dom.test.ts`, `src/lib/record-detail.test.ts`.
- The windows of the other plugins (M-20261127-141, M-20261127-146, #5475): `src/components/record-window/plugins/`. `plugin-windows.ts` picks the window by the record's product catalog (alone or after an instance's prefix) and kind: a SentinelOne `threat`, an Axcient x360Recover `device`, a BookStack `page`, a Twilio `message` (its conversation), an X `post` (`x_api`, `x_com` or `twitter`, no plugin serves it yet), a `folder` of any plugin (the Finder's look). `PluginWindow.tsx` (`usePluginWindow`, called by `OpenRecordCard` in `RecordLink.tsx`) gives the frame its full-width tabs and body; `usePluginDetail.ts` reads the same detail route as a ticket's tabs: `section=counts` (`{ counts, actions }`), `section=view` (one object, the overview) and list sections (`{ lines, next }`, every page joined), a file or a recording through `section=download` or `section=recording` (`{ contentType, base64 }`). The shapes are `src/lib/record-plugin-views.ts`: a threat's `view` (verdict, done, tree, file, device, device_tiles, device_facts) and its `timeline`, `notes`, `exclusions`; a protected system's `view` (tiles, days, days_summary, days_note, failure, volumes, vault) and `restore_points`; a page's `view` (path, body as Markdown with callouts as GitHub alerts, updated, book, facts, tags, edit_url) and `revisions`, `attachments`; a conversation's `view` (stats), `conversation` and `log` (messages: id, direction, body, when, day, status, tone, state, from, to, service, segments, price, error with code, title, cause and fix, life), `calls`, `number` (a view), `media`; a post's `view` (author, when, text, media, counts, tiles, pinned), `replies`, `stats` (a view: hourly, sources); a folder's `view` (path, places, siblings, summary) and `items`. A console that serves no detail for the kind (404 `kind_unknown`, the console of today for every kind but a ticket) leaves the card's own facts (`CardFacts`): no tab, no write, nothing filled in; a section it refuses hides its tab. The writes are actions of `shared/record-actions.ts`: `threat.rollback`, `threat.isolate`, `threat.reconnect`, `threat.verdict` (`true_positive`, `false_positive`), `backup.run`, `message.send` (1 to 1,600 characters), `post.reply` (`to` a reply's id), `post.pin`, `post.unpin`, `post.remove`, with `note.*` and `attachment.*`; an SMS or a reply reads as a send to the organization's rules, another kind's write as its product's `write` tool. A button offered only when the console lists the action; the others (Create a ticket, Restore files, Start a virtual machine, Explain a failure, Retry another way, Send by email, Suggest a reply, Write a follow-up, Share, Summarize) hand a request to the conversation's bot, which answers with cards. X's and the Finder's inks are the `--x-*` and `--finder-*` tokens of `src/styles.css`. Tests: `src/components/record-window/plugins/PluginWindow.dom.test.ts`, `plugin-windows.test.ts`, `src/lib/record-plugin-views.test.ts`, `shared/record-actions.test.ts`. Gallery: `src/gallery/record-window-plugins.html` over `src/lib/record-plugin-fixtures.ts` (`&console=card`: the card only). Captures: `scripts/capture/record-window-plugins.mjs`.
- `server/perspicax/record-links.ts` and `server/perspicax/seen-records.ts`: the relay hands every `tools/call` result carrying `_meta["pulsatrix/records"]` to `onRecords` (`PerspicaxMcp.withRecordsNote`): the records of a product and kind the person's product list describes are kept for the conversation (ids and labels only, 500 per conversation, memory only) and the result gains one line with the ready-made link, for the chat reply only (`recordsNote`: `In your chat reply only (never in a text, mail or message you send), mention it as [#481516](sagax://record/...)` for one record, the form once per kind and turn for several, 600 bytes at most). Every console tool's arguments (a send, a ticket note or update, a memory write, a query) go to the console with each record link reduced to its label: no console tool needs the app's address. Nothing is added to the system prompt or a tool description. A result without the metadata, an error and Sagax's own mapping calls pass byte for byte.

## Host presence events

The `perspicax-events/1` receiver accepts `host_presence` with key
`host:<host id>`, subject `{type: "host", host, hostname}`, and state
`online`, `shut_down`, `lost`, or `gone`. An offline host uses the existing
per-person product fix card and settle timer, with the hostname and complete
reason from the sender. Recovery or removal retires that same card. Stored
host states survive a restart. The assertion, person isolation and event
deduplication are the same as other product health events.
