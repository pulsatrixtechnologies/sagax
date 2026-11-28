// The live call's pure logic, ported from the desktop's voice mode
// (src/lib/voice-mode/*.test.ts): the state machine, turn endpointing,
// the echo guard, sentence chunking while an answer streams, barge-in,
// turn-taking with the conversation, and rooms.
import XCTest
@testable import CompanionCore

// MARK: - State machine

final class CallMachineTests: XCTestCase {
    private func run(_ events: [CallEvent], from state: CallState = .initial) -> (CallState, [CallEffect]) {
        var state = state
        var effects: [CallEffect] = []
        for event in events {
            let step = CallMachine.step(state, event)
            state = step.state
            effects += step.effects
        }
        return (state, effects)
    }

    func testConnectingThenListeningWithTheConnectedTone() {
        let (state, effects) = run([.connected])
        XCTAssertEqual(state.phase, .listening)
        XCTAssertEqual(effects, [.earcon(.connected)])
    }

    func testATurnIsHeardTranscribedAndSent() {
        let (state, effects) = run([.connected, .speechCandidate, .speechStart, .speechEnd, .utterance("  Bonjour  ")])
        XCTAssertEqual(state.phase, .thinking)
        XCTAssertTrue(state.botBusy)
        XCTAssertTrue(effects.contains(.finalizeSTT))
        XCTAssertEqual(effects.last, .send("Bonjour"))
    }

    func testAnEmptyTurnGoesBackToListening() {
        let (state, effects) = run([.connected, .speechStart, .speechEnd, .utterance("   ")])
        XCTAssertEqual(state.phase, .listening)
        XCTAssertFalse(effects.contains { if case .send = $0 { return true } else { return false } })
    }

    func testBargeInDucksAtOnceThenCutsTheBotAndItsRunningTurn() {
        var (state, _) = run([.connected, .botBusy(true), .botAudioStart])
        XCTAssertEqual(state.phase, .speaking)
        var step = CallMachine.step(state, .speechCandidate)
        XCTAssertEqual(step.effects, [.duck])
        XCTAssertTrue(step.state.ducked)
        state = step.state
        step = CallMachine.step(state, .speechStart)
        XCTAssertEqual(step.effects, [.cancelSpeech, .earcon(.interrupted), .interruptBot])
        XCTAssertEqual(step.state.phase, .interrupted)
        XCTAssertFalse(step.state.botAudible)
    }

    func testANoiseOverTheBotUnducksIt() {
        let (state, effects) = run([.connected, .botAudioStart, .speechCandidate, .speechCancel])
        XCTAssertEqual(state.phase, .speaking)
        XCTAssertFalse(state.ducked)
        XCTAssertTrue(effects.contains(.unduck))
    }

    func testTalkingWhileTheBotWorksJoinsItsTurnInsteadOfStoppingIt() {
        let step = CallMachine.step(CallMachine.step(.initial, .connected).state, .botBusy(true))
        XCTAssertEqual(step.state.phase, .thinking)
        let talk = CallMachine.step(step.state, .speechStart)
        XCTAssertEqual(talk.effects, [], "the words will join the running turn (a steer), never stop it")
        XCTAssertEqual(talk.state.phase, .hearing)
    }

    func testDuplexTalkingWhileTheBotWorksSilentlyDoesNotInterrupt() {
        var working = CallMachine.step(CallMachine.step(.initial, .connected).state, .botBusy(true)).state
        working.duplex = true
        XCTAssertEqual(working.phase, .thinking)
        let talk = CallMachine.step(working, .speechStart)
        XCTAssertEqual(talk.effects, [])
        XCTAssertEqual(talk.state.phase, .hearing)
        XCTAssertFalse(talk.effects.contains(.interruptBot))
    }

    func testDuplexBargeInDoesNotKillBackgroundWork() {
        var speaking = CallMachine.step(CallMachine.step(.initial, .connected).state, .botBusy(true)).state
        speaking = CallMachine.step(speaking, .botAudioStart).state
        speaking.duplex = true
        speaking.backgroundWork = true
        let barged = CallMachine.step(speaking, .speechStart)
        XCTAssertEqual(barged.effects, [.cancelSpeech, .earcon(.interrupted)])
        XCTAssertFalse(barged.effects.contains(.interruptBot))
        XCTAssertEqual(barged.state.phase, .interrupted)
    }

    func testKillSwitchOffStillInterruptsASpeakingBusyTurnWithAToolChip() {
        var speaking = CallMachine.step(CallMachine.step(.initial, .connected).state, .botBusy(true)).state
        speaking = CallMachine.step(speaking, .botAudioStart).state
        speaking.duplex = false
        speaking.backgroundWork = true
        let barged = CallMachine.step(speaking, .speechStart)
        XCTAssertTrue(barged.effects.contains(.interruptBot))
        XCTAssertEqual(barged.state.phase, .interrupted)
    }

    func testTheInterruptButtonStopsTheVoiceButNotTheTurn() {
        let (state, effects) = run([.connected, .botBusy(true), .botAudioStart, .interrupt])
        XCTAssertEqual(state.phase, .thinking)
        XCTAssertEqual(effects.last, .cancelSpeech)
        XCTAssertFalse(effects.contains(.interruptBot))
    }

    func testMuteClosesTheMicAndDropsTheTurnBeingHeard() {
        let (state, effects) = run([.connected, .speechStart, .mute(true)])
        XCTAssertTrue(state.muted)
        XCTAssertEqual(state.phase, .listening)
        XCTAssertTrue(effects.contains(.mic(open: false)))
        XCTAssertTrue(effects.contains(.cancelSTT))
        let unmuted = CallMachine.step(state, .mute(false))
        XCTAssertEqual(unmuted.effects, [.mic(open: true)])
        // muted: speech is ignored
        XCTAssertEqual(CallMachine.step(state, .speechStart).state, state)
    }

    func testHoldIsSilenceBothWaysAndResumeReopens() {
        let (held, effects) = run([.connected, .botAudioStart, .hold])
        XCTAssertEqual(held.phase, .held)
        XCTAssertEqual(effects.suffix(4), [.cancelSpeech, .cancelSTT, .mic(open: false), .earcon(.hold)])
        XCTAssertEqual(CallMachine.step(held, .botAudioStart).state, held, "nothing is said on hold")
        let resumed = CallMachine.step(held, .resume)
        XCTAssertEqual(resumed.state.phase, .listening)
        XCTAssertEqual(resumed.effects, [.earcon(.resume), .mic(open: true)])
    }

    func testEndReleasesEverythingAndNothingFollows() {
        let (ended, effects) = run([.connected, .end])
        XCTAssertEqual(ended.phase, .ended)
        XCTAssertEqual(effects.suffix(4), [.cancelSpeech, .cancelSTT, .earcon(.ended), .release])
        XCTAssertEqual(CallMachine.step(ended, .speechStart).effects, [])
    }

    func testTheBotFinishingSpeakingRestsOnListeningOrThinking() {
        var (state, _) = run([.connected, .botAudioStart, .botAudioEnd])
        XCTAssertEqual(state.phase, .listening)
        (state, _) = run([.connected, .botBusy(true), .botAudioStart, .botAudioEnd])
        XCTAssertEqual(state.phase, .thinking)
    }
}

// MARK: - Endpointing

final class TurnDetectorTests: XCTestCase {
    private let voiced = TurnFrame(probability: 0.9, level: 0.1)
    private let silent = TurnFrame(probability: 0.05, level: 0.001)

    private func feed(_ detector: TurnDetector, _ frame: TurnFrame, _ count: Int) -> [TurnEvent] {
        (0..<count).compactMap { _ in detector.feed(frame) }
    }

    func testSpeechStartsAfter192MsAndEndsAfter600MsOfSilence() {
        let detector = TurnDetector()
        let start = feed(detector, voiced, 6)
        XCTAssertEqual(start, [.candidate(bargeIn: false), .start(bargeIn: false)])
        XCTAssertEqual(feed(detector, voiced, 10), [])
        // 18 silent frames = 576 ms: not yet
        XCTAssertEqual(feed(detector, silent, 18), [])
        let end = feed(detector, silent, 1)
        guard case let .end(speechMs, endpointMs) = end.first else { return XCTFail("no end: \(end)") }
        XCTAssertEqual(speechMs, 16 * 32)
        XCTAssertEqual(endpointMs, 600)
    }

    func testAClickIsNeverATurn() {
        let detector = TurnDetector()
        XCTAssertEqual(feed(detector, voiced, 2), [.candidate(bargeIn: false)])
        XCTAssertEqual(feed(detector, silent, 3), [.cancel])
        XCTAssertFalse(detector.active)
    }

    func testTooShortASpeechIsCancelledAtItsEnd() {
        let detector = TurnDetector()
        _ = feed(detector, voiced, 7) // 224 ms < 250 ms
        XCTAssertEqual(feed(detector, silent, 19).last, .cancel)
    }

    func testOverTheBotTheBarIsHigherAndEchoNeverCounts() {
        let detector = TurnDetector()
        // 0.6 is speech when the bot is quiet, not over it
        XCTAssertNil(detector.feed(TurnFrame(probability: 0.6, level: 0.1, botAudible: true)))
        // echo is never speech
        XCTAssertNil(detector.feed(TurnFrame(probability: 0.95, level: 0.1, botAudible: true, echo: true)))
        let loud = TurnFrame(probability: 0.95, level: 0.2, botAudible: true)
        let early = TurnDetector()
        XCTAssertEqual(feed(early, loud, 3), [.candidate(bargeIn: true)], "three frames only duck")
        let events = feed(detector, loud, 4)
        XCTAssertEqual(events, [.candidate(bargeIn: true), .start(bargeIn: true)], "a barge-in confirms at 128 ms")
    }

    func testTheEndpointStretchesForSomeoneWhoPausesAndTightensAgain() {
        let detector = TurnDetector()
        _ = feed(detector, voiced, 10)
        _ = feed(detector, silent, 15) // a 480 ms pause inside the turn
        _ = feed(detector, voiced, 10)
        _ = feed(detector, silent, 19)
        XCTAssertEqual(detector.endpointMs, 480 + 160)
        _ = feed(detector, voiced, 10)
        _ = feed(detector, silent, 21)
        XCTAssertEqual(detector.endpointMs, 640 - 24)
    }

    func testTheEchoGuardLearnsTheResidueAndLetsTheLouderPersonThrough() {
        let guardEcho = EchoGuard()
        for _ in 0..<40 { XCTAssertTrue(guardEcho.update(micLevel: 0.02, playbackLevel: 0.3)) }
        XCTAssertEqual(guardEcho.estimate, 0.02 / 0.3, accuracy: 0.01)
        XCTAssertFalse(guardEcho.update(micLevel: 0.3, playbackLevel: 0.3), "the person is far louder than the echo")
        XCTAssertFalse(EchoGuard().update(micLevel: 0.001, playbackLevel: 0), "nothing playing: nothing to guard")
    }

    func testTheLevelDetectorFollowsTheRoom() {
        let vad = LevelVad()
        for _ in 0..<50 { _ = vad.probability(level: 0.003) }
        XCTAssertLessThan(vad.probability(level: 0.003), 0.35)
        XCTAssertGreaterThan(vad.probability(level: 0.05), 0.7)
    }
}

