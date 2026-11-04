# Peer approval outcomes

A permission raised while a teammate works on a person's chat request also
appears as an actionable card in that initiating chat. Nested handoffs keep
the same runtime root. The linked view routes to the original thread and
request before the normal answerer, security-key, rule and resolver checks.
Settlement follows the original card, with one inbox entry and one decision.
Confidential threads and another person's data remain isolated. Work with
no proven human root retains its existing route.
Human room requests use the admitted message's durable id, through nested
handoffs, without changing work provenance. Existing audience projection
withholds card details and answer rights from other room members. Deleting
the destination withdraws its exact notification and clears the source
backlink; a late review notifies the original execution instead.

Run the focused root-chat checks:

```sh
pnpm exec vitest run server/approvals/origin-approvals.test.ts server/approvals/inter-bot-approvals.e2e.test.ts server/approvals/approval-restart.test.ts server/approvals/pending-approval-expiry.test.ts server/routes/bots-messages.test.ts server/routes/bots-mutate.test.ts src/components/PendingApproval.owner-rule.test.ts
```

The isolated HTTP fixture starts two teammate calls. Allow from the root
thread resumes only its exact source call; Deny from the root bot response
route refuses the other call. Both cards settle in the root transcript,
the inbox has two entries, the journal has one decision per call, and a
replayed view answer returns 409. The evidence is retained as
`<server-log>.origin-approvals.json`. Unit checks cover nested roots,
provider ids reused across threads, revoked access, confidential threads,
source deletion, interrupted backlink writes, expiry, restart and the source's
answerer/security-key gates. Always allow retains the source bot's exact
grant, including on clients that only send the card's legacy grant key.
The second isolated workflow starts in room A, passes through a teammate in
A and then a worker in room B, and answers B's exact call from A. Its runtime
root retains the admitted human message id while work provenance stays
outside. The `.room-origin.json` evidence records the linked transcripts and
runtime rows. Unit checks cover the original answerer's audience, destination
deletion, exact notice withdrawal, interrupted deletion recovery and a late
review's fallback address.
This proves the server workflow and desktop action wiring; it does not
drive a native phone UI or a physical security key.

Run the focused regression tests and the isolated HTTP workflow:

```sh
pnpm exec vitest run server/peers/peer-approval.test.ts server/runtime/runtime.test.ts server/peers/peer-approval.e2e.test.ts server/routines/routine-delegation.e2e.test.ts server/routes/internal-bot-chat.test.ts server/peers/peer-delivery.test.ts
```

The HTTP test uses `launchVerificationServer` and `control-omb` with disposable
data and the repository's fake Claude engine. It stops the initial server and
restarts that same fixture with a test-only import hook. The hook releases the
real peer-approval timeout callback after the test observes its card; it changes
no authorization or dispatch decisions. Unit tests independently advance the
production fifteen-minute deadline with fake timers.

The checks cover:

- User approval permits work; denial, expiry, and cancellation block it.
- Deleted peers and interrupted threads cancel approvals without attributing
  a decision to the user; late answers cannot revive settled requests.
- Routine `ask_bot` distinguishes an explicit denial from an unanswered card.
- A routine delegation expires without dispatching its target. It runs on the
  job runtime (lot 3, 0.8.24): its durable receipt is the runtime's row in
  `runtime.db` (`server/testing/handoff-rows.ts`), which `check_delegation`
  reads back; `delegation-receipts.json` keeps `run_with_engine` parts only.
  The unanswered review card refuses the work (`reviewHolds`): the row ends
  `failed` with outcome `refused` and no turn started, the row and the
  readback say the card expired without an answer, and the card is dismissed
  by the system, never answered for the person.
- Ordinary chat's multi-target `coordinate_bots` preserves mixed denial/expiry
  results and sends no work when any required approval fails.
- Receipt metadata survives reload, while old receipts remain readable.
- A peer hidden and renamed while its approval is open is never dispatched;
  the failure receipt does not disclose its newly private name.
- Isolation between people, on every receipt path: a teammate hidden,
  unshared or renamed while a card or a wait is open gets no thread and no
  work, and nothing written afterwards names it. ask_bot's refused review,
  delegate_bot and coordinate_bots after an allow, a poll-only caller's
  answers and the aside answer keep only the addressed id (`receiptName`,
  `server/peers/peer-delivery.ts`); a result withheld for that reason reaches the
  requester as "Teammate" in its chip, its resume and the report in it
  (`teammateNameFor`, `server/direct-coordination.e2e.test.ts`).
  `server/org/org-sharing.e2e.test.ts` S3-13 proves it across two people: a bot
  its owner unshares and renames while the asker's card is open.

The fixture writes safe response/receipt evidence to
`<server-log>.peer-approval.json` alongside the shared launcher's retained log.
It stops its owned server before removing temporary app data. Evidence excludes
the internal bearer token and provider environment.

This proves server behavior, not native UI rendering or real-model reasoning.
