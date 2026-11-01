# Push notifications for the phone app (APNs)

The phone app shows notifications by itself only while it runs or lingers in
the background with its live stream open. Once it is closed, or suspended
for long, only Apple Push Notification service (APNs) can reach it. The
organization server (Sagax in server mode, the `pulsabot` container on the
production VM) therefore sends real APNs pushes.

## What gets pushed

| Event | Push kind | When |
| --- | --- | --- |
| A person writes to you directly, a bot finishes a turn in your thread | `message` | Nobody saw it (below) |
| Someone nudges you | `nudge` | Always, at once, priority 10, the nudge sound |
| An approval, or a bot waiting on your answer | `approval` | Nobody saw it |
| A bot asks you to take over its computer | `approval` | Nobody saw it. Priority 10 like an approval; the banner has no Allow or Deny (no `requestId`). |
| A turn that could not start (expired OAuth, missing access) | `message` | Nobody saw it |
| An incident the person has to look at | `message` | Nobody saw it |
| A routine of yours finished | `message` | Nobody saw it. The banner names the routine (`Open routine %@`) and opens its report. A bot-to-bot turn stays quiet: the chip in both threads is the notice. |
| A routine of yours failed, or waited half an hour behind a busy bot | `routine` | Nobody saw it |
| An achievement unlocked | `achievement` | No client of yours is connected, and you turned on system notifications for achievements |

"Nobody saw it" is the desktop's own rule (`src/lib/attention.ts`,
`messageAttention`): notify unless you are looking at that conversation in a
focused window. The server does not know which conversation a window shows,
but a window that shows a conversation marks it read
(`POST /api/threads/:id/read`, `/api/groups/:id/read`, `/api/bots/:id/read`).
So when one of your clients is connected (presence), the push waits 8
seconds and is dropped if one of them marked that conversation read; when
none is connected it goes at once (`server/push/decide.ts`).

A phone whose live stream is open (`GET /api/events` with
`x-sagax-push-token`) already has the line: the hub skips APNs to that
device even if another of your phones or the desktop still gets the push.
On the phone, `userNotificationCenter(_:willPresent:)` returns `[]` while
the app is in front, so a push that still arrives (a race, a token that
had not yet been named) shows no banner and plays no sound.

Once a conversation that buzzed the phones is read on any device, the server
sends each phone one silent push (`kind: "read"`, `content-available`,
priority 5, `buildReadSyncRequest`): the phone withdraws that conversation's
banner and recounts its badge. Whenever its unread count drops (or it
loads the fleet), the phone also withdraws banners older than 10 seconds for
bot conversations that are no longer unread or waiting on the person
(`ios/Sources/CompanionCore/DeliveredNotifications.swift`).

Each push follows:

- the phone's Settings > Notifications (notification sounds, the approval
  chime, nudge sound), sent with each registration;
- the person's synced "Notification sounds";
- a bot's notifications muted for that person (Settings of the bot);
- a rate limit of 20 pushes per person in 5 minutes (approvals and questions
  are exempt; a refused push is logged);
- one notification per conversation (`apns-collapse-id` is
  `sagax.t.<threadId>`, the same identifier as the app's local
  notification, so a push replaces the banner the live stream already showed).

The alert text of a message is the message itself (clipped to 240
characters): it travels through Apple to the phone like any messaging app.

An approval banner has two actions, **Allow once** and **Deny**. Neither
is "Always allow": the lock screen does not show the whole card, so a
standing grant is not offered there. iOS asks the person to unlock the
phone (Face ID or the passcode) before either action is delivered, and
the app answers `POST /api/threads/:id/respond` in the background. Allow
sends `behavior: "allow"` once. Deny sends `behavior: "deny"`. If the
person protects that class with a security key, the push uses the
category `SAGAX_APPROVAL_KEY`: Allow opens Sagax and the existing
ceremony runs (a passkey with Face ID, or a key). Until that ceremony
answers, nothing is approved. A question uses `SAGAX_UPDATE` and has no
actions. The approval chime (`approval.caf`) is the sound of an approval
banner when notification sounds and the chime are on.

