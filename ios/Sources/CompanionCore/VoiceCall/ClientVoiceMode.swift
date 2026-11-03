// The live call's routes (server/voice-mode.ts) and the call turn's send,
// the same requests the desktop's voice mode makes (src/lib/voice-mode/api.ts
// and LiveCall's send with `voiceCall`). The xAI key stays on the server:
// the phone gets a yes or no, voice labels, and audio.
import Foundation

/// Why voice mode cannot run for this person (shared/voice-mode.ts).
public struct VoiceModeRefusal: Decodable, Equatable, Sendable {
    public var cause: String
    public var admin: Bool?
    public var keysUrl: String?
}

/// A key as the server names it (server/voice-keys.ts, 2026-10-28): where
/// it comes from (`voice-key`: the person's own voice key saved in Sagax,
/// `perspicax-key`: their xAI key in Perspicax, `org-key`: the
/// organization's, `server`: a solo server's) and its last four
/// characters, never more.
public struct VoiceKeyInfo: Decodable, Equatable, Sendable {
    public var source: String
    public var last4: String?

    public init(source: String, last4: String? = nil) {
        self.source = source
        self.last4 = last4
    }
}

/// One key of the person's in the status, with what xAI refused it for
/// lately (`quota`, `key`), if anything.
public struct VoiceKeyState: Decodable, Equatable, Sendable {
    public var source: String
    public var last4: String?
    public var refused: String?
}

/// One key xAI refused on the way to the one that served.
public struct VoiceKeyRefusal: Decodable, Equatable, Sendable {
    public var source: String
    public var last4: String?
    public var failure: String

    public init(source: String, last4: String? = nil, failure: String) {
        self.source = source
        self.last4 = last4
        self.failure = failure
    }

    public var info: VoiceKeyInfo { VoiceKeyInfo(source: source, last4: last4) }
}

/// `GET /api/bots/<id>/voice/status`.
public struct VoiceModeStatus: Decodable, Equatable, Sendable {
    public var provider: String
    public var available: Bool
    /// An organization server: voice mode is the only call there.
    public var organization: Bool?
    public var via: String?
    /// the key the next request starts with (an older server names none)
    public var key: VoiceKeyInfo?
    /// every key that may serve, in order, the refused ones last
    public var keys: [VoiceKeyState]?
    public var refusal: VoiceModeRefusal?
    /// The call runs on the realtime voice (the desktop's `realtimeCallReady`,
    /// 2026-11-02: a call is never text to speech). Nil from an older server.
    public var realtime: Bool?

    /// `realtimeCallReady`: available and on the realtime voice. An older
    /// server that names no `realtime` keeps its call.
    public var realtimeCallReady: Bool { available && (realtime ?? true) }

    public init(provider: String = "xai", available: Bool, organization: Bool? = nil, via: String? = nil, key: VoiceKeyInfo? = nil, keys: [VoiceKeyState]? = nil, refusal: VoiceModeRefusal? = nil, realtime: Bool? = nil) {
        self.realtime = realtime
        self.provider = provider
        self.available = available
        self.organization = organization
        self.via = via
        self.key = key
        self.keys = keys
        self.refusal = refusal
    }
}

/// A voice route said no (server/voice-mode.ts): a refusal (403
/// `voice_no_access`, no key serves this person), xAI failing the request
/// (502 `voice_provider`, with its kind and the key it is about), this
/// server's own rate limit (429) or spend limit (409 `spend_cap`). Thrown
/// by the voice calls below in place of a bare `APIError.status`, so the
/// phone can say what is wrong and about which key, like the desktop's
/// bar (src/lib/voice-mode/failure.ts). Never carries a key.
public struct VoiceFailure: Error, Equatable, Sendable {
    public var status: Int
    /// the server's own sentence (English), for the log and as a last resort
    public var message: String?
    public var code: String?
    /// a refusal's cause: `no_credentials`, `payer_disabled`, `perspicax_unreachable`, `server_engine_not_allowed`
    public var cause: String?
    /// xAI's failure as the server sorted it: `key`, `quota`, `busy`, `down`, `voice`, `other`
    public var failure: String?
    /// the key the failure is about
    public var key: VoiceKeyInfo?
    /// every key refused on the way (when more than one was)
    public var tried: [VoiceKeyRefusal]?
    public var keysUrl: String?
    public var admin: Bool?