// MARK: - Sentences

final class SentenceStreamTests: XCTestCase {
    func testSentencesComeOutWhileTheAnswerIsWritten() {
        let stream = SentenceStream()
        XCTAssertEqual(stream.feed("Bonjour Owner. Je regarde"), ["Bonjour Owner."])
        XCTAssertEqual(stream.feed("Bonjour Owner. Je regarde ton agenda"), [])
        XCTAssertEqual(stream.feed("Bonjour Owner. Je regarde ton agenda pour demain matin. "), ["Je regarde ton agenda pour demain matin."])
        XCTAssertEqual(stream.finish("Bonjour Owner. Je regarde ton agenda pour demain matin. Rien de prévu."), ["Rien de prévu."])
    }

    func testDecimalsAbbreviationsAndInitialsAreNotBoundaries() {
        let stream = SentenceStream()
        XCTAssertEqual(stream.finish("It costs 3.5 dollars, e.g. a coffee with M. Tremblay and J. Smith today."), [
            "It costs 3.5 dollars, e.g. a coffee with M. Tremblay and J. Smith today.",
        ])
    }

    func testShortLaterSentencesAreJoined() {
        let stream = SentenceStream()
        XCTAssertEqual(stream.finish("First a full sentence here. Yes. No. Maybe so then."), [
            "First a full sentence here.", "Yes. No. Maybe so then.",
        ])
    }

    func testALongFirstSentenceIsCutAtACommaToStartSooner() {
        let long = String(repeating: "word ", count: 20) + "and more, then the rest of it"
        let stream = SentenceStream()
        let out = stream.feed(long + " goes on")
        XCTAssertEqual(out.count, 1)
        XCTAssertTrue(out[0].hasSuffix("and more,"))
    }

    func testCodeIsSkippedAndMarkdownIsNotRead() {
        let stream = SentenceStream()
        let text = "Here is **the** fix:\n\n```swift\nlet x = 1\n```\n\n- See [the docs](https://example.com) 🎉\n- Done"
        XCTAssertEqual(stream.finish(text), ["Here is the fix:", "See the docs Done"], "the short list items are joined")
    }

    func testTheWrittenFollowUpBelowTheRuleIsNeverSpoken() {
        XCTAssertEqual(SpokenText.spokenPart("Bye for now!\n---\n## Details\n- a"), "Bye for now!\n")
        XCTAssertEqual(SpokenText.spokenPart("No rule here."), "No rule here.")
    }

    func testSpeakableDropsLinksEmojiTablesAndHeadings() {
        XCTAssertEqual(SpokenText.speakableSentence("## Title"), "Title")
        XCTAssertEqual(SpokenText.speakableSentence("Visit https://x.y/z now 🚀"), "Visit now")
        XCTAssertEqual(SpokenText.speakableSentence("| a | b |\n|---|---|\n| 1 | 2 |"), "a, b 1, 2")
        XCTAssertEqual(SpokenText.speakableSentence("```\ncode\n```"), "")
        XCTAssertEqual(SpokenText.speakableSentence("*really* `ok`"), "really ok")
    }
}

// MARK: - The engine: full duplex, barge-in, push to talk

@MainActor
private final class FakeTranscriber: CallTranscribing {
    var words = ""
    var began = 0
    var pushed = 0
    var discarded = 0
    func begin(preroll: [[Float]]) { began += 1; pushed += preroll.count }
    func push(_ frame: [Float]) { pushed += 1 }
    func finish() async -> String { words }
    func discard() { discarded += 1 }
    func close() {}
}

@MainActor
private final class FakePlayer: CallSpeaking {
    var queued: [String] = []
    var playing = false
    var ducks = 0
    var unducks = 0
    var cancels = 0
    var tones: [CallEarcon] = []
    var busy: Bool { playing || !queued.isEmpty }
    func level() -> Float { 0 }
    func enqueue(_ sentence: String) { queued.append(sentence) }
    func duck() { ducks += 1 }
    func unduck() { unducks += 1 }
    func cancel() { cancels += 1; queued = []; playing = false }
    func tone(_ earcon: CallEarcon) { tones.append(earcon) }
    func close() {}
    var played = PlaybackCut()
    var ledgerResets = 0
    func playback(speed: Double) -> PlaybackCut { played }
    func resetLedger() { ledgerResets += 1 }
}

@MainActor
final class LiveCallEngineTests: XCTestCase {
    private var transcriber: FakeTranscriber!
    private var player: FakePlayer!
    private var engine: LiveCallEngine!
    private var input = CallSettings.Input.auto
    private var sent: [(String, Bool)] = []
    private var turns: [CallTurn] = []
    private var clock: TimeInterval = 1_000
    private var cuts: [PlaybackCut] = []
    private var interrupts = 0
    private var cancelled = 0

    override func setUp() async throws {
        transcriber = FakeTranscriber()
        player = FakePlayer()
        engine = LiveCallEngine(transcriber: transcriber, player: player, settings: { [unowned self] in CallSettings(input: input) }, now: { [unowned self] in clock })
        engine.events.utterance = { [unowned self] turn in
            sent.append((turn.text, turn.interrupted))
            turns.append(turn)
        }
        engine.events.interruptBot = { [unowned self] in interrupts += 1 }
        engine.events.speechCancelled = { [unowned self] cut in
            cancelled += 1
            cuts.append(cut)
        }
        engine.connected()
    }

    private let speech = [Float](repeating: 0.15, count: 512).enumerated().map { $0.offset % 2 == 0 ? $0.element : -$0.element }
    private let quiet = [Float](repeating: 0.0005, count: 512)

    private func say(_ frames: Int) { for _ in 0..<frames { clock += 0.032; engine.frame(speech) } }
    private func silence(_ frames: Int) { for _ in 0..<frames { clock += 0.032; engine.frame(quiet) } }

    private func settle() async {
        for _ in 0..<5 { await Task.yield() }
    }

    func testTheMicIsAlwaysOpenAndAPauseEndsTheTurn() async {
        silence(20)
        transcriber.words = "What's on my calendar?"
        say(15)
        XCTAssertEqual(engine.state.phase, .hearing)
        silence(30) // Normal: a 700 ms pause ends the turn
        await settle()
        XCTAssertEqual(sent.map(\.0), ["What's on my calendar?"])
        XCTAssertEqual(sent.first?.1, false)
        XCTAssertEqual(engine.state.phase, .thinking)
        XCTAssertGreaterThan(transcriber.pushed, 15, "the preroll and the turn reach the recognizer")
    }

    func testTheAnswerIsSpokenSentenceBySentenceWhileItStreams() async {
        engine.setBotBusy(true)
        engine.replyProgress("Sure. Let me")
        XCTAssertEqual(player.queued, ["Sure."])
        engine.replyProgress("Sure. Let me check your calendar for tomorrow. It")
        XCTAssertEqual(player.queued, ["Sure.", "Let me check your calendar for tomorrow."])
        player.playing = true
        engine.playerSentenceStarted("Sure.")
        XCTAssertEqual(engine.state.phase, .speaking)
        let done = Task { await engine.replyDone("Sure. Let me check your calendar for tomorrow. It is free, nothing is booked.") }
        await settle()
        XCTAssertEqual(player.queued.last, "It is free, nothing is booked.")
        player.playing = false
        player.queued = []
        engine.playerIdle()
        let heard = await done.value
        XCTAssertTrue(heard)
    }

    func testAPauseMidSentenceIsOneUtteranceSentWhole() async {
        silence(20)
        transcriber.words = "Give me a good prompt"
        say(15)
        silence(30)
        await settle()
        XCTAssertEqual(sent.map(\.0), ["Give me a good prompt"])
        engine.setBotBusy(true)
        // the person goes on 1 s later, before the bot said anything
        transcriber.words = "for a cover letter."
        say(15)
        silence(30)
        await settle()
        XCTAssertEqual(turns.last?.text, "Give me a good prompt for a cover letter.", "sent whole")
        XCTAssertEqual(turns.last?.continues, true)
        XCTAssertEqual(interrupts, 1, "the fragment's turn is stopped")
    }

    func testAnUnfinishedClauseWaitsLongerThanTheNormalPause() async {
        silence(20)
        transcriber.words = "I want to"
        say(15)
        engine.partial("I want to")
        silence(24) // 768 ms: past Normal's 700, inside 700 + 750
        await settle()
        XCTAssertTrue(sent.isEmpty, "\"to\" does not end a sentence")
        silence(30)
        await settle()
        XCTAssertEqual(sent.map(\.0), ["I want to"])
    }

    func testAHesitationIsIgnoredButAShortNameReachesTheBot() async {
        silence(20)
        transcriber.words = "euh"
        say(15)
        silence(30)
        await settle()
        XCTAssertTrue(sent.isEmpty)
        transcriber.words = "Julie"
        say(15)
        silence(30)
        await settle()
        XCTAssertEqual(sent.map(\.0), ["Julie"], "a name is a real one-word answer")
    }

    func testTalkingOverTheBotCutsItAndTheNextTurnSaysSo() async {
        silence(20)
        engine.setBotBusy(true)
        engine.replyProgress("A long answer that goes on. And then it keeps going without")
        player.playing = true
        player.played = PlaybackCut(heard: "A long answer", unheard: "that goes on.")
        engine.playerSentenceStarted("A long answer that goes on.")
        transcriber.words = "Stop, actually do something else"
        say(1)
        XCTAssertEqual(player.ducks, 1, "the bot is lowered on the first voiced frame")
        say(6)
        XCTAssertEqual(player.cancels, 1)
        XCTAssertEqual(cancelled, 1)
        XCTAssertEqual(interrupts, 1, "the bot's running turn is interrupted")
        XCTAssertEqual(engine.state.phase, .interrupted)
        say(5)
        silence(30)
        await settle()
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent.first?.1, true, "the turn is marked interrupted")
        XCTAssertEqual(turns.first?.cut?.heard, "A long answer", "the bot is told what was heard")
        XCTAssertEqual(turns.first?.cut?.unheard, "that goes on. And then it keeps going without", "and what was not, written but unsaid included")
    }

    /// A real recording (a French question said by a voice): one turn,
    /// heard from its first word and ended by the pause after it.
    func testARecordedQuestionIsExactlyOneTurn() async throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "call-question", withExtension: "wav", subdirectory: "Fixtures")
            ?? Bundle.module.url(forResource: "call-question", withExtension: "wav"))
        let wav = try XCTUnwrap(CallWav.decode(Data(contentsOf: url)))
        XCTAssertEqual(wav.sampleRate, 16_000)
        transcriber.words = "Bonjour Ara, où en est le projet cette semaine?"
        silence(30)
        var samples = wav.samples
        samples += [Float](repeating: 0.0004, count: 16_000) // a second of quiet room
        var phases: [CallPhase] = []
        engine.events.state = { phases.append($0.phase) }
        stride(from: 0, to: samples.count - 511, by: 512).forEach { engine.frame(Array(samples[$0..<($0 + 512)])) }
        await settle()
        XCTAssertEqual(sent.map(\.0), ["Bonjour Ara, où en est le projet cette semaine?"], "one turn, not one per word")
        XCTAssertEqual(phases.filter { $0 == .hearing }.count, 1)
        XCTAssertEqual(transcriber.discarded, 0, "no noise was taken for speech")
    }

    func testMutedFramesAreIgnored() async {
        engine.setMuted(true)
        transcriber.words = "secret"
        say(20)
        silence(20)
        await settle()
        XCTAssertTrue(sent.isEmpty)
    }

    func testPushToTalkSendsWhatWasSaidWhileHeld() async {
        input = .push
        transcriber.words = "Push to talk works"
        say(5)
        XCTAssertEqual(engine.state.phase, .listening, "hands-free detection is off")
        engine.pushToTalk(true)
        XCTAssertEqual(engine.state.phase, .hearing)
        say(5)
        engine.pushToTalk(false)
        await settle()
        XCTAssertEqual(sent.map(\.0), ["Push to talk works"])
    }

    func testSayWaitsUntilHeardAndACutResolvesFalse() async {
        let said = Task { await engine.say("Is that a yes or a no?") }
        await settle()
        XCTAssertEqual(player.queued, ["Is that a yes or a no?"])
        player.playing = true
        engine.playerSentenceStarted("Is that a yes or a no?")
        engine.interrupt()
        let heard = await said.value
        XCTAssertFalse(heard)
    }
}

