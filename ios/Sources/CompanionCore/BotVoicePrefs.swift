// Voice chat prefs for one bot: TTS speed and recognition language.
// Wire shape today may omit them; #2125 adds `bot.voice.speed` /
// `bot.voice.language` (also tolerated as top-level `voiceSpeed` /
// `voiceLanguage`). Absent values fall back to the local call settings.
import Foundation

public enum BotVoicePrefs {
    public static let defaultSpeed: Double = 1
    public static let defaultLanguage = "auto"

    /// Effective TTS rate: the bot's field when present, else the fallback.
    public static func speed(bot: Bot, fallback: Double = defaultSpeed) -> Double {
        bot.voiceSpeed ?? fallback
    }

    /// Effective recognition language: the bot's field when present, else the fallback.
    public static func language(bot: Bot, fallback: String = defaultLanguage) -> String {
        let own = bot.voiceLanguage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return own.isEmpty ? fallback : own
    }

    /// Decode nested `voice: { id, speed, language }` beside a string voice id.
    /// Returns nil when the payload has neither speed nor language.
    public static func nested(from voiceJSON: Any?) -> (id: String?, speed: Double?, language: String?)? {
        guard let object = voiceJSON as? [String: Any] else { return nil }
        let id = (object["id"] as? String) ?? (object["voice"] as? String)
        let speed = object["speed"] as? Double ?? (object["speed"] as? Int).map(Double.init)
        let language = object["language"] as? String
        if speed == nil && language == nil && id == nil { return nil }
        return (id, speed, language)
    }
}
