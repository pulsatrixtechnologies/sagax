# Files and media convergence evidence

Lot 4 remains in progress. This package qualifies attachment upload,
desktop staging recovery, web large-file streaming, the make_video provider
and native iOS attachments through synthetic fixtures and headless builds. It
does not qualify a deployed proxy, browser codec support on physical devices
or physical devices.

Implemented:

- Documents, audio and archives accept 250 MB; videos accept 1 GB. Shared
  pictures keep their 32 MB limit and solo pictures keep 90 MB. Pictures in
  one message share a 200 MiB budget with at most 32 images on every host;
  the server turn admission previously allowed only 4 pictures, so the count
  rises to the native composer's 32 while other files keep no per-message
  count. The web composer refuses the picture that would exceed the budget
  before uploading it and shows the reason in its attachment notice.
  Aggregate attachment storage is 8 GB with no silent eviction.
- Browser files larger than 4 MB use 4 MB resumable requests with durable
  status, commit and cancel phases. Smaller files keep the idempotent single
  request path. The private committed identity is an HMAC of the authenticated
  owner and upload id, using the persisted media key in a separate domain.
- Offset acknowledgements follow fsync. Interrupted chunks roll back to the
  last acknowledged offset. Commit follows content checks and keeps the
  normal encryption owner. Quota reservations grow with bytes received, not
  the declared 1 GB ceiling.
- A lost response can replay the same commit. Recovery validates existing
  committed size and digest, opens a sealed commit for raw finalizers, and
  keeps fresh commits plain throughout finalization. Finalization, cancel and
  archive cleanup share the upload session lock.
- Archive recovery removes only exact extraction partials and torn manifest
  temps for the generated upload. Startup and the bounded receipt sweep visit
  only commits whose digest exists without a completed receipt. A same-id
  replay also recovers after the receipt expires.
- Removing a failed or completed large upload cancels its durable server
  session. Completed tasks release the browser File and retain only a small
  cancellation handle. Accepted sends forget that handle. Failed-send retry
  and discard carry the original attachment identities.
- Clamd streaming pauses the file source on socket backpressure, resumes on
  drain, and destroys the source on result, error or timeout.
- User sandbox and desktop staging stream bounded chunks. The server and the
  desktop app now accept staged offsets through the 1 GB video ceiling; the
  former 100 MB server schema and 90 MB desktop ceiling are removed.
- Message-authorized files now use the durable transport ceilings on their
  plaintext size: 250 MB for documents and audio, and 1 GB for video. Cipher
  container overhead does not make an exact-limit encrypted file fail.
- The exact-message route resolves a visible file to an opaque same-origin
  GET without returning its host path. The GET checks current thread and
  person access again, supports one byte Range, answers 206 or 416 with the
  standard seek headers, and decrypts only the intersecting 64 KiB chunks.
- Video elements stream and seek from that opaque URL. Large downloads use a
  one-byte authorization preflight and then the browser download manager;
  neither path builds a whole-file Blob. The UI says when the download has
  started rather than claiming that all bytes already reached disk.
- Provider media proxy responses forward Range, Content-Range and
  Accept-Ranges through the 1 GB response ceiling. The proxy pauses upstream
  on downstream backpressure, resumes on drain, stops upstream when the
  player closes, and bounds the wait for response headers.
