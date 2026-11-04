// Voice mode's settings, the same values as the desktop (shared/voice-mode.ts
// and src/lib/voice-mode/call-settings.ts): the voice that reads a bot's
// answers, its speed and the language the person speaks (kept under the
// desktop's own key, `omb.voiceMode.v1`, so an organization server's synced
// preferences carry the same choice between the phone and the computer),
// and how this phone takes part in a call (hands-free or push to talk, call
// sounds), which stays on this device like the desktop's `omb.voiceCall.v1`.
import Foundation

public struct VoiceModeLanguage: Hashable, Sendable {
    public let code: String
    public let label: String
}

public struct VoiceModeSettings: Codable, Equatable, Sendable {
    /// An xAI voice id; "" is Not set (xAI's default voice). In a view for
    /// one bot (`forBot`), the voice of that bot's provider.
    public var voice: String
    public var speed: Double
    public var language: String
    /// The desktop's other fields of the same preference, kept as they are
    /// (2026-10-29, shared/voice-providers.ts): `tts`, `stt`, `voices` (a
    /// voice per provider) and `bots` (a bot's own choice). Sorted JSON.
    public var extraJSON: String
    /// Set on a view for one bot: the provider that speaks ("openai",
    /// "elevenlabs", "xai"), nil for Auto. Never stored.
    public var ttsProvider: String?
    /// The bot this view was made for (`forBot`), never stored.
    public var resolvedFor: String?

    public init(voice: String = "", speed: Double = 1, language: String = "auto", extraJSON: String = "") {
        self.voice = voice
        self.speed = speed
        self.language = language
        self.extraJSON = extraJSON
    }

    public static let ttsProviders = ["xai", "openai", "elevenlabs", "fish", "system", "chatterbox"]
    /// shared/voice-providers.ts VOICE_STT_PROVIDERS.
    public static let sttProviders = ["xai", "openai"]

    /// The person's own picks (Settings > Voice), "auto" when none.
    public var personTts: String { (extra["tts"] as? String).flatMap { Self.ttsProviders.contains($0) ? $0 : nil } ?? "auto" }
    public var personStt: String { (extra["stt"] as? String).flatMap { Self.sttProviders.contains($0) ? $0 : nil } ?? "auto" }

    /// Settings > Voice > Speech to text: the person's provider, nil for Auto.
    public func withStt(_ provider: String?) -> VoiceModeSettings {
        var out = self
        out.ttsProvider = nil
        out.resolvedFor = nil
        var record = extra
        if let provider, Self.sttProviders.contains(provider) { record["stt"] = provider } else { record["stt"] = nil }
        out.extraJSON = Self.json(record)
        return out
    }

    /// The voice picked for one provider, for no bot.
    public func personVoice(of provider: String) -> String { voice(of: provider, botId: nil) }

    /// `installedVoiceSettings` (shared/voice-mode.ts): a solo installation's
    /// voice (`config.tts`) as the person's choice, the first time nothing is
    /// stored; a provider that is not one of the six falls back to ElevenLabs.
    public static func installed(provider: String?, voice: String?) -> VoiceModeSettings {
        let picked = provider.flatMap { ttsProviders.contains($0) ? $0 : nil } ?? "elevenlabs"
        var out = VoiceModeSettings().withTts(picked)
        if let voice, !voice.isEmpty {
            out = picked == "xai" ? { var x = out; x.voice = voice; return x }() : out.withVoice(voice, forBot: nil)
        }
        return out
    }

