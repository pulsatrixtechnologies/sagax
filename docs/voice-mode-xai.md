# Voice mode with xAI

## A call is a realtime voice session (2026-11-02)

The maintainer's decision: a voice call is never text to speech. It runs on
the configured realtime voice API, for a full voice call, like the voice
mode of the reference apps.

Before, every call was a pipeline: the page streamed the microphone to
xAI's speech to text, its own detector ended each turn, the words became
an ordinary chat turn on the bot, and the bot's text was read by xAI's
text to speech. On a call of 2026-11-02 (a bot on Grok 4.7 Fast, the
organization server) that gave 9 to 15 s from the last word to the bot's
text (production journal: one turn spent 17 s on tool discovery before
its mail tool), half sentences ("That's okay, I'm, I'm") sent as turns,
and "Are you there" said while the bot worked queued as a steer: the
engine (Grok over ACP) cannot take words mid turn, so the queue drained
it as a second full turn that read the same mail again.

Now (`server/voice/realtime-call.ts`, `server/voice/realtime-call-host.ts`, the page's
`src/lib/voice-mode/realtime-call.ts`, `src/components/voice-mode/RealtimeCall.tsx`):

- `GET /api/bots/<id>/voice/realtime` (WebSocket) bridges the page to xAI's
  Voice Agent API (`wss://api.x.ai/v1/realtime`, the key in the
  Authorization header on the server, never on the page). PCM16 at 24 kHz
  both ways. The realtime model listens and speaks natively; its server
  turn detection (`server_vad`, 500 ms of silence) ends a turn and cuts its
  own speech on a barge-in.
- The bot stays the brain for real work, bridged as function calls: `work`
  hands the person's request to the bot as an ordinary turn on the thread
  (`via: "call"`, the call's id, the person's attribution); the voice says
  one short sentence while it runs and speaks the result when the turn's
  final answer comes back as the function's output. `answer_permission`
  records a spoken allow once or deny, decided from the person's own words
  (`spokenConsent(..., "voice")`), never from the model's arguments; a
  question card is answered by the person's next request. `end_call` hangs up
  after the goodbye.
- Chit-chat, "are you there", a repeat or a thank you are answered by the
  voice at once, with no chat turn.
- One answer per response id: the audio of a response cut by the person
  (barge-in, interrupt button) is dropped, never played later. A function's
  output goes once per call id, and the same request again while it runs
  joins it instead of running twice.
