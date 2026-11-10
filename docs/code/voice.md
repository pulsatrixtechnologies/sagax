# Voice, calls and meetings

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

## A call is a realtime voice session (2026-11-02)

Never text to speech on a call: `GET /voice/realtime` bridges the page to
xAI's Voice Agent API (`server/voice/realtime-call.ts`); the bot's work is the
`work` function, run as an ordinary turn (`server/voice/realtime-call-host.ts`).
No realtime voice means no call, said plainly with the voice settings link;
never restore the dictation plus text to speech call as a fallback. Audio of
a cut response is dropped by response id; a permission is decided from the
person's words, not the model's. `docs/voice-mode-xai.md`, first section.

## iOS composer dictation streams over /voice/listen (2026-10-31, #1695)

The iOS grey mic used to record the whole clip and upload it after the stop
(`SpeechDictation` `.xai`, `POST /voice/transcribe`), so the field stayed
empty while speaking and the wait grew with the recording. It now matches
desktop/web (#1673): audio goes over `GET /voice/listen` (`LiveDictation`),
partials join the field as they come, and the stop only waits for finalize
(at most `DICTATION_FINAL_TIMEOUT_MS`). The whole-clip upload remains the
fallback when the socket cannot open. Apple on-device stays the announced
fallback when no xAI key serves. Tests: `ios/Tests/CompanionCoreTests/LiveDictationTests.swift`.

## Voice recognition: short answers and committed transcript identity (2026-10-30)

Calls accept names, weekdays, commands, single letters and non-Latin words
regardless of length. `isNoiseFragment` (desktop) and `CallNoise.isFragment`
(iOS) reject empty text, explicit hesitation sounds and low-confidence short
transcripts, never words absent from an allowlist. Acoustic noise detection
still belongs to the VAD/echo/speaker checks.

The page tags every listen `finalize` with a bounded `requestId`. OpenAI's
`input_audio_buffer.committed` maps each provider `item_id` to that request;
transcript frames keep the id through `voice-listen-session.ts`. The page
reconciles by request, replacing each segment's partial and assembling probe
segments in audio order, exposing only a contiguous prefix. A timeout with
an incomplete segment uploads the whole audio, never just a prefix/suffix.
OpenAI deltas received before commit are held by item id until the ack
identifies their owner. Late results of retired turns are ignored. xAI and
older clients retain their ordered untagged chunk protocol. A failed OpenAI
transcription closes its socket so the existing reconnect/upload path runs.
Tests: `src/lib/voice-mode/stt-stream.e2e.test.ts`, `server/tts/openai-stt.test.ts`,
`server/voice/voice-listen-session.test.ts`, `src/lib/voice-mode/stt-stream.test.ts`,
`src/lib/voice-mode/call.test.ts`, iOS `VoiceCallTests.swift`.

## A call turn runs fast (2026-10-29)

On a live call every turn (and the warm at call start) runs on a fast model
(`pickVoiceModel`: the bot's fast model, else its engine's fast tier, else
another engine's), in a session of its own started from a short view of the
conversation (summary plus the latest 12 messages, 6,000 bytes,
`server/voice/voice-turn.ts`) and kept warm turn to turn. The call never resumes
or writes the conversation's cursor (`VoiceTurnSessions.noteSession` takes
the call's `session.started`); the next written turn gets the call's lines
(unseen messages, or `callLinesBlock`). Real work goes to `start_thread`
`report_back` on the main model with the conversation in its brief. Call
lines waiting in the queue drain as one turn answering the newest. Events
lines name the model and context; the page posts `state: "heard"` audio
stages. Details: docs/voice-mode-xai.md, "A call turn runs fast". Tests:
`server/voice/voice-turn.test.ts`, `server/voice/voice-fast-turn.e2e.test.ts`.

## Voice providers: OpenAI and ElevenLabs beside xAI (2026-10-29)

Voice mode (calls, read aloud, dictation) is no longer xAI only. A person
picks who speaks (xAI, OpenAI, ElevenLabs) and who listens (xAI, OpenAI:
Realtime transcription `gpt-live-transcribe` for a call and the dictation,
16 kHz resampled to 24 kHz, a commit per turn; `gpt-transcribe` for a whole
recording, `server/tts/openai-stt.ts`) in Settings > Voice (`VoiceProviderSettings`) and, per bot, in
Edit bot > Voice ("Same as my settings" by default). The choice lives in
the synced `omb.voiceMode.v1` (`tts`, `stt`, `voices`, `bots[botId]`,
`shared/voice-providers.ts`); every request sends it (`src/lib/voice-mode/api.ts`
`voiceBody`), and a client that does not (an older page) gets the person's
stored choice on the server (`requestedChoice`). The iPhone keeps the other
fields as they are and speaks with the bot's provider (`VoiceModeSettings.forBot`).
Only providers with a usable key are offered (`status.providers`). Keys: the
person's own (My voice keys, OpenAI added), their Perspicax OpenAI key, the
organization's (`openai.key`, `tts.key`, same grant as its xAI voice), a solo
server's. Adapters: `server/tts/openai-voice.ts`, `server/tts/elevenlabs-voice.ts`
(the person's voices, cloned first); a live call's voice over HTTP streams
behind the same session (`server/tts/http-speech-stream.ts`). A provider that
fails or reaches its limit gives way to the next one silently
(`nextCandidateIndex`, remembered a minute), with a line in Events
(`providerFallbackNotice`), first audio times too. Usage: `openai-tts`,
`elevenlabs-tts` (`voice-cost.ts`). Bot-less routes `/api/voice/(status|voices|speak)`
serve Settings. Telephony (Perspicax Voice) is untouched. Gallery
`src/gallery/voice-providers.html`, captures `node scripts/capture/voice-providers.mjs`.

## Conversation phone calls (2026-10-28)

Decision: a bot can call someone, talk with them in real time and report
back (`place_phone_call` mode `conversation`). Spec: section 10 of
`docs/specs/bot-telephony.md`.

- The call leaves from the speaking person's own Perspicax Voice line and
  Twilio key (`voice_call` with the turn's Perspicax access), after the same
  one-call approval card (number, objective, maximum length, the AI
  disclosure as it is said). The line says the disclosure first; the
  realtime voice is Perspicax Voice's, the same as inbound calls.
- The result comes back as `call_result` on `/api/org/telephony/inbound`,
  accepted only for the person whose line placed that call sid, once. The
  card becomes the result card; the bot gets the result in a new turn with
  the other party's words wrapped as untrusted data.
- The transcript lives on the conversation's message only (sealed with the
  person's content key) and is dropped 30 days after the call; the records
  file keeps metadata, never a word said. A callee who asks to stop goes on
  the person's own stop list for good.
- Tests: `server/outbound-conversation.test.ts`.
- Every call goes through `place_phone_call` (decision of 2026-10-28): a
  bot's own Perspicax `voice_call`, by its name, a server-prefixed name,
  `call_tool` or `use_tool`, is turned into the `place_phone_call` with its
  arguments on the Perspicax relay (`server/perspicax/perspicax-mcp.ts`,
  `voiceToolCall` in `server/telephony-guard.ts`, `placeArgsFromVoiceCall`
  in `shared/outbound-call.ts`): the same card, AI disclosure, pilot and
  do-not-call list. A dry run and the harness's own call go as they are. A
  one-way `place_phone_call` with no `from` leaves from the person's own
  Perspicax Voice line. `voice_sms` is a text like a Twilio Messages create
  (`shared/outbound.ts`): the same card and allowed recipients. Tests:
  `server/voice-call-redirect-parity.test.ts`.

## Meetings: the bot takes notes (2026-10-16)

`join_meeting` (`server/meetings/`, card `meetingRequest`, UI
`src/components/MeetingCard.tsx`, spec
`docs/superpowers/specs/2026-10-16-meetings-and-maintenance.md`). Rules,
covered by `server/meetings/*.test.ts` and `server/routes/meetings.test.ts`:

- Experimental, **off by default**: Settings > Developer > Experimental > Meeting
  notetaker (Google Meet), config `features.meetingNotetaker`
  (`meetingNotetakerEnabled`, server/config.ts). The server enforces it:
  while off, `join_meeting` is not in the agents catalog (`SAGAX_MEETINGS`,
  `agents-catalog-meetings.test.ts`), and the internal route, `/api/meetings/*`
  and the card's answer refuse with 403 `meetings_disabled`. Turning it (or
  the built-in browser) off makes every running meeting leave.

- Every join is the person's own tap on its consent card. Nothing applies it
  for them: no Full access path, no always-allow rule, no Live call answer
  (`liveCardKind` is `review`), not the composer's approval stepper. Direct
  conversations only.
- Nothing is recorded before the consent announcement ("<bot> (transcription)",
  for whom, xAI outside Québec, audio not kept, type "stop") is visible in
  the meeting chat and the chat can be read; otherwise the bot leaves without
  recording (fail closed). It is posted again when someone joins and at least
  every 10 minutes.
- Every poll reads the new chat lines: an objection (the bot's name, a bare
  no, stop, arrête, quitte, leave, recording, consent...; when in doubt,
  leave) makes it leave at once, dropping the audio not yet transcribed.
  Lines written while it announces itself count too. Own lines are left
  out by exact match (what it posted, its own author label), never by
  substring. After an objection nothing is kept: no summary turn, the
  in-memory transcript is dropped and the card shows no lines. After a
  normal end the card's live lines go once the summary turn is asked for.
  Three unreadable polls in a row end the meeting.
- The Perspicax console and `sagax_approve` never answer the card
  (`server/approvals/approval-type.ts` types it `other`).
- One meeting per bot, reserved before any await; at most
  `MEETING_MAX_CONCURRENT` (2) meeting browsers on a server.
- The meeting runs in a private guest browser session per meeting, never in
  the bot's own browser profile. No audio and no transcript file is written:
  the text lives in memory, then in the bot's summary turn. Only
  `DATA_DIR/meetings/live.json` (ids of running meetings, 0600) is kept.
- The transcript reaches the bot's summary turn behind `wrapUntrusted`.

## Voice mode (xAI)

The call button on a bot opens the voice call pill
(`src/components/voice-mode/`), a compact pill centered at the top of the
chat column under the name chip (`VoiceCallDock`, first in ChatView's banner
stack: collapsed it keeps its own 48px row, never covering a message;
Settings or Transcript expand it into a card over the thread that closes on
Escape or a click outside; hold lives in the settings card; states pinned
by `VoiceModeBar.layout.test.ts`; on the desktop this pill is the whole call
UI, no folded row and no full-column stage, restored from 0.4.8 on
2026-10-08 at the maintainer's request; the iPhone keeps its own call screen and the
call card in the conversation, under `ios/`), when `GET /api/bots/<id>/voice/status` says
xAI voice mode serves the person; otherwise a solo Mac keeps the older call
(macOS dictation helper). Keep these rules, each covered by
`server/voice/voice-mode.test.ts`, `src/lib/voice-mode/voice-mode.test.ts`,
`src/components/voice-mode/VoiceModeSettingsPanel.test.ts` or
`electron/app-permissions.node-test.mjs`; real Electron in server mode with a
fake xAI: `scripts/verify/dev/verify-voice-mode.ts`. Details: `docs/voice-mode-xai.md`.

- The xAI key never reaches a client: the server proxies speech to text
  (`/voice/transcribe`) and text to speech (`/voice/speak`, `/voice/voices`);
  no route answers a key or a part of one.
- Hang up: the person ends with `POST /api/bots/<id>/voice/call`
  `{state:"end"}` for that call id. The bot ends with `end_call`, offered
  only on a live call (`SAGAX_VOICE_CALL`). The session stays until that
  turn finishes, so the goodbye is spoken, then the idle warm process is
  released and that person's devices get `voice.call.ended`. A goodbye
  that fails or is interrupted drops the request (`settleEnding`) and
  keeps the call: the next turn is still on it. The next written turn
  after a finished hang-up gets `voiceCallEndedNote`. An old turn cannot
  end a newer call. Tests: `server/voice/voice-call-session.test.ts`,
  `src/lib/voice-mode/call-end.test.ts`,
  `server/voice/voice-call-reliability.e2e.test.ts`.
- Who pays (`resolveVoiceKey`): on an organization server the speaker's own
  `xai` key in Perspicax, else the organization's (Settings > Connections),
  else an access card in that person's bar only (the audience rule of every
  access card, `accessCardAudience`: the speaker; the organization's key hint
  only for an admin; never stored in a thread or sent as a live frame); a
  disabled person is refused. Solo: the server's key. Each request is booked
  with its `access`.
- Every route names a bot the person may use (and a thread they may post
  to); the spoken text goes through the normal send route, never a voice
  route, so attribution and private threads stay those of a typed message.
- The microphone is the window's own (`getUserMedia`), never the macOS
  helper in voice mode, so Windows and server mode work. Electron grants the
  organization server's bundled origin the microphone only
  (`microphoneOrigins`). The bundled page has no dictation bridge: call
  `window.ogb?.speechStop?.()`, never assume it.
- Voice, Speed and Language live in `omb.voiceMode.v1` and travel with the
  person (`shared/user-preferences.ts`). The call's settings and the "Only my
  voice" voiceprint stay on the computer (`omb.voiceCall.v1`,
  `omb.voiceCall.voiceprint.v1`); never add them to the keys that travel.
- A call is a live, full-duplex call (`LiveCall.tsx`, `src/lib/voice-mode/call.ts`,
  states in `call-machine.ts`): Silero VAD and CAM++ speaker verification run
  on the computer (onnxruntime-web, models in `src/lib/voice-mode/models/`,
  served from the app's bundle, never a CDN); a turn streams over
  `GET /voice/listen` (WebSocket, same origin only, bridged to xAI streaming
  speech to text) and the answer is spoken clause by clause over one
  `GET /voice/speech` socket for the call ("Streaming voice", Advanced, on by
  default: `speech-stream.ts`, `server/voice/voice-speech-session.ts`, xAI's
  `wss://api.x.ai/v1/tts` with `optimize_streaming_latency=2`, no 36
  character wait for the first clause, `text.clear` on a cancel), or
  sentence by sentence through `POST /voice/stream` (raw PCM) when it is off
  or fails. Keep its nets: ready within 1.5 s, two errors in a call, a close
  or the server's `fallback` (after 3 reconnects with a 250, 750, 2000 ms
  backoff) switch the call to POST for good, logged once; a clause failed
  before any audio is spoken over POST, one cut mid-way is never said twice.
  Barge-in ducks then cancels the bot's voice and interrupts its running
  turn. "Full-duplex conversation" (Advanced, off by default on every
  channel, `CallSettings.fullDuplex`, rev 3): when the person turns it on
  and the server has `SAGAX_VOICE_FULL_DUPLEX=1`, talking while the bot
  works or speaks cancels that turn, discards the steer queue, and starts
  only the latest utterance (`voiceCall.duplex`, issue #292). Off, the
  page's duplex and speculative marks are dropped and words said while it
  works join that turn. No canned
  tool filler and no tool-chip narration on a call: while the bot works in
  silence the call says a short progress line built from the turn's real
  tool events (`src/lib/voice-mode/progress.ts`, the iPhone's
  `CallProgress`): only the tool's category ("Je vérifie.", "I'm making the
  change.") or the count of finished steps, never its name, arguments or an
  identifier, in the call's language (`tIn`, `voiceMode.progress.*`; a
  language without those words gets none); the first once a tool has run
  1.5 s with nothing said (the quick first line on every engine; the
  model's own parallel opener stays HTTP Grok only, why in
  `server/voice/voice-first-sentence.ts`), later ones after 7 s of silence and
  9 s apart, five a turn; never over the bot's voice, the person's words,
  an open approval or question; a barge-in stops them until the next turn.
  The Mac's older dictation call (`CallView`) and room call
  (`GroupCallView`) use the same planner, never the chip's `spoken` text;
  a room line is in a member's voice only when all the turn's tools are
  that member's (`turnToolAuthor`). The iPhone picks the words of the
  call's language (`CallProgress.language`), not the app's.
  Covered by `progress.test.ts`, `VoiceModeBar.test.ts` and the iPhone's
  `CallConversationTests`. Tests:
  `call-logic.test.ts`, `voice-build.test.ts`,
  `call.test.ts`, `duplex-policy.test.ts`, `speech-fence.test.ts`,
  `speech-stream.test.ts`,
  `models.test.ts`, `server/voice/voice-speech-session.test.ts`,
  `server/voice-call.e2e.test.ts`, `server/voice/voice-call-duplex.test.ts`,
  `scripts/voice-duplex-harness.test.ts`.
- "Faster end of turn" (Advanced, on by default; never in Patient nor push
  to talk): `prosody.ts` reads the pitch and energy of the last 400 ms
  before a silence on the computer; a falling, fading or clearly rising
  contour ends the turn on the short confident window (352 ms in Normal)
  without punctuation, a flat contour on a filler keeps the long delay, a
  French linking word on a finished contour waits half of `incompleteMs`.
  Keep the nets: every frame of the short window under Silero 0.15 (never
  mid-word), and a person who speaks again within 600 ms of a turn ended on
  its contour continues it (`EARLY_CUT_CONTINUATION_MS`), even over the bot's
  first words. Tests: `prosody.test.ts`, `call.test.ts` ("faster end of
  turn").
- Call turns carry `voiceCall` (Message.voiceCall), on every call view: the
  live call and the older macOS call mark them the same way
  (`useVoiceCallMark`, `src/lib/voice-mode/call-mark.ts`, test
  `call-mark.test.ts`); the server adds the
  hidden "Phone call" volatile section (`server/voice/voice-call-prompt.ts`), never
  stored as the person's text. The room call (`GroupCallView`) does not mark
  its turns, on purpose (2026-10-17): one spoken turn there can reach
  several bots (`@everyone`, "everyone, ...", the room's default responder),
  each answering in turn, while a call mark is one bot's: its call session
  (`POST /voice/call` per bot and thread), the `end_call` tool that would
  let one member hang up the whole room, the warm engine and the unanswered
  call recovery that restarts that one bot. Marking room turns needs a room
  call session on the server first (one per room thread, ended only by the
  person), not the bot hook. The call speaks only `spokenPart` of an answer,
  cleaned by `src/lib/voice-mode/spoken.ts`. Tests:
  `server/voice/voice-call-prompt.test.ts`, `server/voice/voice-call-prompt.e2e.test.ts`.
- xAI is only ears and a voice: never its realtime agent, responses, chat or
  function calling. Every turn goes to the bot through the normal send route,
  and only the bot's text is synthesized. The e2e test and
  `scripts/verify/dev/verify-voice-mode.ts` fail on any other xAI path.
- On an organization server (the status says `organization: true`, or the
  viewer is managed by Perspicax) the call button is
  `VoiceModeCallButton`: the server decides (`/voice/status`, asked again at
  every click while unavailable), and the legacy call gate ("Choose This
  computer", macOS dictation) never shows. Unavailable shows the speaker's
  access card (admin: the organization's key hint and "Open Settings >
  Connections"), or the server's error with a retry; a room says voice mode
  talks with one bot at a time. Tests: `VoiceModeCallButton.test.ts`,
  `scripts/verify/dev/verify-voice-mode.ts` (no key, then the admin's key).

- Latency (`docs/voice-mode-xai.md`, "Latency"): every call turn is timed
  under its `utteranceId` on the page (`latency.ts`) and on the server
  (`server/voice/voice-latency.ts`, `[voice-latency]` lines). A thread on a call
  passes `keepWarm` to the engine: the Claude driver keeps one process for
  the call, and Grok (ACP) keeps one process and one native session, the
  per-turn comms token in a file (`SAGAX_COMMS_TOKEN_FILE`,
  `server/drivers/spawn-contract.ts` `warmCommsEnv`), never in the spawn
  contract nor in the ACP `sessionKey`: a Grok call turn is a bare
  `session/prompt`, no `session/load`, no MCP reconnect, and reports
  `reused`. Claude and Grok (`AcpSupport.warmSession`) start that process
  when the call is accepted (`POST /voice/call`; Grok pays initialize,
  authenticate and `session/load` or `session/new`, no prompt); the first
  spoken turn reuses it. If that process exits or fails to spawn during
  the warm, reject its pending ACP requests immediately, without turn
  events; the next spoken turn starts a fresh process (#1717).
  A hangup closes the idle process
  (`releaseWarmSession`). Codex and the API drivers are not warmed (no
  hidden prompt is sent). A call turn and its warm run at the engine's low
  effort (`server/voice/voice-call-effort.ts`: "low", never "none", a bot set
  lower keeps its level, a Codex bot with no effort is left alone); the
  model is unchanged (the call's model tier belongs to Auto, PR #153). The
  call's start and each heartbeat mark the person's server environment
  used (`UserSandboxManager.markUsed`, sandboxd `POST .../used`, starts
  nothing) so its 10 minute idle stop never hits mid-call. Do not put a
  per-turn value in a pooled process's contract or session inputs: it
  relaunches or re-establishes the engine on every turn. Tests:
  `server/voice-call-latency.e2e.test.ts` (Claude and Grok),
  `server/drivers/acp/acp.test.ts` (call session, warm),
  `server/voice/voice-call-effort.test.ts`, `server/voice/voice-call-warmup.test.ts`,
  `server/sandbox/user-sandbox-manager.test.ts`, `call.test.ts` ("latency"), bench
  `scripts/voice-latency-bench.ts` (Claude and Grok).

A change to `server/voice/voice-mode.ts` needs the server image redeployed.

## Voice notes, microphone choice, logs and feedback (2026-10-16)

- Voice notes (+ > Record a voice note, `src/components/useVoiceNoteRecorder.ts`,
  `src/lib/voice-note.ts`): a 16 kHz WAV from the window's own microphone,
  uploaded through `/api/files` like any audio file (`<attached-file>`, name
  `voice-note-<date>.wav`), its words through the dictation route
  (`/voice/transcribe`, cut in clips under `VOICE_MODE_MAX_AUDIO_BYTES`) as
  the message text, then the ordinary send. Five minutes at most. No new
  server route. The transcript shows a recorded note with `VoiceNoteBubble`
  (speed 1x, 1.5x, 2x; jump to a word only when word timings are given,
  which no speech to text of ours returns yet). iOS (`App/Composer/VoiceNoteRecorder.swift`,
  rules in `CompanionCore/VoiceNoteRecording.swift`): touch and hold the
  composer mic to record (release sends, slide left past 80 pt cancels; a
  tap stays dictation), or + > Record a voice note (Cancel and Send). The
  same 16 kHz WAV, name, upload and `/voice/transcribe` clips as the
  desktop; the first microphone prompt turns a hold into a toggle. A sent
  `voice-note-*.wav` plays in the person's bubble through the message file
  route. Tests: `VoiceNoteRecordingTests.swift`.
- Microphone (Settings > Models and voice > Audio, `src/lib/audio-input.ts`):
  one choice on this computer (`sagax.audioInput.v1`, never in the
  preferences that travel) for dictation, voice notes, Live calls and voice
  mode calls; a missing device falls back to the default, a refusal never
  retries. The macOS dictation helper keeps the system input.
- Download logs (General > Advanced > Diagnostics, desktop): one text file
  saved where the person picks (`desktop:export-logs`, local page only):
  the server log window on disk, server.log, this window's console
  (`src/lib/console-ring.ts`, redacted when kept with `shared/redact.ts`),
  the updater log and crash events, every line redacted again by
  `electron/log-bundle.mjs`. Nothing is sent. Send feedback is a mail draft
  to hello@pulsatrix.ca with the version and the system, nothing attached.
  Tests: `electron/log-bundle.test.mjs`, `src/lib/console-ring.test.ts`,
  `src/lib/feedback.test.ts`, `src/lib/audio-input.test.ts`,
  `src/lib/voice-note.test.ts`, `src/components/Composer.voiceNote.test.ts`.

## Sagax in the car: Siri, CallKit, CarPlay (2026-10-30)

Every build: a bot call is a CallKit call whose handle names the bot
(`CarCallHandle`, `sagax-bot:<id>`), Siri handles `INStartCallIntent` and
`INSendMessageIntent` in the app's process (`SagaxAppDelegate.application(_:handlerFor:)`,
`ios/App/CarAssist/SiriIntentHandlers.swift`, `INIntentsSupported`,
`com.apple.developer.siri`), a reply to an announced message goes back to
the conversation the banner donated (`CarDirectory.route`), and a call in a
car (`CarRoute`: CarPlay connected or car audio) asks approvals aloud and
short, a skill waits, nothing says to look at the screen (`DrivingSafety`).
The app, Siri and the car share one Session (`SessionHub.session`). The
CarPlay screen (`CarPlaySceneDelegate`: recent bots, then the voice screen
with mute and hang up) is Apple's voice-based conversational category
(`com.apple.developer.carplay-voice-based-conversation`, iOS 26.4), added
only by `ios/project-carplay.yml` (`xcodegen generate --spec project-carplay.yml`)
once Apple grants it; never put that entitlement in `project.yml`. Never show
a message's content on the car's screen. Tests:
`ios/Tests/CompanionCoreTests/CarAssistTests.swift`. See `docs/ios-carplay.md`.

The main app's localized `ios/App/{Base,en,fr,pt-BR}.lproj/AppIntentVocabulary.plist`
files supply example phrases for both supported Siri intents. Keep each
locale aligned with `App/Localizable.xcstrings`; Base is the English fallback.
