# Owner device runs: blind pairs, phone, inbound voice (#5536)

Three QA coverage issues were closed as coverage gaps, not as defects: what
stopped them was a device, a booked call or a harness, never a broken
behaviour. Each still needs a run the owner's own device can do and a Mac
cannot:

- [#2644](https://github.com/pulsatrixtechnologies/sagax/issues/2644): a
  measured comparison against a reference assistant, judged blind (P-1 to P-4).
- [#2643](https://github.com/pulsatrixtechnologies/sagax/issues/2643): the
  conversation on the phone (M-1 to M-4).
- [#2642](https://github.com/pulsatrixtechnologies/sagax/issues/2642): an
  inbound call on the person's own verified line (V-1 to V-4).

This recipe is the calendar and the rows to fill. It claims no result: every
verdict starts `not run`, and a verdict is only written after the raw capture
or transcript behind it is archived (see
[Where the evidence goes](#where-the-evidence-goes)). The reference
assistant's own configuration is out of scope and stays unpublished.

`scripts/testing/verification-docs.test.ts` fails when a row disappears, loses
its slot or is left without a verdict, so an unrun row stays visible instead of
quietly deleted.

## The calendar

| Slot | Runs | When | Time | Blocked by |
| --- | --- | --- | --- | --- |
| A. Phone conversation | every release | on the release candidate, after the local gates of `docs/releasing.md` step 4 and before the tag | 40 min | nothing |
| B. Inbound voice call | every release that touches voice, the line or the phone | a call window booked with the owner, weekdays inside the person's allowed hours | 30 min | the owner's number must be verified for the line |
| C. Blind pairs | once per QA lot, never at a release cut | four sittings of 45 min, one per task family; offline fixture harness is `pnpm eval:blind-pair` ([blind-pair-harness.md](blind-pair-harness.md), [#5533](https://github.com/pulsatrixtechnologies/sagax/issues/5533)) | 45 min per family | nothing |

Slots A and B sit beside the release checks that already run live on the same
candidate: the connector live check
([connectors-live.md](connectors-live.md)) and the voice acceptance recipe
([voice-acceptance.md](voice-acceptance.md)). Neither claims audio, a phone or
a real line, which is exactly what A and B add.

## Before any slot

- [ ] The release candidate is installed on the owner's phone, signed in to the
  server that candidate will serve, and that sign-in is the one the run reads.
- [ ] Push notifications are allowed for Sagax on that phone (Settings >
  Notifications), and the phone is not in a focus mode that mutes banners.
- [ ] A QA bot exists for the owner, with a harmless routine that can be run
  on demand, and its conversations are titled for the run, as the live checks
  do.
- [ ] The task set for slot C is written before the first send, with its hash
  recorded in the issue; a task set edited mid-run invalidates the run.
- [ ] Screenshots and transcripts go to a folder outside this repository: the
  repository is public, and a real voice, a real number and a real thread
  never enter it.

## Slot A. Phone conversation (M-1 to M-4)

Four sub-cases, three sends each, every send in a fresh conversation with
synthetic data, as the parent protocol asks. A screenshot is paired with the
raw page of the same thread, so the capture and the server agree.

1. [ ] M-1: send a request, get one complete reply, no loss, no duplicate.
2. [ ] M-2: answer a choice question from the phone; the answer lands as the
   chosen option, not as free text. The banner buttons are the device rows of
   [approval-notifications.md](approval-notifications.md); here the answer is
   tapped in the conversation.
3. [ ] M-3: run the QA bot's routine, take the notification it posts, and
   confirm the tap opens that run in the main chat area
   ([routines.md](routines.md)), never a side panel and never the wrong thread.
4. [ ] M-4: open a long reply: it scrolls, it stays anchored at the bottom on
   arrival, its links open.

What green means on the phone only: the same turns are already driven headlessly
through the real renderer ([chat-ui.md](chat-ui.md)), and the notification
routing is proven without a device by `server/notification-routing.e2e.test.ts`
and `src/lib/notify.test.ts`. The simulated phone session of
[fixture-phone-session.md](fixture-phone-session.md) already proves M-1 to M-4
over pairing, companion headers, the fake engine and SSE (one complete reply,
a choice answer from the phone token, a routine `done` notification that opens
the main chat, and a long reply with its link in the payload). Slot A is the
install, the banner, the touch and the screen size.

## Slot B. Inbound voice call (V-1 to V-4)

The campaign rule holds: nobody calls or messages a real person outward. So
the owner calls in, from the number verified for the line, inside a window
agreed beforehand, and agrees that the transcript is archived with no real
name in it. Product rules: `docs/code/reach.md` and
[../voice-mode.md](../voice-mode.md); the line's model is
[../specs/bot-telephony.md](../specs/bot-telephony.md).

1. [ ] V-1: the call from the verified number is taken by that person's bot.
2. [ ] Three scripted calls, in this order: a simple question, a long answer to
   summarize, an action request that must be refused.
3. [ ] V-2: every spoken reply is short, in Quebec French, and reads no link
   and no list aloud.
4. [ ] V-3: time the gap before the first word, three times, and speak over the
   bot once to check it yields.
5. [ ] V-4: the action request inside the call follows the same confirmation
   rules as in chat; the same card path, the same refusal.

What green means on the line only: `pnpm voice:acceptance` already runs the
32-turn full-duplex call on an isolated server, and the synthetic profile is
gated in CI
([voice-acceptance.md](voice-acceptance.md)); the harness call leaves its rows
in the chat as a real call does ([live-calls.md](live-calls.md)). Slot B is
the carrier, the verified number, real audio and the interruption.

## Slot C. Blind pairs (P-1 to P-4)

The offline fixture harness of
[#5533](https://github.com/pulsatrixtechnologies/sagax/issues/5533) is
`pnpm eval:blind-pair` (recipe [blind-pair-harness.md](blind-pair-harness.md)):
it freezes the grid under a sha256 manifest, sends one prompt with one context
to two scripted assistants, anonymizes the outputs as Assistant A / Assistant B,
and scores with a deterministic fixture judge. No live LLM and no network. The
owner sittings below reuse that same frozen grid when a live pair is judged by
a person. The offline behaviour evals (`pnpm eval`, `evals/README.md`) stay the
harness-side gate for product behaviour; this slot is the comparison protocol.

1. [ ] Freeze the grid and its expected results, record the hash on #2644, and
   check that hash again before the first send of each sitting (`pnpm
   eval:blind-pair` prints the manifest sha256; the files live under
   `evals/blind-pair/rubric/`).
2. [ ] One sitting per task family: five pairs minimum, in random order.
3. [ ] Hand the anonymized outputs to a judge who is not the operator of either
   side, and record who judged.
4. [ ] P-1 and P-2: record the gaps per criterion, exactness and completeness
   of the result, then the instructions held (language, format, length).
5. [ ] P-3: record the total time to a useful result on both sides of each pair.
6. [ ] P-4: record what the out-of-scope request did, in both directions.
7. [ ] Report the gaps per criterion, with the raw outputs. No overall score.

## Rows to fill

One row per sub-case from the three parent issues. Fill the verdict only from
archived evidence; `not run` is the honest default.

| Sub-case | Slot | What to record | Verdict |
| --- | --- | --- | --- |
| M-1 | A | the sent request and the full reply, capture paired with the thread's raw page | not run |
| M-2 | A | the card on the phone, the tapped option, and the thread's own receipt | not run |
| M-3 | A | the notification, the thread it opened, and the run's row | not run |
| M-4 | A | a long reply: scroll position, anchoring, one opened link | not run |
| V-1 | B | the call start line, with the number masked | not run |
| V-2 | B | the three transcripts, with the spoken register checked line by line | not run |
| V-3 | B | three timings to the first word, and the interruption exchange | not run |
| V-4 | B | the action request, its card or refusal, and the thread it left | not run |
| P-1 | C | the pair's two outputs and the gaps on exactness and completeness | not run |
| P-2 | C | the gaps on language, format and length | not run |
| P-3 | C | time to a useful result, both sides of each pair | not run |
| P-4 | C | what the out-of-scope request did, both sides | not run |

## Where the evidence goes

The issue keeps the verdicts, the counts, the timings and the raw material;
this recipe keeps only the verdict column, so the public tree never holds a
voice recording, a phone number, a person's name or a thread of theirs.
Each run also leaves the command sequence it used, and, for slots A and B, the
OS version and the build number of the phone.

## Out of scope

- The reference assistant's configuration, its settings and anything about the
  service itself: a reference, never a subject of this campaign.
- A single quality score across criteria; the parents ask for gaps per
  criterion.
- Anything the automated recipes already prove, including a simulator for the
  banner buttons or the call rows.
- A client's device, a client's mailbox, a client's number: the owner's own
  device and line only.

## Closing rule

Each parent issue closes when its rows here carry a verdict of `conforms`,
`does not conform` or `inconclusive`, backed by the archived evidence, or when
a written product decision puts the sub-case out of scope. A defect found
during a run gets its own issue and is never poured back into the parent.
`inconclusive` is a valid end: an absent result is neither a pass nor a fail.