A push from a bot or a person is an iOS **communication notification**. The
banner names the bot (or the person) as the sender and shows their avatar as
the icon, the way Messages and the reference design look, instead of "Sagax" with the
app icon. The server sets `aps.mutable-content` to 1 and sends `senderName`,
`senderId` and a relative `avatarUrl` (`/api/attachments/...` or
`/api/people/<id>/avatar?v=...`). The Notification Service Extension
downloads the picture with the pairing bearer, donates
`INSendMessageIntent`, and calls `content.updating(from:)`. If the picture
cannot load, the sender name is still the title. Achievements stay ordinary
alerts.

A bot's banner wears **its mascot**, as everywhere in the app (2026-10-28).
The push also carries `senderLook` (the bot's `color`, `mascotLook`,
`mascotSkin` and `avatarCrop`, nothing else of the bot) and
`senderLookVersion` (a hash of that look and its picture), next to the
`thread-id` that groups the conversation. The extension draws the mascot
itself with the app's own still characters (`MascotAvatarRenderer`, 360 px,
on a soft disc of the bot's colour) and keeps the PNG in the App Group
(`Library/Caches/NotificationAvatars`, one file per bot and look version,
`NotificationAvatarCache`). A bot whose crop shows its picture (circle,
rounded, square) gets that picture, and its mascot when the picture does not
load (`NotificationAvatarPlan`). Drawing on the phone needs no network and no
signed URL, so it works when the server is unreachable. Anything that fails
leaves the banner as before: the bot's name, the app icon. The app's own
local banners (live stream) draw the same face from the bot it already has.
Over 4 KB the look is dropped from the push, never the push. The watch shows
the face of a communication notification the iPhone forwards to it; it has
no Sagax app and needs nothing more.

This needs the **Communication Notifications** capability on both App IDs
(`ca.pulsatrix.sagax` and `ca.pulsatrix.sagax.notification`) in the Apple
Developer portal. Xcode automatic signing then puts
`com.apple.developer.usernotifications.communication` in the profile. Until
that is on, the extension still sets the alert title to the bot's name, but
iOS keeps showing the Sagax app icon.

## Live Activities (ActivityKit push)

A bot's Dynamic Island / lock-screen Live Activity is started on the phone
with `pushType: .token`. The phone registers each activity's push token
(and, on iOS 17.2+, the push-to-start token) at `POST /api/push/activities`
for that person and bot. When the bot's state changes (working, needs you,
done) and the phone's live stream is not open, the server sends an APNs
push with:

