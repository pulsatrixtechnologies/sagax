# Seen by and reactions on messages

Status: 2026-10-18. Applies to a 1:1 with a bot, a room, and a conversation
between two people, on a solo server and an organization server alike.

## Seen by

Every thread keeps one read position per participant: `{ messageId, at }`
keyed by the person's principal id or `bot:<botId>`
(`server/messages/read-receipts.ts`, table `thread_reads`). A person's position moves
when their focused app shows a message (`POST /api/threads/<t>/read`), a
bot's when its turn consumed the message. Positions only move forward and are
never written to the transcript.

Under a message, `SeenByRow` (`src/components/SeenBy.tsx`) shows:

- the muted label "Seen by" (fr "Vu par", pt-br "Visto por");
- the avatars of the people and bots who have read up to it, oldest first,
  stacked, five at most, then "+N";
- on hover or keyboard focus of an avatar, a tooltip with the name and the
  read time ("Sam Taylor · 2:46 PM"); the same words are its aria-label.

Each reader appears once, under the last message they have seen that they
did not write. A room shows everyone; a 1:1 with a bot shows the bot until it
answers. The viewer is never shown. "Send read receipts" off still hides a
person both ways in a conversation between two people.

## Reactions

A message carries `reactions: [{ emoji, actors: [{ id, kind, name }], at }]`
(`shared/reactions.ts`): one entry per emoji, `kind` is `person` or `bot`,
`at` is when the emoji first landed (it orders the chips). Messages stored
with the older `{ emoji, by }` entries are read through `normalizeReactions`
and rewritten on their first change.

`POST /api/threads/<threadId>/messages/<messageId>/reactions` with
`{ emoji }` toggles the caller's own reaction (`mode: "add" | "remove"` is
accepted too). Rules:

- The caller is always the actor; a body naming someone else is ignored.
- Who may call it is who may read the thread: a hidden bot, thread or room
  is 404, a conversation between two people is the pair's only, a read-only
  room member may react.
- `emoji` must be one emoji sequence (400 `reaction_emoji`); only chat
  messages take one (400 `reaction_kind`); 24 distinct emojis per message at
  most (409 `reaction_full`).
- The change is a persisted message patch, sent live as `message.patch` to
  everyone who sees the thread. It is quiet: no notification, no unread.

In the app (`src/components/Reactions.tsx`): a smiley in the message's hover
bar opens a picker with 👍 ❤️ 😂 🎉 👀 🙏 ✅ ❌ and a search in a small
built-in emoji set (`src/lib/emoji-list.ts`); the "…" menu starts with "Add
reaction" (E). Chips under the message show the emoji and the count,
highlighted when the viewer reacted; a click toggles the viewer's own; hover
or focus lists who reacted, a bot with its mascot.

## Bot reactions

Bots get two agents tools (`server/drivers/agents-catalog.ts`), in every
engine that mounts the agents tools (Claude, Codex, Grok, Gemini, pi, local
models through the chat tools, and the others) and in room turns alike:

- `react_to_message({ message_id?, emoji })`: `message_id` defaults to the
  message the bot is answering (the newest chat line someone else wrote in
  the turn's thread); `emoji` is one of the short list `BOT_REACTIONS`
  (`shared/reactions.ts`): 👍 noted, ✅ done, 👀 looking into it, ❤️ or 🙏
  for a thank-you, 🎉 good news, 😂 a joke. The schema names it as an `enum`
  and the route refuses anything else (`reaction_emoji`); the variation
  selector is ignored, so "❤" is stored as "❤️". A person's own picker is
  not limited.
- `remove_reaction({ message_id?, emoji? })`: takes back the bot's own.

The harness route `/api/internal/reaction` records the bot as the actor
(`bot:<id>`, its name), refuses the bot's own messages (`reaction_own`),
is idempotent (the same emoji twice changes nothing), keeps one reaction per
bot per message (`reaction_one`; remove first to change it), allows three
adds per turn (`reaction_budget`), and writes no message. It acts only on the
turn's own thread, so a confidential thread's reaction stays in it. On a live
voice call the tools are not shown, the guidance is left out and an add is
refused (`reaction_call`): the bot answers by voice.

When to react (`REACTION_PROMPT`, its own part of the system prompt, the maintainer
2026-10-18): sparingly, most messages get none; never instead of an answer
the person needs (a question gets words); never a reaction and a sentence
that says the same thing. A plain "thanks" or "ok" gets ❤️ or 👍 and no
text; a small task done gets ✅ instead of a "Done" sentence. A turn that
only reacts writes no reply bubble, and a reply that only repeats the
reaction placed in the same turn on the message it answers (that emoji
alone, or an aside such as "*(no further text needed)*") is not written
either (`echoesOwnReaction`, `server/index.ts`); a real sentence, even in
parentheses, or a reaction from an earlier turn keeps the reply.

The chip looks like a person's: emoji and count, the bot's mascot and name
in the tooltip (desktop) or the "who reacted" sheet (iOS). Like every
reaction it is a quiet `message.patch`: no notification, no unread.

## Tests

- `server/messages/read-receipts.test.ts`, `server/messages/read-receipts.e2e.test.ts`,
  `src/components/SeenBy.test.ts`, `src/components/GroupView.seenBy.test.ts`
- `shared/reactions.test.ts`, `server/reactions-store.test.ts`,
  `server/reactions.e2e.test.ts` (RX-1 to RX-3),
  `server/bot-reactions.e2e.test.ts`, `server/drivers/agents-call.test.ts`,
  `server/drivers/agents-catalog-reactions.test.ts`
- `src/components/Reactions.test.ts`, `src/components/MessageBar.test.ts`,
  `src/lib/reactions.test.ts`
- iOS: `ParityCoreModelsTests.testDecodesReactionsWithActors`; parity rows
  MS10, MS26, MS27 in
  `docs/superpowers/specs/2026-10-03-ios-feature-parity-matrix.md`.