    public init(status: Int, message: String? = nil, code: String? = nil, cause: String? = nil, failure: String? = nil, key: VoiceKeyInfo? = nil, tried: [VoiceKeyRefusal]? = nil, keysUrl: String? = nil, admin: Bool? = nil) {
        self.status = status
        self.message = message
        self.code = code
        self.cause = cause
        self.failure = failure
        self.key = key
        self.tried = tried
        self.keysUrl = keysUrl
        self.admin = admin
    }

    private struct Body: Decodable {
        var error: String?
        var code: String?
        var cause: String?
        var failure: String?
        var key: VoiceKeyInfo?
        var tried: [VoiceKeyRefusal]?
        var card: Card?
        struct Card: Decodable {
            var keysUrl: String?
            var admin: Bool?
        }
    }

    /// The failure a non-2xx voice answer carries, or nil when the body is
    /// not one of the voice route's (an older server, a proxy's page).
    public static func parse(status: Int, data: Data) -> VoiceFailure? {
        guard let body = try? JSONDecoder().decode(Body.self, from: data) else { return nil }
        let voice = body.code == "voice_no_access" || body.code == "voice_provider" || body.code == "spend_cap" || status == 429
        guard voice else { return nil }
        return VoiceFailure(status: status, message: body.error, code: body.code, cause: body.cause, failure: body.failure, key: body.key, tried: body.tried, keysUrl: body.card?.keysUrl, admin: body.card?.admin)
    }

    /// No key serves this person (403).
    public var refused: Bool { code == "voice_no_access" }

    /// xAI's kind, with this server's own limits sorted like the desktop
    /// does (429: `busy`, spend limit: `quota`).
    public var kind: String? {
        if code == "voice_provider" { return failure ?? "other" }
        if status == 429 { return "busy" }
        if code == "spend_cap" { return "quota" }
        return nil
    }

    /// A failure another moment may not repeat (xAI busy or failing).
    public var transient: Bool { kind == "busy" || kind == "down" }

    /// A refusal every later request would get too.
    public var permanent: Bool { refused || kind == "key" || kind == "quota" || kind == "voice" }
}

/// What the phone says about a voice failure or a key, in the app's
/// language: the desktop's `voiceErrorNote`, `voiceKeyLabel` and
/// `voiceKeyFallbackNote` (src/lib/voice-mode/failure.ts). Never a raw
/// server line when the server sorted the failure.
public enum VoiceWords {
    /// "your voice key ···Wez8", "the organization's xAI key".
    public static func keyLabel(_ key: VoiceKeyInfo) -> String {
        let tail = key.last4.map { " ···\($0)" } ?? ""
        switch key.source {
        case "voice-key": return String(localized: "your voice key\(tail)")
        case "perspicax-key": return String(localized: "your xAI key in Perspicax\(tail)")
        case "org-key": return String(localized: "the organization's xAI key\(tail)")
        default: return String(localized: "this server's xAI key\(tail)")
        }
    }

    /// What to do about a key of that source.
    public static func keyAction(_ key: VoiceKeyInfo) -> String {
        switch key.source {
        case "voice-key": return String(localized: "Add credits to that xAI account, or change the key in Settings > Models and voice > My voice keys on the computer.")
        case "perspicax-key": return String(localized: "Add credits to that xAI account, or change the key in Perspicax (Providers > Grok).")
        case "org-key": return String(localized: "Ask an admin, or add your own xAI key in Settings > Models and voice > My voice keys on the computer.")
        default: return String(localized: "Add credits to that xAI account, or change the key in Settings > Models and voice on the computer.")
        }
    }

    /// The lines of a refusal (no key serves this person), as the call's
    /// "Voice mode unavailable" alert and the bar say them.
    public static func refusalLines(cause: String?, admin: Bool) -> [String] {
        switch cause {
        case "payer_disabled": return [String(localized: "Your account is disabled: voice mode can't run.")]
        case "perspicax_unreachable": return [String(localized: "Perspicax could not be reached to read your xAI key. Try again in a moment.")]
        case "server_engine_not_allowed":
            return [String(localized: "Your organization has not given you its xAI voice. Add your own xAI key in Perspicax, or ask an admin.")]
        default:
            var lines = [String(localized: "You don't have xAI access for voice mode: add your xAI key in Perspicax.")]
            if admin { lines.append(String(localized: "As an administrator, you can also add the organization's xAI key in Settings > Connections on the computer.")) }
            return lines
        }
    }

