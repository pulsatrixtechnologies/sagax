// Settings > Voice, "Who speaks and who listens" (2026-10-29,
// src/components/settings/VoiceProviderSettings.tsx): the providers the
// person has a usable key for (`GET /api/voice/status`), a provider's voices
// (`GET /api/voice/voices`) and "Test the voice" (`POST /api/voice/speak`),
// for no bot. Never a key.
import Foundation

public struct VoiceProvidersStatus: Decodable, Equatable, Sendable {
    public struct Offered: Decodable, Equatable, Sendable {
        public var tts: [String]?
        public var stt: [String]?
    }
    public var available: Bool?
    public var providers: Offered?
    /// The provider the server starts with.
    public var tts: String?
    public var stt: String?

    public init(available: Bool? = nil, providers: Offered? = nil, tts: String? = nil, stt: String? = nil) {
        self.available = available
        self.providers = providers
        self.tts = tts
        self.stt = stt
    }

    public var offeredTts: [String] { providers?.tts ?? [] }
    public var offeredStt: [String] { providers?.stt ?? [] }
}

public enum VoiceProviderChoice {
    /// The desktop's labels (VOICE_PROVIDER_LABELS, voice.engine.*).
    public static func label(_ provider: String, system: String, chatterbox: String) -> String {
        switch provider {
        case "xai": "xAI"
        case "openai": "OpenAI"
        case "elevenlabs": "ElevenLabs"
        case "fish": "Fish Audio"
        case "system": system
        case "chatterbox": chatterbox
        default: provider
        }
    }

    /// `providerOptions`: Auto, then each provider offered; the one picked
    /// stays listed when its key went away, named so (`noKey`).
    public static func options(offered: [String], all: [String], picked: String, auto: String,
                               label: (String) -> String, noKey: (String) -> String) -> [(String, String)] {
        var out: [(String, String)] = [("auto", auto)]
        for provider in all {
            if offered.contains(provider) { out.append((provider, label(provider))) }
            else if picked == provider { out.append((provider, noKey(label(provider)))) }
        }
        return out
    }

    /// The provider whose voice is picked: the one chosen, else the one the
    /// server starts with, else the first offered.
    public static func speaking(picked: String, status: VoiceProvidersStatus?) -> String? {
        if picked != "auto" { return picked }
        return status?.tts ?? status?.offeredTts.first
    }
}

public extension CompanionClient {
    func voiceProvidersStatusRequest(tts: String, stt: String) throws -> URLRequest {
        try makeRequest("GET", "/api/voice/status", query: [URLQueryItem(name: "tts", value: tts), URLQueryItem(name: "stt", value: stt)])
    }

    func voiceProvidersStatus(tts: String, stt: String) async throws -> VoiceProvidersStatus {
        try await send(voiceProvidersStatusRequest(tts: tts, stt: stt), as: VoiceProvidersStatus.self)
    }

    func providerVoices(_ provider: String) async throws -> [VoiceModeVoice] {
        struct Body: Decodable { var voices: [VoiceModeVoice]? }
        return try await send(try makeRequest("GET", "/api/voice/voices", query: [URLQueryItem(name: "provider", value: provider)]), as: Body.self).voices ?? []
    }

    func testVoiceRequest(text: String, settings: VoiceModeSettings) throws -> URLRequest {
        let view = settings.forBot(nil)
        var body: [String: Any] = ["text": text, "voice": view.voice, "speed": view.speed, "language": view.language]
        if let provider = view.ttsProvider { body["tts"] = provider }
        var request = try makeRequest("POST", "/api/voice/speak", body: body)
        request.timeoutInterval = 30
        return request
    }

    /// "Test the voice": a short sample as audio.
    func testVoice(text: String, settings: VoiceModeSettings) async throws -> Data {
        let (data, response) = try await perform(testVoiceRequest(text: text, settings: settings))
        try Self.check(response, data)
        return data
    }
}
