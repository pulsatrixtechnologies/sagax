import CompanionCore
import Foundation

/// The watch's voices for MessageSpeaker (#5129): the same reader as the
/// phone's read-aloud, fed by the watch's own client. Voice mode's voice (the
/// person's provider: xAI, OpenAI, ElevenLabs and the others) when the server
/// serves it to the person for this bot, with the person's
/// voice settings as the app keeps them on the server; else the computer's
/// provider with the bot's voice; else the watch's own voice (the reader's
/// announced fallback).
@MainActor
final class WatchVoices: ReadAloudVoices {
    private let client: CompanionClient
    private var status: [String: (available: Bool, at: Date)] = [:]
    private var settings: VoiceModeSettings?

    init(client: CompanionClient) {
        self.client = client
    }

    /// Can this person talk to this bot by voice here: a speech to text
    /// engine of theirs (xAI or OpenAI) hears them (WatchTalk.offersHold)?
    /// Asked again after a minute, like the phone's cache.
    func voiceMode(botId: String) async -> Bool {
        if let cached = status[botId], Date().timeIntervalSince(cached.at) < 60 { return cached.available }
        let available = WatchTalk.offersHold(try? await client.voiceModeStatus(botId: botId))
        status[botId] = (available, Date())
        return available
    }

    func readAloudVoice(botId: String?) async -> MessageSpeaker.VoiceModeVoice? {
        guard let botId, await voiceMode(botId: botId) else { return nil }
        return MessageSpeaker.VoiceModeVoice(client: client, botId: botId, settings: await voiceSettings())
    }

    func prepareSpeech(text: String, voiceId: String?) async -> SpeechPreparation? {
        try? await client.prepareSpeech(text: text, voiceId: voiceId)
    }

    func speechAudio(text: String, voiceId: String?) async throws -> Data {
        try await client.speech(text: text, voiceId: voiceId)
    }

    /// The person's Voice, Speed and Language from their preferences on the
    /// server, read once per session of the watch app.
    func voiceSettings() async -> VoiceModeSettings {
        if let settings { return settings }
        let read = WatchTalk.voiceSettings(preferences: (try? await client.preferences().preferences) ?? [:])
        settings = read
        return read
    }
}