    /// One sentence for a failure: the reason, the key it is about and
    /// what to do, or the plain line when the server named no key.
    public static func line(_ failure: VoiceFailure) -> String {
        if failure.refused { return refusalLines(cause: failure.cause, admin: failure.admin == true).joined(separator: " ") }
        switch failure.kind {
        case "quota":
            if failure.code == "spend_cap" { return String(localized: "The spend limit is reached: the voice stops here. The answers stay in the chat.") }
            if let key = failure.key { return String(localized: "xAI has no credits left for \(keyLabel(key)). \(keyAction(key)) The answers stay in the chat.") }
            return String(localized: "The xAI account has no voice credits left, or the spend limit is reached. The answers stay in the chat.")
        case "key":
            if let key = failure.key { return String(localized: "xAI rejected \(keyLabel(key)): invalid, revoked, or without voice permission. \(keyAction(key)) The answers stay in the chat.") }
            return String(localized: "xAI refused the voice key. Check your xAI key in Settings > Models and voice on the computer.")
        case "busy":
            if let key = failure.key, failure.code == "voice_provider" { return String(localized: "xAI is rate-limiting \(keyLabel(key)). It comes back by itself; the answers stay in the chat.") }
            return String(localized: "xAI voice is busy right now. It comes back by itself; the answers stay in the chat.")
        case "down": return String(localized: "xAI voice is not answering right now. The answers stay in the chat.")
        case "voice": return String(localized: "xAI no longer has the chosen voice. Pick another one in the call settings.")
        default: return failure.message ?? String(localized: "The voice didn't come through. The answer is in the chat.")
        }
    }

    /// Said once when the voice went on over another key.
    public static func fallback(used: VoiceKeyInfo, skipped: [VoiceKeyRefusal]) -> String? {
        guard let refused = skipped.last else { return nil }
        let reason = refused.failure == "quota" ? String(localized: "no credits") : String(localized: "key rejected")
        return String(localized: "\(keyLabel(refused.info)) was refused (\(reason)). The voice now runs on \(keyLabel(used)).")
    }

    /// The call's provider line: which key the voice runs on.
    public static func providerLine(key: VoiceKeyInfo?, via: String?) -> String {
        if let key { return String(localized: "Voice: xAI with \(keyLabel(key))") }
        switch via {
        case "speaker-key": return String(localized: "Voice: xAI, with your key")
        case "org-key": return String(localized: "Voice: xAI, with the organization's key")
        default: return String(localized: "Voice: xAI")
        }
    }
}

public struct VoiceModeVoice: Decodable, Hashable, Identifiable, Sendable {
    public var id: String
    public var label: String
}

/// `Message.voiceCall` on a send: the turn was said on a live call, so the
/// server adds its hidden phone-call instruction (server/voice-call-prompt.ts).
public struct VoiceCallMeta: Codable, Hashable, Sendable {
    public var callId: String
    public var interrupted: Bool?
    public var language: String?
    /// One id per utterance (also the send's `sendId`): the server delivers
    /// it once, and answers a second send of it with the first receipt.
    public var utteranceId: String?
    /// A barge-in: what the person heard of the cut answer, and what not.
    public var heard: String?
    public var unheard: String?
    /// It completes the fragment sent just before (cut by a pause).
    public var continues: Bool?
    /// Full-duplex: replace the in-flight turn, never steer or queue.
    public var duplex: Bool?

    /// The longest heard or unheard excerpt kept (server VOICE_CALL_EXCERPT_MAX).
    public static let excerptMax = 1_200

    public init(callId: String, interrupted: Bool = false, language: String? = nil, utteranceId: String? = nil, cut: PlaybackCut? = nil, continues: Bool = false, duplex: Bool = false) {
        self.callId = callId
        self.interrupted = interrupted ? true : nil
        // "auto" is never sent: the server takes only a picked language
        self.language = language.flatMap { $0 == "auto" || !VoiceModeSettings.isLanguage($0) ? nil : $0 }
        self.utteranceId = utteranceId
        // what was heard only means something for words that cut the bot
        if interrupted, let cut {
            heard = Self.excerpt(cut.heard)
            unheard = Self.excerpt(cut.unheard)
        }
        self.continues = continues ? true : nil
        self.duplex = duplex ? true : nil
    }

    private static func excerpt(_ text: String) -> String? {
        let folded = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard !folded.isEmpty else { return nil }
        return folded.count > excerptMax ? String(folded.prefix(excerptMax - 1)) + "\u{2026}" : folded
    }