- Range-capable responses (conversation files and voice notes) send
  `Cache-Control: no-transform`, and the companion sidecar preserves it while
  still forcing private/no-store. Caddy's `encode` honors no-transform and
  never encodes 206 (checked against Caddy's encode.go on 2026-11-01), so the
  shipped Caddyfiles (`deploy/`, `install.sh`, `server/caddy.ts`,
  `server/fleet.ts`) and an external Caddy front keep exact lengths and seek.
  The Electron companion origin gateway and the companion proxy pass Range,
  206/416 and seek headers byte for byte. Provider media proxy responses also
  carry no-transform. A bot's `attach_file` copy of a video now uses the 1 GB
  ceiling instead of the 250 MB document ceiling.
- PDF, gallery audio and old-server compatibility previews intentionally keep
  their independent 25 MB shared and 90 MB solo memory limits. Save a copy is
  explicit. A format without a streaming preview answers 415 rather than
  claiming that it can be previewed. Existing archive path, link, depth,
  ratio, file count and unpacked-size rules remain.
- Personal uploads add no administrator or approval gate. Organization
  Ask/Deny policy, person isolation and sensitive path rules remain intact.

Verification for this package:

- 451 tests passed across 11 targeted unit and UI files covering browser
  lifecycle, drafts, Composer dispatch, store regressions, content checks,
  actual-byte quota, sealed crash recovery, archives, staging and desktop
  bridge validation.
- 34 tests passed across 5 focused HTTP, archive, startup and authorization
  fixture files. This includes a real server restart, same-receipt replay,
  authorized download, HMAC path non-predictability, and status/cancel/GET
  isolation between two organization principals. Fixtures use synthetic
  users, homes, files and engines only.
- 34 Electron desktop bridge tests passed. A sparse staged file continues
  beyond 100 MB without buffering that file in memory, while ordered-chunk
  and protected-path checks remain green.
- Typecheck passed for app, server and gallery projects. No full suite,
  native build, deployment, publish or physical-device test ran in this
  implementation worktree.
- Existing web capture evidence remains under
  `docs/screenshots/grok-convergence-uploads/README.md`. The root integration
  owner is performing the separate real macOS and iOS visual comparison.
- Focused large-media fixtures add a real sparse 1 GB file with a tail seek,
  an encrypted range spanning at-rest chunks, opaque URL resolution, 416,
  provider Range forwarding, timeout and cancel, and the same URL refused to
  a second organization principal.
- Final rerun on 2026-11-01 (this worktree): 786 tests passed across 22
  touched files (server media proxy, message file, media widgets, index,
  turn images, bot attachment, attachments, thread files, browser upload and
  draft libraries, gallery, preview, Files pane and media DOM, companion
  proxy/routes, thread-files and organization resume e2e). 32 more passed in
  the archive, member-identity and organization-permission e2e consumers of
  the message file route and the viewers DOM test.
  `server/authz-matrix.e2e.test.ts` failed at collection on unclassified
  slots already present in the 0.8.23 release; fixed at integration. Typecheck and
  `generate-locale --check` pass.

Remaining in Lot 4:

- Packaging an updated desktop app, deployed proxy qualification (a live
  Caddy, Fly or Cloudflare tunnel in front of a running server was not
  exercised; compatibility rests on source review and fixtures), full release
  gate, physical-device seek evidence, and codec compatibility on the target
  macOS and iOS versions.
- The Perspicax control-plane proxy for AKS sandboxes lives in another
  repository and was not inspected here. It must forward Range and keep
  no-transform responses unencoded.
- Done at integration: `server/attachments.test.ts` keeps the native
  `AttachmentPolicy` picture budget, count, file and video ceilings equal to
  the server's.
- Provider request size with 32 scaled pictures (up to 3.75 MB each) has not
  been measured against each engine's request ceiling.

This package is ready for independent review and integration. It is not a
release, deployment or claim that the full six-lot convergence goal is done.

## make_video on a real provider (branch feat/grok-convergence-video)

`make_video` no longer answers with a provider gap. It dispatches to xAI's
asynchronous Videos API (`grok-imagine-video-1.5`, documented
`POST /v1/videos/generations` then `GET /v1/videos/{request_id}`), checked
against docs.x.ai on 2026-11-01. Native engine producers
(`image_to_video`, `reference_to_video`) stay available and preferred where
the engine offers them.

Implemented:

- Person-scoped credentials: solo uses the installation's xAI key; on an
  organization server the speaker's own sealed xAI account first, then the
  organization key only through the existing explicit `xaiImage` media grant
  (now worded "images and videos"). A recovered job never changes payer.
  No new admin gate, approval card or disabled default; `make_video` is an
  `own` permission, so org Ask/Deny rules apply unchanged.
- Actions generate, status, list (20 per page), cancel and retry. The default
  idempotency key is the person's request, so an engine failover or a fresh
  capability never pays twice; an explicit `request_key` reuses a job across
  turns. A lost POST acknowledgement becomes `unknown` and is never resent.
- Durable journal under `video-jobs/` (at-rest sealed like other content):
  no prompt, image, key or signed URL. Written before the billable POST. A
  crash during the POST reads back as `unknown`; a crash after the
  acknowledgement resumes polling on restart. A paused job keeps its receipt
  and resumes only on retry.
- Poll states: pending, done, failed (with xAI `error.code` mapped to plain
  advice), the `expired` state shown in xAI's overview, moderation
  (`respect_moderation: false`); an unrecognised state stays pending, never
  success. Download streams through the media destination guard (pinned DNS,
  redirect rechecks, no Authorization header), requires real MP4 bytes and is
  stored through `saveFile` under the person's quota and encryption owner.
- Progress and receipts in the conversation itself: one row per job (a card
  with a progress bar in a direct conversation, text in a room), updated per
  state change or 5 % step, worded in the person's language (French or
  English). The finished MP4 replaces that row, served through the normal
  conversation file route and independent of xAI's temporary URL. Stop,
  failure, expiry and pause leave a receipt row; Stop says xAI has no
  cancellation and may still bill.

