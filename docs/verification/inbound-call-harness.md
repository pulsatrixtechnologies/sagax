# Inbound call synthetic harness (V-1 to V-4)

Parent: [#2642](https://github.com/pulsatrixtechnologies/sagax/issues/2642).
Issue: [#5535](https://github.com/pulsatrixtechnologies/sagax/issues/5535).

A synthetic inbound call that exercises V-1 through V-4 without a real person,
a real Twilio call or a real phone line. Slot B of
[owner-device-runs.md](owner-device-runs.md) stays the owner's own verified
number and real audio; this recipe is what a Mac can prove on fixtures.

Product surfaces: `POST /api/org/telephony/inbound`
(`server/bots/bot-inbound-telephony.ts`, contract `perspicax-voice/1`), the
spoken-register rules in `server/voice/voice-call-prompt.ts`, and the same
`place_phone_call` card / refusal path as a written turn
(`server/outbound/outbound-wiring.ts`).

## Command

```sh
pnpm qa:inbound-call -- --out /tmp/sagax-inbound-call
pnpm exec vitest run scripts/qa/inbound-call-harness.test.ts
```

`--out` writes `report.json` and `report.md`. The process exits nonzero when
any scenario fails.

## What each scenario proves

| Id | Proof |
| --- | --- |
| V-1 | A synthetic `call_request` with a fake `perspicax-voice` assertion is taken by the fixture person's bot as a `via: "call"` conversation turn. Audit rows keep the caller masked. |
| V-2 | Spoken replies stay short, Quebec French capable, with no links or lists: checked through `voiceCallInstruction` and fixture transcripts. No STT or TTS. |
| V-3 | Fixture timing budgets for telephony → first own-line turn and resume after interruption (reuses the interruption note from `voice-call-prompt`, same family as [voice-acceptance.md](voice-acceptance.md)). |
| V-4 | An action request during the call follows the same confirmation rules as writing: `thirdPartyCall: card`, bot-phone rules, then `place_phone_call` stages a card that `deny` refuses. |

## Isolation

- Loopback only (`127.0.0.1`). The assertion verifier is the same fake pattern
  as `server/bots/bot-inbound-telephony.test.ts`; never a second auth path.
- Fixture NANP 555 numbers only. Reports and audit rows never keep a full
  number or the caller's words.
- No real Twilio, no real person, no network outside loopback.

## What this does not prove

Slot B of [owner-device-runs.md](owner-device-runs.md) still needs the carrier,
the owner's verified number, real audio and a live interruption. Full-duplex
voice timing without a phone is already gated by
[voice-acceptance.md](voice-acceptance.md); call rows in chat by
[live-calls.md](live-calls.md).

## Related

- [Owner device runs](owner-device-runs.md) (Slot B)
- [Voice acceptance](voice-acceptance.md)
- [Live calls](live-calls.md)
- `docs/code/reach.md` (Bot phone)
- `docs/specs/bot-telephony.md`