    var json: [String: Any] {
        var out: [String: Any] = ["callId": callId]
        if let utteranceId { out["utteranceId"] = utteranceId }
        if continues == true { out["continues"] = true }
        if interrupted == true {
            out["interrupted"] = true
            if let heard { out["heard"] = heard }
            if let unheard { out["unheard"] = unheard }
        }
        if let language { out["language"] = language }
        if duplex == true { out["duplex"] = true }
        return out
    }
}

/// The call's life on the server (POST /voice/call): every send to the
/// thread while it lasts is a call turn, whatever path it takes.
public enum VoiceCallSessionState: String, Sendable { case start, alive, end }

/// One sentence of the bot's voice, as the server streams it: raw 16-bit
/// little-endian PCM at `sampleRate`, in chunks as xAI makes it.
public struct VoiceStreamAudio: Sendable {
    public let sampleRate: Double
    public let chunks: AsyncThrowingStream<Data, Error>
    /// the key that speaks, and the ones refused on the way
    public var key: VoiceKeyOutcome = VoiceKeyOutcome()
}

/// Which voice reads the bot's answers on this call, in order of preference:
/// what the desktop would use for the same bot, then the phone's own.
public enum CallVoiceSource: Equatable, Sendable {
    /// voice mode with xAI (POST /voice/stream), the person's Voice/Speed/Language
    case xai
    /// the computer's voice provider (POST /api/tts/speak) with the bot's voice
    case server(voiceId: String?)
    /// ElevenLabs straight from the phone, with the key in its Keychain
    case phoneElevenLabs(voiceId: String?)
    /// the phone's best installed voice
    case device

    /// The phone's own voice (Apple) is only the explicit fallback when no
    /// voice provider is set up: with voice mode (xAI, the person's key or
    /// the organization's) a failed sentence is retried on xAI and the
    /// answer stays in the chat, never read by another voice in silence.
    public static func route(voiceMode: VoiceModeStatus?, config: ConfigStatus?, agentVoice: String?, phoneKey: Bool) -> [CallVoiceSource] {
        var out: [CallVoiceSource] = []
        if voiceMode?.available == true { out.append(.xai) }
        if let config, config.canSpeak(agentVoice: agentVoice) {
            let voice = agentVoice?.trimmingCharacters(in: .whitespacesAndNewlines)
            out.append(.server(voiceId: voice?.isEmpty == false ? voice : nil))
        }
        if phoneKey { out.append(.phoneElevenLabs(voiceId: config?.walkieAgentVoice(agentVoice))) }
        if out.isEmpty { out.append(.device) }
        return out
    }
}

/// Who hears and speaks on a call, as the call shows it: xAI through the
/// server (voice mode, the same as the desktop: the person's own xAI key,
/// else the organization's), or Apple on this phone when no voice provider
/// is set up (a group call, the demo, a server without voice mode).
public enum CallProvider: Equatable, Sendable {
    /// `via`: whose key pays (`speaker-key`, `org-key`, `server`)
    case xai(via: String?)
    case apple

    /// The desktop's choice for the same person: voice mode when the server
    /// says it is available for this bot, Apple only otherwise.
    public static func choose(voiceMode: VoiceModeStatus?, room: Bool, demo: Bool) -> CallProvider {
        guard !demo, !room, voiceMode?.available == true else { return .apple }
        return .xai(via: voiceMode?.via)
    }

    /// The person's words go to xAI's speech to text (the server), not to
    /// the phone's recognizer.
    public var recognizesOnServer: Bool {
        if case .xai = self { return true }
        return false
    }
}

/// A failure of the voice that may not happen again a moment later: xAI
/// rate limited or failing (429, 5xx), or the network.
public func transientVoiceFailure(_ error: Error) -> Bool {
    if let failure = error as? VoiceFailure { return failure.transient || (failure.kind == nil && failure.status >= 500) }
    if case let APIError.status(code, _) = error { return code == 429 || code >= 500 }
    if case APIError.transport = error { return true }
    return error is URLError
}

/// A refusal every later voice request would get too (no key, no credit).
public func permanentVoiceFailure(_ error: Error) -> Bool {
    if let failure = error as? VoiceFailure { return failure.permanent }
    if case let APIError.status(code, _) = error { return [401, 402, 403, 404, 409].contains(code) }
    return false
}

