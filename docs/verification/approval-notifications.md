# Approval notifications on the phone and the Watch

Issue [#1708](https://github.com/pulsatrixtechnologies/sagax/issues/1708)
tracks physical-device checks that the simulator cannot show: question
choice buttons on the banner, silent removal once the ask is answered
elsewhere, and the Watch layout. The contracts themselves landed in
[#1681](https://github.com/pulsatrixtechnologies/sagax/pull/1681). Product
rules: `docs/code/reach.md` "Approval notifications on the phone and the watch".

This recipe automates what a Mac can prove without a phone, then lists the
owner checklist for a real iPhone and Apple Watch. It does **not** claim
that the physical checklist has been run.

## Automated contracts (no phone)

```sh
pnpm exec vitest run \
  server/push/hub.test.ts \
  server/push/payload.test.ts \
  server/push/frames.test.ts \
  server/notify.test.ts \
  server/notification-routing.e2e.test.ts \
  src/lib/native-notification-payload.test.ts

(cd ios && swift test --filter 'ApprovalNotificationTests|NeedsYouFollowsServerTests')
```

What green means:

| Contract | Covered by |
|---|---|
| One notification per ask (`sagax.r.<thread>.<request>`); the next line keeps `sagax.t.<thread>` | `server/push/payload.test.ts`, `server/push/hub.test.ts`, iOS `ApprovalNotificationTests` |
| Question choices travel on the push; approvals do not; overflow layout is three + Open | `server/push/frames.test.ts`, `server/push/payload.test.ts`, iOS `ApprovalNotificationTests` |
| `noteSettled` / `kind: settled` is passive, no sound, same collapse id, withdraws only that ask | `server/push/hub.test.ts`, iOS `ApprovalNotificationTests` |
| `notify-withdraw` names the exact ask; reading a conversation keeps an open ask | iOS `ApprovalNotificationTests`, `server/notification-routing.e2e.test.ts` |
| Choice / Allow / Deny map to the respond payload; receipt wording | iOS `ApprovalNotificationTests` |
| Desktop type switch still routes approvals | `src/lib/native-notification-payload.test.ts` |

These checks use fixtures and unit state only. They do not install a
Notification Service Extension on a device, do not talk to APNs, and do
not render a Watch face.

Simulator note (from #1681): `xcrun simctl push` does not run the
Notification Service Extension on an unsigned build, so choice categories
and silent `settled` removal cannot be seen there either. A second Watch
simulator was also out of scope under Mac load. Treat those as device-only.

## Physical device checklist (owner)

Needs: TestFlight (or signed) build with the Notification Service
Extension, a real APNs environment on the server the phone uses, one
iPhone, and when available an Apple Watch paired to that phone. Record
OS versions, build number, and pass/fail for each row. Do not mark the
issue done until the rows that apply are filled.

### Setup

1. Sign in on the phone against the target server. Confirm
   `GET /api/push/devices` lists this phone (token masked).
2. Settings > Notifications: allow banners and sounds for Sagax.
   Approvals type on. Approval chime optional.
3. Lock the phone. Keep the desktop app open on another machine so you
   can answer an ask from there for the silent-removal row.

### Question choice buttons

4. Trigger a bot question with at least two distinct choices (and, once,
   five choices to exercise overflow: three buttons + Open).
5. On the lock screen or banner: the choice titles appear as actions
   (not only Allow once / Deny). Tapping a choice answers with those
   words; the quiet receipt replaces the ask ("Answer sent: …" or the
   localized equivalent).
6. With five choices: three choices plus Open; Open opens the
   conversation instead of guessing.

### Silent removal once handled elsewhere

7. Trigger an approval (Allow once / Deny). Leave it on the phone; do
   not tap it.
8. Answer the same card on the desktop (or another signed-in client).
9. The phone banner for that ask disappears without a sound and without
   leaving a "Répondu." / "Answered." stand-in that needs dismissal. A
   second open ask on the same conversation stays up.
10. Repeat with the phone app force-quit (swiped away): the `settled`
    push still removes that ask via the extension. If the app was only
    backgrounded with a live stream, `notify-withdraw` alone is enough.

### Apple Watch

11. With the Watch awake and mirroring notifications for Sagax: the same
    approval or question appears; the question text is first; Allow once
    / Deny or the choice buttons are reachable and not clipped.
12. Answering on the Watch lands the same quiet receipt path as the
    phone. Answering on the phone or desktop clears the Watch
    notification for that ask only.

### Out of scope for this checklist

- Live Activity island layout (already captured on simulator in #1681).
- MCP / AI-client quiet rules (covered by push frame unit tests).
- Production APNs key install on a VM (see `docs/ios-push.md`).

## Status of this pass

Automated contracts above: run on the Mac that opens the PR for #1708;
cite the command output in the PR. Physical rows: **not run here**. No
iPhone or Watch was used. Leave #1708 open until the owner records the
device results on the issue.
