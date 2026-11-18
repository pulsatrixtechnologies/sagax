# TestFlight and App Store release

The app is native Swift and uses XcodeGen; EAS commands do not apply.

## One-time Apple setup

1. Enrol in the Apple Developer Program.
2. Team Pulsatrix Technologies (`PP546MZVHZ`). The bundle IDs `ca.pulsatrix.sagax`, `ca.pulsatrix.sagax.widgets`, `ca.pulsatrix.sagax.share`, and `ca.pulsatrix.sagax.notification` are registered (ASC app id 6818532985). The app ID needs the Push Notifications and Communication Notifications capabilities (`docs/ios-push.md`).
3. App Group `group.ca.pulsatrix.sagax` on the app and its three extensions (widgets, share, notification service); the shared Keychain group is `$(AppIdentifierPrefix)group.ca.pulsatrix.sagax`, plus the app's own `$(AppIdentifierPrefix)ca.pulsatrix.sagax`. Keychain service names and the credential encryption label keep their `openmausbot` spellings on purpose.
4. The App Store Connect app is **Sagax**, primary category **Productivity**, and a unique SKU.
5. Automatic signing (`project.yml`): archive with `-allowProvisioningUpdates` and the App Store Connect API key so profiles exist for the iOS app, its three extensions, the embedded watchOS app and its complication.
6. Add the review contact details in App Store Connect; do not commit private contact data or App Store Connect keys.

## Before every upload

1. Run `swift test` from `ios/` and the repository test suite.
2. Generate the Xcode project with `xcodegen generate` from `ios/`.
3. `DEVELOPMENT_TEAM` is already `PP546MZVHZ` in `project.yml`; check it survived the generation.
4. Increment `CURRENT_PROJECT_VERSION` for every upload. `MARKETING_VERSION` is always the same as the desktop `forkVersion` in `package.json`: every Sagax release bumps both to the same number (rule set by the owner on 2026-10-09; 0.4.16 is the first release under it). Never leave iOS on an older version than the desktop app.
5. Archive a generic iOS device build and validate it in Xcode Organizer.
6. Upload to App Store Connect and distribute to internal TestFlight testers first.
7. Complete a real-iPhone pass for organization sign-in, QR pairing, Bonjour permission, Keychain restore and upgrade migration, Tailscale, push notifications, voice calls (CallKit, barge-in, network change), dictation, widgets, approvals, secure credential entry through Apple Passwords and by paste, background/foreground reconciliation, sign-out/revocation, transcript sharing, and Share-sheet delivery of text, a link, an image, and a document. Repeat Share-sheet delivery after force-quitting the containing app.
8. After internal testing, submit to the external TestFlight group before App Review (see External TestFlight below).

## App Store Connect

- Copy the localized text from `en-US/`. It still describes the hosted Cloudflare route: rewrite that part before the first App Store (not TestFlight) submission.
- Use `privacy-answers.md` and verify it still matches the binary.
- Use `review-notes.md`, adding a real review contact and the demo access in App Store Connect.
- Support URL: `https://github.com/pulsatrixtechnologies/sagax/issues`
- Privacy policy URL: `https://github.com/pulsatrixtechnologies/sagax/blob/main/docs/ios-privacy.md`
- Choose manual release for the first App Store version; enable a phased release after the first production build is stable.

Uploads are done locally (`xcodebuild` archive and export, then upload with the App Store Connect API key); there is no TestFlight upload in CI.

## External TestFlight

The first external build goes through Apple's Beta App Review. Everything
for it lives in `testflight-beta.md`: the beta description and What to Test
in fr-CA and en-CA, the feedback email (`hello@pulsatrix.ca`), the URL
candidates, the review notes, the checklist (review contact, demo access,
build processed, export compliance) and the `asc` commands for app
`6818532985` and the group "Bêta Sagax". The final
`asc testflight review submit` runs only with the owner's GO.