/// `x-voice-key: source:last4` as the server writes a key in a header.
public func parseVoiceKeyHeader(_ value: String?) -> VoiceKeyInfo? {
    guard let value, !value.isEmpty else { return nil }
    let parts = value.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
    guard let source = parts.first, !source.isEmpty else { return nil }
    let last4 = parts.count > 1 && !parts[1].isEmpty ? parts[1] : nil
    return VoiceKeyInfo(source: source, last4: last4)
}

/// `x-voice-key-skipped: source:last4:failure,...`.
public func parseVoiceKeySkippedHeader(_ value: String?) -> [VoiceKeyRefusal] {
    guard let value, !value.isEmpty else { return [] }
    return value.split(separator: ",").compactMap { entry in
        let parts = entry.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 3, !parts[0].isEmpty, !parts[2].isEmpty else { return nil }
        return VoiceKeyRefusal(source: parts[0], last4: parts[1].isEmpty ? nil : parts[1], failure: parts[2])
    }
}

/// What a voice answer said about the key that served (and the ones
/// refused on the way): the headers of an HTTP answer, or a body's fields.
public struct VoiceKeyOutcome: Equatable, Sendable {
    public var used: VoiceKeyInfo?
    public var skipped: [VoiceKeyRefusal]

    public init(used: VoiceKeyInfo? = nil, skipped: [VoiceKeyRefusal] = []) {
        self.used = used
        self.skipped = skipped
    }

    public static func from(headers: [AnyHashable: Any]?) -> VoiceKeyOutcome {
        let header = { (name: String) -> String? in
            headers?.first { String(describing: $0.key).lowercased() == name }?.value as? String
        }
        return VoiceKeyOutcome(used: parseVoiceKeyHeader(header("x-voice-key")), skipped: parseVoiceKeySkippedHeader(header("x-voice-key-skipped")))
    }

    /// The voice went on over another key: what to say, once.
    public var fallbackLine: String? {
        guard let used, !skipped.isEmpty else { return nil }
        return VoiceWords.fallback(used: used, skipped: skipped)
    }
}

/// A turn's words with the key that heard them.
public struct VoiceTranscription: Equatable, Sendable {
    public var text: String
    public var key: VoiceKeyOutcome

    public init(text: String, key: VoiceKeyOutcome = VoiceKeyOutcome()) {
        self.text = text
        self.key = key
    }
}

extension CompanionClient {
    private static func voiceBase(_ botId: String) throws -> String {
        guard validRouteID(botId) else { throw APIError.badURL }
        return "/api/bots/\(botId)/voice"
    }