- No realtime voice: no call. The status says `realtime: true` only when an
  xAI key serves the speaker; without it the call button says so and opens
  the voice settings. A key xAI refuses reaches the page in words
  (`{"type":"refused","code":"realtime_key_refused"}`: "The realtime voice
  key was refused. Fix it in Settings > Voice."), never a fallback to text
  to speech. The older macOS dictation call is gone. Text to speech stays
  for reading a message aloud.
- Logs are counters and milliseconds only (`[voice-realtime] call ended ...
  firstAudioP50=...`). Usage is booked as `grok-realtime` (seconds of audio,
  estimated at 0.05 USD a minute).

Fixture (`server/voice/realtime-call.e2e.test.ts`, a fake xAI realtime server and
a fake engine on loopback): end of speech to first audio 202 ms for
chit-chat with a voice whose own pause is 180 ms (the bridge adds about
20 ms); a request for the bot's work is acknowledged aloud at the same
202 ms and its result is heard 848 ms after the request with a 400 ms
engine turn. The real provider's own pause decides the rest; acceptance
against xAI itself is still to run with a real key.

Still on the older pipeline: the room call (several bots on one line) and
the iPhone call.

Tests: `server/voice/realtime-call.test.ts`, `server/voice/realtime-call-host.test.ts`,
`server/voice/realtime-call.e2e.test.ts`, `server/voice/voice-mode.test.ts` (status).

The sections below describe the older pipeline (speech to text, a chat
turn, text to speech). A desktop call no longer runs on it; they stay for
the room call, the iPhone and reading a message aloud.


## Recognition reliability (2026-10-30)

Short answers such as names, weekdays, commands and single letters are
accepted, including non-Latin text. Only empty text, explicit hesitation
sounds and low-confidence short transcripts are discarded by the text
filter; a word's length is not evidence of noise. Desktop and iOS use the
same rule.

Each page `finalize` carries a `requestId`. For OpenAI, the provider's
`input_audio_buffer.committed` event associates its `item_id` with that
request. Partial and final transcripts retain this identity through the
server. Results can complete out of order: the page updates their own turn
and assembles probes within a turn in audio order. Only a contiguous prefix
is published; a gap or non-final segment at timeout triggers transcription
of the whole recording, rather than sending an incomplete request. Deltas
received before commit are kept by item id until the ack names their owner.
Results of a discarded,
timed-out, uploaded or reconnected turn cannot consume a newer turn's words.
xAI and older clients continue using the existing ordered chunk protocol.

This does not change the call architecture, provider preferences or duplex
defaults. Server and client changes must both be delivered for identified
OpenAI transcripts; an older server still uses ordered untagged results.

Since 2026-10-29 OpenAI and ElevenLabs can be the voice too, picked per
person and per bot, each falling back on the others (`docs/code/voice.md`, "Voice
providers"). What follows is xAI's side, unchanged.

Voice mode is the floating voice bar above the composer: the bot's name on
top, its avatar, a live waveform, then settings (Voice, Speed, Language),
transcript, mute and end. xAI does the voice; the bot stays the brain.

## The bot answers, xAI only listens and speaks

A call talks to the app's bot: its engine, instructions, memory, tools, MCP
servers, approvals and payer rules, with the transcript in the thread. xAI is
used only as speech to text and text to speech. Voice mode never uses xAI's
realtime voice agent, Grok responses, chat completions or function calling,
nor any mode where xAI writes the reply. Every accepted utterance becomes an
ordinary bot turn through the normal send route (attributed to the person who
spoke, private-thread rules applied), and only the bot's own reply text is
synthesized. `server/voice-call.e2e.test.ts` and `scripts/verify/dev/verify-voice-mode.ts`
fail if a call reaches any xAI path other than `/v1/stt`, `/v1/tts` and
`/v1/tts/voices`.

## The bot knows it is on the phone

Every turn said on a call is sent with `voiceCall` (`{ callId, interrupted?,
language?, duplex? }`, stored on the person's message as `Message.voiceCall`; words
typed to a bot while its call is live carry the call id too). For such a turn
the server adds a hidden "Phone call" section to the bot's system prompt
(`server/voice/voice-call-prompt.ts`): a live phone call with the person, words from
speech recognition that may be misheard (infer the meaning, never mention a
transcript, dictation or voice mode, never ask to type), the voice output
contract (verdict first, one to four short spoken sentences, no markdown,
lists, tables, code, emojis, URLs or file paths, never an identifier read
aloud, times and numbers said the way a person says them in the language of
the last message, at most one question per turn and only for a real
decision, one short sentence before a slow step and a progress line only at
a real milestone, a failure said in one sentence with what to do next, then
silence), and at the end of the call an optional written follow-up below a
line of `---` that is never spoken.

Under that contract, every speech path removes identifiers on its own
(`shared/spoken-identifiers.ts`: UUIDs, hashes, tokens, JWTs, `#1234`
numbers, `id: 42` labels; absolute and home paths keep their last name):
the page's sentence cleaner (`src/lib/voice-mode/spoken.ts`), the server's
speakable text (`server/tts/speech-text.ts`) and the iPhone's
(`SpokenText.speakableSentence`, same rules in Swift). The streaming
voice's appended words (`speakableDelta`) arrive in pieces that may cut a
word in two, so the server holds the last unfinished word of an open
utterance, and an `id:` label before it, until a space or a sentence end
follows or the utterance finishes (`splitHeldDelta`, at most 400
characters), then cleans it whole. The opening `say` of an answer is not
held: its first words are the call's first audio.

The contract is also held on the call's side, whatever the model wrote
(`src/lib/voice-mode/answer-budget.ts`, the iPhone's `AnswerBudget.swift`):
a call says at most four sentences of one answer (a line break after words
ends one too; a list number, an abbreviation or a decimal does not), and a
question ends what is said, so the person answers it. The cut keeps a
prefix of the text so far that only grows, so the answer still being
written is cut at the same place. The words after the cut stay in the
chat; after the sentence cap the call says once "The rest is written in
the chat." (`voiceMode.restInChat`, in the call's language), never after a
question or a barge-in. The live call, the older macOS call, a room call
and the iPhone apply it.

Numbers, times and dates are read the way a person says them, in the
language of the text (`server/tts/voice-reading.ts`, on every streaming
speech path): French text (`french-reading.ts`) reads "15:30" and "15 h 30"
as "15 heures 30", "09:00" as "9 heures", an ISO date "2026-10-18" as "18
octobre 2026" (a time and a Z zone after it as "à 8 heures 15 UTC"), "85 %"
as "85 pour cent" and "3.5" as "3,5"; English text (`english-reading.ts`,
an English call or an automatic one whose text has more English function
words than French ones) reads "2026-10-18" as "October 18, 2026" and a 24
hour time as "3:30 PM", "noon" or "midnight", leaving "3:30" and "3:30 PM"
as written. Versions, addresses and ratios ("1.8.35", "10.0.0.1", "16:9")
stay. Another language is left as written.

An approval on a call is spoken as a question with its two options ("Allow
once, or deny?", `approval.voice.commandAsk`). The answer must pick one
(`spokenConsent(said, "voice")`, `shared/call-consent.ts`; the iPhone's
`CallAnswers.decision`; the GPT-Live call too, `server/voice/live-call-controller.ts`,
whose voice is told the same two options): a whole-utterance yes in English or French allows
once; a no, with a reason or not, denies; a hedge ("okay", "d'accord"), a
mix ("no wait, yes"), a condition ("yes, but rename it"), a question or
"always allow" asks the options again (`voiceMode.allowOnceOrDeny`). Always
allow is never reachable by voice, and a card that needs a security key is
refused on the server whatever was said. The bot's own persona,
instructions and language stay; only formatting and turn-taking change. When
the person cut the bot's previous answer (barge-in or the interrupt button),
the turn says so, and the bot drops that thought.

The section is a volatile one (`server/system-prompt.ts`), so each engine
gets it through its own channel for changed context: Claude's appended system
prompt on a new session or the context note of a live one, Codex's turn
input next to its developer instructions, the newest user message of an API
driver, the session note of ACP agents and pi. An interrupted turn always
carries it. It is never stored as the person's text and never shown in the
thread. The first written turn after a call is told the call ended. Words
that join a running turn are marked as said on the call. Tests:
`server/voice/voice-call-prompt.test.ts`, `server/voice/voice-call-prompt.e2e.test.ts`,
the per-driver cases in `server/drivers/{claude,codex,openai-compat}.test.ts`.

A live session gets the volatile section only when it changed, so every call
turn's own words also carry a short bracketed call mark
(`voiceCallTurnPrompt`, never stored). The server keeps the call's state
per thread (`server/voice/voice-call-session.ts`): LiveCall and the older call say when their call
starts, stays alive and ends (`POST /api/bots/<id>/voice/call`
`{threadId, callId, state}`), and every send to that thread while the call
lasts is a call turn, whatever path it takes (typed words, a queued line
steered with the Steer button, a retry). A call never closed expires after
20 minutes without a turn. The person hangs up with `state: "end"` for that
call id only: the session drops, the idle warm process is released, and
the person's other devices get `voice.call.ended` (`by: "person"`). The
bot hangs up with `end_call`, offered only while the thread is on a live
call. That request does not drop the session yet: the goodbye is still
being written. When the turn finishes, the same cleanup runs and the frame
says `by: "bot"`. A goodbye that fails or is interrupted drops the
request and keeps the call, so a later turn does not inherit the hang-up.
The page mutes at once and lets that goodbye finish before it leaves the
call. A newer call is not ended by the old turn. The next written turn
gets the ended note. On a call (#4216), a whole line said while the bot
works starts at once beside the running work as its own parallel task
(the same tasks a typed send can become, up to the bot's parallel limit;
past it the request waits and the call says so), and its result is spoken
when it finishes, after a short lead naming the request. A correction or a
follow-up of the running work ("instead", "actually", "no, ...", "wait",
"don't", "change ...", "use ...", "forget it", "also for that", "how is it
going", an elliptic "and in ...", "what about ...", a short line that only
narrows it, "only the urgent ones", or points back at it, "make it shorter",
and their French forms) steers it, and a request
that needs its result ("then", "once you are done") waits for it
(`server/busy-routing.ts` `callBusyMode`). Speech-to-text partials, the end
of a sentence cut by a pause, and lines typed while a call is open join the
running turn as before (no chooser). Advanced > "Full-duplex conversation"
is off by default on every channel. When the person turns it on and the
server has `SAGAX_VOICE_FULL_DUPLEX=1`, a new utterance interrupts the
in-flight turn, discards the steer queue, and starts only those words
(issue #292). Otherwise the page's duplex and speculative marks are
dropped and the send takes the steer path. Typed chat still keeps its
queue on Stop.

## Progress lines

A call turn that runs tools can leave the person in silence for half a
minute. The call (desktop `LiveCall`, `src/lib/voice-mode/progress.ts`;
the Mac's older dictation call `CallView` and its room call
`GroupCallView`; iPhone `CallProgress` in `CallConversation`) then says a
short line of its own, never a canned filler: each line comes from a tool
event of this turn, the activity rows after the person's last line. None of
these desktop calls reads the server's English chip narration (the chip's
`spoken` text, which can name a tool).

- What is said: the category of the tool still running ("Je vérifie.", "I'm
  looking it up.", "Je fais la modification.", from `progressKind`: built-in
  tool names first, then the first verb of a connector tool's name), or,
  for the same work again, the number of steps finished ("3 étapes faites,
  je continue.") or "still on it". Never the tool's name, its arguments or
  an identifier (the words also go through `stripSpokenIdentifiers`).
  Tools whose own card or words are spoken (`end_call`, questions, plans)
  get none.
- Language: the call's chosen language, else (Auto) French when the
  person's last words are French and the page is in English or French,
  else the page's (`progressLocale`, `tIn`, keys `voiceMode.progress.*`). A
  language whose pack lacks the words says nothing: silence beats the wrong
  language. `CallView` and `GroupCallView` have no call language: the
  same rule with Auto. The iPhone follows the same rule
  (`CallProgress.language`), with the words of that language's
  `Localizable.xcstrings` entry, never simply the app's language.
- A room call: one turn may reach several members, so a line stays
  generic. It is said in a member's voice only when every tool row of the
  turn is that member's (`turnToolAuthor`), otherwise in the call's own
  voice, never another bot's.
- When: only in the call's thinking phase with the bot busy, nothing
  audible, nothing else queued and no approval or question waiting. The
  first line of a turn once a tool has run 1.5 s with nothing said: this is
  the quick first sentence before a slow step on every engine (Claude,
  Codex, ACP, API). Later lines need 7 s of silence (the bot's own words
  reset it) and 9 s since the last line; five a turn at most. A 500 ms tick
  asks.
- Barge-in, an interrupt or a new turn: a line being said is cut like any
  speech (it is a filler clip, never the answer's utterance and never the
  turn's first audio), and no line follows until the next turn is sent.

The model's own parallel opener (`voice.opener`, one sentence from a fast
model beside the turn) stays with HTTP Grok on a full-duplex call;
`server/voice/voice-first-sentence.ts` says why Claude, Codex and ACP engines do
not get one.

## Full-duplex conversation (issue #292)

The stacked answers the maintainer heard were not the TTS sentence queue (that is
one reply's clauses, cancelled on barge-in). They were the harness
steer queue: talking while the bot was thinking did not interrupt
(`call-machine.ts`), a send that raced `stoppingThreads` was
`queueSteeredMessage`, and drain played each leftover utterance as
the next answer.

`CallSettings.fullDuplex` (device-local, `omb.voiceCall.v1`, default
off on every channel; rev 3 drops the on that 0.5.x stored) plus
`voiceCall.duplex` on the send, and only while `SAGAX_VOICE_FULL_DUPLEX=1`:
confirmed speech while the bot is busy or speaking cancels that turn; the
server never steers or queues those words. The thinking cue is 400 ms
instead of 1200 ms so
the line is not dead air. Approvals stay spoken yes or no and are not
cancelled. Tools still run on the bot. A "stop" is a stop only when it is
the whole utterance ("stop", "arrête", "arrête ça", "ok stop", "stop
please", with at most two filler or polite words around it,
`voice-topics.ts` `isStopUtterance`): "Stop le service AcmeGuard sur
SRV-01" is work for the bot, sent like any other request, never swallowed.
The call speaks no canned filler
and no tool-chip narration; the prompt asks the bot to say so once, in
its own words, only when something will genuinely take a while. What the
call does say on its own while the bot works in silence is a progress
line built from the turn's real tool events (see "Progress lines" below). A duplex
send that races another is latest-wins (the slower one is superseded, never queued).
`startTurn` thread_busy is retried until the interrupt cap. Cancelled
turns stop streaming (`content.delta` of that turnId is not broadcast).
The client speech fence (`speech-fence.ts`, iOS `CallConversation`)
keeps `dropOldReply` across the send, so a dying answer that lands
after the new user line is marked interrupted and never spoken.

xAI Speech-to-Speech (`wss://api.x.ai/v1/realtime`, grok-voice-latest)
is still not the brain: it would drop Sagax tools, memory, approvals
and MCP. Tests: `src/lib/voice-mode/duplex-policy.test.ts`,
`speech-fence.test.ts`, `call-logic.test.ts`,
`server/voice/voice-call-duplex.test.ts`,
`scripts/voice-duplex-harness.test.ts`,
`server/voice/voice-call-reliability.e2e.test.ts` (duplex case).

Each utterance has an `utteranceId` (also its `sendId`): the server
delivers it once, and answers a second send of it with the first receipt.
Words steered into a running turn are counted as received once the engine
says a model call took them in (Claude's `--replay-user-messages` echo,
`steer.received`), so the next turn never offers them again as a message
"you may already have".

On a barge-in the player reports what played by its audio clock: the
sentences heard, the share of the one cut (at a word), and the rest, plus
what the bot wrote but had not yet handed to the voice. The turn that cut
the bot carries `voiceCall.heard` and `voiceCall.unheard`; the bot reads
"They heard up to: '...'. They did not hear: '...'", the person's message
keeps both, and the call transcript shows the unheard words, marked.

A call turn is never left unanswered (`server/voice/voice-call-watchdog.ts`):
2.5 s after a direct turn settles on a thread on a call, the person's
newest call words with no written answer after them (nothing running or
queued, no open question, not words they cut on purpose) run once more,
told to answer briefly or ask. Words sent while a turn is being stopped
wait for the next turn; words whose steer raced the turn's end start the
next one. A send that fails is retried once with the same utterance, then
the call says it did not get through.

Before synthesis the call strips any markdown, emoji, URL or HTML the bot
still wrote, and stops at the follow-up rule (`src/lib/voice-mode/spoken.ts`,
then the server's `server/tts/speech-text.ts`; words appended to an open
utterance are cleaned the same way with their edges kept, `speakableDelta`,
so " pense" never glues to the word before it). A French call (`language`
`fr` or `fr-*`), or an automatic one whose text looks French (an accented
letter, or at least two French function words and more of them than English
ones, `looksFrench`), then reads times, prices, short ordinals and titles
aloud (`server/tts/french-reading.ts`: "14 h 30" as "14 heures 30", "25 $" as
"25 dollars"); an appended piece is judged with the utterance before it. A
spoken note sent with `/voice/speak` stays verbatim.

## A live call, like a phone

The person presses the call button on a bot. When the server reports
`GET /api/bots/<id>/voice/status` `available: true`, the call runs in voice
mode on any desktop (macOS, Windows) or browser, server mode included
(`src/components/voice-mode/LiveCall.tsx`, engine `src/lib/voice-mode/call.ts`).
Without it, a solo Mac keeps the older call (the macOS dictation helper and
the configured TTS provider, half duplex). That call marks its turns like
the live call (`useVoiceCallMark`, `src/lib/voice-mode/call-mark.ts`): each
send carries `voiceCall`, the server knows the thread is on a call (so
`end_call` is offered and hangs it up after the goodbye), and it speaks only
`spokenPart` of an answer.

- **Full duplex.** The microphone stays open for the whole call. While the bot
  speaks, the person can talk over it: on the first voiced frame (32 ms) the
  bot is ducked within 10 ms to about -6 dB (it may still be a cough,
  `DUCK_SOFT`), then to 12% once the voice is confirmed (128 ms), and it
  stays ducked, nothing cancelled,
  while the call checks that this is the person talking to it
  (`call-machine.ts` `bargePending`). The bot is cut (its voice fades out in
  12 ms, every queued sentence is dropped, and its running turn is
  interrupted with `/interrupt` if it is still writing) as soon as the
  streamed words are real words (not a sound the recognizer spelled, not a
  backchannel such as "mm-hmm", "uh-huh", "hum", "euh") and, with Only my
  voice, match the voiceprint; or, when no words have come yet, after
  400 ms of voiced speech (`BARGE_IN_CONFIRM_MS`). Worst case for a real
  barge-in: ducked by 42 ms, silent by 412 ms (400 ms plus the 12 ms
  fade, `call.test.ts`); usually sooner, when xAI's first words arrive
  first. With Only my voice the check of the voiceprint adds the
  embedding's time, and a clip too short to judge waits for more audio. A
  cough, a chair or a "mm-hmm" never cuts the answer: when the turn ends
  without real words (or in another voice) the bot is unducked and goes on.
  Short words that end before the check ("stop") still cut the bot before
  they are sent. What the bot had written stays in the transcript, marked
  interrupted, and the new words become the next turn.
- **Turns.** Silero VAD v5 (on this computer, `models/silero-vad-v5.onnx`)
  gives a voice probability per 32 ms frame; `turns.ts` starts a turn after
  about 190 ms of voice and ends it after an adaptive silence. Settings >
  End of turn picks the range: Short (420 to 800 ms), Normal (560 to
  1100 ms, 700 to start) or Patient (800 to 1500 ms). The streaming words
  move it: an unfinished clause (no final punctuation and a trailing "and",
  "to", "the", "de", "pour"..., a trailing comma or filler, or one or two
  words) waits 500 to 1000 ms longer. The socket asks xAI to keep fillers
  (`filler_words=true`), so a trailing "euh" or "um" is seen; they are
  removed only from the text the bot gets (`shared/voice-mode.ts`
  `stripFillers`), and a turn of fillers alone is no turn. A candidate too
  short to be a turn ("Ok..." then a pause) keeps its frames in the
  pre-roll, so the next turn starts with them and "Ok... regarde" keeps
  "Ok". A turn that starts within 1.5 s of
  the last one, before the bot said anything, is the same utterance: it is
  sent whole (`voiceCall.continues`) and the fragment's turn is stopped. A
  lone short token no one says alone ("dwad"), under two letters, or a word
  or two xAI itself doubts (its confidence, passed through the listen
  socket) is never a turn. Talking while the bot works silently joins its
  turn; only talking over its voice stops it.
- **Streaming speech to text.** While a turn is spoken its 16 kHz PCM streams
  over one WebSocket per call, `GET /api/bots/<id>/voice/listen`, which the
  server bridges to `wss://api.x.ai/v1/stt` with the key; the moment the turn
  ends the page sends `{"type":"finalize"}` and the words come back. The
  server asks xAI for French with formatting (`language=fr`, `format=true`,
  "deux cents" written 200) when the Language is Auto-detect and the
  person's browser or app locale is French (`fr-CA`, `fr-FR`: the page
  sends `locale`, the server keeps only a well formed one,
  `sttRequest`); a picked English or French gets `format=true` too; any
  other case stays pure detection. Smart Turn is requested with a
  threshold of 0.9 and a 5 s timeout, so xAI never ends a turn itself; its
  `end_of_turn_confidence` is passed to the page (see Latency). A final
  chunk is one xAI will not revise, not the end of the utterance: only
  `speech_final` closes it, and late words of an utterance the timeout
  settled are kept out of the next one. Silence
  and room noise are never sent. Without the socket (an old server, a proxy
  without WebSockets) each turn is uploaded whole to `/voice/transcribe`.
  A socket that drops is opened again by itself (see "A call recovers by
  itself" below), so one drop never turns the rest of the call into uploads.
- **The answer while it is written.** The bot's streaming text is cut into
  sentences (`sentences.ts`); each one is synthesized as soon as it is complete
  by `POST /api/bots/<id>/voice/stream` (xAI `POST /v1/tts` with raw PCM out,
  streamed back as xAI makes it, the person's Voice, Speed and Language) and
  played on Web Audio, the next sentence fetched while this one plays.
  The server opens a pooled connection to xAI at the start of each call.
- **Noise.** `getUserMedia` asks for echo cancellation, noise suppression and
  auto gain, and for `voiceIsolation` where Chromium offers it. On a Mac,
  Control Center > Mic Mode > Voice Isolation filters the room further (apps
  cannot set it). The neural VAD ignores steady noise, keyboards and music;
  a level gate ignores far-field voices once the person's level is known.
  When the capture cannot run at 16 kHz (the fallback at 44.1 or 48 kHz),
  the page downsamples through a windowed-sinc low-pass (Blackman, cut at
  7.2 kHz), so hiss above 8 kHz is not folded back into the voice band.
- **Echo.** Beside Chromium's echo canceller, `echo.ts` keeps 512 ms of
  playback and lines the microphone up with it (a delay of up to 384 ms, so
  a speakerphone or a Bluetooth speaker is still the bot). It learns the
  coupling and refuses frames no louder than that delayed residue. For the
  first second the coupling stays at least at its prior. The person barging
  in is far louder at once, so the bot never interrupts itself.
- **Only my voice.** Optional: the person records about six seconds of speech
  once (Settings in the bar, "Record my voice"); a CAM++ speaker embedding
  (3D-Speaker, Apache-2.0, int8, `models/campplus-sv-en-int8.onnx`) makes a
  voiceprint kept in this computer's localStorage
  (`omb.voiceCall.voiceprint.v1`, never synced or sent). Turns that do not
  match (cosine under 0.5, 0.38 for turns under 1.5 s) are ignored with a
  soft tone. On by default once enrolled; "Forget my voice" deletes it.
- **Phone UX.** States connecting, listening, hearing, thinking, speaking,
  interrupted and on hold; earcons (connect, interrupt, ignored voice, hold,
  end; can be turned off); a compact call pill centered under the name chip:
  avatar (state and timer in its tooltip), a dotted waveform of both sides
  (the bot's voice in the accent), Settings, Transcript, mute and end; the
  card it opens holds the transcript as bubbles or the settings (with hold);
  hands-free or push to talk (hold Space or the hand button; a press over
  the bot cuts it at once, with no check of the words, so a short "stop" is
  a turn), set per computer in `omb.voiceCall.v1`. On the desktop the pill is the whole call
  UI: it floats over the top of the thread and never becomes a full-column
  stage (0.4.9 had one; the 0.4.8 pill came back on 2026-10-08). The iPhone
  has its own call screen and shows the call as a card in the conversation.
- **Approvals** are read aloud and answered by a spoken yes or no (English
  or French), as in calls.

Models run with onnxruntime-web (MIT) from this app's own bundle; no CDN.
Sizes: Silero VAD 2.3 MB, CAM++ int8 8.9 MB, the runtime's WebAssembly
14 MB, loaded when a call starts. Licenses: `src/lib/voice-mode/models/NOTICE.txt`.

## Latency

The pause the person hears is measured stage by stage for every call turn,
under the turn's `utteranceId` (ids and milliseconds, never the words):

- The page (`src/lib/voice-mode/latency.ts`): `endpoint` (last voiced frame
  to the detector's end of turn), `stt` (to the words), `dispatch` (to the
  send), `firstToken` (to the answer's first streamed text), `firstSentence`
  (to a speakable clause), `tts` (to its first audio bytes), `playback` (to
  audible), and `total`. With `localStorage["omb.voiceCall.debug"]` set to
  `"1"` the console logs a `[voice-latency]` line per turn and the call's
  settings card shows the last answer's stages.
- The server (`server/voice/voice-latency.ts`) logs, under the same id,
  `received->dispatch`, `dispatch->engine` (warm, or cold start) and
  `engine->first-token`. A Claude relaunch logs which spawn contract fields
  changed (names only, `server/drivers/spawn-contract.ts`). A Grok turn is
  "warm" when it prompts the live native session as is (no handshake, no
  `session/load`).

What keeps it short:

- **A warm engine for the whole call.** Every turn used to relaunch the
  Claude CLI (the agents proxy's per-turn comms token was part of the spawn
  contract): a 2.5 to 3 s cold start on each answer (process boot, MCP
  servers, the session read back; measured from native logs). While the
  thread is on a call the turn carries `keepWarm`: the token rides a 0600
  per-thread file (`SAGAX_COMMS_TOKEN_FILE`, read on each request) and
  leaves the contract. Claude starts that process when the call is accepted
  (`POST /voice/call`), before the first utterance, and the first spoken
  turn reuses it (`server/voice-call-latency.e2e.test.ts`). A hangup closes
  the idle process.
- **Grok keeps one native session for the call.** Grok runs over ACP: one
  pooled process per thread, whose native session is re-established
  (`session/load`, every MCP server reconnected, the history read back)
  whenever its session inputs change. The comms token was one of them, so
  every Grok call turn paid a `session/load`. On a call the token now rides
  the same token file and is masked out of the session inputs: a call turn
  is a bare `session/prompt`. Grok is also warmed when the call is
  accepted: the process pays initialize, authenticate and `session/load`
  (or `session/new` for a new conversation) with no prompt and no event in
  the thread, so the first spoken turn is a bare prompt too
  (`AcpSupport.warmSession`). What is warm, then: Claude (one process) and
  Grok (one process, one native session) for the whole call; Codex and the
  API drivers are not warmed (a Codex warm would need its handshake and
  `session/new`, not done here; API drivers cannot start without a prompt,
  and no hidden prompt is sent).
- **Low reasoning effort on a call.** A call turn, and the warm that starts
  its process (so both share one spawn contract), runs at the engine's low
  effort: Grok `--reasoning-effort low`, Claude `--effort low`, Codex
  `effort: low` (`server/voice/voice-call-effort.ts`). The rule: "low" where the
  engine offers it, else its lowest level but "none" (which turns reasoning
  off: another answer, not a faster one); a bot already set lower keeps its
  level; a Codex bot with no effort is left alone, since Codex would keep
  the call's level for the turns after the call. Written turns keep the
  bot's own effort, so the first written turn after a call starts a new
  Grok or Claude process. The model changes too: see "A call turn runs
  fast" below.
- **The server environment stays up.** sandboxd stops a person's
  environment after 10 minutes without use. The call's start and each
  heartbeat (about every 5 minutes) count as use of the environment the
  call's turns work in (`UserSandboxManager.markUsed`, sandboxd
  `POST /v1/sandboxes/<key>/used`), which starts nothing.
- **xAI Smart Turn.** When a partial carries xAI's end of turn confidence,
  the turn detector reads it: an early end (punctuation, contour or the
  words' meaning, below) needs at least 0.6, and under 0.3 the turn waits
  `incompleteMs` longer. The confidence belongs to its words: the same
  words again (a final chunk, a probe's answer) keep it, new words without
  one drop it. No confidence: the rules below alone.
- **A finished sentence ends sooner.** When the streamed words close with
  final punctuation and the silence is confident (Silero under 0.15), the
  turn ends after 288, 352 or 576 ms (Short, Normal, Patient) instead of the
  adaptive endpoint. A pause inside a sentence never ends it early; words
  said right after are joined back (`voiceCall.continues`). A long Québec
  sentence (eight words, or about three seconds of French, such as "Combien
  de temps pour aller de Montréal à Québec en voiture?") does not use that
  short window: with final punctuation it needs 512 ms of confident silence,
  and while the partial still ends on a linking word ("à", "de", "pis",
  "faque") the extra wait is capped at 400 ms past the endpoint. A short
  question stays on the short window. After 128 ms of confident silence the
  call sends one `finalize` so the last word can arrive during the wait; a
  second finalize with no new audio is not sent.
- **The voice's ending counts ("Faster end of turn", Advanced, on by
  default).** The call reads the pitch and energy of the last 400 ms of
  speech before a silence, on this computer (`src/lib/voice-mode/prosody.ts`:
  a normalized autocorrelation pitch over 70 to 400 Hz per 32 ms frame,
  octave slips dropped, the least squares slope in semitones). A fall of
  1.5 semitones or more that fades out (a statement), or a rise of 3 or more
  (a question), is finished: the turn ends on the same short confident
  window as final punctuation (288 or 352 ms, Short or Normal) even before the
  words carry any. A flat pitch held on a filler or a linking word ("euh",
  "um", "de", "pour") keeps the long delay (the endpoint plus
  `incompleteMs`), and so does a filler that falls and fades out ("euh..."
  trailing off): a person thinking, never a statement ending. A French linking word ending a sentence the contour says
  is finished ("on se voit demain puis") waits half of `incompleteMs`; an
  English one keeps all of it. Anything else (too few voiced frames, a pitch
  that wobbles, a sound cut at full strength as in the middle of a word)
  changes nothing. Safety: every frame of the short window must be under
  Silero 0.15, so a word is never cut in its middle; and a person who speaks
  again within 600 ms of any early end (contour, the words' meaning, or
  final punctuation on the short window) continues it
  (`EARLY_CUT_CONTINUATION_MS`, `voiceCall.continues`), even over the bot's
  first words, which stop: a wrong cut costs only those words. A short
  question or request without punctuation may end on its meaning alone
  ("what time is it", "can you check the ticket"); in French that needs
  the long French quiet (512 ms), so "peux-tu regarder le billet" is not
  cut before "de CONTOSO". Patient is never affected, nor push to talk. Off:
  the endpoint is the one above.
- **Full duplex guesses only at a pause.** With full duplex the bot may
  start on a stable partial (four words, not an unfinished clause, or a
  closed sentence) once the person pauses, never while they are still
  talking; its voice is held until the turn really ends. A guess never
  ends the turn sooner: the detector keeps its own rules. A revised
  partial replaces the guess after 320 ms of stability, and the final
  words replace it when they differ.
- **Sent on the stable words.** A turn whose streamed words are a stable
  sentence is sent at once; the final words are checked when they come. A
  material difference (any word beyond case, punctuation, accents and
  fillers) stops that answer before it is spoken and sends the final words
  as its complete version (`voiceCall.continues`).
- **The first clause speaks first.** Over POST, the first sentence is cut at
  a comma after about six words (36 characters). With the streaming voice
  there is no character wait: the first clause goes at a one-word
  punctuated opener ("Well,", "Sure,") or at a space after two words
  (`STREAMING_CLAUSES`; words are counted by whitespace, so "C'est fait."
  is never cut after "C'est"), and no short sentence is held back to join
  the next, since the socket is already open. The first grok token
  ("Four") already opens the answer's utterance (`say` with `more: true`,
  xAI `text.delta` only) so TTS starts while the rest is being written.
  Those words are first cleaned like a clause (`src/lib/voice-mode/tts-lead.ts`
  `leadText`): nothing opens until they hold a letter ("**Oui**" never
  opens on a lone "*"), and a lead stops before a link, code, a table, or a
  last word with a digit or a currency ("14h30", "25 $" go whole).
- **Streaming voice (Advanced, on by default).** One socket for the call:
  the page opens `GET /voice/speech` (voice, speed and language in the
  query) when the call starts, and the server opens xAI's streaming text to
  speech socket for it (`wss://api.x.ai/v1/tts`, `codec=pcm`,
  `sample_rate=24000`, `optimize_streaming_latency=2`, the key in the
  `Authorization` header; `server/tts/grok.ts` `openSpeechStream`). **One
  answer is one xAI utterance**, like one person talking: its first words
  open it (`{"type":"say","more":true}`, `text.delta`), every later clause
  is appended the moment it is written (`{"type":"append"}`, `text.delta`,
  with no wait for the audio of the one before, so the intonation runs on
  and no gap opens between clauses), and `{"type":"finish"}` (`text.done`)
  comes only when the answer is done (`replyDone`), or, past 1,500
  characters, at the end of a sentence, where the next utterance begins.
  Each append is cut at 500 characters. A whole text said at once (a
  prompt, a settled answer) is one `say` per 480 characters or so. PCM comes
  back to the page as binary frames between `start` and `done` and plays
  through the same player as a POST body
  (`src/lib/voice-mode/speech-stream.ts`): one sentence whose words grow
  (`PcmPlayer.extend`), captioned clause by clause when the voice should
  reach them (by speaking rate, then by the audio's real length). While the
  open answer's audio has run dry and the bot is still writing or working,
  the call counts the bot as silent (`onStarved`, `onResume`), and the call
  bar never waits for that silence to deliver the answer's end
  (`VoiceCall.replyOpen`). Barge-in, hold, hang-up and a reissued turn
  cancel the utterance (`{"type":"cancel"}`): dropped from the queue, or,
  when it is the one speaking, cleared at xAI (`text.clear`, confirmed by
  `audio.clear`); nothing of it reaches the page after, and what was heard
  is measured on the whole utterance's words. The server session is
  `server/voice/voice-speech-session.ts`. Safety nets: the page falls back to POST
  `/voice/stream` for the rest of the call when the socket is not ready
  within 1.5 s, errors twice in one call, closes, or when the server gives
  up; the server reopens a dropped xAI socket with a backoff (250, 750,
  2000 ms), at most 3 times in a row (a reopen counts as working once
  audio came on it or it lived 10 s) and 6 times a minute, then sends
  `fallback` and logs it once. An utterance the socket failed goes on over POST into the same
  audio: what the audio received did not cover yet (assuming a slow 10
  characters a second, and from the start of the clause that point falls
  in, a sentence end or an appended clause, so words may be said twice but
  none is skipped), then what the answer appends, a sentence at a
  time. An utterance with audio still owed (text.done sent, or text its
  audio does not cover at 30 characters a second) and no progress for 8 s,
  or a clear not confirmed in 2 s, counts as a dropped socket; an open one
  whose audio has caught up waits for the bot's next words as long as they
  take (the player checks it again every 10 s and gives it up only once it
  is no longer open). The page pings the speech socket every 10 s
  (`{"type":"ping"}`, the server answers `pong`); a server that answered
  before and then sends nothing for a whole period is gone (a half-dead
  socket after a network switch or sleep never closes), and the call
  speaks over POST from there, its open answer included. Nothing is left open at xAI: a new
  turn sent ends the last answer's utterance, a bot turn that ends
  (finished, cancelled, failed, stopped) without its answer's `replyDone`
  within 3 s ends it too (`REPLY_END_GRACE_MS`), and on the server an open
  utterance with no new text and no audio owed for 20 s gets its
  `text.done` (`SPEECH_IDLE_FINISH_MS`); words appended after that open a
  new xAI utterance under the same id, and anything queued behind it ends
  it (the page then opens it again with the next words, into the same
  audio). A whole text said while an answer's utterance is open (an
  approval prompt, a notice) goes over POST, so it never waits behind that
  utterance on the server; the player still plays it after the answer. xAI closes a streaming socket around 600 s;
  while nothing is in flight the server rotates it at 540 s and does not
  count that as a failure. Changing the voice, speed or language mid-call
  reopens the socket at once when nothing is in flight, so the next answer
  does not pay the reconnect before its first audio; an answer begun while
  another is still in flight goes over POST. Hold, mute,
  hang-up, the transcript card and the thread card are the same either way.
- **A warm connection to xAI's speech.** Each turn's end (`finalize`) opens
  a pooled connection to api.x.ai (at most every 2 s), so the first
  sentence does not pay a new TLS handshake after the person spoke.
- **Short context on a call.** A call turn recalls at most two notes in
  1,200 characters and no other conversation, and skips the recent-work
  brief. It never reads the conversation's own engine session either: see
  "A call turn runs fast".
- **The voice's playback.** The page plays the voice on an audio context at
  24 kHz (xAI's rate, so the browser resamples once, at the output; the
  device's rate when the browser refuses). An answer's first chunk starts
  70 ms ahead of the audio clock (a prebuffer); later chunks join the audio
  before them, each on a gain of its own that fades out over its last 3 ms
  unless the next chunk joins in time, and the chunk after a gap fades in
  over 3 ms, so a gap never clicks. A chunk that comes after the audio ran
  out, including the first chunk of a later sentence, is an underrun: the
  start lead (15 ms) grows by how late it was, up to 120 ms, and gives back
  5 ms for every 2 s of audio without a gap; a gap over 500 ms is the bot
  writing, not the network, and changes nothing. On the iPhone
  (`ios/App/Call/CallSpeech.swift`, `CallAudioIO.swift`) the first audio
  after a silence waits for 60 ms of it, each sentence's resampler is
  drained at its end (its last samples used to be lost), the volume ramps
  over 10 ms to duck and unduck, and a cut fades over 12 ms before it stops.
- **A thinking tone.** When nothing is audible 1.2 s after the person
  stopped, a soft two-note tone plays (Settings, "Soft tone while a slow
  answer is coming", on by default).

Bench: `SAGAX_VOICE_BENCH=1 BENCH_OUT=out.json pnpm exec vitest run
scripts/voice-latency-bench.test.ts` runs the call engine against the real
server (given the fake key as `SAGAX_XAI_VOICE_KEY`), a fake xAI and, for
each engine of `BENCH_ENGINES` (`claude,grok`), the fake Claude CLI in
`FAKE_CLAUDE_MODE=voice` (`FAKE_CLAUDE_COLD_MS`, `FAKE_CLAUDE_FIRST_TOKEN_MS`,
`FAKE_CLAUDE_TOKEN_MS`) or the fake ACP CLI in `FAKE_ACP_MODE=voice`
(`FAKE_ACP_COLD_MS`, `FAKE_ACP_LOAD_MS`, `FAKE_ACP_FIRST_TOKEN_MS`,
`FAKE_ACP_TOKEN_MS`). The Grok report counts each turn's ACP session
establishments (`establishPerTurn`): 0 on a warm call turn.

The bench's knobs for the two switches: `BENCH_SPEECH` (`socket`, the
default, or `post`), `BENCH_FASTER_END` (1 or 0), `BENCH_UNPUNCTUATED=1`
(the words never carry punctuation) and `BENCH_REPLY` (the engine's
answer). Its microphone's voiced frames are a voice-like tone whose last
400 ms fall and fade, so the pitch reading sees a statement end.

Release acceptance is a separate 32-turn run with hard gates (p50 at most
800 ms, every turn at most 2,500 ms, no spoken overlap). Pull-request CI
enforces those gates on the synthetic profile only.
`pnpm voice:acceptance:real -- --enforce` is the real-provider run, and a
release waits on it. Recipe: [docs/verification/voice-acceptance.md](verification/voice-acceptance.md).

## A call turn runs fast (2026-10-29)

Measured in production before this: about 5.8 s from the end of speech to
the first words (1.9 s of turn setup over a conversation of about 183,000
tokens, a cold engine, 3.8 s to the first token), more on a large model,
and lines said meanwhile piled up. Now (`server/voice/voice-turn.ts`):

- **A fast model.** Every call turn, and the warm that starts its process
  when the call is accepted, runs on a fast model: the bot's own fast model
  when it set one, else the fast tier of its engine (Haiku on Claude Code,
  a fast Grok on Grok), else the fast tier of another engine the payer can
  use (`pickVoiceModel`, server/models/model-auto.ts, the same tiers Auto uses). A
  bot pinned to a model gets it too; a request that needed another
  engine's connector keeps that engine. No fast model anywhere: the bot's
  model.
- **A short context, in a session of its own.** The call never resumes the
  conversation's engine session. Its first dispatch (the warm) closes an
  idle process the thread kept and starts a new session; the first spoken
  turn carries a short view of the conversation (`voiceTranscript`: the
  conversation's own summary, or a quoted summary of what is older, then
  the latest 12 messages, 6,000 bytes in all); every later turn resumes
  that session with its words alone, plus anything that reached the
  conversation meanwhile that the call did not write or hear (a task's
  result). The call session's cursor lives in memory (`VoiceTurnSessions`);
  the conversation's cursor and handed-message record are left alone, and a
  call turn neither folds the conversation nor waits for it. A new call on
  the thread before a hang-up keeps the warm process and session.
- **The conversation learns what the call said.** Its next written turn
  resumes its own session on the bot's model: an engine that records what
  its session was handed gets the call's lines as unseen messages; another
  gets them in front of the words (`callLinesBlock`, the newest 24; memory
  only, a restart loses it). A conversation that had no session before the
  call starts one from the usual rebuild.
- **Real work is handed off.** The call instruction (`VOICE_CALL_DELEGATE_LINE`)
  tells the bot that it answers on a fast model from a short view: for
  code, a long search or read, many tool steps, it says in one sentence it
  is on it and calls `start_thread` with `report_back`. That parallel task
  runs on the bot's main model, its brief carrying the conversation (its
  summary and latest turns at the rebuild budget, `callHandoffHistory`),
  and its result is posted back into the conversation, where the call
  announces and reads it (`howToSpeakTopicResult`).
- **No pile-up.** A barge-in still cuts the answer (the page stops the turn
  its words cut, `expectedUtteranceId`), and a stale answer is still never
  spoken (the speech fence). Lines said while the bot cannot take them
  (a turn being stopped) wait in the queue, and every waiting line of the
  same call drains as one turn (`callLineGroup`, server/turns/steer-queue.ts)
  that answers the newest, the earlier ones given as its context
  (`voiceQueuePrompt`). Every line stays in the conversation.
- **Timings.** The Events lens line of each call turn names the model, the
  bytes of context and whether the call session was started or resumed
  (`callTurnNotice`), and the page reports when the answer's first words
  were heard (`POST /voice/call` `state: "heard"`, numbers only): first
  sentence, text to speech, playback and the total from the end of speech
  (`audioTurnNotice`). The server log has `[voice-turn]` per dispatch.

Tests: `server/voice/voice-turn.test.ts`, `server/models/model-auto.test.ts`
(`pickVoiceModel`), `server/turns/steer-queue.test.ts` (one call's lines),
`server/voice/voice-fast-turn.e2e.test.ts` (fake Claude CLI: the fast model and
short context in one warm session, the conversation's own session after,
barge-in, no pile-up, a heavy request handed off).

## A call recovers by itself

A call must never hang, go silent, lose a turn or drop. Each part that can
fail recovers on its own:

- **The listen socket (page side).** When `/voice/listen` drops (a Wi-Fi
  switch, a sleep, the server restarting), the page opens it again after
  250, 750 and 2,000 ms, then every 5 s for the rest of the call; the count
  starts over once a socket is ready (`src/lib/voice-mode/stt-stream.ts`,
  `RECONNECT_BACKOFF_MS`, `RECONNECT_EVERY_MS`). Only the utterances already
  finished and still waiting for their words are uploaded whole; the one
  being spoken is sent again from its first frame on the new socket, with
  its words, interim, finalize and probe state reset. Late words of an
  utterance the timeout settled are no longer awaited, so they never eat the
  next turn's words. A socket that never opened (an old server) gets the
  backoff only, then the call uploads.
- **xAI's speech to text (server side).** The page's socket outlives xAI's
  (`server/voice/voice-listen-session.ts`). When xAI's socket closes, the server
  opens a new one behind the same page socket (250, 750, 2,000 ms) and sends
  the page `{"type":"reconnected"}`; the page sends the open utterance again
  and uploads the finished ones that were waiting. Only when those three
  tries fail does the page socket close (1011), and the page reconnects on
  its own. A reopened socket counts as working only once xAI sent words on
  it or it lived 10 s (accepting then closing at once still fails), and
  more than 6 reopens in a minute close the page socket too, so a flapping
  socket is never reopened forever. Like the streaming voice, xAI's socket is rotated at 540 s, once
  nothing was heard or sent for 3 s (no utterance open); audio that arrives
  while the next socket opens is held and sent to it, so the page never
  notices.
- **A failed upload.** A whole-turn upload is tried twice (a refusal once),
  each try given up after 20 s (`TRANSCRIBE_TIMEOUT_MS`). When both fail,
  the call reports `transcribe-failed`: the bar shows "That didn't come
  through" and the call says "That did not get through. Could you say it
  again?". A turn is never dropped silently. The iPhone does the same when
  it uploads a turn.
- **A stalled voice.** A clause spoken over POST `/voice/stream` with no
  first byte, or no next chunk, for 8 s is aborted with an error
  (`SPEECH_STALL_MS` in `api.ts`); the player has its own 10 s backstop for
  any sentence whose audio stops coming (`READ_TIMEOUT_MS`). The player then
  plays the next clause, and the call is never stuck "busy".
- **Audio contexts.** The output and the capture contexts are resumed when
  the system suspends or interrupts them (`statechange`). A player whose
  audio clock stopped resets its schedule when it goes idle, so the next
  answer does not wait on audio that will never play.
- **The microphone.** A track that ends (unplugged, taken by the system)
  or a `devicechange` that removes the call's microphone opens the capture
  again (`MIC_REOPEN_MS`: at once, then 0.5, 1.5 and 3 s, the later tries on
  the default device); the call says the microphone is unavailable only
  when every try failed. Retry opens a microphone whose stream died. Five
  frames in a row that fail (a model that broke mid-call) switch the call to
  the level detector instead of leaving it deaf.
- **A failed turn.** A turn that fails is stored as an "error: <cause>"
  activity row (or an "access" row); the call used to say nothing. Now it
  says one sentence with what to do, then stays silent
  (`src/lib/voice-mode/failure.ts`, the iPhone's `CallFailure.swift`): the
  cause is never read aloud, only sorted into a kind, each with its line in
  the call's language (`voiceMode.failure.busy`: overloaded or rate
  limited, try again in a minute; `limit`: a usage window is used up, try
  later; `quota`: out of credits, check the plan;
  `signIn`: a new sign-in is needed, a row marked `setup` included;
  `connection`: network, timeout or a 5xx, say it again; `generic`: the
  details are in the chat). A stop the person asked for is no failure. The
  call waits 6 s (`CALL_FAILURE_GRACE_MS`) with the bot idle after it first
  saw the row, past the harness's one retry 2.5 s after the turn settles
  (`server/voice/voice-call-watchdog.ts`): a retry that answers says nothing of
  the failure, a retry that fails too is said once. Once per person's
  words; never while the bot works or speaks, the person talks, or a
  question or approval waits. Words another bot asked (`peerAsk`) are
  skipped, as the harness does. The cause is sorted by narrow patterns
  ("signing", "512 tokens" or a "capacity" alone stay `generic`). A
  language without the words says them in English. The live call, the
  older macOS call, a room call and the iPhone apply it.
- **The call's record on the server.** Besides the heartbeat every 5
  minutes, the page says `alive` the moment it is visible again or the
  network comes back (`src/lib/voice-mode/call-alive.ts`), so a laptop that
  slept past the 20 minute expiry is on its call again at once. An expired
  call is also registered again by the next turn that carries its call id;
  a call id that hung up never comes back that way. A send's 800 ms retry
  dies with the call, so nothing is sent under an old call id after a
  hang-up.
- **iPhone.** An audio interruption that ends without `.shouldResume` (the
  other app kept the audio) leaves the call on hold with "The call was
  interrupted. Tap Resume the call to continue."; it resumes by itself when
  the app is active again, or on the tap. After
  `mediaServicesWereResetNotification` the audio session is configured
  again and the audio engine rebuilt with a new engine and new player
  nodes (the old ones are invalid after a reset). The reply to the call's
  `POST /voice/call` `start` carries `keyterms`, the same list the server
  gives xAI (`server/voice/voice-keyterms.ts`: the bot's name, the person's, the
  organization's terms, the thread's proper nouns; at most 100, only to a
  person allowed on that thread, and never a token that looks like a
  secret: a key prefix such as AKIA, sk-, ghp_ or xai-, a long or random
  mix of letters and digits, a word glued to a year such as "Summer2024";
  product names such as "Microsoft 365", "SRV-01" or "X360Recover" stay); the phone's recognizer starts at once and
  uses them from the next turn as contextual strings
  (`SFSpeechAudioBufferRecognitionRequest.contextualStrings`, or an
  `AnalysisContext` for the `.general` tag set with
  `SpeechAnalyzer.setContext` on iOS 26). An empty list or a failed start
  leaves recognition as it was; an uploaded turn is biased on the server.

## Stable tools during a call

On an organization server each turn used to exchange the speaker's sign-in
for a fresh Perspicax MCP token per profile and revoke it after the turn; a
call's quick turns hit the rate limit and a refused exchange left the
profile out of that turn. While the thread is on a call, a turn's tokens
(and their Perspicax MCP session) are kept for the call's next turn and
reused without an exchange (`PerspicaxMcp` `keepWarm`), then revoked when
the call ends. An exchange refused for now is retried once. A call turn
whose MCP set changed is logged (`[voice-call]`), and so are the servers
added or removed when the Claude CLI relaunches.

## When xAI fails a request

xAI's refusal is never hidden behind "didn't come through" (2026-10-28):

- `server/tts/grok.ts` reads the status of a refused socket handshake (`ws`
  says "Unexpected server response: 429") and words it like an HTTP refusal:
  key or permissions (401, 403), credits (402), rate limit (429), xAI failing
  (5xx); a real network error stays "Could not reach Grok voice". xAI answers
  an invalid key with **400** "Incorrect API key provided" (checked
  2026-10-28), so the refusal's body is read too (REST, and the socket's
  `unexpected-response`), up to 2 KB, only to sort it: key, credits, rate
  limit. Another 400 keeps xAI's category ("Client specified an invalid
  argument"), never its message.
- Every 502 of a voice route answers `{ error, code: "voice_provider",
  failure, key, tried? }`, `failure` being `key`, `quota`, `busy`, `down`,
  `voice` or `other` (`grokVoiceFailure`), `key` the key it is about (its
  source and last four characters, `{ source: "voice-key" | "perspicax-key"
  | "org-key" | "server", last4 }`, never more) and `tried` every key refused
  on the way when more than one was. The server log says which request
  failed and on which key (`[voice-mode] xAI stream failed (speaker-key,
  person's voice key ···Wez8): ...`), never the key.
- The page tries a sentence once more after a busy or failing xAI or a
  stall (`streamVoiceModeSpeech`, 400 ms), then says the reason in the bar,
  naming the key and what to do about it when the server named one
  ("xAI has no credits left for your voice key ···Wez8. Add credits to that
  xAI account, or change the key in Settings > Models and voice > My voice
  keys.", `voiceMode.provider.<failure>.named`, `voiceMode.key.*`,
  `voiceMode.keyAction.*`), else the plain line
  (`voiceMode.provider.<failure>`). That line goes away as soon as the voice
  is heard again; "Try again" is offered only for the microphone, the one
  thing it reopens (`voiceErrorNote` in `src/lib/voice-mode/failure.ts`).
  A 403 mid-call (no key serves the person any more) shows the access card
  in the bar, as before the call. The call's settings show which key the
  voice runs on ("Voice: xAI with your voice key ···Wez8",
  `voiceMode.keyLine`, from `status.key`).
- The bar's transcript shows the bot's words as they are said: the spoken
  part, without markdown (`transcriptText` in `src/lib/voice-mode/spoken.ts`,
  `SpokenText.transcriptText` on iOS).
- iOS (`CallProvider.choose`): with voice mode available, the call hears
  through xAI on the server (POST /voice/transcribe) and speaks with xAI, the
  desktop's provider for that person; Apple's recognizer and voice are only
  the fallback when no voice provider is set up (a group call, the demo, a
  server without voice mode). The call's transcript header says which one
  and on which key ("Voice: xAI with your voice key ···Wez8",
  `VoiceWords.providerLine`). Since 2026-10-28 the status is asked twice
  and a server that cannot answer, or a refusal on a personal server, is
  said at the start of the call ("... This call hears and speaks with Apple
  on this iPhone"), never a silent fall to Apple's ears; every voice route's
  refusal is decoded (`VoiceFailure`: the kind, the key, every key tried)
  and said with the key and what to do (`VoiceWords.line`); an uploaded
  turn the server refused for good is not retried and its reason is shown;
  the composer's dictation hears through xAI whenever a key serves
  (`SpeechDictation` `.xai`, listen socket while speaking, "Transcribing
  with xAI…" only while waiting for finalize or the upload fallback),
  Apple on the phone being the announced fallback; a reply read aloud goes
  through voice mode's xAI voice (`MessageSpeaker`, `/voice/prepare` and
  `/voice/speak`), then the computer's engine, then the phone's voice with
  the reason under the composer.
- Composer dictation (the grey mic, `src/lib/composer-dictation.ts`) hears
  through xAI whenever a key serves the person, on every platform alike.
  On the desktop and the web (2026-10-29) and on iOS (2026-10-31, #1695)
  the audio streams over the call's listen socket (GET /voice/listen,
  `LiveTranscriber` / iOS `LiveDictation`) while the person speaks: the
  words appear in the field as they are recognized and the stop only waits
  for xAI's answer to the finalize (a few hundred ms, at most
  `DICTATION_FINAL_TIMEOUT_MS`), where the whole clip used to be uploaded
  after the stop (POST /voice/transcribe), now only the fallback when the
  socket cannot open. The Mac's own recognizer is the fallback only when
  none does, and the mic's label says so ("Start dictation (this Mac's own,
  no xAI key)", `composer.dictation.startApple`). A failed transcription
  names the key and what to do (`voiceErrorNote`).
- Reading a reply aloud on an organization server (the Speak button, "Read
  replies aloud", a summary) goes through voice mode's xAI voice too, with
  the person's Voice, Speed and Language and the same key order
  (`src/lib/tts/index.ts` `organizationVoiceMode`), instead of the
  installation's engine; a solo server keeps the engine picked in Settings.

## Timings in the Events lens (2026-10-29)

Where the seconds of a spoken turn went shows in the thread's Events lens
as `runtime.notice` rows (`server/voice/voice-timing.ts`), numbers only, never
the words: each call turn ("Voice turn: end of speech, speech to text,
send" from the page's `voiceCall.timing`, then "turn setup, engine (warm
or cold start), first words" from `server/voice/voice-latency.ts`), each
streamed transcript (the final words after the page's finalize) and each
whole-recording upload (how long xAI took for how many seconds of audio).

A call turn sent early on its partial and sent again with its final words
(`reissue`, `call.ts`) interrupts the first one and sends the second:
the two requests race, and the final words can reach the running turn
just before the interrupt stops it. The interrupt names the utterance it
cancels (`expectedUtteranceId`); the call watchdog answers words of a
newer utterance stopped that way (`unansweredCallMessage`
`stoppedUtteranceId`), where they used to wait for the person's next
message (2026-10-29: 44 s, until they typed the question).

## Who pays, and the key

The key never reaches the client. Order for the person who speaks
(`server/voice/voice-mode.ts` `resolveVoiceKeys`, `server/voice/voice-keys.ts`):

- Organization server: the xAI key they saved in Sagax for their own voice
  (Settings > Models and voice > My voice keys, `server/voice/person-voice-keys.ts`,
  2026-10-28; it needs no grant of the organization's voice), else their own
  xAI key in Perspicax (provider `xai`), else the organization's xAI key (Settings > Models and voice, `config.xai.key`
  or `XAI_API_KEY`), else refused with an access card shown in their bar only,
  under the audience rule of every access card (`accessCardAudience`: the
  person it is about; the organization's key hint only for an admin).
  A disabled person is refused and never falls back on the organization.
- Solo server: the server's xAI key.

**The key that has funds (2026-10-28).** Every request starts with the
first key of that order. When xAI refuses it for credits (`quota`) or for
the key itself (`key`: invalid, revoked, no voice permission), the next key
is tried at once (`withVoiceKeys`), on REST and on the sockets alike; a
rate limit, xAI down or an unknown voice stays with the key that got it,
another key would not help. The refusal is remembered per person for
`VOICE_KEY_REFUSAL_TTL_MS` (5 minutes), so the following sentences skip
straight to the key that works instead of paying a 402 round trip each,
and a refilled key is tried first again after that. The answer names the
key that served (`x-voice-key: perspicax-key:c0Je` on HTTP, `key` on the
sockets' `ready` frame) and the ones skipped (`x-voice-key-skipped:
voice-key:Wez8:quota`, `skipped`); the page says it once in the bar ("your
voice key ···Wez8 was refused (no credits). The voice now runs on your xAI
key in Perspicax ···c0Je.", `voiceMode.keyFallback`), never a silent
switch. `GET /voice/status` lists every key in its order with the refusals
remembered (`keys[].refused`) and the one the next request starts with
(`key`). If Perspicax cannot be reached, the person's own voice key still
serves; `perspicax_unreachable` is refused only when no other key exists.

Since 2026-10-14 Grok voice has no key of its own: it uses the xAI key, the
one bots on Grok use. A Grok voice key saved by an older build
(`config.tts.xaiKey`, `SAGAX_XAI_VOICE_KEY`, the desktop's `xaiVoiceKey`)
becomes the xAI key when none is saved; otherwise the xAI key stays and the
duplicate is dropped. Both cases are logged without the value
(`server/config.ts` `migrateGrokVoiceKey`, `electron/workspace-credentials.mjs`
`foldGrokVoiceCredential`).

Each speak and transcribe is booked in the usage ledger (`driverKind`
`xai-voice`, model `grok-tts` or `grok-stt`, `access` = the via,
`payerPrincipalId` when the speaker's own key paid; no price: unpriced).

Perspicax lists `xai` keys since its migration 0043 (its provider keys are
`anthropic`, `openai`, `xai`, `google` and `moonshot`, on the console page
`/console/credentials?kind=model`), and Sagax reads a person's `xai` key from
the directory.

## The call button on an organization server

The client never decides alone: it asks `GET /api/bots/<id>/voice/status`
(again at each click while voice mode is unavailable, so a key just added
works at once). With a key the button opens the bar. Without one it shows
the speaker's access card in its popover ("You don't have xAI access for
voice mode: add your xAI key in Perspicax."; an admin also reads the
organization's key hint and gets "Open Settings > Connections"). If the
server cannot answer, the popover says so with the error and a retry. The
legacy call gate (macOS dictation, "Choose This computer") never shows on an
organization server.

## Settings

Voice ("Not set" is xAI's default voice), Speed (0.75x, 1x, 1.25x, 1.5x) and
Language (Auto-detect and the languages of `shared/voice-mode.ts`) live in
localStorage under `omb.voiceMode.v1`, which travels with the person on an
organization server (`shared/user-preferences.ts`). The call's own settings
(hands-free or push to talk, Only my voice, call sounds, and under
Advanced "Streaming voice" and "Faster end of turn", both on by default)
and the voiceprint
stay on the computer (`omb.voiceCall.v1`, `omb.voiceCall.voiceprint.v1`). A language xAI text to
speech does not take is spoken as `auto`; speech to text gets the base
language as a hint when xAI supports it, else it detects (Auto-detect on a
French locale: French, see Streaming speech to text).

## Desktop permissions

- macOS: `NSMicrophoneUsageDescription` (electron-builder.yml) and the
  `com.apple.security.device.audio-input` entitlement
  (build/entitlements.mac.plist) are in the signed build; macOS asks once.
- Windows: Settings > Privacy & security > Microphone must allow desktop
  apps. No macOS helper is involved.
- Electron grants the microphone to the local UI and, in server mode, to the
  organization server's origin drawn with the bundled UI, audio only
  (`electron/app-permissions.mjs`, `microphoneOrigins`).

## xAI endpoints and key

An xAI API key from console.x.ai with access to the voice endpoints:

- Streaming speech to text, `wss://api.x.ai/v1/stt` (query `model`,
  `encoding=pcm`, `sample_rate=16000`, `interim_results`, `endpointing`,
  `language`, `format` (only with a language), `filler_words=true`,
  `keyterm`, `smart_turn=0.9`, `smart_turn_timeout=5000`; events
  `transcript.created`, `transcript.partial` with `is_final`,
  `speech_final` and `end_of_turn_confidence`, `transcript.done`;
  `{"type":"finalize"}` ends an utterance and the session goes on), and
  `POST https://api.x.ai/v1/stt` (multipart `language`, `format`,
  `filler_words`, `keyterm`, then `file` last) for a whole turn; the
  route hands back its words without fillers:
  <https://docs.x.ai/developers/model-capabilities/audio/speech-to-text>
- `POST https://api.x.ai/v1/tts` (`text`, `voice_id`, `language`, `speed`
  0.7 to 1.5, `output_format` `{codec: "pcm", sample_rate: 24000}` for a live
  call; the response body streams the audio as it is made), and
  `GET https://api.x.ai/v1/tts/voices`:
  <https://docs.x.ai/developers/model-capabilities/audio/text-to-speech>.
- Streaming text to speech, `wss://api.x.ai/v1/tts` (query `language`,
  `voice`, `codec=pcm`, `sample_rate=24000`, `speed`,
  `optimize_streaming_latency=2`; client `text.delta`, `text.done`,
  `text.clear`; server `audio.delta` base64, `audio.done`, `audio.clear`,
  `error`; the socket stays open between utterances):
  <https://docs.x.ai/developers/model-capabilities/audio/text-to-speech#streaming-tts-websocket>.
  The live call's "Streaming voice" uses it; POST `/v1/tts` is its fallback.

xAI's ephemeral client secrets (`POST /v1/realtime/client_secrets`,
<https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens>)
open only the realtime speech-to-speech agent
(<https://docs.x.ai/developers/model-capabilities/audio/voice-agent>), where
Grok answers by itself instead of the bot, its tools, approvals and memory;
voice mode never uses it. The key stays on the server: the page talks only to
the server's own voice routes.

## Checks

- `server/voice/voice-mode.test.ts`: authorization, payer order, refusal card, no
  key in any answer, validation, rate limit, usage.
- `server/voice-call.e2e.test.ts`: the listen WebSocket, the streamed
  speech and the streaming voice socket (clauses, barge-in `text.clear`, a
  dropped xAI socket reconnected, a refused one answered 502) over real
  sockets against a fake xAI, same-origin only, and no xAI path but speech
  to text and text to speech.
- `server/voice/voice-speech-session.test.ts`: the streaming voice's server
  session (one utterance per answer with appends sent at once, appended
  text cleaned with its edges kept and cut at 500 characters, an open
  utterance with nothing to say yet, whole texts one at a time, clear, drop
  and backoff, three failed reconnects then fallback, the stall watchdog
  only while audio is owed, a clear never confirmed).
- `src/lib/voice-mode/speech-stream.test.ts`: the page's side (open,
  stream, cancel, an answer's utterance begun, grown and finished, a
  socket failing mid-answer going on over POST from what was not covered,
  two errors, the 1.5 s open, a server fallback) and the clauses without
  the 36 character wait (words counted by whitespace).
- `src/lib/voice-mode/tts-lead.test.ts`: what goes to the voice for an
  answer (begin, appends with captions, one finish, the 1,500 character
  roll, markdown never opening it, the POST switch mid-answer).
- `server/tts/french-reading.test.ts`, `speech-text.test.ts`: French
  reading (also for an automatic language that looks French) and the
  appended text's cleaning.
- `src/lib/voice-mode/prosody.test.ts`: the pitch estimate and the contour
  verdict on synthetic contours (falling, rising, flat filler, mid-word),
  and the turn detector using it.
- `server/tts/grok.test.ts`: the xAI requests (speed, language, STT form,
  fillers kept, format, Smart Turn and its confidence passed through).
- `src/lib/voice-mode/duplex-policy.test.ts`, `call-logic.test.ts` duplex
  cases, `server/voice/voice-call-duplex.test.ts`, `scripts/voice-duplex-harness.test.ts`:
  full-duplex barge-in while thinking, admit never queues, one active turn.
- `src/lib/voice-mode/call-logic.test.ts`: the call's state machine (barge-in,
  cancellation, hold, mute), endpointing and its adaptation, the echo guard,
  the sentence splitter.
- `server/voice/voice-call-reliability.e2e.test.ts`: every call turn marked on
  every path, no duplicate steer, heard and unheard, the unanswered
  watchdog, words sent while a turn stops; `server/org/org-mcp.e2e.test.ts`:
  one Perspicax exchange for a whole call; `server/context/delta-context.e2e.test.ts`:
  a steer the engine echoed is never offered again.
- `src/lib/voice-mode/player.test.ts`, `stt-stream.test.ts`: what was heard
  at a cut (also in an utterance that grows), the 24 kHz context, the
  prebuffer, the fades around a gap, the jitter buffer, captions, a starved
  utterance, the two ducks, xAI finalize semantics; a stalled clause given
  up and the next one played (an open utterance is never timed out), a
  suspended context resumed, a stopped clock not busy; an idle drop that
  streams the next turn on a new socket, a mid-utterance drop (each
  utterance its own words, one upload), the server's `reconnected`, two
  failed uploads reported.
- `server/voice/voice-listen-session.test.ts`: xAI's speech to text dropped and
  reopened behind the page's socket, the page closed only after the
  backoff, the 540 s rotation while idle.
- `src/lib/voice-mode/api.test.ts`, `call-alive.test.ts`,
  `server/voice/voice-call-session.test.ts`: the 8 s stall and 20 s upload
  timeouts, the heartbeat on visibility and online, a retry that dies with
  the call, an expired call registered again.
- `src/lib/voice-mode/call.test.ts`: the call with fake devices (one turn,
  barge-in cut on the first real words or by 412 ms, a cough or a "mm-hmm"
  never cutting the answer, another voice over the bot, the rejoin after
  any early end, fillers kept from the bot, Smart Turn, the pre-roll of a
  cancelled candidate, the anti-alias resampler, the streamed answer, Only
  my voice, push to talk, mute, hold, a language change, the upload
  fallback, an upload that fails twice, a suspended capture context, an
  ended track or an unplugged microphone opened again, frames that keep
  failing).
- `src/lib/voice-mode/voice-topics.test.ts`: a stop is the whole utterance.
- `src/lib/voice-mode/models.test.ts`: the real models on recorded fixtures
  (speech, noise, keyboard, music, a TV across the room, echo, barge-in;
  speaker accept and reject; the filter bank against kaldi-native-fbank).
- `src/components/voice-mode/*.test.ts`, `src/lib/voice-mode/voice-mode.test.ts`.
- `electron/app-permissions.node-test.mjs`: the microphone in server mode.
- Real Electron, server mode, fake xAI (`server/testing/fake-xai-voice.ts`),
  a recorded sentence as the microphone: first audio of the answer after the
  person stops, the turn ended on the voice's falling end with no
  punctuation, the answer over one streaming voice socket, barge-in cleared
  at xAI, hold, the POST fallback after xAI's socket drops for good, and no
  xAI path but voice:
  `pnpm exec vite build && node --experimental-strip-types scripts/verify/dev/verify-voice-mode.ts`.
  It drives the call through `window.__sagaxVoiceCall`, which exists only
  when `localStorage["omb.voiceCall.debug"]` is `"1"`.

- Voice acceptance (`pnpm voice:acceptance`, and
  `pnpm voice:acceptance:real -- --enforce` before a release): the 32-turn
  ledger, the latency gates, and the provider-path audit. Recipe:
  [docs/verification/voice-acceptance.md](verification/voice-acceptance.md).

A change to the server routes needs the server image redeployed.
