import Combine
import CompanionCore
import SwiftUI
import WatchKit

/// Push-to-talk in a bot's chat on the watch (#5129, D-20261120-004): hold
/// the mic, speak, let go. Every piece is the app's own: the voice notes'
/// recorder (VoiceNoteRecorder) and speech to text (`transcribeRecording`),
/// the call turn the phone's Push to Talk sends (`voiceCall`), Walkie's rule
/// for when the answer is complete, and the phone's read-aloud
/// (MessageSpeaker) in the bot's voice. The answer's text lands in the chat
/// like any reply.
@MainActor
final class WatchTalkModel: ObservableObject {
    enum Phase: Equatable { case idle, listening, hearing, sending, waiting, speaking }

    @Published private(set) var phase = Phase.idle
    /// Holding to talk is offered: xAI hears and speaks for this person and
    /// this bot. Otherwise the mic is the system's dictation only.
    @Published private(set) var available = false
    /// Why the last try did not reach the bot, in a line under the mic.
    @Published private(set) var problem: LocalizedStringKey?

    let recorder = VoiceNoteRecorder()
    private var voices: WatchVoices?
    private var voicesClient: CompanionClient?
    private var work: Task<Void, Never>?
    private var forward: AnyCancellable?

    init() {
        // the recorder's clock and phase redraw the chat's mic
        forward = recorder.objectWillChange.sink { [weak self] in self?.objectWillChange.send() }
    }

    /// Whether this bot can be talked to: asked when the chat opens.
    func check(bot: Bot, client: CompanionClient?) async {
        #if DEBUG
        if let shown = Self.demoPhase { available = true; phase = shown; return }
        #endif
        guard let client else { available = false; return }
        available = await voices(for: client).voiceMode(botId: bot.id)
    }

    #if DEBUG
    /// `-watch-demo-talk listening|hearing|waiting|speaking`: the demo chat
    /// drawn in that step, for a capture (the demo has no voice).
    private static var demoPhase: Phase? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let option = arguments.firstIndex(of: "-watch-demo-talk"), arguments.indices.contains(option + 1) else { return nil }
        switch arguments[option + 1] {
        case "idle": return .idle
        case "listening": return .listening
        case "hearing": return .hearing
        case "waiting": return .waiting
        case "speaking": return .speaking
        default: return nil
        }
    }
    #endif

    /// The mic was held past the hold threshold: record.
    func press() {
        guard available, phase == .idle || phase == .speaking else { return }
        MessageSpeaker.shared.stop()
        problem = nil
        phase = .listening
        recorder.start(mode: .hold)
    }

    /// The first microphone prompt took the touch: the recording goes on
    /// until the next tap sends it.
    var waitsForTap: Bool { phase == .listening && recorder.isActive && recorder.mode == .toggle }

    /// Stop whatever the watch is saying.
    func stopSpeaking() {
        MessageSpeaker.shared.stop()
        if phase == .speaking { phase = .idle }
    }

    func cancel() {
        recorder.cancel()
        if phase == .listening { phase = .idle }
    }

    /// The mic was let go: hear the words, send them as a call turn, wait for
    /// the answer, say it.
    func release(bot: Bot, threadId: String, client: CompanionClient?, refresh: @escaping () async -> Void) {
        guard phase == .listening else { return }
        guard let clip = recorder.finish() else {
            phase = .idle
            problem = recorder.error
            return
        }
        guard let client else { phase = .idle; return }
        phase = .hearing
        let voices = voices(for: client)
        work?.cancel()
        work = Task { [weak self] in
            guard let self else { return }
            let settings = await voices.voiceSettings()
            let words: String
            do {
                words = try await client.transcribeRecording(pcm: clip.pcm, sampleRate: clip.sampleRate, botId: bot.id, threadId: threadId, language: settings.language)
            } catch {
                guard !Task.isCancelled else { return }
                self.fail("Your words did not go through. Try again.")
                return
            }
            guard !Task.isCancelled else { return }
            guard !words.isEmpty else {
                self.fail("I didn’t catch that. Hold the mic and speak again.")
                return
            }
            self.phase = .sending
            // what the conversation already holds: anything the bot adds is the answer
            let baseline = Set((try? await self.transcript(threadId, client: client))?.map(\.id) ?? [])
            let meta = VoiceCallMeta(callId: WatchTalk.callId(), language: settings.language, utteranceId: WatchTalk.utteranceId())
            do {
                _ = try await client.send(text: words, toBot: bot.id, threadId: threadId, voiceCall: meta)
            } catch {
                guard !Task.isCancelled else { return }
                self.fail("Your words did not go through. Try again.")
                return
            }
            WKInterfaceDevice.current().play(.success)
            await refresh()
            self.phase = .waiting
            await self.answer(bot: bot, threadId: threadId, baseline: baseline, client: client, voices: voices, refresh: refresh)
        }
    }

    /// Wait for the bot's answer to settle, show it, say it in its voice.
    private func answer(bot: Bot, threadId: String, baseline: Set<String>, client: CompanionClient, voices: WatchVoices, refresh: () async -> Void) async {
        let deadline = Date().addingTimeInterval(WatchTalk.answerWait)
        while Date() < deadline {
            do { try await Task.sleep(for: .seconds(WatchTalk.answerPoll)) } catch { return }
            guard let messages = try? await transcript(threadId, client: client) else { continue }
            let fleet = try? await client.fleet(messages: 0)
            let runs = WatchTalk.turnRuns(fleet?.bots.first(where: { $0.id == bot.id }), threadId: threadId)
            guard let reply = Walkie.settledReply(transcript: messages, baseline: baseline, busy: runs) else { continue }
            guard !Task.isCancelled else { return }
            await refresh()
            phase = .speaking
            WKInterfaceDevice.current().play(.notification)
            let speaker = MessageSpeaker.shared
            speaker.speak(reply, messageId: "watch-talk-" + UUID().uuidString, voiceId: bot.voice, botId: bot.id, session: voices)
            while speaker.status != .idle, !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(300))
            }
            if phase == .speaking { phase = .idle }
            return
        }
        // no answer in time: it still lands in the chat when it comes
        if phase == .waiting { phase = .idle }
    }

    private func transcript(_ threadId: String, client: CompanionClient) async throws -> [Message] {
        let page = try await client.messages(threadId: threadId, limit: 35)
        var state = CompanionState()
        state.merge(page, intoThread: threadId)
        return state.visibleTranscript(forThread: threadId)
    }

    private func fail(_ why: LocalizedStringKey) {
        problem = why
        phase = .idle
        WKInterfaceDevice.current().play(.failure)
    }

    private func voices(for client: CompanionClient) -> WatchVoices {
        if let voices, voicesClient?.connection == client.connection { return voices }
        let made = WatchVoices(client: client)
        voices = made
        voicesClient = client
        return made
    }
}