    /// A voice route's non-2xx as a VoiceFailure (the reason, the kind and
    /// the key it is about) when the body is the voice route's, else the
    /// ordinary APIError.
    static func checkVoice(_ response: URLResponse, _ data: Data) throws {
        guard let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) else { return }
        if let failure = VoiceFailure.parse(status: http.statusCode, data: data) { throw failure }
        try check(response, data)
    }

    private func sendVoice<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> (T, VoiceKeyOutcome) {
        let (data, response) = try await perform(request)
        try Self.checkVoice(response, data)
        do {
            return (try JSONDecoder().decode(T.self, from: data), VoiceKeyOutcome.from(headers: (response as? HTTPURLResponse)?.allHeaderFields))
        } catch {
            throw APIError.transport("The computer sent something this app couldn't read.")
        }
    }

    /// Can this person talk to this bot with voice mode, and who pays.
    public func voiceModeStatus(botId: String) async throws -> VoiceModeStatus {
        try await send(try makeRequest("GET", "\(Self.voiceBase(botId))/status"), as: VoiceModeStatus.self)
    }

    /// The voices of one provider (labels only): the one this bot speaks
    /// with (`provider`, nil: the server's pick for the person).
    public func voiceModeVoices(botId: String, provider: String? = nil) async throws -> [VoiceModeVoice] {
        struct Body: Decodable { var voices: [VoiceModeVoice]? }
        let query = provider.map { "?provider=\($0)" } ?? ""
        return try await sendVoice(try makeRequest("GET", "\(Self.voiceBase(botId))/voices\(query)"), as: Body.self).0.voices ?? []
    }

    /// The body fields of the voice that speaks for this bot: its voice,
    /// and its provider when the person picked one (2026-10-29).
    public static func voiceFields(_ settings: VoiceModeSettings, botId: String) -> [String: Any] {
        let view = settings.resolvedFor == botId ? settings : settings.forBot(botId)
        var body: [String: Any] = ["voice": view.voice, "speed": view.speed, "language": view.language]
        if let provider = view.ttsProvider { body["tts"] = provider }
        return body
    }

    /// A text cut into what the voice says (POST /voice/prepare), for a
    /// reply read aloud with voice mode's xAI voice.
    public func voiceModePrepare(botId: String, text: String) async throws -> [String] {
        struct Body: Decodable { var utterances: [String]? }
        return try await sendVoice(try makeRequest("POST", "\(Self.voiceBase(botId))/prepare", body: ["text": text]), as: Body.self).0.utterances ?? []
    }

    /// One utterance as an MP3 clip (POST /voice/speak), with the person's
    /// Voice, Speed and Language: a reply read aloud.
    public func voiceModeSpeak(botId: String, text: String, settings: VoiceModeSettings, threadId: String?) async throws -> (Data, VoiceKeyOutcome) {
        var body = Self.voiceFields(settings, botId: botId)
        body["text"] = String(text.prefix(500))
        if let threadId, Self.validRouteID(threadId) { body["threadId"] = threadId }
        var request = try makeRequest("POST", "\(Self.voiceBase(botId))/speak", body: body)
        request.timeoutInterval = 30
        let (data, response) = try await perform(request)
        try Self.checkVoice(response, data)
        return (data, VoiceKeyOutcome.from(headers: (response as? HTTPURLResponse)?.allHeaderFields))
    }

    /// One sentence spoken as xAI makes it; nil when there is nothing to say.
    public func voiceModeStream(botId: String, text: String, settings: VoiceModeSettings, threadId: String?) async throws -> VoiceStreamAudio? {
        var body = Self.voiceFields(settings, botId: botId)
        body["text"] = text
        if let threadId, Self.validRouteID(threadId) { body["threadId"] = threadId }
        var request = try makeRequest("POST", "\(Self.voiceBase(botId))/stream", body: body)
        request.timeoutInterval = 30
        let (bytes, response): (URLSession.AsyncBytes, URLResponse)
        do {
            (bytes, response) = try await streamingSession.bytes(for: request)
        } catch {
            throw APIError.transport(error.localizedDescription)
        }
        let http = response as? HTTPURLResponse
        if http?.statusCode == 204 { return nil }
        if let http, !(200...299).contains(http.statusCode) {
            var data = Data()
            for try await byte in bytes {
                data.append(byte)
                if data.count > 16_384 { break }
            }
            try Self.checkVoice(response, data)
        }
        let rate = Double(http?.value(forHTTPHeaderField: "x-voice-sample-rate") ?? "") ?? 24_000
        let key = VoiceKeyOutcome.from(headers: http?.allHeaderFields)
        let chunks = AsyncThrowingStream<Data, Error> { continuation in
            let task = Task {
                var chunk = Data()
                chunk.reserveCapacity(4_800)
                do {
                    for try await byte in bytes {
                        chunk.append(byte)
                        if chunk.count >= 4_800 {
                            continuation.yield(chunk)
                            chunk = Data()
                            chunk.reserveCapacity(4_800)
                        }
                    }
                    if !chunk.isEmpty { continuation.yield(chunk) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
        return VoiceStreamAudio(sampleRate: rate, chunks: chunks, key: key)
    }

    /// Native WebSocket to `GET /api/bots/<id>/voice/listen` (no Origin; a
    /// missing Origin passes the server's same-origin check for native
    /// clients). Query matches the desktop's `voiceModeListenUrl`.
    public func voiceModeListenRequest(
        botId: String,
        language: String,
        threadId: String?,
        locale: String? = Locale.current.identifier.replacingOccurrences(of: "_", with: "-"),
        stt: String = "auto"
    ) throws -> URLRequest {
        let lang = VoiceModeSettings.isLanguage(language) ? language : "auto"
        var query = [
            URLQueryItem(name: "language", value: lang),
            URLQueryItem(name: "stt", value: stt),
        ]
        if lang == "auto", let locale, !locale.isEmpty {
            query.append(URLQueryItem(name: "locale", value: locale))
        }
        if let threadId, Self.validRouteID(threadId) {
            query.append(URLQueryItem(name: "threadId", value: threadId))
        }
        var request = try makeRequest("GET", "\(Self.voiceBase(botId))/listen", query: query)
        guard var components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false) else { throw APIError.badURL }
        if components.scheme == "https" { components.scheme = "wss" }
        else { components.scheme = "ws" }
        request.url = components.url
        return request
    }

    /// One whole turn uploaded (16 kHz mono WAV): xAI's speech to text on
    /// the server, the words and the key that heard them.
    public func voiceModeTranscription(botId: String, wav: Data, language: String, threadId: String?) async throws -> VoiceTranscription {
        var query = [URLQueryItem(name: "language", value: VoiceModeSettings.isLanguage(language) ? language : "auto")]
        if let threadId, Self.validRouteID(threadId) { query.append(URLQueryItem(name: "threadId", value: threadId)) }
        var request = try makeRequest("POST", "\(Self.voiceBase(botId))/transcribe", query: query)
        request.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
        request.httpBody = wav
        request.timeoutInterval = 30
        struct Body: Decodable { var text: String? }
        let (body, key) = try await sendVoice(request, as: Body.self)
        return VoiceTranscription(text: body.text ?? "", key: key)
    }

    /// The words only (voiceModeTranscription).
    public func voiceModeTranscribe(botId: String, wav: Data, language: String, threadId: String?) async throws -> String {
        try await voiceModeTranscription(botId: botId, wav: wav, language: language, threadId: threadId).text
    }

    /// The computer's own voice provider (`POST /api/tts/speak`): audio bytes.
    public func speak(text: String, voiceId: String?) async throws -> Data {
        var body: [String: Any] = ["text": String(text.prefix(500))]
        if let voiceId, !voiceId.isEmpty { body["voiceId"] = voiceId }
        var request = try makeRequest("POST", "/api/tts/speak", body: body)
        request.timeoutInterval = 30
        let (data, response) = try await perform(request)
        try Self.check(response, data)
        return data
    }

    /// A turn said on a live call: an ordinary send to the bot, marked as a
    /// call turn exactly like the desktop's (`voiceCall`).
    @discardableResult
    public func send(text: String, toBot botId: String, threadId: String?, voiceCall: VoiceCallMeta, singleStream: Bool? = nil) async throws -> SendReceipt {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        var body: [String: Any] = ["text": text, "voiceCall": voiceCall.json]
        if let threadId { body["threadId"] = threadId }
        // one conversation per bot on this phone (SingleStream): the server
        // keeps the thread a segment of that stream, as the desktop's sends do
        if let singleStream { body["singleStream"] = singleStream }
        // the utterance id is the send's id: delivered once, whatever retries
        if let utteranceId = voiceCall.utteranceId { body["sendId"] = utteranceId }
        let (data, response) = try await perform(try makeRequest("POST", "/api/bots/\(botId)/messages", body: body))
        try Self.check(response, data)
        return (try? JSONDecoder().decode(SendReceipt.self, from: data)) ?? SendReceipt()
    }

    /// Tell the server the thread is on a call (start, alive every few
    /// minutes, end). Best effort: an old server without the route still
    /// gets each turn's mark. True when the server took it.
    @discardableResult
    public func voiceCallSession(botId: String, state: VoiceCallSessionState, callId: String, threadId: String?, language: String?) async -> Bool {
        await postVoiceCall(botId: botId, state: state, callId: callId, threadId: threadId, language: language) != nil
    }

    /// The call's start, with the words the person's speech should be
    /// expected to contain (the bot's name, the person's, the thread's
    /// proper nouns), for the phone's own recognizer. Nil when the server
    /// could not be told (best effort); empty when it has no keyterms or
    /// is older than the field.
    public func voiceCallStart(botId: String, callId: String, threadId: String?, language: String?) async -> [String]? {
        guard let data = await postVoiceCall(botId: botId, state: .start, callId: callId, threadId: threadId, language: language) else { return nil }
        struct Body: Decodable { var keyterms: [String]? }
        return CallKeyterms.contextual((try? JSONDecoder().decode(Body.self, from: data))?.keyterms ?? [])
    }

    private func postVoiceCall(botId: String, state: VoiceCallSessionState, callId: String, threadId: String?, language: String?) async -> Data? {
        var body: [String: Any] = ["state": state.rawValue, "callId": callId]
        if let threadId, Self.validRouteID(threadId) { body["threadId"] = threadId }
        if let language, language != "auto", VoiceModeSettings.isLanguage(language) { body["language"] = language }
        guard let request = try? makeRequest("POST", "\(Self.voiceBase(botId))/call", body: body),
              let (data, response) = try? await perform(request),
              (try? Self.check(response, data)) != nil else { return nil }
        return data
    }

    public func interrupt(roomId: String) async throws {
        guard Self.validRouteID(roomId) else { throw APIError.badURL }
        try await send(try makeRequest("POST", "/api/groups/\(roomId)/interrupt"))
    }
}

/// Words the phone's recognizer should expect on a call (the server's
/// keyterms, POST /voice/call start): contextualStrings for
/// SFSpeechRecognizer and SpeechAnalyzer's AnalysisContext.
public enum CallKeyterms {
    /// Apple advises about a hundred phrases at most.
    public static let limit = 100
    /// Longest phrase kept (the server's own cap).
    public static let maxCharacters = 50

    /// Trimmed, blank and over-long phrases dropped, duplicates (ignoring
    /// case) kept once in their first spelling, at most `limit`.
    public static func contextual(_ terms: [String], limit: Int = CallKeyterms.limit) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for raw in terms {
            guard out.count < limit else { break }
            let term = raw.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
            guard !term.isEmpty, term.count <= maxCharacters else { continue }
            guard seen.insert(term.lowercased()).inserted else { continue }
            out.append(term)
        }
        return out
    }
}

/// 16 kHz mono 16-bit PCM of float frames (listen socket) and WAV (upload).
public enum CallWav {
    /// Raw little-endian PCM16 (no WAV header): what `/voice/listen` takes.
    public static func pcm16(_ samples: [Float]) -> Data {
        var pcm = Data(capacity: samples.count * 2)
        for sample in samples {
            let clamped = max(-1, min(1, sample))
            var value = Int16(clamped < 0 ? clamped * 32768 : clamped * 32767).littleEndian
            withUnsafeBytes(of: &value) { pcm.append(contentsOf: $0) }
        }
        return pcm
    }

    public static func encode(_ samples: [Float], sampleRate: Int = 16_000) -> Data {
        let pcm = pcm16(samples)
        var header = Data()
        func append<T: FixedWidthInteger>(_ value: T) {
            var little = value.littleEndian
            withUnsafeBytes(of: &little) { header.append(contentsOf: $0) }
        }
        header.append(contentsOf: Array("RIFF".utf8))
        append(UInt32(36 + pcm.count))
        header.append(contentsOf: Array("WAVEfmt ".utf8))
        append(UInt32(16))
        append(UInt16(1))
        append(UInt16(1))
        append(UInt32(sampleRate))
        append(UInt32(sampleRate * 2))
        append(UInt16(2))
        append(UInt16(16))
        header.append(contentsOf: Array("data".utf8))
        append(UInt32(pcm.count))
        return header + pcm
    }

    /// Decode a 16-bit PCM WAV (any rate, mono or the first channel) to
    /// floats and its rate. Nil for anything else.
    public static func decode(_ data: Data) -> (samples: [Float], sampleRate: Int)? {
        let bytes = [UInt8](data)
        guard bytes.count > 44, String(decoding: bytes[0..<4], as: UTF8.self) == "RIFF",
              String(decoding: bytes[8..<12], as: UTF8.self) == "WAVE" else { return nil }
        func u16(_ at: Int) -> Int { Int(bytes[at]) | Int(bytes[at + 1]) << 8 }
        func u32(_ at: Int) -> Int { u16(at) | u16(at + 2) << 16 }
        var at = 12
        var channels = 1, rate = 16_000, bits = 16
        while at + 8 <= bytes.count {
            let id = String(decoding: bytes[at..<(at + 4)], as: UTF8.self)
            let size = u32(at + 4)
            let body = at + 8
            if id == "fmt " {
                channels = max(1, u16(body + 2))
                rate = u32(body + 4)
                bits = u16(body + 14)
            } else if id == "data" {
                guard bits == 16 else { return nil }
                let end = min(bytes.count, body + size)
                var samples: [Float] = []
                samples.reserveCapacity((end - body) / (2 * channels))
                var i = body
                while i + 1 < end {
                    let value = Int16(bitPattern: UInt16(bytes[i]) | UInt16(bytes[i + 1]) << 8)
                    samples.append(Float(value) / 32768)
                    i += 2 * channels
                }
                return (samples, rate)
            }
            at = body + size + (size % 2)
        }
        return nil
    }
}
