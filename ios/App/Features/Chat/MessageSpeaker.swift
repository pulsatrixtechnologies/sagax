// Read one message aloud (MS4), the desktop's `SpeakButton` and `speaker`
// (src/lib/tts): one voice at a time, a new message stops the last, and the
// same menu item turns into Stop while that message is the one speaking.
//
// Audio comes from the paired computer first, as on the desktop: voice
// mode's xAI voice whenever a key serves the person (2026-10-28: `POST
// /voice/prepare` and `POST /voice/speak`, the person's Voice, Speed and
// Language, the same key order as the call), else the computer's voice
// provider with the agent's voice (`POST /api/tts/prepare` cuts the text
// into utterances, `POST /api/tts/speak` renders each one). When neither
// can, the phone's own voice (AVSpeechSynthesizer) reads it instead, and
// `notice` says why (the reason and the key it is about), so the action
// always does something and never switches voices in silence. The live
// call (ios/App/Call) keeps its own streaming voice stack; a read-aloud is
// one clip at a time, so it plays here.
//
// The watch reads its push-to-talk answers with this same reader (#5129):
// the voices come from `ReadAloudVoices`, the phone's Session or the
// watch's own client, never from a second voice stack.
import AVFoundation
import CompanionCore
import SwiftUI

/// Where the reader gets its voices: voice mode's xAI voice for a bot, else
/// the computer's provider (its utterances, then each one's audio).
@MainActor
protocol ReadAloudVoices: AnyObject {
    func readAloudVoice(botId: String?) async -> MessageSpeaker.VoiceModeVoice?
    func prepareSpeech(text: String, voiceId: String?) async -> SpeechPreparation?
    func speechAudio(text: String, voiceId: String?) async throws -> Data
}