    private var extra: [String: Any] {
        guard !extraJSON.isEmpty, let data = extraJSON.data(using: .utf8) else { return [:] }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    private static func json(_ record: [String: Any]) -> String {
        guard !record.isEmpty, let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }

    /// The provider that speaks for this bot: the bot's own choice, then the
    /// person's, nil for Auto (the desktop's `effectiveVoiceChoice`).
    public func ttsChoice(botId: String?) -> String? {
        let bot = botId.flatMap { (extra["bots"] as? [String: Any])?[$0] as? [String: Any] }
        let choice = (bot?["tts"] as? String) ?? (extra["tts"] as? String)
        guard let choice, Self.ttsProviders.contains(choice) else { return nil }
        return choice
    }

    /// The voice picked for one provider for this bot.
    private func voice(of provider: String, botId: String?) -> String {
        let bot = botId.flatMap { (extra["bots"] as? [String: Any])?[$0] as? [String: Any] }
        if let own = (bot?["voices"] as? [String: Any])?[provider] as? String { return own }
        if provider == "xai" { return voice }
        return ((extra["voices"] as? [String: Any])?[provider] as? String) ?? ""
    }

    /// These settings as one bot speaks them: `voice` is the voice of its
    /// provider, `ttsProvider` that provider (nil: Auto, xAI's voice).
    public func forBot(_ botId: String?) -> VoiceModeSettings {
        var view = self
        let provider = ttsChoice(botId: botId)
        view.ttsProvider = provider
        view.voice = voice(of: provider ?? "xai", botId: botId)
        view.resolvedFor = botId ?? ""
        return view
    }

    /// Pick a voice for this bot's provider: the bot's own slot when the bot
    /// has its own provider, else the person's.
    public func withVoice(_ id: String, forBot botId: String?) -> VoiceModeSettings {
        var out = self
        out.ttsProvider = nil
        out.resolvedFor = nil
        let provider = ttsChoice(botId: botId) ?? "xai"
        var record = extra
        var bots = record["bots"] as? [String: Any] ?? [:]
        if let botId, var bot = bots[botId] as? [String: Any], bot["tts"] != nil {
            var voices = bot["voices"] as? [String: Any] ?? [:]
            voices[provider] = id.isEmpty ? nil : id
            bot["voices"] = voices.isEmpty ? nil : voices
            bots[botId] = bot
            record["bots"] = bots
        } else if provider == "xai" {
            out.voice = id
            return out
        } else {
            var voices = record["voices"] as? [String: Any] ?? [:]
            voices[provider] = id.isEmpty ? nil : id
            record["voices"] = voices.isEmpty ? nil : voices
        }
        out.extraJSON = Self.json(record)
        return out
    }

    /// Settings > Voice > Bot's voice: the person's provider (`tts`), nil
    /// for Auto. A bot's own choice stays as it is.
    public func withTts(_ provider: String?) -> VoiceModeSettings {
        var out = self
        out.ttsProvider = nil
        out.resolvedFor = nil
        var record = extra
        if let provider, Self.ttsProviders.contains(provider) { record["tts"] = provider } else { record["tts"] = nil }
        out.extraJSON = Self.json(record)
        return out
    }

    /// A voice for the person's own provider (no bot).
    public func withPersonVoice(_ id: String) -> VoiceModeSettings { withVoice(id, forBot: nil) }

    public static func == (lhs: VoiceModeSettings, rhs: VoiceModeSettings) -> Bool {
        lhs.voice == rhs.voice && lhs.speed == rhs.speed && lhs.language == rhs.language && lhs.extraJSON == rhs.extraJSON
            && lhs.ttsProvider == rhs.ttsProvider && lhs.resolvedFor == rhs.resolvedFor
    }

    public static let storageKey = "omb.voiceMode.v1"
    public static let `default` = VoiceModeSettings()
    public static let speeds: [Double] = [0.75, 1, 1.25, 1.5]
    public static let minSpeed = 0.7
    public static let maxSpeed = 1.5

    /// The languages the panel offers, in the desktop's order.
    public static let languages: [VoiceModeLanguage] = [
        ("auto", "Auto-detect"), ("en", "English"), ("ar-EG", "Arabic (Egypt)"), ("ar-SA", "Arabic (Saudi Arabia)"),
        ("ar-AE", "Arabic (UAE)"), ("bn", "Bengali"), ("ca", "Catalan"), ("zh", "Chinese (Simplified)"), ("cs", "Czech"),
        ("da", "Danish"), ("nl", "Dutch"), ("fil", "Filipino"), ("fi", "Finnish"), ("fr", "French"), ("de", "German"),
        ("hi", "Hindi"), ("id", "Indonesian"), ("it", "Italian"), ("ja", "Japanese"), ("ko", "Korean"), ("ms", "Malay"),
        ("fa", "Persian"), ("pl", "Polish"), ("pt-BR", "Portuguese (Brazil)"), ("pt-PT", "Portuguese (Portugal)"),
        ("ro", "Romanian"), ("ru", "Russian"), ("es-MX", "Spanish (Mexico)"), ("es-ES", "Spanish (Spain)"),
        ("sv", "Swedish"), ("th", "Thai"), ("tr", "Turkish"), ("vi", "Vietnamese"),
    ].map { VoiceModeLanguage(code: $0.0, label: $0.1) }

    public static func isLanguage(_ code: String) -> Bool { languages.contains { $0.code == code } }

    private static let voiceId = try! NSRegularExpression(pattern: "^[\\w.-]{1,64}$")

    public static func isVoiceId(_ value: String) -> Bool {
        voiceId.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
    }

    /// Keep what is valid, default the rest. Never throws.
    public static func clean(_ json: Any?) -> VoiceModeSettings {
        let record = json as? [String: Any] ?? [:]
        var out = VoiceModeSettings.default
        if let voice = record["voice"] as? String, voice.isEmpty || isVoiceId(voice) { out.voice = voice }
        if let speed = (record["speed"] as? NSNumber)?.doubleValue, speed.isFinite, speed >= minSpeed, speed <= maxSpeed { out.speed = speed }
        if let language = record["language"] as? String, isLanguage(language) { out.language = language }
        // the desktop's provider fields travel through untouched
        let others = record.filter { !["voice", "speed", "language"].contains($0.key) }
        out.extraJSON = VoiceModeSettings.json(others)
        return out
    }

    public static func decode(_ raw: String?) -> VoiceModeSettings {
        guard let raw, let data = raw.data(using: .utf8), let json = try? JSONSerialization.jsonObject(with: data) else {
            return .default
        }
        return clean(json)
    }

    public var encoded: String {
        var body: [String: Any] = extra
        body["voice"] = voice
        body["speed"] = speed
        body["language"] = language
        let data = (try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    /// "1x", "1.25x"
    public static func speedLabel(_ speed: Double) -> String {
        let rounded = (speed * 100).rounded() / 100
        let text = rounded == rounded.rounded() ? String(Int(rounded)) : String(rounded)
        return "\(text)x"
    }

    public static func languageLabel(_ code: String) -> String {
        languages.first { $0.code == code }?.label ?? code
    }

    /// The locale the phone's recognizer should listen in: the picked
    /// language, or (auto) the person's own language.
    public func recognitionLocales(preferred: [Locale] = Dictation.localeCandidates()) -> [Locale] {
        guard language != "auto" else { return preferred }
        var out = [Locale(identifier: language)]
        // "fr" alone: prefer the person's own region of it (fr-CA over fr-FR)
        if !language.contains("-") {
            out.insert(contentsOf: preferred.filter { $0.identifier.lowercased().hasPrefix(language.lowercased()) }, at: 0)
        }
        return out
    }
}

/// How this phone takes part in a call (the desktop's CallSettings,
/// `src/lib/voice-mode/call-settings.ts`), kept on this phone under the
/// desktop's key and field names.
public struct CallSettings: Codable, Equatable, Sendable {
    public enum Input: String, Codable, Sendable { case auto, push }
    /// "auto": hands-free with barge-in; "push": hold the button to talk
    public var input: Input
    /// subtle tones for connect, interrupt, hold and end
    public var earcons: Bool
    /// how long a pause ends a turn (short, normal, patient)
    public var pause: CallPause
    /// the settings card's Advanced zone is unfolded (closed by default,
    /// remembered with the call's settings, as on the desktop)
    public var advancedOpen: Bool
    /// "Only my voice": accept turns from the enrolled voice only (needs an
    /// enrollment, CallVoiceprint). On by default, as on the desktop; it
    /// does nothing until a voice is enrolled.
    public var onlyMyVoice: Bool
    /// "Soft tone": a soft tone when the answer is slow to start (over
    /// `LiveCallEngine.thinkingCueSeconds` after the person stopped), so the
    /// silence is not a dead line
    public var thinkingCue: Bool
    /// Advanced: talking while the bot works or speaks cancels that reply
    /// and never stacks the next ones. On by default for TestFlight / debug.
    public var fullDuplex: Bool
    /// Intent marker matching desktop `fullDuplexRev`. A stored false
    /// without rev 2 is the old default, not a kill-switch.
    public var fullDuplexRev: Int

    public init(input: Input = .auto, earcons: Bool = true, pause: CallPause = .normal, advancedOpen: Bool = false, onlyMyVoice: Bool = true, thinkingCue: Bool = true, fullDuplex: Bool = true, fullDuplexRev: Int = CallSettings.currentFullDuplexRev) {
        self.input = input
        self.earcons = earcons
        self.pause = pause
        self.advancedOpen = advancedOpen
        self.onlyMyVoice = onlyMyVoice
        self.thinkingCue = thinkingCue
        self.fullDuplex = fullDuplex
        self.fullDuplexRev = fullDuplexRev
    }

    public static let storageKey = "omb.voiceCall.v1"
    public static let `default` = CallSettings()
    public static let currentFullDuplexRev = 2

    /// Public App Store builds stay off. TestFlight, debug and unknown
    /// (sideload) stay on so the person hears duplex.
    public static func defaultFullDuplex(publicRelease: Bool = isPublicRelease) -> Bool {
        !publicRelease
    }

    public static var isPublicRelease: Bool {
        #if DEBUG
        return false
        #else
        guard let url = Bundle.main.appStoreReceiptURL else { return false }
        return url.lastPathComponent == "receipt"
        #endif
    }

    public static func decode(_ raw: String?) -> CallSettings {
        guard let raw, let data = raw.data(using: .utf8),
              let record = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return .default }
        let rev = record["fullDuplexRev"] as? Int ?? 0
        let stored = record["fullDuplex"] as? Bool
        let duplex: Bool
        if let stored, rev >= CallSettings.currentFullDuplexRev {
            duplex = stored
        } else {
            duplex = CallSettings.defaultFullDuplex()
        }
        return CallSettings(
            input: (record["input"] as? String) == "push" ? .push : .auto,
            earcons: record["earcons"] as? Bool ?? true,
            pause: (record["pause"] as? String).flatMap(CallPause.init(rawValue:)) ?? .normal,
            advancedOpen: record["advancedOpen"] as? Bool ?? false,
            onlyMyVoice: record["onlyMyVoice"] as? Bool ?? true,
            thinkingCue: record["thinkingCue"] as? Bool ?? true,
            fullDuplex: duplex,
            fullDuplexRev: CallSettings.currentFullDuplexRev
        )
    }

    public var encoded: String {
        let record: [String: Any] = [
            "input": input.rawValue, "earcons": earcons, "pause": pause.rawValue, "advancedOpen": advancedOpen,
            "onlyMyVoice": onlyMyVoice, "thinkingCue": thinkingCue, "fullDuplex": fullDuplex,
            "fullDuplexRev": fullDuplexRev,
        ]
        let data = (try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }
}

/// The call's running time, as a phone shows it: m:ss, then h:mm:ss.
public func formatCallTime(_ seconds: TimeInterval) -> String {
    let total = max(0, Int(seconds.rounded(.down)))
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    let secs = String(format: "%02d", total % 60)
    return hours > 0 ? "\(hours):\(String(format: "%02d", minutes)):\(secs)" : "\(minutes):\(secs)"
}

/// Spoken answers to a permission card, shared by every call. The card is
/// spoken as a question with its two options ("Allow once, or deny?") and
/// the answer must pick one: the desktop's `spokenConsent(said, "voice")`
/// (shared/call-consent.ts), same rules. A whole-utterance yes in English or
/// French allows once; a no, with a reason or not, denies; a hedge
/// ("okay", "d'accord"), a mix ("no wait, yes"), a condition ("yes, but
/// rename it"), a question or "always allow" is asked again. An approval
/// must never be granted by a sentence that merely contained "sure".
public enum CallAnswers {
    private static let hedges = try! NSRegularExpression(
        pattern: #"^(?:(?:um+|uh+|er+|euh+|heu+|so|well|hmm+|ben|bon|alors|ok|okay|sure|fine|d'accord|correct|parfait)(?:[\s,.!?-]+|$))+"#,
        options: [.caseInsensitive]
    )
    private static let yes = try! NSRegularExpression(
        pattern: #"^(?:yes|yeah|yep|yup|go ahead|do it|allow(?: it)?(?: once)?|approve(?: it)?|approved|confirm(?: it)?|please do|oui|confirme|je confirme|confirmer|ouais|vas-y|allez-y|autorise(?:-le)?(?: une fois)?|autoriser(?: une fois)?|j'autorise|approuve|j'approuve|j'accepte|accepte)(?:[\s,]+(?:please|go ahead|do it|yes|once|oui|vas-y|allez-y|une fois|merci|s'il te pla[iî]t|s'il vous pla[iî]t))*[.!]*$"#,
        options: [.caseInsensitive]
    )
    private static let no = try! NSRegularExpression(
        pattern: #"^(?:no|nope|nah|don'?t|do not|stop|deny|denied|cancel|never|skip it|non|nan|refuse|refuser|je refuse|annule|annuler|jamais|pas question|laisse faire|laisse tomber)(?=$|[\s,.!-])"#,
        options: [.caseInsensitive]
    )
    private static let notADeny = try! NSRegularExpression(
        pattern: #"\?|(?<![\p{L}\p{N}])(?:but|wait|actually|instead|unless|yes|yeah|allow|approve|confirm|go ahead|mais|attends|en fait|plutôt|sauf|oui|ouais|vas-y|allez-y|autorise|approuve|confirme)(?![\p{L}\p{N}])"#,
        options: [.caseInsensitive]
    )

    /// true: allow once; false: deny; nil: not one of the two options, ask again.
    public static func decision(_ said: String) -> Bool? {
        var text = said.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\u{2019}", with: "'")
            .replacingOccurrences(of: "\u{2018}", with: "'")
            .replacingOccurrences(of: "\u{02BC}", with: "'")
        text = hedges.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
        if text.isEmpty { return nil }
        let whole = NSRange(text.startIndex..., in: text)
        if yes.firstMatch(in: text, range: whole) != nil { return true }
        guard let match = no.firstMatch(in: text, range: whole), let end = Range(match.range, in: text)?.upperBound else { return nil }
        let rest = String(text[end...])
        return notADeny.firstMatch(in: rest, range: NSRange(rest.startIndex..., in: rest)) == nil ? false : nil
    }
}

/// A room's spoken turn in its existing mention syntax (the desktop's
/// `routeSpokenGroupMessage`, src/lib/group-call.ts): recognition returns
/// "Atlas, ..." rather than "@Atlas ...".
public struct SpokenGroupMessage: Equatable, Sendable {
    public var text: String
    public var addressed: Bool
}

public enum GroupCallRouting {
    public static func route(_ text: String, memberNames: [String]) -> SpokenGroupMessage {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return SpokenGroupMessage(text: "", addressed: false) }
        if test("(?:^|\\s)@everyone\\b", trimmed) { return SpokenGroupMessage(text: trimmed, addressed: true) }
        let mentioned = memberNames.contains { name in
            test("(?:^|\\s)@" + NSRegularExpression.escapedPattern(for: name) + "(?=\\s|[,.!?:;]|$)", trimmed)
        }
        if mentioned { return SpokenGroupMessage(text: trimmed, addressed: true) }
        if let rest = capture("^(?:hey\\s+)?(?:everyone|everybody|all)(?:[\\s,:-]+(.*))?$", trimmed) {
            return SpokenGroupMessage(text: rest.isEmpty ? "@everyone" : "@everyone \(rest)", addressed: true)
        }
        for name in memberNames.sorted(by: { $0.count > $1.count }) {
            let pattern = "^(?:hey\\s+)?" + NSRegularExpression.escapedPattern(for: name) + "(?:[\\s,:-]+(.*))?$"
            guard let rest = capture(pattern, trimmed) else { continue }
            return SpokenGroupMessage(text: rest.isEmpty ? "@\(name)" : "@\(name) \(rest)", addressed: true)
        }
        return SpokenGroupMessage(text: trimmed, addressed: false)
    }

    private static func test(_ pattern: String, _ text: String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return false }
        return regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    /// The trailing group (trimmed, "" when absent), or nil when no match.
    private static func capture(_ pattern: String, _ text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        let group = match.range(at: 1)
        guard group.location != NSNotFound, let range = Range(group, in: text) else { return "" }
        return text[range].trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
