# Blocking decisions as cards

Run only the targeted tests, with fake engines and disposable homes:

```sh
pnpm exec vitest run server/approvals/final-confirmation.test.ts server/approvals/final-confirmation.e2e.test.ts
```

The integration fixture starts an isolated organization server and fake identity
provider. Wren owns the bots; Osprey is a different member. It verifies:

- A routine that ends with a plain-text confirmation waits on a persistent
  question card. Its chat receipt, Approvals row and notification name the same
  execution thread. Answering resumes the same run and clears its wait.
- A signed MCP `send_prompt` produces the same card, member-API pending entry
  and notification. The notification converts to the existing iOS question
  push with the same request id and answers. The other member cannot read or
  answer it and receives no notification. Its task stays `waiting-on-you`
  with `busy: false`, including across a server restart, so iOS retains it in
  Needs you and an answer can start a new turn.
- A real `ask_choice` keeps its exact options and identity, with no duplicate
  when the provider turn completes.
- A scoped quoted GO reaches the engine with the system guidance. A subsequent
  write request still stops at Ask's normal gate; a refusal reaches the broker.

The fixture closes its SSE streams, broker sockets, fake provider, server and
temporary home. It opens no windows and contacts no real provider or tenant.
It proves server routing and the iOS push payload, not live APNs delivery or a
real model's compliance with the prompt. The fallback recognizes explicit
English and French confirmations; arbitrary wording can escape a heuristic.
The prompt and tool contract apply to every language.

The GO format is in [the agent API contract](../agent-api.md#passing-the-persons-go).
Neither a detected question nor a quoted GO changes any approval, denial or
isolation rule. New translations are unnecessary: the generated answers reuse
the signed `approvals.yes` / `approvals.no` English and French entries.
