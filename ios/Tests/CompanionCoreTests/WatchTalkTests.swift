// Push-to-talk on the watch (#5129): the call id, when the bot's turn still
// runs, the voice settings, and the shared transcription of a recording.
import XCTest
@testable import CompanionCore

final class WatchTalkTests: XCTestCase {
    func testCallIdIsAWatchCallTheServerAccepts() {
        let id = WatchTalk.callId()
        XCTAssertTrue(id.hasPrefix("watch-"))
        XCTAssertFalse(id.hasPrefix(PushToTalkChannel.callId().prefix(4)))
        // server/voice/voice-call-prompt.ts CALL_ID
        XCTAssertNotNil(id.range(of: #"^[A-Za-z0-9_-]{8,80}$"#, options: .regularExpression))
        XCTAssertNotEqual(id, WatchTalk.callId())
        XCTAssertTrue(WatchTalk.utteranceId().hasPrefix("utt-"))
    }

    func testTheTurnRunsWhileItsThreadWorks() {
        var bot = bot(tasks: [task("main"), task("side")])
        XCTAssertFalse(WatchTalk.turnRuns(bot, threadId: "main"))
        bot.tasks?[0].activity = "working"
        XCTAssertTrue(WatchTalk.turnRuns(bot, threadId: "main"))
        XCTAssertFalse(WatchTalk.turnRuns(bot, threadId: "side"))
    }

    /// The bot's own activity stands for its current thread when the entry has none.
    func testTheCurrentThreadReadsTheBotsActivity() {
        var bot = bot(tasks: [task("main")])
        bot.activity = "working"
        XCTAssertTrue(WatchTalk.turnRuns(bot, threadId: "main"))
    }

    func testATeammateWaitIsNotTheBotsTurn() {
        var waiting = task("main")
        waiting.busy = true
        waiting.waitingOnTeammate = true
        XCTAssertFalse(WatchTalk.turnRuns(bot(tasks: [waiting]), threadId: "main"))
    }

    func testNoBotMeansNothingRuns() {
        XCTAssertFalse(WatchTalk.turnRuns(nil, threadId: "main"))
    }

    /// D-20261120-004: holding to talk shows as soon as one speech to text
    /// engine hears the person, OpenAI included, never xAI alone. The bodies
    /// are what server/voice/voice-mode.ts answers: `provider` stays the
    /// legacy "xai", and only an xAI key brings `realtime`.
    func testHoldingToTalkIsOfferedByAnySpeechToTextEngineNotOnlyXAI() throws {
        let openAIOnly = #"{"provider":"xai","available":true,"via":"speaker-key","providers":{"tts":["openai"],"stt":["openai"]},"tts":"openai","stt":"openai"}"#
        XCTAssertTrue(WatchTalk.offersHold(try status(openAIOnly)))
        // xAI's credits are empty: the key is still listed, OpenAI takes over on the server
        let xaiThenOpenAI = #"{"provider":"xai","available":true,"via":"speaker-key","realtime":true,"providers":{"tts":["xai","openai"],"stt":["xai","openai"]},"tts":"xai","stt":"xai"}"#
        XCTAssertTrue(WatchTalk.offersHold(try status(xaiThenOpenAI)))
        // a voice without ears (ElevenLabs, the computer's voice): nothing hears the watch
        let voiceOnly = #"{"provider":"xai","available":false,"refusal":{"cause":"no_credentials"},"providers":{"tts":["elevenlabs","system"],"stt":[]}}"#
        XCTAssertFalse(WatchTalk.offersHold(try status(voiceOnly)))
        XCTAssertFalse(WatchTalk.offersHold(nil))
    }

    func testVoiceSettingsComeFromThePersonsPreference() {
        var chosen = VoiceModeSettings.default
        chosen.voice = "ara"
        chosen.speed = 1.25
        let read = WatchTalk.voiceSettings(preferences: [VoiceModeSettings.storageKey: chosen.encoded])
        XCTAssertEqual(read.voice, "ara")
        XCTAssertEqual(read.speed, 1.25)
        XCTAssertEqual(WatchTalk.voiceSettings(preferences: [:]), .default)
    }

    // MARK: - The shared transcription (voice notes and the watch)

    func testARecordingIsHeardClipByClipAndJoined() async throws {
        TranscribeStub.answers = ["Bonjour", "  ", "la suite"]
        TranscribeStub.paths = []
        // two full clips of the route's size (VoiceNoteRecording), then one second
        let clip = VoiceNoteRecording.transcriptionChunkSamples() * 2
        let pcm = Data(count: 2 * clip + 32_000)
        let words = try await stubClient().transcribeRecording(pcm: pcm, sampleRate: 16_000, botId: "pixel", threadId: "main")
        XCTAssertEqual(words, "Bonjour la suite")
        XCTAssertEqual(TranscribeStub.paths, Array(repeating: "/api/bots/pixel/voice/transcribe", count: 3))
    }

    func testAClipThatCannotBeHeardFailsTheRecording() async {
        TranscribeStub.answers = []
        TranscribeStub.paths = []
        do {
            _ = try await stubClient().transcribeRecording(pcm: Data(count: 32_000), sampleRate: 16_000, botId: "pixel", threadId: nil)
            XCTFail("a refused clip must fail the recording")
        } catch {}
    }

    private func stubClient() -> CompanionClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TranscribeStub.self]
        return CompanionClient(
            connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810),
            token: "paired-token",
            session: URLSession(configuration: configuration)
        )
    }

    // MARK: - Helpers

    private func status(_ json: String) throws -> VoiceModeStatus {
        try JSONDecoder().decode(VoiceModeStatus.self, from: Data(json.utf8))
    }

    private func task(_ id: String) -> BotTask { BotTask(threadId: id, title: id, createdAt: 1) }

    private func bot(tasks: [BotTask]) -> Bot {
        Bot(
            id: "pixel", threadId: "main", name: "Pixel", title: "Designer",
            description: "", notifications: true, color: "blue", unread: false,
            modelSelection: ModelSelection(instanceId: "i", model: "m"), createdAt: 1, tasks: tasks
        )
    }
}

/// Answers each transcribe request with the next words; none left is a 502.
private final class TranscribeStub: URLProtocol {
    nonisolated(unsafe) static var answers: [String] = []
    nonisolated(unsafe) static var paths: [String] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.paths.append(request.url?.path ?? "")
        let next = Self.answers.isEmpty ? nil : Self.answers.removeFirst()
        let body = next.map { try! JSONSerialization.data(withJSONObject: ["text": $0]) } ?? Data(#"{"error":"no"}"#.utf8)
        let response = HTTPURLResponse(url: request.url!, statusCode: next == nil ? 502 : 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