Review fixes made on the stopped worker's checkpoint: wrong `Message` import
(typecheck failed), poll schema rejected `expired` and xAI's `error` object
(a job would have paused forever), no user-visible progress or failure row,
restart re-polled every paused job, a redundant spread caught by lint.

Verification for this step (worktree `sagax-grok-video`, 2026-11-01):

- `pnpm typecheck` (app, server, gallery): pass.
- `oxlint --deny-warnings` on the touched server files: pass.
- `node scripts/generate-locale.mjs --check`: valid; only the French string
  of the one changed key (`keys.xai.descVoice`) was re-signed.
- 10 test files, 99 tests passed: `server/video-provider.test.ts`,
  `video-generation.test.ts`, `video-credentials.test.ts`,
  `video-source.test.ts`, `video-status.test.ts`,
  `drivers/agents-video.test.ts`, `drivers/agents-catalog-wire.test.ts`,
  `scripts/control-omb.test.ts`, `video-generation.e2e.test.ts` and
  `video-generation-restart.e2e.test.ts`.
- The two e2e files boot the real isolated server with a synthetic person,
  bot and key and an owned loopback stand-in for xAI. They prove: real tool
  dispatch, progress row, one POST despite duplicate calls and a new
  capability, MP4 attached once and served after the provider is gone, the
  401 without a capability, image references limited to the person's own
  attachment, Stop reaching a running job with its receipt row, a SIGKILL
  after acknowledgement followed by restart, resumed polling and the
  progress row replaced by the MP4, and an `expired` receipt row.

Remaining for make_video (not blocked by code in this branch):

- No call against the real xAI service: it needs a real, billable xAI API key,
  which tests must not use. First live generation is JC's to run.
- Deployed egress proxy: the API calls use Node `fetch` and the MP4 download
  uses a pinned direct socket; a host that only reaches the internet through
  an HTTP proxy is not qualified.
- Visual check of the progress card and video row in the macOS app and native
  iOS rendering of the server-written card (iOS out of scope here).
- Remote cancellation does not exist in xAI's documentation; Stop ends local
  polling only and says so.

## Native iOS attachments (2026-11-01)

Branch `feat/grok-convergence-native-upload`, which also carries
`feat/grok-convergence-native-fixture` (demo Library, Pages preview and
demo resumable uploads). This section qualifies source, unit and headless
build evidence only, not a physical device.

Implemented:

- The composer and the Share extension upload through
  `CompanionCore/AttachmentUpload.swift` against the existing authenticated
  `phase=status|chunk|commit|cancel` routes. Picked files stay on disk as
  protected app-owned copies; at most two transfers read one 4 MiB chunk
  each. One UUID per attachment survives retry, relaunch and handoff, so a
  lost chunk or commit reply never stores a second file.
