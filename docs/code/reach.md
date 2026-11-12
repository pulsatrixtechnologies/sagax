# Reaching the person: mail, phone and notifications

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

## Approval notifications on the phone and the watch (2026-10-29)

One notification per ask, updated and withdrawn in place; the buttons always
there; the question first.

- Id: an approval or a question is its own notification,
  `sagax.r.<thread>.<request>` (`collapseId` in server/push/payload.ts,
  `PushCollapse.identifier` on iOS, the same string for a push and a local
  banner). The conversation's next line keeps `sagax.t.<thread>` and never
  replaces an ask (it used to, and took its buttons away). The push hub's
  grace queue is keyed the same way.
- Withdrawn everywhere: any card patched answered, dismissed or expired, by
  any path (engine, safety hold, a bot's ask, the console) calls
  `withdrawApprovalNotice` once (store `message.patch`): `notify-withdraw`
  to every client (iOS reads it too), and `pushHub.noteSettled(thread,
  request)` sends that ask's devices an alert push under the ask's own
  collapse id (`buildSettledRequest`, passive, no sound, `kind: settled`):
  the Notification Service Extension takes the ask down on the phone and the
  watch and shows nothing. Never the whole conversation.
- Buttons: Allow once and Deny; a question's own choices
  (`Notification.choices`, push `choices`) up to `NotificationChoices.limit`
  (4), past it three and Open; their category is made and registered by the
  extension (or the app, for a local banner) before the banner shows
  (`NotificationCategories`, CompanionCore). The extension always keeps the
  category it chose after `updating(from:)`.
- Answer from a banner or the watch: `NotificationApprovalRunner` (shared
  keychain, in the background); then one quiet line in the conversation's
  place ("Allowed: …", "Answer sent: …"), or a plain banner when it did not
  go through. All in the app's catalog (en, fr, pt-BR).
- Look: title is the bot's name, nothing added; the body says the plain
  question first (`Notification.ask`), then the detail; no subtitle.
  Approvals are priority 10 and time-sensitive. The in-app island
  (`NeedsYouIsland`) sizes to its content (small face, name, question,
  answers never cut off). The Live Activity has no alert of its own (the
  notification is the one buzz) and a `.small` layout for the watch.
- MCP: a conversation an AI client holds (outside agent or hidden) rings a
  phone or a watch for an approval or a question (#1984, 2026-11-04).
- "Needs you" is the server's, shared by every device: a settled card
  (any path) moves its conversation off `waiting-on-you` once no card is
  open there (`settleWaitingActivity`); iOS counts a card it still holds as
  open only while the server says the conversation waits
  (`serverStoppedWaiting`, Updates, island, widgets, banners, badge) and
  reads the server again when it comes back to the front with a kept stream
  (`resyncOnForeground`). Tests: `server/needs-you-settled.e2e.test.ts`,
  iOS `NeedsYouFollowsServerTests`.
- Tests: `server/push/*.test.ts`, `server/notify.test.ts`, iOS
  `ApprovalNotificationTests`. Recipe and physical checklist (still open):
  `docs/verification/approval-notifications.md` (#1708). Simulator and unit
  green are not a device pass.

## Bot email address: Perspicax relay (2026-10-21)

Decision 2026-10-21 (B21, iOS CO5): option 1 of the #943 design note.
Each bot of an organization server has its own address,
`<name>@<inbound domain>`, given and received by Perspicax (the domain, the
inbound provider, MX and the safety rules live there). Mail only wakes a
routine. Wire contract v2 of 2026-10-21 (Perspicax <-> Sagax, Perspicax
#419). Rules, none optional,
covered by `server/mail/bot-inbound-mail.test.ts`,
`server/mail/bot-mail-addresses.test.ts`, `server/routes/bot-inbound-mail.test.ts`,
`server/auth/oidc-rp.test.ts`, `server/org/org-member-api.e2e.test.ts` (M10),
`src/components/bot-settings/BotEmailAddress.test.ts`,
`src/components/TypedTriggers.test.ts` and iOS `BotInboundMailTests`:

- Delivery: `POST /api/org/inbound-mail` (`server/mail/bot-inbound-mail.ts`),
  answered before the session gate and loopback trust, next to the member
  API. The only credential is a console assertion (typ
  `pulsabot-console+jwt`, at most 120 s, single-use `jti`, `aud` this
  server's public origin, `server_id` when linked) whose `act.sub` is
  `perspicax-mail` and whose `body_sha256` claim is the lowercase hex
  SHA-256 of the exact body bytes (compared in constant time with the body
  read; missing or different: 401). That actor is accepted HERE ONLY: the admin API
  (console only) and the member API (`ORG_MEMBER_ASSERTION_ACTORS`) refuse
  it. Order: 401 `unauthorized` (assertion, replay, body digest, solo
  server), 400 `invalid` (body not the contract's, no 64-hex `dedupeKey`,
  over 256 KiB), 404 `no_bot`, 403
  `not_owner` (assertion `sub` is not the owner's Perspicax user id, or the
  bot has no Perspicax owner), 403 `owner_inactive`. Every answer carries
  `X-Sagax-Mail-Api: 1`.
- Then delivery splits on the To address (`shared/routine-mail-alias.ts`
  `planMailDelivery`, 2026-11-01 / reference design 0.71):
  - `name+tag@`: only enabled, unsuspended routines of that bot with
    `mailAlias === tag` wake (`wakeRoutine` → `enqueueWebhook` with a
    synthetic `mail-tag:<routineId>` id, confined like S2). Other bots'
    routines with the same tag never wake. Botmail typed triggers stay
    quiet. No matching routine: `reason: "no_trigger"` and proactive may
    take it.
  - plain `name@`: every ENABLED typed trigger of source `botmail` on that
    bot goes through `WebhookManager.ingest(id, event, dedupeKey)` as
    before. Tag-bound routines do not wake on the plain address.
  Filters, dedupe on Perspicax's `dedupeKey` (the Message-ID is shown, never
  the key), the per-trigger rate, the unfinished-runs cap and the fence are
  the typed triggers' own. 202 `{triggers, delivered, duplicate, ignored,
  reason?: "no_trigger"}`; 429 `rate_limited` only when every target refused
  on its rate. A paused bot's triggers (`disableForBot`) receive nothing.
  Settings: `BotEmailAddress` lists tag routing rows (copy tagged address,
  open the routine). Outbound: unrequested mail sends force a draft card
  (`email-draft-required`); person-asked mail in the owner's turn follows
  Ask / Auto / Full. Attachments stay on the draft. Tests use a fake
  capture mailer (no real send).
- Dedupe window (second review, 2026-10-22): the keys live in the typed
  triggers' delivery ring (`MAX_DELIVERIES`, 2000, in server/triggers/webhooks.ts),
  ONE ring for every trigger of the server, kept in `webhooks.json`. A
  retry of the same mail is caught while its key is among the last 2000
  deliveries of all triggers; past that (a busy server, hours later) a
  retry would run again. Perspicax keeps its own one-hour memory by
  `dedupeKey` and does not re-count a retry. A per-trigger ring was judged
  not worth it here (it changes the persisted shape every trigger shares).
- Source `botmail` (`shared/trigger-sources.ts`, label "Bot email", fr
  "Courriel du bot"; the Outlook `email` source is a different thing):
  `secretMode: "relay"`, no secret and no endpoint. Create and PATCH refuse
  a signing secret, rotate refuses, `/sources/<endpointId>` always answers
  401 for it, the create answer has no `sourceSetup`. Filters: `sender`
  exact or `*` glob on the bare address only, `subject` CONTAINS
  (case-insensitive, `containsFilters`), `keyword` over subject and text.
- Confined runs (S2): a run woken by a `botmail` trigger is confined like a
  guest's turn (`botmailConfined` in server/index.ts, `botmailRunConfined`
  in server/mail/bot-inbound-mail.ts): no shell or WebFetch (`guestConfined`,
  Claude `--restricted`), Ask whatever the bot's level (no Full, no Auto),
  no rule the owner saved and no kept card answers for it, no self-apply.
  An engine that cannot run confined refuses the run. The trigger's owner
  may opt in with `source.allowFullTools` (off by default, a switch with a
  warning in the trigger editor). A webhook run whose trigger is gone is
  confined (fail closed).
- Confinement follows no work out (second review, 2026-10-22), on every
  server, a Cloud home or not: while `botmailConfined(threadId)` holds, the
  internal routes by which a run makes another bot, a room or a new
  conversation act for it answer 403 `botmail_confined`
  (`botmailConfinedInternalRefusal`: ask-bot, delegate-bot,
  coordinate-bots, post-to-room, create-room, manage-room, threads (a
  parallel task), retry-thread, create-bot, team-setup-requests,
  routine-requests, act, settings, approvals). A room turn of a confined
  run is confined too (`roomGuestConfined`). M10 proves the refusals on a
  real server.
- The mail is untrusted data: the run prompt is the owner's instructions,
  then `[BOT EMAIL RULES]` (the sender is not the owner, the email is not a
  request from the owner, answer only through a mail connector's send tool
  and its approval card, #943; SPF and DKIM as Perspicax reported them;
  attachments listed, never attached), then the mail inside
  `[UNTRUSTED BOTMAIL EVENT DATA <boundary>]`, markers defanged. The fence
  shows `sender: <bare address>` and the display name on its own line,
  "Display name (unverified)". Never
  instructions, never a widened permission. Sagax never sends mail for a
  bot from this path; Perspicax never does either (no open relay).
- No message text in a log, an audit row or the trigger's event log
  (`webhooks.json`): the event log row says "Email from <domain>", and one
  admin activity row per accepted delivery, category `webhook`, action
  `bot-mail.delivered`, actor the owner `via: "perspicax-mail"`: the bot,
  trigger counts and the FULL sender address (decision 3), never the
  subject or the text. Confidential threads are not
  touched: a mail starts a routine run in its own thread.
- Addresses: `server/mail/bot-mail-addresses.ts` asks Perspicax
  (`POST /api/v1/pulsabot/inbound-mail/addresses`, link token) for every bot
  with a Perspicax owner in ONE call (at most 500), with `complete: true`
  only when that is every such bot (Perspicax then drops the rows of bots
  not listed), keeps the answer 5 minutes, asks again at once for a bot the
  cached answer did not cover, and re-syncs at once (`resync()`) when a bot
  is deleted or changes owner.
  A 404 (older Perspicax), any refusal, a timeout, a wrong shape or inbound
  mail off: `available: false`. Never logs the token or a body.
- Addresses are OFF by default (decision 1): `enabled: false` until
  Perspicax turns them on. #3294: an address that is not on yet is hidden
  (the bot's settings show no address card; a Bot email trigger reads as
  no address), never shown greyed with a wait for an administrator.
- Owner's change (decision 4): `PUT /api/bots/:id/inbound-mail
  {localPart}` (session): the person acting must own the bot (checked
  here), the format `^[a-z0-9]([a-z0-9.-]{0,38}[a-z0-9])?$` is checked here,
  then Perspicax (`POST .../addresses/{botId}/local-part`, link token,
  `owner_sub` of the person acting) checks uniqueness and reserved names;
  400 invalid, 403 not_owner, 404 no_bot, 409 taken, 429 rate_limited
  (Perspicax's own limit per bot and per owner), else 503, each with a
  readable reason. Sagax allows at most 5 changes a minute per bot and per
  owner (`LOCAL_PART_CHANGES_PER_MINUTE`, counted only when Perspicax is
  asked), else 429 `rate_limited` with `Retry-After: 60`. The cache is dropped; one audit row `bot-mail.address-changed`
  (the bot and its new address).
- App: `GET /api/bots/:id/inbound-mail` (client-scoped, the bot visibility
  check applies) answers `{available, address, enabled, canChange}`.
  Desktop: an "Adresse courriel" group at the top of the bot's Overview
  with a Copy button, Changer for the owner, the rule line, and the waiting
  line when `enabled` is false; nothing at all when not available
  (`BotEmailAddress.tsx`). Trigger editor: "Courriel du bot" shows the
  bot's address where other sources show a URL, no secret, and the full
  tools switch. iOS (CO5): the same card in the bot panel
  (`BotPanelPhone.swift` `emailCard`), copy and the waiting state; the
  change is on the desktop. The address is not an id; it may be shown and
  copied.
- Attachments: metadata only; their bytes come in a later lot.
- Perspicax side (domain, provider, MX, loops, size caps, allowlist,
  rename) is the Perspicax PR; the steps done outside code are listed
  there.

## Bot phone: Perspicax Voice relay (2026-10-26)

Phase 2 of Perspicax Voice (contract `perspicax-voice/1`, Perspicax side in
its own PR). A text or a call on a person's phone line is answered by
Perspicax (Twilio webhooks, IVR, PIN, choice of bot) and relayed here. It
only wakes a routine, like bot email. Covered by
`server/bots/bot-inbound-telephony.test.ts`, `server/auth/oidc-rp.test.ts` and
`src/components/TriggersPanel.test.ts`:

- Delivery: `POST /api/org/telephony/inbound`
  (`server/bots/bot-inbound-telephony.ts`), answered before the session gate,
  next to bot email. Same credential rule as bot email with actor
  `perspicax-voice` (accepted HERE ONLY: admin, member and mail routes
  refuse it) and a required `body_sha256`. Order: 401 `unauthorized`, 400
  `invalid` (not the contract, over 64 KiB, `from` not masked for
  `pin_locked` and `call_rejected`), 404 `no_bot`, 403 `not_owner` (the
  chosen `botId` is not the assertion `sub`'s own), 403 `owner_inactive`.
  Every answer carries `X-Sagax-Telephony-Api: 1`.
- `sms`, `call_request`, `call_summary` go through every ENABLED typed
  trigger of source `telephony` ("Bot phone", fr "Téléphone du bot",
  `secretMode: "relay"`) on that bot via `WebhookManager.ingest(id, event,
  eventId)`: kinds `sms.received`, `call.requested`, `call.summary`; filters
  `sender` (the number, exact or glob) and `keyword`. `call_started`,
  `pin_locked`, `call_rejected` are notices: one admin row, no run. 202
  `{event, notice, triggers, delivered, duplicate, ignored, reason?}`
  (`no_trigger`, `notice`, `duplicate`); 429 only when every trigger refused
  on its rate.
- Dedupe on `eventId`: the triggers' delivery ring (on disk) plus a route
  memory per bot (2000 ids, one day, in memory) that also covers notices.
- The caller's text is untrusted data: owner instructions, then
  `[BOT PHONE RULES]`, then `[PERSPICAX LINE DIRECTIVES]` (the line's
  `directives` as Perspicax sent them, closed values; Sagax adds no rule
  about them), then `[UNTRUSTED TELEPHONY EVENT DATA <boundary>]`, markers
  defanged. A run it wakes is confined like a mail-woken run
  (`botmailRunConfined` covers every relayed source; `allowFullTools`
  opt-in on the trigger).
- No text and no full number in a log, an audit row or the trigger's event
  log: the event log row says "Text from ***0100"; one admin activity row,
  category `webhook`, action `bot-phone.delivered` or `bot-phone.notice`,
  actor the owner `via: "perspicax-voice"`: bot, event, masked number,
  PIN result, trigger counts.
- Texting your own bot (2026-10-29, `server/sms-conversation.ts`): an
  `sms` that is `authenticated` (Perspicax admits only a number listed AND
  verified on the line, in a PIN session) with `person.id` equal to the
  assertion's `sub` (the line owner) is the person themself. It becomes a
  turn of their single conversation with the bot (`conversationOrStart`, the
  one send_prompt lands in; a first conversation is opened, never a
  confidential one), sent as the person through `performAsMember` (actor
  `perspicax-voice`, every check of a typed line), the line marked
  `via: "sms"` ("via text message" under it). When the turn ends, the
  bot's own text replies after that line go back by `voice_sms` (the
  person's own access, to the number it came from), one text of at most
  1200 characters; a card waiting on them is said in one text; after 30
  minutes, one text says the answer stays in Sagax. Nothing retries a send.
  A text (or call request) that lands while a turn runs (#4046) goes through
  the send route's own mid-turn steer, like a line typed in the chat: its
  answer leaves as soon as the bot finished a reply after a model call took
  the line in (`steer.received`), while the turn carries on; an engine that
  never reports it is answered when the turn ends. When the running turn
  cannot take it (queued behind it), one text says at once that the bot is
  finishing a task and the answer will come once it is done; at most one
  such notice (busy or card) per text. A relayed card is never the answer. Log lines
  `sms-conversation: <bot> answered|told <masked number> ... after <n>s`
  carry the delay between the text in and the text out.
  A carrier keyword alone (STOP, START, HELP, ARRÊT, AIDE) is never a turn.
  Anyone else's text, or a turn that could not start, goes to the phone
  triggers as before. 202 `{..., delivered: 1, conversation: true}`.
  Tests: `server/sms-conversation.test.ts`, the route test.

## Reach me: one setting per bot to reach the person outside the app (2026-10-26)

Decision: "un seul cadre « Me joindre » par bot" (the analyses of the
2026-10-26 comparisons: Telegram and WhatsApp per bot, Slack, Teams, SMS,
push with resume). When a question or an approval card waits on a person,
the bot reaches them outside the app the way THEY chose for THAT bot, and
the turn picks up when they answer from that channel. Each person chooses
for themself, for every bot they can see: no admin, no owner check.

- Setting: `shared/reach-me.ts` (`channels`: push, sms, teams, telegram,
  whatsapp; `smsNumber`, the person's own E.164 number; `hours`: always, or
  ranges of days and HH:MM in a time zone, a range past midnight belongs to
  the day it starts). Stored per person and bot in `<data>/reach-me.json`
  (0600, `server/reach-me/store.ts`). No choice saved: push only at any
  hour, the behavior before. Routes `GET/PUT /api/bots/:id/reach-me`,
  `POST/DELETE /api/bots/:id/reach-me/telegram`, `POST/PUT/DELETE
  /api/bots/:id/reach-me/whatsapp` and `POST .../whatsapp/link`
  (`server/routes/reach-me.ts`,
  client-scoped). `sagax_settings` keys `notifications.reachMe` and
  `notifications.reachMeTelegram` (the token is a secret: its card).
- Out (`server/reach-me/service.ts`): `observePushFrame` asks `allowsPush`
  for every card push (push chosen and within the hours; any other push is
  unchanged), then `cardRaised` sends the card through every other channel
  chosen and ready, with ONE reply code for that card (4 characters of
  `REACH_CODE_ALPHABET`, a day at most, gone when the card settles:
  `withdrawApprovalNotice` -> `cardSettled`). Outside the hours nothing
  leaves; the card goes out (push included) when the next range starts if
  still open (`tick`, every minute). A confidential card's words never
  leave the app; a card that needs the person's security key says Allow
  needs Sagax (Deny works from outside).
- Back: a reply counts only when it starts with an open code of that
  person, came through a channel the code was sent through, and for a text
  from the number it was sent to; never "any text from that number". Then
  the answer IS the click: POST `/api/threads/:id/respond` replayed with the
  person's own session (`reachMeRespond`, the Primary Bot's replay), so
  every check of the click applies. The card reads "· via Texto/Telegram/
  Teams" (`answeredBy.via: "reach-me"`, `channel`). A yes/no is one word
  read by Sagax (`readReachDecision`); a question's answer reaches the bot
  inside `[UNTRUSTED REACH-ME REPLY <boundary>]`, markers defanged
  (`fenceReachReply`). Ten wrong codes in 10 minutes per person and channel:
  replies refused for a while. Journal rows `reach-me.*` (category
  `approval`): bot, channel, outcome; never the text or a full number.
- Channels share one contract, `ReachChannel` (`server/reach-me/channel.ts`:
  `status`, `send`; replies come back as `ReachInbound` with the person the
  channel proved):
  - push: iOS APNs as before, plus Android through FCM HTTP v1
    (`server/push/fcm.ts`, `SAGAX_FCM_SERVICE_ACCOUNT_PATH` or `_JSON`,
    never committed; off with one log line when unset). Android devices
    register with `POST /api/push/devices { platform: "android" }`
    (`server/push/fcm-devices.ts`); the app starts Firebase only when the
    build carries its four identifiers (`android/app/build.gradle.kts`, no
    google-services.json). See `docs/android-push.md`.
  - sms (`server/reach-me/sms.ts`): Perspicax Voice with the person's own
    access (`reachMeVoice`: `voice_line`, the number must be one of the
    line's verified callers, masked match, then `voice_sms`). The reply
    arrives on `POST /api/org/telephony/inbound` (PR #1134, event `sms`),
    which must call `reachMeSmsReply` (`server/reach-me/inbound.ts`) before
    its triggers and stop when `handled`. A text costs money: no retry, no
    acknowledgement by text.
  - teams (`server/reach-me/teams.ts`): the person's own engine connector,
    no Graph client, no Teams app. Each step is a confined routine run of a
    bot the person owns (`webhookId` `reach-me-teams`, "Reach me (Teams)" in
    Automations). The send run's ONE Teams post or chat send to the
    person's self chat, carrying its code and no address but theirs, takes
    no extra card (`reachMeSelf`, `autoVerdict` source `reach-me`); every
    other call keeps its rules, a security key, an explicit approval, the
    safety hold and the person's rules included. The reply is read by check
    runs at 2, 6, 15 and 40 minutes (reads only), stopped when the card
    settles; later, the app or another channel answers.
  - telegram (`server/reach-me/telegram.ts`): the person's own bot from
    BotFather, token sealed (`server/reach-me/secrets.ts`, vault key), linked
    by a one-time `/start` code; Sagax polls `getUpdates` only while a link
    or a Telegram card waits; any other chat is ignored.
  - whatsapp (`server/reach-me/whatsapp.ts`, 2026-10-27): the person's own
    WhatsApp Business number (Cloud API): access token and Phone Number ID
    checked with Meta, token and app secret sealed (`secrets.ts`). Their own
    number is proven by a code: `SAGAX <code>` sent from WhatsApp (wa.me
    link, through the webhook) or the code by their template typed back
    (`POST .../reach-me/whatsapp/link`). Out: plain text inside the 24 h
    window (their last message), else their approved template (name and
    language set by them, one body parameter). The template is read at Meta
    (`checkTemplate`: GET `<WABA>/message_templates`, free, sends nothing;
    WABA ID asked on the page) on save and after a send refused for its
    template (codes 1320xx); `templateCheck` keeps state, status,
    category, parameters. A template set but not `approved` keeps the
    channel `ready: false` with a reason saying what to do. Back: webhook receiver path
    `/reach-me/whatsapp/<rmwa_...>` (`server/triggers/webhook-ingress.ts`
    `receivers`): GET answers the verify token, POST needs
    `X-Hub-Signature-256` with their app secret, their Phone Number ID and
    their proven number; the code must have gone to that number
    (`ReachCode.whatsappTo`). Needs `SAGAX_WEBHOOK_PUBLIC_URL` for replies;
    without it, send only. Every message is billed to their Meta account:
    mocks only in tests. `sagax_settings` key `notifications.reachMeWhatsApp`.
- UI: "Me joindre" on the bot's Overview, under its email address
  (`src/components/bot-settings/BotReachMe.tsx`); no id on screen (the
  Telegram bot by its @username). iOS: Settings > Bots > Reach me
  (`ios/App/Features/Settings/ReachMeSettingsPage.swift`, contract and draft
  in `ios/Sources/CompanionCore/ReachMe.swift`), a bot picker then the same
  channels, Telegram link, hours and zone; WhatsApp is offered when the
  server's channel answer wires it (#1247), its number connected on the
  computer; the companion allows the four routes. The Primary Bot also changes it from any chat (`sagax_settings`).
- Notices (2026-10-29): `ReachMe.notice` tells the person something
  without asking (the background brief). Same channels and hours as the
  cards (no setting saved: a push), no reply code (`kind: "notice"`,
  `composeReachText` adds no "reply" line), one send per notice id, held
  until the next range outside the hours.
- Background brief on a timer (2026-10-29,
  `server/proactive/background-brief-schedule.ts`): every minute the server runs a
  bot's read-only pass once a day at the person's time (`at`, `timeZone`
  in `background-brief.json`, catch-up window 3 h, the day taken before
  the reads). On by default for a Primary Bot; the person turns it off or
  moves its time on the bot page (`BackgroundBriefCard`). Anything new is
  posted as one bot message in their own conversation with the bot and
  sent as a notice; a pass with nothing new sends nothing.
- Tests: `shared/reach-me.test.ts`, `server/reach-me/*.test.ts`,
  `server/routes/reach-me.test.ts`, `server/push/fcm.test.ts`,
  `server/routes/push-devices.test.ts`, `server/approvals/auto-approve.test.ts`,
  `src/components/bot-settings/BotReachMe.test.ts`,
  `src/lib/no-visible-ids.test.ts`, Android `FcmMessageTest`. Captures:
  `node scripts/capture/reach-me.mjs`. Doc: `docs/reach-me.md`.

## Mail settings

Settings > Email (`src/components/MailSettings.tsx`, `server/mail/mail-routes.ts`,
`server/mail/mail-config.ts`, field ids in `shared/mail-settings.ts`) configures
the mail of a solo server. Keep these rules, each covered by a test in
`server/mail/mail-routes.test.ts` or `server/mail/mail-config.test.ts`:

- `GET /api/mail/settings` never returns a secret or any part of one: a
  password, API key or key secret is only `configured: true|false`.
- The routes are admin scope only (not in `CLIENT_ALLOW`) and answer 403
  `identity_perspicax` on an organization server.
- `POST /api/mail/test` takes no fields, sends only to the caller's own
  address and is rate limited.
- Saved values live in `config.json`'s `mail` block through `saveConfig`
  (never a generic `PUT /api/config` patch) and win over `SAGAX_MAIL_*`, which
  only provides defaults.
- A sender always has a name (default `Sagax`); Twilio refuses one without.
- Tests and fixtures use fake credentials only.

On an organization server Settings leaves Email out (Perspicax manages the
organization's mail; `organizationHidesSection` in `SettingsModal.tsx`).

## Messages and lifecycle hooks (2026-10-21)

Messages (iMessage and SMS) run only in the solo Sagax process on the Mac
where that process runs (`shared/imessage.ts`, `server/imessage/imessage-mcp.ts`).
The Use Messages switch is `messages.json` in the data dir. Sends to someone
on the bot's allowed recipients go through. Everyone else gets a card.
Group chats are refused. Since 2026-11-06 an organization server reaches the
person's Mac through the desktop bridge `mac_app` action (see "Apple apps of
This Mac" below); the old `read_messages` / `send_message` stay solo only.
An image attached to a message is named on the read and returned by
`read_attachment` only when the file is inside the Messages folder and
at most 1.5 MB (`server/imessage/imessage-db.ts`). A file is sent only from the
bot's own folder, by iMessage, and the card shows the file's name, not
its path.

### Connect apps > Mac > Messages setup (2026-11-02)

Setup lives under Connect apps > Mac > Messages (Installed shows a "This Mac"
section). Structure matches the reference design Mac Messages surface; Sagax words and
branding only (`docs/design/ux-reference-grokbot-cursor.md` §2.8bis).

- Live permission checks: Full Disk Access (read `chat.db`) and Automation
  (send via the Messages app). Electron opens the matching Privacy panes
  (`Privacy_AllFiles`, `Privacy_Automation`).
- Test reads recent conversation **names** and returns a count only; logs
  never include message bodies (`POST /api/messages/test`).
- Enable switch stays **off** until the person turns it on. After that,
  `read_messages` / `send_message` are available on that Mac only. Sends still
  follow approval level and allowed recipients. No admin gate for a person's
  own enable; org Ask/Deny and person isolation stay.
- API (solo darwin only; else 404): `GET`/`PUT /api/messages`,
  `POST /api/messages/test`, `POST /api/messages/permissions/open`. Shared
  helpers: `shared/mac-messages-setup.ts`, `server/imessage/imessage-permissions.ts`.
- Computer Settings keeps a shortcut that deep-links to this setup
  (`sagax:open-mac-messages`). iOS mirrors the same Installed > This Mac >
  Messages flow (`ios/App/Features/Plugins/MacMessagesSetupView.swift`).
- Gallery: `src/gallery/mac-messages.html`
  (`?view=setup|mac|app&app=<id>&state=off|ready|enabled|unavailable|server|error`).
  Captures: `node scripts/capture/mac-messages.mjs`.
- 2026-11-06: the loaders throw instead of returning null. A 404
  `messages_not_on_this_mac` / `mac_apps_not_on_this_mac` (organization
  server) falls back to the desktop app over IPC (`window.ogb.macApps`), else a
  readable error with Retry. The page is never blank
  (`src/lib/mac-messages-setup.ts` `viaServerOrDesktop`).

### Apple apps of This Mac (2026-11-06)

Plugins > Installed > This Mac lists Messages, Mail, Calendar, Contacts,
Reminders and Notes, one row each, each with a setup page (permission state,
Open System Settings, test, On/Off). The section shows only in the desktop
app on macOS (`shared/mac-apps-setup.ts` `macAppsSectionVisible`), never on
Windows, Linux or the web.

- Tools (`electron/mac-apps.mjs` `MAC_APP_TOOLS`, single `_` names):
  `mac_messages_read/send`, `mac_mail_search/read/send`,
  `mac_calendar_list/create`, `mac_contacts_search`,
  `mac_reminders_list/create`, `mac_notes_search/create`. Read and write.
- Solo: the imessage MCP lists the tools of each app turned on
  (`mac-apps.json` in the data dir; Messages keeps `messages.json`). A write
  follows the bot's approval mode: Auto/Full run it, Ask stages a card.
- Organization server: the server tools map to the desktop bridge action
  `mac_app` (`server/desktop/desktop-bridge-tools.ts`); Electron main checks the
  app is on in its own `mac-apps.json` (userData) and runs it. The bridge
  journal keeps the operation and the target (recipient, calendar, list),
  never the content. Setup is read over IPC (`mac-apps:status|set|test|open-settings`).
- Organization server, any engine or computer (2026-11-06): the desktop
  reports the apps On (`POST /api/desktop-bridge/<id>/mac-apps {on}`, on
  connect, every system refresh and after each switch). The server keeps the
  list per person (`desktop-mac-apps.json`, kept while the Mac is offline)
  and mounts the `messages` MCP for that person's bots in every sandbox and
  engine, listing the `mac_*` tools of each app On. A call is relayed through
  the bridge (`relayMacAppCall`). Mac offline: the tool stays listed and
  answers "Your Mac is offline" (`MAC_OFFLINE_MESSAGE`), never a missing tool.
  A bot with an On app never says it has no Calendar, Contacts, Reminders,
  Notes, Mail or Messages tool: it calls it and reports the answer.
- Scripts are constant JXA texts; the arguments go as one JSON argv
  (`macAppArgv`, `osascript -l JavaScript -e <script> <json>`), never
  concatenated. Messages reads `chat.db` with `node:sqlite` (read only).
- API (solo darwin only; else 404 `mac_apps_not_on_this_mac`):
  `GET`/`PUT /api/mac-apps`, `POST /api/mac-apps/test`,
  `POST /api/mac-apps/permissions/open` (`server/routes/mac-apps.ts`).

Plugin lifecycle hooks are stripped from the folder Claude loads with
`--plugin-dir`. The commands are kept under `bot-plugins/<bot>/computer-hooks/`
and run only when the owner turns them on, on the bot's computer (sandbox,
the person's PC, or the solo machine). They never run in the Sagax server
process and never on an organization server's own host
(`server/hooks/lifecycle-hooks.ts`).

## iOS communication notifications (2026-10-11)

A closed-app APNs push from a bot (or a person) is an iOS Communication
Notification: the banner names the bot and shows its avatar, not the Sagax
app icon (`docs/ios-push.md`). The server sets `aps.mutable-content` and
`senderName` / `senderId` / `avatarUrl`; the Notification Service Extension
(`ios/NotificationService`) downloads the avatar with the pairing bearer and
donates `INSendMessageIntent`. The App ID `ca.pulsatrix.sagax` and the
extension App ID `ca.pulsatrix.sagax.notification` need the Communication
Notifications capability in the Apple Developer portal. Tests:
`server/push/payload.test.ts`, `server/push/frames.test.ts`,
`ios/Tests/CompanionCoreTests/PushTests.swift`.

While the Sagax app is in front, APNs must not banner or sound: the live
stream already showed the line. `userNotificationCenter(_:willPresent:)`
returns `[]` when the app is active. The phone names its APNs token on
`GET /api/events` (`x-sagax-push-token`); the hub skips that device and
still pushes the person's other phones. Tests: `server/push/hub.test.ts`,
`server/push/devices.test.ts`,
`ios/Tests/CompanionCoreTests/PeoplePresenceTests.swift`.