@MainActor
final class MessageSpeaker: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    static let shared = MessageSpeaker()

    enum Status: Equatable { case idle, preparing, speaking }

    @Published private(set) var status: Status = .idle
    /// The message being read, so its menu offers Stop.
    @Published private(set) var messageId: String?
    /// Why the reply is read by another voice than xAI's (the reason, the
    /// key it is about), or that a key gave way to another: shown under
    /// the composer for a moment.
    @Published var notice: String?

    /// Voice mode's xAI voice for this bot (Session.readAloudVoice).
    struct VoiceModeVoice {
        let client: CompanionClient
        let botId: String
        let settings: VoiceModeSettings
    }

    private let player = SpeechClipPlayer()
    private let synthesizer = AVSpeechSynthesizer()
    private var task: Task<Void, Never>?
    private var deviceWaiter: CheckedContinuation<Void, Never>?

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func isSpeaking(_ id: String) -> Bool { messageId == id && status != .idle }

    /// Speak `text` for `id`, stopping whatever was speaking. The menu
    /// decides between this and `stop()` from what it showed, so a tap on
    /// Stop never restarts a reply that finished a moment before.
    func speak(_ text: String, messageId id: String, voiceId: String?, botId: String? = nil, session: any ReadAloudVoices) {
        stop()
        #if os(iOS)
        guard VoiceNoteCenter.shared.beginPlaybackSession() else { return }
        #endif
        let audio = AVAudioSession.sharedInstance()
        try? audio.setCategory(.playback, mode: .spokenAudio)
        try? audio.setActive(true)
        messageId = id
        status = .preparing
        notice = nil
        task = Task { [weak self] in
            await self?.read(text, voiceId: voiceId, botId: botId, session: session)
            guard let self, !Task.isCancelled else { return }
            self.finish()
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        player.stop()
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
        deviceWaiter?.resume()
        deviceWaiter = nil
        finish()
    }

    private func finish() {
        guard status != .idle || messageId != nil else { return }
        status = .idle
        messageId = nil
        #if os(iOS)
        VoiceNoteCenter.shared.endPlaybackSession()
        #else
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }

    private func read(_ text: String, voiceId: String?, botId: String?, session: any ReadAloudVoices) async {
        // voice mode's xAI voice: the person's own key, their Perspicax key
        // or the organization's, as on the call
        if let voice = await session.readAloudVoice(botId: botId) {
            guard !Task.isCancelled else { return }
            if await playVoiceMode(text, voice: voice) { return }
            guard !Task.isCancelled else { return }
        }
        if let prepared = await session.prepareSpeech(text: text, voiceId: voiceId),
           prepared.ready, !prepared.utterances.isEmpty {
            if await playComputerVoice(prepared.utterances, voiceId: voiceId, session: session) { return }
        }
        guard !Task.isCancelled else { return }
        // Apple's voice is the announced fallback, never a silent one
        if notice == nil { notice = String(localized: "Read with this iPhone's voice: no voice is set up on the computer for this bot.") }
        status = .speaking
        await deviceSpeak(Walkie.speakable(text, limit: 4_000))
    }

    /// True when xAI read every utterance; false hands the text to the
    /// next voice, with the reason in `notice`.
    private func playVoiceMode(_ text: String, voice: VoiceModeVoice) async -> Bool {
        let parts: [String]
        do { parts = try await voice.client.voiceModePrepare(botId: voice.botId, text: text) } catch { return failedVoiceMode(error) }
        guard !parts.isEmpty else { return true }
        let render = { (part: String) async throws -> Data in
            let (data, key) = try await voice.client.voiceModeSpeak(botId: voice.botId, text: part, settings: voice.settings, threadId: nil)
            if let line = key.fallbackLine { self.notice = line }
            return data
        }
        var current: Data
        do { current = try await render(parts[0]) } catch { return failedVoiceMode(error) }
        for index in parts.indices {
            guard !Task.isCancelled else { return true }
            var next: Task<Data, Error>?
            if index + 1 < parts.count {
                let upcoming = parts[index + 1]
                next = Task { try await render(upcoming) }
            }
            status = .speaking
            do { try await player.play(current) } catch { next?.cancel(); return false }
            guard let next else { return true }
            guard !Task.isCancelled else { next.cancel(); return true }
            do { current = try await next.value } catch { return Task.isCancelled || failedVoiceMode(error) }
        }
        return true
    }

    /// xAI could not read this: the reason and the key it is about
    /// (VoiceWords), then the next voice reads it.
    private func failedVoiceMode(_ error: Error) -> Bool {
        if Task.isCancelled { return true }
        if let failure = error as? VoiceFailure { notice = String(localized: "\(VoiceWords.line(failure)) Read with another voice.") }
        else { notice = String(localized: "xAI could not read this reply (\(error.localizedDescription)). Read with another voice.") }
        return false
    }

    /// True when every utterance played; false hands what is left to the
    /// phone's voice (nothing, when it was cancelled).
    private func playComputerVoice(_ parts: [String], voiceId: String?, session: any ReadAloudVoices) async -> Bool {
        var current: Data
        do { current = try await session.speechAudio(text: parts[0], voiceId: voiceId) } catch { return false }
        for index in parts.indices {
            guard !Task.isCancelled else { return true }
            var next: Task<Data, Error>?
            if index + 1 < parts.count {
                let upcoming = parts[index + 1]
                next = Task { try await session.speechAudio(text: upcoming, voiceId: voiceId) }
            }
            status = .speaking
            do { try await player.play(current) } catch { next?.cancel(); return false }
            guard let next else { return true }
            guard !Task.isCancelled else { next.cancel(); return true }
            do { current = try await next.value } catch { return Task.isCancelled }
        }
        return true
    }

    private func deviceSpeak(_ text: String) async {
        guard !text.isEmpty else { return }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
        await withCheckedContinuation { continuation in
            deviceWaiter = continuation
            synthesizer.speak(utterance)
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.deviceDone() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.deviceDone() }
    }

    private func deviceDone() {
        deviceWaiter?.resume()
        deviceWaiter = nil
    }
}

/// Plays one clip of speech audio and returns when it has finished (the
/// clip player Walkie had, kept for read-aloud when the call replaced it).
@MainActor
final class SpeechClipPlayer: NSObject, AVAudioPlayerDelegate {
    private var player: AVAudioPlayer?
    private var waiter: CheckedContinuation<Void, Never>?

    func play(_ audio: Data) async throws {
        let player = try AVAudioPlayer(data: audio)
        player.delegate = self
        player.prepareToPlay()
        self.player = player
        await withCheckedContinuation { continuation in
            waiter = continuation
            if !player.play() { finish() }
        }
    }

    func stop() {
        player?.stop()
        player = nil
        finish()
    }

    private func finish() {
        waiter?.resume()
        waiter = nil
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let id = ObjectIdentifier(player)
        Task { @MainActor in self.finished(id) }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        let id = ObjectIdentifier(player)
        Task { @MainActor in self.finished(id) }
    }

    private func finished(_ id: ObjectIdentifier) {
        guard let player, ObjectIdentifier(player) == id else { return }
        self.player = nil
        finish()
    }
}