- Progress per chip and in the Share sheet. Pending or failed chips hold
  Send. Remove cancels the transfer and sends `phase=cancel` from an
  independent task with the original connection; the server keeps a file
  still referenced by a transcript.
- Retry: transient failures (network, 408/409/425/429, 5xx) retry in place
  after 1, 3 and 8 s, reading the durable offset first. A changed local
  file, an unusable offset or receipt, and definitive 4xx are not retried.
  The visible Retry keeps the same UUID and acknowledged offset.
- Durable outbox: `AttachmentTransferJournal` keeps draft files, draft text,
  offsets, receipts and the exact accepted send (body, SendOptions, sendId,
  reply/page/busy routing) under complete-until-first-unlock protection, with
  a cross-process lease and a cancellation tombstone. Share sends are
  journaled in the App Group before any network work; the containing app
  drains them on launch, foreground and reconnect with the original pairing.
  A replay after an ambiguous reply reuses the sendId (no duplicate message).
  A cancelled job releases its server copy; a refused delivery leaves the
  outbox and the composer draft keeps its chips.
- No total deadline: the former 90-second Share budget is gone. Each 4 MiB
  request has its own 150 s timeout. `SagaxTransferActivity` holds an
  expiring-activity assertion in the app and the extension while a transfer
  runs; when iOS ends it, the journal resumes from the acknowledged offset.
- Limits aligned with desktop and server: 200 MiB image aggregate, 32 MiB
  shared and 90 MiB solo pictures, 250 MiB documents, audio and archives,
  1 GiB video. The Sagax count of 32 items is kept (previously 4 on iOS,
  Share activation rules raised to 32 including movies). Photo Library and
  Files accept video, audio and archives.
- Quick Look/Share of a received file downloads to disk through the same
  message-scoped route, so a 1 GiB video is never buffered in memory.
  Automatic thumbnails keep their separate buffered ceiling.
- No administrator or approval gate added. Organization Ask/Deny rules and
  person isolation stay with the server.

Verification (headless, synthetic data only):

- `swift test --filter "AttachmentUploadTests|MessageAttachmentsTests|ShareClientTests|DemoFilesTests"`:
  46 tests passed (macOS host). `DemoModeTests|BrandMascotTests|ModerationTests`
  (Demo.swift neighbors touched by the merge): 21 passed.
- The same 46 tests passed on an iOS 27.0 simulator through
  `xcodebuild test -scheme CompanionCore` on a dedicated simulator created
  for the run and deleted afterwards; no UI was driven.
- `xcodebuild build -scheme Sagax -destination 'generic/platform=iOS Simulator'`
  succeeded, including `SagaxShareExtension`, before and after the merge.
- Covered by tests: lost chunk and commit replies, manual and automatic
  retry from the acknowledged offset, committed-status reuse without reading
  a 1 GiB file, cancellation cleanup with the original UUID, two-slot
  buffer bound with queued cancellation, invalid offset/unsafe receipt,
  policy ceilings, journal reconstruction, Share handoff restart and
  duplicate-free replay, lease exclusion, tombstone cleanup, refused
  delivery removal, and the demo transport end to end.

Remaining for native iOS:

- Physical iPhone/iPad: a real 1 GiB video and a large Files pick through
  a relay or tunnel, app suspension and termination mid-upload, the Share
  extension being dismissed or killed during a transfer, lock screen with
  complete-until-first-unlock files, and memory peaks. Simulator and unit
  tests cannot reproduce iOS suspension, extension memory limits or real
  cellular loss (#1708).
- A true background URLSession that keeps transferring while the app is
  suspended is not implemented; past the expiring-activity window the
  transfer waits for the next foreground or reconnect.
- Visual capture of the progress, failed/Retry and Share sheet states next
  to Grok at the same viewport (Lot 5 native audit).
- Streaming playback of large received media inside the app and deployed
  proxy qualification remain with the rest of Lot 4.