// MARK: - The conversation around the call

final class PlaybackCutTests: XCTestCase {
    func testTheCutLandsOnAWordByTheAudioClock() {
        let ledger: [(text: String, start: Double?, end: Double?, complete: Bool)] = [
            ("First sentence here.", 0, 2, true),
            ("Second one is cut halfway through.", 2, 6, true),
            ("Third never started.", nil, nil, false),
        ]
        let cut = PlaybackCut.measure(ledger, now: 4)
        XCTAssertEqual(cut.heard, "First sentence here. Second one is cut")
        XCTAssertEqual(cut.unheard, "halfway through. Third never started.")
        XCTAssertEqual(PlaybackCut.split("one", at: 0.2).1, "one")
        XCTAssertEqual(PlaybackCut.split("one", at: 0.8).0, "one")
    }

    func testUnfinishedClausesAndPausePresets() {
        XCTAssertTrue(ClauseCheck.incomplete("give me a good prompt to"))
        XCTAssertTrue(ClauseCheck.incomplete("je voudrais un rendez-vous pour"))
        XCTAssertTrue(ClauseCheck.incomplete("well,"))
        XCTAssertTrue(ClauseCheck.incomplete("so"))
        XCTAssertFalse(ClauseCheck.incomplete("What time is it?"))
        XCTAssertFalse(ClauseCheck.incomplete("book the meeting room tomorrow morning"))
        XCTAssertFalse(ClauseCheck.incomplete(""))
        let detector = TurnDetector()
        detector.setPause(.patient)
        XCTAssertEqual(detector.endpointMs, 800 + (600 - 480) / Double(900 - 480) * 700, accuracy: 1)
        XCTAssertEqual(CallSettings.decode(CallSettings(pause: .short).encoded).pause, .short)
        XCTAssertEqual(CallSettings.decode(#"{"input":"auto"}"#).pause, .normal)
    }

    /// The settings card's Advanced zone starts folded and is remembered
    /// with the call's settings (the desktop's `advancedOpen`).
    func testAdvancedZoneIsFoldedByDefaultAndRemembered() {
        XCTAssertFalse(CallSettings.default.advancedOpen)
        XCTAssertFalse(CallSettings.decode(nil).advancedOpen)
        XCTAssertFalse(CallSettings.decode(#"{"input":"push","earcons":false,"pause":"short"}"#).advancedOpen)
        XCTAssertTrue(CallSettings.decode(#"{"advancedOpen":true}"#).advancedOpen)
        let open = CallSettings(input: .push, earcons: false, pause: .patient, advancedOpen: true)
        XCTAssertEqual(CallSettings.decode(open.encoded), open)
        XCTAssertTrue(open.encoded.contains(#""advancedOpen":true"#))
    }

    func testNoiseFragments() {
        for text in ["", "...", "Hm.", "mm-hmm", "euh"] {
            XCTAssertTrue(CallNoise.isFragment(text), text)
        }
        for text in ["Steve", "Julie", "Grok", "lundi", "mardi", "aide", "A", "你好", "نعم"] {
            XCTAssertFalse(CallNoise.isFragment(text), text)
        }
        XCTAssertTrue(CallNoise.isFragment("call Max", confidence: 0.2))
        XCTAssertFalse(CallNoise.isFragment("Merci"))
        XCTAssertFalse(CallNoise.isFragment("42"))
        XCTAssertFalse(CallNoise.isFragment("What about tomorrow"))
    }
}

final class CallConversationTests: XCTestCase {
    private func text(_ id: String, _ body: String, role: Message.Role = .bot, from: String? = nil) -> Message {
        var message = Message(id: id, role: role, kind: .text, at: 0)
        message.text = body
        if let from { message.from = Sender(botId: from, name: from.capitalized, color: "blue") }
        return message
    }

    private func approval(_ id: String, requestId: String, skill: Bool = false) -> Message {
        var message = Message(id: id, role: .bot, kind: .options, at: 0)
        var card = OptionCard(title: "Run a command", subtitle: "ls -la", options: ["Allow", "Deny"])
        card.requestId = requestId
        card.tool = "Bash"
        message.card = card
        return message
    }

    func testTheBacklogIsNeverRecited() {
        var conversation = CallConversation(existing: [text("a", "Old answer")])
        XCTAssertEqual(conversation.settle(messages: [text("a", "Old answer")], botName: "Ara", thinking: false, playerBusy: false), [])
    }

    func testANewAnswerIsSpokenOnceAndOnlyWhatTheStreamHadNotSaid() {
        var conversation = CallConversation(existing: [])
        XCTAssertEqual(conversation.stream("Hello the"), "Hello the")
        let messages = [text("u", "Hi", role: .user), text("b", "Hello there.")]
        XCTAssertEqual(conversation.settle(messages: messages, botName: "Ara", thinking: true, playerBusy: false), [.replyDone("Hello there.", speakerId: nil)])
        XCTAssertEqual(conversation.settle(messages: messages, botName: "Ara", thinking: true, playerBusy: false), [])
    }

    func testABargeInDropsTheRestOfThatAnswerUntilTheNextTurn() {
        var conversation = CallConversation(existing: [])
        XCTAssertNotNil(conversation.stream("A long answer"))
        conversation.speechCancelled(currentStream: "A long answer", cut: PlaybackCut(heard: "A long", unheard: "answer"))
        XCTAssertNil(conversation.stream("A long answer that keeps going"), "the cut block is not spoken")
        let settled = conversation.settle(messages: [text("u", "Q", role: .user), text("b", "A long answer that keeps going.")], botName: "Ara", thinking: true, playerBusy: false)
        XCTAssertEqual(settled, [])
        XCTAssertEqual(conversation.interrupted, ["b"])
        XCTAssertEqual(conversation.unheard["b"], "answer", "the words not heard stay on the cut answer")
        XCTAssertEqual(conversation.utterance("Something else"), .send("Something else"))
        XCTAssertEqual(conversation.stream("New"), "New", "a new answer streams again")
    }

    func testADyingTurnAfterTheNextSendIsNeverSpoken() {
        var conversation = CallConversation(existing: [])
        conversation.speechCancelled(currentStream: "Once upon a time")
        XCTAssertEqual(conversation.utterance("what about the weather"), .send("what about the weather"))
        XCTAssertNil(conversation.stream("Once upon a time, there was a llama"))
        let dying = text("a", "Once upon a time.")
        var answer = text("b", "It is sunny.")
        answer.requestMessageId = "uB"
        let late = conversation.settle(
            messages: [text("uA", "tell me a story", role: .user), text("uB", "what about the weather", role: .user), dying],
            botName: "Ara", thinking: true, playerBusy: false
        )
        XCTAssertEqual(late, [])
        XCTAssertEqual(conversation.interrupted, ["a"])
        let spoken = conversation.settle(
            messages: [text("uA", "tell me a story", role: .user), text("uB", "what about the weather", role: .user), dying, answer],
            botName: "Ara", thinking: true, playerBusy: false
        )
        XCTAssertEqual(spoken, [.replyDone("It is sunny.", speakerId: nil)])
    }

    func testAnOlderTopicResultIsAnnouncedNotSpokenInFull() {
        var conversation = CallConversation(existing: [])
        let requestA = text("uA", "look up the weather in Montreal", role: .user)
        var requestB = text("uB", "what time is it in Tokyo", role: .user)
        requestB.parallelTask = ParallelTaskRef(threadId: "p", title: "time", requestMessageId: "uB", role: "request")
        var resultB = text("bB", "It is morning in Tokyo.")
        resultB.parallelTask = ParallelTaskRef(threadId: "p", title: "time", requestMessageId: "uB", role: "result")
        let first = conversation.settle(messages: [requestA, requestB, resultB], botName: "Ara", thinking: true, playerBusy: false)
        XCTAssertEqual(first, [.replyDone("It is morning in Tokyo.", speakerId: nil)])
        let resultA = text("bA", "It is 12 and sunny in Montreal.")
        let second = conversation.settle(messages: [requestA, requestB, resultB, resultA], botName: "Ara", thinking: true, playerBusy: false)
        XCTAssertEqual(second, [.announce("For look up the weather in Montreal: It is 12 and sunny in Montreal.", speakerId: nil)])
    }

    func testBargeInDuringSpeechStillAnnouncesABackgroundResult() {
        var conversation = CallConversation(existing: [])
        conversation.speechCancelled(currentStream: "It is morning in Tokyo")
        let requestA = text("uA", "look up the weather in Montreal", role: .user)
        var requestB = text("uB", "what time is it in Tokyo", role: .user)
        requestB.parallelTask = ParallelTaskRef(threadId: "p", title: "time", requestMessageId: "uB", role: "request")
        let resultA = text("bA", "It is 12 and sunny in Montreal.")
        let out = conversation.settle(messages: [requestA, requestB, resultA], botName: "Ara", thinking: true, playerBusy: false)
        XCTAssertEqual(out, [.announce("For look up the weather in Montreal: It is 12 and sunny in Montreal.", speakerId: nil)])
    }

    func testOnlyALiveParallelCardIsBackgroundWork() {
        var chip = Message(id: "t", role: .bot, kind: .activity, at: 0)
        chip.tool = ToolActivity(name: "Bash")
        XCTAssertFalse(CallConversation.hasBackgroundWork([chip]))
        chip.tool = ToolActivity(name: "Bash", ok: true)
        XCTAssertFalse(CallConversation.hasBackgroundWork([chip]))
        var card = Message(id: "c", role: .bot, kind: .text, at: 0)
        card.parallelTask = ParallelTaskRef(threadId: "p", title: "weather", requestMessageId: "uA", role: "card", state: "running")
        XCTAssertTrue(CallConversation.hasBackgroundWork([card]))
    }

    func testThinkingBargeInIgnoresALateDeltaUntilTheStreamClears() {
        var conversation = CallConversation(existing: [])
        conversation.botInterrupted(currentStream: "")
        XCTAssertNil(conversation.stream("Once upon a time, there was a llama"))
        XCTAssertNil(conversation.stream(""))
        XCTAssertEqual(conversation.stream("It is sunny."), "It is sunny.")
    }

    func testAOneBotCallNeverReadsTheServersToolNarration() {
        var conversation = CallConversation(existing: [])
        var chip = Message(id: "t", role: .bot, kind: .activity, at: 0)
        chip.tool = ToolActivity(name: "Bash", spoken: "running helpdesk__find_tickets")
        XCTAssertEqual(conversation.settle(messages: [chip], botName: "Ara", thinking: true, playerBusy: true, duplex: true), [])
        XCTAssertEqual(conversation.settle(messages: [chip], botName: "Ara", thinking: true, playerBusy: false), [])
    }

    func testAnApprovalIsAskedAndAnsweredYesOrNoOnly() {
        var conversation = CallConversation(existing: [])
        let card = approval("c", requestId: "r1")
        let actions = conversation.settle(messages: [card], botName: "Ara", thinking: true, playerBusy: false)
        guard case let .say(.approval(requester, kind, tool, _, detail, _), _) = actions.first else { return XCTFail("\(actions)") }
        XCTAssertEqual(requester, "Ara")
        XCTAssertEqual(kind, .command)
        XCTAssertEqual(tool, "Bash")
        XCTAssertEqual(detail, "ls -la")
        XCTAssertFalse(conversation.mayInterruptBot(busy: true), "an approval being answered keeps its turn")
        // a hedge with a condition is not consent: the options are asked again
        XCTAssertEqual(conversation.utterance("sure thing, but first tell me why"), .say(.allowOnceOrDeny))
        XCTAssertEqual(conversation.utterance("yes, go ahead"), .decide(requestId: "r1", allow: true))
        var other = CallConversation(existing: [])
        _ = other.settle(messages: [card], botName: "Ara", thinking: true, playerBusy: false)
        XCTAssertEqual(other.utterance("what does it do?"), .say(.allowOnceOrDeny))
        XCTAssertEqual(other.utterance("non merci"), .decide(requestId: "r1", allow: false))
        XCTAssertEqual(other.decisionFailed(requestId: "r1"), .approvalFailed)
    }

    func testASpokenApprovalMustPickOneOfTheTwoOptions() {
        for said in ["yes", "Yes, go ahead.", "allow once", "uh, yes please", "okay, do it", "Oui, vas-y.", "autoriser une fois", "j\u{2019}autorise", "ben oui", "je confirme"] {
            XCTAssertEqual(CallAnswers.decision(said), true, said)
        }
        for said in ["no", "No, don't do that.", "non merci", "je refuse", "pas question", "don't do it", "okay no"] {
            XCTAssertEqual(CallAnswers.decision(said), false, said)
        }
        for said in ["okay", "sure", "d'accord", "", "yes, but rename it first", "yes wait no", "oui mais pas ce fichier-là",
                     "no wait, yes", "non, vas-y", "non, plutôt l'autre", "always allow", "toujours autoriser", "yesterday was fine", "nonsense"] {
            XCTAssertNil(CallAnswers.decision(said), said)
        }
    }

    func testIdentifiersAreNeverSpoken() {
        func say(_ text: String) -> String {
            SpokenIdentifiers.strip(text).replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)
        }
        XCTAssertEqual(say("The thread 3f2a9c1e-7b4d-4e2a-9f10-0c5b8d7e6a21 is archived."), "The thread is archived.")
        XCTAssertEqual(say("Fixed in commit 9fceb02d0ae598e95dc970b74767f19372d61af8."), "Fixed in commit.")
        XCTAssertEqual(say("Use whsec_Q2x9vLm4Tz8Kp1Rb7Yw3 now"), "Use now")
        XCTAssertEqual(say("The call call-0123456789 ended"), "The call ended")
        XCTAssertEqual(say("The printer ticket (#481516) is closed."), "The printer ticket is closed.")
        XCTAssertEqual(say("The member (id: 4242) answered."), "The member answered.")
        XCTAssertEqual(say("Saved to /Users/someone/Documents/report.pdf for you."), "Saved to report.pdf for you.")
        XCTAssertEqual(say("Copied to C:\\Users\\someone\\Desktop\\notes.txt"), "Copied to notes.txt")
        for text in ["It costs 1,250.50 dollars and is due 2026-10-17 at 15:30.", "Call 514-555-0123 tomorrow.",
                     "C'est 24/7, en km/h.", "The decade of facade internationalization, COVID-19 and the ed25519 key.",
                     "We are at 3 of 10, PR 702 is open.", "L'idée est bonne, I'd say so."] {
            XCTAssertEqual(say(text), text)
        }
        XCTAssertEqual(SpokenText.speakableSentence("Done, commit **9fceb02d0ae5** (id: 3f2a9c1e-7b4d-4e2a-9f10-0c5b8d7e6a21)."), "Done, commit.")
    }

    func testAQuestionIsAnsweredWithTheNextWords() {
        var conversation = CallConversation(existing: [])
        var question = Message(id: "q", role: .bot, kind: .options, at: 0)
        var card = OptionCard(title: "Pick", subtitle: "Which day?", options: ["Monday", "Tuesday"])
        card.requestId = "rq"
        question.card = card
        let actions = conversation.settle(messages: [question], botName: "Ara", thinking: true, playerBusy: false)
        XCTAssertEqual(actions, [.say(.question(requester: "Ara", subtitle: "Which day?", options: ["Monday", "Tuesday"]), speakerId: nil)])
        XCTAssertEqual(conversation.utterance("Tuesday"), .answer(requestId: "rq", messageId: "q", text: "Tuesday"))
    }

    func testAProgressLineComesFromTheTurnsRunningToolThenWaitsForSilence() {
        final class Clock: @unchecked Sendable { var now: Double = 0 }
        let clock = Clock()
        var conversation = CallConversation(existing: [])
        conversation.clock = { clock.now }
        XCTAssertEqual(conversation.utterance("peux-tu regarder mes billets"), .send("peux-tu regarder mes billets"))
        var user = Message(id: "u", role: .user, kind: .text, at: 0)
        user.text = "peux-tu regarder mes billets"
        var chip = Message(id: "t", role: .bot, kind: .activity, at: 0)
        chip.tool = ToolActivity(name: "mcp__helpdesk__find_tickets", spoken: "running find_tickets")
        // just started: nothing yet
        XCTAssertEqual(conversation.settle(messages: [user, chip], botName: "Ara", thinking: true, playerBusy: false), [])
        clock.now = CallProgress.firstMs
        XCTAssertEqual(conversation.progressLine(messages: [user, chip], thinking: true, botBusy: true, playerBusy: true), nil, "never over the bot's voice")
        clock.now = CallProgress.firstMs + 100
        XCTAssertEqual(conversation.progressLine(messages: [user, chip], thinking: true, botBusy: true, playerBusy: false), .kind(.search))
        clock.now += 1_000
        XCTAssertNil(conversation.progressLine(messages: [user, chip], thinking: true, botBusy: true, playerBusy: false), "one line per gap")
        // the bot's own words stream: the silence starts over
        clock.now += CallProgress.gapMs
        XCTAssertEqual(conversation.stream("Je regarde"), "Je regarde")
        clock.now += CallProgress.quietMs - 1
        XCTAssertNil(conversation.progressLine(messages: [user, chip], thinking: true, botBusy: true, playerBusy: false))
        clock.now += 1
        XCTAssertEqual(conversation.progressLine(messages: [user, chip], thinking: true, botBusy: true, playerBusy: false), .still)
        // a barge-in stops them until the next turn
        conversation.speechCancelled(currentStream: nil)
        clock.now += CallProgress.gapMs * 2
        XCTAssertNil(conversation.progressLine(messages: [user, chip], thinking: true, botBusy: true, playerBusy: false))
    }

    func testTheFirstProgressLineIsQuickWhenNothingWasSaid() {
        var progress = CallProgress()
        progress.turnSent(now: 0)
        let tools = [CallProgress.Tool(id: "a", name: "Bash")]
        XCTAssertNil(progress.next(now: 0, thinking: true, botBusy: true, botSpeaking: false, awaitingAnswer: false, tools: tools))
        XCTAssertNil(progress.next(now: CallProgress.firstMs - 1, thinking: true, botBusy: true, botSpeaking: false, awaitingAnswer: false, tools: tools))
        XCTAssertEqual(progress.next(now: CallProgress.firstMs, thinking: true, botBusy: true, botSpeaking: false, awaitingAnswer: false, tools: tools), .kind(.command))
        // an approval waiting: nothing
        var waiting = CallProgress()
        waiting.turnSent(now: 0)
        _ = waiting.next(now: 0, thinking: true, botBusy: true, botSpeaking: false, awaitingAnswer: false, tools: tools)
        XCTAssertNil(waiting.next(now: 5_000, thinking: true, botBusy: true, botSpeaking: false, awaitingAnswer: true, tools: tools))
        // the bot's own words came first: no quick line
        var spoke = CallProgress()
        spoke.turnSent(now: 0)
        spoke.heard(now: 100)
        _ = spoke.next(now: 100, thinking: true, botBusy: true, botSpeaking: false, awaitingAnswer: false, tools: tools)
        XCTAssertNil(spoke.next(now: 2_000, thinking: true, botBusy: true, botSpeaking: false, awaitingAnswer: false, tools: tools))
    }

    func testProgressLinesCountRealStepsAndStopAtFive() {
        var progress = CallProgress()
        progress.turnSent(now: 0)
        var now: Double = 0
        func tick(_ tools: [CallProgress.Tool]) -> CallProgressLine? {
            now += CallProgress.gapMs
            return progress.next(now: now, thinking: true, botBusy: true, botSpeaking: false, awaitingAnswer: false, tools: tools)
        }
        _ = progress.next(now: 0, thinking: true, botBusy: true, botSpeaking: false, awaitingAnswer: false, tools: [.init(id: "a", name: "Read")])
        XCTAssertEqual(tick([.init(id: "a", name: "Read")]), .kind(.check))
        XCTAssertEqual(tick([.init(id: "a", name: "Read", ok: true), .init(id: "b", name: "Bash")]), .kind(.command))
        let three: [CallProgress.Tool] = [.init(id: "a", name: "Read", ok: true), .init(id: "b", name: "Bash", ok: true), .init(id: "c", name: "Bash")]
        XCTAssertEqual(tick(three), .steps(2))
        XCTAssertEqual(tick(three), .still)
        XCTAssertEqual(tick(three), .still)
        XCTAssertNil(tick(three), "five lines a turn at most")
    }

    func testAToolNameIsOnlyEverACategory() {
        XCTAssertEqual(CallProgress.kind("Bash"), .command)
        XCTAssertEqual(CallProgress.kind("Edit"), .change)
        XCTAssertEqual(CallProgress.kind("WebSearch"), .web)
        XCTAssertEqual(CallProgress.kind("mcp__helpdesk__find_tickets"), .search)
        XCTAssertEqual(CallProgress.kind("psa__update_ticket"), .change)
        XCTAssertEqual(CallProgress.kind("tickets.list"), .check)
        XCTAssertEqual(CallProgress.kind("createInvoice"), .change)
        XCTAssertEqual(CallProgress.kind("mcp__x__frobnicate"), .work)
        XCTAssertNil(CallProgress.kind("end_call"))
        XCTAssertNil(CallProgress.kind("AskUserQuestion"))
        XCTAssertNil(CallProgress.kind("TodoWrite"))
        XCTAssertNil(CallProgress.kind("auto-approved: Bash"))
        XCTAssertNil(CallProgress.kind(""))
    }

    func testProgressLinesFollowTheCallsLanguageNotTheApps() {
        // a picked language wins over the app's
        XCTAssertEqual(CallProgress.language(callLanguage: "fr", lastUserText: "what is next", appLanguage: "en"), "fr")
        XCTAssertEqual(CallProgress.language(callLanguage: "pt-BR", lastUserText: nil, appLanguage: "fr"), "pt-BR")
        // auto: an English or French app follows the person's last words
        XCTAssertEqual(CallProgress.language(callLanguage: "auto", lastUserText: "Peux-tu vérifier mes billets?", appLanguage: "en"), "fr")
        XCTAssertEqual(CallProgress.language(callLanguage: "auto", lastUserText: "check my tickets please", appLanguage: "fr"), "en")
        XCTAssertEqual(CallProgress.language(callLanguage: "auto", lastUserText: "est-ce que tu peux le faire", appLanguage: "en"), "fr")
        // auto with nothing said yet, or another app language: the app's
        XCTAssertEqual(CallProgress.language(callLanguage: "auto", lastUserText: nil, appLanguage: "fr"), "fr")
        XCTAssertEqual(CallProgress.language(callLanguage: "auto", lastUserText: "check my tickets", appLanguage: "pt-BR"), "pt-BR")
    }

    func testTheLanguageGuessReadsThePersonsLastOwnLine() {
        var earlier = Message(id: "u0", role: .user, kind: .text, at: 0)
        earlier.text = "Bonjour, je veux voir mes billets"
        var last = Message(id: "u1", role: .user, kind: .text, at: 1)
        last.text = "and the invoices too"
        var reply = Message(id: "b", role: .bot, kind: .text, at: 2)
        reply.text = "Je regarde."
        XCTAssertEqual(CallProgress.lastUserText([earlier, last, reply]), "and the invoices too")
        XCTAssertFalse(CallProgress.looksFrench("and the invoices too"))
        XCTAssertTrue(CallProgress.looksFrench("Bonjour, je veux voir mes billets"))
        XCTAssertFalse(CallProgress.looksFrench("on the plus side"), "English words that are also French ones never count")
    }

    func testARoomStillReadsItsMembersNarratedSteps() {
        var conversation = CallConversation(existing: [], room: true)
        var chip = Message(id: "t", role: .bot, kind: .activity, at: 0)
        chip.tool = ToolActivity(name: "Bash", spoken: "Checking your calendar")
        XCTAssertEqual(conversation.settle(messages: [chip], botName: "Room", thinking: false, playerBusy: true), [.narrate("Checking your calendar", speakerId: nil)])
    }

    func testARoomSpeaksEveryMemberInTurnAndRoutesNames() {
        var conversation = CallConversation(existing: [], room: true)
        XCTAssertNil(conversation.stream("partial"), "a room speaks settled replies, in turn")
        let replies = [text("u", "@everyone hi", role: .user), text("a", "Hi from Ara.", from: "ara"), text("h", "Hi from Helios.", from: "helios")]
        XCTAssertEqual(conversation.settle(messages: replies, botName: "Room", thinking: false, playerBusy: true), [
            .reply("Hi from Ara.", speakerId: "ara"), .reply("Hi from Helios.", speakerId: "helios"),
        ])
        XCTAssertEqual(conversation.utterance("Helios, what's the status?", memberNames: ["Ara", "Helios"]), .send("@Helios what's the status?"))
        XCTAssertEqual(conversation.utterance("everyone, good morning", memberNames: ["Ara", "Helios"]), .send("@everyone good morning"))
        XCTAssertEqual(conversation.utterance("good morning", memberNames: ["Ara"], mentionsOnly: true), .needsName)
    }

    func testGroupRoutingMatchesTheDesktop() {
        XCTAssertEqual(GroupCallRouting.route("hey Ara can you check", memberNames: ["Ara", "Helios"]), SpokenGroupMessage(text: "@Ara can you check", addressed: true))
        XCTAssertEqual(GroupCallRouting.route("@Helios go", memberNames: ["Ara", "Helios"]), SpokenGroupMessage(text: "@Helios go", addressed: true))
        XCTAssertEqual(GroupCallRouting.route("all", memberNames: []), SpokenGroupMessage(text: "@everyone", addressed: true))
        XCTAssertEqual(GroupCallRouting.route("what now", memberNames: ["Ara"]), SpokenGroupMessage(text: "what now", addressed: false))
    }
}

// MARK: - Settings, voices and the wire

final class VoiceModeWireTests: XCTestCase {
    func testSettingsKeepTheDesktopShapeAndDefaultWhatIsInvalid() {
        XCTAssertEqual(VoiceModeSettings.decode(#"{"voice":"eve","speed":1.25,"language":"fr"}"#), VoiceModeSettings(voice: "eve", speed: 1.25, language: "fr"))
        XCTAssertEqual(VoiceModeSettings.decode(#"{"voice":"bad id!","speed":9,"language":"xx"}"#), .default)
        XCTAssertEqual(VoiceModeSettings.decode(VoiceModeSettings(voice: "ara", speed: 0.75, language: "en").encoded).speed, 0.75)
        XCTAssertEqual(VoiceModeSettings.speedLabel(1), "1x")
        XCTAssertEqual(VoiceModeSettings.speedLabel(1.25), "1.25x")
        XCTAssertEqual(CallSettings.decode(CallSettings(input: .push, earcons: false).encoded), CallSettings(input: .push, earcons: false))
        XCTAssertEqual(formatCallTime(65), "1:05")
        XCTAssertEqual(formatCallTime(3725), "1:02:05")
    }

    /// 2026-10-29: the desktop's providers travel through the phone untouched,
    /// and a bot's voice is the one of its provider.
    func testProvidersOfTheDesktopSurviveThePhoneAndPickTheBotsVoice() {
        let raw = #"{"bots":{"b-1":{"tts":"elevenlabs","voices":{"elevenlabs":"myClone"}}},"language":"fr","speed":1,"tts":"openai","voice":"eve","voices":{"openai":"cedar"}}"#
        var settings = VoiceModeSettings.decode(raw)
        XCTAssertEqual(settings.voice, "eve")
        XCTAssertEqual(settings.forBot("b-1").voice, "myClone")
        XCTAssertEqual(settings.forBot("b-1").ttsProvider, "elevenlabs")
        XCTAssertEqual(settings.forBot("b-2").voice, "cedar")
        XCTAssertEqual(settings.ttsChoice(botId: "b-2"), "openai")
        settings.speed = 1.25
        let again = VoiceModeSettings.decode(settings.encoded)
        XCTAssertEqual(again.forBot("b-1").voice, "myClone")
        XCTAssertEqual(again.forBot("b-2").voice, "cedar")
        // picking a voice fills the bot's provider's slot, never xAI's
        let picked = again.withVoice("marin", forBot: "b-2")
        XCTAssertEqual(picked.voice, "eve")
        XCTAssertEqual(picked.forBot("b-2").voice, "marin")
        // a voice picked for one bot never changes another bot's
        XCTAssertEqual(picked.forBot("b-3").voice, "cedar")
        XCTAssertEqual(picked.withVoice("other", forBot: "b-1").forBot("b-1").voice, "other")
        let body = CompanionClient.voiceFields(picked, botId: "b-1")
        XCTAssertEqual(body["tts"] as? String, "elevenlabs")
        XCTAssertEqual(body["voice"] as? String, "myClone")
    }

    func testFrenchCallsListenInTheRegionThePersonSpeaks() {
        let locales = VoiceModeSettings(language: "fr").recognitionLocales(preferred: [Locale(identifier: "fr-CA"), Locale(identifier: "en-US")])
        XCTAssertEqual(locales.first?.identifier, "fr-CA")
    }

    func testTheVoiceIsTheOneTheDesktopWouldUse() throws {
        let xai = VoiceModeStatus(available: true)
        let eleven = try JSONDecoder().decode(ConfigStatus.self, from: Data(#"{"tts":{"configured":true,"provider":"elevenlabs","voice":"w"}}"#.utf8))
        // a voice provider set up: never Apple's voice in silence after it
        XCTAssertEqual(CallVoiceSource.route(voiceMode: xai, config: eleven, agentVoice: "v1", phoneKey: false), [.xai, .server(voiceId: "v1")])
        XCTAssertEqual(CallVoiceSource.route(voiceMode: xai, config: nil, agentVoice: nil, phoneKey: false), [.xai])
        XCTAssertEqual(CallVoiceSource.route(voiceMode: VoiceModeStatus(available: false), config: eleven, agentVoice: nil, phoneKey: true), [.server(voiceId: nil), .phoneElevenLabs(voiceId: nil)])
        // none set up: Apple, the explicit fallback
        XCTAssertEqual(CallVoiceSource.route(voiceMode: nil, config: nil, agentVoice: "v", phoneKey: false), [.device])
        XCTAssertEqual(CallVoiceSource.route(voiceMode: VoiceModeStatus(available: false), config: nil, agentVoice: nil, phoneKey: false), [.device])
    }

    func testACallUsesXaiWithThePersonsKeyAndAppleOnlyWithoutAProvider() {
        // the person's own xAI key (or the organization's): xAI hears and speaks, on the server
        let own = CallProvider.choose(voiceMode: VoiceModeStatus(available: true, organization: true, via: "speaker-key"), room: false, demo: false)
        XCTAssertEqual(own, .xai(via: "speaker-key"))
        XCTAssertTrue(own.recognizesOnServer)
        XCTAssertEqual(CallProvider.choose(voiceMode: VoiceModeStatus(available: true, via: "org-key"), room: false, demo: false), .xai(via: "org-key"))
        // no provider for this person, a group call, the demo, or no answer: Apple on the phone
        XCTAssertEqual(CallProvider.choose(voiceMode: VoiceModeStatus(available: false), room: false, demo: false), .apple)
        XCTAssertEqual(CallProvider.choose(voiceMode: nil, room: false, demo: false), .apple)
        XCTAssertEqual(CallProvider.choose(voiceMode: VoiceModeStatus(available: true), room: true, demo: false), .apple)
        XCTAssertEqual(CallProvider.choose(voiceMode: VoiceModeStatus(available: true), room: false, demo: true), .apple)
        XCTAssertFalse(CallProvider.apple.recognizesOnServer)
    }

    func testABusyOrFailingVoiceIsTriedAgainButARefusedKeyIsNot() {
        XCTAssertTrue(transientVoiceFailure(APIError.status(code: 502, message: "xAI is rate-limiting speech. Wait a moment and try again.")))
        XCTAssertTrue(transientVoiceFailure(APIError.status(code: 429, message: nil)))
        XCTAssertTrue(transientVoiceFailure(APIError.transport("offline")))
        XCTAssertFalse(transientVoiceFailure(APIError.status(code: 403, message: "xAI rejected the key or its TTS permissions. Check the xAI key in Settings.")))
        XCTAssertFalse(transientVoiceFailure(CancellationError()))
    }

    func testTheCallTranscriptShowsSpokenTextNotMarkdown() {
        let answer = "**DKIM 1024 bits** est faible.\n- SPF : ok\n- DMARC : `p=none`"
        let shown = SpokenText.transcriptText(answer)
        XCTAssertFalse(shown.contains("**"))
        XCTAssertFalse(shown.contains("- "))
        XCTAssertTrue(shown.hasPrefix("DKIM 1024 bits est faible."))
    }

    func testACutTurnCarriesItsUtteranceAndWhatWasHeard() {
        let meta = VoiceCallMeta(callId: "call-12345678", interrupted: true, language: "fr", utteranceId: "utt-1234567890abcdef", cut: PlaybackCut(heard: "Bonjour  tout", unheard: "le monde"), continues: true)
        XCTAssertEqual(meta.json["utteranceId"] as? String, "utt-1234567890abcdef")
        XCTAssertEqual(meta.json["heard"] as? String, "Bonjour tout")
        XCTAssertEqual(meta.json["unheard"] as? String, "le monde")
        XCTAssertEqual(meta.json["continues"] as? Bool, true)
        let plain = VoiceCallMeta(callId: "call-12345678", cut: PlaybackCut(heard: "x", unheard: "y"))
        XCTAssertNil(plain.json["heard"], "heard only means something for words that cut the bot")
        let long = VoiceCallMeta(callId: "call-12345678", interrupted: true, cut: PlaybackCut(heard: String(repeating: "a ", count: 1_000)))
        XCTAssertEqual((long.json["heard"] as? String)?.count, VoiceCallMeta.excerptMax)
    }

    func testTheCallMetaNeverSendsAuto() {
        XCTAssertNil(VoiceCallMeta(callId: "call-12345678", language: "auto").language)
        XCTAssertEqual(VoiceCallMeta(callId: "call-12345678", interrupted: true, language: "fr").json["language"] as? String, "fr")
        XCTAssertNil(VoiceCallMeta(callId: "call-12345678").json["interrupted"])
    }

    func testWavRoundTrips() throws {
        let samples: [Float] = [0, 0.5, -0.5, 0.25]
        let decoded = try XCTUnwrap(CallWav.decode(CallWav.encode(samples)))
        XCTAssertEqual(decoded.sampleRate, 16_000)
        XCTAssertEqual(decoded.samples.count, 4)
        XCTAssertEqual(decoded.samples[1], 0.5, accuracy: 0.001)
    }
}

private final class VoiceStub: URLProtocol {
    static var requests: [(URLRequest, Data?)] = []
    static var status = 200
    static var headers: [String: String] = ["Content-Type": "application/json"]
    static var body = Data("{}".utf8)

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var body = request.httpBody
        if body == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            stream.close()
            body = data
        }
        Self.requests.append((request, body))
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: "HTTP/1.1", headerFields: Self.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class VoiceModeClientTests: XCTestCase {
    private var client: CompanionClient!
    private var session: URLSession!

    override func setUp() {
        VoiceStub.requests = []
        VoiceStub.status = 200
        VoiceStub.headers = ["Content-Type": "application/json"]
        VoiceStub.body = Data("{}".utf8)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [VoiceStub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(connection: Connection(name: "T", host: "127.0.0.1", port: 8810), token: "t", session: session)
    }

    func testACallTurnIsAnOrdinarySendMarkedAsSaidOnTheCall() async throws {
        VoiceStub.body = Data(#"{"ok":true}"#.utf8)
        try await client.send(text: "Bonjour", toBot: "ara", threadId: "th-1", voiceCall: VoiceCallMeta(callId: "c-12345678", interrupted: true, language: "fr", utteranceId: "utt-0123456789abcdef"))
        let (request, body) = try XCTUnwrap(VoiceStub.requests.first)
        XCTAssertEqual(request.url?.path, "/api/bots/ara/messages")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(body)) as? [String: Any])
        XCTAssertEqual(json["text"] as? String, "Bonjour")
        XCTAssertEqual(json["threadId"] as? String, "th-1")
        let call = try XCTUnwrap(json["voiceCall"] as? [String: Any])
        XCTAssertEqual(call["callId"] as? String, "c-12345678")
        XCTAssertEqual(call["interrupted"] as? Bool, true)
        XCTAssertEqual(call["language"] as? String, "fr")
        XCTAssertEqual(call["utteranceId"] as? String, "utt-0123456789abcdef")
        XCTAssertNil(call["duplex"])
        XCTAssertEqual(json["sendId"] as? String, "utt-0123456789abcdef", "the utterance is the send: delivered once")
    }

    func testADuplexCallTurnMarksTheSend() async throws {
        VoiceStub.body = Data(#"{"ok":true}"#.utf8)
        try await client.send(text: "Bonjour", toBot: "ara", threadId: "th-1", voiceCall: VoiceCallMeta(callId: "c-12345678", duplex: true))
        let (_, body) = try XCTUnwrap(VoiceStub.requests.first)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(body)) as? [String: Any])
        let call = try XCTUnwrap(json["voiceCall"] as? [String: Any])
        XCTAssertEqual(call["duplex"] as? Bool, true)
    }

    func testTheCallTellsTheServerItStartsAndEnds() async throws {
        VoiceStub.body = Data(#"{"ok":true}"#.utf8)
        let ok = await client.voiceCallSession(botId: "ara", state: .start, callId: "call-12345678", threadId: "th-1", language: "auto")
        XCTAssertTrue(ok)
        let (request, body) = try XCTUnwrap(VoiceStub.requests.last)
        XCTAssertEqual(request.url?.path, "/api/bots/ara/voice/call")
        XCTAssertEqual(request.httpMethod, "POST")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(body)) as? [String: Any])
        XCTAssertEqual(json["state"] as? String, "start")
        XCTAssertEqual(json["callId"] as? String, "call-12345678")
        XCTAssertEqual(json["threadId"] as? String, "th-1")
        XCTAssertNil(json["language"], "auto is never sent")
        VoiceStub.status = 404
        let old = await client.voiceCallSession(botId: "ara", state: .end, callId: "call-12345678", threadId: nil, language: nil)
        XCTAssertFalse(old, "an older server without the route: best effort")
    }

    func testTheCallsStartBringsBackTheKeyterms() async throws {
        VoiceStub.body = Data(#"{"ok":true,"keyterms":["Quasar","  ServiceNow ","servicenow","","AcmeGuard"]}"#.utf8)
        let terms = await client.voiceCallStart(botId: "ara", callId: "call-12345678", threadId: "th-1", language: "fr")
        XCTAssertEqual(terms, ["Quasar", "ServiceNow", "AcmeGuard"])
        let (request, body) = try XCTUnwrap(VoiceStub.requests.last)
        XCTAssertEqual(request.url?.path, "/api/bots/ara/voice/call")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(body)) as? [String: Any])
        XCTAssertEqual(json["state"] as? String, "start")
        XCTAssertEqual(json["language"] as? String, "fr")

        VoiceStub.body = Data(#"{"ok":true}"#.utf8)
        let older = await client.voiceCallStart(botId: "ara", callId: "call-12345678", threadId: "th-1", language: nil)
        XCTAssertEqual(older, [], "a server without the field: no bias, the call goes on")
        VoiceStub.status = 404
        let failed = await client.voiceCallStart(botId: "ara", callId: "call-12345678", threadId: nil, language: nil)
        XCTAssertNil(failed)
    }

    func testCallKeytermsAreCleanedAndCapped() {
        XCTAssertEqual(CallKeyterms.contextual(["  Acme   Technologies ", "ACME technologies", "x", String(repeating: "a", count: 51)]), ["Acme Technologies", "x"])
        let many = (0..<150).map { "Term\($0)" }
        XCTAssertEqual(CallKeyterms.contextual(many).count, 100)
        XCTAssertEqual(CallKeyterms.contextual(many).first, "Term0")
        XCTAssertEqual(CallKeyterms.contextual([]), [])
    }

    func testStatusAndStreamSpeakTheServersContract() async throws {
        VoiceStub.body = Data(#"{"provider":"xai","available":false,"organization":true,"refusal":{"cause":"no_credentials","keysUrl":"https://p/keys"}}"#.utf8)
        let status = try await client.voiceModeStatus(botId: "ara")
        XCTAssertFalse(status.available)
        XCTAssertEqual(status.refusal?.cause, "no_credentials")
        XCTAssertEqual(VoiceStub.requests.last?.0.url?.path, "/api/bots/ara/voice/status")

        VoiceStub.headers = ["Content-Type": "audio/pcm", "x-voice-sample-rate": "24000"]
        VoiceStub.body = Data(repeating: 1, count: 10_000)
        let audio = try await client.voiceModeStream(botId: "ara", text: "Hi.", settings: VoiceModeSettings(voice: "eve", speed: 1.25, language: "fr"), threadId: "th-1")
        XCTAssertEqual(audio?.sampleRate, 24_000)
        var total = 0
        for try await chunk in try XCTUnwrap(audio).chunks { total += chunk.count }
        XCTAssertEqual(total, 10_000)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(VoiceStub.requests.last?.1)) as? [String: Any])
        XCTAssertEqual(body["voice"] as? String, "eve")
        XCTAssertEqual(body["speed"] as? Double, 1.25)
        XCTAssertEqual(body["language"] as? String, "fr")
        XCTAssertEqual(body["threadId"] as? String, "th-1")

        VoiceStub.status = 204
        VoiceStub.body = Data()
        let nothing = try await client.voiceModeStream(botId: "ara", text: "```x```", settings: .default, threadId: nil)
        XCTAssertNil(nothing)
    }

    func testAVoiceRouteSaysNoAsAVoiceFailureWithTheKey() async throws {
        VoiceStub.status = 502
        VoiceStub.body = Data(#"{"error":"The xAI account needs credits to generate speech.","code":"voice_provider","failure":"quota","key":{"source":"voice-key","last4":"Wez8"}}"#.utf8)
        do {
            _ = try await client.voiceModeStream(botId: "ara", text: "Hi.", settings: .default, threadId: nil)
            XCTFail("expected a failure")
        } catch let failure as VoiceFailure {
            XCTAssertEqual(failure.kind, "quota")
            XCTAssertEqual(failure.key?.last4, "Wez8")
        }
        do {
            _ = try await client.voiceModeTranscription(botId: "ara", wav: Data(repeating: 0, count: 64), language: "fr", threadId: nil)
            XCTFail("expected a failure")
        } catch let failure as VoiceFailure {
            XCTAssertEqual(failure.status, 502)
        }
        // a body that is not the voice route's stays an ordinary APIError
        VoiceStub.status = 500
        VoiceStub.body = Data(#"{"error":"boom"}"#.utf8)
        do {
            _ = try await client.voiceModeSpeak(botId: "ara", text: "Hi.", settings: .default, threadId: nil)
            XCTFail("expected a failure")
        } catch let APIError.status(code, message) {
            XCTAssertEqual(code, 500)
            XCTAssertEqual(message, "boom")
        }
    }

    func testTheWordsAndTheClipComeWithTheKeyThatServed() async throws {
        VoiceStub.headers = ["Content-Type": "application/json", "x-voice-key": "perspicax-key:c0Je", "x-voice-key-skipped": "voice-key:Wez8:quota"]
        VoiceStub.body = Data(#"{"text":"allo","key":{"source":"perspicax-key","last4":"c0Je"}}"#.utf8)
        let heard = try await client.voiceModeTranscription(botId: "ara", wav: Data(repeating: 0, count: 64), language: "auto", threadId: "th-1")
        XCTAssertEqual(heard.text, "allo")
        XCTAssertEqual(heard.key.used?.source, "perspicax-key")
        XCTAssertEqual(heard.key.skipped.first?.failure, "quota")
        XCTAssertNotNil(heard.key.fallbackLine)
        VoiceStub.headers = ["Content-Type": "audio/mpeg", "x-voice-key": "org-key:t6Yb"]
        VoiceStub.body = Data(repeating: 7, count: 300)
        let (clip, key) = try await client.voiceModeSpeak(botId: "ara", text: "Bonjour.", settings: VoiceModeSettings(voice: "eve", speed: 1, language: "fr"), threadId: nil)
        XCTAssertEqual(clip.count, 300)
        XCTAssertEqual(key.used, VoiceKeyInfo(source: "org-key", last4: "t6Yb"))
        XCTAssertEqual(VoiceStub.requests.last?.0.url?.path, "/api/bots/ara/voice/speak")
        VoiceStub.headers = ["Content-Type": "application/json"]
        VoiceStub.body = Data(#"{"ready":true,"utterances":["Bonjour.","Ça va?"]}"#.utf8)
        let parts = try await client.voiceModePrepare(botId: "ara", text: "Bonjour. Ça va?")
        XCTAssertEqual(parts, ["Bonjour.", "Ça va?"])
    }
}

final class VoiceKeyWordsTests: XCTestCase {
    func testTheStatusNamesTheKeyAndEveryKeyInOrder() throws {
        let data = Data(#"{"provider":"xai","available":true,"organization":true,"via":"speaker-key","key":{"source":"perspicax-key","last4":"c0Je"},"keys":[{"source":"perspicax-key","last4":"c0Je"},{"source":"org-key","last4":"t6Yb"},{"source":"voice-key","last4":"Wez8","refused":"quota"}]}"#.utf8)
        let status = try JSONDecoder().decode(VoiceModeStatus.self, from: data)
        XCTAssertEqual(status.key, VoiceKeyInfo(source: "perspicax-key", last4: "c0Je"))
        XCTAssertEqual(status.keys?.count, 3)
        XCTAssertEqual(status.keys?.last?.refused, "quota")
        // an older server names no key: the via still tells
        let old = try JSONDecoder().decode(VoiceModeStatus.self, from: Data(#"{"provider":"xai","available":true,"via":"org-key"}"#.utf8))
        XCTAssertNil(old.key)
        XCTAssertEqual(VoiceWords.providerLine(key: old.key, via: old.via), "Voice: xAI, with the organization's key")
        XCTAssertEqual(VoiceWords.providerLine(key: status.key, via: status.via), "Voice: xAI with your xAI key in Perspicax ···c0Je")
    }

    func testAVoiceFailureCarriesTheReasonTheKindAndTheKey() throws {
        let body = Data(#"{"error":"The xAI account needs credits to generate speech.","code":"voice_provider","failure":"quota","key":{"source":"voice-key","last4":"Wez8"},"tried":[{"source":"voice-key","last4":"Wez8","failure":"quota"},{"source":"org-key","last4":"t6Yb","failure":"quota"}]}"#.utf8)
        let failure = try XCTUnwrap(VoiceFailure.parse(status: 502, data: body))
        XCTAssertEqual(failure.kind, "quota")
        XCTAssertEqual(failure.key, VoiceKeyInfo(source: "voice-key", last4: "Wez8"))
        XCTAssertEqual(failure.tried?.count, 2)
        XCTAssertTrue(failure.permanent)
        XCTAssertFalse(failure.transient)
        XCTAssertTrue(permanentVoiceFailure(failure))
        XCTAssertFalse(transientVoiceFailure(failure))
        XCTAssertEqual(VoiceWords.line(failure), "xAI has no credits left for your voice key ···Wez8. Add credits to that xAI account, or change the key in Settings > Models and voice > My voice keys on the computer. The answers stay in the chat.")
        // a refusal: no key serves this person
        let refused = try XCTUnwrap(VoiceFailure.parse(status: 403, data: Data(#"{"code":"voice_no_access","cause":"server_engine_not_allowed","error":"no","card":{"keysUrl":"https://p/keys"}}"#.utf8)))
        XCTAssertTrue(refused.refused)
        XCTAssertEqual(refused.keysUrl, "https://p/keys")
        XCTAssertEqual(VoiceWords.line(refused), "Your organization has not given you its xAI voice. Add your own xAI key in Perspicax, or ask an admin.")
        // this server's own limits, as the desktop sorts them
        XCTAssertEqual(VoiceFailure.parse(status: 429, data: Data(#"{"error":"Too many voice requests. Wait a moment."}"#.utf8))?.kind, "busy")
        XCTAssertTrue(transientVoiceFailure(VoiceFailure(status: 429)))
        XCTAssertEqual(VoiceFailure.parse(status: 409, data: Data(#"{"error":"Spend limit reached.","code":"spend_cap"}"#.utf8))?.kind, "quota")
        // busy with the key named, down and an unknown voice: the plain lines
        XCTAssertEqual(VoiceWords.line(VoiceFailure(status: 502, code: "voice_provider", failure: "busy", key: VoiceKeyInfo(source: "org-key"))), "xAI is rate-limiting the organization's xAI key. It comes back by itself; the answers stay in the chat.")
        XCTAssertEqual(VoiceWords.line(VoiceFailure(status: 502, code: "voice_provider", failure: "down", key: VoiceKeyInfo(source: "org-key"))), "xAI voice is not answering right now. The answers stay in the chat.")
        // not the voice route's body: no VoiceFailure
        XCTAssertNil(VoiceFailure.parse(status: 500, data: Data(#"{"error":"boom"}"#.utf8)))
        XCTAssertNil(VoiceFailure.parse(status: 502, data: Data("<html>".utf8)))
    }

    /// #5428: the server's chain sentence passes through; grok-account and
    /// org-account use the web's words.
    func testVoiceWordsPassTheServersChainSentenceAndNameGrokAccounts() throws {
        let english = "No call was placed: your connected Grok account is out of credits. Add credits on the connected Grok account, then call back. Your organization's xAI key is out of credits."
        let french = "Aucun appel : ton compte Grok connecté n'a plus de crédits. Ajoute du crédit au compte Grok connecté, puis rappelle. La clé xAI de ton organisation n'a plus de crédits."
        let chainBody = Data(#"{"error":"No call was placed: your connected Grok account is out of credits. Add credits on the connected Grok account, then call back. Your organization's xAI key is out of credits.","code":"out_of_credits","failure":"quota","key":{"source":"grok-account","last4":"4Dd"},"tried":[{"source":"grok-account","last4":"4Dd","failure":"quota"},{"source":"org-key","last4":"t6Yb","failure":"quota"}]}"#.utf8)
        let chain = try XCTUnwrap(VoiceFailure.parse(status: 502, data: chainBody))
        XCTAssertEqual(chain.kind, "quota")
        XCTAssertEqual(chain.key?.source, "grok-account")
        XCTAssertEqual(VoiceWords.line(chain), english)
        XCTAssertEqual(VoiceWords.line(VoiceFailure(status: 502, message: french, code: "out_of_credits", failure: "quota", key: VoiceKeyInfo(source: "grok-account", last4: "4Dd"))), french)
        XCTAssertEqual(VoiceWords.keyLabel(VoiceKeyInfo(source: "grok-account", last4: "4Dd")), "your connected Grok account ···4Dd")
        XCTAssertEqual(VoiceWords.keyLabel(VoiceKeyInfo(source: "org-account")), "the organization's Grok account")
        XCTAssertEqual(VoiceWords.keyAction(VoiceKeyInfo(source: "grok-account")), "Add credits on the connected Grok account.")
        XCTAssertEqual(VoiceWords.keyAction(VoiceKeyInfo(source: "org-account")), "Ask an admin to check the organization's Grok account, or connect your own Grok account in Settings > Providers.")
        let refusedBody = Data(#"{"error":"No call was placed: your connected Grok account is out of credits. Add credits on the connected Grok account, then call back. Your organization's xAI key is out of credits.","code":"realtime_key_refused","failure":"quota","key":{"source":"grok-account","last4":"4Dd"}}"#.utf8)
        let refused = try XCTUnwrap(VoiceFailure.parse(status: 502, data: refusedBody))
        XCTAssertEqual(VoiceWords.line(refused), english)
    }

    func testTheKeyThatServedComesFromTheHeadersAndAFallbackIsSaidOnce() {
        let outcome = VoiceKeyOutcome.from(headers: ["X-Voice-Key": "perspicax-key:c0Je", "x-voice-key-skipped": "voice-key:Wez8:quota"])
        XCTAssertEqual(outcome.used, VoiceKeyInfo(source: "perspicax-key", last4: "c0Je"))
        XCTAssertEqual(outcome.skipped, [VoiceKeyRefusal(source: "voice-key", last4: "Wez8", failure: "quota")])
        XCTAssertEqual(outcome.fallbackLine, "your voice key ···Wez8 was refused (no credits). The voice now runs on your xAI key in Perspicax ···c0Je.")
        XCTAssertNil(VoiceKeyOutcome.from(headers: ["x-voice-key": "org-key:"]).fallbackLine)
        XCTAssertEqual(parseVoiceKeyHeader("server:"), VoiceKeyInfo(source: "server", last4: nil))
        XCTAssertNil(parseVoiceKeyHeader(""))
        XCTAssertEqual(parseVoiceKeySkippedHeader("voice-key:Wez8:quota,perspicax-key:c0Je:key").count, 2)
        XCTAssertEqual(parseVoiceKeySkippedHeader("nope").count, 0)
        XCTAssertEqual(VoiceWords.fallback(used: VoiceKeyInfo(source: "org-key"), skipped: [VoiceKeyRefusal(source: "perspicax-key", last4: "c0Je", failure: "key")]), "your xAI key in Perspicax ···c0Je was refused (key rejected). The voice now runs on the organization's xAI key.")
    }
}

final class CallQuietTests: XCTestCase {
    func testOnlyTheThreadOnTheCallIsQuietAndOnlyWhileItLasts() {
        let quiet = CallQuiet()
        XCTAssertFalse(quiet.silences(threadId: "th-ara"))
        quiet.set("th-ara", live: true)
        XCTAssertTrue(quiet.silences(threadId: "th-ara"), "the conversation on the call does not buzz")
        XCTAssertFalse(quiet.silences(threadId: "th-helios"), "another conversation still does")
        XCTAssertFalse(quiet.silences(threadId: nil))
        quiet.set("th-ara", live: false)
        XCTAssertFalse(quiet.silences(threadId: "th-ara"), "hung up: it notifies again")
    }
}

final class BotHangupTests: XCTestCase {
    func testWaitsForAGoodbyeThenHangsUp() {
        XCTAssertEqual(BotHangup.decide(speaking: true, heardSpeech: false, elapsedMs: 0), .wait)
        XCTAssertEqual(BotHangup.decide(speaking: true, heardSpeech: true, elapsedMs: BotHangup.capMs - 1), .wait)
        XCTAssertEqual(BotHangup.decide(speaking: false, heardSpeech: true, elapsedMs: 0), .hangup)
        XCTAssertEqual(BotHangup.decide(speaking: false, heardSpeech: false, elapsedMs: BotHangup.settleMs - 1), .wait)
        XCTAssertEqual(BotHangup.decide(speaking: false, heardSpeech: false, elapsedMs: BotHangup.settleMs), .hangup)
        XCTAssertEqual(BotHangup.decide(speaking: true, heardSpeech: true, elapsedMs: BotHangup.capMs), .hangup)
    }

    func testTheEndedFrameNamesTheCall() throws {
        let frame = try JSONDecoder().decode(Frame.self, from: Data(#"{"kind":"voice.call.ended","audience":"ada","threadId":"th-1","callId":"call-0123456789","by":"bot"}"#.utf8))
        guard case let .voiceCallEnded(threadId, callId, by) = frame else {
            return XCTFail("decoded \(frame)")
        }
        XCTAssertEqual(threadId, "th-1")
        XCTAssertEqual(frame.threadId, "th-1")
        XCTAssertEqual(callId, "call-0123456789")
        XCTAssertEqual(by, "bot")
        let broken = try JSONDecoder().decode(Frame.self, from: Data(#"{"kind":"voice.call.ended","threadId":"th-1"}"#.utf8))
        if case .unknown = broken {} else { XCTFail("decoded \(broken)") }

        let posted = expectation(forNotification: .sagaxVoiceCallEnded, object: nil)
        var state = CompanionState()
        state.apply(frame)
        wait(for: [posted], timeout: 1)
    }
}

final class AnswerBudgetTests: XCTestCase {
    func testShortAnswerIsSaidWhole() {
        let answer = SpokenText.spokenAnswer("Yes, the backup ran. It finished at nine.")
        XCTAssertEqual(answer.text, "Yes, the backup ran. It finished at nine.")
        XCTAssertNil(answer.cut)
    }

    func testStopsAfterFourSentences() {
        let answer = SpokenText.spokenAnswer("Un. Deux, c'est fait. Trois! Quatre… Cinq reste écrit. Six aussi.")
        XCTAssertEqual(answer.text, "Un. Deux, c'est fait. Trois! Quatre… ")
        XCTAssertEqual(answer.cut, .length)
    }

    func testAQuestionEndsWhatIsSaid() {
        let answer = SpokenText.spokenAnswer("Le serveur est arrêté. Veux-tu que je le redémarre? Ou que j'ouvre un billet?")
        XCTAssertEqual(answer.text, "Le serveur est arrêté. Veux-tu que je le redémarre? ")
        XCTAssertEqual(answer.cut, .question)
        XCTAssertNil(SpokenText.spokenAnswer("It is down. Should I restart it?").cut)
    }

    func testListLinesCountButNumbersAndAbbreviationsDoNot() {
        let list = "Three things:\n1. the printer\n2. the badge reader\n3. the camera\n4. the door"
        XCTAssertEqual(SpokenText.spokenAnswer(list).text, "Three things:\n1. the printer\n2. the badge reader\n3. the camera\n")
        XCTAssertEqual(
            SpokenText.spokenAnswer("M. Tremblay a appelé. Il rappelle e.g. demain. Merci. Bonne journée. Fin.").text,
            "M. Tremblay a appelé. Il rappelle e.g. demain. Merci. Bonne journée. "
        )
        XCTAssertEqual(SpokenText.spokenAnswer("The rate is 3.5 percent. Two. Three. Four. Five.").text, "The rate is 3.5 percent. Two. Three. Four. ")
    }

    func testQuotedOrShortRhetoricalQuestionsDoNotEndIt() {
        XCTAssertNil(SpokenText.spokenAnswer("You asked \"is it done?\" Yes, it is done.").cut)
        XCTAssertNil(SpokenText.spokenAnswer("Tu demandes « est-ce fait ? » Oui, c'est fait.").cut)
        XCTAssertEqual(SpokenText.spokenAnswer("Pourquoi? Parce que le disque est plein.").text, "Pourquoi? Parce que le disque est plein.")
    }

    func testCodeCountsForNothing() {
        let answer = "Run this:\n```\nnpm ci\nnpm test\n```\nThen it works. Done."
        XCTAssertEqual(SpokenText.spokenAnswer(answer).text, answer)
        XCTAssertNil(SpokenText.spokenAnswer(answer).cut)
        XCTAssertNil(SpokenText.spokenAnswer("Use `a ? b : c` here. It is fine.").cut)
    }

    func testCrlfEndsALineLikeTheDesktop() {
        XCTAssertEqual(SpokenText.spokenAnswer("One\r\nTwo\r\nThree\r\nFour\r\nFive").cut, .length)
    }

    func testTheCutOnlyGrowsAsTheAnswerIsWritten() {
        let full = Array("One. Two. Three. Four. Five. Six? Seven.")
        var previous = ""
        for end in 1...full.count {
            let said = SpokenText.spokenAnswer(String(full[..<end])).text
            XCTAssertTrue(said.hasPrefix(previous), "\(said) after \(previous)")
            previous = said
        }
        XCTAssertEqual(previous, "One. Two. Three. Four. ")
    }

    func testTheFollowUpIsNeverCounted() {
        XCTAssertEqual(SpokenText.spokenAnswer("Done, bye.\n---\nOne. Two. Three. Four. Five.").text, "Done, bye.\n")
    }
}

final class CallFailureTests: XCTestCase {
    private func said(_ id: String) -> Message {
        var m = Message(id: id, role: .user, kind: .text, at: 0)
        m.text = "Is the backup done?"
        return m
    }
    private func failed(_ id: String, _ cause: String, setup: Bool = false) -> Message {
        var m = Message(id: id, role: .bot, kind: .activity, at: 0)
        m.tool = ToolActivity(name: "error: \(cause)", ok: false, setup: setup ? true : nil)
        return m
    }
    private func reply(_ id: String) -> Message {
        var m = Message(id: id, role: .bot, kind: .text, at: 0)
        m.text = "Yes, it finished."
        return m
    }

    func testSortsTheCauseIntoAKind() {
        XCTAssertEqual(CallFailure.kind(cause: "API Error: 529 {\"type\":\"overloaded_error\"}"), .busy)
        XCTAssertEqual(CallFailure.kind(cause: "insufficient_quota: You exceeded your current quota"), .quota)
        XCTAssertEqual(CallFailure.kind(cause: "Invalid API key · Please run /login"), .signIn)
        XCTAssertEqual(CallFailure.kind(cause: "anything", setup: true), .signIn)
        XCTAssertEqual(CallFailure.kind(cause: "fetch failed: ECONNRESET"), .connection)
        XCTAssertEqual(CallFailure.kind(cause: "claude exited 3 before result"), .generic)
        XCTAssertEqual(CallFailure.kind(cause: "Claude AI usage limit reached|1760000000"), .limit)
        XCTAssertEqual(CallFailure.kind(cause: "HTTP 502 Bad Gateway"), .connection)
        XCTAssertEqual(CallFailure.kind(cause: "Rate limit reached for requests"), .busy)
        XCTAssertEqual(CallFailure.kind(cause: "500 tokens left in the window"), .generic)
        for cause in ["max_tokens 512 is above the model limit", "code signing failed for the bundle", "logging in debug mode crashed", "the certificate expired", "context window capacity exceeded"] {
            XCTAssertEqual(CallFailure.kind(cause: cause), .generic, cause)
        }
        XCTAssertNil(CallFailure.rowKind(failed("a", "Request was aborted.")))
        XCTAssertNil(CallFailure.rowKind(reply("r")))
        XCTAssertEqual(CallFailure.rowKind(Message(id: "x", role: .bot, kind: .access, at: 0)), .generic)
    }

    func testWaitsOutTheRetryThenSaysItOnce() {
        var watch = CallFailure()
        let messages = [said("u1"), failed("f1", "API Error: 529 overloaded")]
        XCTAssertNil(watch.next(now: 0, messages: messages, botBusy: false, botSpeaking: false, awaitingAnswer: false))
        XCTAssertNil(watch.next(now: CallFailure.graceMs - 1, messages: messages, botBusy: false, botSpeaking: false, awaitingAnswer: false))
        XCTAssertEqual(watch.next(now: CallFailure.graceMs, messages: messages, botBusy: false, botSpeaking: false, awaitingAnswer: false), .busy)
        XCTAssertNil(watch.next(now: 60_000, messages: messages + [failed("f2", "ECONNRESET")], botBusy: false, botSpeaking: false, awaitingAnswer: false))
    }

    func testSaysNothingWhenTheRetryAnswersOrTheBotWorks() {
        var watch = CallFailure()
        let messages = [said("u1"), failed("f1", "ECONNRESET")]
        _ = watch.next(now: 0, messages: messages, botBusy: false, botSpeaking: false, awaitingAnswer: false)
        XCTAssertNil(watch.next(now: 9_000, messages: messages, botBusy: true, botSpeaking: false, awaitingAnswer: false))
        XCTAssertNil(watch.next(now: 9_000, messages: messages, botBusy: false, botSpeaking: true, awaitingAnswer: false))
        XCTAssertNil(watch.next(now: 9_000, messages: messages + [reply("r1")], botBusy: false, botSpeaking: false, awaitingAnswer: false))
    }

    func testIgnoresWhatWasOnScreenAtTheStart() {
        let before = [said("u0"), failed("f0", "ECONNRESET")]
        var watch = CallFailure(existing: before)
        XCTAssertNil(watch.next(now: 0, messages: before, botBusy: false, botSpeaking: false, awaitingAnswer: false))
        XCTAssertNil(watch.next(now: 60_000, messages: before, botBusy: false, botSpeaking: false, awaitingAnswer: false))
    }

    func testTheConversationAsksIt() {
        var conversation = CallConversation(existing: [])
        var now = 0.0
        conversation.clock = { now }
        let messages = [said("u1"), failed("f1", "socket hang up")]
        XCTAssertNil(conversation.failureKind(messages: messages, botBusy: false, playerBusy: false))
        now = CallFailure.graceMs
        XCTAssertEqual(conversation.failureKind(messages: messages, botBusy: false, playerBusy: false), .connection)
    }
}
