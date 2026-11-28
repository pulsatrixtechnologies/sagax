# Approval notifications on the phone and the Watch

Issue [#1708](https://github.com/pulsatrixtechnologies/sagax/issues/1708)
tracks the physical-device checks: question choice buttons on the banner,
silent removal once the ask is answered elsewhere, and the Watch layout.
[#5537](https://github.com/pulsatrixtechnologies/sagax/issues/5537) splits off
what the simulator already shows of the first two, in the section named for it
below. The contracts themselves landed in
[#1681](https://github.com/pulsatrixtechnologies/sagax/pull/1681). Product
rules: `docs/code/reach.md` "Approval notifications on the phone and the watch".

This recipe automates what a Mac can prove without a phone, then runs what a
simulator can show, and last lists the owner checklist for a real iPhone and
Apple Watch. It does **not** claim that the simulator rows or the physical
rows have been run.

## Automated contracts (no phone)

```sh
pnpm exec vitest run \
  server/push/hub.test.ts \
  server/push/payload.test.ts \
  server/push/frames.test.ts \
  server/notify.test.ts \
  server/notification-routing.e2e.test.ts \
  scripts/ios-approval-push.test.ts \
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
| The simulator pushes below still carry what the server sends, under the id the phone collapses on | `scripts/ios-approval-push.test.ts` |

These checks use fixtures and unit state only. They do not install a
Notification Service Extension on a device, do not talk to APNs, and do
not render a Watch face.

Simulator note (from #1681): `xcrun simctl push` does not run the
Notification Service Extension on an unsigned build, so a pushed banner never
shows a question's choice buttons and never takes an answered ask down
silently. That closes the push path, not the feature: the app posts the same
banner itself once it is paired, and that path does run in the simulator. A
second Watch simulator was also out of scope under Mac load, so the Watch
stays device-only.

## Simulator checklist (#5537)

Needs what `ios/TESTING.md` stage 3 needs (full Xcode, XcodeGen, a team id so
the simulator's keychain takes the token), plus the desktop app of stage 2 for
the two paired rows. Record the simulator's OS version, the build's commit,
and pass or fail for each row.

Four banners, written by the server's own builders (`server/push/payload.ts`),
so what the simulator draws is what APNs sends:

```sh
node --experimental-strip-types scripts/ios-approval-push.ts --list
node --experimental-strip-types scripts/ios-approval-push.ts --push
```

`--push` sends them to the booted simulator: `--udid <id>` for a named one,
`--out <dir>` to keep the files, `--row <name>` for a single row. Launch Sagax
first, then send it home with Hardware > Home: the app registers its
categories at launch, and iOS draws no banner at all while Sagax is the front
app (`ForegroundNotification.showsSystemBanner`).

| Row | Must show | Not visible from a push here |
|---|---|---|
| `1-approval` | Allow once and Deny under the banner | the bot's face and its full context: `mutable-content` is the extension's work |
| `2-question` | Reply with a text field | the two choice buttons: the extension is what registers them |
| `3-question-open` | one Open button, and no cut-off answer | nothing: a phone offers Open for this too |
| `4-answered` | a quiet "Answered." line with no sound | the silent removal: the extension that swallows this push never runs here |

Rows 1 and 3 are the app's own registered actions
(`Sources/CompanionCore/NotificationCategories.swift`), so they are the proof
that those categories are really in the simulator. For row 4: send row 1, wait
a moment, send row 4. The settled push carries row 1's collapse id, names one
`requestId` and never the conversation, and makes no sound.

### The choice buttons and the silent removal, in the simulator

Both come from the banner the app posts itself, which is the path a paired
phone takes too, and which does run here:

1. Pair the simulator with the desktop app (`ios/TESTING.md`, stages 2 and 3:
   Settings > Phone > Phone access, Pair a phone, the six-digit code).
2. Send Sagax home, so that a banner can draw at all.
3. Have the bot ask a question with two short answers: one button per answer,
   each titled with its short label, and a tap answers with the whole choice,
   never with the label shown. Then once with five answers: Open alone, since
   they cannot all be shown whole (`NotificationChoiceLabels.buttonsMax`),
   which is what row 3 pushes.
4. Leave a second ask up. Answer the first on the desktop, or from another
   client of the same person. That ask's banner leaves on its own, with no
   sound and with no "Answered." stand-in: the app removes it by its own id
   (`App/Notifications.swift`, `withdraw(threadId:requestId:)`, driven by the
   `notify-withdraw` frame).
5. The second ask stays, and so does another conversation's. Answering nothing
   but reading the conversation on the desktop keeps both open asks up.

Green here covers the choice buttons and the silent removal while the app is
alive. It says nothing about an ask that reaches a phone whose app was swiped
away, nor about APNs at all: those stay in the device checklist below (row 10
in particular), and no Watch row is proven until someone wears one.

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

Automated contracts above: `scripts/ios-approval-push.test.ts` ran green on
the Mac that opened the PR for #5537, and its output is in that PR; the rest
run on the Mac that opens the next PR for #1708. Simulator rows: **not run
here**. No simulator was booted and no app build was made, so each row of the
simulator checklist is still a row to run, and to record. Physical rows: **not
run here**, and no iPhone or Watch was used. Leave #1708 open until the owner
records the device results on the issue.
