# Peer approval outcomes

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
