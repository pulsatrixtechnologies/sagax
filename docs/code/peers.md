# Bots working together

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

## Peer receipts never name a teammate made private (2026-11-02)

Isolation between people. A bot record is patched in place, so a teammate
read before an approval card or a wait already carries its new name after
it. Every receipt, `toBotName`, message, chip and report written after a
wait reads the name at that moment, and only while the sender can still
reach the teammate: `receiptName` (`server/peers/peer-delivery.ts`, canReachPeer)
for ask_bot, delegate_bot and coordinate_bots; `teammateNameFor`
(`server/index.ts`, the route check that withholds a result) for the
report chip, the "Resumed with" chip and notification, and the resume's
report names. A receipt then keeps only the `botId` the caller sent (no
`botName`; the renderer falls back to the id); a person-facing chip says
"Teammate". After an approval, `delegateOnRuntime` and coordinate_bots check
the route again before any thread or work touches the teammate (ask_bot did
until lot 3 moved it onto the runtime, 0.8.24). Never name a peer from a
record read before an await. Tests: `server/routes/internal-bot-chat.test.ts`,
`server/peers/peer-delivery.test.ts`, `server/peers/peer-approval.e2e.test.ts`,
`server/direct-coordination.e2e.test.ts` (withheld report) and
`server/org/org-sharing.e2e.test.ts` S3-13 (two people).

## Peer completion: done_when and no ack-as-done (2026-10-30, #1818)

`coordinate_bots` accepts optional `done_when`. Structured clauses the harness
checks: `tool:ask_choice` (or native question tools), `first_line:PASS|FAIL`
(combine with `; `). Unmet, or a mode:work progress-only acknowledgement with
no tools, settles `failed(incomplete)`, not `completed`, so the caller can
`rework`. Decision-card work queued behind a busy hub expires in 15 minutes
(`decisionCardQueueMs`) with a clear detail; receipts say when the teammate is
busy. Roots (the requester's own turn) are not subject to the ack heuristic.
Contract: `docs/runtime-contract.md`; tests: `server/runtime/done-when.test.ts`,
`server/runtime/runtime.test.ts` (#1818 cases).

## Which bots a bot reaches: one person's, whatever the section (2026-11-09)

Owner decision: every bot reaches every visible bot of the same person,
whatever the sidebar section, and never a bot of another person. One
function decides, `canAccessBot` in `server/peers/peer-roster.ts`
(`sameOwnerBots`, the effective owners index.ts installs through
`setSameOwner`), read through `canReachPeer` by `list_bots`,
`list_room_targets`, the roster, @mention and name resolution and every
send route (`coordinate_bots`, threads, delegation dispatch, room handoffs
and room posts).

- Unset `peers`: every visible bot of the person, all sections. An
  explicit `peers` list still narrows it (an empty list reaches nobody but
  the person's Primary Bot, #1098); it never widens past the person.
- Nothing widens it to another person: not `SAGAX_OPEN_TEAMS=1` (now only
  team setup and incident routing, `canAccessTeam`), not
  `managed_sections` (`coordinatorSupervises` also needs the same person),
  not a `peers` entry, not a share or a manage level (`primaryCovers` stays
  a setup rule). Before this, a bot shared with a person was reachable by
  that person's bots, and a Primary Bot reached another person's bot it may
  manage; both are gone. A room holding bots of two people no longer
  carries work or posts between them.
- A bot with no recorded owner (a server bot) is the local operator's
  (`effectiveBotOwner`): it reaches and is reached by the operator's bots
  only. A solo server installs no owner check: every bot is the one
  person's, so every visible bot is reachable whatever its section.
- Tests: `server/peers/peer-roster.test.ts` (2026-11-09 block),
  `server/peers/peer-scope.test.ts`.

## Which bots a bot reaches (organization server, 2026-10-06)

Superseded for messaging by the person rule above: a share no longer lets
another person's bot message a bot, and a room of two people's bots no
longer carries work between them. `orgPeerInScope` still says which bots
the owner sees.

Owner report: a member's bots kept naming a bot ("Nova") the member
could not see. Why: once sections became personal, `bot.section` stayed
empty for everyone, so the section rule of `reachablePeers`
(`server/peers/peer-roster.ts`) put every person's bots in one "General" team.
Each bot's roster, `list_bots`, @mentions, `ask_bot`, `delegate_bot` and
peer threads reached the whole organization. Keep these rules, covered by
`server/peers/peer-scope.test.ts`, `server/peers/incidents.test.ts` and S3-12 in
`server/org/org-sharing.e2e.test.ts`:

- On an organization server a bot reaches only its owner's bots and the
  bots shared with that owner (any level, `botLevel`), the bots the owner
  sees in the sidebar (`orgPeerInScope` in `server/peers/peer-scope.ts`,
  installed by index.ts through `setPeerScope`). It is the owner's, not the
  speaker's, and it is not symmetric: sharing a bot with Bob opens it to
  Bob's bots, never Bob's bots to it.
- Every peer path checks it: `canReachPeer` (roster, `list_bots`, names,
  results withheld when access changed), the direct routes next to their
  `canAccessTeam` check, team setup's bot list and the delegation dispatch
  (`dropIfUnreachable`). A new peer route checks `peerInScope` too.
- Rooms keep their own rule (`roomHandoffProblem`): their members were
  added by people, so bots of different owners in one room still work
  together there. That holds only for a room the sender is a member of.
  `coordinate_bots` (what a chat turn uses, since it answers `ask_bot` and
  `delegate_bot` with 409) into another bot's direct thread or into a room
  the sender is not in needs every reader of the destination in scope, and
  `list_room_targets` lists such a room only on the same condition.
- A failure report goes to a Primary Bot of the failing bot's own owner
  (`chiefForBot` with `primaryBotSameOwner`), never the first Primary Bot
  of the organization.
- `orgPeerInScope` refuses an empty owner, but index.ts never passes one:
  `effectiveBotOwner` gives a bot with no recorded owner to the local
  operator, so such a bot is in the operator's scope, not shut out.
- A solo server sets no scope and is unchanged.