- `apns-push-type: liveactivity`
- `apns-topic: <bundleId>.push-type.liveactivity`
- `event`: `update` or `end`
- `content-state` matching `BotActivityContent` (Date `since` as Cocoa
  reference seconds, Swift's default JSONEncoder)
- optional `stale-date`, `dismissal-date`, `relevance-score`

Priority 10 for needs-you and end (Apple's high-priority budget, rate
limited); priority 5 for working line updates. A 410 / dead token is
pruned; ending a bot clears that person's update tokens for it. Tokens
belong to one person only.

## Code

- `server/push/config.ts`: the `SAGAX_APNS_*` settings.
- `server/push/jwt.ts`: the provider token (JWT ES256 signed with the `.p8`,
  renewed every 40 minutes).
- `server/push/payload.ts`: the APNs body and headers.
- `server/push/activity-payload.ts`, `activity-content.ts`,
  `activity-devices.ts`, `activity-hub.ts`, `activity-frames.ts`: Live
  Activity push payload, content-state, token store, send hub and frame
  mapping.
- `server/push/apns.ts`: HTTP/2 to APNs with Node's `http2`, no dependency.
- `server/push/devices.ts`: each person's devices in
  `<data>/push-devices/<principal>.json` (mode 0600). A device APNs answers
  410 Unregistered, or 400 BadDeviceToken / DeviceTokenNotForTopic, is
  removed.
- `server/push/frames.ts`, `server/push/hub.ts`: which live frames become
  pushes, the decision, the sends.
- `server/routes/push-devices.ts`: `POST`, `GET`, `DELETE /api/push/devices`
  (the signed-in person's own devices only; tokens are masked in every
  answer and every log line).
- `server/routes/push-activities.ts`: `POST`, `GET`, `DELETE
  /api/push/activities` (Live Activity tokens for the signed-in person).
- `ios/Sources/CompanionCore/Push.swift`, `ios/App/PushRegistrar.swift`: the
  phone registers its token with the server it is signed in to at every
  launch, when the token changes, when another server becomes active and
  when Settings > Notifications changes; it removes it on sign-out. A tap
  opens the conversation; a nudge received in front shakes and rings like
  the in-app nudge, once; a push wakes the app for a moment
  (`content-available`) to recount the icon badge.
- `ios/Sources/CompanionCore/LiveActivityPush.swift`,
  `ios/App/LiveActivities.swift`: ActivityKit `pushType: .token`, token
  registration for update and push-to-start.
- `ios/NotificationService`: Notification Service Extension. A
  `mutable-content` push downloads the avatar and attaches
  `INSendMessageIntent` so the banner uses the bot's name and face.

The APNs hosts appear only in the server bundle: `check:no-phone-home`
refuses `api.push.apple.com` and `api.sandbox.push.apple.com` everywhere
except the server's host table in `dist-server/`.

## Creating the APNs key (once, Apple Developer portal)

1. Sign in to https://developer.apple.com/account with the Apple Developer
   team (Team ID `<APPLE_TEAM_ID>`).
2. Certificates, Identifiers & Profiles > **Keys** > **+**.
3. Name it (for example `Sagax APNs`), check **Apple Push Notifications
   service (APNs)**, Configure: environment **Sandbox & Production**, then
   Continue and Register.
4. **Download** the `AuthKey_XXXXXXXXXX.p8` file. Apple lets you download it
   only once: keep it in the password vault.
5. Note the **Key ID** (10 characters, shown on the key's page and in the
   file name).
6. Identifiers > `ca.pulsatrix.sagax`: check that **Push Notifications** is
   enabled (Xcode's automatic signing usually turns it on with the
   `aps-environment` entitlement; check after the next archive).
7. On the same App ID, enable **Communication Notifications**. Create (or
   let Xcode create) the extension App ID `ca.pulsatrix.sagax.notification`
   and enable Communication Notifications there too. Regenerate the
   development and distribution provisioning profiles after that, or let
   automatic signing refresh them on the next archive.

Important: an APNs key is **not** the App Store Connect API key, even though
both are `.p8` files from the same account. The App Store Connect key
(Users and Access > Integrations, used by `asc` and `altool`) signs tokens
APNs does not accept: APNs answers **403 InvalidProviderToken**. The server
logs that case once with this hint.

TestFlight and App Store builds use the **production** APNs environment.
Only a build run from Xcode on a device uses sandbox. The phone sends its own
environment when it registers and that one wins over
`SAGAX_APNS_ENVIRONMENT`. One APNs key serves both environments.

## Server settings

| Variable | Value |
| --- | --- |
| `SAGAX_APNS_KEY_PATH` | the `.p8` file, mounted read-only |
| `SAGAX_APNS_KEY_ID` | the 10 character Key ID |
| `SAGAX_APNS_TEAM_ID` | `<APPLE_TEAM_ID>` (the team's 10-character id) |
| `SAGAX_APNS_BUNDLE_ID` | `ca.pulsatrix.sagax` (the default) |
| `SAGAX_APNS_ENVIRONMENT` | `production` (the default) or `sandbox` |

Without `SAGAX_APNS_KEY_PATH` and `SAGAX_APNS_KEY_ID` the server sends
nothing: phones still register, and the first push that would have gone out
logs one line `push: APNs is not configured (...)`; after that, quiet. With
them, startup logs `push: APNs on (...)`.

## On the production VM (Perspicax infra)

The Sagax container already reads its secrets from
`<INSTALL_ROOT>/secrets/sagax` (mounted at `/run/secrets/sagax`, files
`root:10002` mode 0440, the container has group 10002), filled by
`infra/scripts/vm-bootstrap.sh` from the Key Vault. The APNs key follows the
same path. These changes belong to the Perspicax repository and are applied
by the orchestrator, not by this pull request.

1. Put the key in the Key Vault (isolated `az` profile of Perspicax):

   ```sh
   export AZURE_CONFIG_DIR=~/.azure-org
   vault=$(az keyvault list --resource-group <RESOURCE_GROUP> --query '[0].name' -o tsv)
   az keyvault secret set --vault-name "$vault" --name sagax-apns-key-p8 \
     --file AuthKey_XXXXXXXXXX.p8 --encoding base64 --output none
   az keyvault secret set --vault-name "$vault" --name sagax-apns-key-id \
     --value XXXXXXXXXX --output none
   ```

2. `infra/runtime/docker-compose.yml`, service `sagax`, under
   `environment:` (after `SAGAX_GITHUB_CLIENT_ID`):

   ```yaml
      # APNs pushes to the Sagax phone app (Sagax docs/ios-push.md). The key
      # file is written by vm-bootstrap.sh from the Key Vault; an empty
      # SAGAX_APNS_KEY_ID means no pushes (one log line).
      SAGAX_APNS_KEY_PATH: /run/secrets/sagax/apns_key.p8
      SAGAX_APNS_KEY_ID: ${SAGAX_APNS_KEY_ID:-}
      SAGAX_APNS_TEAM_ID: <APPLE_TEAM_ID>
      SAGAX_APNS_BUNDLE_ID: ca.pulsatrix.sagax
      SAGAX_APNS_ENVIRONMENT: production
   ```

3. `infra/scripts/vm-bootstrap.sh`, inside the Sagax "on" branch, right
   after the `cat >>"$env_file" <<ENV ... ENV` block that writes
   `SAGAX_IDP_VAULT_KEY_FILE`:

   ```bash
     # APNs key for pushes to the Sagax phone app (optional). Key Vault:
     # sagax-apns-key-p8 (the .p8, base64) and sagax-apns-key-id. Written
     # root:10002 0440 like idp_key; never in .env, Compose or a log.
     apns_key_file=$sagax_secrets_dir/apns_key.p8
     apns_key_b64=$(optional_secret sagax-apns-key-p8)
     apns_key_id=$(optional_secret sagax-apns-key-id)
     if [[ -n "$apns_key_b64" && "$apns_key_id" =~ ^[A-Z0-9]{10}$ ]]; then
       printf '%s' "$apns_key_b64" | base64 --decode >"$apns_key_file"
       chown root:10002 "$apns_key_file"
       chmod 0440 "$apns_key_file"
       printf 'SAGAX_APNS_KEY_ID=%s\n' "$apns_key_id" >>"$env_file"
       echo "Sagax: APNs pushes on (key $apns_key_id)"
     else
       rm -f "$apns_key_file"
       echo "Sagax: APNs pushes off (no sagax-apns-key-p8 and sagax-apns-key-id in the Key Vault)"
     fi
     unset apns_key_b64
   ```

4. Deploy as usual (snapshot first), then check the container log for
   `push: APNs on (production by default, topic ca.pulsatrix.sagax, ...)`.

## Checking it end to end

Nothing can be checked end to end without the real key. With the key on the
VM and a TestFlight build:

1. Open the app signed in to production once (it registers: `GET /api/push/devices`
   lists the phone, token masked).
2. Close the app (swipe it away), then from another account send a direct
   message, then a nudge. The phone shows both; the nudge plays the nudge
   sound. A tap opens the conversation.
3. Close the app, then have a bot finish a turn in a thread of yours. The
   banner must show that bot's name as the sender and, when the bot has a
   stored picture, that picture as the icon. Without a picture, the name is
   still the sender and the icon may stay empty or fall back to initials.
   A tap opens that thread.
4. Keep the desktop app open on that conversation while a message arrives:
   no push.
5. Keep the phone app in front, on that bot's conversation (or any screen):
   no banner and no sound. A second phone of yours that is locked still
   gets the push.
6. The server log shows no `InvalidProviderToken`. If it does, the `.p8` is
   the App Store Connect key, or the Key ID or Team ID is wrong.
